"""月度统计 _build_monthly_stats(party) per-warehouse 视角公式测试。

期初 = 上一个有 inventory 的月的 _qty
投资 = monthly_purchases.{key}_qty
应有 = 期初 + 投资
实盘 = monthly_inventory.{key}_qty
损耗 = 实盘 - 应有
损耗率 = 损耗 / 应有 × 100  (应有=0 时为 0)
"""
import sqlite3
import app as app_module


def _insert_inv(year_month, party='hd', remark=None, **qtys):
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'year_month'] + list(qtys.keys()) + ['remark']
    vals = [party, year_month] + list(qtys.values()) + [remark]
    placeholders = ','.join(['?'] * len(cols))
    con.execute(f"INSERT INTO monthly_inventory ({','.join(cols)}) VALUES ({placeholders})", vals)
    con.commit(); con.close()


def _insert_pur(year_month, party='hd', remark=None, **qtys):
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'year_month'] + list(qtys.keys()) + ['remark']
    vals = [party, year_month] + list(qtys.values()) + [remark]
    placeholders = ','.join(['?'] * len(cols))
    con.execute(f"INSERT INTO monthly_purchases ({','.join(cols)}) VALUES ({placeholders})", vals)
    con.commit(); con.close()


def test_basic_formula(client):
    """期初 50, 投资 30, 应有 80, 实盘 75 → 损耗 -5, 损耗率 -6.25%。"""
    _insert_inv('2026-03', jx_qty=50)
    _insert_pur('2026-04', jx_qty=30)
    _insert_inv('2026-04', jx_qty=75)
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    item = apr['items']['jx']
    assert item['prev'] == 50
    assert item['investment'] == 30
    assert item['expected'] == 80
    assert item['actual'] == 75
    assert item['loss'] == -5
    assert round(item['loss_pct'], 2) == -6.25


def test_first_month_prev_zero(client):
    _insert_pur('2026-04', jx_qty=20)
    _insert_inv('2026-04', jx_qty=18)
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    item = apr['items']['jx']
    assert item['prev'] == 0
    assert item['expected'] == 20
    assert item['loss'] == -2


def test_loss_pct_zero_when_expected_zero(client):
    """期初+投资=0 → 损耗率显示 0 不抛异常。"""
    _insert_inv('2026-04', jx_qty=0)
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert apr['items']['jx']['loss_pct'] == 0


def test_party_isolated(client):
    """sy 录的不计入 hd。"""
    _insert_pur('2026-04', party='sy', jx_qty=999)
    _insert_inv('2026-04', party='sy', jx_qty=999)
    _insert_pur('2026-04', party='hd', jx_qty=10)
    _insert_inv('2026-04', party='hd', jx_qty=10)
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert apr['items']['jx']['investment'] == 10
    assert apr['items']['jx']['actual'] == 10


def test_only_4_stat_items(client):
    _insert_pur('2026-04', jx_qty=10, mkb_qty=5, jkb_qty=3, gx_qty=2)
    _insert_inv('2026-04', jx_qty=10, mkb_qty=5, jkb_qty=3, gx_qty=2)
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert set(apr['items'].keys()) == {'mkb', 'jkb', 'jx', 'gx'}


def test_months_auto_collected_newest_first(client):
    """月份按时间倒序返回（最新在前）。"""
    _insert_pur('2026-02', jx_qty=10)
    _insert_inv('2026-04', jx_qty=5)
    _insert_pur('2026-03', jx_qty=20)
    rows = app_module._build_monthly_stats('hd')
    yms = [r['ym'] for r in rows]
    assert yms == ['2026-04', '2026-03', '2026-02']


def test_remark_preserved(client):
    """inventory 的备注透传到月份行。"""
    _insert_inv('2026-04', jx_qty=10, remark='车间报废胶箱 100')
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert apr['remark'] == '车间报废胶箱 100'


def test_unmeasured_month_actual_is_none(client):
    """没盘点月 → actual=None（显示 —）, loss/loss_pct=None, is_measured=False。"""
    _insert_pur('2026-04', jx_qty=20)
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert apr['is_measured'] is False
    item = apr['items']['jx']
    assert item['investment'] == 20
    assert item['expected'] == 20  # 应存仍计算
    assert item['actual'] is None
    assert item['loss'] is None
    assert item['loss_pct'] is None


def test_chain_carries_through_unmeasured_for_expected(client):
    """4月实测 100 → 5月没盘+投资 30 → 6月实测 120：6月期初应=130（继承5月推算），不是100。"""
    _insert_inv('2026-04', jx_qty=100)
    _insert_pur('2026-05', jx_qty=30)
    _insert_inv('2026-06', jx_qty=120)
    rows = app_module._build_monthly_stats('hd')
    by_ym = {r['ym']: r for r in rows}
    # 5 月：actual=None 但 expected=130
    may = by_ym['2026-05']
    assert may['is_measured'] is False
    assert may['items']['jx']['expected'] == 130
    assert may['items']['jx']['actual'] is None
    # 6 月：期初继承 5 月推算 130
    jun = by_ym['2026-06']
    assert jun['items']['jx']['prev'] == 130
    assert jun['items']['jx']['expected'] == 130
    assert jun['items']['jx']['actual'] == 120
    assert jun['items']['jx']['loss'] == -10


def test_empty_no_data(client):
    rows = app_module._build_monthly_stats('hd')
    assert rows == []


def test_prev_accumulates_purchase_in_unmeasured_months(client):
    """1月实测 100 → 2月没盘+投资 20 → 3月有盘+投资 30
    3月期初应取 2月推算 (100+20=120)，不是 1月实测 100。"""
    _insert_inv('2026-01', jx_qty=100)
    _insert_pur('2026-02', jx_qty=20)  # 2月没盘点 → 推算到 120
    _insert_pur('2026-03', jx_qty=30)
    _insert_inv('2026-03', jx_qty=140)
    rows = app_module._build_monthly_stats('hd')
    mar = next(r for r in rows if r['ym'] == '2026-03')
    item = mar['items']['jx']
    assert item['prev'] == 120  # 累积了 2 月的 20 投资
    assert item['investment'] == 30
    assert item['expected'] == 150
    assert item['actual'] == 140
    assert item['loss'] == -10  # 实少了 10
