import io
import pandas as pd
from app.models import Pigment, Stock
from app.extensions import db

COLUMNS = ["色粉编号", "进货色粉编号", "数量", "单位", "单价", "金额", "备注"]


def _fmt_num(v: float) -> float:
    return round(float(v or 0), 6)


def export_pigments_to_bytes() -> bytes:
    rows = []
    for p in (Pigment.query.filter_by(is_archived=False)
              .order_by(Pigment.code).all()):
        qty = _fmt_num(p.stock.quantity if p.stock else 0)
        price = _fmt_num(p.unit_price)
        rows.append({
            "色粉编号": p.code,
            "进货色粉编号": p.purchase_code or "",
            "数量": qty,
            "单位": "KG",
            "单价": price,
            "金额": round(qty * price, 2),
            "备注": p.notes or "",
        })
    df = pd.DataFrame(rows, columns=COLUMNS)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


def template_bytes() -> bytes:
    df = pd.DataFrame(columns=COLUMNS)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


REQUIRED = ["色粉编号"]


def _cell_str(v) -> str:
    """Excel 空单元格是 NaN,str(NaN)='nan';这里统一返回干净字符串。"""
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    return str(v).strip()


def _cell_float(v) -> float:
    """Excel 空单元格是 NaN; NaN or 0 在 Python 里仍是 NaN(NaN 是 truthy)，会让
    后续 SQLite NOT NULL 校验炸。先用 pd.isna() 把 NaN/None 折成 0。"""
    if v is None:
        return 0.0
    try:
        if pd.isna(v):
            return 0.0
    except (TypeError, ValueError):
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def import_pigments_from_bytes(data: bytes) -> dict:
    """Excel 是 brand="" 正规色粉库的真源:
    - Excel 里出现的 code → 更新/新建,并取消归档
    - 不在 Excel 里的 brand="" 老色粉 → 归档(不删除,保留流水)
    - brand="未分类" 的 OCR 自动新建色粉不动,留给用户复核
    """
    df = pd.read_excel(io.BytesIO(data), engine="openpyxl")
    for col in REQUIRED:
        if col not in df.columns:
            raise ValueError(f"缺少必要列:{col}")
    created = updated = 0
    errors = []
    seen_codes: set[str] = set()
    for idx, row in df.iterrows():
        try:
            code = _cell_str(row["色粉编号"])
            if not code:
                continue
            seen_codes.add(code)
            p = Pigment.query.filter_by(brand="", code=code).first()
            is_new = p is None
            if is_new:
                p = Pigment(brand="", code=code, name=code, spec_unit="kg")
                db.session.add(p)
            p.purchase_code = _cell_str(row.get("进货色粉编号"))
            p.unit_price = _cell_float(row.get("单价"))
            if "备注" in df.columns:
                p.notes = _cell_str(row.get("备注"))
            qty = _cell_float(row.get("数量"))
            if p.stock is None:
                p.stock = Stock(quantity=qty)
            else:
                p.stock.quantity = qty
            p.is_archived = False
            db.session.flush()
            if is_new:
                created += 1
            else:
                updated += 1
        except Exception as e:
            errors.append({"row": int(idx) + 2, "reason": str(e)})
    # 归档 Excel 里没出现的 brand="" 老色粉
    archived = 0
    if seen_codes:
        stale = (Pigment.query
                 .filter_by(brand="", is_archived=False)
                 .filter(~Pigment.code.in_(seen_codes))
                 .all())
        for p in stale:
            p.is_archived = True
            archived += 1
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return {"created": created, "updated": updated, "archived": archived, "errors": errors}
