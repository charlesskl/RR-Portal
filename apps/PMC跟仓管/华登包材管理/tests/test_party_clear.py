"""POST /party/<p>/clear/<cp>：一键清除对某对方的双向流水（保留 locked）。"""
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-04-01', locked=0):
    con = sqlite3.connect(app_module.DATABASE)
    cur = con.execute(
        "INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, locked) "
        "VALUES (?,?,?,?,?,?)",
        (recorded_by, from_party, to_party, date, 10, locked)
    )
    rid = cur.lastrowid
    con.commit(); con.close()
    return rid


def _count(**filters):
    con = sqlite3.connect(app_module.DATABASE)
    where = " AND ".join(f"{k}=?" for k in filters)
    sql = "SELECT COUNT(*) FROM flow_records" + (" WHERE " + where if where else "")
    n = con.execute(sql, list(filters.values())).fetchone()[0]
    con.close()
    return n


def test_clear_removes_both_directions(client):
    """收+发都清除。"""
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy')  # hd 发 sy
    _insert(recorded_by='hd', from_party='sy', to_party='hd')  # hd 记 sy 发来
    rv = client.post('/party/hd/clear/sy')
    assert rv.status_code == 302
    assert _count(recorded_by='hd') == 0


def test_clear_keeps_locked(client):
    _login(client, 'hd')
    rid = _insert(recorded_by='hd', from_party='hd', to_party='sy', locked=1)
    _insert(recorded_by='hd', from_party='hd', to_party='sy', locked=0)
    client.post('/party/hd/clear/sy')
    assert _count(recorded_by='hd') == 1
    assert _count(id=rid) == 1  # locked 那条还在


def test_clear_only_target_cp(client):
    """对 sy 清除时不影响对 xx 的记录。"""
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy')
    _insert(recorded_by='hd', from_party='hd', to_party='xx')  # 对 xx 的，不应被清
    client.post('/party/hd/clear/sy')
    assert _count(recorded_by='hd', to_party='sy') == 0
    assert _count(recorded_by='hd', to_party='xx') == 1


def test_clear_only_my_records(client):
    """sy 录的记录不应被 hd 清除。"""
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy')
    _insert(recorded_by='sy', from_party='hd', to_party='sy')  # sy 录的
    client.post('/party/hd/clear/sy')
    assert _count(recorded_by='hd') == 0
    assert _count(recorded_by='sy') == 1


def test_clear_other_party_blocked(client):
    """登录 xx 不能清 hd 的记录。"""
    _login(client, 'xx')
    _insert(recorded_by='hd', from_party='hd', to_party='sy')
    rv = client.post('/party/hd/clear/sy', follow_redirects=False)
    assert rv.status_code == 302
    assert _count(recorded_by='hd') == 1


def test_clear_invalid_cp_rejected(client):
    """非合法对方 → 拒。"""
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy')
    rv = client.post('/party/hd/clear/INVALID', follow_redirects=False)
    assert rv.status_code == 302
    assert _count(recorded_by='hd') == 1
