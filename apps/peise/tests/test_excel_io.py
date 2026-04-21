import io
import pandas as pd
from app.models import Pigment, Stock
from app.services.excel_io import export_pigments_to_bytes, import_pigments_from_bytes


def test_export_contains_new_columns(db):
    p = Pigment(brand="", code="X1", name="X1", hex="#ffffff",
                color_family="其他", spec_value=0, spec_unit="kg",
                purchase_code="P1", unit_price=5.0)
    p.stock = Stock(quantity=3)
    db.session.add(p); db.session.commit()
    data = export_pigments_to_bytes()
    df = pd.read_excel(io.BytesIO(data))
    assert set(["色粉编号", "进货色粉编号", "数量", "单价", "单位", "金额"]).issubset(df.columns)
    assert df.iloc[0]["数量"] == 3
    assert df.iloc[0]["金额"] == 15.0


def _make_xlsx(rows):
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


def test_import_upsert(db):
    existing = Pigment(brand="", code="X1", name="X1", hex="#000000",
                       color_family="其他", spec_value=0, spec_unit="kg")
    db.session.add(existing); db.session.commit()
    data = _make_xlsx([
        {"色粉编号": "X1", "进货色粉编号": "P1", "数量": 5, "单价": 10},
        {"色粉编号": "X2", "进货色粉编号": "P2", "数量": 2, "单价": 3},
    ])
    report = import_pigments_from_bytes(data)
    assert report["created"] == 1
    assert report["updated"] == 1
    x1 = Pigment.query.filter_by(code="X1").first()
    assert x1.stock.quantity == 5
    assert x1.unit_price == 10


def test_import_archives_missing_and_handles_blank(db):
    a = Pigment(brand="", code="A1", name="A1", hex="#000000",
                color_family="其他", spec_value=0, spec_unit="kg")
    b = Pigment(brand="", code="B1", name="B1", hex="#000000",
                color_family="其他", spec_value=0, spec_unit="kg")
    a.stock = Stock(quantity=0); b.stock = Stock(quantity=0)
    db.session.add_all([a, b]); db.session.commit()
    # Excel 只有 A1, 进货色粉编号/备注 留空
    data = _make_xlsx([
        {"色粉编号": "A1", "进货色粉编号": None, "数量": 7, "单价": 4, "备注": None},
    ])
    report = import_pigments_from_bytes(data)
    assert report["archived"] == 1
    a1 = Pigment.query.filter_by(code="A1").first()
    assert a1.purchase_code == ""  # 不再写 "nan"
    assert a1.notes == ""
    assert Pigment.query.filter_by(code="B1").first().is_archived is True
