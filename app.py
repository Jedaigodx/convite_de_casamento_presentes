"""
Wedding Gift List - Thatianna & Vinicius
Security hardening applied:
  - Constant-time token comparison (prevent timing attacks)
  - Input validation & sanitisation on all public endpoints
  - Rate limiting on contribute + login endpoints
  - Strict file-upload validation (magic bytes + extension + MIME)
  - SQL injection protection via ORM (parameterised queries only)
  - No stack traces exposed in production responses
  - Content-Security-Policy, X-Frame-Options, X-Content-Type-Options headers
  - parent_id integrity check (parent must exist and be a root item)
  - Amount capped at a sane maximum (R$ 50 000)
  - Status transitions whitelist (only allowed values accepted)
  - Filename kept UUID-only — no user input ever touches the filesystem path
"""

from flask import Flask, render_template, request, jsonify, send_from_directory, g
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import os, io, base64, hashlib, hmac, uuid, re, time
from functools import wraps
from collections import defaultdict
import qrcode
from PIL import Image, UnidentifiedImageError

app = Flask(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get('SECRET_KEY', '')
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable must be set")

app.secret_key = SECRET_KEY
app.config['ENV'] = 'production'

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///wedding.db')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI']       = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS']= False
app.config['SQLALCHEMY_ENGINE_OPTIONS']     = {'pool_pre_ping': True, 'pool_recycle': 300}
app.config['MAX_CONTENT_LENGTH']            = 8 * 1024 * 1024   # 8 MB hard limit

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

db = SQLAlchemy(app)

PIX_KEY        = os.environ.get('PIX_KEY',        '')
PIX_NAME       = os.environ.get('PIX_NAME',       'Thatianna e Vinicius')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD environment variable must be set")

# Allowed status transitions
VALID_STATUSES = {'pending', 'confirmed', 'cancelled'}

# ─── Security headers ─────────────────────────────────────────────────────────
@app.after_request
def set_security_headers(response):
    response.headers['X-Frame-Options']        = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "script-src 'self'; "
        "connect-src 'self';"
    )
    return response

# ─── Rate limiting (in-memory, per IP) ───────────────────────────────────────
_rate_store = defaultdict(list)   # ip -> [timestamps]

def rate_limit(max_calls: int, window_seconds: int):
    """Simple sliding-window rate limiter."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            ip  = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()
            now = time.time()
            calls = _rate_store[ip]
            # Evict old entries
            _rate_store[ip] = [t for t in calls if now - t < window_seconds]
            if len(_rate_store[ip]) >= max_calls:
                return jsonify({'error': 'Muitas tentativas. Aguarde alguns minutos.'}), 429
            _rate_store[ip].append(now)
            return f(*args, **kwargs)
        return wrapper
    return decorator

# ─── Auth token (constant-time comparison) ────────────────────────────────────
ADMIN_TOKEN = hmac.new(SECRET_KEY.encode(), ADMIN_PASSWORD.encode(), hashlib.sha256).hexdigest()

def _safe_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('X-Admin-Token', '')
        if not token or not _safe_compare(token, ADMIN_TOKEN):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

# ─── Input helpers ────────────────────────────────────────────────────────────
def _str(val, max_len=200) -> str:
    if not isinstance(val, str):
        return ''
    return val.strip()[:max_len]

def _float(val, min_v=0, max_v=50000) -> float | None:
    try:
        v = float(val)
        if min_v <= v <= max_v:
            return v
    except (TypeError, ValueError):
        pass
    return None

def _int(val, min_v=0, max_v=9999) -> int:
    try:
        v = int(val)
        if min_v <= v <= max_v:
            return v
    except (TypeError, ValueError):
        pass
    return 0

# ─── Models ───────────────────────────────────────────────────────────────────
class TravelItem(db.Model):
    __tablename__ = 'travel_items'
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(200), nullable=False)
    description   = db.Column(db.Text)
    goal_amount   = db.Column(db.Float, nullable=False)
    image_url     = db.Column(db.String(500))
    category      = db.Column(db.String(100), default='Viagem')
    is_active     = db.Column(db.Boolean, default=True)
    display_order = db.Column(db.Integer, default=0)
    # Hierarchy: None = root (main trip), int = child of that root
    parent_id     = db.Column(db.Integer, db.ForeignKey('travel_items.id'), nullable=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    children      = db.relationship('TravelItem', backref=db.backref('parent', remote_side='TravelItem.id'), lazy='dynamic')

    @property
    def raised_amount(self):
        return db.session.query(
            db.func.coalesce(db.func.sum(Contribution.amount), 0)
        ).filter(
            Contribution.travel_item_id == self.id,
            Contribution.status != 'cancelled'
        ).scalar()

    @property
    def progress_pct(self):
        if self.goal_amount <= 0:
            return 100
        return min(100, round(float(self.raised_amount) / self.goal_amount * 100, 1))

    @property
    def is_complete(self):
        return float(self.raised_amount) >= self.goal_amount

    def to_dict(self, include_children=False):
        d = {
            'id':            self.id,
            'name':          self.name,
            'description':   self.description,
            'goal_amount':   self.goal_amount,
            'raised_amount': float(self.raised_amount),
            'progress_pct':  self.progress_pct,
            'is_complete':   self.is_complete,
            'image_url':     self.image_url,
            'category':      self.category,
            'is_active':     self.is_active,
            'display_order': self.display_order,
            'parent_id':     self.parent_id,
        }
        if include_children:
            d['children'] = [
                c.to_dict() for c in
                self.children.filter_by(is_active=True)
                             .order_by(TravelItem.display_order).all()
            ]
        return d


class Contribution(db.Model):
    __tablename__ = 'contributions'
    id             = db.Column(db.Integer, primary_key=True)
    travel_item_id = db.Column(db.Integer, db.ForeignKey('travel_items.id'), nullable=False)
    giver_name     = db.Column(db.String(200), nullable=False)
    message        = db.Column(db.Text)
    amount         = db.Column(db.Float, nullable=False)
    status         = db.Column(db.String(50), default='pending')
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)

    travel_item = db.relationship('TravelItem', backref='contributions')

    def to_dict(self):
        return {
            'id':             self.id,
            'travel_item_id': self.travel_item_id,
            'item_name':      self.travel_item.name if self.travel_item else '',
            'item_goal':      self.travel_item.goal_amount if self.travel_item else 0,
            'giver_name':     self.giver_name,
            'message':        self.message,
            'amount':         self.amount,
            'status':         self.status,
            'created_at':     self.created_at.strftime('%d/%m/%Y %H:%M'),
        }

# ─── Auto-init DB ─────────────────────────────────────────────────────────────
with app.app_context():
    try:
        db.create_all()
        print("Database ready")
    except Exception as e:
        print(f"DB init error: {e}")

# ─── Pages ────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin')
def admin_page():
    return render_template('admin.html')

@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    # Only serve files matching our UUID pattern — block path traversal
    if not re.fullmatch(r'[0-9a-f]{32}\.jpg', filename):
        return '', 404
    return send_from_directory(UPLOAD_FOLDER, filename)

# ─── Auth ─────────────────────────────────────────────────────────────────────
@app.route('/api/admin/login', methods=['POST'])
@rate_limit(max_calls=10, window_seconds=300)   # 10 attempts per 5 min
def admin_login():
    try:
        data = request.get_json(silent=True) or {}
        pwd  = _str(data.get('password', ''), 200)
        if pwd and _safe_compare(pwd, ADMIN_PASSWORD):
            return jsonify({'success': True, 'token': ADMIN_TOKEN})
        return jsonify({'error': 'Senha incorreta'}), 401
    except Exception:
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/check', methods=['GET'])
def admin_check():
    token = request.headers.get('X-Admin-Token', '')
    return jsonify({'logged_in': bool(token) and _safe_compare(token, ADMIN_TOKEN)})

# ─── Image Upload ─────────────────────────────────────────────────────────────
# Magic bytes for allowed image types
_MAGIC = {
    b'\xff\xd8\xff': 'jpeg',
    b'\x89PNG':      'png',
    b'RIFF':         'webp',   # checked further below
}

def _check_magic(stream) -> bool:
    header = stream.read(12)
    stream.seek(0)
    for magic, kind in _MAGIC.items():
        if header[:len(magic)] == magic:
            if kind == 'webp' and header[8:12] != b'WEBP':
                continue
            return True
    return False

@app.route('/api/admin/upload', methods=['POST'])
@admin_required
def upload_image():
    try:
        file = request.files.get('image')
        if not file:
            return jsonify({'error': 'Nenhuma imagem enviada'}), 400

        # Validate MIME type declared by client
        allowed_mime = {'image/jpeg', 'image/png', 'image/webp'}
        if file.content_type not in allowed_mime:
            return jsonify({'error': 'Formato não suportado. Use JPG, PNG ou WebP'}), 400

        # Validate magic bytes (actual file content)
        if not _check_magic(file.stream):
            return jsonify({'error': 'Arquivo inválido'}), 400

        # Open with Pillow — will raise on corrupt/malicious files
        try:
            img = Image.open(file.stream)
            img.verify()          # check integrity without decoding fully
            file.stream.seek(0)
            img = Image.open(file.stream)
            img = img.convert('RGB')
        except (UnidentifiedImageError, Exception):
            return jsonify({'error': 'Não foi possível processar a imagem'}), 400

        # Sanity-check dimensions (reject absurdly large images before resizing)
        if img.width > 8000 or img.height > 8000:
            return jsonify({'error': 'Imagem muito grande (máx 8000px)'}), 400

        # Crop to 4:3 centred
        w, h = img.size
        target_ratio = 4 / 3
        if w / h > target_ratio:
            new_w = int(h * target_ratio)
            left  = (w - new_w) // 2
            img   = img.crop((left, 0, left + new_w, h))
        else:
            new_h = int(w / target_ratio)
            top   = (h - new_h) // 2
            img   = img.crop((0, top, w, top + new_h))

        img.thumbnail((800, 600), Image.LANCZOS)

        # UUID filename — never based on user input
        filename = f"{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        img.save(filepath, 'JPEG', quality=85, optimize=True)

        return jsonify({'url': f'/static/uploads/{filename}'})
    except Exception:
        return jsonify({'error': 'Erro ao processar imagem'}), 500

# ─── Public: Items (with hierarchy) ──────────────────────────────────────────
@app.route('/api/items', methods=['GET'])
def get_items():
    try:
        # Return only root items with their active children nested
        roots = TravelItem.query.filter_by(is_active=True, parent_id=None)\
                                .order_by(TravelItem.display_order, TravelItem.id).all()
        return jsonify([i.to_dict(include_children=True) for i in roots])
    except Exception:
        return jsonify({'error': 'Erro interno'}), 500

# ─── Public: Contribute ───────────────────────────────────────────────────────
@app.route('/api/contribute', methods=['POST'])
@rate_limit(max_calls=20, window_seconds=60)   # 20 contributions/min per IP
def contribute():
    try:
        data       = request.get_json(silent=True) or {}
        item_id    = data.get('travel_item_id')
        giver_name = _str(data.get('giver_name', ''), 200)
        message    = _str(data.get('message', ''), 500)
        amount     = _float(data.get('amount', 0), min_v=1, max_v=50000)

        if not giver_name:
            return jsonify({'error': 'Nome é obrigatório'}), 400
        if amount is None:
            return jsonify({'error': 'Valor inválido (mínimo R$ 1,00, máximo R$ 50.000,00)'}), 400

        # Validate item exists and is active
        try:
            item_id = int(item_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Item inválido'}), 400

        item = TravelItem.query.filter_by(id=item_id, is_active=True).first()
        if not item:
            return jsonify({'error': 'Experiência não encontrada'}), 404

        contribution = Contribution(
            travel_item_id = item_id,
            giver_name     = giver_name,
            message        = message,
            amount         = amount,
        )
        db.session.add(contribution)
        db.session.commit()

        return jsonify({
            'success':         True,
            'contribution_id': contribution.id,
            'pix_key':         PIX_KEY,
            'pix_name':        PIX_NAME,
            'amount':          amount,
            'item_name':       item.name,
        })
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Erro interno'}), 500

# ─── Pix QR Code ─────────────────────────────────────────────────────────────
@app.route('/api/pix-qrcode', methods=['POST'])
@rate_limit(max_calls=30, window_seconds=60)
def generate_pix_qrcode():
    try:
        data   = request.get_json(silent=True) or {}
        amount = _float(data.get('amount', 0), min_v=1, max_v=50000)
        if amount is None:
            return jsonify({'error': 'Valor inválido'}), 400

        def pix_field(fid, value):
            return f"{fid:02d}{len(value):02d}{value}"

        safe_pix_name = re.sub(r'[^A-Za-z0-9 ]', '', PIX_NAME)[:25]
        merchant_account = pix_field(0, "BR.GOV.BCB.PIX") + pix_field(1, PIX_KEY)
        amount_str = f"{amount:.2f}"
        payload_no_crc = (
            pix_field(0,  "01") + pix_field(1, "12") +
            pix_field(26, merchant_account) +
            pix_field(52, "0000") + pix_field(53, "986") +
            pix_field(54, amount_str) + pix_field(58, "BR") +
            pix_field(59, safe_pix_name) + pix_field(60, "SAO PAULO") +
            pix_field(62, pix_field(5, "***")) + "6304"
        )

        def crc16(s):
            crc = 0xFFFF
            for byte in s.encode('utf-8'):
                crc ^= byte << 8
                for _ in range(8):
                    crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
                    crc &= 0xFFFF
            return crc

        payload = payload_no_crc + f"{crc16(payload_no_crc):04X}"
        qr = qrcode.QRCode(version=1, box_size=6, border=2)
        qr.add_data(payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#3d5a2b", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)

        return jsonify({
            'qrcode':   f"data:image/png;base64,{base64.b64encode(buf.read()).decode()}",
            'payload':  payload,
            'amount':   amount_str,
            'pix_key':  PIX_KEY,
            'pix_name': PIX_NAME,
        })
    except Exception:
        return jsonify({'error': 'Erro interno'}), 500

# ─── Admin: Items ─────────────────────────────────────────────────────────────
@app.route('/api/admin/items', methods=['GET'])
@admin_required
def admin_get_items():
    try:
        items = TravelItem.query.order_by(TravelItem.parent_id.nullsfirst(),
                                          TravelItem.display_order,
                                          TravelItem.id).all()
        return jsonify([i.to_dict(include_children=False) for i in items])
    except Exception:
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/items', methods=['POST'])
@admin_required
def admin_create_item():
    try:
        data = request.get_json(silent=True) or {}
        name = _str(data.get('name', ''), 200)
        if not name:
            return jsonify({'error': 'Nome obrigatório'}), 400

        goal = _float(data.get('goal_amount', 0), min_v=1, max_v=1000000)
        if goal is None:
            return jsonify({'error': 'Meta inválida'}), 400

        # Validate parent_id if provided
        parent_id = data.get('parent_id')
        if parent_id is not None:
            try:
                parent_id = int(parent_id)
                parent = TravelItem.query.filter_by(id=parent_id, parent_id=None).first()
                if not parent:
                    return jsonify({'error': 'Item pai inválido ou não é um item raiz'}), 400
            except (ValueError, TypeError):
                return jsonify({'error': 'parent_id inválido'}), 400

        # Sanitise image_url — only allow relative /static/uploads/ paths
        image_url = _str(data.get('image_url', ''), 500)
        if image_url and not image_url.startswith('/static/uploads/'):
            image_url = ''

        allowed_categories = {'Passeio','Hospedagem','Gastronomia','Transporte','Aventura','Cultura','Viagem'}
        category = _str(data.get('category', 'Viagem'), 100)
        if category not in allowed_categories:
            category = 'Viagem'

        item = TravelItem(
            name          = name,
            description   = _str(data.get('description', ''), 1000),
            goal_amount   = goal,
            image_url     = image_url,
            category      = category,
            is_active     = bool(data.get('is_active', True)),
            display_order = _int(data.get('display_order', 0)),
            parent_id     = parent_id,
        )
        db.session.add(item)
        db.session.commit()
        return jsonify(item.to_dict()), 201
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/items/<int:item_id>', methods=['PUT'])
@admin_required
def admin_update_item(item_id):
    try:
        item = TravelItem.query.get_or_404(item_id)
        data = request.get_json(silent=True) or {}

        if 'name' in data:
            name = _str(data['name'], 200)
            if not name:
                return jsonify({'error': 'Nome obrigatório'}), 400
            item.name = name

        if 'description' in data:
            item.description = _str(data['description'], 1000)

        if 'goal_amount' in data:
            goal = _float(data['goal_amount'], min_v=1, max_v=1000000)
            if goal is None:
                return jsonify({'error': 'Meta inválida'}), 400
            item.goal_amount = goal

        if 'image_url' in data:
            url = _str(data['image_url'], 500)
            item.image_url = url if url.startswith('/static/uploads/') else ''

        if 'category' in data:
            allowed_categories = {'Passeio','Hospedagem','Gastronomia','Transporte','Aventura','Cultura','Viagem'}
            cat = _str(data['category'], 100)
            item.category = cat if cat in allowed_categories else 'Viagem'

        if 'is_active' in data:
            item.is_active = bool(data['is_active'])

        if 'display_order' in data:
            item.display_order = _int(data['display_order'])

        if 'parent_id' in data:
            pid = data['parent_id']
            if pid is None:
                item.parent_id = None
            else:
                try:
                    pid = int(pid)
                    if pid == item_id:
                        return jsonify({'error': 'Item não pode ser pai de si mesmo'}), 400
                    parent = TravelItem.query.filter_by(id=pid, parent_id=None).first()
                    if not parent:
                        return jsonify({'error': 'Item pai inválido'}), 400
                    item.parent_id = pid
                except (ValueError, TypeError):
                    return jsonify({'error': 'parent_id inválido'}), 400

        db.session.commit()
        return jsonify(item.to_dict())
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/items/<int:item_id>', methods=['DELETE'])
@admin_required
def admin_delete_item(item_id):
    try:
        item = TravelItem.query.get_or_404(item_id)
        # Soft-delete children too
        TravelItem.query.filter_by(parent_id=item_id).update({'is_active': False})
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Erro interno'}), 500

# ─── Admin: Contributions ─────────────────────────────────────────────────────
@app.route('/api/admin/contributions', methods=['GET'])
@admin_required
def admin_get_contributions():
    try:
        contribs = Contribution.query.order_by(Contribution.created_at.desc()).all()
        return jsonify([c.to_dict() for c in contribs])
    except Exception:
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/contributions/<int:cid>/status', methods=['PUT'])
@admin_required
def admin_update_contrib_status(cid):
    try:
        c    = Contribution.query.get_or_404(cid)
        data = request.get_json(silent=True) or {}
        new_status = _str(data.get('status', ''), 20)
        if new_status not in VALID_STATUSES:
            return jsonify({'error': 'Status inválido'}), 400
        c.status = new_status
        db.session.commit()
        return jsonify(c.to_dict())
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Erro interno'}), 500

# ─── Admin: Stats ─────────────────────────────────────────────────────────────
@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def admin_stats():
    try:
        items        = TravelItem.query.filter_by(is_active=True).all()
        total_goal   = sum(i.goal_amount for i in items)
        total_raised = sum(float(i.raised_amount) for i in items)
        confirmed_raised = float(
            db.session.query(db.func.coalesce(db.func.sum(Contribution.amount), 0))
            .filter_by(status='confirmed').scalar()
        )
        total_contribs    = Contribution.query.filter(Contribution.status != 'cancelled').count()
        progress_pct = round(total_raised / total_goal * 100, 1) if total_goal > 0 else 0

        items_stats = [{
            'id':            i.id,
            'name':          i.name,
            'goal_amount':   i.goal_amount,
            'raised_amount': float(i.raised_amount),
            'progress_pct':  i.progress_pct,
            'parent_id':     i.parent_id,
        } for i in items]

        return jsonify({
            'total_goal':        round(total_goal, 2),
            'total_raised':      round(total_raised, 2),
            'confirmed_raised':  round(confirmed_raised, 2),
            'progress_pct':      progress_pct,
            'total_contribs':    total_contribs,
            'items_stats':       items_stats,
        })
    except Exception:
        return jsonify({'error': 'Erro interno'}), 500

# ─── Health ───────────────────────────────────────────────────────────────────
@app.route('/health')
def health():
    try:
        count = TravelItem.query.count()
        return jsonify({'status': 'ok', 'db': 'connected', 'items': count})
    except Exception:
        return jsonify({'status': 'ok', 'db': 'error'})

if __name__ == '__main__':
    app.run(debug=False, port=5000)
