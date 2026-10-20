"""Read product records from VoyagePlex shipment workbooks."""

from io import BytesIO
import re

from .readonly_workbook import load_values_workbook


def parse_product_workbook(content: bytes, filename: str) -> list[dict]:
    try:
        special = parse_special_products(content, filename)
    except Exception as error:
        raise ValueError(f"{filename} 不是有效的走柜表 Excel 文件") from error
    if special is not None:
        return special
    from .product_workbook_standard import parse_standard_products
    try:
        return parse_standard_products(content, filename)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError(f"{filename} 无法读取走柜表，请核对文件格式") from error


def parse_special_products(content, filename):
    """Read each cabinet sheet; per-carton weights never use cabinet totals."""
    sheets = []
    if filename.lower().endswith(".xls"):
        import xlrd
        book = xlrd.open_workbook(file_contents=content)
        sheets = [(sheet.name, [sheet.row_values(i) for i in range(sheet.nrows)]) for sheet in book.sheets()]
        book.release_resources()
    else:
        book = load_values_workbook(BytesIO(content))
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
