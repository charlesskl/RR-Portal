from app.models import Pigment, Stock

def test_create_pigment_with_stock(db):
    p = Pigment(brand="Holbein", code="W001", name="钛白", hex="#ffffff",
                color_family="中性", spec_value=15, spec_unit="ml", min_stock=2)
    p.stock = Stock(quantity=5)
    db.session.add(p)
    db.session.commit()
    assert p.id is not None
    assert p.stock.quantity == 5
