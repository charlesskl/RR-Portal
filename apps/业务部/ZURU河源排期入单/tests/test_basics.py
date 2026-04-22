# -*- coding: utf-8 -*-
"""基础安全与功能测试"""
import os
import sys
import tempfile
import json
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import (
    _session_path, _save_session, _load_session, _delete_session, _cleanup_pending,
    app as flask_app,
)


def test_session_path_rejects_invalid_chars():
    assert _session_path('20240101120000000000') is not None
    assert _session_path('../../etc/passwd') is None
    assert _session_path('abc;rm -rf') is None
    assert _session_path('') is None


def test_session_persistence_roundtrip():
    sid = 'test_session_001'
    data = {
        'orders': [{'po': '4500123456'}],
        'analysis': {'new_lines': []},
        'timestamp': datetime.now(),
    }
    _save_session(sid, data)
    loaded = _load_session(sid)
    assert loaded is not None
    assert loaded['orders'][0]['po'] == '4500123456'
    assert isinstance(loaded['timestamp'], datetime)
    _delete_session(sid)
    assert _load_session(sid) is None


def test_cleanup_pending_removes_expired():
    sid = 'test_session_old'
    old_time = datetime.now() - timedelta(hours=2)
    _save_session(sid, {'orders': [], 'timestamp': old_time})
    _cleanup_pending()
    assert _load_session(sid) is None


def test_csrf_protection_blocks_missing_token():
    with flask_app.test_client() as client:
        # GET 请求设置 cookie
        client.get('/')
        # POST 不带 X-CSRF-Token → 403
        resp = client.post('/api/hy-rescan')
        assert resp.status_code == 403


def test_csrf_protection_allows_with_token():
    with flask_app.test_client() as client:
        resp = client.get('/')
        token = None
        for header, value in resp.headers:
            if header.lower() == 'set-cookie' and 'hy_csrf_token=' in value:
                token = value.split('hy_csrf_token=')[1].split(';')[0]
                break
        assert token is not None
        resp2 = client.post('/api/hy-rescan', headers={'X-CSRF-Token': token})
        # 即使业务逻辑可能失败，也不应该是 403
        assert resp2.status_code != 403


def test_path_traversal_in_delete_blocked():
    with flask_app.test_client() as client:
        resp = client.post('/api/hy-delete-schedule',
                           json={'filename': '../../../etc/passwd'},
                           headers={'Content-Type': 'application/json'})
        assert resp.status_code in (403, 400)
