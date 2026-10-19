"""Safe EML decoding with per-message attachment isolation."""

import base64
from email.parser import BytesFeedParser
import hashlib
import json
import html
import re
from email import policy
from email.header import decode_header
from pathlib import Path
from .carrier_schedule import carrier_tables


def parse_eml(raw: bytes, workdir: Path) -> dict:
    parser = BytesFeedParser(policy=policy.default)
    # Avoid materializing the entire message as both str and StringIO.
    for offset in range(0, len(raw), 64 * 1024):
        parser.feed(raw[offset:offset + 64 * 1024])
    msg = parser.close()
    workdir.mkdir(parents=True, exist_ok=True)
    attachments = save_attachments(msg, workdir)
    body = extract_body(msg)
    business = {"sender": decode_header_value(msg.get("From", "")).strip().lower(),
                "subject": decode_header_value(msg.get("Subject", "")), "date": str(msg.get("Date", "")),
                "body": body, "attachments": sorted((part["filename"], part["sha256"]) for part in attachments)}
    return {
        "business_fingerprint": hashlib.sha256(json.dumps(business, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
        "fingerprint": hashlib.sha256(raw).hexdigest(),
        "message_id": str(msg.get("Message-ID", "")),
        "subject": decode_header_value(msg.get("Subject", "")),
        "sender": decode_header_value(msg.get("From", "")),
        "received_at": str(msg.get("Date", "")),
        "body_text": body,
        "body_tables": carrier_tables(msg),
        "attachments": attachments,
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


def _write_canonical_base64(part, path: Path):
    """Stream only well-formed ASCII base64; retain stdlib fallback semantics.

    Validate before creating a file. Chunking avoids the full encoded bytes,
    splitlines list, joined bytes, and decoded attachment held by get_payload.
    The MIME tree still retains its encoded text; this is not a streaming MIME
    parser and does not itself justify a larger worker/container memory cap.
    """
    if part.is_multipart() or str(part.get('Content-Transfer-Encoding', '')).lower() != 'base64':
        return None
    payload = part.get_payload()
    if not isinstance(payload, str):
        return None
    length = padding = 0
    padded = False
    for offset in range(0, len(payload), 64 * 1024):
        chunk = payload[offset:offset + 64 * 1024].replace('\r', '').replace('\n', '')
        if not re.fullmatch(r'[A-Za-z0-9+/=]*', chunk):
            return None
        first_padding = chunk.find('=')
        if first_padding >= 0:
            if (padded and first_padding != 0) or any(char != '=' for char in chunk[first_padding:]):
                return None
            padded = True
            padding += len(chunk) - first_padding
        elif padded and chunk:
            return None
        length += len(chunk)
    if not length or length % 4 or padding > 2:
        return None
    digest = hashlib.sha256()
    size = 0
    carry = ''
    with path.open('wb') as output:
        for offset in range(0, len(payload), 64 * 1024):
            chunk = carry + payload[offset:offset + 64 * 1024].replace('\r', '').replace('\n', '')
            complete = len(chunk) // 4 * 4
            decoded = base64.b64decode(chunk[:complete], validate=True)
            output.write(decoded)
            digest.update(decoded)
            size += len(decoded)
            carry = chunk[complete:]
    return size, digest.hexdigest()


def save_attachments(msg, workdir: Path) -> list[dict]:
    saved = []
    sequence = 0
    for part in msg.walk():
        filename = part.get_filename()
        if not filename:
            continue
        original = decode_header_value(filename)
        safe = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]", "_", Path(original).name) or "attachment"
        path = workdir / f"{sequence + 1:03d}_{safe}"
        summary = _write_canonical_base64(part, path)
        if summary is None:
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            path.write_bytes(payload)
            summary = len(payload), hashlib.sha256(payload).hexdigest()
            del payload  # Do not retain the previous attachment while decoding the next.
        sequence += 1
        saved.append({
            "filename": original,
            "stored_name": path.name,
            "stored_path": str(path),
            "content_type": part.get_content_type(),
            "size": summary[0],
            "sha256": summary[1],
        })
    return saved
