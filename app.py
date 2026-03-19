from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
import qrcode
import qrcode.image.svg
import io
import base64
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'tv-casamento-2026-secret')

# Database
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/wedding_gifts')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# PIX info
PIX_KEY = os.environ.get('PIX_KEY', 'exemplo@pix.com')
PIX_NAME = os.environ.get('PIX_NAME', 'Thatianna e Vinicius')

ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'tv2026admin')

# ─── Models ───────────────────────────────────────────────────────────────────

class GiftItem(db.Model):
    __tablename__ = 'gift_items'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    price = db.Column(db.Float, nullable=False)
    image_url = db.Column(db.String(500))
    max_quantity = db.Column(db.Integer, default=1)
    chosen_quantity = db.Column(db.Integer, default=0)
    category = db.Column(db.String(100), default='Geral')
    is_active = db.Column(db.Boolean, default=True)
    is_monetary = db.Column(db.Boolean, default=False)  # for "contribuição livre"
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def available_quantity(self):
        return self.max_quantity - self.chosen_quantity

    @property
    def is_available(self):
        return self.available_quantity > 0

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'price': self.price,
            'image_url': self.image_url,
            'max_quantity': self.max_quantity,
            'chosen_quantity': self.chosen_quantity,
            'available_quantity': self.available_quantity,
            'is_available': self.is_available,
            'category': self.category,
            'is_active': self.is_active,
            'is_monetary': self.is_monetary,
        }


class GiftChoice(db.Model):
    __tablename__ = 'gift_choices'
    id = db.Column(db.Integer, primary_key=True)
    gift_item_id = db.Column(db.Integer, db.ForeignKey('gift_items.id'), nullable=False)
    giver_name = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text)
    delivery_method = db.Column(db.String(50), nullable=False)  # 'wedding' or 'pix'
    pix_amount = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(50), default='pending')  # pending, confirmed

    gift_item = db.relationship('GiftItem', backref='choices')

    def to_dict(self):
        return {
            'id': self.id,
            'gift_item_id': self.gift_item_id,
            'gift_name': self.gift_item.name if self.gift_item else '',
            'gift_price': self.gift_item.price if self.gift_item else 0,
            'giver_name': self.giver_name,
            'message': self.message,
            'delivery_method': self.delivery_method,
            'pix_amount': self.pix_amount,
            'created_at': self.created_at.strftime('%d/%m/%Y %H:%M'),
            'status': self.status,
        }


# ─── Auth ─────────────────────────────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin_logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


# ─── Public Routes ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/admin')
def admin():
    return render_template('admin.html')


# ─── API: Auth ─────────────────────────────────────────────────────────────────

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json()
    if data.get('password') == ADMIN_PASSWORD:
        session['admin_logged_in'] = True
        return jsonify({'success': True})
    return jsonify({'error': 'Senha incorreta'}), 401


@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('admin_logged_in', None)
    return jsonify({'success': True})


@app.route('/api/admin/check', methods=['GET'])
def admin_check():
    return jsonify({'logged_in': session.get('admin_logged_in', False)})


# ─── API: Gift Items (Public) ──────────────────────────────────────────────────

@app.route('/api/gifts', methods=['GET'])
def get_gifts():
    items = GiftItem.query.filter_by(is_active=True).order_by(GiftItem.is_monetary, GiftItem.name).all()
    return jsonify([i.to_dict() for i in items])


@app.route('/api/gifts/<int:item_id>', methods=['GET'])
def get_gift(item_id):
    item = GiftItem.query.get_or_404(item_id)
    return jsonify(item.to_dict())


# ─── API: Gift Choice (Public) ─────────────────────────────────────────────────

@app.route('/api/choose', methods=['POST'])
def choose_gift():
    data = request.get_json()
    item_id = data.get('gift_item_id')
    giver_name = data.get('giver_name', '').strip()
    message = data.get('message', '').strip()
    delivery_method = data.get('delivery_method')
    pix_amount = data.get('pix_amount')

    if not giver_name:
        return jsonify({'error': 'Nome é obrigatório'}), 400
    if not delivery_method:
        return jsonify({'error': 'Método de entrega é obrigatório'}), 400

    item = GiftItem.query.get_or_404(item_id)

    if not item.is_monetary and not item.is_available:
        return jsonify({'error': 'Este item não está mais disponível'}), 400

    choice = GiftChoice(
        gift_item_id=item_id,
        giver_name=giver_name,
        message=message,
        delivery_method=delivery_method,
        pix_amount=pix_amount or item.price,
    )
    db.session.add(choice)

    if not item.is_monetary:
        item.chosen_quantity += 1

    db.session.commit()

    return jsonify({
        'success': True,
        'choice_id': choice.id,
        'pix_key': PIX_KEY if delivery_method == 'pix' else None,
        'pix_name': PIX_NAME,
        'amount': choice.pix_amount,
    })


# ─── API: QR Code ─────────────────────────────────────────────────────────────

@app.route('/api/pix-qrcode', methods=['POST'])
def generate_pix_qrcode():
    data = request.get_json()
    amount = data.get('amount', 0)
    giver_name = data.get('giver_name', 'Convidado')

    # EMV Pix payload (simplified static QR with amount)
    def pix_field(id, value):
        return f"{id:02d}{len(value):02d}{value}"

    merchant_account = (
        pix_field(0, "BR.GOV.BCB.PIX") +
        pix_field(1, PIX_KEY)
    )

    amount_str = f"{float(amount):.2f}"

    payload_no_crc = (
        pix_field(0, "01") +
        pix_field(1, "12") +  # static
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

    # CRC16-CCITT
    def crc16(data):
        crc = 0xFFFF
        for byte in data.encode('utf-8'):
            crc ^= byte << 8
            for _ in range(8):
                if crc & 0x8000:
                    crc = (crc << 1) ^ 0x1021
                else:
                    crc <<= 1
                crc &= 0xFFFF
        return crc

    crc = crc16(payload_no_crc)
    payload = payload_no_crc + f"{crc:04X}"

    # Generate QR
    qr = qrcode.QRCode(version=1, box_size=6, border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#3d5a2b", back_color="white")

    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    img_b64 = base64.b64encode(buffer.read()).decode()

    return jsonify({
        'qrcode': f"data:image/png;base64,{img_b64}",
        'payload': payload,
        'amount': amount_str,
        'pix_key': PIX_KEY,
        'pix_name': PIX_NAME,
    })


# ─── API: Admin - Items ────────────────────────────────────────────────────────

@app.route('/api/admin/gifts', methods=['GET'])
@admin_required
def admin_get_gifts():
    items = GiftItem.query.order_by(GiftItem.created_at.desc()).all()
    return jsonify([i.to_dict() for i in items])


@app.route('/api/admin/gifts', methods=['POST'])
@admin_required
def admin_create_gift():
    data = request.get_json()
    item = GiftItem(
        name=data['name'],
        description=data.get('description', ''),
        price=float(data['price']),
        image_url=data.get('image_url', ''),
        max_quantity=int(data.get('max_quantity', 1)),
        category=data.get('category', 'Geral'),
        is_monetary=data.get('is_monetary', False),
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route('/api/admin/gifts/<int:item_id>', methods=['PUT'])
@admin_required
def admin_update_gift(item_id):
    item = GiftItem.query.get_or_404(item_id)
    data = request.get_json()
    for field in ['name', 'description', 'price', 'image_url', 'max_quantity', 'category', 'is_active', 'is_monetary']:
        if field in data:
            setattr(item, field, data[field])
    db.session.commit()
    return jsonify(item.to_dict())


@app.route('/api/admin/gifts/<int:item_id>', methods=['DELETE'])
@admin_required
def admin_delete_gift(item_id):
    item = GiftItem.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({'success': True})


# ─── API: Admin - Choices ──────────────────────────────────────────────────────

@app.route('/api/admin/choices', methods=['GET'])
@admin_required
def admin_get_choices():
    choices = GiftChoice.query.order_by(GiftChoice.created_at.desc()).all()
    return jsonify([c.to_dict() for c in choices])


@app.route('/api/admin/choices/<int:choice_id>/status', methods=['PUT'])
@admin_required
def admin_update_choice_status(choice_id):
    choice = GiftChoice.query.get_or_404(choice_id)
    data = request.get_json()
    choice.status = data.get('status', choice.status)
    db.session.commit()
    return jsonify(choice.to_dict())


@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def admin_stats():
    total_choices = GiftChoice.query.count()
    confirmed = GiftChoice.query.filter_by(status='confirmed').count()
    pix_choices = GiftChoice.query.filter_by(delivery_method='pix').all()
    total_pix = sum(c.pix_amount or 0 for c in pix_choices)
    confirmed_pix = sum(c.pix_amount or 0 for c in pix_choices if c.status == 'confirmed')
    total_items = GiftItem.query.filter_by(is_active=True, is_monetary=False).count()
    chosen_items = db.session.query(db.func.sum(GiftItem.chosen_quantity)).scalar() or 0

    return jsonify({
        'total_choices': total_choices,
        'confirmed_choices': confirmed,
        'total_pix_expected': round(total_pix, 2),
        'confirmed_pix': round(confirmed_pix, 2),
        'total_items': total_items,
        'chosen_items': int(chosen_items),
    })


# ─── DB Init ───────────────────────────────────────────────────────────────────

@app.route('/api/init-db', methods=['POST'])
def init_db_route():
    """Only for first setup - remove after use"""
    if os.environ.get('ALLOW_INIT_DB') != 'true':
        return jsonify({'error': 'Not allowed'}), 403
    db.create_all()
    # Seed sample items
    if GiftItem.query.count() == 0:
        samples = [
            GiftItem(name='Batedeira Planetária', description='KitchenAid ou similar, 5L', price=899.0, max_quantity=1, category='Cozinha', image_url='https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400'),
            GiftItem(name='Jogo de Panelas', description='Conjunto 5 peças antiaderente', price=450.0, max_quantity=1, category='Cozinha', image_url='https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400'),
            GiftItem(name='Jogo de Cama Queen', description='200 fios, 100% algodão', price=320.0, max_quantity=2, category='Quarto', image_url='https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400'),
            GiftItem(name='Liquidificador', description='Alta potência, 700W', price=280.0, max_quantity=1, category='Cozinha', image_url='https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=400'),
            GiftItem(name='Jogo de Toalhas', description='Kit 8 peças felpudo', price=190.0, max_quantity=2, category='Banheiro', image_url='https://images.unsplash.com/photo-1545579133-99bb5ad189be?w=400'),
            GiftItem(name='Contribuição Livre', description='Contribua com o valor que desejar para ajudar os noivos a realizarem seus sonhos', price=100.0, max_quantity=999, category='Contribuição', is_monetary=True, image_url='https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=400'),
        ]
        for s in samples:
            db.session.add(s)
        db.session.commit()
    return jsonify({'success': True, 'message': 'DB initialized with sample data'})


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
