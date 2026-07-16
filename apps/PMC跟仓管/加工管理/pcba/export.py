import io
from datetime import date, datetime
from openpyxl import Workbook

SUMMARY_MONTHS = (6, 7, 8, 9, 10, 11, 12)


def _record_export_date(record):
    rec_date = record.get("rec_date")
    if rec_date:
        return rec_date
    text = f"{record.get('doc_no') or ''} {record.get('remark') or ''}"
    if "期初" in text:
        return date(date.today().year, 6, 27).isoformat()
    return None


def _record_month(record):
    summary_month = record.get("summary_month")
    if summary_month:
        try:
            month = int(summary_month)
            if month in SUMMARY_MONTHS:
                return month
        except (TypeError, ValueError):
            pass
    value = _record_export_date(record)
    if not value:
        return 6
    if isinstance(value, datetime):
        return value.month
    if isinstance(value, date):
        return value.month
    try:
        return date.fromisoformat(str(value)).month
    except ValueError:
        return 6


def _record_qty(record):
    return int(record.get("qty") or 0)


def _month_values(records):
    values = []
    for month in SUMMARY_MONTHS:
        values.append(sum(_record_qty(row) for row in records if _record_month(row) == month))
    return values


def _summary_month_row(scope, item, records, remark=""):
    values = _month_values(records)
    return [scope, item, sum(values), *values, remark]


def _balance_month_row(scope, item, inbound_records, outbound_records, remark=""):
    inbound_values = _month_values(inbound_records)
    outbound_values = _month_values(outbound_records)
    values = [
        inbound_value - outbound_value
        for inbound_value, outbound_value in zip(inbound_values, outbound_values)
    ]
    return [scope, item, sum(values), *values, remark]


def _build_supplier_monthly_summary(ws, detail_records, location_names):
    ws.append(["范围", "项目", "累计总数", "6月月结", "7月", "8月", "9月", "10月", "11月", "12月", "备注"])
    all_issues = []
    all_finished = []
    for name in location_names:
        issues = [
            row for row in detail_records
            if row["rec_type"] == "issue" and row.get("location_name") == name
        ]
        finished = [
            row for row in detail_records
            if row["rec_type"] in ("finished", "semi_finished")
            and row.get("location_name") == name
        ]
        all_issues.extend(issues)
        all_finished.extend(finished)
        ws.append(_summary_month_row(name, "领料数", issues))
        ws.append(_summary_month_row(name, "成品完成数", finished))
        ws.append(_balance_month_row(name, "应存数", issues, finished))
    ws.append(_summary_month_row("小计", "领料数", all_issues))
    ws.append(_summary_month_row("小计", "成品完成数", all_finished))
    ws.append(_balance_month_row("小计", "应存数", all_issues, all_finished))
    ws.append([])

    inbound = [row for row in detail_records if row["rec_type"] == "inbound_raw"]
    ws.append(_summary_month_row("来料仓", "入仓总数", inbound))
    ws.append(_summary_month_row("来料仓", "出库总数", all_issues))
    ws.append(_balance_month_row("货仓", "应存", inbound, all_issues))


def build_workbook(
    summary, detail_records, location_names, include_supplier=False,
    warehouse_mode=False, outsource_mode=False, shaoyang_mode=False,
    outsource_label="东莞加工厂利鸿",
):
    """summary: compute_summary 的返回；detail_records: 全部记录 dict 列表
    （含 rec_type/location_name/rec_date/doc_no/material/sticker_type/qty/remark）。"""
    wb = Workbook()
    lihong_mode = outsource_mode and outsource_label == "东莞加工厂利鸿"

    # ---- 总表 ----
    ws = wb.active
    ws.title = "总表"
    ws.append(["唱片机管理系统明细"])
    raw = summary["raw"]
    if lihong_mode:
        ws.append(["领料总数", "半成品出库总数", "应存数"])
    elif outsource_mode:
        ws.append(["成品入库总数", "半成品入库总数", "入库合计"])
    elif include_supplier:
        _build_supplier_monthly_summary(ws, detail_records, location_names)
    else:
        ws.append(["范围", "领料数", "成品完成数", "应存数", "备注"])
        for row in summary["locations"]:
            ws.append([row["location"], row["issue"], row["finished"], row["balance"], ""])
        st = summary["subtotal"]
        ws.append(["小计：", st["issue"], st["finished"], st["balance"], ""])
    if lihong_mode:
        ws.append([
            raw.get("issue", 0),
            raw.get("semi_finished_inbound", 0),
            raw["balance"],
        ])
    elif outsource_mode:
        ws.append([
            raw.get("finished_inbound", 0),
            raw.get("semi_finished_inbound", 0),
            raw["inbound"],
        ])
    elif warehouse_mode:
        ws.append(["半成品入库总数", "半成品出库总数", "半成品应存"])
        ws.append([raw["inbound"], raw["outbound"], raw["balance"]])
    elif not include_supplier:
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
            row = [_record_export_date(r), r.get("doc_no"), r.get("material")]
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

    if lihong_mode:
        semi_finished = [r for r in detail_records if r["rec_type"] == "semi_finished"]
        detail_sheet(f"{outsource_label}半成品出库", semi_finished, "出库数")
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf

    if outsource_mode:
        finished = [r for r in detail_records if r["rec_type"] == "finished"]
        semi_finished = [r for r in detail_records if r["rec_type"] == "semi_finished"]
        detail_sheet(f"{outsource_label}成品入库", finished, "入仓数")
        detail_sheet(f"{outsource_label}半成品入库", semi_finished, "入仓数")
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
