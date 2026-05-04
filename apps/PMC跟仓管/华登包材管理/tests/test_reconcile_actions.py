import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _create_pending(initiator='hd', approver='sy', date_from='2026-05-01', date_to='2026-05-31'):
    con = sqlite3.connect(app_module.DATABASE)
    pair_low, pair_high = sorted([initiator, approver])
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_approval')
    """, (initiator, approver, pair_low, pair_high, date_from, date_to))
    rid = cur.lastrowid
    # 挂一条 record
    con.execute("""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, reconciliation_id)
        VALUES (?, ?, ?, ?, 10, ?)
    """, (initiator, initiator, approver, '2026-05-15', rid))
    con.commit(); con.close()
    return rid


def test_approve_by_approver(client):
    rid = _create_pending()
    _login(client, 'sy')  # sy 是 approver
    rv = client.post(f'/reconcile/{rid}/approve')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()
    assert row[0] == 'confirmed'
    locked = con.execute("SELECT locked FROM flow_records WHERE reconciliation_id=?", (rid,)).fetchall()
    assert all(r[0] == 1 for r in locked)


def test_approve_blocked_by_initiator(client):
    rid = _create_pending()
    _login(client, 'hd')  # initiator
    rv = client.post(f'/reconcile/{rid}/approve', follow_redirects=False)
    assert rv.status_code in (403, 302)
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'pending_approval'


def test_reject_by_approver(client):
    rid = _create_pending()
    _login(client, 'sy')
    rv = client.post(f'/reconcile/{rid}/reject', data={'notes': 'wrong number'})
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT status, notes FROM reconciliations WHERE id=?", (rid,)).fetchone()
    assert row == ('disputed', 'wrong number')
    # records 解绑
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE reconciliation_id=?", (rid,)).fetchone()[0] == 0


def test_withdraw_by_initiator(client):
    rid = _create_pending()
    _login(client, 'hd')
    rv = client.post(f'/reconcile/{rid}/withdraw')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'withdrawn'


def test_cancel_confirmed_unlocks(client):
    rid = _create_pending()
    # 手动先改成 confirmed + locked
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE reconciliations SET status='confirmed' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET locked=1 WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    # 任一方都能撤销
    _login(client, 'hd')
    rv = client.post(f'/reconcile/{rid}/cancel')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()
    assert row[0] == 'withdrawn'
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE locked=1").fetchone()[0] == 0


# ========== status-guard 负面测试（锁住状态机，防 Task 14+ 改坏）==========

def test_approve_rejects_confirmed(client):
    """已 confirmed 再 approve → status 守卫拒，状态不变。"""
    rid = _create_pending()
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE reconciliations SET status='confirmed' WHERE id=?", (rid,))
    con.commit(); con.close()
    _login(client, 'sy')
    rv = client.post(f'/reconcile/{rid}/approve', follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'confirmed'


def test_withdraw_rejects_confirmed(client):
    """已 confirmed 再 withdraw → 拒，状态不变。"""
    rid = _create_pending()
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE reconciliations SET status='confirmed' WHERE id=?", (rid,))
    con.commit(); con.close()
    _login(client, 'hd')
    rv = client.post(f'/reconcile/{rid}/withdraw', follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'confirmed'


def test_cancel_rejects_pending(client):
    """pending_approval 不能 cancel（cancel 仅限 confirmed），状态不变。"""
    rid = _create_pending()
    _login(client, 'hd')
    rv = client.post(f'/reconcile/{rid}/cancel', follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'pending_approval'


def test_cancel_by_outsider(client):
    """xx 不在 hd-sy pair → cancel 被拒，confirmed 状态保留，records 仍 locked。"""
    rid = _create_pending()
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE reconciliations SET status='confirmed' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET locked=1 WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    _login(client, 'xx')
    rv = client.post(f'/reconcile/{rid}/cancel', follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'confirmed'
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE locked=1").fetchone()[0] == 1
