import sqlite3
import app as app_module


def _insert(recorded_by='hd', from_p='hd', to_p='sy', date='2026-05-01', jx_qty=0, gx_qty=0, mkb_qty=0):
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, gx_qty, mkb_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (recorded_by, from_p, to_p, date, jx_qty, gx_qty, mkb_qty))
    con.commit(); con.close()


def test_reports_uses_sender_records(client):
    """发方记录是权威数据；收方记录应被忽略（不翻倍）。"""
    _insert(recorded_by='hd', from_p='hd', to_p='sy', jx_qty=100)
    _insert(recorded_by='sy', from_p='hd', to_p='sy', jx_qty=100)  # 收方镜像
    rv = client.get('/reports')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    # HD→SY 的胶箱应为 100（不是 200）
    assert '100' in html


def test_reports_triangle_debt_net(client):
    """华登发邵阳 100 胶箱，邵阳发华登 30 胶箱 → 邵阳欠华登 70 胶箱。"""
    _insert(recorded_by='hd', from_p='hd', to_p='sy', jx_qty=100)
    _insert(recorded_by='sy', from_p='sy', to_p='hd', jx_qty=30)
    rv = client.get('/reports')
    html = rv.data.decode('utf-8')
    # triangle_display 应该反映净欠 70 在 HD↔SY 行
    assert '70' in html


def test_reports_only_confirmed_filter(client):
    """only_confirmed=1 时只汇总 locked=1 的记录。

    Note: 两条 record 跨月放置，避免与 Task 16 月度明细的 per-month SUM 字符串冲突
    （月度明细按 spec 不受 only_confirmed 影响，仍按月分行展示）。
    """
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, locked) VALUES ('hd','hd','sy','2026-05-01',77,0)")
    con.execute("INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, locked) VALUES ('hd','hd','sy','2026-06-01',88,1)")
    con.commit(); con.close()

    # 不带 filter，direction_summaries 应汇总 77+88=165
    rv_all = client.get('/reports')
    assert '165' in rv_all.data.decode('utf-8'), 'unfiltered direction_summaries 应汇总 77+88=165'

    # 带 only_confirmed=1，direction_summaries 只应包含 88（locked 的那条）
    rv_filtered = client.get('/reports?only_confirmed=1')
    html_filtered = rv_filtered.data.decode('utf-8')
    assert '88' in html_filtered, 'filtered 应保留 locked=1 的 88'
    assert '165' not in html_filtered, 'filtered direction_summaries 不应汇总未 locked 的'


def test_reports_monthly_detail(client):
    _insert(recorded_by='hd', from_p='hd', to_p='sy', date='2026-05-01', jx_qty=100)
    _insert(recorded_by='sy', from_p='sy', to_p='hd', date='2026-05-02', jx_qty=30)
    _insert(recorded_by='hd', from_p='hd', to_p='sy', date='2026-06-01', jx_qty=50)
    rv = client.get('/reports')
    html = rv.data.decode('utf-8')
    assert '2026-05' in html
    assert '2026-06' in html
