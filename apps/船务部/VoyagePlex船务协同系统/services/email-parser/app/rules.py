"""Deterministic shipping-field rules adapted from RR-Portal main@690cbab."""

import re
from datetime import datetime

PORTS = {
    "盐田": "盐田", "蛇口": "蛇口", "南沙": "南沙", "黄埔": "黄埔", "赤湾": "赤湾",
    "YANTIAN": "盐田", "YICT": "盐田", "SHEKOU": "蛇口", "CHIWAN": "蛇口",
    "NANSHA": "南沙", "HUANGPU": "黄埔",
}


SI_LABEL = re.compile(
    r"(?:\bS[/.]?\s*I\b(?:\s*(?:&|/|＆)\s*(?:VGM|ENS))*\s*"
    r"(?:CUT(?:\s*OFF|\s*TIME)?|CLS|CLOSING|DEADLINE|截止(?:日期|时间)?|时间)|"
    r"\bS[/.]?\s*I\s*[：:]|"
    r"\bVGM\s*(?:&|/|＆)\s*S[/.]?\s*I\s*(?:CUT(?:\s*OFF|\s*TIME)?|CLS|CLOSING|DEADLINE)|"
    r"截\s*(?:SI|S/I|单|补料)(?:日期|时间)?|最迟截补料)", re.I,
)
CUTOFF_LABEL = re.compile(
    r"(?:\b(?:CY|CFS)\s*(?:CUT(?:\s*OFF)?|CLOSING)(?:\s*(?:DATE|TIME))?|"
    r"\bPORT\s+CUT[\s-]*OFF|截(?:关|港|数期|重柜)(?:日期|时间)?)", re.I,
)
REPLY_BOUNDARY = re.compile(r"^(?:From|Sent|发件人|发送时间)[：:]", re.I | re.M)
MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def parse_body(body: str) -> dict:
    current, history = _split_current_message(body)
    current_si = _deadline_candidates(current, SI_LABEL)
    current_cutoff = _deadline_candidates(current, CUTOFF_LABEL)
    history_si = _deadline_candidates(history, SI_LABEL)
    history_cutoff = _deadline_candidates(history, CUTOFF_LABEL)
    warnings = _candidate_warnings("SI截止", current_si) + _candidate_warnings("截关", current_cutoff)
    return {
        "so_number": _first(body, [
            r"^S/O[ \t]+([A-Z0-9]+(?:/[A-Z0-9-]+)+)",
            r"<SO>\s*([A-Z0-9]{6,})",
            r"\bSO\s*[#:]\s*(?!SO\b)([A-Z0-9]{6,})",
            r"S/O\.?[ \t]*NO\.?[ \t]*[：:]?[ \t]+([A-Z0-9]{6,})",
            r"Booking[ \t]*(?:No|Number)[ \t]*[：:.]?[ \t]+([A-Z0-9]{6,})",
            r"订舱号[：:\s]*([A-Z0-9]{6,})",
            r"\b(BN\d{6,})\b",
        ]),
        "container_type": _container(body),
        "si_deadline": _earliest(current_si),
        "cutoff_date": _earliest(current_cutoff),
        "_fallback_si_deadline": _earliest(history_si),
        "_fallback_cutoff_date": _earliest(history_cutoff),
        "_date_warnings": warnings,
        "ship_date": _ship_date(body),
        "port": _port(body),
        "special_requirements": _requirements(body),
    }


def _first(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, re.I | re.M)
        if match:
            return match.group(1).strip()
    return ""


def _container(text: str) -> str:
    match = re.search(r"(\d+)\s*[*xX]\s*(\d+)'?\s*(HQ|GP|HC|OT|FR|RF)", text, re.I)
    return f"{match.group(1)}*{match.group(2)}{match.group(3).upper()}" if match else ""


def _split_current_message(text: str) -> tuple[str, str]:
    match = REPLY_BOUNDARY.search(text)
    return (text, "") if not match else (text[:match.start()], text[match.start():])


def _deadline_candidates(text: str, label: re.Pattern) -> list[str]:
    candidates = []
    for match in label.finditer(text):
        # Operational deadlines are normally beside the label. Keeping the window short
        # prevents unrelated dates in signatures or quoted instructions from being used.
        value = normalize_deadline(text[match.end():match.end() + 100])
        if value and value not in candidates:
            candidates.append(value)
    return candidates


def normalize_deadline(value: str, fallback_year: int | None = None) -> str:
    """Normalize a shipping deadline to the value accepted by datetime-local inputs."""
    fallback_year = fallback_year or datetime.now().year
    cleaned = re.sub(r"[，（(].*$", "", str(value or "").replace("\u00a0", " ").strip())
    patterns = (
        r"(?P<y>20\d{2})[/.-](?P<m>\d{1,2})[/.-](?P<d>\d{1,2})(?:[T\s]+(?P<h>\d{1,2}):(?P<minute>\d{2})(?::\d{2})?\s*(?P<ampm>AM|PM)?)?",
        r"(?P<d>\d{1,2})\s*[-/]\s*(?P<name>[A-Za-z]{3,9})(?:\s*[-/]\s*(?P<y>20\d{2}))?(?:[\s(]+(?P<h>\d{1,2}):(?P<minute>\d{2})\s*(?P<ampm>AM|PM)?)?",
        r"(?P<name>[A-Za-z]{3,9})\s+(?P<d>\d{1,2})(?:,?\s+(?P<y>20\d{2}))?(?:\s+(?P<h>\d{1,2}):(?P<minute>\d{2})\s*(?P<ampm>AM|PM)?)?",
        r"(?P<m>\d{1,2})[/月.-](?P<d>\d{1,2})日?(?:\s*(?:(?P<period>早上|上午|下午|晚上))?\s*(?P<h>\d{1,2})(?::|点)(?P<minute>\d{2})?)?\s*(?P<ampm>AM|PM)?",
    )
    for pattern in patterns:
        match = re.search(pattern, cleaned, re.I)
        if not match:
            continue
        parts = match.groupdict()
        month = int(parts["m"]) if parts.get("m") else MONTHS.get(parts.get("name", "")[:3].upper(), 0)
        if not month:
            continue
        year = int(parts.get("y") or fallback_year)
        day = int(parts["d"])
        hour = int(parts.get("h") or 0)
        minute = int(parts.get("minute") or 0)
        ampm = (parts.get("ampm") or "").upper()
        period = parts.get("period") or ""
        if (ampm == "PM" or period in ("下午", "晚上")) and hour < 12:
            hour += 12
        elif ampm == "AM" and hour == 12:
            hour = 0
        try:
            parsed = datetime(year, month, day, hour, minute)
        except ValueError:
            continue
        return parsed.strftime("%Y-%m-%dT%H:%M")
    return ""


def _earliest(values: list[str]) -> str:
    return min(values) if values else ""


def _candidate_warnings(label: str, values: list[str]) -> list[str]:
    if len(values) < 2:
        return []
    return [f"{label}识别到多个时间（{'、'.join(values)}），已采用最早时间，请人工确认"]


def _ship_date(text: str) -> str:
    match = re.search(r"(?:Pick\s*up|Pickup|出货|取货)\s*Date?[：:\s]*(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})", text, re.I)
    if not match:
        return ""
    return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"


def _port(text: str) -> str:
    head = text[:2500].upper()
    for token, value in PORTS.items():
        if token.upper() in head:
            return value
    return ""


def _requirements(text: str) -> str:
    normalized = re.sub(r"\r\n?", "\n", text)
    normalized = re.sub(r"<br\s*/?>|</p>", "\n", normalized, flags=re.I)
    normalized = re.sub(r"<[^>]+>", "", normalized)
    normalized = re.sub(r"[\t\u00a0]+", " ", normalized)
    normalized = re.sub(r"[ ]{2,}", " ", normalized)

    current, _ = _split_current_message(normalized)
    amazon = re.search(r"亚马逊不接受[：:].+?(?:谢谢[！!]?|(?:\n\s*){2,}|$)", current, re.S)
    if amazon:
        return re.sub(r"\s*\n\s*", " ", amazon.group()).strip()

    operational = re.compile(
        r"(?:立放|侧放|倒置|倒箱|拉网|气泡袋|填充|阶梯式装柜|装柜平衡|"
        r"分货|混装|漏装|多装|纸皮隔|分开装(?:车|货)|"
        r"箱唛|唛头|箭头方向|朝(?:向)?柜门|标签朝|"
        r"托板|卡板|围膜|雨棚|雨天.{0,20}防护|"
        r"柜体|柜况|地板破|铁皮箱|双开门|one\s*way\s*container|换柜|"
        r"拍照|照片|视频|监装|封条|铅封|装错|出错货)", re.I,
    )
    special_declaration = re.compile(
        r"(?:DEMO|子件).{0,50}报关|"
        r"报关资料.{0,50}(?:保留\d位小数|小数点|0\.0+1)|"
        r"装箱货物.{0,30}托书", re.I,
    )
    administrative = re.compile(
        r"(?:请查收|截补料|截单|SI\b|VGM\b|截关|船期|开仓|提货时间|交仓时间|"
        r"报关行|电子委托|发票|开票|联系人|联系电话|邮箱|mailto:|https?://|"
        r"ASN|费用|收费|补料|提单|舱单|船名航次)", re.I,
    )
    generic = re.compile(r"^(?:麻烦)?请?(?:及时|尽早|开仓后)?(?:帮忙)?安排(?:打单|提柜|装柜|做柜|出货).{0,20}(?:谢谢)?[！!。.]*$", re.I)
    process_heavy = re.compile(r"(?:ASN|预约|报关单|报关行|电子委托|发票|开票|S/O前缀|收费|费用)", re.I)
    direct_loading = re.compile(
        r"(?:立放|侧放|倒置|倒箱|拉网|填充|装柜平衡|分货|混装|漏装|多装|"
        r"纸皮隔|装车|装柜|箱唛.{0,20}朝|标签.{0,20}朝|箭头方向|围膜|雨棚|"
        r"柜况|柜体|地板破|拍照|照片|视频|监装|封条|铅封|装错|出错货)", re.I,
    )
    # Some forward-style notices say that the instructions below are the latest version.
    # In that explicit case, the quoted operational block is part of the current instruction.
    scan_text = normalized if re.search(
        r"(?:最新的操作方式|附件.{0,12}更新|以下.{0,12}最新|请特别留意下面.{0,20}要求)", current
    ) else current
    found = []
    for raw_line in scan_text.splitlines():
        line = re.sub(r"^[\s>*•·\-—]+", "", raw_line).strip()
        line = re.sub(r"\*+", "", line).strip()
        if not line or len(line) > 600 or len(re.sub(r"[^\u4e00-\u9fffA-Za-z]", "", line)) < 6:
            continue
        if generic.search(line):
            continue
        is_special_declaration = bool(special_declaration.search(line))
        is_operational = bool(operational.search(line))
        if process_heavy.search(line) and not direct_loading.search(line) and not is_special_declaration:
            continue
        if administrative.search(line) and not is_operational and not is_special_declaration:
            continue
        if is_operational or is_special_declaration:
            # Keep the actionable clause when a deadline precedes a declaration rule.
            if is_special_declaration and "注意报关资料" in line:
                line = line[line.index("注意报关资料"):]
            if "装柜平衡" in line and re.search(r"40H[QCG]", line, re.I):
                line = line[re.search(r"40H[QCG]", line, re.I).start():]
            found.append(line)
    return "\n".join(dict.fromkeys(filter(None, found)))

def classify_email(subject: str, body: str) -> str:
    combined = f"{subject}\n{body}"
    if re.search(r"交仓|散货收货站|入仓", combined, re.I) or re.search(r"\bCFS\b", subject, re.I):
        return "warehouse"
    return "standard"


def filter_items_for_email(items: list[dict], shipment_type: str, loading_factory: str = "") -> list[dict]:
    """Keep every factory's cargo for warehouse delivery or Xingxin loading."""
    if shipment_type == "warehouse":
        return items
    if re.search(r"兴信|新信|hanson", loading_factory, re.I):
        return items
    selected = []
    has_factory_information = False
    for item in items:
        # “Actual factory” is the legacy system's displayed/filtering factory.
        # Only fall back to the assembly-factory column when it is absent.
        factory = item.get("supplier") or item.get("factory_remark") or ""
        has_factory_information = has_factory_information or bool(str(factory).strip())
        if re.search(r"兴信|新信|hanson", str(factory), re.I):
            selected.append(item)
    return selected if has_factory_information else items
