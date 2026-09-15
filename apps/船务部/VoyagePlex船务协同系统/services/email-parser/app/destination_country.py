"""Deterministic destination-to-country matching for shipment emails."""

import re


# Actual customer destinations first, followed by common ports in the requested regions.
DESTINATION_COUNTRIES = {
    "DALLAS": "美国", "ELWOOD": "美国", "STATESBORO": "美国", "SAVANNAH": "美国",
    "LOS ANGELES": "美国", "LONG BEACH": "美国", "NEW YORK": "美国", "NEWARK": "美国",
    "OAKLAND": "美国", "SEATTLE": "美国", "TACOMA": "美国", "HOUSTON": "美国",
    "CHARLESTON": "美国", "NORFOLK": "美国", "MIAMI": "美国",
    "FELIXSTOWE": "英国", "SOUTHAMPTON": "英国", "LONDON GATEWAY": "英国",
    "HAMBURG": "德国", "BREMERHAVEN": "德国", "WILHELMSHAVEN": "德国",
    "ROTTERDAM": "荷兰", "AMSTERDAM": "荷兰", "ANTWERP": "比利时", "ZEEBRUGGE": "比利时",
    "LE HAVRE": "法国", "MARSEILLE": "法国", "FOS SUR MER": "法国",
    "VALENCIA": "西班牙", "BARCELONA": "西班牙", "ALGECIRAS": "西班牙",
    "GENOA": "意大利", "LA SPEZIA": "意大利", "TRIESTE": "意大利",
    "GDANSK": "波兰", "GDYNIA": "波兰", "PIRAEUS": "希腊",
    "TOKYO": "日本", "YOKOHAMA": "日本", "OSAKA": "日本", "KOBE": "日本", "NAGOYA": "日本",
    "BUSAN": "韩国", "PUSAN": "韩国", "INCHEON": "韩国", "GWANGYANG": "韩国",
    "SHANGHAI": "中国", "NINGBO": "中国", "SHENZHEN": "中国", "YANTIAN": "中国",
    "SHEKOU": "中国", "NANSHA": "中国", "QINGDAO": "中国", "TIANJIN": "中国", "XIAMEN": "中国",
}

COUNTRY_ALIASES = {
    "UNITED STATES OF AMERICA": "美国", "UNITED STATES": "美国", "U.S.A.": "美国", "USA": "美国", "US": "美国",
    "UNITED KINGDOM": "英国", "GREAT BRITAIN": "英国", "UK": "英国", "英国": "英国",
    "GERMANY": "德国", "DEUTSCHLAND": "德国", "DE": "德国", "德国": "德国",
    "JAPAN": "日本", "JP": "日本", "日本": "日本", "SOUTH KOREA": "韩国", "REPUBLIC OF KOREA": "韩国", "KR": "韩国", "韩国": "韩国",
    "FRANCE": "法国", "法国": "法国", "NETHERLANDS": "荷兰", "荷兰": "荷兰",
    "BELGIUM": "比利时", "比利时": "比利时", "SPAIN": "西班牙", "西班牙": "西班牙",
    "ITALY": "意大利", "意大利": "意大利", "POLAND": "波兰", "波兰": "波兰",
    "GREECE": "希腊", "希腊": "希腊", "CANADA": "加拿大", "加拿大": "加拿大",
    "AUSTRALIA": "澳大利亚", "澳大利亚": "澳大利亚", "NEW ZEALAND": "新西兰", "新西兰": "新西兰",
}


def _contains(text: str, token: str) -> bool:
    if re.fullmatch(r"[A-Z. ]+", token):
        return bool(re.search(rf"(?<![A-Z]){re.escape(token)}(?![A-Z])", text.upper()))
    return token in text


def country_from_text(text: str, include_china_ports: bool = True) -> str:
    value = str(text or "")
    for token, country in COUNTRY_ALIASES.items():
        if _contains(value, token):
            return country
    for token, country in DESTINATION_COUNTRIES.items():
        if country == "中国" and not include_china_ports:
            continue
        if _contains(value, token):
            return country
    return ""


def infer_destination_country(message_text: str, parsed_attachments: list[dict]) -> str:
    """Prefer the email's stated destination, then dedicated attachment destination fields."""
    # Chinese port names in email bodies are commonly loading ports, so they
    # are only treated as destinations inside dedicated destination fields.
    subject, _, body = str(message_text or "").partition("\n")
    direct = country_from_text(subject, include_china_ports=False)
    if direct:
        return direct
    destination_lines = "\n".join(
        line for line in body.splitlines()
        if re.search(r"DESTINATION|DISCHARGE|DELIVER|SHIP\s+TO|目的|收货|送货", line, re.I)
    )
    direct = country_from_text(destination_lines, include_china_ports=False)
    if direct:
        return direct
    for attachment in parsed_attachments:
        fields = attachment.get("fields", {})
        destination = fields.get("destination_port") or fields.get("delivery_address") or ""
        matched = country_from_text(str(destination))
        if matched:
            return matched
        # Do not trust country text from unrelated reference/template PDFs.
        if destination and fields.get("country"):
            return str(fields["country"])
    return ""
