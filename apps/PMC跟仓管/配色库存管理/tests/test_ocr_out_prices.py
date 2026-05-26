from app.models import Pigment
from app.routes.transactions import _attach_archive_prices


def test_attach_archive_prices_maps_pigment_id_to_archive_price(db):
    """出库 OCR 行按 pigment_id 带出颜料档案单价;未匹到的行单价为 0。"""
    p = Pigment(brand="B", code="33A", name="x", hex="#000000",
                color_family="其他", spec_value=15, spec_unit="ml", unit_price=80.0)
    db.session.add(p)
    db.session.commit()

    rows = [
        {"pigment_id": p.id, "quantity": 100},
        {"pigment_id": None, "quantity": 50},
    ]
    _attach_archive_prices(rows)

    assert rows[0]["unit_price"] == 80.0
    assert rows[1]["unit_price"] == 0
