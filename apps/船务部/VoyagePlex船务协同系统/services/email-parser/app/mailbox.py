import imaplib
import errno
import json
import os
import re
import select
import socket
import ssl
import subprocess
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone


MAX_MESSAGES = 5
MAX_MESSAGE_BYTES = 25 * 1024 * 1024
MAX_BATCH_BYTES = 32 * 1024 * 1024
FETCH_BUDGET_SECONDS = 45
LOOKBACK_DAYS = 7
INTERNAL_DATE = re.compile(rb'INTERNALDATE "([^"]+)"')


class OversizedLiteral(ValueError):
    pass


class BatchLiteralBudget(ValueError):
    pass


class MailboxUidValidityChanged(RuntimeError):
    pass


def selected_mailbox_uids(values):
    if (not isinstance(values, list) or not 1 <= len(values) <= MAX_MESSAGES
            or any(type(uid) is not int or not 1 <= uid <= 4294967295 for uid in values)
            or len(set(values)) != len(values)):
        raise ValueError("请选择 1 至 5 个不重复的有效邮件 UID")
    return sorted(values)


class BoundedImap(imaplib.IMAP4_SSL):
    literal_limit = MAX_MESSAGE_BYTES

    def __init__(self, host, port=993, *, timeout=20, ssl_context=None, control=None, deadline=None):
        self.control = control or MailboxControl()
        self.deadline = deadline or time.monotonic() + FETCH_BUDGET_SECONDS
        self.sock = None
        self.file = None
        # IMAP4.__init__ reads greeting and CAPABILITY before it returns.
        self.control.client = self
        try:
            super().__init__(host, port, timeout=timeout,
                             ssl_context=ssl_context or ssl.create_default_context())
        except BaseException:
            if self.file is not None:
                self.file.close()
            if self.sock is not None:
                self.sock.close()
            raise

    def open(self, host='', port=993, timeout=20):
        super().open(host, port, min(timeout, self.control.remaining(self.deadline)))
        self.control.check(self.deadline)  # Before greeting/CAPABILITY, not after __init__.

    def _resolve(self):
        # System getaddrinfo itself is not cancellable in a Python thread. Use
        # one small, killable stdlib-only process, with no mailbox credentials.
        code = ('import json,socket,sys; '
                'values=socket.getaddrinfo(sys.argv[1],int(sys.argv[2]),type=socket.SOCK_STREAM,proto=socket.IPPROTO_TCP); '
                'print(json.dumps([[int(f),int(t),int(p),a] for f,t,p,c,a in values if f in (socket.AF_INET,socket.AF_INET6)][:16]))')
        environment = {key: value for key, value in os.environ.items() if key in {"PATH", "LANG", "LC_ALL"}}
        process = subprocess.Popen([sys.executable, '-I', '-c', code, self.host, str(self.port)],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env=environment, start_new_session=True)
        deadline = min(self.deadline, time.monotonic() + 5)
        try:
            while True:
                self.control.remaining(deadline)
                try:
                    raw, _ = process.communicate(timeout=min(.05, self.control.remaining(deadline)))
                    break
                except subprocess.TimeoutExpired:
                    continue
            if process.returncode != 0 or len(raw) > 16384:
                raise OSError("邮箱服务器域名解析失败")
            values = json.loads(raw)
            if not isinstance(values, list) or not 0 < len(values) <= 16:
                raise OSError("邮箱服务器域名解析失败")
            for family, kind, protocol, address in values:
                if (family not in (socket.AF_INET, socket.AF_INET6) or kind != socket.SOCK_STREAM
                        or protocol != socket.IPPROTO_TCP or not isinstance(address, list)
                        or len(address) != (2 if family == socket.AF_INET else 4)
                        or not isinstance(address[0], str) or len(address[0]) > 256
                        or address[1] != self.port):
                    raise OSError("邮箱服务器域名解析失败")
                socket.inet_pton(family, address[0])
            return [(family, kind, protocol, tuple(address)) for family, kind, protocol, address in values]
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=1)
            process.stdout.close()

    def _create_socket(self, timeout):
        last_error = None
        connected = None
        for family, kind, protocol, address in self._resolve():
            self.control.remaining(self.deadline)
            sock = socket.socket(family, kind, protocol)
            self.sock = sock  # Register even while a TCP connect is in progress.
            try:
                sock.setblocking(False)
                status = sock.connect_ex(address)
                deadline = min(self.deadline, time.monotonic() + timeout)
                while status in {errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR}:
                    remaining = self.control.remaining(deadline)
                    _, write, error = select.select([], [sock], [sock], min(.1, remaining))
                    if write or error:
                        status = sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                if status:
                    raise OSError(status, "邮箱服务器连接失败")
                connected = sock
                break
            except OSError as error:
                last_error = error
                sock.close()
        if connected is None:
            raise last_error or OSError("邮箱服务器连接失败")
        try:
            self.control.remaining(self.deadline)
            wrapped = self.ssl_context.wrap_socket(connected, server_hostname=self.host,
                                                   do_handshake_on_connect=False)
            self.sock = wrapped
            wrapped.setblocking(False)
            deadline = min(self.deadline, time.monotonic() + timeout)
            while True:
                remaining = self.control.remaining(deadline)
                try:
                    wrapped.do_handshake()
                    break
                except ssl.SSLWantReadError:
                    select.select([wrapped], [], [], min(.1, remaining))
                except ssl.SSLWantWriteError:
                    select.select([], [wrapped], [], min(.1, remaining))
            self.control.check(self.deadline)
            return wrapped
        except BaseException:
            self.sock.close()
            raise

    def read(self, size):
        # Reject the server's literal length before imaplib allocates the body.
        if size > MAX_MESSAGE_BYTES:
            raise OversizedLiteral()
        if size > self.literal_limit:
            raise BatchLiteralBudget()
        raw = super().read(size)
        self.literal_limit -= len(raw)
        return raw


class MailboxControl:
    def __init__(self):
        self.cancelled = threading.Event()
        self.fetch_expired = threading.Event()
        self.client = None
        self.tasks = []

    def cancel(self):
        self.cancelled.set()
        self.close_socket()

    def expire_fetch(self):
        self.fetch_expired.set()
        self.close_socket()

    def close_socket(self):
        client = self.client
        if client is not None:
            try:
                client.sock.shutdown(socket.SHUT_RDWR)
            except (AttributeError, OSError):
                pass

    def remaining(self, deadline):
        if self.cancelled.is_set():
            raise InterruptedError("邮箱读取已取消")
        remaining = deadline - time.monotonic()
        if remaining <= 0 or self.fetch_expired.is_set():
            raise TimeoutError("本轮邮箱读取已达到时间预算")
        return remaining

    def check(self, deadline):
        remaining = self.remaining(deadline)
        if self.client is not None:
            self.client.sock.settimeout(min(20, remaining))


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
    header = b" ".join(part[0] if isinstance(part, tuple) else part
                       for part in parts if isinstance(part, (bytes, tuple)))
    match = INTERNAL_DATE.search(header)
    if not match:
        raise RuntimeError("邮箱未返回邮件收件时间")
    received = datetime.strptime(match.group(1).decode("ascii"), "%d-%b-%Y %H:%M:%S %z")
    return received.astimezone(timezone.utc).isoformat()


def response_for_uid(parts, uid, body=False):
    # imaplib splits a literal from its trailing response fields. UID is legal
    # on either side of BODY[], and unsolicited FETCH records can be interleaved.
    groups, current = [], []
    for part in parts:
        header = part[0] if isinstance(part, tuple) else part
        if not isinstance(header, bytes):
            continue
        if re.match(rb'^\d+ \(', header) and current:
            groups.append(current)
            current = []
        current.append(part)
    if current:
        groups.append(current)
    for group in groups:
        header = b" ".join(part[0] if isinstance(part, tuple) else part for part in group)
        matches = {int(value) for value in re.findall(rb'\bUID ([0-9]+)\b', header)}
        if matches == {uid}:
            if body:
                if not any(isinstance(part, tuple) for part in group) or b"BODY[]" not in header:
                    continue
            elif not INTERNAL_DATE.search(header) or not re.search(rb'\bRFC822\.SIZE [0-9]+\b', header):
                continue
            return group
    return []


def fetch_mailbox(after_uid: int = 0, start_date: str = "2026-10-08", company: str = "Xingxin", credentials: dict | None = None, control: MailboxControl | None = None, selected_uids: list[int] | None = None, expected_uid_validity: int | None = None) -> dict:
    if company not in {"Xingxin", "Huadeng"}:
        raise ValueError("公司板块无效")
    if selected_uids is not None:
        selected_uids = selected_mailbox_uids(selected_uids)
        if type(expected_uid_validity) is not int or not 1 <= expected_uid_validity <= 4294967295:
            raise ValueError("重试邮件需要原邮箱 UIDVALIDITY")
    prefix = "VOYAGEPLEX_HUADENG_MAIL_" if company == "Huadeng" else "VOYAGEPLEX_MAIL_"
    first_day = date.fromisoformat(start_date) if selected_uids is None else None
    address = (credentials.get("address", "") if credentials is not None else os.environ.get(prefix + "ADDRESS", "")).strip()
    secret = credentials.get("auth_code", "") if credentials is not None else os.environ.get(prefix + "AUTH_CODE", "")
    if not address or not secret:
        return {"configured": False, "messages": []}

    host = credentials.get("host", "imap.exmail.qq.com") if credentials is not None else os.environ.get(prefix + "IMAP_HOST", "imaphz.qiye.163.com")
    folder = credentials.get("folder", "INBOX") if credentials is not None else os.environ.get(prefix + "FOLDER", "INBOX")
    control = control or MailboxControl()
    deadline = time.monotonic() + FETCH_BUDGET_SECONDS
    control.check(deadline)
    timer = threading.Timer(FETCH_BUDGET_SECONDS, control.expire_fetch)
    timer.daemon = True
    timer.start()
    client = None
    try:
        client = BoundedImap(host, 993, timeout=20, control=control, deadline=deadline)
        control.client = client
        control.check(deadline)
        client.login(address, secret)
        control.check(deadline)
        identify_client(client)
        control.check(deadline)
        status, _ = client.select(folder, readonly=True)
        if status != "OK":
            raise RuntimeError(folder_failure(_))
        status, response = client.response("UIDVALIDITY")
        validity = int(response[0]) if status == "UIDVALIDITY" and response and response[0] else 0
        if selected_uids is not None:
            # A UID can refer to a different message after an inbox rebuild.
            # Never fetch a retry until its original namespace is confirmed.
            if validity != expected_uid_validity:
                raise MailboxUidValidityChanged("邮箱 UIDVALIDITY 已变化，无法安全重试原邮件")
            uids = selected_uids
        else:
            # IMAP SINCE uses server internal dates; search one day earlier and let
            # the API apply the exact China-time boundary to each fetched message.
            since = (first_day - timedelta(days=1)).strftime("%d-%b-%Y")
            control.check(deadline)
            status, found = client.uid("SEARCH", None, "SINCE", since)
            if status != "OK":
                raise RuntimeError("邮箱搜索失败")
            uids = [int(uid) for uid in (found[0] or b"").split() if int(uid) > after_uid]
        messages = []
        total_bytes = 0
        blocked_uid = None
        for uid in sorted(uids)[:MAX_MESSAGES]:
            # Fetch immutable metadata first. Never skip an unknown-date UID.
            received_at = ""
            try:
                control.check(deadline)
                status, parts = client.uid("FETCH", str(uid), "(INTERNALDATE RFC822.SIZE)")
                if status != "OK" or not parts:
                    raise RuntimeError()
                metadata = response_for_uid(parts, uid)
                received_at = received_at_from_fetch(metadata)
                header = b" ".join(part[0] if isinstance(part, tuple) else part for part in metadata)
                match = re.search(rb'\bRFC822\.SIZE ([0-9]+)\b', header)
                if not match:
                    raise RuntimeError()
                size = int(match[1])
            except Exception:
                if control.cancelled.is_set():
                    raise InterruptedError("邮箱读取已取消")
                # Metadata/network failures are transient even when the server
                # supplied a date. Commit only the preceding completed UIDs.
                messages.append({"uid": uid, "received_at": received_at, "raw": None,
                                 "error": "无法读取有效的邮件元数据", "failure_kind": "metadata",
                                 "retryable": True})
                blocked_uid = uid
                break
            if size > MAX_MESSAGE_BYTES:
                messages.append({"uid": uid, "received_at": received_at, "raw": None,
                                 "error": "邮件超过 25MB", "failure_kind": "message_size", "retryable": False})
                continue
            if total_bytes + size > MAX_BATCH_BYTES or time.monotonic() >= deadline:
                break  # Not attempted: no result and no cursor advance for this UID.
            try:
                control.check(deadline)
                client.literal_limit = min(MAX_MESSAGE_BYTES, MAX_BATCH_BYTES - total_bytes)
                status, parts = client.uid("FETCH", str(uid), "(BODY.PEEK[])")
                if status != "OK" or not parts:
                    raise RuntimeError()
                raw = next((part[1] for part in response_for_uid(parts, uid, body=True) if isinstance(part, tuple)), None)
                if not raw or len(raw) != size:
                    raise RuntimeError()
                if len(raw) > MAX_MESSAGE_BYTES or total_bytes + len(raw) > MAX_BATCH_BYTES:
                    raise OversizedLiteral()
                total_bytes += len(raw)
                messages.append({"uid": uid, "received_at": received_at,
                                 "raw": raw, "error": "", "retryable": False})
            except Exception as error:
                if control.cancelled.is_set():
                    raise InterruptedError("邮箱读取已取消")
                if isinstance(error, BatchLiteralBudget):
                    break  # Retry with a fresh batch; this is not a terminal oversize mail.
                messages.append({"uid": uid, "received_at": received_at, "raw": None,
                                 "error": "邮件正文读取失败，已保留收件时间供人工处理",
                                 "failure_kind": "message_size" if isinstance(error, OversizedLiteral) else "body_read",
                                 "retryable": not isinstance(error, OversizedLiteral)})
                if not isinstance(error, OversizedLiteral):
                    blocked_uid = uid
                break  # Never advance across a transient failure or reuse a broken stream.
        return {"configured": True, "address": address, "uid_validity": validity,
                "messages": messages, "blocked_uid": blocked_uid}
    finally:
        timer.cancel()
        control.client = None
        if client is not None:
            try:
                client.shutdown()
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
