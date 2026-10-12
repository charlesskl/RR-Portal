import imaplib
import os
import re
from datetime import date, datetime, timedelta, timezone


MAX_MESSAGES = 50
MAX_MESSAGE_BYTES = 25 * 1024 * 1024
LOOKBACK_DAYS = 7
INTERNAL_DATE = re.compile(rb'INTERNALDATE "([^"]+)"')


def identify_client(client) -> None:
    """网易等服务器要求在打开收件箱前声明客户端身份。"""
    if b"ID" not in getattr(client, "capabilities", ()) and "ID" not in getattr(client, "capabilities", ()):
        return
    # imaplib has no public ID method; register the RFC 2971 command before use.
    imaplib.Commands.setdefault("ID", ("AUTH",))
    status, _ = client._simple_command("ID", '("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')
    if status != "OK":
        raise imaplib.IMAP4.error("邮箱服务器拒绝客户端身份声明")


def folder_failure(parts) -> str:
    """Only inspect server responses; never echo credentials or raw login traces."""
    response = str(parts).lower()
    if "unsafe" in response or "security" in response:
        return "邮箱服务器因安全限制拒绝打开收件箱，请检查第三方客户端授权及客户端身份声明"
    return "已登录，但无法打开收件文件夹，请检查文件夹名称和权限"


def received_at_from_fetch(parts: list) -> str:
    header = next((part[0] for part in parts if isinstance(part, tuple)), b"")
    match = INTERNAL_DATE.search(header)
    if not match:
        raise RuntimeError("邮箱未返回邮件收件时间")
    received = datetime.strptime(match.group(1).decode("ascii"), "%d-%b-%Y %H:%M:%S %z")
    return received.astimezone(timezone.utc).isoformat()


def fetch_mailbox(after_uid: int = 0, start_date: str = "2026-10-08", company: str = "Xingxin", credentials: dict | None = None) -> dict:
    if company not in {"Xingxin", "Huadeng"}:
        raise ValueError("公司板块无效")
    prefix = "VOYAGEPLEX_HUADENG_MAIL_" if company == "Huadeng" else "VOYAGEPLEX_MAIL_"
    first_day = date.fromisoformat(start_date)
    address = (credentials.get("address", "") if credentials is not None else os.environ.get(prefix + "ADDRESS", "")).strip()
    secret = credentials.get("auth_code", "") if credentials is not None else os.environ.get(prefix + "AUTH_CODE", "")
    if not address or not secret:
        return {"configured": False, "messages": []}

    host = credentials.get("host", "imap.exmail.qq.com") if credentials is not None else os.environ.get(prefix + "IMAP_HOST", "imaphz.qiye.163.com")
    folder = credentials.get("folder", "INBOX") if credentials is not None else os.environ.get(prefix + "FOLDER", "INBOX")
    client = imaplib.IMAP4_SSL(host, 993, timeout=30)
    try:
        client.login(address, secret)
        identify_client(client)
        status, _ = client.select(folder, readonly=True)
        if status != "OK":
            raise RuntimeError(folder_failure(_))
        status, response = client.response("UIDVALIDITY")
        validity = int(response[0]) if status == "UIDVALIDITY" and response and response[0] else 0
        # IMAP SINCE uses server internal dates; search one day earlier and let
        # the API apply the exact China-time boundary to each fetched message.
        since = (first_day - timedelta(days=1)).strftime("%d-%b-%Y")
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


def test_mailbox_connection(credentials: dict) -> dict:
    """Validate login and read-only folder access without searching or fetching mail."""
    address = credentials.get("address", "").strip()
    secret = credentials.get("auth_code", "")
    if not address or not secret:
        return {"connected": False, "message": "请填写邮箱地址和授权码"}
    client = None
    try:
        try:
            client = imaplib.IMAP4_SSL(credentials.get("host", ""), 993, timeout=30)
        except (OSError, imaplib.IMAP4.error):
            return {"connected": False, "message": "无法连接邮箱服务器，请检查服务器地址和网络"}
        try:
            client.login(address, secret)
        except imaplib.IMAP4.error:
            return {"connected": False, "message": "邮箱登录失败，请检查授权码，并确认邮箱已开启IMAP"}
        try:
            identify_client(client)
        except imaplib.IMAP4.error:
            return {"connected": False, "message": "邮箱服务器拒绝客户端身份声明，请检查第三方客户端授权"}
        try:
            status, parts = client.select(credentials.get("folder", "INBOX"), readonly=True)
            if status != "OK":
                return {"connected": False, "message": folder_failure(parts)}
        except imaplib.IMAP4.error as error:
            return {"connected": False, "message": folder_failure(error)}
        return {"connected": True, "message": "测试连接成功，可登录邮箱并读取指定文件夹。请保存配置。"}
    except (OSError, ValueError):
        return {"connected": False, "message": "连接测试失败，请检查服务器地址和网络"}
    finally:
        if client is not None:
            try:
                client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass

# Not a test: pytest would otherwise collect this imported helper from tests/.
test_mailbox_connection.__test__ = False
