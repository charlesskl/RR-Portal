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

    # 部分唯一索引:仅当 code 非空 *且未归档* 时才强制 (brand, code) 唯一。
    # - code='' 允许多条共存(OCR 自动新建的待填色粉)
    # - 已归档(软删)色粉不占用编号:它对入/出库匹配、下拉等所有在用逻辑都不可见,
    #   归档后应能把同一编号重新启用。
    __table_args__ = (
        Index("uq_brand_code", "brand", "code",
              unique=True,
              sqlite_where=_sa_text("code != '' AND is_archived = 0")),
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


class Setting(db.Model):
    """简单 key-value 配置表;目前只放汇率。"""
    __tablename__ = "setting"
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.String(255), nullable=False, default="")
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)


class PendingReview(db.Model):
    """待审核:入库未填色粉编号、出库找不到色粉或库存不足,都进这里等人工处理。
    quantity 单位跟随 type: in=kg, out=克, edit_in=kg (和表单输入一致,resolve 时再换算)。
    """
    __tablename__ = "pending_review"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(16), nullable=False)  # 'in' / 'out' / 'edit_in'
    pigment_code = db.Column(db.String(64), nullable=False, default="")
    purchase_code = db.Column(db.String(64), nullable=False, default="")
    name = db.Column(db.String(128), nullable=False, default="")
    quantity = db.Column(db.Float, nullable=False)
    unit_price = db.Column(db.Float, nullable=True)
    reason = db.Column(db.String(256), nullable=False)
    note = db.Column(db.Text, default="")
    # type='edit_in' 时,指向要改的原交易 id;其他 type 留空
    ref_tx_id = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

