"""Booking PDF 解析器 — 从订舱 PDF 中提取交货地址、截关时间、港口、国家等。"""

import re

import pdfplumber

from .body_parser import _normalize_date, translate_country_code, PORT_MAP

# 装货港英文→中文映射
LOADING_PORT_MAP = {
    'YANTIAN': '盐田', 'SHEKOU': '蛇口', 'CHIWAN': '蛇口',
    'NANSHA': '南沙', 'HUANGPU': '黄埔', 'MAWAN': '蛇口',
    'SHENZHEN': '盐田', 'GUANGZHOU': '广州',
    'YICT': '盐田',
}

# 常见目的港→中文国家映射
DESTINATION_PORT_MAP = {
    'HOUSTON': '美国',
    'SANTOS': '巴西', 'PARANAGUA': '巴西', 'NAVEGANTES': '巴西',
    'CHARLESTON': '美国', 'SAVANNAH': '美国', 'LONG BEACH': '美国',
    'LOS ANGELES': '美国', 'NEW YORK': '美国', 'NEWARK': '美国',
    'NORFOLK': '美国', 'HOUSTON': '美国', 'SEATTLE': '美国', 'OAKLAND': '美国',
    'WEST BASIN': '美国', 'WEST BASIN CONTAINER TERMINAL': '美国', 'TACOMA': '美国',
    'GARDEN CITY': '美国', 'GARDEN CITY TERMINAL': '美国',
    'BAYPORT': '美国', 'BAYPORT CONTAINER TERMINAL': '美国',
    'ELIZABETH': '美国', 'PORT ELIZABETH': '美国',
    'VANCOUVER': '加拿大', 'MONTREAL': '加拿大', 'TORONTO': '加拿大', 'CAVAN': '加拿大', 'PRINCE RUPERT': '加拿大',
    'FELIXSTOWE': '英国', 'SOUTHAMPTON': '英国', 'LONDON': '英国',
    'MELBOURNE': '澳大利亚', 'SYDNEY': '澳大利亚', 'BRISBANE': '澳大利亚',
    'FREMANTLE': '澳大利亚', 'ADELAIDE': '澳大利亚', 'PERTH': '澳大利亚',
    'AUCKLAND': '新西兰', 'TAURANGA': '新西兰', 'WELLINGTON': '新西兰',
    'HAMBURG': '德国', 'BREMERHAVEN': '德国',
    'ROTTERDAM': '荷兰',
    'ANTWERP': '比利时',
    'LE HAVRE': '法国', 'MARSEILLE': '法国',
    'BARCELONA': '西班牙', 'VALENCIA': '西班牙',
    'GENOA': '意大利', 'LA SPEZIA': '意大利',
    'TOKYO': '日本', 'YOKOHAMA': '日本', 'KOBE': '日本', 'OSAKA': '日本',
    'BUSAN': '韩国', 'INCHEON': '韩国',
    'KAOHSIUNG': '台湾', 'KEELUNG': '台湾',
    'SINGAPORE': '新加坡',
    'PORT KLANG': '马来西亚',
    'LAEM CHABANG': '泰国', 'BANGKOK': '泰国',
    'MUMBAI': '印度', 'NHAVA SHEVA': '印度', 'CHENNAI': '印度',
    'JEBEL ALI': '阿联酋', 'DUBAI': '阿联酋',
    'JEDDAH': '沙特',
    'DURBAN': '南非', 'CAPE TOWN': '南非',
    'MANZANILLO': '墨西哥', 'LAZARO CARDENAS': '墨西哥',
    'CALLAO': '秘鲁',
    'SAN ANTONIO': '智利', 'VALPARAISO': '智利',
    'BUENOS AIRES': '阿根廷',
    'GDANSK': '波兰',
    'GOTHENBURG': '瑞典',
    'HAIFA': '以色列',
    'ISTANBUL': '土耳其', 'MERSIN': '土耳其',
    'MANILA': '菲律宾',
    'HO CHI MINH': '越南', 'HAI PHONG': '越南',
    'JAKARTA': '印度尼西亚',
    'PUERTO CORTES': '洪都拉斯', 'SAN PEDRO SULA': '洪都拉斯', 'CORTES': '洪都拉斯',
    'SANTO TOMAS DE CASTILLA': '危地马拉', 'PUERTO QUETZAL': '危地马拉',
    'PUERTO LIMON': '哥斯达黎加', 'MOIN': '哥斯达黎加',
    'COLON': '巴拿马', 'BALBOA': '巴拿马',
    'ACAJUTLA': '萨尔瓦多', 'CORINTO': '尼加拉瓜',
    'GUAYAQUIL': '厄瓜多尔',
    'KINGSTON': '牙买加',
}


US_STATES = {'ALABAMA', 'ALASKA', 'ARIZONA', 'ARKANSAS', 'CALIFORNIA', 'COLORADO',
    'CONNECTICUT', 'DELAWARE', 'FLORIDA', 'GEORGIA', 'HAWAII', 'IDAHO', 'ILLINOIS',
    'INDIANA', 'IOWA', 'KANSAS', 'KENTUCKY', 'LOUISIANA', 'MAINE', 'MARYLAND',
    'MASSACHUSETTS', 'MICHIGAN', 'MINNESOTA', 'MISSISSIPPI', 'MISSOURI', 'MONTANA',
    'NEBRASKA', 'NEVADA', 'NEW HAMPSHIRE', 'NEW JERSEY', 'NEW MEXICO', 'NEW YORK',
    'NORTH CAROLINA', 'NORTH DAKOTA', 'OHIO', 'OKLAHOMA', 'OREGON', 'PENNSYLVANIA',
    'RHODE ISLAND', 'SOUTH CAROLINA', 'SOUTH DAKOTA', 'TENNESSEE', 'TEXAS', 'UTAH',
    'VERMONT', 'VIRGINIA', 'WASHINGTON', 'WEST VIRGINIA', 'WISCONSIN', 'WYOMING',
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
    'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
    'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
    'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'}

COUNTRY_NAME_MAP = {
    'UNITED STATES': '美国', 'USA': '美国', 'US': '美国', 'UNITED': '美国',
    'CANADA': '加拿大', 'BRAZIL': '巴西', 'MEXICO': '墨西哥',
    'UNITED KINGDOM': '英国', 'UK': '英国',
    'GERMANY': '德国', 'FRANCE': '法国', 'ITALY': '意大利', 'SPAIN': '西班牙',
    'NETHERLANDS': '荷兰', 'BELGIUM': '比利时', 'POLAND': '波兰', 'SWEDEN': '瑞典',
    'AUSTRALIA': '澳大利亚', 'NEW ZEALAND': '新西兰',
    'JAPAN': '日本', 'SOUTH KOREA': '韩国', 'KOREA': '韩国',
    'SINGAPORE': '新加坡', 'MALAYSIA': '马来西亚', 'THAILAND': '泰国',
    'INDIA': '印度', 'SAUDI ARABIA': '沙特',
    'SOUTH AFRICA': '南非', 'ISRAEL': '以色列', 'TURKEY': '土耳其',
    'ARGENTINA': '阿根廷', 'CHILE': '智利', 'PERU': '秘鲁',
    'PHILIPPINES': '菲律宾', 'VIETNAM': '越南', 'INDONESIA': '印度尼西亚',
    'CHINA': '中国', 'TAIWAN': '台湾',
    'HONDURAS': '洪都拉斯', 'GUATEMALA': '危地马拉',
    'COSTA RICA': '哥斯达黎加', 'PANAMA': '巴拿马',
    'EL SALVADOR': '萨尔瓦多', 'NICARAGUA': '尼加拉瓜',
    'COLOMBIA': '哥伦比亚', 'ECUADOR': '厄瓜多尔',
    'DOMINICAN': '多米尼加', 'JAMAICA': '牙买加',
    'TRINIDAD': '特立尼达',
}


def _port_to_country(port_name: str) -> str:
    """将目的港名或国家名翻译为中文国家名。"""
    if not port_name:
        return ''
    upper = port_name.strip().upper()
    # 规范化缩写：U.K → UK，U.S.A. → USA（去掉字母间的点）
    upper_norm = re.sub(r'(?<=[A-Z])\.(?=[A-Z])', '', upper)

    # ① 优先：港口名精确/模糊匹配（防止州名子串误判，如 CAVAN 含 CA/VA）
    if upper in DESTINATION_PORT_MAP:
        return DESTINATION_PORT_MAP[upper]
    first_part = upper.split(',')[0].strip()
    if first_part in DESTINATION_PORT_MAP:
        return DESTINATION_PORT_MAP[first_part]
    # 括号内港口名：CAVAN (VANCOUVER, BC) → 取 VANCOUVER
    paren_m = re.search(r'\(([A-Z][A-Z\s]+?)(?:,|\))', upper)
    if paren_m:
        inner = paren_m.group(1).strip()
        if inner in DESTINATION_PORT_MAP:
            return DESTINATION_PORT_MAP[inner]
    for key, country in DESTINATION_PORT_MAP.items():
        if key in upper or upper in key:
            return country

    # ② 国家全名匹配（用规范化后的字符串，单词边界）
    for cn_key, cn_val in COUNTRY_NAME_MAP.items():
        if re.search(r'\b' + re.escape(cn_key) + r'\b', upper_norm):
            return cn_val

    # ③ 美国州名匹配（用单词边界，避免 CA 匹配 CAVAN 等）
    for state in US_STATES:
        if re.search(r'\b' + re.escape(state) + r'\b', upper_norm):
            return '美国'

    return translate_country_code(port_name)


def parse_booking_pdf_text(text: str) -> dict:
    """从 PDF 提取的文本中解析关键字段。"""
    result = {
        'delivery_address': '',
        'customs_cutoff': '',
        'si_deadline': '',
        'port': '',
        'country': '',
    }

    # 提取交货地址
    addr_patterns = [
        # PLACE OF DELIVERY (交货地):OAKLAND, CA,UNITED STATES OF AMERICA
        r'PLACE\s*OF\s*DELIVERY\s*(?:\([^)]*\))?\s*[：:]\s*(.+?)(?:\n|$)',
        # Final Destination(最后目的地): DEHAM HAMBURG
        r'Final\s*Destination\s*(?:[（(][^)）]*[）)])?\s*[：:]\s*(.+?)(?:\n|$)',
        # Port of Discharge : VANCOUVER, BC
        r'Port\s*of\s*Discharge\s*(?:\([^)]*\))?\s*[：:]\s*(.+?)(?:\n|$)',
        r'(?:delivery\s*(?:address|place)|送货地址|交货地址)[：:\s]*(.+?)(?:\n|$)',
        r'交货地[）)：:\s]+(.+?)(?:\n|$)',
        r'(?:收货地[址]?|仓库地址|warehouse\s*address)[：:\s]*(.+?)(?:\n|$)',
        r'\bTo[：:\s]+([A-Z][a-zA-Z\s,]+(?:United\s*States|Canada|Brazil|Mexico|UK|Australia))',
    ]
    for pattern in addr_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            addr = match.group(1).strip()
            # 截断多余内容（如 ETA、日期等）
            for sep in ['ETA', 'ETD', 'ETB', '\t', '  ']:
                if sep in addr:
                    addr = addr.split(sep)[0].strip()
            result['delivery_address'] = addr.rstrip(',').strip()
            break

    # 提取截数期（Port Cargo Cut-off 优先，其次 VGM Cut-Off）
    def _find_cutoff_near(keyword_pattern):
        m = re.search(keyword_pattern, text, re.IGNORECASE)
        if not m:
            return ''
        after = text[m.end():m.end() + 300]
        # 支持 31-Mar-26, 31Mar26, 09 Apr 2026, 2026/3/31, 3/31, 4月 07, 2026 等格式
        dm = re.search(r'(\d{1,2}[/-][A-Za-z]{3}[/-]\d{2,4})', after)
        if not dm:
            dm = re.search(r'(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})', after)  # 09 Apr 2026 空格分隔
        if not dm:
            dm = re.search(r'(\d{1,2}月\s*\d{1,2},?\s*\d{4})', after)  # 4月 07, 2026 中文格式
        if not dm:
            dm = re.search(r'(\d{1,2}[A-Za-z]{3}\d{2,4})', after)  # 31Mar26 无分隔符
        if not dm:
            dm = re.search(r'(\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2})', after)
        if not dm:
            dm = re.search(r'(\d{1,2}/\d{1,2})', after)
        tm = re.search(r'(\d{1,2}:\d{2})', after)
        if dm:
            ds = dm.group(1)
            if tm:
                ds += ' ' + tm.group(1)
            return _normalize_date(ds)
        return ''

    # 优先 VGM 截止时间（中文）
    result['customs_cutoff'] = _find_cutoff_near(r'VGM\s*截止时间')

    # 其次 Port Cargo Cut-off
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'Port\s*Cargo\s*Cut[\s-]*[Oo]ff')

    # MSC booking: (cut off deadline) 标注（截关时间为中文mojibake，英文提示为 cut off deadline）
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'\(cut\s*off\s*deadline\)')

    # VGM (Verified Gross Mass) — MSC格式
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'VGM\s*\(Verified\s*Gross\s*Mass\)')

    # 再次 VGM Cut-off（英文）
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'VGM\s*[Cc]ut[\s-]*[Oo]ff')

    # CY Closing / 截重柜时间
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'CY\s*Closing')
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'截重柜时间')

    # 其他模式兜底
    # 截关日
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'截关日')
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'CY\s*CUT[\s-]*OFF')
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'Gate\s*Cut[\s-]*Off')
    if not result['customs_cutoff']:
        cutoff_patterns = [
            r'(?:截关时间|截关|截数期)[：:\s]*(.+?)(?:\n|$)',
        ]
        for pattern in cutoff_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                raw = match.group(1).strip()
                result['customs_cutoff'] = _normalize_date(raw)
                break

    # 截报关时间（MSC PDF 有此标签）
    if not result['customs_cutoff']:
        result['customs_cutoff'] = _find_cutoff_near(r'截报关时间')

    # SI 截止时间
    # MSC booking: 提单补料 (Shipping Instruction) 截数时间 : 15-Apr-2026
    result['si_deadline'] = _find_cutoff_near(r'Shipping\s*Instruction\s*\)\s*截数时间|Shipping\s*Instruction\s*\)\s*截止时间')
    if not result['si_deadline']:
        result['si_deadline'] = _find_cutoff_near(r'Shipping\s*Instruction')
    if not result['si_deadline']:
        result['si_deadline'] = _find_cutoff_near(r'Shipping\s*Instruction\s*Deadline')
    if not result['si_deadline']:
        result['si_deadline'] = _find_cutoff_near(r'SI\s*Cut[\s-]*[Oo]ff')
    if not result['si_deadline']:
        result['si_deadline'] = _find_cutoff_near(r'SI\s*[Dd]eadline')
    if not result['si_deadline']:
        si_m = re.search(r'(?:SI|Shipping\s*Instruction)[^：:\n]{0,30}[：:]\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
        if si_m:
            result['si_deadline'] = _normalize_date(si_m.group(1).strip())

    # 提取 SO/Booking No/Booking Number/订舱号/S/O.NO.
    so_patterns = [
        r'Booking\s*(?:No|Number)\s*[：:\s.]+([A-Z0-9]{6,})',
        r'订舱号[：:\s]*([A-Z0-9]{6,})',
        r'S/O\.?\s*NO\.?\s*([A-Z0-9]{6,})',
    ]
    for sp in so_patterns:
        booking_match = re.search(sp, text, re.IGNORECASE)
        if booking_match:
            result['so_number'] = booking_match.group(1).strip()
            break

    # 提取港口
    port_patterns = [
        # MSC booking: 装港: YANTIAN;CHINA（装港为中文，可能mojibake，但YANTIAN是英文）
        r'装港[：:\s]*([A-Z][A-Z\s]+?)(?:;|,|\n|$)',
        # Port of Loading: YANTIAN, GUANGDONG
        r'Port\s*of\s*Loading[：:\s]+(.+?)(?:\n|$)',
        # Loading terminal: 盐田国际码头YICT
        r'[Ll]oading\s*[Tt]erminal[：:\s]+(.+?)(?:\n|$)',
        # 装货港: YANTIAN
        r'装货港[：:\s]*(.+?)(?:\n|$)',
        # YICT (MSC盐田码头)
        r'\bYICT\b',
        # From / POL
        r'(?:From|POL)[：:\s]+(.+?)(?:\n|$)',
    ]
    for pattern in port_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            port_text = match.group(1).strip() if match.lastindex else match.group(0)
            # 中文港口直接识别
            for cn_port in ['盐田', '蛇口', '赤湾', '南沙', '黄埔']:
                if cn_port in port_text:
                    result['port'] = cn_port
                    break
            if not result['port']:
                # 英文港口匹配
                upper_text = port_text.upper()
                for en_name, cn_name in LOADING_PORT_MAP.items():
                    if en_name in upper_text:
                        result['port'] = cn_name
                        break
                if not result['port']:
                    for en_name, cn_name in PORT_MAP.items():
                        if en_name.upper() in upper_text:
                            result['port'] = cn_name
                            break
            if result['port']:
                break

    # 兜底：直接扫描全文找装货港英文名（如装港标签为mojibake时使用）
    if not result['port']:
        text_upper = text.upper()
        for en_name, cn_name in LOADING_PORT_MAP.items():
            # 确保是完整词（前后为非字母），避免 SHEKOU 匹配 SHEKOUSOME
            if re.search(r'\b' + re.escape(en_name) + r'\b', text_upper):
                result['port'] = cn_name
                break

    # 如果 delivery_address 有值但没翻译成国家，尝试翻译
    if result['delivery_address'] and not result['country']:
        result['country'] = _port_to_country(result['delivery_address'])

    # 提取目的国/目的港（收货地）
    country_found = False

    # 优先：卸货港: FELIXSTOWE;UNITED KINGDOM（MSC PDF 格式）
    pod_cn_match = re.search(r'卸货港[：:\s]*(.+?)(?:\n|$)', text)
    if pod_cn_match:
        pod_cn_text = pod_cn_match.group(1).strip()
        cn = _port_to_country(pod_cn_text.split(';')[0].strip())
        if not cn and ';' in pod_cn_text:
            cn = _port_to_country(pod_cn_text.split(';')[1].strip())
        if cn:
            result['country'] = cn
            country_found = True

    # 格式1: Place of Delivery: HOUSTON, TX 或 Port of Discharge: USLAX (LOS ANGELES, CA)
    # 也支持 PORT OF DISCHARGE (卸货港):OAKLAND, CA 格式
    pod_match = re.search(r'(?:Place\s*of\s*Delivery|Port\s*of\s*Discharge)\s*(?:\([^)]*\))?\s*[：:]\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
    if not country_found and pod_match:
        pod_text = pod_match.group(1).strip()
        # 先尝试从港口名匹配国家（优先级高于国家代码，避免 SAVANNAH 的 SA 匹配到沙特）
        bracket = re.search(r'\(([A-Z][^)]+)\)', pod_text)  # 只匹配英文括号内容
        port_name = bracket.group(1) if bracket else pod_text.split(',')[0].strip()
        country_by_port = _port_to_country(port_name)
        if country_by_port:
            result['country'] = country_by_port
            country_found = True
        else:
            # 再从代码提取国家：USLAX → US → 美国（仅当代码格式明确时，如5位港口代码）
            code_match = re.match(r'([A-Z]{2})([A-Z]{3,})', pod_text)
            if code_match:
                cc = code_match.group(1)
                from .body_parser import COUNTRY_MAP
                if cc in COUNTRY_MAP:
                    result['country'] = COUNTRY_MAP[cc]
                    country_found = True

    # 格式2: 表格格式 "From To By ETD ETA\nSHEKOU SANTOS Vessel ..."
    if not country_found:
        table_match = re.search(r'From\s+To\s+By\s+.*?\n\s*(\S+)\s+(\S+)', text, re.IGNORECASE)
        if table_match:
            to_port = table_match.group(2).strip()
            result['country'] = _port_to_country(to_port)
            country_found = True

    # 格式3: POD/Destination 标签
    if not country_found:
        to_match = re.search(r'(?:POD|Destination|Place\s*of\s*Delivery)[：:\s]+(.+?)(?:\n|$)', text, re.IGNORECASE)
        if to_match:
            to_text = to_match.group(1).strip()
            result['country'] = _port_to_country(to_text)

    # 格式4: Destination Country/目的国: US
    if not country_found:
        dc_match = re.search(r'(?:Destination\s*Country|目的国)[/\s：:]*([A-Z]{2,})', text, re.IGNORECASE)
        if dc_match:
            _dc = dc_match.group(1).strip().upper()
            from .body_parser import COUNTRY_MAP
            if _dc in COUNTRY_MAP:
                result['country'] = COUNTRY_MAP[_dc]
                country_found = True

    # 格式5: 兜底 — 扫描全文找已知目的港名
    if not country_found:
        text_upper = text.upper()
        for port, country in DESTINATION_PORT_MAP.items():
            if port in text_upper:
                result['country'] = country
                country_found = True
                break

    # 收货地统一用国家名
    if result['country']:
        result['delivery_address'] = result['country']

    return result


def parse_booking_pdf(file_path: str, max_pages: int = 5) -> dict:
    """解析订舱 PDF 文件，只读前 max_pages 页（订舱信息通常在首页）。"""
    text_parts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages[:max_pages]:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)

    full_text = '\n'.join(text_parts)
    return parse_booking_pdf_text(full_text)
