"""包材筛选 + 对账时间段锁定。"""
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(recorded_by, from_p, to_p, date, order_no=None, **qtys):
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'from_party', 'to_party', 'date', 'order_no'] + list(qtys.keys())
    placeholders = ', '.join(['?'] * len(cols))
    con.execute(f"INSERT INTO flow_records ({', '.join(cols)}) VALUES ({placeholders})",
                [recorded_by, from_p, to_p, date, order_no, *qtys.values()])
    con.commit(); con.close()


def test_item_filter_only_returns_records_with_that_item(client):
    """按包材筛选：item=mkb 只返回木卡板非零的记录。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', mkb_qty=10)
    _insert('hd', 'hd', 'sy', '2026-05-02', jx_qty=99)
    _insert('hd', 'hd', 'sy', '2026-05-03', mkb_qty=5, jx_qty=3)
    con = sqlite3.connect(app_module.DATABASE)
    con.row_factory = sqlite3.Row
    rows = app_module._query_flow(con, recorded_by='hd', from_party='hd', to_party='sy', item='mkb')
    con.close()
    assert len(rows) == 2
    assert all(r['mkb_qty'] for r in rows)


def test_item_filter_invalid_falls_back_to_all(client):
    """非法 item 值不报错、不过滤。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=1)
    con = sqlite3.connect(app_module.DATABASE)
    con.row_factory = sqlite3.Row
    rows = app_module._query_flow(con, recorded_by='hd', from_party='hd', to_party='sy', item='hacked')
    con.close()
    assert len(rows) == 1


def test_item_filter_on_page(client):
    """页面带 item 参数只显示对应记录，汇总只含对应条目。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', mkb_qty=10)
    _insert('hd', 'hd', 'sy', '2026-05-02', jx_qty=99)
    _login(client, 'hd')
    rv = client.get('/party/hd?item=mkb')
    html = rv.data.decode('utf-8')
    assert 'selected>木卡板' in html
    # 含木卡板的记录在（日期行），只含胶箱的日期行不在
    assert '2026-05-01' in html
    assert '2026-05-02' not in html


# ─── 对账时间段锁定 ─────────────────────────────────────────────

def _create_pending(initiator='hd', approver='sy', date_from='2026-05-01', date_to='2026-05-31'):
    con = sqlite3.connect(app_module.DATABASE)
    pair_low, pair_high = sorted([initiator, approver])
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_approval')
    """, (initiator, approver, pair_low, pair_high, date_from, date_to))
    rid = cur.lastrowid
    con.commit(); con.close()
    return rid


def _locks():
    con = sqlite3.connect(app_module.DATABASE)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT * FROM period_locks").fetchall()]
    con.close()
    return rows


def test_approve_creates_period_locks_for_both_parties(client):
    rid = _create_pending()
    _login(client, 'sy')
    client.post(f'/reconcile/{rid}/approve')
    locks = _locks()
    assert len(locks) == 2
    assert {l['party'] for l in locks} == {'hd', 'sy'}
    assert all(l['date_from'] == '2026-05-01' and l['date_to'] == '2026-05-31' for l in locks)
    # 页面显示锁定横幅
    _login(client, 'hd')
    html = client.get('/party/hd').data.decode('utf-8')
    assert '已锁定时间段' in html


def test_entry_blocked_in_locked_period(client):
    rid = _create_pending()
    _login(client, 'sy')
    client.post(f'/reconcile/{rid}/approve')
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-05-15', 'jx_qty': '5',
    }, follow_redirects=True)
    assert '已对账锁定' in rv.data.decode('utf-8')
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM flow_records WHERE date='2026-05-15'").fetchone()[0]
    con.close()
    assert n == 0
    # 锁外日期可以录
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-06-01', 'jx_qty': '5',
    })
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM flow_records WHERE date='2026-06-01'").fetchone()[0]
    con.close()
    assert n == 1


def test_unlock_allows_entry_again(client):
    rid = _create_pending()
    _login(client, 'sy')
    client.post(f'/reconcile/{rid}/approve')
    lid = next(l['id'] for l in _locks() if l['party'] == 'hd')
    _login(client, 'hd')
    client.post(f'/locks/{lid}/delete')
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-05-15', 'jx_qty': '5',
    })
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM flow_records WHERE date='2026-05-15'").fetchone()[0]
    con.close()
    assert n == 1


def test_cancel_reconcile_removes_locks(client):
    rid = _create_pending()
    _login(client, 'sy')
    client.post(f'/reconcile/{rid}/approve')
    assert len(_locks()) == 2
    client.post(f'/reconcile/{rid}/cancel')
    assert _locks() == []


def test_partial_unlock_splits_lock(client):
    """只解锁中间一段：锁被拆成前后两段，解锁区间可录入，其余仍锁定。"""
    con = sqlite3.connect(app_module.DATABASE)
    cur = con.execute(
        "INSERT INTO period_locks (party, date_from, date_to, reconciliation_id, reason) VALUES ('hd','2026-06-01','2026-06-30',1,'核对#1 已确认')")
    lid = cur.lastrowid
    con.commit(); con.close()
    _login(client, 'hd')
    client.post(f'/locks/{lid}/delete', data={'unlock_from': '2026-06-10', 'unlock_to': '2026-06-15'})
    locks = _locks()
    assert len(locks) == 2
    ranges = sorted((l['date_from'], l['date_to']) for l in locks)
    assert ranges == [('2026-06-01', '2026-06-09'), ('2026-06-16', '2026-06-30')]
    # 解锁区间内可录入
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-06-12', 'jx_qty': '1'})
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM flow_records WHERE date='2026-06-12'").fetchone()[0]
    con.close()
    assert n == 1
    # 未解锁区间仍拦截
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-06-20', 'jx_qty': '1'},
        follow_redirects=True)
    assert '已对账锁定' in rv.data.decode('utf-8')


def test_partial_unlock_edge_keeps_single_lock(client):
    """只解锁开头：锁收缩为一段而不是被删除。"""
    con = sqlite3.connect(app_module.DATABASE)
    cur = con.execute(
        "INSERT INTO period_locks (party, date_from, date_to, reconciliation_id, reason) VALUES ('hd','2026-06-01','2026-06-30',1,'x')")
    lid = cur.lastrowid
    con.commit(); con.close()
    _login(client, 'hd')
    client.post(f'/locks/{lid}/delete', data={'unlock_from': '2026-06-01', 'unlock_to': '2026-06-05'})
    locks = _locks()
    assert len(locks) == 1
    assert (locks[0]['date_from'], locks[0]['date_to']) == ('2026-06-06', '2026-06-30')


def test_banner_is_collapsible(client):
    """锁定横幅默认折叠（details 无 open 属性），段数显示在标题里。"""
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("INSERT INTO period_locks (party, date_from, date_to, reconciliation_id, reason) VALUES ('hd','2026-06-01','2026-06-30',1,'x')")
    con.commit(); con.close()
    _login(client, 'hd')
    html = client.get('/party/hd').data.decode('utf-8')
    banner = html[html.find('已锁定时间段')-200:]
    assert '<details' in banner and '已锁定时间段（1 段' in banner
    assert 'class="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4 text-sm" open' not in banner


def test_unlock_also_unlocks_records_in_range(client):
    """手动解锁时间段时，范围内 locked=1 的记录同步解锁可编辑，范围外仍锁。"""
    rid = _create_pending()
    # 补两条范围内的记录
    _insert('hd', 'hd', 'sy', '2026-05-10', jx_qty=1)
    _insert('hd', 'hd', 'sy', '2026-05-20', jx_qty=1)
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE flow_records SET locked=1")
    con.commit(); con.close()
    _login(client, 'sy')
    client.post(f'/reconcile/{rid}/approve')
    lid = next(l['id'] for l in _locks() if l['party'] == 'hd')
    _login(client, 'hd')
    client.post(f'/locks/{lid}/delete', data={'unlock_from': '2026-05-01', 'unlock_to': '2026-05-15'})
    con = sqlite3.connect(app_module.DATABASE)
    r10 = con.execute("SELECT locked FROM flow_records WHERE date='2026-05-10'").fetchone()[0]
    r20 = con.execute("SELECT locked FROM flow_records WHERE date='2026-05-20'").fetchone()[0]
    con.close()
    assert r10 == 0   # 范围内已解锁
    assert r20 == 1   # 范围外仍锁
def test_locks_grouped_by_counterparty(client):
    """锁定横幅按对方分组显示（邵阳是邵阳，兴信是兴信）。"""
    con = sqlite3.connect(app_module.DATABASE)
    # 一次 hd↔sy 核对、一次 hd↔xx 核对，各自确认产生锁
    for cp in ('sy', 'xx'):
        pair_low, pair_high = sorted(['hd', cp])
        cur = con.execute("""
            INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                         date_from, date_to, status)
            VALUES ('hd', ?, ?, ?, '2026-06-01', '2026-06-30', 'confirmed')
        """, (cp, pair_low, pair_high))
        rid = cur.lastrowid
        con.execute(
            "INSERT INTO period_locks (party, date_from, date_to, reconciliation_id, reason) VALUES ('hd','2026-06-01','2026-06-30',?,?)",
            (rid, f'核对#{rid} 已确认'))
    con.commit(); con.close()
    _login(client, 'hd')
    html = client.get('/party/hd').data.decode('utf-8')
    assert '对邵阳华登（1 段）' in html
    assert '对兴信（1 段）' in html
