def test_dashboard_200(client, db):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "仪表盘".encode("utf-8") in resp.data


from app.models import Pigment, Stock


def test_pigments_index_200(client, db):
    resp = client.get("/pigments/")
    assert resp.status_code == 200


def test_create_pigment(client, db):
    resp = client.post("/pigments/new", data={
        "code": "W001", "purchase_code": "P001",
        "quantity": "3", "unit_price": "12.50"
    }, follow_redirects=True)
    assert resp.status_code == 200
    p = Pigment.query.filter_by(code="W001").first()
    assert p is not None
    assert p.stock.quantity == 3
    assert p.unit_price == 12.50


def test_stock_in_via_route(client, db):
    p = Pigment(brand="B", code="1", name="x", hex="#000000",
                color_family="其他", spec_value=15, spec_unit="ml")
    p.stock = Stock(quantity=0)
    db.session.add(p); db.session.commit()
    resp = client.post("/transactions/in/new", data={
        "pigment_id": p.id, "quantity": "4", "note": ""
    }, follow_redirects=True)
    assert resp.status_code == 200
    assert p.stock.quantity == 4


def test_archive_pigment_with_transactions(client, db):
    p = Pigment(brand="A", code="1", name="x", hex="#000000",
                color_family="其他", spec_value=15, spec_unit="ml")
    p.stock = Stock(quantity=1)
    db.session.add(p); db.session.commit()
    from app.services.inventory import stock_out
    stock_out(p.id, 1)
    resp = client.post(f"/pigments/{p.id}/delete", follow_redirects=True)
    assert resp.status_code == 200
    assert Pigment.query.get(p.id).is_archived is True
