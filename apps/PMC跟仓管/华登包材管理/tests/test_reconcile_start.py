import sqlite3
import json
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(**kw):
    defaults = {'jx_qty': 0}
    defaults.update(kw)
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'from_party', 'to_party', 'date'] + [k for k in defaults if k.endswith('_qty')]
    vals = [defaults[k] for k in cols]
    con.execute(f"INSERT INTO flow_records ({', '.join(cols)}) VALUES ({', '.join(['?']*len(cols))})", vals)
    con.commit(); con.close()


def test_reconcile_start_creates_row(client):
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=100)
    rv = client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    })
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT initiator_party, approver_party, pair_low, pair_high, status FROM reconciliations"
    ).fetchone()
    assert row == ('hd', 'sy', 'hd', 'sy', 'pending_approval')


def test_reconcile_start_sets_reconciliation_id(client):
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=10)
    _insert(recorded_by='sy', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=10)
    client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    })
    con = sqlite3.connect(app_module.DATABASE)
    rids = [r[0] for r in con.execute("SELECT reconciliation_id FROM flow_records").fetchall()]
    assert all(rid is not None for rid in rids)
    assert len(set(rids)) == 1  # 同一批


def test_reconcile_start_stores_snapshot(client):
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=100)
    _insert(recorded_by='sy', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=98)
    client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    })
    con = sqlite3.connect(app_module.DATABASE)
    snap = con.execute("SELECT snapshot_json FROM reconciliations").fetchone()[0]
    data = json.loads(snap)
    assert data['hd_to_sy']['sender_recorded']['jx'] == 100
    assert data['hd_to_sy']['receiver_recorded']['jx'] == 98
    assert data['hd_to_sy']['diffs']['jx'] == 2


def test_reconcile_start_rejects_overlap_pending(client):
    """同 pair 已有 pending 的范围 overlap → redirect 不新增。"""
    _login(client, 'hd')
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status)
        VALUES ('hd','sy','hd','sy','2026-05-01','2026-05-31','pending_approval')
    """)
    con.commit(); con.close()
    rv = client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-15', 'date_to': '2026-06-15'
    }, follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    ct = con.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0]
    assert ct == 1  # 没新增


def test_reconcile_start_requires_login(client):
    """未登录直接 POST → redirect 到 index，不应新增。"""
    rv = client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    }, follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0] == 0


def test_reconcile_start_rejects_invalid_counterparty(client):
    """对自己 / 不存在的 cp / 非 counterparty → 拒，不新增。"""
    _login(client, 'hd')
    for bad_cp in ('hd', 'zz', ''):
        rv = client.post('/reconcile/start', data={
            'counterparty': bad_cp, 'date_from': '2026-05-01', 'date_to': '2026-05-01'
        }, follow_redirects=False)
        assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0] == 0


def test_reconcile_start_rejects_missing_date(client):
    """缺日期 → 拒，不新增。"""
    _login(client, 'hd')
    rv = client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '', 'date_to': ''
    }, follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0] == 0
