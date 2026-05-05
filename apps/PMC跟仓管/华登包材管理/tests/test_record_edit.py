import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(date='2026-05-01', locked=0, recorded_by='hd', from_party='hd', to_party='sy', jx_qty=0):
    con = sqlite3.connect(app_module.DATABASE)
    cur = con.execute(
        "INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, locked) VALUES (?,?,?,?,?,?)",
        (recorded_by, from_party, to_party, date, jx_qty, locked)
    )
    rid = cur.lastrowid
    con.commit(); con.close()
    return rid


def test_edit_own_record(client):
    _login(client, 'hd')
    rid = _insert(jx_qty=5)
    rv = client.post(f'/record/{rid}/edit', data={
        'date': '2026-05-02', 'order_no': 'NEW', 'jx_qty': '99', 'remark': 'edited',
    })
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT date, order_no, jx_qty FROM flow_records WHERE id=?", (rid,)).fetchone()
    assert row == ('2026-05-02', 'NEW', 99.0)


def test_edit_blocks_if_locked(client):
    _login(client, 'hd')
    rid = _insert(locked=1, jx_qty=5)
    rv = client.post(f'/record/{rid}/edit', data={'date': '2026-05-02', 'jx_qty': '1'},
                     follow_redirects=False)
    assert rv.status_code in (403, 302)  # rejected
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT date, jx_qty FROM flow_records WHERE id=?", (rid,)).fetchone()
    assert row == ('2026-05-01', 5.0), '被锁记录不应被改'


def test_edit_blocks_other_party(client):
    """hd 想改 sy 的记录 → 拒。"""
    _login(client, 'hd')
    rid = _insert(recorded_by='sy', from_party='sy', to_party='xx', jx_qty=5)
    rv = client.post(f'/record/{rid}/edit', data={'date': '2026-05-02', 'jx_qty': '1'},
                     follow_redirects=False)
    assert rv.status_code in (403, 302)
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT date, jx_qty, recorded_by FROM flow_records WHERE id=?", (rid,)).fetchone()
    assert row == ('2026-05-01', 5.0, 'sy'), '他人记录不应被改'


def test_delete_own_record(client):
    _login(client, 'hd')
    rid = _insert()
    rv = client.post(f'/record/{rid}/delete')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE id=?", (rid,)).fetchone()[0] == 0


def test_delete_blocks_if_locked(client):
    _login(client, 'hd')
    rid = _insert(locked=1)
    rv = client.post(f'/record/{rid}/delete', follow_redirects=False)
    assert rv.status_code in (403, 302)
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE id=?", (rid,)).fetchone()[0] == 1  # 还在


def test_delete_blocks_other_party(client):
    """hd 想删 sy 的记录 → 拒，且记录仍在。"""
    _login(client, 'hd')
    rid = _insert(recorded_by='sy', from_party='sy', to_party='xx')
    rv = client.post(f'/record/{rid}/delete', follow_redirects=False)
    assert rv.status_code in (403, 302)
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE id=?", (rid,)).fetchone()[0] == 1
