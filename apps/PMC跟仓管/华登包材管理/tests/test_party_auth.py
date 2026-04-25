"""测试 party 常量 / session helper / @party_required 装饰器。"""
import pytest


def test_parties_constants(client):
    import app as app_module
    assert app_module.PARTIES == {
        'hd': {'name': '华登',     'counterparties': ['sy', 'xx']},
        'sy': {'name': '邵阳华登', 'counterparties': ['hd', 'xx']},
        'xx': {'name': '兴信',     'counterparties': ['hd', 'sy']},
    }


def test_party_accounts_by_username(client):
    import app as app_module
    # 默认用户名 hd / sy / xx
    assert app_module.PARTY_BY_USERNAME.get('hd') == 'hd'
    assert app_module.PARTY_BY_USERNAME.get('sy') == 'sy'
    assert app_module.PARTY_BY_USERNAME.get('xx') == 'xx'


def test_current_party_when_not_logged(client):
    with client.session_transaction() as sess:
        sess.clear()
    import app as app_module
    with app_module.app.test_request_context():
        assert app_module.current_party() is None


def test_current_party_rejects_invalid():
    import app as app_module
    with app_module.app.test_request_context():
        from flask import session
        session['party'] = 'admin'
        assert app_module.current_party() is None
        session['party'] = 'hd'
        assert app_module.current_party() == 'hd'


def test_party_required_redirects_when_not_logged(client):
    rv = client.get('/party/hd', follow_redirects=False)
    assert rv.status_code == 302
    assert '/party/hd/login' in rv.location


def test_party_required_blocks_other_party(client):
    with client.session_transaction() as sess:
        sess['party'] = 'hd'
    rv = client.get('/party/sy', follow_redirects=False)
    assert rv.status_code == 302
    assert rv.location.endswith('/')


def test_login_success(client):
    rv = client.post('/party/hd/login', data={'username': 'hd', 'password': 'hd123456'},
                     follow_redirects=False)
    assert rv.status_code == 302
    assert rv.location.endswith('/party/hd')
    with client.session_transaction() as sess:
        assert sess.get('party') == 'hd'


def test_login_wrong_password(client):
    rv = client.post('/party/hd/login',
                     data={'username': 'hd', 'password': 'WRONG'},
                     follow_redirects=False)
    assert rv.status_code == 302  # 回登录页
    with client.session_transaction() as sess:
        assert sess.get('party') is None


def test_login_wrong_party(client):
    """用 sy 账号登 hd 登录页：应被拒（账号与 URL 不匹配）。"""
    rv = client.post('/party/hd/login', data={'username': 'sy', 'password': 'sy123456'},
                     follow_redirects=False)
    assert rv.status_code == 302
    with client.session_transaction() as sess:
        assert sess.get('party') is None


def test_logout_clears_session(client):
    with client.session_transaction() as sess:
        sess['party'] = 'hd'
    client.get('/party/hd/logout')
    with client.session_transaction() as sess:
        assert sess.get('party') is None
