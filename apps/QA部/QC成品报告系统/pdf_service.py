from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas
from sqlalchemy import select


PAGE_W, PAGE_H = A4
MARGIN = 38
BLUE = colors.HexColor("#165DFF")
NAVY = colors.HexColor("#17324D")
INK = colors.HexColor("#172333")
MUTED = colors.HexColor("#667085")
PALE = colors.HexColor("#EAF1F8")
GREEN = colors.HexColor("#067647")
AMBER = colors.HexColor("#B54708")
RED = colors.HexColor("#B42318")

try:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
except Exception:
    pass


def _font(language: str) -> str:
    return "STSong-Light" if language == "bilingual" else "Helvetica"


def _bold(language: str) -> str:
    return "STSong-Light" if language == "bilingual" else "Helvetica-Bold"


def _label(en: str, zh: str, language: str) -> str:
    return f"{zh} / {en}" if language == "bilingual" else en


def _safe(value, fallback="-") -> str:
    if value is None or value == "":
        return fallback
    return str(value)


def _wrap(text: str, font: str, size: float, width: float) -> list[str]:
    text = _safe(text, "")
    if not text:
        return [""]
    words = list(text) if font == "STSong-Light" else text.split(" ")
    joiner = "" if font == "STSong-Light" else " "
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else current + joiner + word
        if pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def _text(c, x, y, text, language="en", size=8, bold=False, color=INK, max_width=None, leading=None):
    rendered = str(text)
    contains_cjk = any(ord(char) > 255 for char in rendered)
    font = "STSong-Light" if contains_cjk else (_bold(language) if bold else _font(language))
    c.setFont(font, size)
    c.setFillColor(color)
    leading = leading or size * 1.25
    lines = _wrap(rendered, font, size, max_width) if max_width else rendered.splitlines()
    for index, line in enumerate(lines):
        c.drawString(x, y - index * leading, line)
    return y - len(lines) * leading


def _header(c, company: str, report_title: str, logo_path: str | None, language: str, page: int, modern=False):
    has_logo = bool(logo_path and Path(logo_path).is_file())
    if modern:
        c.setFillColor(NAVY)
        c.rect(0, PAGE_H - 82, PAGE_W, 82, fill=1, stroke=0)
        text_x = MARGIN + 46 if has_logo else MARGIN
        if has_logo:
            c.drawImage(logo_path, MARGIN, PAGE_H - 66, 36, 36, preserveAspectRatio=True, mask="auto")
        _text(c, text_x, PAGE_H - 31, company, language, 11, True, colors.white)
        title = _label(report_title, "质量检验报告", language)
        _text(c, text_x, PAGE_H - 54, title, language, 18, True, colors.white)
        _text(c, PAGE_W - 92, PAGE_H - 49, f"{page:02d}", language, 16, True, colors.white)
    else:
        if has_logo:
            c.drawImage(logo_path, MARGIN, PAGE_H - 54, 28, 28, preserveAspectRatio=True, mask="auto")
        _text(c, PAGE_W / 2 - 115, PAGE_H - 34, company, language, 10.5, True, INK)
        title = _label(report_title, "质量检验报告", language)
        _text(c, PAGE_W / 2 - 100, PAGE_H - 51, title, language, 11, True, INK)
        c.setStrokeColor(colors.HexColor("#9AA4B2"))
        c.line(MARGIN, PAGE_H - 62, PAGE_W - MARGIN, PAGE_H - 62)


def _box(c, x, y, w, h, fill=colors.white, stroke=colors.HexColor("#667085"), radius=0):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.6)
    if radius:
        c.roundRect(x, y - h, w, h, radius, fill=1, stroke=1)
    else:
        c.rect(x, y - h, w, h, fill=1, stroke=1)


def _field(c, x, y, w, label, value, language, h=30, accent=False):
    _box(c, x, y, w, h, PALE if accent else colors.white, colors.HexColor("#98A2B3"))
    _text(c, x + 6, y - 10, label, language, 6.8, True, MUTED, w - 12)
    _text(c, x + 6, y - 22, _safe(value), language, 8.7, True, INK, w - 12)


def _section(c, y, title, language, modern=False):
    if modern:
        _text(c, MARGIN, y, title, language, 12, True, NAVY)
        c.setFillColor(BLUE)
        c.roundRect(MARGIN, y - 8, 30, 3, 1.5, fill=1, stroke=0)
        return y - 20
    c.setFillColor(PALE)
    c.setStrokeColor(colors.HexColor("#667085"))
    c.rect(MARGIN, y - 20, PAGE_W - MARGIN * 2, 20, fill=1, stroke=1)
    _text(c, MARGIN + 6, y - 14, title, language, 8.5, True, INK)
    return y - 20


def _photo(c, path: str | None, x, y, w, h, caption, language):
    _box(c, x, y, w, h, colors.HexColor("#F8FAFC"), colors.HexColor("#D0D5DD"), 3)
    inner_h = h - 18
    if path and Path(path).is_file():
        try:
            image = ImageReader(path)
            iw, ih = image.getSize()
            scale = min((w - 8) / iw, (inner_h - 6) / ih)
            draw_w, draw_h = iw * scale, ih * scale
            c.drawImage(image, x + (w - draw_w) / 2, y - h + 17 + (inner_h - draw_h) / 2, draw_w, draw_h, preserveAspectRatio=True, mask="auto")
        except Exception:
            _text(c, x + 8, y - h / 2, _label("Image unavailable", "图片不可用", language), language, 7, False, MUTED)
    else:
        _text(c, x + 8, y - h / 2, _label("No photo", "暂无照片", language), language, 7, False, MUTED)
    _text(c, x + 5, y - h + 6, caption, language, 6.5, False, MUTED, w - 10)


def _result_color(result: str):
    return GREEN if result == "PASS" else RED if result == "REJECT" else AMBER


def _query_data(db, report):
    from app import Defect, Photo, TestResult, User, json_load

    photos = list(db.scalars(select(Photo).where(Photo.report_id == report.id).order_by(Photo.category, Photo.sort_order)).all())
    defects = list(db.scalars(select(Defect).where(Defect.report_id == report.id).order_by(Defect.id)).all())
    tests = list(db.scalars(select(TestResult).where(TestResult.report_id == report.id).order_by(TestResult.sort_order)).all())
    inspector = db.get(User, report.inspector_id)
    return json_load(report.product_snapshot), json_load(report.packing_snapshot), photos, defects, tests, inspector


def _rule_data(db, report):
    from app import find_aql_rules

    return find_aql_rules(db, report)


def generate_report_pdf(db, report, destination: Path, template: str, language: str, company: str, report_title: str = "QUALITY INSPECTION REPORT", logo_path: str | None = None):
    if template not in {"legacy", "modern"} or language not in {"en", "bilingual"}:
        raise ValueError("Unsupported report output")
    destination.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(destination), pagesize=A4, pageCompression=1)
    c.setTitle(f"{report.report_no} Rev.{report.revision} {template} {language}")
    data = _query_data(db, report)
    if template == "legacy":
        _legacy(c, db, report, language, company, report_title, logo_path, *data)
    else:
        _modern(c, db, report, language, company, report_title, logo_path, *data)
    c.save()


def _legacy(c, db, report, language, company, report_title, logo_path, product, packing, photos, defects, tests, inspector):
    rules = _rule_data(db, report)
    # Page 1 - inspection summary
    _header(c, company, report_title, logo_path, language, 1)
    y = PAGE_H - 76
    _text(c, MARGIN, y, _label("Pre-Shipment Inspection Report", "出货前检验报告", language), language, 16, True, INK)
    y -= 26
    width = PAGE_W - 2 * MARGIN
    left = width * 0.70
    _field(c, MARGIN, y, left / 2, _label("Factory", "工厂", language), company, language, 34)
    _field(c, MARGIN + left / 2, y, left / 2, _label("Customer", "客户", language), product.get("customer_name"), language, 34)
    _box(c, MARGIN + left + 6, y, width - left - 6, 76, colors.white, colors.HexColor("#98A2B3"))
    _text(c, MARGIN + left + 14, y - 15, _label("Result", "结果", language), language, 7.5, True, MUTED)
    _text(c, MARGIN + left + 14, y - 50, report.result, language, 22, True, _result_color(report.result))
    y -= 38
    _field(c, MARGIN, y, left / 2, _label("Country", "国家", language), product.get("country"), language, 38)
    _field(c, MARGIN + left / 2, y, left / 2, _label("Inspection date", "检验日期", language), report.inspection_date.isoformat(), language, 38)
    y -= 52
    y = _section(c, y, _label("GENERAL INFORMATION", "基本信息", language), language)
    cells = [
        (_label("P.O. No.", "订单号", language), product.get("po_no")),
        (_label("P.O. Qty", "订单数量", language), f"{product.get('po_quantity')} PCS"),
        (_label("Item No.", "产品编号", language), product.get("item_no")),
        (_label("Description", "产品名称", language), product.get("description")),
        (_label("Batch code", "日期码", language), product.get("date_code")),
        (_label("Cartons", "箱数", language), f"{packing.get('carton_count', 0)} CTNS"),
        (_label("Age grade", "适用年龄", language), product.get("age_grade")),
        (_label("Completed", "完成比例", language), f"{report.completed_pct}%"),
        (_label("Sample size", "样本量", language), f"{report.sample_size} PCS"),
        (_label("Inspected", "实检数量", language), f"{report.inspected_qty} PCS"),
    ]
    col_w = width / 2
    for i, (label, value) in enumerate(cells):
        row, col = divmod(i, 2)
        _field(c, MARGIN + col * col_w, y - row * 29, col_w, label, value, language, 29)
    y -= 5 * 29 + 14
    y = _section(c, y, _label("SAMPLING & DEFECTS", "抽样与缺陷", language), language)
    headers = [(_label("Class", "级别", language), 0.23), ("AQL", 0.16), ("Ac", 0.12), ("Re", 0.12), (_label("Found", "发现", language), 0.14), (_label("Decision", "判定", language), 0.23)]
    x = MARGIN
    for label, fraction in headers:
        _field(c, x, y, width * fraction, label, label, language, 26, True)
        x += width * fraction
    y -= 26
    for severity in ("critical", "major", "minor"):
        rule = rules.get(severity)
        values = [severity.title(), getattr(report, f"{severity}_aql"), rule.accept if rule else "-", rule.reject if rule else "-", getattr(report, f"{severity}_count"), "OK" if rule and getattr(report, f"{severity}_count") <= rule.accept else "CHECK"]
        x = MARGIN
        for (label, fraction), value in zip(headers, values):
            _field(c, x, y, width * fraction, label, value, language, 25)
            x += width * fraction
        y -= 25
    y -= 10
    left_w = width * 0.54
    _text(c, MARGIN, y, _label("Defect description", "缺陷描述", language), language, 8, True, INK)
    _text(c, MARGIN + left_w + 12, y, _label("Performance & reliability", "性能与可靠性", language), language, 8, True, INK)
    y -= 10
    _box(c, MARGIN, y, left_w, 115, colors.white, colors.HexColor("#98A2B3"))
    for idx, defect in enumerate(defects[:5]):
        _text(c, MARGIN + 7, y - 16 - idx * 18, f"{defect.severity.upper()} x{defect.quantity}  {defect.description}", language, 7.5, False, INK, left_w - 14)
    right_x = MARGIN + left_w + 12
    _box(c, right_x, y, width - left_w - 12, 115, colors.white, colors.HexColor("#98A2B3"))
    for idx, test in enumerate(tests[:6]):
        _text(c, right_x + 6, y - 14 - idx * 17, f"{test.name} | {test.standard} | {test.result or '-'}", language, 6.5, False, INK, width - left_w - 24)
    c.showPage()

    # Page 2 - product and packing specification
    _header(c, company, report_title, logo_path, language, 2)
    y = PAGE_H - 78
    y = _section(c, y, _label("PRODUCT SPECIFICATION", "产品规格", language), language)
    fields = [
        (_label("Product size (mm)", "产品尺寸", language), product.get("size_mm")),
        (_label("Product weight", "产品重量", language), f"N.W. {_safe(product.get('net_weight_kg'))} kg / G.W. {_safe(product.get('gross_weight_kg'))} kg"),
        (_label("Date code", "日期码", language), product.get("date_code")),
        (_label("UPC / EAN barcode", "条码", language), product.get("barcode")),
        (_label("Assortment ratio", "配比", language), packing.get("assortment_ratio")),
        (_label("Individual packaging", "单品包装", language), packing.get("individual_packaging")),
        (_label("Marks", "标识", language), ", ".join(packing.get("marks", []))),
        (_label("Country of origin", "原产国", language), product.get("origin")),
    ]
    for label, value in fields:
        _field(c, MARGIN, y, width, label, value, language, 38)
        y -= 38
    y -= 14
    y = _section(c, y, _label("PACKING - MASTER CARTON", "包装 - 外箱", language), language)
    pack_fields = [
        (_label("Dimension", "外箱尺寸", language), report.master_carton_dimension),
        (_label("Carton weight", "外箱重量", language), f"N.W. {_safe(report.master_carton_nw)} kg / G.W. {_safe(report.master_carton_gw)} kg"),
        (_label("Outer carton barcode", "外箱条码", language), report.outer_carton_barcode),
        (_label("Case pack", "装箱数", language), f"{packing.get('case_pack', 0)} PCS"),
        (_label("Date code", "日期码", language), product.get("date_code")),
        (_label("Remarks", "备注", language), report.remarks),
    ]
    for label, value in pack_fields:
        _field(c, MARGIN, y, width, label, value, language, 38)
        y -= 38
    c.showPage()

    # Page 3 - product and packaging photos
    _header(c, company, report_title, logo_path, language, 3)
    y = PAGE_H - 78
    y = _section(c, y, _label("PHOTOS - PRODUCT & PACKAGING", "照片 - 产品与包装", language), language)
    selected = [p for p in photos if p.category in {"product", "marking", "date_code", "packaging", "barcode", "instruction"}]
    cell_w = (width - 10) / 2
    cell_h = 155
    for index in range(8):
        row, col = divmod(index, 2)
        top = y - row * (cell_h + 8)
        photo = selected[index] if index < len(selected) else None
        caption = (photo.caption or PHOTO_CAPTION(photo.category, language)) if photo else _label("Photo slot", "照片位置", language)
        _photo(c, photo.file_path if photo else None, MARGIN + col * (cell_w + 10), top, cell_w, cell_h, caption, language)
    c.showPage()

    # Page 4 - defect and carton photos
    _header(c, company, report_title, logo_path, language, 4)
    y = PAGE_H - 78
    y = _section(c, y, _label("DEFECT & CARTON PHOTOS", "缺陷与外箱照片", language), language)
    selected = [p for p in photos if p.category in {"defect", "carton", "barcode", "date_code", "other"}]
    for index in range(6):
        row, col = divmod(index, 2)
        top = y - row * 205
        photo = selected[index] if index < len(selected) else None
        caption = (photo.caption or PHOTO_CAPTION(photo.category, language)) if photo else _label("Photo slot", "照片位置", language)
        _photo(c, photo.file_path if photo else None, MARGIN + col * (cell_w + 10), top, cell_w, 190, caption, language)
    c.showPage()

    # Page 5 - warehouse and signatures
    _header(c, company, report_title, logo_path, language, 5)
    y = PAGE_H - 82
    y = _section(c, y, _label("PICTURES OF ALL GOODS IN WAREHOUSE", "仓库存货照片", language), language)
    warehouses = [p for p in photos if p.category == "warehouse"]
    for index in range(2):
        photo = warehouses[index] if index < len(warehouses) else None
        _photo(c, photo.file_path if photo else None, MARGIN + index * ((width - 10) / 2 + 10), y, (width - 10) / 2, 260, photo.caption if photo else _label("Warehouse photo", "仓库照片", language), language)
    y -= 300
    _text(c, MARGIN, y, _label("Inspected by", "检验员", language), language, 9, True, INK)
    _text(c, MARGIN + 88, y, inspector.name, language, 11, True, INK)
    _text(c, MARGIN + 250, y, _label("Signed at", "签署时间", language), language, 9, True, INK)
    _text(c, MARGIN + 328, y, report.signed_at.strftime("%Y-%m-%d %H:%M") if report.signed_at else "-", language, 9, False, INK)
    if report.signature_path and Path(report.signature_path).is_file():
        c.drawImage(report.signature_path, MARGIN + 82, y - 62, 150, 58, preserveAspectRatio=True, mask="auto")
    _text(c, MARGIN, y - 95, f"{report.report_no} | Rev.{report.revision} | {report.result}", language, 8, False, MUTED)
    c.showPage()


def PHOTO_CAPTION(category: str, language: str) -> str:
    labels = {
        "product": ("Product", "产品"),
        "marking": ("Product marking", "产品标识"),
        "date_code": ("Date code", "日期码"),
        "packaging": ("Packaging", "包装"),
        "barcode": ("Barcode", "条码"),
        "defect": ("Defect", "缺陷"),
        "carton": ("Carton", "外箱"),
        "warehouse": ("Warehouse", "仓库"),
        "instruction": ("Instruction", "说明书"),
        "other": ("Other", "其他"),
    }
    en, zh = labels.get(category, (category.title(), category))
    return _label(en, zh, language)


def _modern(c, db, report, language, company, report_title, logo_path, product, packing, photos, defects, tests, inspector):
    rules = _rule_data(db, report)
    width = PAGE_W - MARGIN * 2

    # Page 1 - executive summary
    _header(c, company, report_title, logo_path, language, 1, modern=True)
    y = PAGE_H - 110
    _text(c, MARGIN, y, f"{report.report_no}  ·  Rev.{report.revision}", language, 9, False, MUTED)
    _text(c, MARGIN, y - 28, _label("Pre-shipment inspection", "出货前检验", language), language, 22, True, NAVY)
    _box(c, PAGE_W - MARGIN - 145, y + 8, 145, 55, colors.HexColor("#ECFDF3") if report.result == "PASS" else colors.HexColor("#FEF3F2") if report.result == "REJECT" else colors.HexColor("#FFFAEB"), _result_color(report.result), 8)
    _text(c, PAGE_W - MARGIN - 129, y - 3, _label("Final result", "最终结果", language), language, 7, True, MUTED)
    _text(c, PAGE_W - MARGIN - 129, y - 31, report.result, language, 20, True, _result_color(report.result))
    y -= 70
    y = _section(c, y, _label("Inspection overview", "检验概览", language), language, True)
    cards = [
        (_label("Customer", "客户", language), product.get("customer_name")),
        (_label("P.O.", "订单", language), product.get("po_no")),
        (_label("Item", "产品编号", language), product.get("item_no")),
        (_label("Order qty", "订单数量", language), f"{product.get('po_quantity')} PCS"),
        (_label("Inspection date", "检验日期", language), report.inspection_date.isoformat()),
        (_label("Inspector", "检验员", language), inspector.name),
    ]
    gap = 8
    card_w = (width - gap * 2) / 3
    for index, (label, value) in enumerate(cards):
        row, col = divmod(index, 3)
        _field(c, MARGIN + col * (card_w + gap), y - row * 58, card_w, label, value, language, 50)
    y -= 130
    y = _section(c, y, _label("AQL decision", "AQL 判定", language), language, True)
    col_w = width / 3
    for index, severity in enumerate(("critical", "major", "minor")):
        rule = rules.get(severity)
        count = getattr(report, f"{severity}_count")
        _box(c, MARGIN + index * col_w, y, col_w - 8, 94, colors.white, colors.HexColor("#D0D5DD"), 8)
        _text(c, MARGIN + index * col_w + 10, y - 18, severity.upper(), language, 8, True, MUTED)
        _text(c, MARGIN + index * col_w + 10, y - 50, str(count), language, 24, True, INK)
        rule_text = f"AQL {getattr(report, f'{severity}_aql')} · Ac {rule.accept if rule else '-'} / Re {rule.reject if rule else '-'}"
        _text(c, MARGIN + index * col_w + 10, y - 74, rule_text, language, 7, False, MUTED)
    y -= 122
    y = _section(c, y, _label("Defects & remarks", "缺陷与备注", language), language, True)
    if defects:
        for index, defect in enumerate(defects[:6]):
            _text(c, MARGIN, y - index * 22, f"{defect.severity.upper()}  ×{defect.quantity}   {defect.description}", language, 8.5, False, INK, width)
    else:
        _text(c, MARGIN, y, _label("No defects recorded", "未记录缺陷", language), language, 9, False, MUTED)
    _text(c, MARGIN, y - 150, report.result_reason, language, 7.5, False, _result_color(report.result), width)
    c.showPage()

    # Page 2 - specifications and tests
    _header(c, company, report_title, logo_path, language, 2, modern=True)
    y = PAGE_H - 110
    y = _section(c, y, _label("Product & packing", "产品与包装", language), language, True)
    spec = [
        (_label("Description", "产品名称", language), product.get("description")),
        (_label("Size", "尺寸", language), product.get("size_mm")),
        (_label("Product weight", "产品重量", language), f"N.W. {_safe(product.get('net_weight_kg'))} / G.W. {_safe(product.get('gross_weight_kg'))} kg"),
        (_label("Barcode", "条码", language), product.get("barcode")),
        (_label("Date code", "日期码", language), product.get("date_code")),
        (_label("Master carton", "外箱尺寸", language), report.master_carton_dimension),
        (_label("Carton weight", "外箱重量", language), f"N.W. {_safe(report.master_carton_nw)} / G.W. {_safe(report.master_carton_gw)} kg"),
        (_label("Case pack", "装箱数", language), f"{packing.get('case_pack', 0)} PCS"),
    ]
    for index, (label, value) in enumerate(spec):
        row, col = divmod(index, 2)
        _field(c, MARGIN + col * (width / 2), y - row * 46, width / 2, label, value, language, 40)
    y -= 210
    y = _section(c, y, _label("Performance & reliability", "性能与可靠性", language), language, True)
    _box(c, MARGIN, y, width, 230, colors.white, colors.HexColor("#D0D5DD"), 6)
    for index, test in enumerate(tests[:10]):
        row_y = y - 20 - index * 20
        if index:
            c.setStrokeColor(colors.HexColor("#EAECF0"))
            c.line(MARGIN + 8, row_y + 8, PAGE_W - MARGIN - 8, row_y + 8)
        _text(c, MARGIN + 10, row_y, test.name, language, 7.5, True, INK, 180)
        _text(c, MARGIN + 220, row_y, test.standard, language, 7.5, False, MUTED, 140)
        result_color = GREEN if test.result.upper() == "PASS" else MUTED
        _text(c, PAGE_W - MARGIN - 70, row_y, test.result or "-", language, 8, True, result_color)
    c.showPage()

    # Remaining pages - photos and sign-off
    photos_per_page = 6
    chunks = [photos[i : i + photos_per_page] for i in range(0, len(photos), photos_per_page)] or [[]]
    for page_index, chunk in enumerate(chunks, start=3):
        _header(c, company, report_title, logo_path, language, page_index, modern=True)
        y = PAGE_H - 110
        y = _section(c, y, _label("Inspection evidence", "检验照片", language), language, True)
        cell_w = (width - 10) / 2
        for index in range(photos_per_page):
            row, col = divmod(index, 2)
            top = y - row * 205
            photo = chunk[index] if index < len(chunk) else None
            caption = (photo.caption or PHOTO_CAPTION(photo.category, language)) if photo else _label("Photo slot", "照片位置", language)
            _photo(c, photo.file_path if photo else None, MARGIN + col * (cell_w + 10), top, cell_w, 190, caption, language)
        if page_index == 3:
            _text(c, MARGIN, 68, _label("Electronically signed by", "电子签名", language) + f": {inspector.name}", language, 8, True, NAVY)
            if report.signature_path and Path(report.signature_path).is_file():
                c.drawImage(report.signature_path, MARGIN + 150, 40, 125, 38, preserveAspectRatio=True, mask="auto")
            _text(c, PAGE_W - 220, 56, report.signed_at.strftime("%Y-%m-%d %H:%M") if report.signed_at else "-", language, 7, False, MUTED)
        c.showPage()
