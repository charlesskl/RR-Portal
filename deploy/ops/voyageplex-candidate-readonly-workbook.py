"""Value-only openpyxl 3.1.5 reader with bounded, streaming date-style metadata.

Only .value / iter_rows(values_only=True) are supported by this helper. Editable
and export workbooks must continue using ordinary openpyxl.load_workbook.
"""
from array import array
from xml.parsers import expat

import openpyxl
from openpyxl.reader.excel import ExcelReader
from openpyxl.styles.numbers import builtin_format_code, is_date_format, is_timedelta_format
from openpyxl.xml.constants import ARC_STYLE, SHEET_MAIN_NS

_STYLE_ERROR = "XLSX value style metadata is invalid or exceeds safe limits"


def _read_value_styles(archive, workbook):
    """Match Stylesheet._normalise_numbers' date/style-index decisions only.

    WorkSheetParser's value conversion uses these two sets and workbook.epoch.
    It does not need fonts, fills, borders, alignment, images, or StyleArrays.
    All other workbook/worksheet/shared-string reading remains in openpyxl.
    """
    try:
        info = archive.getinfo(ARC_STYLE)
    except KeyError:
        return
    maximum = 64 * 1024 * 1024
    namespace = SHEET_MAIN_NS + "}"
    root, formats, number, styles, style = (namespace + name for name in
                                          ("styleSheet", "numFmts", "numFmt", "cellXfs", "xf"))
    stack, custom, style_ids = [], {}, array("I")
    nodes = format_count = 0
    containers = set()

    def invalid(*_):
        raise ValueError(_STYLE_ERROR)

    def number_id(value):
        if not isinstance(value, str) or len(value) > 32:
            invalid()
        result = int(value)
        if not 0 <= result <= 0xFFFFFFFF:
            invalid()
        return result

    def start(tag, attrs):
        nonlocal nodes, format_count
        nodes += 1
        if nodes > 2000000 or len(stack) >= 64 or (not stack and tag != root):
            invalid()
        if tag in (formats, styles):
            if stack != [root] or tag in containers:
                invalid()
            containers.add(tag)
        if stack == [root, formats]:
            if tag != number:
                invalid()
            format_count += 1
            code = attrs.get("formatCode")
            if format_count > 100000 or not isinstance(code, str) or len(code) > 4096:
                invalid()
            custom[number_id(attrs.get("numFmtId"))] = code
        elif stack == [root, styles]:
            if tag != style or len(style_ids) >= 1000000:
                invalid()
            style_ids.append(number_id(attrs.get("numFmtId", "0")))
        stack.append(tag)

    def end(tag):
        if not stack or stack.pop() != tag:
            invalid()

    try:
        if not 0 < info.file_size <= maximum or not 0 <= info.compress_size <= maximum:
            invalid()
        parser = expat.ParserCreate(namespace_separator="}")
        parser.StartElementHandler, parser.EndElementHandler = start, end
        parser.StartDoctypeDeclHandler = invalid
        parser.EntityDeclHandler = invalid
        parser.ExternalEntityRefHandler = invalid
        consumed = 0
        with archive.open(ARC_STYLE) as stream:
            while True:
                chunk = stream.read(min(32768, maximum - consumed + 1))
                consumed += len(chunk)
                if consumed > maximum:
                    invalid()
                parser.Parse(chunk, not chunk)
                if not chunk:
                    break
        if stack or consumed != info.file_size:
            invalid()
        if not style_ids:
            return  # Standard reader keeps workbook defaults when cellXfs is empty.
        date_formats, timedelta_formats, kinds = set(), set(), {}
        for index, format_id in enumerate(style_ids):
            if format_id not in kinds:
                code = custom.get(format_id, builtin_format_code(format_id))
                kinds[format_id] = is_date_format(code), is_timedelta_format(code)
            date, duration = kinds[format_id]
            if date:
                date_formats.add(index)
            if duration:
                timedelta_formats.add(index)
        workbook._date_formats, workbook._timedelta_formats = date_formats, timedelta_formats
    except MemoryError:
        raise
    except Exception:
        raise ValueError(_STYLE_ERROR) from None


class _ValuesExcelReader(ExcelReader):
    def read(self):
        # openpyxl 3.1.5 ExcelReader.read order, with only its stylesheet step
        # replaced locally. No process-global monkeypatch or editable reader.
        try:
            self.read_manifest()
            self.read_strings()
            self.read_workbook()
            self.read_properties()
            self.read_custom()
            self.read_theme()
            _read_value_styles(self.archive, self.wb)
            self.read_worksheets()
            self.parser.assign_names()
        except BaseException:
            self.archive.close()
            raise


def load_values_workbook(filename):
    """Return a read-only, cached-value workbook; caller must close in finally."""
    if openpyxl.__version__ != "3.1.5":
        raise RuntimeError("Value-only workbook reader requires reviewed openpyxl 3.1.5")
    reader = _ValuesExcelReader(filename, read_only=True, keep_vba=False,
                                data_only=True, keep_links=True, rich_text=False)
    reader.read()
    return reader.wb
