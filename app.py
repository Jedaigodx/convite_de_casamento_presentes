from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os, io, base64, hashlib, hmac, uuid
from functools import wraps
import qrcode
from PIL import Image

app = Flask(__name__)

SECRET_KEY     = os.environ.get('SECRET_KEY', 'tv-casamento-2026-secret-key')
app.secret_key = SECRET_KEY

# ─── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    DATABASE_URL = 'sqlite:///wedding.db'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI']    = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS']  = {'pool_pre_ping': True, 'pool_recycle': 300}
app.config['MAX_CONTENT_LENGTH']         = 8 * 1024 * 1024   # 8 MB

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

db = SQLAlchemy(app)

PIX_KEY        = os.environ.get('PIX_KEY',        'exemplo@pix.com')
PIX_NAME       = os.environ.get('PIX_NAME',       'Thatianna e Vinicius')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'tv2026admin')

# ─── Token auth ───────────────────────────────────────────────────────────────
ADMIN_TOKEN = hmac.new(SECRET_KEY.encode(), ADMIN_PASSWORD.encode(), hashlib.sha256).hexdigest()

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.headers.get('X-Admin-Token', '') != ADMIN_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

# ─── Models ───────────────────────────────────────────────────────────────────
class TravelItem(db.Model):
    __tablename__ = 'travel_items'
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(200), nullable=False)
    description   = db.Column(db.Text)
    goal_amount   = db.Column(db.Float, nullable=False)          # meta total R$
    image_url     = db.Column(db.String(500))
    category      = db.Column(db.String(100), default='Viagem')
    is_active     = db.Column(db.Boolean, default=True)
    display_order = db.Column(db.Integer, default=0)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def raised_amount(self):
        return sum(c.amount for c in self.contributions if c.status != 'cancelled')

    @property
    def progress_pct(self):
        if self.goal_amount <= 0:
            return 100
        return min(100, round(self.raised_amount / self.goal_amount * 100, 1))

    @property
    def is_complete(self):
        return self.raised_amount >= self.goal_amount

    def to_dict(self):
        return {
            'id':           self.id,
            'name':         self.name,
            'description':  self.description,
            'goal_amount':  self.goal_amount,
            'raised_amount': self.raised_amount,
            'progress_pct': self.progress_pct,
            'is_complete':  self.is_complete,
            'image_url':    self.image_url,
            'category':     self.category,
            'is_active':    self.is_active,
            'display_order': self.display_order,
        }


class Contribution(db.Model):
    __tablename__ = 'contributions'
    id             = db.Column(db.Integer, primary_key=True)
    travel_item_id = db.Column(db.Integer, db.ForeignKey('travel_items.id'), nullable=False)
    giver_name     = db.Column(db.String(200), nullable=False)
    message        = db.Column(db.Text)
    amount         = db.Column(db.Float, nullable=False)
    status         = db.Column(db.String(50), default='pending')   # pending | confirmed | cancelled
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
        print(f"DB error: {e}")

# ─── Pages ────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# ─── Auth ─────────────────────────────────────────────────────────────────────
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    try:
        data = request.get_json()
        if data.get('password') == ADMIN_PASSWORD:
            return jsonify({'success': True, 'token': ADMIN_TOKEN})
        return jsonify({'error': 'Senha incorreta'}), 401
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/check', methods=['GET'])
def admin_check():
    return jsonify({'logged_in': request.headers.get('X-Admin-Token', '') == ADMIN_TOKEN})

# ─── Image Upload ─────────────────────────────────────────────────────────────
@app.route('/api/admin/upload', methods=['POST'])
@admin_required
def upload_image():
    try:
        file = request.files.get('image')
        if not file:
            return jsonify({'error': 'Nenhuma imagem enviada'}), 400

        allowed = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}
        if file.content_type not in allowed:
            return jsonify({'error': 'Formato não suportado. Use JPG, PNG ou WebP'}), 400

        # Resize & compress
        img = Image.open(file.stream)
        img = img.convert('RGB')

        # Crop to 4:3 centered
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

        filename = f"{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        img.save(filepath, 'JPEG', quality=85, optimize=True)

        return jsonify({'url': f'/static/uploads/{filename}'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── Public: Travel Items ─────────────────────────────────────────────────────
@app.route('/api/items', methods=['GET'])
def get_items():
    try:
        items = TravelItem.query.filter_by(is_active=True)\
                                .order_by(TravelItem.display_order, TravelItem.id).all()
        return jsonify([i.to_dict() for i in items])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── Public: Contribute ───────────────────────────────────────────────────────
@app.route('/api/contribute', methods=['POST'])
def contribute():
    try:
        data           = request.get_json()
        item_id        = data.get('travel_item_id')
        giver_name     = data.get('giver_name', '').strip()
        message        = data.get('message', '').strip()
        amount         = float(data.get('amount', 0))

        if not giver_name:
            return jsonify({'error': 'Nome é obrigatório'}), 400
        if amount < 1:
            return jsonify({'error': 'Valor mínimo é R$ 1,00'}), 400

        item = TravelItem.query.get_or_404(item_id)

        contribution = Contribution(
            travel_item_id = item_id,
            giver_name     = giver_name,
            message        = message,
            amount         = amount,
        )
        db.session.add(contribution)
        db.session.commit()

        return jsonify({
            'success':        True,
            'contribution_id': contribution.id,
            'pix_key':        PIX_KEY,
            'pix_name':       PIX_NAME,
            'amount':         amount,
            'item_name':      item.name,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ─── Pix QR Code ─────────────────────────────────────────────────────────────
@app.route('/api/pix-qrcode', methods=['POST'])
def generate_pix_qrcode():
    try:
        data   = request.get_json()
        amount = float(data.get('amount', 0))

        def pix_field(id, value):
            return f"{id:02d}{len(value):02d}{value}"

        merchant_account = pix_field(0, "BR.GOV.BCB.PIX") + pix_field(1, PIX_KEY)
        amount_str       = f"{amount:.2f}"
        payload_no_crc   = (
            pix_field(0,  "01") + pix_field(1, "12") +
            pix_field(26, merchant_account) +
            pix_field(52, "0000") + pix_field(53, "986") +
            pix_field(54, amount_str) + pix_field(58, "BR") +
            pix_field(59, PIX_NAME[:25]) + pix_field(60, "SAO PAULO") +
            pix_field(62, pix_field(5, "***")) + "6304"
        )

        def crc16(data):
            crc = 0xFFFF
            for byte in data.encode('utf-8'):
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
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── Admin: Items ─────────────────────────────────────────────────────────────
@app.route('/api/admin/items', methods=['GET'])
@admin_required
def admin_get_items():
    try:
        items = TravelItem.query.order_by(TravelItem.display_order, TravelItem.id).all()
        return jsonify([i.to_dict() for i in items])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/items', methods=['POST'])
@admin_required
def admin_create_item():
    try:
        data = request.get_json()
        item = TravelItem(
            name          = data['name'],
            description   = data.get('description', ''),
            goal_amount   = float(data['goal_amount']),
            image_url     = data.get('image_url', ''),
            category      = data.get('category', 'Viagem'),
            is_active     = data.get('is_active', True),
            display_order = int(data.get('display_order', 0)),
        )
        db.session.add(item)
        db.session.commit()
        return jsonify(item.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/items/<int:item_id>', methods=['PUT'])
@admin_required
def admin_update_item(item_id):
    try:
        item = TravelItem.query.get_or_404(item_id)
        data = request.get_json()
        for field in ['name','description','goal_amount','image_url','category','is_active','display_order']:
            if field in data:
                setattr(item, field, data[field])
        db.session.commit()
        return jsonify(item.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/items/<int:item_id>', methods=['DELETE'])
@admin_required
def admin_delete_item(item_id):
    try:
        item = TravelItem.query.get_or_404(item_id)
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ─── Admin: Contributions ─────────────────────────────────────────────────────
@app.route('/api/admin/contributions', methods=['GET'])
@admin_required
def admin_get_contributions():
    try:
        contribs = Contribution.query.order_by(Contribution.created_at.desc()).all()
        return jsonify([c.to_dict() for c in contribs])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/contributions/<int:cid>/status', methods=['PUT'])
@admin_required
def admin_update_contrib_status(cid):
    try:
        c      = Contribution.query.get_or_404(cid)
        data   = request.get_json()
        c.status = data.get('status', c.status)
        db.session.commit()
        return jsonify(c.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ─── Admin: Stats ─────────────────────────────────────────────────────────────
@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def admin_stats():
    try:
        items      = TravelItem.query.filter_by(is_active=True).all()
        total_goal = sum(i.goal_amount for i in items)
        total_raised = sum(i.raised_amount for i in items)
        confirmed_raised = sum(
            c.amount for c in Contribution.query.filter_by(status='confirmed').all()
        )
        total_contribs    = Contribution.query.filter(Contribution.status != 'cancelled').count()
        confirmed_contribs = Contribution.query.filter_by(status='confirmed').count()
        progress_pct = round(total_raised / total_goal * 100, 1) if total_goal > 0 else 0

        items_stats = []
        for i in items:
            items_stats.append({
                'id':           i.id,
                'name':         i.name,
                'goal_amount':  i.goal_amount,
                'raised_amount': i.raised_amount,
                'progress_pct': i.progress_pct,
            })

        return jsonify({
            'total_goal':          round(total_goal, 2),
            'total_raised':        round(total_raised, 2),
            'confirmed_raised':    round(confirmed_raised, 2),
            'progress_pct':        progress_pct,
            'total_contribs':      total_contribs,
            'confirmed_contribs':  confirmed_contribs,
            'items_stats':         items_stats,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── Health ───────────────────────────────────────────────────────────────────
@app.route('/health')
def health():
    try:
        count = TravelItem.query.count()
        return jsonify({'status': 'ok', 'db': 'connected', 'items': count})
    except Exception as e:
        return jsonify({'status': 'ok', 'db': 'error', 'detail': str(e)})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
