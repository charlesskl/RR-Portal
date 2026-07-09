"""EML 文件解析器 — 从 .eml 文件中提取邮件信息和附件。

特别处理 Foxmail 导出的 EML 文件编码问题（gb2312/gbk/utf-8）。
"""

import email
import os
from email import policy
from email.header import decode_header
from email.utils import parsedate_to_datetime

from django.conf import settings


def parse_eml_file(eml_path: str) -> dict:
    """解析 .eml 文件，提取主题、发件人、正文和附件。"""
    with open(eml_path, 'rb') as f:
        raw_bytes = f.read()

    # 先尝试用 policy.default 解析
    msg = email.message_from_bytes(raw_bytes, policy=policy.default)

    # 提取正文 — 需要特别处理编码
    body_text = _extract_body(msg, raw_bytes)

    result = {
        'message_id': msg.get('Message-ID', ''),
        'subject': _decode_header_safe(msg.get('Subject', '')),
        'sender': _decode_header_safe(msg.get('From', '')),
        'received_at': _parse_date(msg.get('Date', '')),
        'body_text': body_text,
        'attachments': _save_attachments(msg),
    }
    return result


def _decode_header_safe(value):
    """安全解码邮件头字段，处理各种编码。"""
    if not value:
        return ''
    # 如果已经是正常字符串且无乱码
    if isinstance(value, str) and not _has_garbled(value):
        return value
    # 尝试用 decode_header 解码
    try:
        parts = decode_header(str(value))
        decoded = []
        for part, charset in parts:
            if isinstance(part, bytes):
                for enc in [charset, 'utf-8', 'gbk', 'gb2312', 'gb18030', 'big5', 'latin-1']:
                    if enc:
                        try:
                            decoded.append(part.decode(enc))
                            break
                        except (UnicodeDecodeError, LookupError):
                            continue
                else:
                    decoded.append(part.decode('utf-8', errors='replace'))
            else:
                decoded.append(str(part))
        return ''.join(decoded)
    except Exception:
        return str(value)


def _has_garbled(text):
    """检测文本是否包含常见乱码特征。"""
    if not text:
        return False
    garbled_count = sum(1 for c in text if '\ufffd' == c or (0x80 <= ord(c) <= 0xFF))
    return garbled_count > len(text) * 0.1


def _parse_date(date_str):
    """解析邮件日期字符串。"""
    if not date_str:
        return None
    try:
        return parsedate_to_datetime(str(date_str))
    except Exception:
        return None


def _extract_body(msg, raw_bytes=None) -> str:
    """从邮件中提取正文，特别处理编码问题。"""
    def _html_to_text(html):
        """简单的HTML转纯文本"""
        import re as _re
        text = _re.sub(r'<br\s*/?\s*>', '\n', html, flags=_re.IGNORECASE)
        text = _re.sub(r'<p[^>]*>', '\n', text, flags=_re.IGNORECASE)
        text = _re.sub(r'</p>', '\n', text, flags=_re.IGNORECASE)
        text = _re.sub(r'<[^>]+>', '', text)
        text = _re.sub(r'&nbsp;', ' ', text)
        text = _re.sub(r'&lt;', '<', text)
        text = _re.sub(r'&gt;', '>', text)
        text = _re.sub(r'&amp;', '&', text)
        text = _re.sub(r'&#\d+;', '', text)
        return text.strip()

    # 方法1：用 policy.default 的 get_body
    body = msg.get_body(preferencelist=('plain', 'html'))
    if body is not None:
        try:
            content = body.get_content()
            if isinstance(content, str) and not _has_garbled(content):
                # 如果是HTML，转成纯文本
                if '<html' in content.lower() or '<body' in content.lower() or '<div' in content.lower():
                    return _html_to_text(content)
                return content
        except Exception:
            pass

    # 方法2：遍历所有 parts，手动解码
    for part in msg.walk():
        content_type = part.get_content_type()
        if content_type not in ('text/plain', 'text/html'):
            continue
        disposition = part.get('Content-Disposition', '')
        if 'attachment' in disposition:
            continue

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        # 尝试多种编码
        charset = part.get_content_charset()
        for enc in [charset, 'utf-8', 'gbk', 'gb2312', 'gb18030', 'big5', 'latin-1']:
            if enc:
                try:
                    text = payload.decode(enc)
                    if not _has_garbled(text):
                        if content_type == 'text/html':
                            return _html_to_text(text)
                        return text
                except (UnicodeDecodeError, LookupError):
                    continue

        # 最后用 replace 模式
        text = payload.decode('utf-8', errors='replace')
        if content_type == 'text/html':
            return _html_to_text(text)
        return text

    # 方法3：从原始字节中暴力提取
    if raw_bytes:
        for enc in ['utf-8', 'gbk', 'gb2312', 'gb18030']:
            try:
                text = raw_bytes.decode(enc, errors='replace')
                if not _has_garbled(text):
                    return text
            except Exception:
                continue

    return ''


def _save_attachments(msg) -> list:
    """保存邮件中的附件到 media/attachments/ 目录。"""
    attachments_dir = os.path.join(settings.MEDIA_ROOT, 'attachments')
    os.makedirs(attachments_dir, exist_ok=True)

    saved = []
    for part in msg.walk():
        # 跳过 multipart 容器
        if part.get_content_maintype() == 'multipart':
            continue

        # message/rfc822：嵌套邮件附件（用户转发 .eml）
        # walk() 不会进入嵌套邮件的子部件，需要手动递归
        if part.get_content_type() == 'message/rfc822':
            payload = part.get_payload()
            inner_msg = payload[0] if isinstance(payload, list) and payload else payload
            if inner_msg is None:
                continue
            # 保存嵌套 .eml 文件本身
            inner_fn = _decode_header_safe(part.get_filename() or '') or '嵌套邮件.eml'
            if not inner_fn.lower().endswith('.eml'):
                inner_fn += '.eml'
            safe_inner = "".join(c for c in inner_fn if c not in '<>:"/\\|?*') or '嵌套邮件.eml'
            inner_path = os.path.join(attachments_dir, safe_inner)
            try:
                with open(inner_path, 'wb') as f:
                    f.write(inner_msg.as_bytes())
                saved.append({
                    'filename': inner_fn,
                    'saved_path': inner_path,
                    'content_type': 'message/rfc822',
                    'size': os.path.getsize(inner_path),
                })
            except Exception:
                pass
            # 递归提取嵌套邮件的内部附件（如真正的 PL.xlsx）
            try:
                saved.extend(_save_attachments(inner_msg))
            except Exception:
                pass
            continue

        filename = part.get_filename()
        content_disposition = part.get('Content-Disposition', '')

        # 有文件名就当附件处理（不管是 attachment 还是 inline）
        if not filename:
            # 没有文件名但标记为附件，也跳过
            if 'attachment' not in content_disposition:
                continue

        # 解码文件名
        filename = _decode_header_safe(filename)

        # 获取二进制内容
        payload = part.get_payload(decode=True)
        if payload is None:
            try:
                data = part.get_content()
                if isinstance(data, str):
                    payload = data.encode('utf-8')
                elif isinstance(data, bytes):
                    payload = data
            except Exception:
                continue
        if not payload:
            continue

        # 清理文件名中的非法字符
        safe_filename = "".join(c for c in filename if c not in '<>:"/\\|?*')
        if not safe_filename:
            safe_filename = 'attachment'

        saved_path = os.path.join(attachments_dir, safe_filename)
        with open(saved_path, 'wb') as f:
            f.write(payload)

        saved.append({
            'filename': filename,
            'saved_path': saved_path,
            'content_type': part.get_content_type(),
            'size': len(payload),
        })

    return saved
