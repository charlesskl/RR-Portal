"""Read product records from VoyagePlex shipment workbooks."""

from io import BytesIO
import re

from openpyxl import load_workbook


HEADERS = ("序号", "客户", "货号", "货名 / 装箱规格", "玩具类别", "每箱毛重", "每箱净重")
SPEC_PATTERN = re.compile(r"(?:^|\s)(\d+)\s*个\s*/\s*箱\s*$")


def parse_product_workbook(content: bytes, filename: str) -> list[dict]:
    try:
        special = parse_special_products(content, filename)
    except Exception as error:
        raise ValueError(f"{filename} 不是有效的走柜表 Excel 文件") from error
    if special is not None:
        return special
    try:
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as error:
        raise ValueError(f"{filename} 不是有效的走柜表 Excel 文件") from error
    try:
        if "柜单" not in workbook.sheetnames:
            raise ValueError(f"{filename} 缺少“柜单”工作表")
        sheet = workbook["柜单"]
        header = [str(sheet.cell(5, index).value or "").strip() for index in range(1, 18)]
        if any(value not in header for value in HEADERS):
            raise ValueError(f"{filename} 的柜单表头与系统走柜表不符")
        columns = {value: header.index(value) for value in HEADERS}
        rows = []
        for row_number, cells in enumerate(sheet.iter_rows(min_row=6, values_only=True), start=6):
            sequence = cells[columns["序号"]] if len(cells) > columns["序号"] else None
            if sequence is None or not str(sequence).strip().isdigit():
                break

            def cell(label: str) -> str:
                index = columns[label]
                return str(cells[index]).strip() if index < len(cells) and cells[index] is not None else ""

            combined_name = cell("货名 / 装箱规格")
            match = SPEC_PATTERN.search(combined_name)
            quantity = int(match.group(1)) if match else None
            name = combined_name[:match.start()].strip() if match else combined_name

            def weight(label: str) -> float | None:
                raw = cell(label)
                if not raw:
                    return None
                try:
                    value = float(raw)
                    return value if value > 0 else None
                except ValueError:
                    return None

            warnings = []
            if not cell("货号"):
                warnings.append("货号为空")
            if quantity is None:
                warnings.append("未识别装箱规格，请核对")
            rows.append({
                "filename": filename, "rowNumber": row_number,
                "customer": cell("客户"), "productCode": cell("货号"),
                "productName": name, "quantityPerBox": quantity,
                "toyCategory": cell("玩具类别"),
                "grossWeightPerBox": weight("每箱毛重"),
                "netWeightPerBox": weight("每箱净重"), "warnings": warnings,
            })
        return rows
    finally:
        workbook.close()


def parse_special_products(content, filename):
    """Read each cabinet sheet; per-carton weights never use cabinet totals."""
    sheets = []
    if filename.lower().endswith(".xls"):
        import xlrd
        book = xlrd.open_workbook(file_contents=content)
        sheets = [(sheet.name, [sheet.row_values(i) for i in range(sheet.nrows)]) for sheet in book.sheets()]
        book.release_resources()
    else:
        book = load_workbook(BytesIO(content), read_only=True, data_only=True)
        try: sheets = [(sheet.title, list(sheet.iter_rows(values_only=True))) for sheet in book]
        finally: book.close()
    found = False; result = []; seen = set()
    for sheet_name, values in sheets:
        for header_index, row in enumerate(values[:40]):
            header = [re.sub(r"[\s（）()]", "", str(value or "")) for value in row]
            if not all(label in header for label in ("洋行", "货号", "数量", "件数", "净重", "净净重")): continue
            found = True
            cols = {label: index for index, label in enumerate(header)}
            brand = next((str(cell).split("品牌", 1)[1].lstrip("：: ") for line in values for cell in line if cell and "品牌" in str(cell)), "")
            for index, cargo in enumerate(values[header_index+1:], header_index+2):
                def value(label):
                    col = cols.get(label)
                    return cargo[col] if col is not None and col < len(cargo) else None
                def number(label):
                    try: return float(value(label)) if value(label) not in (None, "") else None
                    except (ValueError, TypeError): return None
                quantity, boxes = number("数量"), number("件数")
                if not boxes or not quantity: continue
                code = re.match(r"[A-Za-z0-9][A-Za-z0-9_.\-/]*", str(value("货号") or ""))
                if not code: continue
                spec = quantity / boxes
                spec = int(spec) if spec.is_integer() else None
                key = (code[0], spec)
                if key in seen: continue
                seen.add(key)
                dimensions_col = cols.get("尺码CM", cols.get("尺寸CM", cols.get("尺寸CM长")))
                dimensions = cargo[dimensions_col:dimensions_col+3] if dimensions_col is not None else []
                result.append({"filename": filename, "rowNumber": index, "sheetName": sheet_name,
                               "customer": str(value("洋行") or "").strip(), "productCode": code[0],
                               "productName": str(value("货号") or "")[len(code[0]):].strip(), "quantityPerBox": spec,
                               "toyCategory": str(value("玩具类别") or ""), "brand": brand,
                               "boxDimensions": "*".join(str(v) for v in dimensions) if len(dimensions) == 3 and all(v not in (None, "") for v in dimensions) else "",
                               "grossWeightPerBox": number("KG/箱毛重"), "netWeightPerBox": number("KG/箱净重"),
                               "netNetWeightPerBox": number("KG/箱净净重"),
                               "measurementPerBox": number("每箱/尺码"),
                               "volumePerBox": number("CBM") / boxes if number("CBM") is not None else None,
                               "warnings": [] if spec else ["数量与件数无法确定每箱个数，请核对"]})
            break
    return result if found else None
