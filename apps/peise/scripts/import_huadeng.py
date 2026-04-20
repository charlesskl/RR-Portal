"""一次性脚本:导入华登仓库库存表.xlsx 到本系统。

读取 4 个横向重复列块(0-6, 8-14, 16-22, 24-30),
每块 7 列:色粉编号 | 上月剩余KG | 本月进货KG | 进货编号 | 本月剩余KG | 单价 | 金额
"""
import sys, math
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from app.extensions import db
from app.models import Pigment, Stock

SRC = r"C:\Users\1\OneDrive\Desktop\华登\配色\仓库库存表 .xlsx"
BLOCKS = [(0, 6), (8, 14), (16, 22), (24, 30)]
HEADER_ROW = 2
DATA_START = 3


def clean_str(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    return str(v).strip()


def clean_float(v):
    try:
        f = float(v)
        if math.isnan(f):
            return 0.0
        return f
    except (TypeError, ValueError):
        return 0.0


def iter_rows():
    df = pd.read_excel(SRC, sheet_name=0, header=None)
    for ridx in range(DATA_START, len(df)):
        for start, _ in BLOCKS:
            code = clean_str(df.iat[ridx, start])
            if not code:
                continue
            purchase_code = clean_str(df.iat[ridx, start + 3])
            qty_kg = clean_float(df.iat[ridx, start + 4])
            unit_price = clean_float(df.iat[ridx, start + 5])
            yield {
                "code": code,
                "purchase_code": purchase_code,
                "qty": int(round(qty_kg)),
                "unit_price": unit_price,
            }


def main():
    app = create_app()
    with app.app_context():
        created = updated = 0
        for row in iter_rows():
            p = Pigment.query.filter_by(brand="", code=row["code"]).first()
            is_new = p is None
            if is_new:
                p = Pigment(brand="", code=row["code"], name=row["code"])
                db.session.add(p)
            p.purchase_code = row["purchase_code"]
            p.unit_price = row["unit_price"]
            if p.stock is None:
                p.stock = Stock(quantity=row["qty"])
            else:
                p.stock.quantity = row["qty"]
            db.session.flush()
            if is_new:
                created += 1
            else:
                updated += 1
        db.session.commit()
        print(f"新增 {created},更新 {updated}")


if __name__ == "__main__":
    main()
