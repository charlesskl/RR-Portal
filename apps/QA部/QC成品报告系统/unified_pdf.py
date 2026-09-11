"""Standalone generator for the unified English AI-assisted QC report.

The public :func:`generate_unified_report_pdf` function intentionally accepts a
plain, normalized mapping so it can be called from Flask, a worker, or a test
without importing the application's ORM models.  The expected top-level keys
are ``report_no``, ``revision``, ``company_name``, ``report_title``,
``inspection_date``, ``result``, ``result_reason``, ``overview``, ``aql``,
``defects``, ``tests``, ``product``, ``packing``, ``remarks``, ``photo_slots``
(or flat ``photos``), and ``inspector``.  Missing optional values render as
``-`` rather than being invented.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from math import ceil
from pathlib import Path
import re
from typing import Any, Iterable, Mapping, Sequence

from PIL import Image, ImageOps
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


__all__ = ["generate_unified_report_pdf"]

PAGE_W, PAGE_H = A4
MARGIN = 34
CONTENT_W = PAGE_W - MARGIN * 2

NAVY = colors.HexColor("#15324A")
BLUE = colors.HexColor("#1E66F5")
SKY = colors.HexColor("#EAF2FF")
INK = colors.HexColor("#182230")
MUTED = colors.HexColor("#667085")
LINE = colors.HexColor("#C7D0DC")
PALE = colors.HexColor("#F5F8FC")
GREEN = colors.HexColor("#067647")
GREEN_BG = colors.HexColor("#ECFDF3")
AMBER = colors.HexColor("#B54708")
AMBER_BG = colors.HexColor("#FFFAEB")
RED = colors.HexColor("#B42318")
RED_BG = colors.HexColor("#FEF3F2")
WHITE = colors.white

try:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
except Exception:
    # The CID font is bundled with ReportLab.  Registration may already have
    # happened elsewhere in the process, which is safe to ignore.
    pass


@dataclass(frozen=True)
class _Evidence:
    title: str
    caption: str
    path: str | None
    required: bool = False
    sample_id: str = ""
    category: str = ""


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _first(data: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = data.get(key)
        if value is not None and value != "":
            return value
    return default


def _text_value(value: Any, fallback: str = "-") -> str:
    if value is None or value == "":
        return fallback
    if isinstance(value, bool):
        return "YES" if value else "NO"
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ", timespec="minutes") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, (list, tuple, set)):
        rendered = ", ".join(_text_value(item, "") for item in value if item not in (None, ""))
        return rendered or fallback
    return str(value)


def _contains_cjk(text: str) -> bool:
    return any("\u2e80" <= char <= "\u9fff" or "\uf900" <= char <= "\ufaff" for char in text)


def _english_text(value: Any, fallback: str = "-") -> str:
    """Return an English-only display label without inventing a translation."""
    rendered = _text_value(value, "").strip()
    if not rendered:
        return fallback
    if not _contains_cjk(rendered):
        return rendered
    for part in reversed(re.split(r"\s*(?:/|｜|\|)\s*", rendered)):
        candidate = part.strip()
        if candidate and re.search(r"[A-Za-z]", candidate) and not _contains_cjk(candidate):
            return candidate
    ascii_only = re.sub(r"\s+", " ", "".join(char if ord(char) < 128 else " " for char in rendered)).strip(" -/|")
    return ascii_only if re.search(r"[A-Za-z]", ascii_only) else fallback


def _photo_label_fallback(category: Any) -> str:
    return {
        "product": "Product",
        "marking": "Product marking",
        "date_code": "Date code",
        "packaging": "Packaging",
        "barcode": "Barcode",
        "defect": "Defect evidence",
        "carton": "Carton",
        "warehouse": "Warehouse stock",
        "instruction": "Instruction",
    }.get(_text_value(category, "").strip().lower(), "Photo evidence")


def _percentage_value(value: Any) -> str:
    rendered = _text_value(value, "-").strip()
    if rendered == "-":
        return rendered
    return rendered if rendered.endswith("%") else f"{rendered}%"


def _weight_value(value: Any) -> str:
    rendered = _text_value(value, "-").strip()
    if rendered == "-":
        return rendered
    return rendered if re.search(r"\bkgs?\b", rendered, re.IGNORECASE) else f"{rendered} kg"


def _timestamp_value(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="minutes")
    rendered = _text_value(value, "-").strip()
    if rendered == "-":
        return rendered
    try:
        parsed = datetime.fromisoformat(rendered.replace("Z", "+00:00"))
    except ValueError:
        return rendered
    return parsed.isoformat(sep=" ", timespec="minutes")


def _font(text: Any = "", bold: bool = False) -> str:
    return "STSong-Light" if _contains_cjk(_text_value(text, "")) else ("Helvetica-Bold" if bold else "Helvetica")


def _split_long_token(token: str, font_name: str, size: float, width: float) -> list[str]:
    pieces: list[str] = []
    current = ""
    for char in token:
        candidate = current + char
        if current and pdfmetrics.stringWidth(candidate, font_name, size) > width:
            pieces.append(current)
            current = char
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces or [token]


def _wrap(text: Any, width: float, size: float, bold: bool = False) -> list[str]:
    rendered = _text_value(text, "").replace("\r", " ").replace("\n", " ").strip()
    if not rendered:
        return [""]
    font_name = _font(rendered, bold)
    tokens = list(rendered) if _contains_cjk(rendered) else rendered.split()
    joiner = "" if _contains_cjk(rendered) else " "
    lines: list[str] = []
    current = ""
    for raw_token in tokens:
        token_parts = (
            _split_long_token(raw_token, font_name, size, width)
            if pdfmetrics.stringWidth(raw_token, font_name, size) > width
            else [raw_token]
        )
        for token in token_parts:
            candidate = token if not current else current + joiner + token
            if not current or pdfmetrics.stringWidth(candidate, font_name, size) <= width:
                current = candidate
            else:
                lines.append(current)
                current = token
    if current:
        lines.append(current)
    return lines or [""]


def _fit_lines(text: Any, width: float, size: float, max_lines: int, bold: bool = False) -> list[str]:
    lines = _wrap(text, width, size, bold)
    if len(lines) <= max_lines:
        return lines
    clipped = lines[:max_lines]
    last = clipped[-1].rstrip()
    font_name = _font(last, bold)
    while last and pdfmetrics.stringWidth(last + "...", font_name, size) > width:
        last = last[:-1]
    clipped[-1] = (last.rstrip() + "...") if last else "..."
    return clipped


def _draw_text(
    c: canvas.Canvas,
    x: float,
    y: float,
    text: Any,
    *,
    size: float = 8,
    bold: bool = False,
    color: colors.Color = INK,
    width: float | None = None,
    max_lines: int = 1,
    leading: float | None = None,
) -> float:
    rendered = _text_value(text)
    font_name = _font(rendered, bold)
    c.setFont(font_name, size)
    c.setFillColor(color)
    lines = _fit_lines(rendered, width, size, max_lines, bold) if width else rendered.splitlines()[:max_lines]
    line_height = leading or size * 1.25
    for index, line in enumerate(lines):
        c.drawString(x, y - index * line_height, line)
    return y - len(lines) * line_height


def _status_style(result: str) -> tuple[colors.Color, colors.Color]:
    upper = result.upper()
    if upper == "PASS":
        return GREEN, GREEN_BG
    if upper == "REJECT":
        return RED, RED_BG
    return AMBER, AMBER_BG


def _draw_image_contain(c: canvas.Canvas, path: str | Path | None, x: float, y: float, w: float, h: float) -> bool:
    if not path:
        return False
    image_path = Path(str(path))
    if not image_path.is_file():
        return False
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGB")
            max_side = max(image.size)
            if max_side > 3600:
                ratio = 3600 / max_side
                image = image.resize(
                    (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
                    Image.Resampling.LANCZOS,
                )
            buffer = BytesIO()
            if image.mode == "RGBA":
                image.save(buffer, format="PNG", optimize=True)
            else:
                image.save(buffer, format="JPEG", quality=95, optimize=True, subsampling=0)
            buffer.seek(0)
            reader = ImageReader(buffer)
            iw, ih = reader.getSize()
            scale = min(w / iw, h / ih)
            draw_w, draw_h = iw * scale, ih * scale
            c.drawImage(
                reader,
                x + (w - draw_w) / 2,
                y + (h - draw_h) / 2,
                draw_w,
                draw_h,
                preserveAspectRatio=True,
                mask="auto",
            )
        return True
    except Exception:
        return False


def _draw_header(c: canvas.Canvas, data: Mapping[str, Any], page_no: int, total_pages: int) -> None:
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 67, PAGE_W, 67, fill=1, stroke=0)
    logo = _first(data, "logo_path", "logo")
    has_logo = bool(logo and Path(str(logo)).is_file())
    text_x = MARGIN
    if has_logo:
        c.setFillColor(WHITE)
        c.roundRect(MARGIN, PAGE_H - 56, 40, 40, 4, fill=1, stroke=0)
        _draw_image_contain(c, logo, MARGIN + 3, PAGE_H - 53, 34, 34)
        text_x += 50
    _draw_text(c, text_x, PAGE_H - 27, _first(data, "company_name", "company", default="QUALITY CONTROL"), size=8.5, bold=True, color=WHITE, width=300)
    _draw_text(c, text_x, PAGE_H - 48, _first(data, "report_title", default="QUALITY INSPECTION REPORT"), size=15, bold=True, color=WHITE, width=330)
    report_no = _text_value(_first(data, "report_no", default="DRAFT"))
    revision = _text_value(_first(data, "revision", default=0), "0")
    _draw_text(c, PAGE_W - MARGIN - 168, PAGE_H - 28, report_no, size=8.5, bold=True, color=WHITE, width=168)
    _draw_text(c, PAGE_W - MARGIN - 168, PAGE_H - 47, f"Rev.{revision}  |  Page {page_no} of {total_pages}", size=7.5, color=colors.HexColor("#DCE7F4"), width=168)


def _draw_footer(c: canvas.Canvas, data: Mapping[str, Any], page_no: int, total_pages: int) -> None:
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(MARGIN, 35, PAGE_W - MARGIN, 35)
    _draw_text(c, MARGIN, 22, "AI-assisted observations reviewed and confirmed by QC.", size=6.5, color=MUTED, width=330)
    _draw_text(c, PAGE_W - MARGIN - 92, 22, f"{page_no} / {total_pages}", size=6.5, bold=True, color=MUTED, width=92)


def _section(c: canvas.Canvas, y: float, title: str, subtitle: str = "") -> float:
    c.setFillColor(BLUE)
    c.roundRect(MARGIN, y - 5, 28, 3, 1.5, fill=1, stroke=0)
    _draw_text(c, MARGIN, y - 17, title.upper(), size=9.5, bold=True, color=NAVY, width=330)
    if subtitle:
        _draw_text(c, PAGE_W - MARGIN - 210, y - 17, subtitle, size=6.5, color=MUTED, width=210)
    return y - 27


def _draw_key_card(c: canvas.Canvas, x: float, top: float, w: float, h: float, label: str, value: Any) -> None:
    c.setFillColor(PALE)
    c.setStrokeColor(colors.HexColor("#E0E7F0"))
    c.roundRect(x, top - h, w, h, 5, fill=1, stroke=1)
    _draw_text(c, x + 7, top - 12, label.upper(), size=5.6, bold=True, color=MUTED, width=w - 14)
    _draw_text(c, x + 7, top - 29, value, size=8.2, bold=True, color=INK, width=w - 14, max_lines=2, leading=9.5)


def _draw_grid(
    c: canvas.Canvas,
    x: float,
    top: float,
    width: float,
    col_fracs: Sequence[float],
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    row_h: float,
    header_h: float = 22,
    font_size: float = 7,
    max_lines: int = 2,
) -> float:
    col_widths = [width * fraction for fraction in col_fracs]
    total_h = header_h + row_h * max(1, len(rows))
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.55)
    c.rect(x, top - total_h, width, total_h, fill=1, stroke=1)
    c.setFillColor(SKY)
    c.rect(x, top - header_h, width, header_h, fill=1, stroke=0)
    xpos = x
    for index, col_w in enumerate(col_widths):
        if index:
            c.line(xpos, top, xpos, top - total_h)
        _draw_text(c, xpos + 5, top - 14, headers[index], size=6.3, bold=True, color=NAVY, width=col_w - 10)
        xpos += col_w
    rendered_rows = list(rows) or [["-"] * len(headers)]
    for row_index, row in enumerate(rendered_rows):
        row_top = top - header_h - row_index * row_h
        c.line(x, row_top, x + width, row_top)
        xpos = x
        for col_index, col_w in enumerate(col_widths):
            value = row[col_index] if col_index < len(row) else "-"
            is_result = headers[col_index].upper() in {"RESULT", "DECISION"}
            color = _status_style(_text_value(value))[0] if is_result else INK
            _draw_text(
                c,
                xpos + 5,
                row_top - 11,
                value,
                size=font_size,
                bold=is_result or col_index == 0,
                color=color,
                width=col_w - 10,
                max_lines=max_lines,
                leading=font_size * 1.18,
            )
            xpos += col_w
    return top - total_h


def _normalize_aql(data: Mapping[str, Any]) -> list[list[Any]]:
    source = data.get("aql")
    lookup: dict[str, Mapping[str, Any]] = {}
    if isinstance(source, Mapping):
        lookup = {str(key).lower(): _mapping(value) for key, value in source.items()}
    else:
        for raw in _list(source):
            row = _mapping(raw)
            severity = _text_value(_first(row, "severity", "class", default=""), "").lower()
            if severity:
                lookup[severity] = row
    rows: list[list[Any]] = []
    for severity in ("critical", "major", "minor"):
        row = lookup.get(severity, {})
        found = _first(row, "found", "count", "quantity", default=_first(data, f"{severity}_count", default=0))
        ac = _first(row, "ac", "accept", "acceptance", default="-")
        reject = _first(row, "re", "reject", "rejection", default="-")
        decision = _first(row, "decision", default="OK" if isinstance(found, (int, float)) and isinstance(ac, (int, float)) and found <= ac else "CHECK")
        rows.append([severity.title(), _first(row, "aql", default=_first(data, f"{severity}_aql", default="-")), ac, reject, found, decision])
    return rows


def _confirmed_defects(data: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    confirmed: list[Mapping[str, Any]] = []
    for raw in _list(data.get("defects")):
        defect = _mapping(raw)
        state = _text_value(_first(defect, "qc_status", "status", "decision", default="confirmed"), "confirmed").lower()
        if state in {"rejected", "reject", "pending", "unreviewed", "suggested"}:
            continue
        confirmed.append(defect)
    return confirmed


def _defect_rows(defects: Iterable[Mapping[str, Any]]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for defect in defects:
        severity = _text_value(_first(defect, "severity", "classification", default="minor"), "minor").lower()
        quantity = _first(defect, "quantity", "affected_quantity", "count", default=0)
        description = _first(defect, "description", "english_description", "name", default="-")
        sample_ids = _first(defect, "sample_ids", "sample_id")
        if sample_ids:
            description = f"{_text_value(description)} | Sample: {_text_value(sample_ids)}"
        rows.append([
            quantity if severity == "critical" else 0,
            quantity if severity == "major" else 0,
            quantity if severity == "minor" else 0,
            description,
        ])
    return rows or [[0, 0, 0, "No confirmed defects"]]


def _test_rows(data: Mapping[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for raw in _list(_first(data, "tests", "performance_tests", default=[])):
        test = _mapping(raw)
        rows.append([
            _first(test, "name", "test_name", default="-"),
            _first(test, "standard", "requirement", default="-"),
            _first(test, "result", default="-"),
        ])
    return rows or [["No tests recorded", "-", "-"]]


def _normalize_photos(data: Mapping[str, Any]) -> tuple[list[_Evidence], list[_Evidence]]:
    evidence: list[_Evidence] = []
    warehouses: list[_Evidence] = []
    seen: set[tuple[str, str]] = set()

    def is_warehouse(*values: Any) -> bool:
        combined = " ".join(_text_value(value, "").lower() for value in values)
        return any(token in combined for token in ("warehouse", "stock", "all goods", "storage"))

    def append_item(item: _Evidence, warehouse: bool) -> None:
        key = (item.path or "", item.title + "|" + item.caption)
        if key in seen:
            return
        seen.add(key)
        (warehouses if warehouse else evidence).append(item)

    def order_value(item: Mapping[str, Any]) -> float:
        try:
            return float(_first(item, "slot_order", "order", "sort_order", default=9999))
        except (TypeError, ValueError):
            return 9999

    raw_slots = sorted(
        [_mapping(slot) for slot in _list(data.get("photo_slots"))],
        key=lambda slot: (order_value(slot), _text_value(_first(slot, "name", "label", default=""))),
    )
    for slot in raw_slots:
        category = _text_value(_first(slot, "category", "section", default=""), "")
        slot_name = _english_text(
            _first(slot, "label", "name", "slot_name", default="Photo evidence"),
            _photo_label_fallback(category),
        )
        required = bool(_first(slot, "required", "is_required", default=False))
        raw_photos = _list(slot.get("photos"))
        if not raw_photos and _first(slot, "file_path", "path", "analysis_path"):
            raw_photos = [slot]
        warehouse = is_warehouse(slot_name, category)
        if not raw_photos and required:
            append_item(_Evidence(slot_name, "Required photo not supplied", None, True, category=category), warehouse)
        for index, raw_photo in enumerate(raw_photos, start=1):
            photo = _mapping(raw_photo)
            title = slot_name if len(raw_photos) == 1 else f"{slot_name} {index}"
            caption = _english_text(
                _first(photo, "caption", "description", default=slot.get("instruction") or slot_name),
                slot_name,
            )
            sample_id = _text_value(_first(photo, "sample_id", "sample_no", default=""), "")
            path = _first(photo, "file_path", "path", "analysis_path", "original_path")
            append_item(_Evidence(title, caption, str(path) if path else None, required, sample_id, category), warehouse or is_warehouse(_first(photo, "category", "section")))

    flat_photos = sorted(
        [_mapping(photo) for photo in _list(data.get("photos"))],
        key=lambda photo: (order_value(photo), _text_value(_first(photo, "slot_name", "category", default=""))),
    )
    for photo in flat_photos:
        category = _text_value(_first(photo, "category", "section", default=""), "")
        title = _english_text(
            _first(photo, "slot_label", "slot_name", "category", default="Photo evidence"),
            _photo_label_fallback(category),
        )
        caption = _english_text(_first(photo, "caption", "description", default=title), title)
        path = _first(photo, "file_path", "path", "analysis_path", "original_path")
        item = _Evidence(
            title=title,
            caption=caption,
            path=str(path) if path else None,
            required=bool(_first(photo, "required", "is_required", default=False)),
            sample_id=_text_value(_first(photo, "sample_id", "sample_no", default=""), ""),
            category=category,
        )
        append_item(item, is_warehouse(title, category))

    if not raw_slots and len(evidence) < 8:
        defaults = [
            "Product overview",
            "Product details",
            "Marking and date code",
            "Barcode",
            "Individual packaging",
            "Master carton",
            "Carton markings",
            "Defect evidence",
        ]
        used = {item.title.lower() for item in evidence}
        for label in defaults:
            if len(evidence) >= 8:
                break
            if label.lower() not in used:
                evidence.append(_Evidence(label, "No photo supplied", None, False))

    if len(warehouses) > 2:
        evidence.extend(warehouses[2:])
        warehouses = warehouses[:2]
    return evidence, warehouses


def _product_and_packing(data: Mapping[str, Any]) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    return _mapping(data.get("product")), _mapping(data.get("packing"))


def _draw_page_one(c: canvas.Canvas, data: Mapping[str, Any], total_pages: int, defect_rows: list[list[Any]], test_rows: list[list[Any]]) -> None:
    _draw_header(c, data, 1, total_pages)
    result = _text_value(_first(data, "result", "status", default="ON HOLD")).upper()
    result_color, result_bg = _status_style(result)
    _draw_text(c, MARGIN, PAGE_H - 92, "PRE-SHIPMENT INSPECTION", size=15, bold=True, color=NAVY, width=330)
    _draw_text(c, MARGIN, PAGE_H - 110, "Unified QC report - QC-confirmed findings only", size=7.2, color=MUTED, width=350)
    c.setFillColor(result_bg)
    c.setStrokeColor(result_color)
    c.roundRect(PAGE_W - MARGIN - 112, PAGE_H - 120, 112, 39, 7, fill=1, stroke=1)
    _draw_text(c, PAGE_W - MARGIN - 98, PAGE_H - 94, "FINAL RESULT", size=5.8, bold=True, color=MUTED, width=86)
    _draw_text(c, PAGE_W - MARGIN - 98, PAGE_H - 111, result, size=11.5, bold=True, color=result_color, width=86)

    overview = _mapping(data.get("overview"))
    product = _mapping(data.get("product"))
    sample_size = _first(overview, "sample_size", default=_first(data, "sample_size"))
    inspected_quantity = _first(
        overview,
        "inspected_qty",
        "inspected_quantity",
        default=_first(data, "inspected_qty", "inspected_quantity"),
    )
    completion = _first(
        overview,
        "completed_pct",
        "completion",
        default=_first(data, "completed_pct", "completion"),
    )
    card_values = [
        ("Customer", _first(overview, "customer", "customer_name", default=_first(product, "customer", "customer_name"))),
        ("P.O. No.", _first(overview, "po_no", "po_number", default=_first(product, "po_no"))),
        ("Item No.", _first(overview, "item_no", "sku", "product_no", default=_first(product, "item_no"))),
        ("Order quantity", _first(overview, "order_qty", "order_quantity", "po_quantity", "quantity", default=_first(product, "order_qty", "po_quantity"))),
        ("Factory", _first(overview, "factory", "factory_name", default=_first(data, "factory"))),
        ("Inspection date", _first(data, "inspection_date", default=_first(overview, "inspection_date"))),
        ("Sample / inspected", f"{_text_value(sample_size)} / {_text_value(inspected_quantity)} PCS"),
        ("Completion", _percentage_value(completion)),
    ]
    y = PAGE_H - 139
    gap = 6
    card_w = (CONTENT_W - gap * 3) / 4
    for index, (label, value) in enumerate(card_values):
        row, col = divmod(index, 4)
        _draw_key_card(c, MARGIN + col * (card_w + gap), y - row * 48, card_w, 41, label, value)

    y = _section(c, PAGE_H - 242, "AQL decision", "Company-authorized sampling plan")
    _draw_grid(c, MARGIN, y, CONTENT_W, [0.23, 0.14, 0.12, 0.12, 0.16, 0.23], ["Class", "AQL", "Ac", "Re", "Found", "Decision"], _normalize_aql(data), row_h=23, font_size=7, max_lines=1)

    section_top = PAGE_H - 365
    gap = 10
    left_w = CONTENT_W * 0.52
    right_w = CONTENT_W - left_w - gap
    _draw_text(c, MARGIN, section_top, "CONFIRMED DEFECTS", size=8.5, bold=True, color=NAVY, width=left_w)
    _draw_text(c, MARGIN + left_w + gap, section_top, "PRODUCT PERFORMANCE & RELIABILITY", size=8.5, bold=True, color=NAVY, width=right_w)
    table_top = section_top - 12
    _draw_grid(c, MARGIN, table_top, left_w, [0.11, 0.13, 0.13, 0.63], ["CR", "MAJ", "MIN", "Description of defect"], defect_rows[:8], row_h=35, font_size=6.6, max_lines=3)
    _draw_grid(c, MARGIN + left_w + gap, table_top, right_w, [0.46, 0.34, 0.20], ["Abuse test", "Standard", "Result"], test_rows[:12], row_h=23, font_size=6.2, max_lines=2)
    if len(defect_rows) > 8 or len(test_rows) > 12:
        _draw_text(c, MARGIN, 47, "Additional inspection rows continue after the specification page.", size=6.5, color=AMBER, width=CONTENT_W)
    _draw_footer(c, data, 1, total_pages)


def _packaging_items(product: Mapping[str, Any], packing: Mapping[str, Any]) -> list[tuple[str, str]]:
    raw = _first(packing, "individual_packaging", "packaging_requirements", default=product.get("individual_packaging"))
    if isinstance(raw, Mapping):
        return [(_english_text(key, "Requirement"), _text_value(value)) for key, value in raw.items()]
    if isinstance(raw, (list, tuple)):
        items: list[tuple[str, str]] = []
        for entry in raw:
            if isinstance(entry, Mapping):
                items.append((_english_text(_first(entry, "name", "label", default="Requirement"), "Requirement"), _text_value(_first(entry, "value", "required", default="-"))))
            else:
                items.append((_english_text(entry, "Requirement"), "YES"))
        return items
    if raw not in (None, ""):
        rendered = _text_value(raw, "").replace("；", ";")
        parsed: list[tuple[str, str]] = []
        for segment in re.split(r"[;\r\n]+", rendered):
            segment = segment.strip()
            if not segment:
                continue
            match = re.match(r"^(.+?)\s*(?:=|:)\s*(.+)$", segment)
            if not match:
                continue
            label = _english_text(match.group(1), "Requirement")
            value = match.group(2).strip()
            normalized = value.upper()
            if normalized in {"Y", "YES", "TRUE", "REQUIRED"}:
                value = "YES"
            elif normalized in {"N", "NO", "FALSE", "NOT REQUIRED"}:
                value = "NO"
            parsed.append((label, value))
        return parsed or [("Requirement", rendered)]
    return []


def _draw_spec_row(c: canvas.Canvas, x: float, top: float, width: float, label: str, value: Any, *, h: float = 25) -> float:
    label_w = width * 0.27
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.rect(x, top - h, width, h, fill=1, stroke=1)
    c.setFillColor(SKY)
    c.rect(x, top - h, label_w, h, fill=1, stroke=0)
    c.line(x + label_w, top, x + label_w, top - h)
    _draw_text(c, x + 6, top - 16, label, size=6.4, bold=True, color=NAVY, width=label_w - 12)
    _draw_text(c, x + label_w + 7, top - 16, value, size=7.1, bold=True, color=INK, width=width - label_w - 14, max_lines=2, leading=8)
    return top - h


def _draw_page_two(c: canvas.Canvas, data: Mapping[str, Any], total_pages: int) -> None:
    _draw_header(c, data, 2, total_pages)
    product, packing = _product_and_packing(data)
    y = _section(c, PAGE_H - 84, "Product specification")
    overview = _mapping(data.get("overview"))
    product_rows = [
        ("Product description", _first(product, "description", "product_description", default=_first(overview, "description"))),
        ("Product size (mm)", _first(product, "size_mm", "product_size", "dimensions")),
        ("Product weight (kg)", f"N.W. {_text_value(_first(product, 'net_weight_kg', 'nw'))}  /  G.W. {_text_value(_first(product, 'gross_weight_kg', 'gw'))}"),
        ("Date code", _first(product, "date_code", "batch_code")),
        ("UPC / EAN barcode", _first(product, "barcode", "upc", "ean")),
        ("Assortment ratio", _first(product, "assortment_ratio", default=_first(packing, "assortment_ratio"))),
        ("Age grade / Origin", f"{_text_value(_first(product, 'age_grade'))}  /  {_text_value(_first(product, 'origin', 'country_of_origin'))}"),
    ]
    for label, value in product_rows:
        y = _draw_spec_row(c, MARGIN, y, CONTENT_W, label, value, h=24)

    y -= 13
    y = _section(c, y, "Individual packaging")
    packaging = _packaging_items(product, packing)
    if not packaging:
        packaging = [("Packaging requirement", "-")]
    packaging = packaging[:18]
    pair_w = CONTENT_W / 3
    rows_needed = ceil(len(packaging) / 3)
    row_h = 20
    for row_index in range(rows_needed):
        top = y - row_index * row_h
        for col in range(3):
            index = row_index * 3 + col
            x = MARGIN + col * pair_w
            c.setFillColor(WHITE)
            c.setStrokeColor(LINE)
            c.rect(x, top - row_h, pair_w, row_h, fill=1, stroke=1)
            if index < len(packaging):
                label, value = packaging[index]
                value_w = 46
                label_w = pair_w - value_w
                c.line(x + label_w, top, x + label_w, top - row_h)
                _draw_text(c, x + 5, top - 13, label, size=5.8, bold=True, color=INK, width=label_w - 10)
                _draw_text(c, x + label_w + 5, top - 13, value, size=5.8, bold=True, color=BLUE, width=value_w - 10)
    y -= rows_needed * row_h + 13

    y = _section(c, y, "Packing", "Master and inner carton")
    master = _mapping(_first(packing, "master_carton", default={}))
    inner = _mapping(_first(packing, "inner_carton", default={}))
    half_w = (CONTENT_W - 10) / 2
    _draw_text(c, MARGIN, y, "MASTER CARTON", size=7, bold=True, color=NAVY, width=half_w)
    _draw_text(c, MARGIN + half_w + 10, y, "INNER CARTON", size=7, bold=True, color=NAVY, width=half_w)
    pack_top = y - 10
    master_rows = [
        ["Dimension", _first(master, "dimension", "dimensions", default=_first(packing, "master_carton_dimension"))],
        ["Weight", f"N.W. {_weight_value(_first(master, 'net_weight_kg', 'net_weight', 'nw', default=_first(packing, 'master_carton_nw')))} / G.W. {_weight_value(_first(master, 'gross_weight_kg', 'gross_weight', 'gw', default=_first(packing, 'master_carton_gw')))}"],
        ["Outer barcode", _first(master, "barcode", "outer_carton_barcode", default=_first(packing, "outer_carton_barcode"))],
        ["Case pack", _first(master, "case_pack", default=_first(packing, "case_pack"))],
        ["Assortment", _first(master, "assortment_ratio", default=_first(packing, "assortment_ratio"))],
        ["Date code", _first(master, "date_code", default=_first(product, "date_code"))],
    ]
    inner_rows = [
        ["Dimension", _first(inner, "dimension", "dimensions")],
        ["Weight", f"N.W. {_weight_value(_first(inner, 'net_weight_kg', 'net_weight', 'nw'))} / G.W. {_weight_value(_first(inner, 'gross_weight_kg', 'gross_weight', 'gw'))}"],
        ["Barcode", _first(inner, "barcode")],
        ["Case pack", _first(inner, "case_pack")],
        ["Assortment", _first(inner, "assortment_ratio")],
        ["Date code", _first(inner, "date_code")],
    ]
    _draw_grid(c, MARGIN, pack_top, half_w, [0.32, 0.68], ["Field", "Value"], master_rows, row_h=20, header_h=20, font_size=5.8, max_lines=2)
    pack_bottom = _draw_grid(c, MARGIN + half_w + 10, pack_top, half_w, [0.32, 0.68], ["Field", "Value"], inner_rows, row_h=20, header_h=20, font_size=5.8, max_lines=2)

    y = pack_bottom - 13
    y = _section(c, y, "Remarks and measurements")
    remarks = _first(data, "remarks", default="-")
    if isinstance(remarks, Mapping):
        lines = [f"{_text_value(key)}: {_text_value(value)}" for key, value in remarks.items()]
    elif isinstance(remarks, (list, tuple)):
        lines = [_text_value(item) for item in remarks]
    else:
        lines = [line.strip() for line in _text_value(remarks).splitlines() if line.strip()] or ["-"]
    display_lines: list[str] = []
    for line in lines[:6]:
        display_lines.extend(_fit_lines(line, CONTENT_W - 18, 6.8, 2))
    display_lines = display_lines[:8]
    box_h = max(52, min(92, 18 + len(display_lines) * 9))
    c.setFillColor(PALE)
    c.setStrokeColor(LINE)
    c.roundRect(MARGIN, y - box_h, CONTENT_W, box_h, 5, fill=1, stroke=1)
    for index, line in enumerate(display_lines):
        _draw_text(c, MARGIN + 9, y - 16 - index * 9, line, size=6.8, color=INK, width=CONTENT_W - 18, max_lines=1)
    _draw_footer(c, data, 2, total_pages)


def _draw_continuation_page(
    c: canvas.Canvas,
    data: Mapping[str, Any],
    page_no: int,
    total_pages: int,
    defects: list[list[Any]],
    tests: list[list[Any]],
) -> None:
    _draw_header(c, data, page_no, total_pages)
    y = _section(c, PAGE_H - 86, "Inspection details - continued")
    gap = 10
    left_w = CONTENT_W * 0.52
    right_w = CONTENT_W - left_w - gap
    _draw_text(c, MARGIN, y, "CONFIRMED DEFECTS", size=8.5, bold=True, color=NAVY, width=left_w)
    _draw_text(c, MARGIN + left_w + gap, y, "MANUAL PERFORMANCE TESTS", size=8.5, bold=True, color=NAVY, width=right_w)
    table_top = y - 12
    _draw_grid(c, MARGIN, table_top, left_w, [0.11, 0.13, 0.13, 0.63], ["CR", "MAJ", "MIN", "Description of defect"], defects, row_h=35, font_size=6.5, max_lines=3)
    _draw_grid(c, MARGIN + left_w + gap, table_top, right_w, [0.46, 0.34, 0.20], ["Abuse test", "Standard", "Result"], tests, row_h=23, font_size=6.1, max_lines=2)
    _draw_footer(c, data, page_no, total_pages)


def _draw_photo_card(c: canvas.Canvas, item: _Evidence, x: float, top: float, w: float, h: float, number: int) -> None:
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.roundRect(x, top - h, w, h, 6, fill=1, stroke=1)
    c.setFillColor(SKY)
    c.roundRect(x + 1, top - 25, w - 2, 24, 5, fill=1, stroke=0)
    _draw_text(c, x + 8, top - 16, f"{number:02d}  {item.title}", size=6.8, bold=True, color=NAVY, width=w - 16)
    image_x = x + 7
    image_y = top - h + 48
    image_w = w - 14
    image_h = h - 79
    c.setFillColor(PALE)
    c.setStrokeColor(colors.HexColor("#E4EAF2"))
    c.rect(image_x, image_y, image_w, image_h, fill=1, stroke=1)
    rendered = _draw_image_contain(c, item.path, image_x + 2, image_y + 2, image_w - 4, image_h - 4)
    if not rendered:
        message = "REQUIRED PHOTO NOT SUPPLIED" if item.required else "NO PHOTO SUPPLIED"
        _draw_text(c, image_x + 20, image_y + image_h / 2 + 4, message, size=7, bold=True, color=AMBER if item.required else MUTED, width=image_w - 40)
    caption = item.caption
    if item.sample_id:
        caption = f"{caption} | Sample: {item.sample_id}"
    _draw_text(c, x + 8, top - h + 33, caption, size=6.2, color=INK, width=w - 16, max_lines=2, leading=7.2)


def _draw_photo_page(c: canvas.Canvas, data: Mapping[str, Any], page_no: int, total_pages: int, items: Sequence[_Evidence], start_index: int) -> None:
    _draw_header(c, data, page_no, total_pages)
    y = _section(c, PAGE_H - 86, "Inspection photo evidence", "Ordered by the configured QC checklist")
    gap = 11
    visible_items = list(items[:4])
    count = len(visible_items)
    if count == 1:
        placements = [(MARGIN, y, CONTENT_W, 648)]
    elif count == 2:
        card_w = (CONTENT_W - gap) / 2
        placements = [
            (MARGIN, y, card_w, 648),
            (MARGIN + card_w + gap, y, card_w, 648),
        ]
    elif count == 3:
        card_w = (CONTENT_W - gap) / 2
        card_h = 319
        placements = [
            (MARGIN, y, card_w, card_h),
            (MARGIN + card_w + gap, y, card_w, card_h),
            (MARGIN, y - card_h - gap, CONTENT_W, card_h),
        ]
    else:
        card_w = (CONTENT_W - gap) / 2
        card_h = 319
        placements = [
            (MARGIN + col * (card_w + gap), y - row * (card_h + gap), card_w, card_h)
            for row in range(2)
            for col in range(2)
        ]
    for index, (item, placement) in enumerate(zip(visible_items, placements)):
        _draw_photo_card(c, item, *placement, start_index + index)
    _draw_footer(c, data, page_no, total_pages)


def _draw_final_page(c: canvas.Canvas, data: Mapping[str, Any], page_no: int, total_pages: int, warehouse: Sequence[_Evidence]) -> None:
    _draw_header(c, data, page_no, total_pages)
    y = _section(c, PAGE_H - 86, "Pictures of all goods in warehouse")
    gap = 10
    warehouse_items = list(warehouse[:2]) or [_Evidence("Warehouse stock", "No warehouse photo supplied", None)]
    card_w = CONTENT_W if len(warehouse_items) == 1 else (CONTENT_W - gap) / 2
    for index, item in enumerate(warehouse_items):
        _draw_photo_card(c, item, MARGIN + index * (card_w + gap), y, card_w, 234, index + 1)

    y -= 254
    y = _section(c, y, "Inspection conclusion")
    result = _text_value(_first(data, "result", "status", default="ON HOLD")).upper()
    result_color, result_bg = _status_style(result)
    c.setFillColor(result_bg)
    c.setStrokeColor(result_color)
    c.roundRect(MARGIN, y - 74, CONTENT_W, 74, 7, fill=1, stroke=1)
    _draw_text(c, MARGIN + 13, y - 20, "FINAL RESULT", size=6.5, bold=True, color=MUTED, width=95)
    _draw_text(c, MARGIN + 13, y - 49, result, size=19, bold=True, color=result_color, width=105)
    _draw_text(c, MARGIN + 132, y - 22, "QC conclusion", size=6.5, bold=True, color=MUTED, width=CONTENT_W - 150)
    _draw_text(c, MARGIN + 132, y - 40, _first(data, "result_reason", "conclusion", default="-"), size=7.2, color=INK, width=CONTENT_W - 150, max_lines=3, leading=8.5)

    y -= 96
    y = _section(c, y, "QC sign-off", "Final responsibility remains with the QC inspector")
    inspector_value = data.get("inspector")
    inspector = _mapping(inspector_value)
    inspector_name = _first(inspector, "name", "inspector_name", default=inspector_value if isinstance(inspector_value, str) else _first(data, "inspector_name"))
    signed_at = _first(inspector, "signed_at", "signature_time", default=_first(data, "signed_at"))
    signature = _first(inspector, "signature_path", "signature", default=_first(data, "signature_path"))
    block_h = 137
    c.setFillColor(PALE)
    c.setStrokeColor(LINE)
    c.roundRect(MARGIN, y - block_h, CONTENT_W, block_h, 7, fill=1, stroke=1)
    _draw_text(c, MARGIN + 13, y - 20, "Inspected and electronically signed by", size=6.5, bold=True, color=MUTED, width=220)
    _draw_text(c, MARGIN + 13, y - 45, inspector_name, size=12, bold=True, color=INK, width=220)
    _draw_text(c, MARGIN + 13, y - 66, f"Signed at: {_timestamp_value(signed_at)}", size=6.8, color=MUTED, width=220)
    c.setFillColor(WHITE)
    c.setStrokeColor(colors.HexColor("#DDE4EC"))
    c.roundRect(PAGE_W - MARGIN - 211, y - 116, 198, 94, 5, fill=1, stroke=1)
    if not _draw_image_contain(c, signature, PAGE_W - MARGIN - 201, y - 107, 178, 74):
        _draw_text(c, PAGE_W - MARGIN - 180, y - 70, "SIGNATURE NOT PROVIDED", size=6.5, bold=True, color=AMBER, width=150)
    _draw_text(c, MARGIN + 13, y - 104, "All AI observations and report entries were reviewed before sign-off.", size=6.5, color=MUTED, width=280)

    trace = _mapping(data.get("ai_trace"))
    if trace:
        trace_text = " | ".join(
            part
            for part in (
                f"Model: {_text_value(_first(trace, 'model', 'model_version'))}",
                f"Prompt: {_text_value(_first(trace, 'prompt_version'))}",
                f"Schema: {_text_value(_first(trace, 'schema_version'))}",
            )
            if not part.endswith("-")
        )
        _draw_text(c, MARGIN, 49, trace_text, size=5.8, color=MUTED, width=CONTENT_W, max_lines=1)
    _draw_footer(c, data, page_no, total_pages)


def generate_unified_report_pdf(payload: Mapping[str, Any], destination: str | Path) -> Path:
    """Generate the unified English QC report and return its output path.

    ``payload`` must be a mapping of already-normalized application data.  The
    generator never calls a database or an AI service and never infers missing
    inspection facts.  ``photo_slots`` controls evidence ordering and supports
    multiple photos per slot; additional photos create overflow evidence pages.
    Confirmed defects should use ``qc_status``/``status`` values such as
    ``confirmed``, ``accepted``, or ``modified``.  Rejected, pending, and
    unreviewed findings are excluded from the formal defect table.
    """
    if not isinstance(payload, Mapping):
        raise TypeError("payload must be a mapping")
    output = Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)

    data = dict(payload)
    defect_rows = _defect_rows(_confirmed_defects(data))
    test_rows = _test_rows(data)
    evidence, warehouse = _normalize_photos(data)

    extra_defects = defect_rows[8:]
    extra_tests = test_rows[12:]
    continuation_count = max(ceil(len(extra_defects) / 18), ceil(len(extra_tests) / 18)) if extra_defects or extra_tests else 0
    photo_page_count = max(2, ceil(len(evidence) / 4))
    total_pages = 2 + continuation_count + photo_page_count + 1

    pdf = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    report_no = _text_value(_first(data, "report_no", default="DRAFT"))
    revision = _text_value(_first(data, "revision", default=0), "0")
    pdf.setTitle(f"{report_no} Rev.{revision} - Quality Inspection Report")
    pdf.setAuthor(_text_value(_first(data, "company_name", "company", default="Quality Control")))
    pdf.setSubject("Unified English AI-assisted QC inspection report")

    _draw_page_one(pdf, data, total_pages, defect_rows, test_rows)
    pdf.showPage()
    _draw_page_two(pdf, data, total_pages)
    pdf.showPage()

    page_no = 3
    for index in range(continuation_count):
        _draw_continuation_page(
            pdf,
            data,
            page_no,
            total_pages,
            extra_defects[index * 18 : (index + 1) * 18],
            extra_tests[index * 18 : (index + 1) * 18],
        )
        pdf.showPage()
        page_no += 1

    for photo_page_index in range(photo_page_count):
        chunk = evidence[photo_page_index * 4 : (photo_page_index + 1) * 4]
        _draw_photo_page(pdf, data, page_no, total_pages, chunk, photo_page_index * 4 + 1)
        pdf.showPage()
        page_no += 1

    _draw_final_page(pdf, data, page_no, total_pages, warehouse)
    pdf.showPage()
    pdf.save()
    return output
