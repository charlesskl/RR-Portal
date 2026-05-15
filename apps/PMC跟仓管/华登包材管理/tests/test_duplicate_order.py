"""订单号重复提示功能 — _find_duplicate_order helper + entry route 集成测试。"""
import sqlite3


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(con, *, recorded_by, from_party, to_party, order_no, date='2026-05-01'):
    con.execute("""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no)
        VALUES (?, ?, ?, ?, ?)
    """, (recorded_by, from_party, to_party, date, order_no))
    con.commit()


def test_helper_returns_empty_for_new_order(client):
    """未出现过的 order_no → 返回空 list。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    result = app_module._find_duplicate_order(con, order_no='NEW-1', party='hd', cp='xx')
    con.close()
    assert result == []


def test_helper_finds_same_party_same_pair_same_direction(client):
    """hd 录的 hd→xx ORD-A,hd 再查同一对的 ORD-A → 命中。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-A')
    result = app_module._find_duplicate_order(con, order_no='ORD-A', party='hd', cp='xx')
    con.close()
    assert len(result) == 1
    assert result[0]['order_no'] == 'ORD-A'
    assert result[0]['from_party'] == 'hd'
    assert result[0]['to_party'] == 'xx'


def test_helper_finds_same_party_same_pair_reverse_direction(client):
    """hd 录的 xx→hd ORD-B,hd 查同一对 ORD-B → 也命中 (双向)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='xx', to_party='hd', order_no='ORD-B')
    result = app_module._find_duplicate_order(con, order_no='ORD-B', party='hd', cp='xx')
    con.close()
    assert len(result) == 1


def test_helper_ignores_other_recorded_by(client):
    """xx 录的 xx→hd ORD-C,hd 查同一对 ORD-C → 不命中 (跨录入人)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='xx', from_party='xx', to_party='hd', order_no='ORD-C')
    result = app_module._find_duplicate_order(con, order_no='ORD-C', party='hd', cp='xx')
    con.close()
    assert result == []


def test_helper_ignores_other_pair(client):
    """hd 录的 hd→sy ORD-D,hd 查 hd↔xx 这对的 ORD-D → 不命中 (跨 pair)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='sy', order_no='ORD-D')
    result = app_module._find_duplicate_order(con, order_no='ORD-D', party='hd', cp='xx')
    con.close()
    assert result == []


def test_helper_empty_or_whitespace_returns_empty(client):
    """空字符串 / 纯空白 / None → 返回空 list,不查 DB。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    assert app_module._find_duplicate_order(con, order_no='', party='hd', cp='xx') == []
    assert app_module._find_duplicate_order(con, order_no='   ', party='hd', cp='xx') == []
    assert app_module._find_duplicate_order(con, order_no=None, party='hd', cp='xx') == []
    con.close()


def test_entry_first_submit_unique_order_inserts(client):
    """新订单号 → 直接 INSERT,无警告。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-01', 'order_no': 'UNIQ-1', 'jx_qty': '10',
    }, follow_redirects=False)
    assert rv.status_code == 302

    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='UNIQ-1'"
    ).fetchone()[0]
    con.close()
    assert cnt == 1


def test_entry_duplicate_blocks_insert_and_sets_session_warning(client):
    """hd 已有 hd→xx ORD-X,hd 再录 hd→xx ORD-X → 不 INSERT,session 有 dup_warning。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-X')
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-02', 'order_no': 'ORD-X', 'jx_qty': '5',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert rv.location.endswith('/party/hd')

    # 数据库应该只有原来那 1 条,新提交未落库
    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='ORD-X'"
    ).fetchone()[0]
    con.close()
    assert cnt == 1

    # session 里有 dup_warning
    with client.session_transaction() as s:
        assert 'dup_warning' in s
        w = s['dup_warning']
        assert w['cp'] == 'xx'
        assert w['direction'] == 'sent'
        assert w['form']['order_no'] == 'ORD-X'
        assert w['form']['date'] == '2026-05-02'
        assert w['form']['jx_qty'] == '5'
        assert len(w['dups']) == 1
        assert w['dups'][0]['order_no'] == 'ORD-X'


def test_entry_duplicate_reverse_direction_also_blocks(client):
    """hd 已有 hd→xx ORD-Y,hd 在'收自xx' tab 录 ORD-Y (即 xx→hd) → 也命中。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-Y')
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'received', 'counterparty': 'xx',
        'date': '2026-05-03', 'order_no': 'ORD-Y', 'jx_qty': '7',
    }, follow_redirects=False)
    assert rv.status_code == 302

    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='ORD-Y'"
    ).fetchone()[0]
    con.close()
    assert cnt == 1  # 没新增


def test_entry_confirm_dup_force_inserts(client):
    """带 confirm_dup=1 → 跳过检查,直接 INSERT。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ORD-Z')
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-04', 'order_no': 'ORD-Z', 'jx_qty': '3',
        'confirm_dup': '1',
    }, follow_redirects=False)
    assert rv.status_code == 302

    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no='ORD-Z'"
    ).fetchone()[0]
    con.close()
    assert cnt == 2  # 原来的 + 强制新增


def test_entry_empty_order_no_skips_dedup_and_inserts(client):
    """order_no 留空 → 不查重,直接落库 (即使其它字段有冲突也无所谓)。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no=None)
    con.close()

    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-05', 'order_no': '   ', 'jx_qty': '1',  # 纯空白
    }, follow_redirects=False)
    assert rv.status_code == 302

    con = sqlite3.connect(app_module.DATABASE)
    cnt = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no IS NULL"
    ).fetchone()[0]
    con.close()
    assert cnt == 2

    # 不应有 dup_warning
    with client.session_transaction() as s:
        assert 'dup_warning' not in s


def test_party_page_renders_dup_warning_in_matching_panel(client):
    """触发 dup 后再 GET /party/hd,应该看到警告横幅 + 回填的 order_no + confirm_dup hidden。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='RENDER-1')
    con.close()

    _login(client, 'hd')
    # 触发 dup
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-06', 'order_no': 'RENDER-1', 'jx_qty': '4',
    }, follow_redirects=False)

    # GET party 页面
    rv = client.get('/party/hd')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    # 警告横幅
    assert '订单号 RENDER-1 已在你的台账里出现过' in html
    # 回填的 order_no
    assert 'value="RENDER-1"' in html
    # confirm_dup hidden field 出现
    assert 'name="confirm_dup"' in html
    assert 'value="1"' in html


def test_party_page_clears_dup_warning_after_render(client):
    """渲染过一次,session 中 dup_warning 应已被 pop;再 GET 不再显示。"""
    import app as app_module
    con = sqlite3.connect(app_module.DATABASE)
    _insert(con, recorded_by='hd', from_party='hd', to_party='xx', order_no='ONCE-1')
    con.close()

    _login(client, 'hd')
    client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'xx',
        'date': '2026-05-07', 'order_no': 'ONCE-1', 'jx_qty': '2',
    }, follow_redirects=False)
    client.get('/party/hd')  # 第一次 GET,看到警告
    rv2 = client.get('/party/hd')  # 第二次 GET,不应再看到
    assert '订单号 ONCE-1 已在你的台账里出现过' not in rv2.data.decode('utf-8')
