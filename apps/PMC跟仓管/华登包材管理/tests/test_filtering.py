import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert_many(n, date_start='2026-01-01'):
    con = sqlite3.connect(app_module.DATABASE)
    from datetime import datetime, timedelta
    base = datetime.strptime(date_start, '%Y-%m-%d')
    for i in range(n):
        d = (base + timedelta(days=i)).strftime('%Y-%m-%d')
        con.execute("INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty) VALUES ('hd','hd','sy',?,?)",
                    (d, i))
    con.commit(); con.close()


def test_date_filter(client):
    _login(client, 'hd')
    _insert_many(5)  # 2026-01-01 ~ 2026-01-05
    rv = client.get('/party/hd?date_from=2026-01-03&date_to=2026-01-04')
    html = rv.data.decode('utf-8')
    assert '2026-01-03' in html
    assert '2026-01-04' in html
    assert '2026-01-01' not in html
    assert '2026-01-05' not in html


def test_pagination(client):
    _login(client, 'hd')
    _insert_many(60)  # 超过 default 50
    rv = client.get('/party/hd?page_sy_sent=1&page_size=20')
    html = rv.data.decode('utf-8')
    # 第一页 20 条
    assert '共 <b>60</b> 条' in html or '60 条' in html
    assert '第 <b>1</b>' in html or '/ 3 页' in html


def test_pagination_rejects_garbage_page(client):
    """非数字 page 参数不应 500，而是回退到 page=1。"""
    _login(client, 'hd')
    _insert_many(3)
    rv = client.get('/party/hd?page_sy_sent=abc')
    assert rv.status_code == 200
