"""邮件正文字段提取器 — 使用正则表达式从邮件正文中提取出货相关信息。"""

import re
from datetime import datetime, timedelta


# 月份名称映射
MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

# 港口英文→中文映射
PORT_MAP = {
    'yantian': '盐田', 'shekou': '蛇口', 'chiwan': '蛇口',
    'nansha': '南沙', 'huangpu': '黄埔', 'shenzhen': '深圳',
    'guangzhou': '广州', 'hongkong': '香港', 'hong kong': '香港',
}

# 国家代码→中文映射
COUNTRY_MAP = {
    'US': '美国', 'USA': '美国', 'USNYC': '美国', 'USLAX': '美国', 'USLGB': '美国',
    'CA': '加拿大', 'CAN': '加拿大',
    'GB': '英国', 'UK': '英国',
    'AU': '澳大利亚', 'AUS': '澳大利亚',
    'NZ': '新西兰',
    'JP': '日本', 'JPN': '日本',
    'KR': '韩国',
    'DE': '德国', 'DEU': '德国',
    'FR': '法国', 'FRA': '法国',
    'IT': '意大利', 'ITA': '意大利',
    'ES': '西班牙', 'ESP': '西班牙',
    'NL': '荷兰', 'NLD': '荷兰',
    'BE': '比利时', 'BEL': '比利时',
    'BR': '巴西', 'BRA': '巴西', 'BRSSZ': '巴西', 'BRSFS': '巴西',
    'MX': '墨西哥', 'MEX': '墨西哥',
    'CL': '智利', 'CHL': '智利',
    'CN': '中国', 'CHN': '中国',
    'HK': '香港', 'HKG': '香港',
    'TW': '台湾',
    'SG': '新加坡', 'SGP': '新加坡',
    'MY': '马来西亚', 'MYS': '马来西亚',
    'TH': '泰国', 'THA': '泰国',
    'IN': '印度', 'IND': '印度',
    'AE': '阿联酋', 'ARE': '阿联酋',
    'SA': '沙特', 'SAU': '沙特',
    'ZA': '南非', 'ZAF': '南非',
    'RU': '俄罗斯', 'RUS': '俄罗斯',
    'PL': '波兰', 'POL': '波兰',
    'SE': '瑞典', 'SWE': '瑞典',
    'NO': '挪威', 'NOR': '挪威',
    'DK': '丹麦', 'DNK': '丹麦',
    'FI': '芬兰', 'FIN': '芬兰',
    'IL': '以色列', 'ISR': '以色列',
    'TR': '土耳其', 'TUR': '土耳其',
    'PH': '菲律宾', 'PHL': '菲律宾',
    'ID': '印度尼西亚', 'IDN': '印度尼西亚',
    'VN': '越南', 'VNM': '越南',
    'CO': '哥伦比亚', 'COL': '哥伦比亚',
    'PE': '秘鲁', 'PER': '秘鲁',
    'AR': '阿根廷', 'ARG': '阿根廷',
}


def parse_email_body(body: str) -> dict:
    """从邮件正文中提取出货相关字段。"""
    return {
        'so_number': _extract_so_number(body),
        'container_type': _extract_container_type(body),
        'si_deadline': _adjust_sunday(_extract_si_deadline(body)),
        'cutoff_date': _extract_cutoff_date(body),
        'special_requirements': _extract_special_requirements(body),
        'port': _extract_port(body),
        'ship_date': _extract_ship_date(body),
    }


def _extract_so_number(body: str) -> str:
    """提取 SO 号。支持格式：
    - S/O.NO. N226268542001 / S/O NO: XXXXX
    - Booking No : HKGG40351600 / Booking Number : SZPE82672700
    - 订舱号：XXXXX
    - SO# XXXXX / SO: XXXXX
    """
    patterns = [
        r'SO\s*[#:]\s*([A-Z0-9]+)',
        r'S/O\.?\s*NO\.?\s*[：:\s]+([A-Z0-9]{6,})',
        r'Booking\s*(?:No|Number)\s*[：:\s.]+([A-Z0-9]{6,})',
        r'订舱号[：:\s]*([A-Z0-9]{6,})',
        r'\b(BN\d{6,})\b',          # Century 订舱号：BN260400193
        r'\b([A-Z]{3}\d{6,}[A-Z0-9]*)\b',  # 字母开头+6位以上数字的编号（如 AMU840N192923SZ1）
    ]
    for pattern in patterns:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if pattern == r'\b([A-Z]{3}\d{6,}[A-Z0-9]*)\b':
                prefix = body[max(0, match.start() - 4):match.start()]
                if re.search(r'\bSO\s*$', prefix, re.IGNORECASE):
                    continue
            return candidate
    return ''


def _extract_container_type(body: str) -> str:
    """提取柜型，保留数量和尺寸：1*40'HQ → 1*40HQ, 2X40GP → 2*40GP。

    吨车不从正文提取，由CBM自动计算。
    特殊：40HQ sub 40GP = 1*40HQ（高代平）
    """
    # sub 格式：1*40HQ sub 40GP → 原样保留
    sub_match = re.search(r"(\d+)\s*[*xX]\s*(\d+)'?\s*(HQ|GP|HC)\s+sub\s+(\d+)'?\s*(HQ|GP|HC)", body, re.IGNORECASE)
    if sub_match:
        return f'{sub_match.group(1)}*{sub_match.group(2)}{sub_match.group(3).upper()} sub {sub_match.group(4)}{sub_match.group(5).upper()}'
    # 没有数量前缀的：40HQ sub 40GP
    sub_match2 = re.search(r"(\d+)'?\s*(HQ|GP|HC)\s+sub\s+(\d+)'?\s*(HQ|GP|HC)", body, re.IGNORECASE)
    if sub_match2:
        return f'1*{sub_match2.group(1)}{sub_match2.group(2).upper()} sub {sub_match2.group(3)}{sub_match2.group(4).upper()}'
    # 带引号格式：1*40'HQ → 1*40HQ（不用\b，因为HQ后可能紧跟中文）
    match = re.search(r"(\d+)\s*[*xX]\s*(\d+)'?\s*(HQ|GP|HC|OT|FR|RF)(?=[^A-Za-z]|$)", body, re.IGNORECASE)
    if match:
        return f'{match.group(1)}*{match.group(2)}{match.group(3).upper()}'
    return ''


def _extract_si_deadline(body: str) -> str:
    """提取 SI 截止时间。支持多种格式：
    - VGM/SI CUT：APR-13 16:00
    - SI Cut Off: 2026/3/13 15:00
    - SI: 4/13
    - SI：3月27日9:00
    - VGM CUT OFF: 3月20日 12:00
    """
    patterns = [
        # DGF VGM & DGF SI CUT: 2026/04/03 9:00 AM
        r'DGF\s*(?:VGM\s*[&＆]\s*DGF\s*)?SI\s*CUT[：:\s]+(.+?)(?:\n|$)',
        # SI & VGM Cut Off： 2026/3/27 10:00 AM
        r'SI\s*[&＆]\s*VGM\s*[Cc]ut\s*[Oo]ff[：:\s]+(.+?)(?:\n|$)',
        # VGM & SI CLS:06-MAR(12:00)
        r'(?:VGM\s*[&＆]\s*SI|SI\s*[&＆]\s*VGM)\s*CLS[：:\s]*(.+?)(?:\n|$)',
        r'(?:VGM\s*/?\s*SI|SI\s*/?\s*VGM)\s*(?:CUT|CUT\s*OFF|CLS)?[：:\s]+(.+?)(?:\n|$)',
        # ZURU 昱升格式：SI cut off date/time: 2026/04/17 18:00:00（先匹配，只取到分钟，去掉秒）
        r'SI\s*cut\s*off\s*date[/\s]*time[：:\s]+(\d{4}[/\-]\d{1,2}[/\-]\d{1,2}\s*\d{1,2}:\d{2})',
        r'SI\s*[Cc]ut\s*[Oo]ff[：:\s]+(.+?)(?:\n|$)',
        r'SI\s*CLS[：:\s]*(.+?)(?:\n|$)',
        r'SI\s*[：:]\s*(?!\d{8,})(.+?)(?:\n|$)',
        r'VGM\s*CUT\s*(?:OFF)?[：:\s]+(.+?)(?:\n|$)',
    ]
    for pattern in patterns:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            result = _normalize_date(match.group(1).strip())
            # 只接受能解析成 M/D 格式的值，避免提取到 "day"、"Saturday" 等无意义值
            if result and re.search(r'\d{1,2}/\d{1,2}', result):
                return result
    return ''


def _extract_cutoff_date(body: str) -> str:
    """提取截数期。支持中文"截数期"标签和 ZURU 昱升邮件的 CY closing date 格式。"""
    # 中文截数期标签
    match = re.search(r'截数期[：:\s]*(.+?)(?:\n|$)', body)
    if match:
        return _normalize_date(match.group(1).strip())
    # ZURU 昱升格式：CY closing date: 2026/04/21 17:00:00（只取到分钟）
    cy_match = re.search(
        r'CY\s*closing\s*date[：:\s]+(\d{4}[/\-]\d{1,2}[/\-]\d{1,2}\s*\d{1,2}:\d{2})',
        body, re.IGNORECASE
    )
    if cy_match:
        return _normalize_date(cy_match.group(1).strip())
    return ''


def _extract_special_requirements(body: str) -> str:
    """提取特殊要求。只提取明确的装柜操作要求关键词。"""
    reqs = []

    # ** 标记的内容：只保留短的中文操作指令（如 **拉网** **立放** **拍照**）
    matches = re.findall(r'\*\*([^*]+)\*\*', body)
    for m in matches:
        m = m.strip()
        # 只保留短的中文关键词（≤10字符），排除英文长句
        if m and len(m) <= 10 and not re.match(r'^[a-zA-Z\s]+$', m):
            reqs.append(m)

    # WMT/WMO/Walmart 邮件自动添加：拉网、拍照、立放
    body_upper = body.upper()
    if 'WMT' in body_upper or 'WMO' in body_upper or 'WALMART' in body_upper:
        for req in ['拉网', '拍照', '立放']:
            if req not in reqs:
                reqs.append(req)

    # 正文中直接出现的装柜关键词
    keywords = ['拉网', '拍照', '立放', '客上柜', '客上车']
    for kw in keywords:
        if kw in body and kw not in reqs:
            reqs.append(kw)

    return '、'.join(reqs) if reqs else ''


def _extract_ship_date(body: str) -> str:
    """提取出货/取货日期。支持格式：
    - Pick up Date: 2026/4/16 8:00:00 → 2026-04-16
    - 出货日期：2026/4/16
    """
    patterns = [
        r'Pick\s*up\s*Date\s*[：:]\s*(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})',
        r'Pickup\s*Date\s*[：:]\s*(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})',
        r'出货日期[：:\s]*(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})',
        r'取货日期[：:\s]*(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})',
    ]
    for pattern in patterns:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            raw = match.group(1).replace('/', '-')
            parts = raw.split('-')
            if len(parts) == 3:
                y, m, d = parts
                return f'{y}-{int(m):02d}-{int(d):02d}'
    return ''


def _extract_port(body: str) -> str:
    """检测港口名称。支持中英文。"""
    # 中文港口名（盐田优先，深圳默认为盐田）
    cn_ports = [('盐田', '盐田'), ('蛇口', '蛇口'), ('南沙', '南沙'), ('黄埔', '黄埔'), ('赤湾', '赤湾'), ('深圳', '盐田')]
    for keyword, port_name in cn_ports:
        if keyword in body:
            return port_name

    # 英文港口：只在装港标签后匹配，避免把公司地址中的城市名误判为港口
    # 支持：POL: YANTIAN / Loading port: SHEKOU / ETD SHEKOU / FROM NANSHA 等
    pol_pattern = re.search(
        r'(?:POL|loading\s*port|port\s*of\s*loading|from\s+port|ETD)\s*[：:\s]+(\w[\w\s]+)',
        body, re.IGNORECASE
    )
    if pol_pattern:
        candidate = pol_pattern.group(1).strip().upper()
        for en_name, cn_name in PORT_MAP.items():
            if en_name.upper() in candidate:
                return cn_name

    # 宽松匹配：正文中有明确港口名（排除在签名/地址块中出现的情况）
    # 只取第一次出现在正文前2000字符内的匹配（签名通常在末尾）
    # 注意：广州/GUANGZHOU 不做宽松匹配，避免把签名中的"Guangzhou Office"误判为港口
    LOOSE_SKIP = {'guangzhou', 'hong kong', 'hongkong'}
    body_head = body[:2000].upper()
    for en_name, cn_name in PORT_MAP.items():
        if en_name in LOOSE_SKIP:
            continue
        if en_name.upper() in body_head:
            return cn_name

    return ''


def _normalize_date(date_str: str) -> str:
    """将各种日期格式统一为 M/D HH:MM 格式。

    支持：
    - APR-13 16:00 → 4/13 16:00
    - 18-Apr-2026 15:00 → 4/18 15:00
    - 2026/3/7 12:00 → 3/7 12:00
    - 3月27日9:00 → 3/27 9:00
    - 4/13 → 4/13
    """
    if not date_str:
        return ''

    # 去掉 AM/PM（10:00 AM → 10:00）
    date_str = re.sub(r'\s*(AM|PM)\s*', '', date_str, flags=re.IGNORECASE).strip()
    # 去掉括号：06-MAR(12:00) → 06-MAR 12:00
    date_str = re.sub(r'[()]', ' ', date_str).strip()
    date_str = re.sub(r'\s+', ' ', date_str)

    # 已经是 M/D 格式
    if re.match(r'^\d{1,2}/\d{1,2}', date_str):
        return date_str

    # 中文格式：3月27日9:00 或 4月 07, 2026 17:00
    cn_match = re.match(r'(\d{1,2})月[\s]*(\d{1,2})日?\s*,?\s*\d{0,4}\s*([\d:]*)', date_str)
    if cn_match:
        m, d = cn_match.group(1), cn_match.group(2)
        time_part = cn_match.group(3)
        return f'{m}/{d} {time_part}'.strip() if time_part else f'{m}/{d}'

    # 英文月份格式：APR-13 16:00 或 13-APR-2026 15:00 或 18-Apr-2026 15:00 或 31Mar26 或 09 Apr 2026
    en_match = re.match(r'(\d{1,2})[/\s-]?([A-Za-z]{3})[/\s-]?(\d{2,4})?\s*([\d:]*)', date_str)
    if en_match:
        day = int(en_match.group(1))
        month_str = en_match.group(2).lower()
        time_part = en_match.group(4)
        month = MONTH_MAP.get(month_str)
        if month:
            return f'{month}/{day} {time_part}'.strip() if time_part else f'{month}/{day}'

    # 反向：APR-13
    en_match2 = re.match(r'([A-Za-z]{3})[/-](\d{1,2})\s*([\d:]*)', date_str)
    if en_match2:
        month_str = en_match2.group(1).lower()
        day = int(en_match2.group(2))
        time_part = en_match2.group(3)
        month = MONTH_MAP.get(month_str)
        if month:
            return f'{month}/{day} {time_part}'.strip() if time_part else f'{month}/{day}'

    # ISO格式：2026/3/7 12:00 或 2026-3-7 12:00 或 2026.04.07 12:00
    iso_match = re.match(r'\d{4}[/.\-](\d{1,2})[/.\-](\d{1,2})\s*([\d:]*)', date_str)
    if iso_match:
        m, d = iso_match.group(1), iso_match.group(2)
        time_part = iso_match.group(3)
        return f'{int(m)}/{int(d)} {time_part}'.strip() if time_part else f'{int(m)}/{int(d)}'

    return date_str


def _adjust_sunday(date_str: str) -> str:
    """如果 SI 截止日期落在周日，则前推到周六。"""
    if not date_str:
        return date_str

    # 解析 M/D 格式
    match = re.match(r'(\d{1,2})/(\d{1,2})(.*)', date_str)
    if not match:
        return date_str

    month = int(match.group(1))
    day = int(match.group(2))
    rest = match.group(3)

    year = datetime.now().year
    try:
        dt = datetime(year, month, day)
    except ValueError:
        return date_str

    if dt.weekday() == 6:  # Sunday
        saturday = dt - timedelta(days=1)
        return f'{saturday.month}/{saturday.day}{rest}'

    return date_str


def translate_country_code(code_or_name: str) -> str:
    """将国家代码或港口代码翻译为中文国家名。"""
    if not code_or_name:
        return ''
    code = code_or_name.strip().upper()

    # 直接匹配
    if code in COUNTRY_MAP:
        return COUNTRY_MAP[code]

    # 从括号中的代码匹配：(BRSSZ) → 取前两位 BR
    bracket_match = re.search(r'\(([A-Z]{2,5})\)', code_or_name)
    if bracket_match:
        port_code = bracket_match.group(1)
        if port_code in COUNTRY_MAP:
            return COUNTRY_MAP[port_code]
        # 取前两位作为国家代码
        cc = port_code[:2]
        if cc in COUNTRY_MAP:
            return COUNTRY_MAP[cc]

    return code_or_name
