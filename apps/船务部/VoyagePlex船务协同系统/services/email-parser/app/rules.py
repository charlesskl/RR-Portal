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

    # 邮件备注通常是完整句子或段落，不能只留下“拉网”等孤立关键词。
    # 先按行保留命中的原文，再以关键词兜底，交由船务在确认页面复核。
    requirement_tokens = (
        "拉网", "拍照", "立放", "客上柜", "客上车", "拼柜", "拖柜", "报关",
        "分货", "混装", "漏装", "多装", "纸皮隔", "箱唛", "唛头", "朝向柜门",
        "朝柜门", "箭头方向", "请勿倒箱", "不能倒箱", "不得倒箱", "分开装车",
        "分开装货", "监装", "卡板送货", "带卡板", "备用箱", "白标签",
    )
    found = []
    for raw_line in normalized.splitlines():
        line = re.sub(r"^[\s>*•·\-—]+", "", raw_line).strip()
        line = re.sub(r"\*+", "", line).strip()
        if not line or len(line) > 600:
            continue
        if any(token in line for token in requirement_tokens):
            found.append(line)
    if any(token in text.upper() for token in ("WMT", "WMO", "WALMART")):
        found.extend(["拉网", "拍照", "立放"])
    for value in ("拉网", "拍照", "立放", "客上柜", "客上车"):
        if value in text and not any(value in line for line in found):
            found.append(value)
    return "\n".join(dict.fromkeys(filter(None, found)))

def classify_email(subject: str, body: str) -> str:
    combined = f"{subject}\n{body}"
    if re.search(r"交仓|散货收货站|入仓", combined, re.I) or re.search(r"\bCFS\b", subject, re.I):
        return "warehouse"
    return "standard"


def filter_items_for_email(items: list[dict], shipment_type: str, loading_factory: str = "") -> list[dict]:
    """Keep all cargo only when the sheet explicitly appoints Xingxin to load the container."""
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
