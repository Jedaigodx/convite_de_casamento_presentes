from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
import qrcode
import io
import base64
import hashlib
import hmac
from functools import wraps

app = Flask(__name__)

SECRET_KEY = os.environ.get('SECRET_KEY', 'tv-casamento-2026-secret-key')
app.secret_key = SECRET_KEY

# ─── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    DATABASE_URL = 'sqlite:///wedding.db'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_pre_ping': True,
    'pool_recycle': 300,
}

db = SQLAlchemy(app)

PIX_KEY  = os.environ.get('PIX_KEY',  'exemplo@pix.com')
PIX_NAME = os.environ.get('PIX_NAME', 'Thatianna e Vinicius')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'tv2026admin')

# ─── Token auth (sem session cookies) ────────────────────────────────────────
def make_token(password):
    return hmac.new(SECRET_KEY.encode(), password.encode(), hashlib.sha256).hexdigest()

ADMIN_TOKEN = make_token(ADMIN_PASSWORD)

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('X-Admin-Token', '')
        if token != ADMIN_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

# ─── Models ───────────────────────────────────────────────────────────────────
class GiftItem(db.Model):
    __tablename__ = 'gift_items'
    id              = db.Column(db.Integer, primary_key=True)
    name            = db.Column(db.String(200), nullable=False)
    description     = db.Column(db.Text)
    price           = db.Column(db.Float, nullable=False)
    image_url       = db.Column(db.String(500))
    max_quantity    = db.Column(db.Integer, default=1)
    chosen_quantity = db.Column(db.Integer, default=0)
    category        = db.Column(db.String(100), default='Geral')
    is_active       = db.Column(db.Boolean, default=True)
    is_monetary     = db.Column(db.Boolean, default=False)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def available_quantity(self):
        return self.max_quantity - self.chosen_quantity

    @property
    def is_available(self):
        return self.available_quantity > 0

    def to_dict(self):
        return {
            'id':                 self.id,
            'name':               self.name,
            'description':        self.description,
            'price':              self.price,
            'image_url':          self.image_url,
            'max_quantity':       self.max_quantity,
            'chosen_quantity':    self.chosen_quantity,
            'available_quantity': self.available_quantity,
            'is_available':       self.is_available,
            'category':           self.category,
            'is_active':          self.is_active,
            'is_monetary':        self.is_monetary,
        }


class GiftChoice(db.Model):
    __tablename__ = 'gift_choices'
    id              = db.Column(db.Integer, primary_key=True)
    gift_item_id    = db.Column(db.Integer, db.ForeignKey('gift_items.id'), nullable=False)
    giver_name      = db.Column(db.String(200), nullable=False)
    message         = db.Column(db.Text)
    delivery_method = db.Column(db.String(50), nullable=False)
    pix_amount      = db.Column(db.Float)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)
    status          = db.Column(db.String(50), default='pending')

    gift_item = db.relationship('GiftItem', backref='choices')

    def to_dict(self):
        return {
            'id':              self.id,
            'gift_item_id':    self.gift_item_id,
            'gift_name':       self.gift_item.name if self.gift_item else '',
            'gift_price':      self.gift_item.price if self.gift_item else 0,
            'giver_name':      self.giver_name,
            'message':         self.message,
            'delivery_method': self.delivery_method,
            'pix_amount':      self.pix_amount,
            'created_at':      self.created_at.strftime('%d/%m/%Y %H:%M'),
            'status':          self.status,
        }

# ─── Auto-init DB ─────────────────────────────────────────────────────────────
with app.app_context():
    try:
        db.create_all()
        print("Database tables ready")
    except Exception as e:
        print(f"DB init error: {e}")

# ─── Pages ────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

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
    token = request.headers.get('X-Admin-Token', '')
    return jsonify({'logged_in': token == ADMIN_TOKEN})

# ─── Public: Gifts ────────────────────────────────────────────────────────────
@app.route('/api/gifts', methods=['GET'])
def get_gifts():
    try:
        items = GiftItem.query.filter_by(is_active=True)\
                              .order_by(GiftItem.is_monetary, GiftItem.name).all()
        return jsonify([i.to_dict() for i in items])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/gifts/<int:item_id>', methods=['GET'])
def get_gift(item_id):
    item = GiftItem.query.get_or_404(item_id)
    return jsonify(item.to_dict())

# ─── Public: Choose Gift ──────────────────────────────────────────────────────
@app.route('/api/choose', methods=['POST'])
def choose_gift():
    try:
        data            = request.get_json()
        item_id         = data.get('gift_item_id')
        giver_name      = data.get('giver_name', '').strip()
        message         = data.get('message', '').strip()
        delivery_method = data.get('delivery_method')
        pix_amount      = data.get('pix_amount')

        if not giver_name:
            return jsonify({'error': 'Nome é obrigatório'}), 400
        if not delivery_method:
            return jsonify({'error': 'Método de entrega é obrigatório'}), 400

        item = GiftItem.query.get_or_404(item_id)
        if not item.is_monetary and not item.is_available:
            return jsonify({'error': 'Este item não está mais disponível'}), 400

        choice = GiftChoice(
            gift_item_id    = item_id,
            giver_name      = giver_name,
            message         = message,
            delivery_method = delivery_method,
            pix_amount      = pix_amount or item.price,
        )
        db.session.add(choice)
        if not item.is_monetary:
            item.chosen_quantity += 1
        db.session.commit()

        return jsonify({
            'success':   True,
            'choice_id': choice.id,
            'pix_key':   PIX_KEY if delivery_method == 'pix' else None,
            'pix_name':  PIX_NAME,
            'amount':    choice.pix_amount,
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
        amount_str = f"{amount:.2f}"
        payload_no_crc = (
            pix_field(0,  "01") +
            pix_field(1,  "12") +
            pix_field(26, merchant_account) +
            pix_field(52, "0000") +
            pix_field(53, "986") +
            pix_field(54, amount_str) +
            pix_field(58, "BR") +
            pix_field(59, PIX_NAME[:25]) +
            pix_field(60, "SAO PAULO") +
            pix_field(62, pix_field(5, "***")) +
            "6304"
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

# ─── Admin: Gift Items ────────────────────────────────────────────────────────
@app.route('/api/admin/gifts', methods=['GET'])
@admin_required
def admin_get_gifts():
    try:
        items = GiftItem.query.order_by(GiftItem.created_at.desc()).all()
        return jsonify([i.to_dict() for i in items])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/gifts', methods=['POST'])
@admin_required
def admin_create_gift():
    try:
        data = request.get_json()
        item = GiftItem(
            name         = data['name'],
            description  = data.get('description', ''),
            price        = float(data['price']),
            image_url    = data.get('image_url', ''),
            max_quantity = int(data.get('max_quantity', 1)),
            category     = data.get('category', 'Geral'),
            is_monetary  = data.get('is_monetary', False),
            is_active    = data.get('is_active', True),
        )
        db.session.add(item)
        db.session.commit()
        return jsonify(item.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/gifts/<int:item_id>', methods=['PUT'])
@admin_required
def admin_update_gift(item_id):
    try:
        item = GiftItem.query.get_or_404(item_id)
        data = request.get_json()
        for field in ['name','description','price','image_url','max_quantity','category','is_active','is_monetary']:
            if field in data:
                setattr(item, field, data[field])
        db.session.commit()
        return jsonify(item.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/gifts/<int:item_id>', methods=['DELETE'])
@admin_required
def admin_delete_gift(item_id):
    try:
        item = GiftItem.query.get_or_404(item_id)
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ─── Admin: Choices ───────────────────────────────────────────────────────────
@app.route('/api/admin/choices', methods=['GET'])
@admin_required
def admin_get_choices():
    try:
        choices = GiftChoice.query.order_by(GiftChoice.created_at.desc()).all()
        return jsonify([c.to_dict() for c in choices])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/choices/<int:choice_id>/status', methods=['PUT'])
@admin_required
def admin_update_choice_status(choice_id):
    try:
        choice = GiftChoice.query.get_or_404(choice_id)
        data   = request.get_json()
        choice.status = data.get('status', choice.status)
        db.session.commit()
        return jsonify(choice.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ─── Admin: Stats ─────────────────────────────────────────────────────────────
@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def admin_stats():
    try:
        total_choices = GiftChoice.query.count()
        confirmed     = GiftChoice.query.filter_by(status='confirmed').count()
        pix_choices   = GiftChoice.query.filter_by(delivery_method='pix').all()
        total_pix     = sum(c.pix_amount or 0 for c in pix_choices)
        confirmed_pix = sum(c.pix_amount or 0 for c in pix_choices if c.status == 'confirmed')
        chosen_items  = db.session.query(db.func.sum(GiftItem.chosen_quantity)).scalar() or 0
        return jsonify({
            'total_choices':      total_choices,
            'confirmed_choices':  confirmed,
            'total_pix_expected': round(total_pix, 2),
            'confirmed_pix':      round(confirmed_pix, 2),
            'chosen_items':       int(chosen_items),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
