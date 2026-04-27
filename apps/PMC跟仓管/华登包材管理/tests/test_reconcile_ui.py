import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _create(initiator='hd', approver='sy', status='pending_approval', date_from='2026-05-01', date_to='2026-05-31'):
    con = sqlite3.connect(app_module.DATABASE)
    pl, ph = sorted([initiator, approver])
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
    """, (initiator, approver, pl, ph, date_from, date_to, status))
    rid = cur.lastrowid
    con.commit(); con.close()
    return rid


def test_reconcile_list_shows_relevant(client):
    """hd 登录，能看到自己发起的 + 自己作为 approver 的。"""
    rid1 = _create('hd', 'sy')
    rid2 = _create('sy', 'hd')
    _create('sy', 'xx')  # hd 无关
    _login(client, 'hd')
    rv = client.get('/reconcile')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert f'/reconcile/{rid1}' in html
    assert f'/reconcile/{rid2}' in html


def test_reconcile_detail_page(client):
    rid = _create('hd', 'sy')
    _login(client, 'hd')
    rv = client.get(f'/reconcile/{rid}')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert 'pending_approval' in html or '待审批' in html


def test_reconcile_detail_shows_approve_button_for_approver(client):
    rid = _create('hd', 'sy')
    _login(client, 'sy')
    rv = client.get(f'/reconcile/{rid}')
    html = rv.data.decode('utf-8')
    assert 'approve' in html or '同意' in html


def test_reconcile_detail_hides_approve_for_initiator(client):
    rid = _create('hd', 'sy')
    _login(client, 'hd')
    rv = client.get(f'/reconcile/{rid}')
    html = rv.data.decode('utf-8')
    # initiator 看到 withdraw 不看到 approve 按钮
    assert '撤回' in html
    assert '同意' not in html


def test_reconcile_list_requires_login(client):
    """未登录访问 /reconcile → redirect。"""
    rv = client.get('/reconcile', follow_redirects=False)
    assert rv.status_code == 302


def test_reconcile_detail_requires_login(client):
    """未登录访问 /reconcile/<rid> → redirect。"""
    rid = _create('hd', 'sy')
    rv = client.get(f'/reconcile/{rid}', follow_redirects=False)
    assert rv.status_code == 302


def test_reconcile_detail_bad_rid(client):
    """不存在的 rid → flash + redirect 到 list。"""
    _login(client, 'hd')
    rv = client.get('/reconcile/99999', follow_redirects=False)
    assert rv.status_code == 302
    assert '/reconcile' in rv.location
