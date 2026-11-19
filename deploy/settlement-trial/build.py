"""Build the two synthetic trial statements. No ERP database connection."""
from html import escape
from pathlib import Path
from shutil import copyfile

ROOT = Path(__file__).resolve().parent
MONTHS = ("2026-11", "2026-12")
# Order, receipt day, pieces received, order pricing unit, settled units, unit price, carry.
SAMPLES = {
    "trial-a": ("试用甲公司", [
        ("A-001", "2026-11-30", 60, "件", 60, 10, "—"),
        ("A-002", "2026-11-30", 60, "啤", 7, 3, "余 4 件"),
        ("A-001", "2026-12-01", 40, "件", 40, 10, "—"),
        ("A-002", "2026-12-01", 40, "啤", 5, 3, "余 4 件"),
    ]),
    "trial-b": ("试用乙公司", [
        ("B-001", "2026-11-30", 12, "件", 12, 13, "—"),
    ]),
}


def month_section(month, rows):
    total = 0
    body = []
    for order, day, pieces, unit, units, price, carry in rows:
        if not day.startswith(month):
            continue
        amount = units * price
        total += amount
        cells = (order, day, pieces, f"{price:.2f} 元/{unit}", f"{units} {unit}", carry, f"{amount:.2f}")
        body.append("<tr>" + "".join(f"<td>{escape(str(c))}</td>" for c in cells) + "</tr>")
    headers = ("采购单", "交货日期", "实收件数", "订单单价", "结算数量", "结转", "金额（元）")
    table = ("<div class='scroll'><table><thead><tr>" + "".join(f"<th>{h}</th>" for h in headers)
             + "</tr></thead><tbody>" + "".join(body) + "</tbody></table></div>") if body else "<p>本月无交货记录。</p>"
    return f"<section id='m{month}'><h2>{month} 对账单</h2><p>本月合计 <strong>¥{total:.2f}</strong></p>{table}</section>"


for account, (name, rows) in SAMPLES.items():
    folder = ROOT / "site" / account
    folder.mkdir(parents=True, exist_ok=True)
    for asset in ("months.js", "style.css"):
        copyfile(ROOT / asset, folder / asset)
    links = " ".join(f"<a href='#m{m}'>{m}</a>" for m in MONTHS)
    sections = "".join(month_section(m, rows) for m in MONTHS)
    (folder / "index.html").write_text(f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} · 采购交货月结</title><link rel="stylesheet" href="style.css"><script defer src="months.js"></script>
<main><header><p>采购交货月结 · 虚拟账单试用</p><h1>{name}</h1></header>
<nav aria-label="对账月份">{links}</nav>{sections}</main></html>""", encoding="utf-8")
