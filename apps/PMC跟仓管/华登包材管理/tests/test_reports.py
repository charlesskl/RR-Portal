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
