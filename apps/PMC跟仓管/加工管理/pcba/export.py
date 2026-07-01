import io
from openpyxl import Workbook


def build_workbook(summary, detail_records, location_names):
    """summary: compute_summary 的返回；detail_records: 全部记录 dict 列表
    （含 rec_type/location_name/rec_date/doc_no/material/qty/remark）。"""
    wb = Workbook()

    # ---- 总表 ----
    ws = wb.active
    ws.title = "总表"
    ws.append(["77794唱机PCBA主板明细"])
    ws.append(["范围", "领料数", "成品完成数", "应存数", "备注"])
    for row in summary["locations"]:
        ws.append([row["location"], row["issue"], row["finished"], row["balance"], ""])
    st = summary["subtotal"]
    ws.append(["小计：", st["issue"], st["finished"], st["balance"], ""])
    raw = summary["raw"]
    ws.append(["来料仓入仓总数", "来料仓出库总数", "货仓应存"])
    ws.append([raw["inbound"], raw["outbound"], raw["balance"]])

    # ---- 明细分页 ----
    def detail_sheet(title, recs, qty_header):
        s = wb.create_sheet(title=title[:31])
        s.append(["日期", "单据编号", "物料名称", qty_header, "备注"])
        total = 0
        for r in recs:
            s.append([r.get("rec_date"), r.get("doc_no"), r.get("material"),
                      r.get("qty"), r.get("remark")])
            total += int(r.get("qty") or 0)
        s.append([None, None, "小计：", total, None])

    inbound = [r for r in detail_records if r["rec_type"] == "inbound_raw"]
    detail_sheet("登信入仓", inbound, "入仓数")
    for name in location_names:
        issues = [r for r in detail_records
                  if r["rec_type"] == "issue" and r.get("location_name") == name]
        finished = [r for r in detail_records
                    if r["rec_type"] == "finished" and r.get("location_name") == name]
        detail_sheet(f"{name}领料", issues, "领料数")
        detail_sheet(f"{name}成品入仓", finished, "入仓数")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
