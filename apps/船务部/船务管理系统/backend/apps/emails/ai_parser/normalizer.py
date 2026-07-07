"""Node4 字段标准化：日期格式化、国家映射、置信度评级。"""

import re
from datetime import datetime, timedelta

MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

BUILTIN_PORT_MAP = {
    'LOS ANGELES': '美国', 'LONG BEACH': '美国', 'NEW YORK': '美国',
    'SAVANNAH': '美国', 'SEATTLE': '美国', 'CHICAGO': '美国',
    'VANCOUVER': '加拿大', 'TORONTO': '加拿大',
    'FELIXSTOWE': '英国', 'SOUTHAMPTON': '英国', 'LONDON': '英国',
    'HAMBURG': '德国', 'BREMEN': '德国',
    'ROTTERDAM': '荷兰', 'ANTWERP': '比利时',
    'MELBOURNE': '澳大利亚', 'SYDNEY': '澳大利亚',
    'AUCKLAND': '新西兰',
    'TOKYO': '日本', 'OSAKA': '日本',
    'BUSAN': '韩国',
    'SAO PAULO': '巴西', 'SANTOS': '巴西',
    'SAN PEDRO SULA': '洪都拉斯',
    'SAINT PETERSBURG': '俄罗斯', 'СПБ': '俄罗斯',
}


def normalize_result(ai_result: dict, shipment_type: str, zuogui_factory: str) -> dict:
    """标准化 AI 提取结果，返回带置信度评级的字段字典。"""
    if not ai_result:
        return {'fields': {}, 'items': []}

    fields = {}

    for key in ['so_number', 'container_type', 'port', 'customs_broker',
                'zuogui_factory', 'special_requirements']:
        raw = ai_result.get(key, {})
        if key == 'special_requirements' and shipment_type == 'customer_load':
            # 客上柜不展示特殊要求
            fields[key] = _build_field({}, override_value='', override_confidence=0.0)
        else:
            fields[key] = _build_field(raw)

    si_raw = ai_result.get('si_deadline', {})
    si_val = _normalize_si(si_raw.get('value', ''))
    fields['si_deadline'] = _build_field(si_raw, override_value=si_val)

    co_raw = ai_result.get('cutoff_date', {})
    co_val = _normalize_cutoff(co_raw.get('value', ''))
    fields['cutoff_date'] = _build_field(co_raw, override_value=co_val)

    ship_raw = ai_result.get('ship_date', {})
    ship_val = _calc_ship_date(si_val)
    if ship_val:
        fields['ship_date'] = _build_field(ship_raw, override_value=ship_val, manual_override=True)
    else:
        fields['ship_date'] = _build_field(ship_raw, manual_override=True)

    country_raw = ai_result.get('country', {})
    country_val, country_conf = _resolve_country(
        country_raw.get('value', ''), country_raw.get('evidence', '')
    )
    fields['country'] = _build_field(country_raw, override_value=country_val, override_confidence=country_conf)

    items = []
    for item in ai_result.get('items', []):
        normalized_item = {
            'product_code': item.get('product_code', ''),
            'contract_number': item.get('contract_number', ''),
            'pieces': item.get('pieces'),
            'quantity': item.get('quantity'),
            'cbm': item.get('cbm'),
            'customer_po': item.get('customer_po', ''),
            'gross_weight_per_box': item.get('gross_weight_per_box'),
            'net_weight_per_box': item.get('net_weight_per_box'),
            'factory_short': item.get('factory_short', ''),
            'cargo_receipt': item.get('cargo_receipt', ''),
            'source_file': item.get('source_file', ''),
            'row': item.get('row'),
            'confidence': item.get('confidence', 0.0),
            'confidence_level': _confidence_level(item.get('confidence', 0.0)),
        }
        if zuogui_factory and '兴信' not in zuogui_factory:
            factory = normalized_item['factory_short'].upper()
            if 'HANSON' not in factory and 'DG' not in factory:
                continue
        items.append(normalized_item)

    return {'fields': fields, 'items': items}


def _build_field(raw: dict, override_value=None, override_confidence=None, manual_override=False) -> dict:
    value = override_value if override_value is not None else raw.get('value', '')
    confidence = override_confidence if override_confidence is not None else raw.get('confidence', 0.0)
    return {
        'value': value,
        'source_file': raw.get('source_file', ''),
        'page': raw.get('page'),
        'row': raw.get('row'),
        'evidence': raw.get('evidence', ''),
        'confidence': confidence,
        'confidence_level': _confidence_level(confidence),
        'manual_override': manual_override,
    }


def _confidence_level(conf: float) -> str:
    if conf >= 0.90:
        return 'green'
    elif conf >= 0.70:
        return 'yellow'
    return 'red'


def _normalize_si(val: str) -> str:
    """统一为 M/D HH:MM 格式。"""
    if not val:
        return ''
    val = re.sub(r'\s*(AM|PM)\s*', '', val, flags=re.IGNORECASE).strip()
    if re.match(r'^\d{1,2}/\d{1,2}', val):
        return val
    iso = re.match(r'\d{4}[/\-](\d{1,2})[/\-](\d{1,2})\s*([\d:]*)', val)
    if iso:
        t = re.sub(r':\d{2}$', '', iso.group(3))  # 去掉秒数，如 9:00:00 → 9:00
        return f'{int(iso.group(1))}/{int(iso.group(2))} {t}'.strip()
    en = re.match(r'(\d{1,2})[/\s\-]?([A-Za-z]{3})[/\s\-]?\d*\s*([\d:]*)', val)
    if en:
        m = MONTH_MAP.get(en.group(2).lower())
        if m:
            return f'{m}/{en.group(1)} {en.group(3)}'.strip()
    en2 = re.match(r'([A-Za-z]{3})[/\-](\d{1,2})\s*([\d:]*)', val)
    if en2:
        m = MONTH_MAP.get(en2.group(1).lower())
        if m:
            return f'{m}/{en2.group(2)} {en2.group(3)}'.strip()
    cn = re.match(r'(\d{1,2})月(\d{1,2})日?\s*([\d:]*)', val)
    if cn:
        return f'{cn.group(1)}/{cn.group(2)} {cn.group(3)}'.strip()
    return val


def _normalize_cutoff(val: str) -> str:
    """统一为 M月D日 HH:MM 格式。"""
    if not val:
        return ''
    val = re.sub(r'\s*(AM|PM)\s*', '', val, flags=re.IGNORECASE).strip()
    if re.match(r'\d{1,2}月\d{1,2}日', val):
        return val
    iso = re.match(r'\d{4}[/\-](\d{1,2})[/\-](\d{1,2})\s*([\d:]*)', val)
    if iso:
        t = iso.group(3)
        suffix = f' {t}' if t else ''
        return f'{int(iso.group(1))}月{int(iso.group(2))}日{suffix}'.strip()
    md = re.match(r'(\d{1,2})/(\d{1,2})\s*([\d:]*)', val)
    if md:
        t = md.group(3)
        suffix = f' {t}' if t else ''
        return f'{md.group(1)}月{md.group(2)}日{suffix}'.strip()
    en = re.match(r'(\d{1,2})[/\s\-]?([A-Za-z]{3})[/\s\-]?\d*\s*([\d:]*)', val)
    if en:
        m = MONTH_MAP.get(en.group(2).lower())
        if m:
            t = en.group(3)
            suffix = f' {t}' if t else ''
            return f'{m}月{en.group(1)}日{suffix}'.strip()
    return val


def _calc_ship_date(si_str: str) -> str:
    """从 SI 截止时间计算出货时间（前一天，周日→周六）。"""
    if not si_str:
        return ''
    m = re.match(r'(\d{1,2})/(\d{1,2})', si_str)
    if not m:
        return ''
    year = datetime.now().year
    try:
        si_dt = datetime(year, int(m.group(1)), int(m.group(2)))
    except ValueError:
        return ''
    ship_dt = si_dt - timedelta(days=1)
    if ship_dt.weekday() == 6:
        ship_dt -= timedelta(days=1)
    return ship_dt.strftime('%Y-%m-%d')


def _resolve_country(value: str, evidence: str) -> tuple:
    """查动态映射表，返回 (中文国家名, 置信度)。"""
    if not value and not evidence:
        return '', 0.0
    if value and re.search(r'[\u4e00-\u9fff]', value):
        return value, 0.92
    search_text = (value + ' ' + evidence).upper()
    try:
        from apps.master_data.models import DestinationPortMapping
        for mapping in DestinationPortMapping.objects.all():
            if mapping.port_name.upper() in search_text:
                return mapping.country_cn, 1.0
    except Exception:
        pass
    for port_key, country in BUILTIN_PORT_MAP.items():
        if port_key in search_text:
            return country, 0.90
    return value or evidence, 0.0
