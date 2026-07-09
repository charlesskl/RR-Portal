"""imap_service 单元测试（纯函数 + mock IMAP 连接）"""
import base64
import pytest
from unittest.mock import MagicMock, patch


# ── 纯函数测试 ────────────────────────────────────────────────────────────────

def test_build_criteria_all_empty():
    from apps.emails.imap_service import _build_criteria
    assert _build_criteria('', '', '', '') == ['ALL']


def test_build_criteria_subject_only():
    from apps.emails.imap_service import _build_criteria
    assert _build_criteria('做柜', '', '', '') == ['SUBJECT', '做柜']


def test_build_criteria_combined():
    from apps.emails.imap_service import _build_criteria
    result = _build_criteria('做柜', 'alice@x.com', '2026-03-01', '2026-04-01')
    assert 'SUBJECT' in result
    assert '做柜' in result
    assert 'FROM' in result
    assert 'alice@x.com' in result
    assert 'SINCE' in result
    assert '01-Mar-2026' in result
    assert 'BEFORE' in result
    assert '01-Apr-2026' in result


def test_build_criteria_invalid_date_ignored():
    from apps.emails.imap_service import _build_criteria
    result = _build_criteria('', '', 'not-a-date', '')
    # 无效日期被忽略，退回 ALL
    assert result == ['ALL']


def test_parse_attachments_finds_names():
    from apps.emails.imap_service import _parse_attachments
    bs = '("APPLICATION" "OCTET-STREAM" ("NAME" "PL260200876.xlsx") NIL NIL "BASE64")'
    result = _parse_attachments(bs)
    assert 'PL260200876.xlsx' in result


def test_parse_attachments_no_attachment():
    from apps.emails.imap_service import _parse_attachments
    assert _parse_attachments('("TEXT" "PLAIN" NIL NIL NIL "7BIT")') == []


def test_decode_str_utf8():
    from apps.emails.imap_service import _decode_str
    assert _decode_str('hello') == 'hello'


def test_decode_str_encoded_header():
    from apps.emails.imap_service import _decode_str
    import base64 as b64
    raw = '=?utf-8?b?' + b64.b64encode('做柜'.encode()).decode() + '?='
    assert _decode_str(raw) == '做柜'


# ── 加密/解密测试 ──────────────────────────────────────────────────────────────

def test_encrypt_decrypt_roundtrip(settings):
    settings.SECRET_KEY = 'test-secret-key-for-unit-test-only'
    from apps.emails.imap_service import encrypt_password, decrypt_password
    plain = 'MyP@ssw0rd!'
    token = encrypt_password(plain)
    assert token != plain
    assert decrypt_password(token) == plain


# ── test_connection mock 测试 ─────────────────────────────────────────────────

def test_test_connection_success(settings):
    settings.SECRET_KEY = 'test-secret-key-for-unit-test-only'
    from apps.emails.imap_service import test_connection
    mock_conn = MagicMock()
    mock_conn.login.return_value = ('OK', [b'Logged in'])
    with patch('apps.emails.imap_service.imaplib.IMAP4_SSL', return_value=mock_conn):
        test_connection('mail.example.com', 993, 'user@example.com', 'pass')
    mock_conn.login.assert_called_once_with('user@example.com', 'pass')
    mock_conn.logout.assert_called_once()


def test_test_connection_failure(settings):
    settings.SECRET_KEY = 'test-secret-key-for-unit-test-only'
    from apps.emails.imap_service import test_connection
    mock_conn = MagicMock()
    mock_conn.login.side_effect = Exception('Authentication failed')
    with patch('apps.emails.imap_service.imaplib.IMAP4_SSL', return_value=mock_conn):
        with pytest.raises(Exception, match='Authentication failed'):
            test_connection('mail.example.com', 993, 'user@example.com', 'wrongpass')
