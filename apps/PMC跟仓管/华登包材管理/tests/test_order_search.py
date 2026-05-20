"""订单号搜索 — party 台账页按 order_no 模糊过滤。"""
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(order_no, date='2026-03-01'):
    """插一条 hd→sy 记录,带指定 order_no 和日期。"""
    con = sqlite3.connect(app_module.DATABASE)
    con.execute(
        "INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, jx_qty) "
        "VALUES ('hd', 'hd', 'sy', ?, ?, 1)",
        (date, order_no))
    con.commit()
    con.close()


def test_search_matches_records_containing_term(client):
    """搜 'ALPHA' → 含该子串的记录显示,其它被过滤。"""
    _login(client, 'hd')
    _insert('ALPHA-001')
    _insert('BETA-002')
    rv = client.get('/party/hd?order_no=ALPHA')
    html = rv.data.decode('utf-8')
    assert 'ALPHA-001' in html
    assert 'BETA-002' not in html


def test_search_partial_substring_in_middle(client):
    """搜订单号中间的子串 → 模糊命中。"""
    _login(client, 'hd')
    _insert('PO-2026-00123')
    _insert('PO-2026-00999')
    rv = client.get('/party/hd?order_no=00123')
    html = rv.data.decode('utf-8')
    assert 'PO-2026-00123' in html
    assert 'PO-2026-00999' not in html


def test_empty_search_returns_all(client):
    """不传 order_no → 显示全部记录(基线保护)。"""
    _login(client, 'hd')
    _insert('ALPHA-001')
    _insert('BETA-002')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    assert 'ALPHA-001' in html
    assert 'BETA-002' in html


def test_search_combines_with_date_filter_as_and(client):
    """order_no + 日期同时筛选 → AND:只显示两个条件都满足的记录。"""
    _login(client, 'hd')
    _insert('ALPHA-001', date='2026-03-01')   # date 在范围外 → 被日期排除
    _insert('ALPHA-002', date='2026-03-10')   # date 在范围内 + order_no 匹配 → 应显示
    _insert('GAMMA-005', date='2026-03-08')   # date 在范围内,但 order_no 不匹配 → 应被 order_no 排除
    rv = client.get('/party/hd?order_no=ALPHA&date_from=2026-03-05&date_to=2026-03-15')
    html = rv.data.decode('utf-8')
    assert 'ALPHA-002' in html
    assert 'ALPHA-001' not in html
    assert 'GAMMA-005' not in html   # 这一行真正证明 order_no 过滤参与了 AND


def test_search_no_match_shows_nothing(client):
    """搜不存在的订单号 → 无记录,页面正常返回 200。"""
    _login(client, 'hd')
    _insert('ALPHA-001')
    rv = client.get('/party/hd?order_no=ZZZ-NOPE')
    assert rv.status_code == 200
    assert 'ALPHA-001' not in rv.data.decode('utf-8')


def test_search_box_renders_on_page(client):
    """台账页筛选表单含订单号输入框。"""
    _login(client, 'hd')
    rv = client.get('/party/hd')
    assert 'name="order_no"' in rv.data.decode('utf-8')


def test_search_term_reflected_in_box(client):
    """搜索后,输入框回填当前搜索词。"""
    _login(client, 'hd')
    rv = client.get('/party/hd?order_no=KEYWORD-XYZ')
    assert 'value="KEYWORD-XYZ"' in rv.data.decode('utf-8')
