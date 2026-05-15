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
