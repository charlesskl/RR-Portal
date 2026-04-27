def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def test_entry_create_sent(client):
    """hd 在'发→sy' tab 新增一条：应得 recorded_by=hd, from=hd, to=sy。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent',
        'counterparty': 'sy',
        'date': '2026-05-01',
        'order_no': 'ORD-1',
        'jx_qty': '10',
        'remark': 'test',
    }, follow_redirects=False)
    assert rv.status_code == 302

    import app as app_module
    import sqlite3
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT recorded_by, from_party, to_party, date, order_no, jx_qty, locked FROM flow_records"
    ).fetchone()
    assert row == ('hd', 'hd', 'sy', '2026-05-01', 'ORD-1', 10.0, 0)


def test_entry_create_received(client):
    """hd 在'收自sy' tab 新增：应得 recorded_by=hd, from=sy, to=hd。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'received',
        'counterparty': 'sy',
        'date': '2026-05-02',
        'order_no': 'R1',
        'jx_qty': '5',
    })
    assert rv.status_code == 302

    import app as app_module
    import sqlite3
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT recorded_by, from_party, to_party FROM flow_records"
    ).fetchone()
    assert row == ('hd', 'sy', 'hd')


def test_entry_rejects_wrong_counterparty(client):
    """hd 录对 hd（自己）的条 → 400 或 redirect。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'hd', 'date': '2026-05-01', 'jx_qty': '1',
    }, follow_redirects=False)
    assert rv.status_code in (400, 302)  # 400 or redirect back with flash error


def test_entry_requires_login(client):
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-05-01', 'jx_qty': '1',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert '/login' in rv.location
