"""IMAP 服务模块 — 连接验证、服务端搜索、邮件下载、密码加密。

所有 IMAP 操作基于 UID（不用序列号），防止文件夹内邮件数量变化导致错误。
"""
import base64
import hashlib
import imaplib
import re
import email as email_lib
from datetime import datetime
from email.header import decode_header as _decode_header

from cryptography.fernet import Fernet
from django.conf import settings

imaplib._MAXLINE = 100000000  # 增大到100MB，避免大邮件BODYSTRUCTURE或大量UID超限


# ── 加密工具 ──────────────────────────────────────────────────────────────────

def _get_fernet() -> Fernet:
    """从 Django SECRET_KEY 派生 Fernet key（SHA-256 → base64）。"""
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()  # 32 bytes
    b64_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(b64_key)


def encrypt_password(plain: str) -> str:
    """AES 加密明文密码，返回 token 字符串。"""
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_password(token: str) -> str:
    """解密 encrypt_password 返回的 token。"""
    return _get_fernet().decrypt(token.encode()).decode()


# ── IMAP 连接测试 ──────────────────────────────────────────────────────────────

def test_connection(host: str, port: int, mail_user: str, password: str) -> None:
    """尝试 IMAP 登录，成功后立即退出。失败时抛出异常（含服务器错误信息）。"""
    conn = imaplib.IMAP4_SSL(host, port, timeout=10)
    try:
        conn.login(mail_user, password)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


# ── 邮件搜索 ──────────────────────────────────────────────────────────────────

def search_emails(
    host: str,
    port: int,
    mail_user: str,
    password: str,
    folder: str = 'INBOX',
    subject: str = '',
    sender: str = '',
    date_from: str = '',
    date_to: str = '',
) -> tuple:
    """取最近邮件并在客户端过滤，返回 (email_list, folder_used)。

    163企业邮IMAP服务端SUBJECT搜索不可靠，改为：
    - 用SINCE日期缩小范围（如有date_from）
    - 拉取最新200封邮件头，客户端按subject/sender关键词过滤
    - email_list 每项结构：{ uid, subject, sender, date, has_attachment, attachments }
    """
    conn = imaplib.IMAP4_SSL(host, port, timeout=15)
    try:
        conn.login(mail_user, password)

        # 处理"已发送"文件夹名称兼容性
        folder_used = folder
        if folder.upper() in ('SENT', 'SENT MESSAGES', '已发送'):
            folder_used = _detect_sent_folder(conn)

        conn.select(folder_used, readonly=True)

        # 只用日期缩小范围（服务端支持较好），其余客户端过滤
        server_criteria = ['ALL']
        if date_from:
            try:
                dt = datetime.strptime(date_from, '%Y-%m-%d')
                server_criteria = ['SINCE', dt.strftime('%d-%b-%Y')]
            except ValueError:
                pass
        if date_to and server_criteria != ['ALL']:
            try:
                dt = datetime.strptime(date_to, '%Y-%m-%d')
                server_criteria += ['BEFORE', dt.strftime('%d-%b-%Y')]
            except ValueError:
                pass

        st, data = conn.uid('search', None, *server_criteria)
        if st != 'OK' or not data or not data[0]:
            return [], folder_used

        # 取最新 50 封（逆序 = 最新在前）
        all_uids = data[0].split()
        uids = all_uids[::-1][:50]

        results = []
        # 逐封拉取，避免批量fetch时163服务器返回额外数据导致imaplib解析失败
        for uid in uids:
            try:
                st2, raw_data = conn.uid(
                    'fetch', uid,
                    '(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE CONTENT-TYPE)])'
                )
                if st2 != 'OK' or not raw_data or not isinstance(raw_data[0], tuple):
                    continue
                msg = email_lib.message_from_bytes(raw_data[0][1])
                ct = msg.get('Content-Type', '').lower()
                has_att = 'multipart/mixed' in ct or 'multipart/related' in ct
                results.append({
                    'uid': uid.decode() if isinstance(uid, bytes) else uid,
                    'subject': _decode_str(msg.get('Subject', '')),
                    'sender': _decode_str(msg.get('From', '')),
                    'date': _clean_date(msg.get('Date', '')),
                    'has_attachment': has_att,
                    'attachments': [],
                })
            except Exception:
                continue

        # 客户端过滤 subject / sender（大小写不敏感）
        if subject:
            kw = subject.lower()
            results = [r for r in results if kw in r.get('subject', '').lower()]
        if sender:
            kw = sender.lower()
            results = [r for r in results if kw in r.get('sender', '').lower()]

        return results, folder_used

    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _parse_fetch_result(raw_data: list) -> list:
    """解析 IMAP uid fetch 返回的原始数据列表，提取邮件摘要。"""
    results = []
    i = 0
    while i < len(raw_data):
        item = raw_data[i]
        if not isinstance(item, tuple):
            i += 1
            continue

        meta = item[0] if isinstance(item[0], bytes) else b''
        uid_m = re.search(rb'UID\s+(\d+)', meta)
        uid_str = uid_m.group(1).decode() if uid_m else ''

        raw_headers = item[1] if len(item) > 1 else b''

        if uid_str and raw_headers:
            msg = email_lib.message_from_bytes(raw_headers)
            ct = msg.get('Content-Type', '').lower()
            has_att = 'multipart/mixed' in ct or 'multipart/related' in ct
            results.append({
                'uid': uid_str,
                'subject': _decode_str(msg.get('Subject', '')),
                'sender': _decode_str(msg.get('From', '')),
                'date': _clean_date(msg.get('Date', '')),
                'has_attachment': has_att,
                'attachments': [],
            })
        i += 1
    return results


# ── 邮件下载 ──────────────────────────────────────────────────────────────────

def fetch_email_bytes(
    host: str,
    port: int,
    mail_user: str,
    password: str,
    folder: str,
    uid: str,
) -> bytes:
    """下载指定 UID 邮件的完整原始字节（RFC822）。"""
    conn = imaplib.IMAP4_SSL(host, port)
    try:
        conn.login(mail_user, password)
        conn.select(folder, readonly=True)
        st, data = conn.uid('fetch', uid.encode(), '(RFC822)')
        if st != 'OK' or not data or data[0] is None:
            raise ValueError(f'邮件获取失败 uid={uid}')
        return data[0][1]
    finally:
        try:
            conn.logout()
        except Exception:
            pass


# ── 辅助函数 ──────────────────────────────────────────────────────────────────

def _detect_sent_folder(conn) -> str:
    """通过 LIST 命令探测已发送文件夹的实际名称。"""
    candidates = ['Sent Messages', 'Sent', '已发送', 'SENT']
    st, folders = conn.list()
    if st == 'OK':
        folder_names = []
        for f in folders:
            if isinstance(f, bytes):
                m = re.search(rb'"([^"]+)"\s*$|(\S+)\s*$', f)
                if m:
                    name = (m.group(1) or m.group(2)).decode('utf-8', errors='replace').strip('"')
                    folder_names.append(name)
        for cand in candidates:
            if any(cand.lower() == fn.lower() for fn in folder_names):
                return cand
    return 'Sent Messages'


def _parse_attachments(bs_raw: str) -> list:
    """从 BODYSTRUCTURE 字符串中提取附件文件名列表。

    BODYSTRUCTURE 格式：("NAME" "filename.xlsx") 或 (NAME "filename.xlsx")
    两种形式均需匹配。
    """
    return re.findall(r'"?(?:name|filename)"?\s+"([^"]+)"', bs_raw, re.IGNORECASE)


def _build_criteria(subject: str, sender: str, date_from: str, date_to: str) -> list:
    """构造 IMAP SEARCH 条件列表。所有字段均可选，全空时返回 ['ALL']。"""
    criteria = []
    if subject:
        criteria += ['SUBJECT', subject]
    if sender:
        criteria += ['FROM', sender]
    if date_from:
        try:
            dt = datetime.strptime(date_from, '%Y-%m-%d')
            criteria += ['SINCE', dt.strftime('%d-%b-%Y')]
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.strptime(date_to, '%Y-%m-%d')
            criteria += ['BEFORE', dt.strftime('%d-%b-%Y')]
        except ValueError:
            pass
    return criteria if criteria else ['ALL']


def _decode_str(val) -> str:
    """解码邮件头字段（支持 UTF-8 / GBK / GB2312）。"""
    if not val:
        return ''
    parts = _decode_header(str(val))
    out = []
    for part, charset in parts:
        if isinstance(part, bytes):
            for enc in [charset, 'utf-8', 'gbk', 'gb2312', 'latin-1']:
                if enc:
                    try:
                        out.append(part.decode(enc))
                        break
                    except Exception:
                        continue
            else:
                out.append(part.decode('utf-8', errors='replace'))
        else:
            out.append(str(part))
    return ''.join(out)


def _clean_date(raw: str) -> str:
    """截取日期字符串前 16 位并去除空白。"""
    return raw[:16].strip() if raw else ''
