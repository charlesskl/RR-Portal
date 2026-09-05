"""回归：解锁带 reconciliation_id 的时间段锁不再 500。

根因：period_lock_delete 的 overlap 查询 LEFT JOIN reconciliations 但只 SELECT l.*，
Python 侧按 reconciliation 对过滤时读 lk['initiator_party'] 触发 IndexError。
"""
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _mk_reconciliation_lock(client):
    """建一条已确认对账 + 其时间段锁，返回 lock id。"""
    con = sqlite3.connect(app_module.DATABASE)
    con.execute(
        "INSERT INTO reconciliations (id, initiator_party, approver_party, pair_low, pair_high, date_from, date_to, status)"
        " VALUES (214, 'hd', 'sy', 'hd', 'sy', '2026-08-01', '2026-08-01', 'confirmed')")
    con.execute(
        "INSERT INTO period_locks (party, date_from, date_to, reconciliation_id, reason)"
        " VALUES ('hd', '2026-08-01', '2026-08-01', 214, 'test')")
    lid = con.execute("SELECT id FROM period_locks").fetchone()[0]
    con.commit(); con.close()
    return lid


def test_unlock_lock_with_reconciliation(client):
    lid = _mk_reconciliation_lock(client)
    _login(client, 'hd')
    rv = client.post(f'/locks/{lid}/delete', data={})
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM period_locks WHERE id=?", (lid,)).fetchone()[0] == 0
    con.close()


def test_unlock_partial_range_keeps_remainder(client):
    lid = _mk_reconciliation_lock(client)
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE period_locks SET date_from='2026-08-01', date_to='2026-08-10' WHERE id=?", (lid,))
    con.commit(); con.close()
    _login(client, 'hd')
    rv = client.post(f'/locks/{lid}/delete',
                     data={'unlock_from': '2026-08-03', 'unlock_to': '2026-08-05'})
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    con.row_factory = sqlite3.Row
    ranges = sorted((r['date_from'], r['date_to'])
                    for r in con.execute("SELECT * FROM period_locks WHERE party='hd'").fetchall())
    con.close()
    assert ranges == [('2026-08-01', '2026-08-02'), ('2026-08-06', '2026-08-10')]
