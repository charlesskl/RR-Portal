"""Generic business spreadsheet preview parser.

The first stage deliberately preserves source values for human review. Customer-
specific update rules are applied only after a format has been confirmed.
"""

import csv
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import openpyxl
import xlrd


FIELD_ALIASES = {
    "product_code": ("货号", "sku", "item no", "product code", "款号"),
    "customer_po": ("客户/po", "客户po", "客po", "customer po", "po no", "po#"),
    "contract_number": ("合同编号", "合同号", "订单号", "contract", "zuru po"),
    "customer": ("客户名称", "洋行", "customer"),
    "country": ("走货国家", "国家", "country"),
    "quantity": ("合同总数量", "订单数量", "数量", "order qty", "quantity", "qty"),
    "inbound_quantity": ("入库数量", "入库数"),
    "inbound_date": ("入库日期", "入库时间"),
    "inbound_receipt_number": ("入库单号", "入库单", "入仓单号"),
    "outbound_date": ("出库日期", "出库时间"),
    "outbound_quantity": ("出库数量", "出库数"),
    "outbound_trip": ("出柜车次", "出库车次", "柜次", "车次"),
    "inventory_quantity": ("库存", "库存数量", "可用库存", "stock", "available qty"),
    "inspection_result": ("洋行 结果", "洋行结果", "验货结果", "验货状态", "inspection result", "result"),
    "third_party_result": ("第三方结果", "third party result"),
    "inspection_date": ("验货日期", "日期", "inspection date"),
    "planned_date": ("po走货期", "排期", "计划出货", "出货日期", "交期", "schedule", "ship date"),
    "inspection_location": ("验货地点",),
    "third_party": ("第三方",),
    "product_name": ("产品名称", "中文名", "品名"),
    "hold_reason": ("hold/rej 原因", "hold原因", "拒收原因"),
    "follow_up_workshop": ("跟进车间",),
    "production_workshop": ("生产车间",),
    "supervisor": ("责任主管",),
    "storage_location": ("放货区", "存放位置"),
    "gross_weight": ("毛重", "gross weight", "g.w", "gw"),
    "net_weight": ("净重", "net weight", "n.w", "nw"),
    "pieces": ("合同总件数", "箱数", "件数", "cartons", "ctns", "no of carton"),
    "volume": ("体积", "cbm", "volume"),
}


def parse_business_spreadsheet(path: Path, original_name: str, row_limit: Optional[int] = None) -> dict:
    suffix = Path(original_name).suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        max_row = None if row_limit is None else max(60, row_limit + 40)
        sheets = [(ws.title, list(ws.iter_rows(max_row=max_row, values_only=True))) for ws in wb.worksheets]
    elif suffix == ".xls":
        wb = xlrd.open_workbook(path)
        sheets = [(ws.name, [[ws.cell_value(r, c) for c in range(ws.ncols)] for r in range(ws.nrows)]) for ws in wb.sheets()]
    elif suffix == ".csv":
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        sheets = [("CSV", list(csv.reader(text.splitlines())))]
    else:
        raise ValueError("仅支持 xlsx、xls、csv 表格")

    candidates = []
    for sheet_name, rows in sheets:
        best = None
        for index, row in enumerate(rows[:40]):
            mapping = _column_map(list(row))
            score = len(mapping)
            if best is None or score > best[0]:
                best = (score, sheet_name, rows, index, mapping)
        if best and best[0] >= 2:
            headers = [_text(value) for value in best[2][best[3]]]
            candidates.append((*best, _classify(original_name, headers, best[4])))
    if not candidates:
        return {"kind": "unknown", "sheet": sheets[0][0] if sheets else "", "headers": [], "rows": [],
                "warnings": ["未找到可识别的表头，请人工确认表格格式"]}

    workbook_kind = _workbook_kind(original_name, candidates)
    selected = [candidate for candidate in candidates if candidate[5] == workbook_kind]
    if workbook_kind == "inspection":
        selected.sort(key=lambda candidate: _month_number(candidate[1]), reverse=True)
    parsed_rows = []
    selected_sheets = []
    headers = []
    for _, sheet_name, rows, header_index, mapping, _ in selected:
        selected_sheets.append(sheet_name)
        headers = headers or [_text(value) or f"第{index + 1}列" for index, value in enumerate(rows[header_index])]
        for source_index, values in enumerate(rows[header_index + 1:], header_index + 2):
            item = {field: _json_value(values[column] if column < len(values) else None) for field, column in mapping.items()}
            if not _is_business_row(item, workbook_kind):
                continue
            _normalize_item(item, workbook_kind)
            item["source_sheet"] = sheet_name
            item["source_row"] = source_index
            parsed_rows.append(item)
            if row_limit is not None and len(parsed_rows) >= row_limit:
                break
        if row_limit is not None and len(parsed_rows) >= row_limit:
            break
    warnings = [] if parsed_rows else ["已识别表头，但没有可导入的数据行"]
    return {"kind": workbook_kind, "sheet": "、".join(selected_sheets), "sheets": selected_sheets,
            "headers": headers, "rows": parsed_rows, "warnings": warnings}


def _column_map(headers: list) -> dict:
    normalized = [re.sub(r"\s+", " ", _text(value).replace("\n", " ").lower()) for value in headers]
    result = {}
    for field, aliases in FIELD_ALIASES.items():
        matches = []
        for index, header in enumerate(normalized):
            for priority, alias in enumerate(aliases):
                if header == alias or (len(alias) > 2 and alias in header):
                    matches.append((0 if header == alias else 1, priority, index))
        if matches:
            result[field] = min(matches)[2]
    return result


def _classify(filename: str, headers: list[str], mapping: dict) -> str:
    text = f"{filename} {' '.join(headers)}".lower()
    if "inventory_quantity" in mapping or re.search(r"库存|stock|inventory", text):
        return "inventory"
    if "inspection_result" in mapping or re.search(r"验货|inspection", text):
        return "inspection"
    if "planned_date" in mapping or re.search(r"排期|schedule|交期", text):
        return "schedule"
    if any(field in mapping for field in ("gross_weight", "net_weight", "volume", "pieces")):
        return "packing"
    return "general"


def _workbook_kind(filename: str, candidates: list[tuple]) -> str:
    if re.search(r"库存|stock|inventory", filename, re.I):
        return "inventory"
    if re.search(r"验货|inspection", filename, re.I):
        return "inspection"
    counts = {}
    for candidate in candidates:
        counts[candidate[5]] = counts.get(candidate[5], 0) + 1
    return max(counts, key=counts.get)


def _month_number(sheet_name: str) -> int:
    match = re.search(r"(\d{1,2})\s*月份", sheet_name)
    return int(match.group(1)) if match else 0


def _is_business_row(item: dict, kind: str) -> bool:
    if kind == "inventory":
        return item.get("product_code") not in (None, "") and any(
            item.get(field) not in (None, "") for field in ("inbound_quantity", "inventory_quantity")
        )
    if kind == "inspection":
        return item.get("product_code") not in (None, "") and item.get("contract_number") not in (None, "")
    return any(value not in (None, "") for value in item.values())


def _normalize_item(item: dict, kind: str) -> None:
    for field in ("product_code", "customer_po", "contract_number"):
        if item.get(field) not in (None, ""):
            item[field] = _text(item[field])
    for field in ("planned_date", "inspection_date", "inbound_date", "outbound_date"):
        value = item.get(field)
        if isinstance(value, (int, float)) and 20000 < value < 80000:
            item[field] = (datetime(1899, 12, 30) + timedelta(days=value)).date().isoformat()
    if kind == "inspection":
        results = [item.get("third_party_result"), item.get("inspection_result")]
        final = next((_normalize_result(value) for value in results if _normalize_result(value)), "待确认")
        item["inspection_result"] = final


def _normalize_result(value) -> str:
    text = _text(value).upper()
    if text in ("", "NA", "N/A", "/", "-"):
        return ""
    if text == "HOID":
        return "HOLD"
    return text


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _json_value(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
