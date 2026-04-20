import pytest
from app.models import Pigment, Stock
from app.services.inventory import stock_in, stock_out, stock_adjust, InsufficientStock

def make_pigment(db, qty=0):
    p = Pigment(brand="T", code="1", name="x", hex="#000000",
                color_family="其他", spec_value=15, spec_unit="ml", min_stock=1)
    p.stock = Stock(quantity=qty)
    db.session.add(p)
    db.session.commit()
    return p

def test_stock_in_increments(db):
    p = make_pigment(db, qty=2)
    stock_in(p.id, 3, note="采购")
    assert p.stock.quantity == 5
    assert len(p.transactions) == 1
    assert p.transactions[0].type == "in"

def test_stock_out_decrements(db):
    p = make_pigment(db, qty=5)
    stock_out(p.id, 2)
    assert p.stock.quantity == 3

def test_stock_out_insufficient_raises(db):
    p = make_pigment(db, qty=1)
    with pytest.raises(InsufficientStock):
        stock_out(p.id, 5)
    assert p.stock.quantity == 1

def test_stock_adjust_sets_absolute(db):
    p = make_pigment(db, qty=3)
    stock_adjust(p.id, 10)
    assert p.stock.quantity == 10
    tx = p.transactions[0]
    assert tx.type == "adjust"
    assert tx.quantity == 7
