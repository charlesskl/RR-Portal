from datetime import datetime
from app.extensions import db
from app.models import Pigment, Stock, Transaction

class InsufficientStock(Exception):
    pass

def _ensure_stock(pigment_id: int) -> Stock:
    stock = Stock.query.get(pigment_id)
    if stock is None:
        stock = Stock(pigment_id=pigment_id, quantity=0)
        db.session.add(stock)
    return stock

def stock_in(pigment_id: int, quantity: float, unit_price: float | None = None,
             note: str = "", occurred_at: datetime | None = None) -> Transaction:
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    try:
        stock = _ensure_stock(pigment_id)
        stock.quantity += quantity
        tx = Transaction(pigment_id=pigment_id, type="in", quantity=quantity,
                         unit_price=unit_price, note=note,
                         occurred_at=occurred_at or datetime.now())
        db.session.add(tx)
        db.session.commit()
        return tx
    except Exception:
        db.session.rollback()
        raise

def stock_out(pigment_id: int, quantity: float, note: str = "",
              occurred_at: datetime | None = None,
              allow_negative: bool = False) -> Transaction:
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    try:
        stock = _ensure_stock(pigment_id)
        if not allow_negative and stock.quantity < quantity:
            raise InsufficientStock(f"库存不足:当前 {stock.quantity},需要 {quantity}")
        stock.quantity -= quantity
        tx = Transaction(pigment_id=pigment_id, type="out", quantity=quantity,
                         note=note, occurred_at=occurred_at or datetime.now())
        db.session.add(tx)
        db.session.commit()
        return tx
    except Exception:
        db.session.rollback()
        raise

def stock_adjust(pigment_id: int, target_quantity: float, note: str = "",
                 occurred_at: datetime | None = None) -> Transaction:
    if target_quantity < 0:
        raise ValueError("target_quantity must be >= 0")
    try:
        stock = _ensure_stock(pigment_id)
        delta = target_quantity - stock.quantity
        direction = "+" if delta >= 0 else "-"
        stock.quantity = target_quantity
        tx = Transaction(pigment_id=pigment_id, type="adjust",
                         quantity=abs(delta),
                         note=f"{direction}{abs(delta)} {note}".strip(),
                         occurred_at=occurred_at or datetime.now())
        db.session.add(tx)
        db.session.commit()
        return tx
    except Exception:
        db.session.rollback()
        raise
