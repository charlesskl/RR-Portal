"""Safe EML decoding with per-message attachment isolation."""

import email
import hashlib
import html
import re
from email import policy
from email.header import decode_header
from pathlib import Path


def parse_eml(raw: bytes, workdir: Path) -> dict:
    msg = email.message_from_bytes(raw, policy=policy.default)
    workdir.mkdir(parents=True, exist_ok=True)
    return {
        "fingerprint": hashlib.sha256(raw).hexdigest(),
        "message_id": str(msg.get("Message-ID", "")),
        "subject": decode_header_value(msg.get("Subject", "")),
        "sender": decode_header_value(msg.get("From", "")),
        "received_at": str(msg.get("Date", "")),
        "body_text": extract_body(msg),
        "attachments": save_attachments(msg, workdir),
    }


def decode_header_value(value) -> str:
    decoded = []
    for part, declared in decode_header(str(value or "")):
        if isinstance(part, str):
            decoded.append(part)
            continue
        for charset in (declared, "utf-8", "gb18030", "gbk", "gb2312", "big5", "latin-1"):
            if not charset:
                continue
            try:
                decoded.append(part.decode(charset))
                break
            except (UnicodeDecodeError, LookupError):
                pass
        else:
            decoded.append(part.decode("utf-8", errors="replace"))
    return "".join(decoded)


def extract_body(msg) -> str:
    candidates = []
    for part in msg.walk():
        if part.get_content_type() not in ("text/plain", "text/html"):
            continue
        if "attachment" in str(part.get("Content-Disposition", "")).lower():
            continue
        try:
            value = part.get_content()
        except Exception:
            payload = part.get_payload(decode=True) or b""
            value = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        candidates.append((part.get_content_type(), str(value)))
    if not candidates:
        return ""
    content_type, value = next((x for x in candidates if x[0] == "text/plain"), candidates[0])
    if content_type == "text/html":
        value = re.sub(r"<br\s*/?>|</p>", "\n", value, flags=re.I)
        value = re.sub(r"<[^>]+>", "", value)
        value = html.unescape(value)
    return value.strip()


def save_attachments(msg, workdir: Path) -> list[dict]:
    saved = []
    sequence = 0
    for part in msg.walk():
        filename = part.get_filename()
        if not filename:
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        sequence += 1
        original = decode_header_value(filename)
        safe = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]", "_", Path(original).name) or "attachment"
        path = workdir / f"{sequence:03d}_{safe}"
        path.write_bytes(payload)
        saved.append({
            "filename": original,
            "stored_name": path.name,
            "stored_path": str(path),
            "content_type": part.get_content_type(),
            "size": len(payload),
        })
    return saved
