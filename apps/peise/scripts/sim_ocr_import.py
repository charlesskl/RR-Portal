"""
模拟 OCR 识别送货单 → 按新逻辑入库的端到端演示。

跳过真正的 LLM 调用,直接构造"OCR 识别后的 rows",
驱动 /transactions/in/ocr/submit 这个真实的 Flask 路由,
打印前后 DB 状态对比。

用独立临时 SQLite,不影响 instance/peise.db。

运行: python scripts/sim_ocr_import.py
"""
import os
import sys
import tempfile

# peise 根目录加到 sys.path,让 `from app import ...` 能找到
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

# Windows 控制台中文不乱码
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from werkzeug.datastructures import MultiDict

os.environ.setdefault("OPENROUTER_API_KEY", "fake-not-called-in-this-script")

# 用一个临时 sqlite 文件,不碰本地开发 DB
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
TMP_DB = _tmp.name

from app.config import Config


class DemoConfig(Config):
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{TMP_DB}"
    SECRET_KEY = "demo"


from app import create_app
from app.extensions import db
from app.models import Pigment, Stock, Transaction
from app.services.inventory import stock_in

app = create_app(DemoConfig)


def dump_pigments(label: str):
    print(f"\n========== {label} ==========")
    print(f"{'brand':<8}{'code':<10}{'purchase':<10}{'qty':>8}{'price':>8}  notes")
    print("-" * 70)
    for p in Pigment.query.order_by(Pigment.brand, Pigment.code).all():
        qty = p.stock.quantity if p.stock else 0
        notes = (p.notes or "")[:25]
        print(f"{p.brand:<8}{p.code:<10}{p.purchase_code:<10}{qty:>8.2f}{p.unit_price:>8.2f}  {notes}")


def dump_transactions():
    print(f"\n---------- 流水(按 id 顺序) ----------")
    for tx in Transaction.query.order_by(Transaction.id).all():
        p = Pigment.query.get(tx.pigment_id)
        code = f"{p.brand}/{p.code}" if p else "?"
        price = tx.unit_price if tx.unit_price else 0
        print(f"  #{tx.id} [{tx.type}] → {code:<16} qty={tx.quantity:>6} price={price:>6}  note='{tx.note}'")


with app.app_context():
    # ==== Step 1: seed 3 个"正规"色粉 + 每个初始入库 10kg ====
    print("\n【Step 1】seed 3 个正规色粉,各入库 10kg")
    for d in [
        dict(code="P001", name="红色粉", purchase_code="S001", unit_price=50.0),
        dict(code="P002", name="蓝色粉", purchase_code="S002", unit_price=80.0),
        dict(code="P003", name="绿色粉", purchase_code="",     unit_price=30.0),
    ]:
        p = Pigment(brand="", spec_unit="kg", **d)
        db.session.add(p)
    db.session.commit()
    for p in Pigment.query.all():
        stock_in(p.id, 10.0, unit_price=p.unit_price, note="初始化")

    dump_pigments("初始状态(每种 10kg)")

with app.test_client() as client:
    # ==== Step 2: 模拟 OCR 识别出的 4 行,POST 到 /transactions/in/ocr/submit ====
    print("\n\n【Step 2】模拟 OCR 识别一张送货单,共 4 行明细:")
    print("  行1: OCR 已匹配到 P001 (pigment_id 提前填好)       → 应累加到 P001")
    print("  行2: OCR 没匹上; new_code 留空; purchase_code=S002 (对上 P002 的进货编号)")
    print("       → 新逻辑: 按 purchase_code 二次匹配 → 累加到 P002,不新建")
    print("  行3: OCR 没匹上; new_code 留空; purchase_code=S999 (查不到)")
    print("       → 新逻辑: 用 purchase_code 作 code, 新建 未分类/S999 待复核")
    print("  行4: OCR 没匹上; new_code=P001 手填")
    print("       → 新逻辑: 查到已有 P001, 累加(跨品牌匹配)")

    with app.app_context():
        p001 = Pigment.query.filter_by(brand="", code="P001").first()
        p001_id = p001.id

    form = MultiDict([
        # 行1
        ("pigment_id[]", str(p001_id)),
        ("purchase_code[]", "S001"),
        ("new_code[]", ""),
        ("quantity[]", "5"),
        ("unit_price[]", "50"),
        # 行2
        ("pigment_id[]", ""),
        ("purchase_code[]", "S002"),
        ("new_code[]", ""),
        ("quantity[]", "3"),
        ("unit_price[]", "80"),
        # 行3
        ("pigment_id[]", ""),
        ("purchase_code[]", "S999"),
        ("new_code[]", ""),
        ("quantity[]", "7"),
        ("unit_price[]", "100"),
        # 行4
        ("pigment_id[]", ""),
        ("purchase_code[]", ""),
        ("new_code[]", "P001"),
        ("quantity[]", "2"),
        ("unit_price[]", "50"),
    ])
    resp = client.post("/transactions/in/ocr/submit", data=form, follow_redirects=False)
    print(f"\n提交结果: HTTP {resp.status_code} (302=成功重定向)")

with app.app_context():
    dump_pigments("OCR 提交后")
    dump_transactions()

    print("\n\n【Step 3】预期校验")
    p001 = Pigment.query.filter_by(brand="", code="P001").first()
    p002 = Pigment.query.filter_by(brand="", code="P002").first()
    p003 = Pigment.query.filter_by(brand="", code="P003").first()
    s999 = Pigment.query.filter_by(brand="未分类", code="S999").first()

    checks = [
        ("P001 库存 = 10 + 5(行1) + 2(行4) = 17", p001.stock.quantity, 17.0),
        ("P002 库存 = 10 + 3(行2 purchase_code 二次匹配) = 13", p002.stock.quantity, 13.0),
        ("P003 库存 = 10 (没被碰)", p003.stock.quantity, 10.0),
        ("S999 是否新建了 未分类 待复核条目", s999 is not None, True),
        ("S999 库存 = 7 (行3 新建+入库)", s999.stock.quantity if s999 else None, 7.0),
        ("S999 的 notes 标注待复核", (s999.notes if s999 else "") == "OCR 自动新建,待复核", True),
    ]
    all_ok = True
    for desc, actual, expected in checks:
        ok = actual == expected
        all_ok = all_ok and ok
        mark = "✅" if ok else "❌"
        print(f"  {mark} {desc}: actual={actual}, expected={expected}")

    print(f"\n{'🎉 全部通过' if all_ok else '⚠️ 有失败,检查上面'}")

# 清理临时 DB
try:
    os.unlink(TMP_DB)
except OSError:
    pass
