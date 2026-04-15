from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date
from decimal import Decimal

db = SQLAlchemy()

class Supplier(db.Model):
    __tablename__ = 'suppliers'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), unique=True, nullable=False)
    short_name = db.Column(db.String(50))
    contact = db.Column(db.String(50))
    tel = db.Column(db.String(50))
    fax = db.Column(db.String(50))
    address = db.Column(db.String(300))
    orders = db.relationship('PurchaseOrder', backref='supplier', lazy='dynamic')

class PurchaseOrder(db.Model):
    __tablename__ = 'purchase_orders'
    id = db.Column(db.Integer, primary_key=True)
    po_no = db.Column(db.String(50), unique=True, nullable=False)
    po_date = db.Column(db.Date)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'))
    delivery_date = db.Column(db.Date)
    receiver = db.Column(db.String(50))
    total_amount = db.Column(db.Numeric(12, 2), default=0)
    pdf_filename = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.now)
    items = db.relationship('PurchaseItem', backref='order', lazy='dynamic', cascade='all, delete-orphan')

class PurchaseItem(db.Model):
    __tablename__ = 'purchase_items'
    id = db.Column(db.Integer, primary_key=True)
    purchase_order_id = db.Column(db.Integer, db.ForeignKey('purchase_orders.id'), nullable=False)
    material_code = db.Column(db.String(50))
    product_code = db.Column(db.String(50))
    product_name = db.Column(db.String(200))
    specification = db.Column(db.String(200))
    quantity = db.Column(db.Integer, default=0)
    unit = db.Column(db.String(20), default='PCS')
    unit_price = db.Column(db.Numeric(10, 4), default=0)
    amount = db.Column(db.Numeric(12, 2), default=0)
    remarks = db.Column(db.String(200))
    deliveries = db.relationship('DeliveryRecord', backref='purchase_item', lazy='dynamic', cascade='all, delete-orphan')

class DeliveryNote(db.Model):
    """交货单（供应商送货单）"""
    __tablename__ = 'delivery_notes'
    id = db.Column(db.Integer, primary_key=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'))
    delivery_no = db.Column(db.String(50))
    delivery_date = db.Column(db.Date)
    total_amount = db.Column(db.Numeric(12, 2), default=0)
    created_at = db.Column(db.DateTime, default=datetime.now)
    supplier = db.relationship('Supplier', backref=db.backref('delivery_notes', lazy='dynamic'))
    items = db.relationship('DeliveryNoteItem', backref='note', lazy='dynamic', cascade='all, delete-orphan')

class DeliveryNoteItem(db.Model):
    """交货明细"""
    __tablename__ = 'delivery_note_items'
    id = db.Column(db.Integer, primary_key=True)
    delivery_note_id = db.Column(db.Integer, db.ForeignKey('delivery_notes.id'), nullable=False)
    po_no = db.Column(db.String(50))
    product_code = db.Column(db.String(50))
    product_name = db.Column(db.String(200))
    quantity = db.Column(db.Numeric(10, 2), default=0)
    unit = db.Column(db.String(20), default='PCS')
    unit_price = db.Column(db.Numeric(10, 4), default=0)
    amount = db.Column(db.Numeric(12, 2), default=0)
    remarks = db.Column(db.String(200))

class DeliveryRecord(db.Model):
    __tablename__ = 'delivery_records'
    id = db.Column(db.Integer, primary_key=True)
    purchase_item_id = db.Column(db.Integer, db.ForeignKey('purchase_items.id'), nullable=False)
    delivery_date = db.Column(db.Date)
    delivered_quantity = db.Column(db.Integer, default=0)
    remarks = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.now)


class MatchProblem(db.Model):
    """匹配问题记录 — imported from upstream"""
    __tablename__ = 'match_problems'
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50))          # po_missing / product_missing
    po_no = db.Column(db.String(50))
    product_name = db.Column(db.String(200))
    quantity = db.Column(db.String(50))
    supplier = db.Column(db.String(100))
    delivery_no = db.Column(db.String(50))
    delivery_date = db.Column(db.String(50))
    status = db.Column(db.String(20), default='unresolved')  # unresolved / resolved
    resolved_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.now)
