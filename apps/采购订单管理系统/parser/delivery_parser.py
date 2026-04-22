"""
Delivery note parser using OCR (PaddleOCR).
Supports PDF and image files.
Extracts: supplier, delivery_no, delivery_date, and line items
(po_no, product_code, product_name, quantity, unit, remarks).
"""

import re
import os
import threading
from datetime import datetime

_paddle_reader = None
_paddle_lock = threading.Lock()

_MODELS_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models', 'paddleocr')


def _get_reader():
    global _paddle_reader
    if _paddle_reader is None:
        with _paddle_lock:
            if _paddle_reader is None:
                from paddleocr import PaddleOCR
                _paddle_reader = PaddleOCR(
                    use_angle_cls=True,
                    lang='ch',
                    show_log=False,
                    det_model_dir=os.path.join(_MODELS_ROOT, 'det', 'ch', 'ch_PP-OCRv4_det_infer'),
                    rec_model_dir=os.path.join(_MODELS_ROOT, 'rec', 'ch', 'ch_PP-OCRv4_rec_infer'),
                    cls_model_dir=os.path.join(_MODELS_ROOT, 'cls', 'ch_ppocr_mobile_v2.0_cls_infer'),
                )
    return _paddle_reader


def parse_delivery_file(filepath: str) -> dict:
    """Parse a delivery note PDF or image via OCR.

    Returns dict with raw OCR lines and best-effort extracted fields.
    """
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
    """OCR an image file, return text lines sorted top-to-bottom.

    PaddleOCR detects at cell/segment granularity. To keep the downstream
    extraction rules (which expect one table row per line), we group
    segments whose vertical centers are close into a single line and
    concatenate their texts left-to-right.
    """
    import numpy as np
    import cv2
    # cv2.imread cannot handle non-ASCII paths on Windows, read via numpy instead
    img_array = np.fromfile(filepath, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f'无法读取图片文件: {filepath}')
    result = _get_reader().ocr(img, cls=True)
    if not result or not result[0]:
        return []

    segs = []
    for box, (text, _) in result[0]:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        segs.append({
            'y_center': (min(ys) + max(ys)) / 2,
            'height': max(ys) - min(ys),
            'x_left': min(xs),
            'text': text,
        })
    segs.sort(key=lambda s: s['y_center'])

    rows = []
    for s in segs:
        tolerance = max(s['height'] * 0.6, 8)
        if rows and abs(s['y_center'] - rows[-1]['y_center']) <= tolerance:
            rows[-1]['segs'].append(s)
            rows[-1]['y_center'] = sum(x['y_center'] for x in rows[-1]['segs']) / len(rows[-1]['segs'])
        else:
            rows.append({'y_center': s['y_center'], 'segs': [s]})

    lines = []
    for r in rows:
        r['segs'].sort(key=lambda s: s['x_left'])
        lines.append(' '.join(s['text'] for s in r['segs']))

    # Truncate at footer markers (signature/stamp area, file-preview footer)
    footer_kw = ('送货专用章', '客户专用章', '采购专用章', '制表', '盖章', '签字')
    for i, ln in enumerate(lines):
        if any(k in ln for k in footer_kw):
            lines = lines[:i]
            break

    # Merge data sub-rows: each line containing a FDJA code is a row anchor;
    # any preceding non-FDJA, non-structural lines (since the previous anchor
    # or table header) are sub-rows of the same logical table row and get
    # merged into the anchor.
    structural_kw = ('公司', '地址', '电话', '传真', '客户名称', '发货单号',
                     '送货单号', '发货日期', '日期', '产品编号', '产品名称',
                     '客户订单号', '订单数量', '送货数量', '单位', '备注',
                     '金额', '单价', '总重', '单重')

    def _is_structural(line: str) -> bool:
        return any(k in line for k in structural_kw)

    merged_lines = []
    pending = []
    for ln in lines:
        if re.search(r'FDJA', ln, re.IGNORECASE):
            text = ' '.join(pending + [ln])
            pending = []
            merged_lines.append(text)
        elif _is_structural(ln):
            # Flush any pending continuation as their own line (rare path)
            for p in pending:
                merged_lines.append(p)
            pending = []
            merged_lines.append(ln)
        else:
            pending.append(ln)
    for p in pending:
        merged_lines.append(p)

    return merged_lines


def _extract_fields(lines: list) -> dict:
    """Extract structured data from OCR text lines.

    Target fields (from delivery note format):
    - supplier: company name from title (e.g. 深圳市华茂纸品有限公司)
    - delivery_no: 发货单号 (e.g. HD2603010)
    - delivery_date: 发货日期 (e.g. 2026-03-17)
    - items[]: po_no (客户订单号/FDJA...), product_code (产品编号),
               product_name (产品名称), quantity (送货数量),
               unit (单位), remarks (备注)
    """
    raw = '\n'.join(lines)
    result = {
        'supplier': '',
        'delivery_date': '',
        'delivery_no': '',
        'items': [],
        'raw_text': raw,
    }

    # --- Supplier: company name (XX有限公司) ---
    for pat in [
        r'([\u4e00-\u9fff]{2,}(?:有限公司|厂|工厂))',
        r'供[应應]商[：:.\s]*(.+?)(?:\n|$)',
    ]:
        m = re.search(pat, raw)
        if m:
            name = m.group(1).strip()
            # Skip our own company name
            if '华登' not in name:
                result['supplier'] = name
                break

    # --- Delivery No: 发货单号 / 送货单号 ---
    for pat in [
        r'发货单号[：:.\s]*([A-Za-z0-9\-]+)',
        r'送货单号[：:.\s]*([A-Za-z0-9\-]+)',
        r'单\s*号[：:.\s]*([A-Za-z0-9\-]+)',
    ]:
        m = re.search(pat, raw, re.IGNORECASE)
        if m:
            result['delivery_no'] = m.group(1).strip()
            break

    # --- Delivery Date: 发货日期 / 日期 ---
    for pat in [
        r'发货日期[：:.\s]*(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})',
        r'日期[：:.\s]*(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})',
        r'(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})',
    ]:
        m = re.search(pat, raw)
        if m:
            try:
                result['delivery_date'] = f'{int(m.group(1))}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
            except Exception:
                pass
            if result['delivery_date']:
                break

    # --- Default PO No (FDJA...) for items that don't have their own ---
    default_po = ''
    for m in re.finditer(r'(FDJA[\d]+(?:-\d+)?)', raw, re.IGNORECASE):
        default_po = re.sub(r'-\d+$', '', m.group(1).strip())
        break

    # --- Items: scan lines for data rows ---
    # Strategy: look for lines containing FDJA order numbers or numeric quantities
    # that appear after the table header
    header_seen = False
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Detect table header
        if re.search(r'(产品名称|产品编号|送货数量|订单数量|货号名称)', line):
            header_seen = True
            continue

        # Skip non-data lines before header
        if not header_seen:
            # But still check for FDJA-containing lines as they might be data
            if not re.search(r'FDJA', line, re.IGNORECASE):
                continue

        # Skip summary/footer lines
        if re.search(r'(合计|总计|制表|客户名称|送货地址|电话|传真|地址)', line):
            continue

        # Try to extract a data row
        item = _try_parse_item_line(line, lines, default_po)
        if item:
            result['items'].append(item)

    return result


def _try_parse_item_line(line: str, all_lines: list, default_po: str) -> dict | None:
    """Try to parse a single OCR line as a delivery item."""
    # Look for PO number (FDJA...) in this line
    po_match = re.search(r'(FDJA[\d]+(?:-\d+)?)', line, re.IGNORECASE)
    po_no = po_match.group(1) if po_match else default_po
    # Strip page suffix like -01, -02
    if po_no:
        po_no = re.sub(r'-\d+$', '', po_no)

    # Strip FDJA codes from line before extracting numbers/product_code,
    # so FDJA digits don't get picked up as quantities or product codes.
    line_clean = re.sub(r'FDJA[\d]+(?:-\d+)?', '', line, flags=re.IGNORECASE)

    # Look for quantity: a number >= 100 (delivery quantities are typically large)
    numbers = re.findall(r'(\d[\d,]*)', line_clean)
    if not numbers:
        return None

    # Parse all numbers, find likely quantity (送货数量)
    parsed_nums = []
    for n in numbers:
        try:
            val = int(n.replace(',', ''))
            if val > 0:
                parsed_nums.append(val)
        except ValueError:
            pass

    if not parsed_nums:
        return None

    # Heuristic: if there are multiple numbers, the second-largest is likely 送货数量
    # (largest is often 订单数量). If only one number, use it.
    # For the format: 订单数量=56000, 送货数量=27600
    quantity = None
    order_qty = None
    if len(parsed_nums) >= 2:
        # Sort descending - first is order qty, second is delivery qty
        sorted_nums = sorted(parsed_nums, reverse=True)
        order_qty = sorted_nums[0]
        quantity = sorted_nums[1]
    elif len(parsed_nums) == 1:
        quantity = parsed_nums[0]

    if not quantity or quantity <= 0:
        return None

    # Extract unit (个/PCS/件/etc.)
    unit_match = re.search(r'(PCS|pcs|个|件|套|箱|KG|kg|只|片|米|卷|支)', line)
    unit = unit_match.group(1) if unit_match else 'PCS'

    # Extract product code (alphanumeric like "15759 E" or "15759E")
    product_code = ''
    code_match = re.search(r'(\d{4,6}\s*[A-Za-z]?\b)', line_clean)
    if code_match:
        product_code = code_match.group(1).strip()

    # Extract product name: Chinese text portion
    product_name = ''
    # Look for Chinese text segments (product names like 彩盒, 彩卡, etc.)
    cn_parts = re.findall(r'([\u4e00-\u9fff]+(?:[（(][^）)]*[）)])?)', line)
    # Filter out common non-product words
    skip_words = {'个', '件', '套', '箱', '只', '片', '米', '卷', '支', '序', '合计', '总计'}
    cn_parts = [p for p in cn_parts if p not in skip_words and len(p) >= 2]
    if cn_parts:
        product_name = cn_parts[0]

    # If product_code found, combine with product_name
    if product_code and product_name:
        product_name = f'{product_code} {product_name}'
    elif product_code and not product_name:
        product_name = product_code

    if not product_name:
        return None

    # Remarks not needed per user requirement.
    remarks = ''

    return {
        'product_code': product_code,
        'product_name': product_name,
        'quantity': quantity,
        'unit': unit,
        'po_no': po_no,
        'remarks': remarks,
    }
