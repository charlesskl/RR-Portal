"""Extract product master data from ordinary factory shipment forms, without editing them."""
from io import BytesIO
import math
import re

from .readonly_workbook import load_values_workbook
from zipfile import ZipFile
from xml.etree.ElementTree import iterparse
from openpyxl.utils.cell import range_boundaries


ALIASES = {
    "sequence": ("序号", "序號"), "customer": ("客户", "洋行", "客戶"),
    "code": ("货号", "貨號"), "name": ("货名", "品名", "货名/装箱规格", "貨名", "货名/裝箱規格"),
    "category": ("玩具类别", "玩具類別", "类别"),
    "gross": ("每箱毛重", "KG/箱毛重"), "net": ("每箱净重", "KG/箱净重"),
    "net_net": ("每箱净净重", "KG/箱净净重"),
    "spec": ("装箱规格", "每箱个数", "每箱数量"), "pieces": ("件数", "箱数", "件數"),
    "dimensions": ("箱唛CM", "尺码CM", "尺寸CM", "箱尺寸", "箱尺寸CM"),
}
SPEC = re.compile(r"(?<![\d.])(\d+)\s*(?:个|只|件|PCS?|PCES?)?\s*/\s*(?:箱|CTNS?|CARTONS?|CASE)(?![A-Za-z])", re.I)
DIM = r"\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?"
DIM_NOTE = re.compile(r"([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*[#：:]\s*[#：:]*\s*(" + DIM + r")", re.I)
BRAND = re.compile(r"(?:([A-Za-z0-9]+)\s*字?开头(?:的)?\s*)?品牌\s*[：:]\s*(.*)")


def text(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value == int(value):
        return str(int(value))
    return str(value).strip()


def positive(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def normalized(value):
    return re.sub(r"\s+", "", text(value)).upper().replace("／", "/").replace("（", "(").replace("）", ")")


def sheet_merges(content, sheet):
    merges = []
    with ZipFile(BytesIO(content)) as archive, archive.open(sheet._worksheet_path.lstrip("/")) as source:
        for _, element in iterparse(source, events=("end",)):
            if element.tag.rsplit("}", 1)[-1] == "mergeCell":
                c1, r1, c2, r2 = range_boundaries(element.attrib["ref"])
                merges.append((r1-1, r2, c1-1, c2))
            element.clear()
    return merges


def sheets(content, filename):
    if filename.lower().endswith(".xls"):
        import xlrd
        book = xlrd.open_workbook(file_contents=content, formatting_info=True)
        try:
            return [(sheet.name, [sheet.row_values(i) for i in range(sheet.nrows)], list(sheet.merged_cells)) for sheet in book.sheets()]
        finally:
            book.release_resources()
    book = load_values_workbook(BytesIO(content))
    try:
        result = []
        for sheet in book:
            sheet.reset_dimensions()
            result.append((sheet.title, list(sheet.iter_rows(values_only=True)), sheet_merges(content, sheet)))
        return result
    finally:
        book.close()


def brand_notes(values):
    notes = []
    for row in values:
        for cell in row:
            lines = text(cell).splitlines()
            for index, line in enumerate(lines):
                match = BRAND.search(line)
                if not match:
                    continue
                value = match[2].strip()
                if not value and index + 1 < len(lines) and not BRAND.search(lines[index + 1]):
                    value = lines[index + 1].strip()
                if value and "品牌" not in value:
                    note = (match[1] or "", value)
                    if note not in notes:
                        notes.append(note)
    return notes


def product_brand(code, notes, warnings):
    matching = [value for prefix, value in notes if prefix and code.upper().startswith(prefix.upper())]
    choices = list(dict.fromkeys(matching or [value for prefix, value in notes if not prefix]))
    if len(choices) > 1:
        warnings.append("表中有多个品牌标注，无法唯一匹配，请核对")
    return choices[0] if len(choices) == 1 else ""


def product_dimensions(code, raw, values, warnings):
    if len(raw) == 3 and all(positive(value) for value in raw):
        return "*".join(text(value) for value in raw)
    if raw and re.fullmatch(DIM + r"\s*(?:cm)?", text(raw[0]), re.I):
        return re.sub(r"\s|cm", "", text(raw[0]), flags=re.I).replace("×", "*").replace("x", "*").replace("X", "*")
    matches = []
    for row in values:
        for cell in row:
            for match in DIM_NOTE.finditer(text(cell)):
                key = match[1].upper()
                if code.upper() == key or code.upper().startswith(key + "-"):
                    matches.append(re.sub(r"\s+", "", match[2]).replace("×", "*").replace("x", "*").replace("X", "*"))
    matches = list(dict.fromkeys(matches))
    if len(matches) > 1:
        warnings.append("同货号有多个箱尺寸标注，请核对")
    return matches[0] if len(matches) == 1 else ""


def parse_standard_products(content, filename):
    result = []
    found = False
    for sheet_name, values, merges in sheets(content, filename):
        header_index = None
        columns = {}
        for index, row in enumerate(values[:40]):
            headers = [normalized(value) for value in row]
            mapped = {key: next((col for col, label in enumerate(headers) if label in {normalized(alias) for alias in aliases}), None) for key, aliases in ALIASES.items()}
            combined_header = False
            if mapped["code"] is None and mapped["name"] is not None:
                for r1, r2, c1, c2 in merges:
                    if r1 <= index < r2 and c1 == mapped["name"] and c2-c1 == 2:
                        mapped["code"], mapped["name"] = c1, c1+1
                        combined_header = True
                        break
            blank_code_header = False
            name_col = mapped["name"]
            if mapped["code"] is None and name_col is not None and name_col >= 2 and not headers[name_col-1] and headers[name_col-2] in ("合同", "合同号"):
                candidates = [source[name_col-1] for source in values[index+1:index+8] if len(source) > name_col-1 and source[name_col-1] not in (None, "")]
                if candidates and all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.\-/]*", text(value)) for value in candidates):
                    mapped["code"] = name_col-1
                    blank_code_header = True
            if all(mapped[key] is not None for key in ("sequence", "customer", "code", "name")) and any(mapped[key] is not None for key in ("gross", "net", "net_net")):
                header_index, columns = index, mapped
                break
        if header_index is None:
            continue
        found = True
        notes = brand_notes(values)
        for row_index in range(header_index + 1, len(values)):
            row = values[row_index]

            def cell(key, inherit=False):
                column = columns.get(key)
                if column is None:
                    return None
                raw = row[column] if column < len(row) else None
                if inherit and raw in (None, ""):
                    for r1, r2, c1, c2 in merges:
                        if r1 <= row_index < r2 and c1 <= column < c2:
                            return values[r1][c1] if c1 < len(values[r1]) else None
                return raw

            sequence = positive(cell("sequence", True))
            if sequence is None or not sequence.is_integer():
                continue
            name = text(cell("name"))
            code = re.sub(r"\s+", "", text(cell("code", True)))
            raw_code = code
            code = re.sub(r"[（(]\d+箱/(?:卡板|托板|托盘)[）)]$", "", code)
            if re.match(r"^(?:品牌\s*[:：]|合计(?:[:：]|$)|总计(?:[:：]|$))", name) or re.fullmatch(r"\d+\s*个?(?:卡板|托板|托盘)", name):
                continue
            if not name and cell("sequence") in (None, "") and cell("code") in (None, ""):
                continue
            if not code and cell("sequence") in (None, ""):
                continue
            if code and not re.match(r"[A-Za-z0-9]", code):
                continue
            warnings = []
            if not code:
                warnings.append("货号为空，请核对")
            if not name:
                warnings.append("货名为空，请核对")
            if blank_code_header:
                warnings.append("货号列表头为空，按合同与货名之间的独立列提取，请核对")
            if combined_header:
                warnings.append("货号与货名共用表头，已按两列拆读，请核对")
            if code != raw_code:
                warnings.append("已移除货号后的卡板包装说明，请核对")
            if code and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.\-/]*", code):
                warnings.append("货号含附加说明，请人工核对")
            specs = list(SPEC.finditer(name))
            quantities = {int(match[1]) for match in specs if int(match[1]) > 0}
            explicit_spec = cell("spec")
            separate = positive(explicit_spec)
            if separate is not None and separate.is_integer():
                quantities.add(int(separate))
            elif explicit_spec:
                quantities.update(int(match[1]) for match in SPEC.finditer(text(explicit_spec)) if int(match[1]) > 0)
            spec = next(iter(quantities)) if len(quantities) == 1 else None
            if spec is None:
                warnings.append("装箱规格不明确，请核对每箱个数" if len(quantities) <= 1 else "存在多个装箱规格，请人工核对")
            if len(specs) == 1 and spec == int(specs[0][1]):
                name = (name[:specs[0].start()] + name[specs[0].end():]).strip(" \t\n，,；;（）()")
            pieces_col = columns.get("pieces")
            if any(r1 <= row_index < r2 and r2-r1 > 1 and pieces_col is not None and c1 <= pieces_col < c2 for r1, r2, c1, c2 in merges):
                warnings.append("件数为跨行共用，装箱规格及每箱重量需人工核对")
            customer = text(cell("customer", True))
            if not customer:
                warnings.append("客户为空，请核对")
            gross, net, net_net = (positive(cell(key)) for key in ("gross", "net", "net_net"))
            if gross is None:
                warnings.append("每箱毛重缺失或无效，未使用合计毛重代替")
            if net is None and net_net is None:
                warnings.append("每箱净重缺失或无效，未使用合计净重代替")
            dim_col = columns.get("dimensions")
            raw_dim = list(row[dim_col:dim_col+3]) if dim_col is not None else []
            result.append({"filename": filename, "sheetName": sheet_name, "rowNumber": row_index + 1,
                           "customer": customer, "productCode": code, "productName": name, "quantityPerBox": spec,
                           "toyCategory": text(cell("category")), "grossWeightPerBox": gross, "netWeightPerBox": net,
                           "netNetWeightPerBox": net_net, "boxDimensions": product_dimensions(code, raw_dim, values, warnings),
                           "brand": product_brand(code, notes, warnings), "warnings": warnings})
    if not found:
        raise ValueError(f"{filename} 未识别到走柜表表头，请核对客户、货号、货名及每箱重量列")
    return result
