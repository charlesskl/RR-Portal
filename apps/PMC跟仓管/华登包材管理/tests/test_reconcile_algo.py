import sqlite3
import app as app_module


def _insert(recorded_by, from_p, to_p, date, **qtys):
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'from_party', 'to_party', 'date'] + list(qtys.keys())
    placeholders = ', '.join(['?'] * len(cols))
    con.execute(f"INSERT INTO flow_records ({', '.join(cols)}) VALUES ({placeholders})",
                [recorded_by, from_p, to_p, date, *qtys.values()])
    con.commit(); con.close()


def test_compare_pair_matching(client):
    """两方录一致 → 无 diff。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    _insert('sy', 'hd', 'sy', '2026-05-01', jx_qty=100)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-01')
    assert result['hd_to_sy']['diffs'] == {}


def test_compare_pair_mismatch(client):
    """华登发方录 100，邵阳收方录 98 → diff 胶箱 +2。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    _insert('sy', 'hd', 'sy', '2026-05-01', jx_qty=98)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-01')
    assert result['hd_to_sy']['diffs'] == {'jx': 2}


def test_compare_pair_both_directions(client):
    """两个方向都有数据，各比各。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=10)
    _insert('sy', 'hd', 'sy', '2026-05-01', jx_qty=10)
    _insert('sy', 'sy', 'hd', '2026-05-02', gx_qty=5)
    _insert('hd', 'sy', 'hd', '2026-05-02', gx_qty=5)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-02')
    assert result['hd_to_sy']['diffs'] == {}
    assert result['sy_to_hd']['diffs'] == {}
    assert result['hd_to_sy']['sender_recorded']['jx'] == 10
    assert result['sy_to_hd']['sender_recorded']['gx'] == 5


def test_compare_pair_one_side_empty(client):
    """一方漏录 → 另一方的数据作为 diff。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    # sy 没录
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-01')
    assert result['hd_to_sy']['diffs'] == {'jx': 100}


def test_compare_pair_date_range(client):
    """只取范围内的数据。"""
    _insert('hd', 'hd', 'sy', '2026-04-30', jx_qty=99)  # 范围外
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-31')
    assert result['hd_to_sy']['sender_recorded']['jx'] == 100
