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


@pytest.mark.skip(reason="party_login route created in Task 5")
def test_party_required_redirects_when_not_logged(client):
    rv = client.get('/party/hd', follow_redirects=False)
    assert rv.status_code == 302
    assert '/party/hd/login' in rv.location


@pytest.mark.skip(reason="party_login route created in Task 5")
def test_party_required_blocks_other_party(client):
    with client.session_transaction() as sess:
        sess['party'] = 'hd'
    rv = client.get('/party/sy', follow_redirects=False)
    assert rv.status_code == 302
    assert rv.location.endswith('/')
