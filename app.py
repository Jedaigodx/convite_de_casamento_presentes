"""
Wedding Gift List · Thatianna & Vinicius
"""
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os, io, base64, hashlib, hmac, uuid, re, time, json
from functools import wraps
from collections import defaultdict
import qrcode
from PIL import Image, UnidentifiedImageError

app = Flask(__name__)

SECRET_KEY = os.environ.get('SECRET_KEY', '')
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set")
app.secret_key = SECRET_KEY

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///wedding.db')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI']        = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS']      = {'pool_pre_ping': True, 'pool_recycle': 300}
app.config['MAX_CONTENT_LENGTH']             = 8 * 1024 * 1024

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

db = SQLAlchemy(app)

PIX_KEY        = os.environ.get('PIX_KEY', '')
PIX_NAME       = os.environ.get('PIX_NAME', 'Thatianna e Vinicius')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD must be set")

VALID_STATUSES       = {'pending', 'confirmed', 'cancelled'}
ALLOWED_CATEGORIES   = {'Passeio','Hospedagem','Gastronomia','Transporte','Aventura','Cultura','Viagem'}

# ─── Security headers ─────────────────────────────────────────────────────────
@app.after_request
def set_headers(r):
    r.headers['X-Frame-Options']        = 'DENY'
    r.headers['X-Content-Type-Options'] = 'nosniff'
    r.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
    r.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "script-src 'self'; "
        "connect-src 'self';"
    )
    return r

# ─── Rate limit ───────────────────────────────────────────────────────────────
_rl = defaultdict(list)
def rate_limit(max_calls, window):
    def dec(f):
        @wraps(f)
        def wrap(*a, **kw):
            ip  = (request.headers.get('X-Forwarded-For', '') or request.remote_addr or '').split(',')[0].strip()
            now = time.time()
            _rl[ip] = [t for t in _rl[ip] if now - t < window]
            if len(_rl[ip]) >= max_calls:
                return jsonify({'error': 'Muitas tentativas. Aguarde alguns minutos.'}), 429
            _rl[ip].append(now)
            return f(*a, **kw)
        return wrap
    return dec

# ─── Auth ─────────────────────────────────────────────────────────────────────
ADMIN_TOKEN = hmac.new(SECRET_KEY.encode(), ADMIN_PASSWORD.encode(), hashlib.sha256).hexdigest()

def _cmp(a, b):
    return hmac.compare_digest(a.encode(), b.encode())

def admin_required(f):
    @wraps(f)
    def dec(*a, **kw):
        t = request.headers.get('X-Admin-Token', '')
        if not t or not _cmp(t, ADMIN_TOKEN):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*a, **kw)
    return dec

# ─── Input helpers ────────────────────────────────────────────────────────────
def _s(v, mx=200):
    return str(v).strip()[:mx] if isinstance(v, str) else ''

def _f(v, lo=0, hi=50000):
    try:
        x = float(v)
        return x if lo <= x <= hi else None
    except: return None

def _i(v, lo=0, hi=9999):
    try:
        x = int(v)
        return x if lo <= x <= hi else lo
    except: return lo

def _safe_url(v):
    v = _s(v, 500)
    return v if v.startswith('/static/uploads/') else ''

# ─── Models ───────────────────────────────────────────────────────────────────
class TravelItem(db.Model):
    __tablename__ = 'travel_items'
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(200), nullable=False)
    description   = db.Column(db.Text)
    goal_amount   = db.Column(db.Float, nullable=False)
    # JSON array of /static/uploads/xxx.jpg strings
    images_json   = db.Column(db.Text, default='[]')
    category      = db.Column(db.String(100), default='Viagem')
    is_active     = db.Column(db.Boolean, default=True)
    display_order = db.Column(db.Integer, default=0)
    parent_id     = db.Column(db.Integer, db.ForeignKey('travel_items.id'), nullable=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    children = db.relationship(
        'TravelItem',
        backref=db.backref('parent', remote_side='TravelItem.id'),
        lazy='dynamic',
        foreign_keys='TravelItem.parent_id'
    )

    @property
    def images(self):
        try:
            return json.loads(self.images_json or '[]')
        except: return []

    @property
    def primary_image(self):
        imgs = self.images
        return imgs[0] if imgs else None

    @property
    def raised_amount(self):
        result = db.session.query(
            db.func.coalesce(db.func.sum(Contribution.amount), 0)
        ).filter(
            Contribution.travel_item_id == self.id,
            Contribution.status != 'cancelled'
        ).scalar()
        return float(result)

    @property
    def remaining_amount(self):
        return max(0.0, self.goal_amount - self.raised_amount)

    @property
    def progress_pct(self):
        if self.goal_amount <= 0: return 100
        return min(100, round(self.raised_amount / self.goal_amount * 100, 1))

    @property
    def is_complete(self):
        return self.raised_amount >= self.goal_amount

    def to_dict(self, include_children=False):
        d = {
            'id':               self.id,
            'name':             self.name,
            'description':      self.description,
            'goal_amount':      self.goal_amount,
            'raised_amount':    self.raised_amount,
            'remaining_amount': self.remaining_amount,
            'progress_pct':     self.progress_pct,
            'is_complete':      self.is_complete,
            'images':           self.images,
            'primary_image':    self.primary_image,
            'category':         self.category,
            'is_active':        self.is_active,
            'display_order':    self.display_order,
            'parent_id':        self.parent_id,
        }
        if include_children:
            d['children'] = [
                c.to_dict() for c in
                self.children.filter_by(is_active=True)
                             .order_by(TravelItem.display_order, TravelItem.id).all()
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

# ─── DB init ──────────────────────────────────────────────────────────────────
with app.app_context():
    try:
        db.create_all()
        # Migrate: add images_json if missing (for existing DBs)
        try:
            db.session.execute(db.text("SELECT images_json FROM travel_items LIMIT 1"))
        except Exception:
            try:
                db.session.execute(db.text("ALTER TABLE travel_items ADD COLUMN images_json TEXT DEFAULT '[]'"))
                db.session.commit()
            except Exception: pass
        print("DB ready")
    except Exception as e:
        print(f"DB error: {e}")

# ─── Pages ────────────────────────────────────────────────────────────────────
@app.route('/')
def index(): return render_template('index.html')

@app.route('/admin')
def admin_page(): return render_template('admin.html')

@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    if not re.fullmatch(r'[0-9a-f]{32}\.jpg', filename):
        return '', 404
    return send_from_directory(UPLOAD_FOLDER, filename)

# ─── Auth API ─────────────────────────────────────────────────────────────────
@app.route('/api/admin/login', methods=['POST'])
@rate_limit(10, 300)
def admin_login():
    try:
        data = request.get_json(silent=True) or {}
        pwd  = _s(data.get('password', ''), 200)
        if pwd and _cmp(pwd, ADMIN_PASSWORD):
            return jsonify({'success': True, 'token': ADMIN_TOKEN})
        return jsonify({'error': 'Senha incorreta'}), 401
    except: return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/check')
def admin_check():
    t = request.headers.get('X-Admin-Token', '')
    return jsonify({'logged_in': bool(t) and _cmp(t, ADMIN_TOKEN)})

# ─── Upload ───────────────────────────────────────────────────────────────────
_MAGIC = {b'\xff\xd8\xff': 'jpeg', b'\x89PNG': 'png', b'RIFF': 'webp'}

def _valid_magic(stream):
    h = stream.read(12); stream.seek(0)
    for m, k in _MAGIC.items():
        if h[:len(m)] == m:
            if k == 'webp' and h[8:12] != b'WEBP': continue
            return True
    return False

@app.route('/api/admin/upload', methods=['POST'])
@admin_required
def upload_image():
    try:
        file = request.files.get('image')
        if not file: return jsonify({'error': 'Sem imagem'}), 400
        if file.content_type not in {'image/jpeg','image/png','image/webp'}:
            return jsonify({'error': 'Use JPG, PNG ou WebP'}), 400
        if not _valid_magic(file.stream):
            return jsonify({'error': 'Arquivo inválido'}), 400
        try:
            img = Image.open(file.stream); img.verify()
            file.stream.seek(0)
            img = Image.open(file.stream).convert('RGB')
        except: return jsonify({'error': 'Imagem corrompida'}), 400
        if img.width > 8000 or img.height > 8000:
            return jsonify({'error': 'Imagem muito grande'}), 400
        # Crop 4:3
        w, h = img.size; r = 4/3
        if w/h > r:
            nw = int(h*r); img = img.crop(((w-nw)//2, 0, (w-nw)//2+nw, h))
        else:
            nh = int(w/r); img = img.crop((0, (h-nh)//2, w, (h-nh)//2+nh))
        img.thumbnail((900, 675), Image.LANCZOS)
        fn = f"{uuid.uuid4().hex}.jpg"
        img.save(os.path.join(UPLOAD_FOLDER, fn), 'JPEG', quality=85, optimize=True)
        return jsonify({'url': f'/static/uploads/{fn}'})
    except: return jsonify({'error': 'Erro ao processar'}), 500

# ─── Public: Items ────────────────────────────────────────────────────────────
@app.route('/api/items')
def get_items():
    try:
        roots = TravelItem.query.filter_by(is_active=True, parent_id=None)\
                                .order_by(TravelItem.display_order, TravelItem.id).all()
        return jsonify([i.to_dict(include_children=True) for i in roots])
    except: return jsonify({'error': 'Erro interno'}), 500

# ─── Public: Contribute ───────────────────────────────────────────────────────
@app.route('/api/contribute', methods=['POST'])
@rate_limit(20, 60)
def contribute():
    try:
        data       = request.get_json(silent=True) or {}
        giver_name = _s(data.get('giver_name', ''), 200)
        message    = _s(data.get('message', ''), 500)
        amount     = _f(data.get('amount', 0), lo=1, hi=50000)

        if not giver_name: return jsonify({'error': 'Nome é obrigatório'}), 400
        if amount is None: return jsonify({'error': 'Valor inválido'}), 400

        try: item_id = int(data.get('travel_item_id'))
        except: return jsonify({'error': 'Item inválido'}), 400

        item = TravelItem.query.filter_by(id=item_id, is_active=True).first()
        if not item: return jsonify({'error': 'Item não encontrado'}), 404

        # Cap at remaining amount
        remaining = item.remaining_amount
        if remaining <= 0:
            return jsonify({'error': 'Meta já atingida para este item'}), 400
        amount = min(amount, remaining)

        c = Contribution(
            travel_item_id=item_id, giver_name=giver_name,
            message=message, amount=amount
        )
        db.session.add(c)
        db.session.commit()
        return jsonify({'success': True, 'contribution_id': c.id,
                        'pix_key': PIX_KEY, 'pix_name': PIX_NAME,
                        'amount': amount, 'item_name': item.name})
    except:
        db.session.rollback()
        return jsonify({'error': 'Erro interno'}), 500

# ─── Pix QR ───────────────────────────────────────────────────────────────────
@app.route('/api/pix-qrcode', methods=['POST'])
@rate_limit(30, 60)
def pix_qrcode():
    try:
        data   = request.get_json(silent=True) or {}
        amount = _f(data.get('amount', 0), lo=1, hi=50000)
        if not amount: return jsonify({'error': 'Valor inválido'}), 400

        def pf(fid, v): return f"{fid:02d}{len(v):02d}{v}"
        safe_name  = re.sub(r'[^A-Za-z0-9 ]', '', PIX_NAME)[:25]
        amount_str = f"{amount:.2f}"
        body = (pf(0,'01') + pf(1,'12') +
                pf(26, pf(0,'BR.GOV.BCB.PIX') + pf(1, PIX_KEY)) +
                pf(52,'0000') + pf(53,'986') + pf(54,amount_str) +
                pf(58,'BR') + pf(59,safe_name) + pf(60,'SAO PAULO') +
                pf(62,pf(5,'***')) + '6304')
        def crc16(s):
            c = 0xFFFF
            for b in s.encode():
                c ^= b << 8
                for _ in range(8): c = (c<<1)^0x1021 if c&0x8000 else c<<1; c &= 0xFFFF
            return c
        payload = body + f"{crc16(body):04X}"
        qr = qrcode.QRCode(version=1, box_size=6, border=2)
        qr.add_data(payload); qr.make(fit=True)
        img = qr.make_image(fill_color="#3d5a2b", back_color="white")
        buf = io.BytesIO(); img.save(buf,'PNG'); buf.seek(0)
        return jsonify({'qrcode': f"data:image/png;base64,{base64.b64encode(buf.read()).decode()}",
                        'payload': payload, 'amount': amount_str,
                        'pix_key': PIX_KEY, 'pix_name': PIX_NAME})
    except: return jsonify({'error': 'Erro interno'}), 500

# ─── Admin: Items ─────────────────────────────────────────────────────────────
@app.route('/api/admin/items')
@admin_required
def admin_get_items():
    try:
        items = TravelItem.query.order_by(
            TravelItem.parent_id.nullsfirst(), TravelItem.display_order, TravelItem.id
        ).all()
        return jsonify([i.to_dict() for i in items])
    except: return jsonify({'error': 'Erro interno'}), 500

def _validate_images(raw):
    """Accept a JSON array of /static/uploads/ paths."""
    if not isinstance(raw, list): return []
    return [u for u in raw if isinstance(u, str) and u.startswith('/static/uploads/')][:10]

@app.route('/api/admin/items', methods=['POST'])
@admin_required
def admin_create_item():
    try:
        data = request.get_json(silent=True) or {}
        name = _s(data.get('name',''), 200)
        if not name: return jsonify({'error': 'Nome obrigatório'}), 400
        goal = _f(data.get('goal_amount', 0), lo=1, hi=1_000_000)
        if not goal: return jsonify({'error': 'Meta inválida'}), 400

        parent_id = None
        if data.get('parent_id') not in (None, '', 0):
            try:
                pid = int(data['parent_id'])
                parent = TravelItem.query.filter_by(id=pid, parent_id=None).first()
                if not parent: return jsonify({'error': 'Item pai inválido'}), 400
                parent_id = pid
            except: return jsonify({'error': 'parent_id inválido'}), 400

        cat = _s(data.get('category','Viagem'), 100)
        if cat not in ALLOWED_CATEGORIES: cat = 'Viagem'

        imgs = _validate_images(data.get('images', []))

        item = TravelItem(
            name=name, description=_s(data.get('description',''), 1000),
            goal_amount=goal, images_json=json.dumps(imgs),
            category=cat, is_active=bool(data.get('is_active', True)),
            display_order=_i(data.get('display_order', 0)),
            parent_id=parent_id,
        )
        db.session.add(item); db.session.commit()
        return jsonify(item.to_dict()), 201
    except:
        db.session.rollback(); return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/items/<int:iid>', methods=['PUT'])
@admin_required
def admin_update_item(iid):
    try:
        item = TravelItem.query.get_or_404(iid)
        data = request.get_json(silent=True) or {}

        if 'name' in data:
            n = _s(data['name'], 200)
            if not n: return jsonify({'error': 'Nome obrigatório'}), 400
            item.name = n
        if 'description' in data: item.description = _s(data['description'], 1000)
        if 'goal_amount'  in data:
            g = _f(data['goal_amount'], lo=1, hi=1_000_000)
            if not g: return jsonify({'error': 'Meta inválida'}), 400
            item.goal_amount = g
        if 'images' in data:
            item.images_json = json.dumps(_validate_images(data['images']))
        if 'category' in data:
            c = _s(data['category'], 100)
            item.category = c if c in ALLOWED_CATEGORIES else 'Viagem'
        if 'is_active'     in data: item.is_active     = bool(data['is_active'])
        if 'display_order' in data: item.display_order = _i(data['display_order'])
        if 'parent_id' in data:
            pid = data['parent_id']
            if pid in (None, '', 0):
                item.parent_id = None
            else:
                try:
                    pid = int(pid)
                    if pid == iid: return jsonify({'error': 'Item não pode ser pai de si mesmo'}), 400
                    parent = TravelItem.query.filter_by(id=pid, parent_id=None).first()
                    if not parent: return jsonify({'error': 'Item pai inválido'}), 400
                    item.parent_id = pid
                except: return jsonify({'error': 'parent_id inválido'}), 400

        db.session.commit()
        return jsonify(item.to_dict())
    except:
        db.session.rollback(); return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/items/<int:iid>', methods=['DELETE'])
@admin_required
def admin_delete_item(iid):
    try:
        item = TravelItem.query.get_or_404(iid)
        TravelItem.query.filter_by(parent_id=iid).update({'is_active': False, 'parent_id': None})
        db.session.delete(item); db.session.commit()
        return jsonify({'success': True})
    except:
        db.session.rollback(); return jsonify({'error': 'Erro interno'}), 500

# ─── Admin: Contributions ─────────────────────────────────────────────────────
@app.route('/api/admin/contributions')
@admin_required
def admin_get_contributions():
    try:
        return jsonify([c.to_dict() for c in
                        Contribution.query.order_by(Contribution.created_at.desc()).all()])
    except: return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/admin/contributions/<int:cid>/status', methods=['PUT'])
@admin_required
def admin_update_contrib(cid):
    try:
        c    = Contribution.query.get_or_404(cid)
        data = request.get_json(silent=True) or {}
        st   = _s(data.get('status',''), 20)
        if st not in VALID_STATUSES: return jsonify({'error': 'Status inválido'}), 400
        c.status = st; db.session.commit()
        return jsonify(c.to_dict())
    except:
        db.session.rollback(); return jsonify({'error': 'Erro interno'}), 500

# ─── Admin: Stats ─────────────────────────────────────────────────────────────
@app.route('/api/admin/stats')
@admin_required
def admin_stats():
    try:
        items        = TravelItem.query.filter_by(is_active=True).all()
        total_goal   = sum(i.goal_amount for i in items)
        total_raised = sum(i.raised_amount for i in items)
        confirmed    = float(db.session.query(
            db.func.coalesce(db.func.sum(Contribution.amount), 0)
        ).filter_by(status='confirmed').scalar())
        total_c = Contribution.query.filter(Contribution.status != 'cancelled').count()
        pct = round(total_raised/total_goal*100, 1) if total_goal else 0
        return jsonify({
            'total_goal':       round(total_goal, 2),
            'total_raised':     round(total_raised, 2),
            'confirmed_raised': round(confirmed, 2),
            'progress_pct':     pct,
            'total_contribs':   total_c,
            'items_stats': [{
                'id': i.id, 'name': i.name, 'parent_id': i.parent_id,
                'goal_amount': i.goal_amount, 'raised_amount': i.raised_amount,
                'progress_pct': i.progress_pct,
            } for i in items],
        })
    except: return jsonify({'error': 'Erro interno'}), 500

@app.route('/health')
def health():
    try:
        return jsonify({'status':'ok','db':'connected','items': TravelItem.query.count()})
    except:
        return jsonify({'status':'ok','db':'error'})

if __name__ == '__main__':
    app.run(debug=False, port=5000)
