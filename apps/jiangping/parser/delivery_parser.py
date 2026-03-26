"""
Delivery note parser using OCR (EasyOCR).
Supports PDF and image files.
Extracts: date, supplier, delivery_no, and line items.
"""

import re
import os
from datetime import datetime


def is_ocr_available() -> bool:
    """Check if easyocr is installed."""
    try:
        import easyocr  # noqa: F401
        return True
    except ImportError:
        return False


def parse_delivery_file(filepath: str) -> dict:
    """Parse a delivery note PDF or image via OCR.

    Returns dict with raw OCR lines and best-effort extracted fields.
    """
    if not is_ocr_available():
        return {
            'error': 'OCR功能未安装（需要easyocr），请使用Excel导入代替',
            'supplier': '', 'delivery_date': '', 'delivery_no': '',
            'items': [], 'raw_text': '',
        }

    ext = os.path.splitext(filepath)[1].lower()
    if ext == '.pdf':
        lines = _ocr_pdf(filepath)
    else:
        lines = _ocr_image(filepath)

    return _extract_fields(lines)


def _ocr_pdf(filepath: str) -> list:
    """OCR all pages of a PDF."""
    import pdfplumber
    import tempfile

    all_lines = []
    pdf = pdfplumber.open(filepath)
    for page in pdf.pages:
        text = page.extract_text()
        if text and len(text.strip()) > 30:
            all_lines.extend(text.strip().split('\n'))
        else:
            img = page.to_image(resolution=300)
            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            img.save(tmp.name)
            tmp.close()
            all_lines.extend(_ocr_image(tmp.name))
            os.unlink(tmp.name)
    pdf.close()
    return all_lines


def _ocr_image(filepath: str) -> list:
    """OCR an image file, return text lines sorted top-to-bottom."""
    import easyocr
    reader = easyocr.Reader(['ch_sim', 'en'], gpu=False, verbose=False)
    results = reader.readtext(filepath)
    results.sort(key=lambda r: (r[0][0][1], r[0][0][0]))
    return [text for (_, text, _) in results]


def _extract_fields(lines: list) -> dict:
    """Best-effort extraction from OCR text lines."""
    raw = '\n'.join(lines)
    result = {
        'supplier': '',
        'delivery_date': '',
        'delivery_no': '',
        'items': [],
        'raw_text': raw,
    }

    # --- Date ---
    for pat in [
        r'(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})',
        r'(\d{2})-([A-Za-z]{3})-(\d{2,4})',
    ]:
        m = re.search(pat, raw)
        if m:
            g = m.groups()
            try:
                if len(g[0]) == 4:
                    result['delivery_date'] = f'{int(g[0])}-{int(g[1]):02d}-{int(g[2]):02d}'
                else:
                    dt = datetime.strptime(m.group(), '%d-%b-%y')
                    result['delivery_date'] = dt.strftime('%Y-%m-%d')
            except Exception:
                pass
            if result['delivery_date']:
                break

    # --- Delivery No (送货单号) ---
    for pat in [
        r'送货单号[：:.\s]*([A-Za-z0-9\-]+)',
        r'单\s*号[：:.\s]*([A-Za-z0-9\-]+)',
        r'No[.:]?\s*([A-Za-z0-9\-]+)',
    ]:
        m = re.search(pat, raw, re.IGNORECASE)
        if m:
            result['delivery_no'] = m.group(1).strip()
            break

    # --- Supplier ---
    for pat in [
        r'供[应應]商[：:.\s]*(.+?)(?:\n|$)',
        r'([\u4e00-\u9fff]{2,}(?:有限公司|厂|工厂|制品|塑胶|五金|电子|包装|印刷)[\u4e00-\u9fff]*)',
    ]:
        m = re.search(pat, raw)
        if m:
            result['supplier'] = m.group(1).strip()
            break

    # --- PO No (采购单号 / FDJA...) ---
    default_po = ''
    for pat in [
        r'(FDJA[\d\-]+)',
        r'采购单号[：:.\s]*([A-Za-z0-9\-]+)',
        r'PO[.:\s]+([A-Za-z0-9\-]+)',
    ]:
        m = re.search(pat, raw, re.IGNORECASE)
        if m:
            default_po = m.group(1).strip()
            break

    # --- Items: scan lines for quantity patterns ---
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Skip header-like lines
        if re.search(r'(货号|名称|数量|单位|单价|金额|日期|备注|合计|送货单)', line):
            continue

        # Try to find quantity (number followed by optional unit)
        qty_match = re.search(r'(\d[\d,]*\.?\d*)\s*(PCS|pcs|Pcs|个|件|套|箱|KG|kg|只|片|米|卷|支)?', line)
        if not qty_match:
            continue

        qty_str = qty_match.group(1).replace(',', '')
        try:
            qty = float(qty_str)
        except ValueError:
            continue
        if qty <= 0:
            continue

        unit = qty_match.group(2) or 'PCS'

        # Extract product info from the text before/around the quantity
        text_before = line[:qty_match.start()].strip()
        text_after = line[qty_match.end():].strip()

        # Try to split into code + name
        product_code = ''
        product_name = text_before

        # If starts with alphanumeric code
        code_match = re.match(r'^([A-Za-z0-9][\w\-]*)\s+(.+)', text_before)
        if code_match:
            product_code = code_match.group(1)
            product_name = code_match.group(2)

        if not product_name or len(product_name) < 2:
            product_name = text_before or text_after

        if not product_name or len(product_name) < 2:
            continue

        # Check for PO number in this line
        po_match = re.search(r'(FDJA[\d\-]+)', line)
        line_po = po_match.group(1) if po_match else default_po

        result['items'].append({
            'product_code': product_code,
            'product_name': product_name,
            'quantity': qty,
            'unit': unit,
            'po_no': line_po,
        })

    return result
