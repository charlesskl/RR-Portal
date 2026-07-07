import io
from openpyxl import Workbook


def build_workbook(
    summary, detail_records, location_names, include_supplier=False,
    warehouse_mode=False, outsource_mode=False, shaoyang_mode=False,
):
    """summary: compute_summary 的返回；detail_records: 全部记录 dict 列表
    （含 rec_type/location_name/rec_date/doc_no/material/sticker_type/qty/remark）。"""
    wb = Workbook()

    # ---- 总表 ----
    ws = wb.active
    ws.title = "总表"
    ws.append(["唱片机管理系统明细"])
    raw = summary["raw"]
    if outsource_mode:
        ws.append(["成品入库总数", "半成品入库总数", "入库合计"])
    else:
        ws.append(["范围", "领料数", "成品完成数", "应存数", "备注"])
        for row in summary["locations"]:
            ws.append([row["location"], row["issue"], row["finished"], row["balance"], ""])
        st = summary["subtotal"]
        ws.append(["小计：", st["issue"], st["finished"], st["balance"], ""])
    if outsource_mode:
        ws.append([
            raw.get("finished_inbound", 0),
            raw.get("semi_finished_inbound", 0),
            raw["inbound"],
        ])
    elif warehouse_mode:
        ws.append(["半成品入库总数", "半成品出库总数", "半成品应存"])
        ws.append([raw["inbound"], raw["outbound"], raw["balance"]])
    else:
        ws.append(["来料仓入仓总数", "来料仓出库总数", "货仓应存"])
        ws.append([raw["inbound"], raw["outbound"], raw["balance"]])

    # ---- 明细分页 ----
    def detail_sheet(title, recs, qty_header, include_po_customer=False):
        s = wb.create_sheet(title=title[:31])
        has_sticker_type = any(r.get("sticker_type") for r in recs)
        headers = ["日期", "单据编号", "物料名称"]
        if has_sticker_type:
            headers.append("贴纸类型")
        if include_po_customer:
            headers.extend(["PO", "客名", qty_header, "备注"])
        elif include_supplier:
            headers.extend(["供应商", qty_header, "备注"])
        else:
            headers.extend([qty_header, "备注"])
        s.append(headers)
        total = 0
        for r in recs:
            row = [r.get("rec_date"), r.get("doc_no"), r.get("material")]
            if has_sticker_type:
                row.append(r.get("sticker_type"))
            if include_po_customer:
                row.extend([r.get("po_no"), r.get("customer_name")])
            elif include_supplier:
                row.append(r.get("supplier"))
            row.extend([r.get("qty"), r.get("remark")])
            s.append(row)
            total += int(r.get("qty") or 0)
        subtotal = [None] * len(headers)
        subtotal[-3] = "小计："
        subtotal[-2] = total
        s.append(subtotal)

    if warehouse_mode:
        semi_inbound = [r for r in detail_records if r["rec_type"] == "semi_inbound"]
        semi_outbound = [r for r in detail_records if r["rec_type"] == "semi_outbound"]
        detail_sheet("半成品入库", semi_inbound, "入仓数")
        detail_sheet("半成品出库", semi_outbound, "出库数")
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf

    if outsource_mode:
        finished = [r for r in detail_records if r["rec_type"] == "finished"]
        semi_finished = [r for r in detail_records if r["rec_type"] == "semi_finished"]
        detail_sheet("外发成品入库", finished, "入仓数")
        detail_sheet("外发半成品入库", semi_finished, "入仓数")
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf

    inbound = [r for r in detail_records if r["rec_type"] == "inbound_raw"]
    detail_sheet("登信入仓", inbound, "入仓数")
    for name in location_names:
        issues = [r for r in detail_records
                  if r["rec_type"] == "issue" and r.get("location_name") == name]
        finished = [r for r in detail_records
                    if r["rec_type"] == "finished" and r.get("location_name") == name]
        semi_finished = [r for r in detail_records
                         if r["rec_type"] == "semi_finished"
                         and r.get("location_name") == name]
        detail_sheet(f"{name}领料", issues, "领料数")
        detail_sheet(
            f"{name}成品入仓", finished, "入仓数",
            include_po_customer=shaoyang_mode,
        )
        detail_sheet(f"{name}半成品入库", semi_finished, "入仓数")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
