"""全功能回归测试 - 通过 HTTP 打真实 flask 进程。

使用:
    python tests/test_full_regression.py
"""
from __future__ import annotations

import requests
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from app import create_app
from app.extensions import db
from app.models import Pigment, Stock, Transaction, PendingReview, Setting


BASE = "http://127.0.0.1:5000"
PASS, FAIL = 0, 0
_app = create_app()


def assert_eq(label, got, expected, tol=0.05):
    global PASS, FAIL
    ok = (abs(got - expected) < tol) if isinstance(got, (int, float)) else (got == expected)
    if ok:
        PASS += 1
        print(f"  ✅ {label}: {got}")
    else:
        FAIL += 1
        print(f"  ❌ {label}: 得到 {got!r}, 期望 {expected!r}")


def stock_of(code):
    with _app.app_context():
        p = Pigment.query.filter_by(code=code).first()
        if not p:
            return None
        s = Stock.query.get(p.id)
        return s.quantity if s else 0


def pigment_id(code):
    with _app.app_context():
        p = Pigment.query.filter_by(code=code).first()
        return p.id if p else None


def pending_count():
    with _app.app_context():
        return PendingReview.query.count()


def login():
    s = requests.Session()
    s.post(f"{BASE}/login", data={"username": "ps", "password": "ps123456"},
           allow_redirects=False)
    return s


def cleanup(code):
    with _app.app_context():
        p = Pigment.query.filter_by(code=code).first()
        if p:
            Transaction.query.filter_by(pigment_id=p.id).delete(synchronize_session=False)
            Stock.query.get(p.id).quantity = 0.0
        PendingReview.query.delete()
        db.session.commit()


# ============================================================

sess = login()
TEST_CODE = "105"
pid = pigment_id(TEST_CODE)
assert pid, "需要 105 色粉存在"

print("=" * 60)
print("开始全功能回归测试")
print("=" * 60)

# ---------- 1. 登录 ----------
print("\n[1] 登录验证")
r = requests.get(f"{BASE}/transactions/in", allow_redirects=False)
assert_eq("未登录 /in 跳 /login", r.status_code, 302)
r = sess.get(f"{BASE}/transactions/in", allow_redirects=False)
assert_eq("已登录 /in 访问成功", r.status_code, 200)

# ---------- 2. 手动入库 RMB→HKD ----------
print("\n[2] 手动入库 RMB 100 → 应存 HKD 113.64,库存 +1kg")
cleanup(TEST_CODE)
r = sess.post(f"{BASE}/transactions/in/new", data={
    "pigment_id": str(pid), "quantity": "1", "unit_price": "100",
    "note": "REG-in-new"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq(f"{TEST_CODE} 库存", stock_of(TEST_CODE), 1.0)
with _app.app_context():
    tx = Transaction.query.filter_by(note="REG-in-new").first()
    assert_eq("单价换算 HKD", tx.unit_price, 113.6)

# ---------- 3. 手动出库 ----------
print("\n[3] 手动出库 500g → 库存 -0.5kg")
r = sess.post(f"{BASE}/transactions/out/new", data={
    "pigment_id": str(pid), "quantity": "500", "note": "REG-out-new"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq(f"{TEST_CODE} 库存", stock_of(TEST_CODE), 0.5)

# ---------- 4. 手动出库超额 → pending ----------
print("\n[4] 手动出库超额(10kg 但只有 0.5kg) → pending,库存不变")
before = stock_of(TEST_CODE)
r = sess.post(f"{BASE}/transactions/out/new", data={
    "pigment_id": str(pid), "quantity": "10000", "note": "REG-out-over"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("库存不变", stock_of(TEST_CODE), before)
assert_eq("pending 新增 1", pending_count(), 1)

# ---------- 5. Resolve 出库 pending ----------
print("\n[5] Resolve 出库 pending(先加库存到 15kg)")
with _app.app_context():
    Stock.query.get(pid).quantity = 15.0
    db.session.commit()
    pr_id = PendingReview.query.first().id
r = sess.post(f"{BASE}/pending/{pr_id}/resolve", data={
    "pigment_code": TEST_CODE, "quantity": "10000"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("库存 15 → 5", stock_of(TEST_CODE), 5.0)
assert_eq("pending 清空", pending_count(), 0)

# ---------- 6. OCR 入库(匹到已有色粉,RMB 换算) ----------
print("\n[6] OCR 入库(code=105,小写模拟大小写容错) RMB 50 → HKD 56.82")
cleanup(TEST_CODE)
r = sess.post(f"{BASE}/transactions/in/ocr/submit", data={
    "pigment_id[]": [""], "new_code[]": ["105"], "purchase_code[]": [""],
    "quantity[]": ["2"], "unit_price[]": ["50"],
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq(f"{TEST_CODE} 库存 +2", stock_of(TEST_CODE), 2.0)
assert_eq("pending 0", pending_count(), 0)
with _app.app_context():
    tx = Transaction.query.filter(
        Transaction.pigment_id == pid,
        Transaction.type == "in",
        Transaction.note == "拍照识别",
    ).order_by(Transaction.id.desc()).first()
    assert_eq("OCR 单价换算", tx.unit_price, 56.8)

# ---------- 7. OCR 入库(未知 code) → pending ----------
print("\n[7] OCR 入库 code='NEW-X-CODE'(库里没) → pending")
r = sess.post(f"{BASE}/transactions/in/ocr/submit", data={
    "pigment_id[]": [""], "new_code[]": ["NEW-X-CODE"],
    "purchase_code[]": ["NEW-X-PC"], "quantity[]": ["3"], "unit_price[]": ["80"],
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("pending 新增 1", pending_count(), 1)
with _app.app_context():
    pr = PendingReview.query.first()
    assert_eq("pending type", pr.type, "in")
    assert_eq("pending unit_price 已换算 HKD", pr.unit_price, 90.9)  # 80/0.88=90.91 → 90.9
    pr_id = pr.id

# ---------- 8. Resolve 入库 pending(自动创建新色粉) ----------
print("\n[8] Resolve 入库 pending → 新建色粉 NEW-X-CODE,库存 +3")
r = sess.post(f"{BASE}/pending/{pr_id}/resolve", data={
    "pigment_code": "NEW-X-CODE", "quantity": "3", "unit_price": "90.91",
    "purchase_code": "NEW-X-PC"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("pending 清空", pending_count(), 0)
assert_eq("新色粉库存 3kg", stock_of("NEW-X-CODE"), 3.0)
with _app.app_context():
    new_p = Pigment.query.filter_by(code="NEW-X-CODE").first()
    assert_eq("新色粉 purchase_code", new_p.purchase_code, "NEW-X-PC")

# ---------- 9. OCR 出库(case-insensitive) ----------
print("\n[9] OCR 出库 code='105'(DB 是 105),扣 500g → 库存 -0.5")
before = stock_of(TEST_CODE)
r = sess.post(f"{BASE}/transactions/out/ocr/submit", data={
    "pigment_code[]": ["105"], "quantity[]": ["500"],
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("库存变动", stock_of(TEST_CODE), before - 0.5)
assert_eq("pending 0", pending_count(), 0)

# ---------- 10. 编辑入库(库存够) ----------
print("\n[10] 编辑入库流水 qty 2 → 1.5(库存 -0.5)")
with _app.app_context():
    tx = Transaction.query.filter_by(pigment_id=pid, type="in").order_by(Transaction.id.desc()).first()
    tx_id = tx.id
before = stock_of(TEST_CODE)
r = sess.post(f"{BASE}/transactions/in/{tx_id}/edit", data={
    "pigment_id": str(pid), "quantity": "1.5", "unit_price": "50",
    "occurred_at": "2026-04-22T10:00", "note": "REG-edit"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("库存变动 -0.5", stock_of(TEST_CODE), before - 0.5)

# ---------- 11. 编辑入库(库存不够回退 → pending) ----------
print("\n[11] 库存设 1kg,编辑入库到 0.1kg (回退差额 1.4kg 不够) → pending")
with _app.app_context():
    Stock.query.get(pid).quantity = 1.0
    db.session.commit()
r = sess.post(f"{BASE}/transactions/in/{tx_id}/edit", data={
    "pigment_id": str(pid), "quantity": "0.1", "unit_price": "50",
    "occurred_at": "2026-04-22T10:00", "note": "REG-edit-pending"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("pending 新增 1", pending_count(), 1)
with _app.app_context():
    tx_now = Transaction.query.get(tx_id)
    assert_eq("原 tx 未改", tx_now.quantity, 1.5)
    assert_eq("库存未改", Stock.query.get(pid).quantity, 1.0)

# ---------- 12. Resolve edit_in pending(强制应用) ----------
print("\n[12] 强制应用 edit_in pending → tx qty=0.1,库存变负")
with _app.app_context():
    pr_id = PendingReview.query.filter_by(type="edit_in").first().id
r = sess.post(f"{BASE}/pending/{pr_id}/resolve", data={
    "pigment_code": TEST_CODE, "quantity": "0.1", "unit_price": "50"
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("pending 清空", pending_count(), 0)
with _app.app_context():
    tx_now = Transaction.query.get(tx_id)
    assert_eq("tx qty 变 0.1", tx_now.quantity, 0.1)
    # 库存 1.0 - 1.5 + 0.1 = -0.4
    assert_eq(f"{TEST_CODE} 库存 = -0.4", stock_of(TEST_CODE), -0.4)

# ---------- 13. Pending reject ----------
print("\n[13] Reject pending → 删除,不改库存")
# 造一条 out pending
with _app.app_context():
    pr = PendingReview(type="out", pigment_code=TEST_CODE, purchase_code="", name="",
                      quantity=100, reason="test", note="REG-reject")
    db.session.add(pr); db.session.commit()
    pr_id = pr.id
before = stock_of(TEST_CODE)
r = sess.post(f"{BASE}/pending/{pr_id}/reject", allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
assert_eq("pending 清空", pending_count(), 0)
assert_eq("库存不变", stock_of(TEST_CODE), before)

# ---------- 14. 设置页改汇率 ----------
print("\n[14] 设置页改汇率 0.88 → 0.92,再入 RMB 100 应存 HKD 108.70")
r = sess.post(f"{BASE}/settings/", data={"rate": "0.92"}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
cleanup(TEST_CODE)
r = sess.post(f"{BASE}/transactions/in/new", data={
    "pigment_id": str(pid), "quantity": "1", "unit_price": "100",
    "note": "REG-rate-0.92"
}, allow_redirects=False)
with _app.app_context():
    tx = Transaction.query.filter_by(note="REG-rate-0.92").first()
    # 100 / 0.92 = 108.7
    assert_eq("换算按新汇率", tx.unit_price, 108.7)

# ---------- 15. 色粉新建(HKD 直接存,不换算) ----------
print("\n[15] 新建色粉 HKD 单价 200(直接存,不换算)")
r = sess.post(f"{BASE}/pigments/new", data={
    "brand": "TEST", "code": "TEST-PIGMENT-9999", "name": "测试色粉",
    "unit_price": "200", "spec_value": "0", "spec_unit": "ml",
    "color_family": "其他", "min_stock": "1", "quantity": "0",
}, allow_redirects=False)
assert_eq("status 302", r.status_code, 302)
with _app.app_context():
    p = Pigment.query.filter_by(code="TEST-PIGMENT-9999").first()
    if p:
        assert_eq("色粉单价存 HKD 200(不换算)", p.unit_price, 200.0)
    else:
        assert_eq("色粉建档失败", None, 200.0)

# ---------- cleanup ----------
print("\n--- 清理测试数据 ---")
with _app.app_context():
    Transaction.query.filter(Transaction.note.like("REG-%")).delete(synchronize_session=False)
    Transaction.query.filter_by(note="拍照识别").delete(synchronize_session=False)
    Transaction.query.filter(Transaction.note.like("%补填%")).delete(synchronize_session=False)
    Stock.query.get(pid).quantity = 0.0
    for code in ("NEW-X-CODE", "TEST-PIGMENT-9999"):
        p2 = Pigment.query.filter_by(code=code).first()
        if p2:
            Transaction.query.filter_by(pigment_id=p2.id).delete(synchronize_session=False)
            Stock.query.filter_by(pigment_id=p2.id).delete()
            db.session.delete(p2)
    PendingReview.query.delete()
    Setting.query.filter_by(key="hkd_to_rmb_rate").delete()  # 汇率重置默认
    db.session.commit()
    print("清理完成")

# ============================================================
print("\n" + "=" * 60)
print(f"结果: ✅ {PASS} 通过 | ❌ {FAIL} 失败")
print("=" * 60)
sys.exit(0 if FAIL == 0 else 1)
