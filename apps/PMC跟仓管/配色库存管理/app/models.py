from datetime import datetime
from sqlalchemy import Index, text as _sa_text
from .extensions import db

class Pigment(db.Model):
    __tablename__ = "pigment"
    id = db.Column(db.Integer, primary_key=True)
    brand = db.Column(db.String(64), nullable=False)
    code = db.Column(db.String(64), nullable=False, default="")
    name = db.Column(db.String(128), nullable=False)
    hex = db.Column(db.String(7), nullable=False, default="#000000")
    color_family = db.Column(db.String(32), nullable=False, default="其他")
    spec_value = db.Column(db.Float, nullable=False, default=0)
    spec_unit = db.Column(db.String(8), nullable=False, default="ml")
    min_stock = db.Column(db.Float, nullable=False, default=1)
    purchase_code = db.Column(db.String(64), nullable=False, default="")
    unit_price = db.Column(db.Float, nullable=False, default=0)
    notes = db.Column(db.Text, default="")
    is_archived = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

    stock = db.relationship("Stock", uselist=False, back_populates="pigment",
                            cascade="all, delete-orphan")
    transactions = db.relationship("Transaction", back_populates="pigment",
                                   cascade="all, delete-orphan")

    # 部分唯一索引:仅当 code 非空时才强制 (brand, code) 唯一,
    # 允许多条 OCR 自动新建的待填色粉(code='')共存。
    __table_args__ = (
        Index("uq_brand_code", "brand", "code",
              unique=True,
              sqlite_where=_sa_text("code != ''")),
    )

class Stock(db.Model):
    __tablename__ = "stock"
    pigment_id = db.Column(db.Integer, db.ForeignKey("pigment.id"), primary_key=True)
    quantity = db.Column(db.Float, nullable=False, default=0)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)
    pigment = db.relationship("Pigment", back_populates="stock")

class Transaction(db.Model):
    __tablename__ = "transaction"
    id = db.Column(db.Integer, primary_key=True)
    pigment_id = db.Column(db.Integer, db.ForeignKey("pigment.id"), nullable=False)
    type = db.Column(db.String(8), nullable=False)
    quantity = db.Column(db.Float, nullable=False)
    unit_price = db.Column(db.Float, nullable=True)
    occurred_at = db.Column(db.DateTime, default=datetime.now)
    note = db.Column(db.Text, default="")
    pigment = db.relationship("Pigment", back_populates="transactions")

