"""
PDF Parser for Huadeng purchase orders.

Extracts structured data from standardised two-page PDF purchase orders
produced by 东莞华登塑胶制品有限公司.
"""

import re
import pdfplumber


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_purchase_pdf(pdf_path: str) -> dict:
    """Parse a Huadeng purchase-order PDF and return a structured dict.

    Returns:
        {
            'po_no': str,            # e.g. 'FDJA20260158'
            'supplier_name': str,
            'po_date': str,          # 'YYYY-MM-DD'
            'delivery_date': str,    # 'YYYY-MM-DD'
            'receiver': str,
            'items': [
                {
                    'product_code': str,
                    'product_name': str,
                    'specification': str,
                    'quantity': int,
                    'unit': str,
                    'unit_price': float,
                    'amount': float,
                    'material_code': str,
                },
                ...
            ],
        }
    """
    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages

        # --- header from first page text ---
        page1_text = pages[0].extract_text() or ''
        header = _parse_header(page1_text)

        # --- items from all page tables ---
        items = []
        for page in pages:
            tables = page.extract_tables()
            for table in tables:
                items.extend(_parse_table_rows(table))

        # --- delivery info from first page text (also present on page 2) ---
        delivery_info = _parse_delivery_info(page1_text)
        header.update(delivery_info)

    return {**header, 'items': items}


# ---------------------------------------------------------------------------
# Header parsing
# ---------------------------------------------------------------------------

def _parse_header(text: str) -> dict:
    result = {}

    # Supplier name: line containing '供應商：' or '供应商：'
    m = re.search(r'供[應应]商[：:]\s*(.+?)\s+採購單編號', text)
    if m:
        result['supplier_name'] = m.group(1).strip()

    # PO number: e.g. FDJA20260158-01  →  base = FDJA20260158
    m = re.search(r'採購單編號[：:]\s*([A-Z0-9]+(?:-\d+)?)', text)
    if m:
        raw = m.group(1).strip()
        # Strip page suffix like -01, -02
        result['po_no'] = re.sub(r'-\d+$', '', raw)

    # Date: 2026年03月18日
    m = re.search(r'日\s*[期期][：:]\s*(\d{4})年(\d{2})月(\d{2})日', text)
    if m:
        result['po_date'] = f'{m.group(1)}-{m.group(2)}-{m.group(3)}'

    return result


# ---------------------------------------------------------------------------
# Delivery / receiver parsing
# ---------------------------------------------------------------------------

def _parse_delivery_info(text: str) -> dict:
    result = {}

    # Delivery date: "2026年03月31日 前交货"
    m = re.search(r'(\d{4})年(\d{2})月(\d{2})日\s*前交货', text)
    if m:
        result['delivery_date'] = f'{m.group(1)}-{m.group(2)}-{m.group(3)}'

    # Receiver: 收货人：江平
    m = re.search(r'收货人[：:]\s*([^\s,，;；\n]+)', text)
    if m:
        result['receiver'] = m.group(1).strip()

    return result


# ---------------------------------------------------------------------------
# Table row parsing
# ---------------------------------------------------------------------------

_AMOUNT_RE = re.compile(r'[\d,]+\.?\d*')
_MATERIAL_CODE_RE = re.compile(r'\b\d{8}\b')
_QTY_UNIT_RE = re.compile(r'^(\d+)\s+([A-Za-z]+)$')


def _parse_table_rows(table: list) -> list:
    """Extract item dicts from a raw pdfplumber table (list of lists)."""
    items = []
    for row in table:
        if not row or len(row) < 5:
            continue
        item = _try_parse_item_row(row)
        if item:
            items.append(item)
    return items


def _try_parse_item_row(row: list) -> dict | None:
    """Return a parsed item dict if the row looks like a data row, else None."""
    # Column indices (7 columns total):
    # 0: 貨號 (usually empty)
    # 1: 貨物名稱 (product name + spec, newline-separated)
    # 2: 數量/單位
    # 3: 單價
    # 4: 金額(￥)
    # 5: 物料位置/物料編號
    # 6: 備註

    col_name = (row[1] or '').strip()
    col_qty_unit = (row[2] or '').strip()
    col_price = (row[3] or '').strip()
    col_amount = (row[4] or '').strip()
    col_material = (row[5] or '').strip() if len(row) > 5 else ''

    # Must have product name and numeric price/amount
    if not col_name or not col_price or not col_amount:
        return None

    # Price must be a plain decimal number
    try:
        unit_price = float(col_price.replace(',', ''))
    except ValueError:
        return None

    # Amount: strip leading ￥ / spaces, then parse
    amount_clean = col_amount.lstrip('￥').strip()
    try:
        amount = float(amount_clean.replace(',', ''))
    except ValueError:
        return None

    # Sanity: amount must be positive
    if amount <= 0:
        return None

    # Qty/unit: "5000 PCS"
    qty_unit_m = _QTY_UNIT_RE.match(col_qty_unit)
    if not qty_unit_m:
        return None
    quantity = int(qty_unit_m.group(1))
    unit = qty_unit_m.group(2).upper()

    # Validate quantity * price ≈ amount (within 1%)
    expected = quantity * unit_price
    if amount > 0 and abs(expected - amount) / amount > 0.01:
        return None

    # Material code: 8-digit number
    mc_match = _MATERIAL_CODE_RE.search(col_material)
    material_code = mc_match.group(0) if mc_match else ''

    # Split product name cell into (code, name, specification)
    product_code, product_name, specification = _split_product_name(col_name)

    return {
        'product_code': product_code,
        'product_name': product_name,
        'specification': specification,
        'quantity': quantity,
        'unit': unit,
        'unit_price': unit_price,
        'amount': amount,
        'material_code': material_code,
    }


# ---------------------------------------------------------------------------
# Product name splitting
# ---------------------------------------------------------------------------

def _split_product_name(raw: str) -> tuple[str, str, str]:
    """Split a raw product-name cell into (product_code, product_name, specification).

    Examples
    --------
    "JWC2269-彩卡（XS码）\\n350G粉灰 4C+光油"
        → ("JWC2269", "彩卡 XS码", "350G粉灰 4C+光油")

    "JWC4336-彩卡-R04（XS码）\\n350G粉灰 4C+光油"
        → ("JWC4336", "彩卡-R04 XS码", "350G粉灰 4C+光油")
    """
    parts = raw.split('\n', 1)
    first_line = parts[0].strip()
    specification = parts[1].strip() if len(parts) > 1 else ''

    # Extract product code: leading alphanumeric segment before the first '-'
    # that is followed by Chinese characters.
    # e.g. "JWC2269-彩卡（XS码）" → code="JWC2269", rest="彩卡（XS码）"
    code_match = re.match(r'^([A-Z0-9]+)-(.+)$', first_line, re.UNICODE)
    if code_match:
        product_code = code_match.group(1)
        remainder = code_match.group(2)
    else:
        product_code = ''
        remainder = first_line

    # Normalise brackets: （XS码） → XS码, removing full-width parens
    # Also handle ASCII parens just in case
    def normalise_brackets(s: str) -> str:
        s = re.sub(r'[（(]', ' ', s)
        s = re.sub(r'[）)]', '', s)
        return s.strip()

    product_name = normalise_brackets(remainder)
    # Collapse multiple spaces
    product_name = re.sub(r'\s+', ' ', product_name).strip()

    return product_code, product_name, specification
