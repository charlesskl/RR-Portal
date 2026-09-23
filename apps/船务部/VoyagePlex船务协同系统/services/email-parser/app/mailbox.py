import imaplib
import os
import re
from datetime import datetime, timedelta, timezone


MAX_MESSAGES = 50
MAX_MESSAGE_BYTES = 25 * 1024 * 1024
LOOKBACK_DAYS = 7
INTERNAL_DATE = re.compile(rb'INTERNALDATE "([^"]+)"')


def received_at_from_fetch(parts: list) -> str:
    header = next((part[0] for part in parts if isinstance(part, tuple)), b"")
    match = INTERNAL_DATE.search(header)
    if not match:
        raise RuntimeError("邮箱未返回邮件收件时间")
    received = datetime.strptime(match.group(1).decode("ascii"), "%d-%b-%Y %H:%M:%S %z")
    return received.astimezone(timezone.utc).isoformat()


def fetch_mailbox(after_uid: int = 0) -> dict:
    address = os.environ.get("VOYAGEPLEX_MAIL_ADDRESS", "").strip()
    secret = os.environ.get("VOYAGEPLEX_MAIL_AUTH_CODE", "")
    if not address or not secret:
        return {"configured": False, "messages": []}

    host = os.environ.get("VOYAGEPLEX_MAIL_IMAP_HOST", "imaphz.qiye.163.com")
    folder = os.environ.get("VOYAGEPLEX_MAIL_FOLDER", "INBOX")
    client = imaplib.IMAP4_SSL(host, 993, timeout=30)
    try:
        client.login(address, secret)
        status, _ = client.select(folder, readonly=True)
        if status != "OK":
            raise RuntimeError("无法读取指定邮箱文件夹")
        status, response = client.response("UIDVALIDITY")
        validity = int(response[0]) if status == "UIDVALIDITY" and response and response[0] else 0
        since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime("%d-%b-%Y")
        status, found = client.uid("SEARCH", None, "SINCE", since)
        if status != "OK":
            raise RuntimeError("邮箱搜索失败")
        uids = [int(uid) for uid in (found[0] or b"").split() if int(uid) > after_uid]
        messages = []
        for uid in sorted(uids)[:MAX_MESSAGES]:
            # 单封邮件读取失败必须隔离：若整批中断，调用方断点会永远停在同一 UID，
            # 每轮同步都重复拉取同一批邮件。
            try:
                status, parts = client.uid("FETCH", str(uid), "(INTERNALDATE BODY.PEEK[])")
                if status != "OK" or not parts:
                    raise RuntimeError(f"读取邮件 {uid} 失败")
                raw = next((part[1] for part in parts if isinstance(part, tuple)), None)
                if not raw:
                    raise RuntimeError(f"邮件 {uid} 内容为空")
                messages.append({"uid": uid, "received_at": received_at_from_fetch(parts),
                                 "raw": raw if len(raw) <= MAX_MESSAGE_BYTES else None,
                                 "error": "邮件超过 25MB" if len(raw) > MAX_MESSAGE_BYTES else ""})
            except Exception as exc:
                messages.append({"uid": uid, "received_at": "", "raw": None,
                                 "error": f"邮件读取失败：{exc}"})
        return {"configured": True, "address": address, "uid_validity": validity,
                "messages": messages}
    finally:
        try:
            client.logout()
        except (imaplib.IMAP4.error, OSError):
            pass
