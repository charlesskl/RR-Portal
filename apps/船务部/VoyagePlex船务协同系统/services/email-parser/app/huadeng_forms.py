"""Read the provided Huadeng cabinet/delivery forms, including merged mixed cartons."""
import re
from .attachments import _number, _text, _product_name_and_spec


def parse_huadeng_form(rows, merges):
    header = next((i for i, row in enumerate(rows) if len(row) >= 17 and '玩具' in _text(row[7]) and _text(row[4]) == '货号'), None)
    if header is None or not any(_text(row[0]) == '华登' for row in rows if row):
        return None

    def identity(row, col):
        value = rows[row][col] if col < len(rows[row]) else None
        if value not in (None, ''):
            return value
        for r1, r2, c1, c2 in merges:
            if r1 <= row < r2 and c1 <= col < c2:
                return rows[r1][c1]
        return value

    items = []
    for r in range(header + 1, len(rows)):
        values = rows[r]
        if len(values) < 17 or _number(values[1]) is None:
            continue
        product = identity(r, 4)
        if not product:
            continue
        name, spec = _product_name_and_spec(values[5], None)
        group = next((f'mix-{r1+1}-{r2}' for r1, r2, c1, c2 in merges if c1 == 9 and r2-r1 > 1 and r1 <= r < r2), '')
        items.append({
            'product_code': _text(product), 'product_name': name, 'spec': spec,
            'contract_number': _text(identity(r, 3)), 'customer_po': _text(identity(r, 13)),
            'category': _text(values[7]), 'quantity': _number(values[8]), 'pieces': _number(values[9]),
            'gross_weight': _number(values[10]), 'net_weight': _number(values[11]), 'volume': _number(values[12]),
            'order_total_pieces': _number(identity(r, 14)), 'gross_weight_per_box': _number(identity(r, 15)),
            'net_weight_per_box': _number(values[16]), 'packing_group': group, 'source_row': r+1,
        })
    flat = '\n'.join(' '.join(_text(v) for v in row) for row in rows)
    so = re.search(r'SO\s*#\s*([A-Z0-9-]+)', flat, re.I)
    country = next((_text(row[6]) for row in rows[header+1:] if len(row)>7 and _text(row[0])=='华登'), '')
    fields = {'destination_country': country}
    if so:
        fields['so_number'] = so.group(1)
    return {'kind':'huadeng_shipment_form', 'fields':fields, 'items':items, 'warnings':[] if items else ['华登表格没有识别到货物明细']}
