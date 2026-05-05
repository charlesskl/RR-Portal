"""POST /party/<p>/inventory 和 /party/<p>/purchase 测试。"""
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _get(table, party, ym):
    con = sqlite3.connect(app_module.DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute(
        f"SELECT * FROM {table} WHERE recorded_by=? AND year_month=?", (party, ym)
    ).fetchone()
    con.close()
    return r


# ===== inventory =====

def test_insert_inventory(client):
    _login(client, 'hd')
    rv = client.post('/party/hd/inventory', data={
        'year_month': '2026-04',
        'mkb_qty': '10', 'jkb_qty': '20', 'jx_qty': '30', 'gx_qty': '40',
        'remark': '车间报废胶箱 50',
    })
    assert rv.status_code == 302
    r = _get('monthly_inventory', 'hd', '2026-04')
    assert r['mkb_qty'] == 10 and r['jx_qty'] == 30 and r['gx_qty'] == 40
    assert r['remark'] == '车间报废胶箱 50'


def test_inventory_upsert(client):
    _login(client, 'hd')
    client.post('/party/hd/inventory', data={
        'year_month': '2026-04', 'mkb_qty': '10', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    })
    client.post('/party/hd/inventory', data={
        'year_month': '2026-04', 'mkb_qty': '99', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    })
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM monthly_inventory WHERE recorded_by='hd' AND year_month='2026-04'").fetchone()[0]
    con.close()
    assert n == 1
    assert _get('monthly_inventory', 'hd', '2026-04')['mkb_qty'] == 99


def test_inventory_invalid_qty_zero(client):
    _login(client, 'hd')
    client.post('/party/hd/inventory', data={
        'year_month': '2026-04',
        'mkb_qty': '', 'jkb_qty': 'abc', 'jx_qty': '5', 'gx_qty': '0',
    })
    r = _get('monthly_inventory', 'hd', '2026-04')
    assert r['mkb_qty'] == 0 and r['jkb_qty'] == 0 and r['jx_qty'] == 5


def test_inventory_other_party_blocked(client):
    _login(client, 'sy')
    rv = client.post('/party/hd/inventory', data={
        'year_month': '2026-04', 'mkb_qty': '99', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert _get('monthly_inventory', 'hd', '2026-04') is None


def test_inventory_unauth_blocked(client):
    rv = client.post('/party/hd/inventory', data={
        'year_month': '2026-04', 'mkb_qty': '99', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert _get('monthly_inventory', 'hd', '2026-04') is None


def test_inventory_missing_ym_rejected(client):
    _login(client, 'hd')
    client.post('/party/hd/inventory', data={
        'year_month': '', 'mkb_qty': '99', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    })
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM monthly_inventory").fetchone()[0]
    con.close()
    assert n == 0


# ===== purchase =====

def test_insert_purchase(client):
    _login(client, 'hd')
    rv = client.post('/party/hd/purchase', data={
        'year_month': '2026-04',
        'mkb_qty': '500', 'jkb_qty': '2250', 'jx_qty': '10000', 'gx_qty': '0',
        'remark': '4月新购',
    })
    assert rv.status_code == 302
    r = _get('monthly_purchases', 'hd', '2026-04')
    assert r['mkb_qty'] == 500 and r['jx_qty'] == 10000
    assert r['remark'] == '4月新购'


def test_purchase_upsert(client):
    _login(client, 'hd')
    client.post('/party/hd/purchase', data={
        'year_month': '2026-04', 'mkb_qty': '100', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    })
    client.post('/party/hd/purchase', data={
        'year_month': '2026-04', 'mkb_qty': '500', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    })
    con = sqlite3.connect(app_module.DATABASE)
    n = con.execute("SELECT COUNT(*) FROM monthly_purchases").fetchone()[0]
    con.close()
    assert n == 1
    assert _get('monthly_purchases', 'hd', '2026-04')['mkb_qty'] == 500


def test_purchase_other_party_blocked(client):
    _login(client, 'sy')
    rv = client.post('/party/hd/purchase', data={
        'year_month': '2026-04', 'mkb_qty': '99', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert _get('monthly_purchases', 'hd', '2026-04') is None


def test_purchase_with_prices(client):
    """采购可附带每材料单价，金额 = qty × price 在 _build_monthly_stats 里计算。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/purchase', data={
        'year_month': '2026-04',
        'mkb_qty': '500', 'jkb_qty': '200', 'jx_qty': '100', 'gx_qty': '0',
        'mkb_price': '13', 'jkb_price': '23', 'jx_price': '46', 'gx_price': '0',
    })
    assert rv.status_code == 302
    r = _get('monthly_purchases', 'hd', '2026-04')
    assert r['mkb_price'] == 13
    assert r['jx_price'] == 46

    import app as app_module
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert apr['items']['mkb']['amount'] == 500 * 13
    assert apr['items']['jx']['amount'] == 100 * 46
    assert apr['items']['gx']['amount'] == 0
    assert apr['pur_total_amount'] == 500 * 13 + 200 * 23 + 100 * 46


def test_purchase_price_default_zero(client):
    """没传单价 → 默认 0，金额 0。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/purchase', data={
        'year_month': '2026-04', 'mkb_qty': '100', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
    })
    assert rv.status_code == 302
    import app as app_module
    rows = app_module._build_monthly_stats('hd')
    apr = next(r for r in rows if r['ym'] == '2026-04')
    assert apr['items']['mkb']['amount'] == 0


def test_default_prices_seeded_to_15(client):
    """init_db 给 default_prices 4 项种子价 = 15。"""
    con = sqlite3.connect(app_module.DATABASE)
    rows = dict(con.execute("SELECT item_key, price FROM default_prices").fetchall())
    con.close()
    for k in ('mkb', 'jkb', 'jx', 'gx'):
        assert rows.get(k) == 15, f'{k} 应该种子 15，实得 {rows.get(k)}'


def test_purchase_post_updates_default_prices(client):
    """提交采购后 default_prices 同步成新单价。"""
    _login(client, 'hd')
    client.post('/party/hd/purchase', data={
        'year_month': '2026-04',
        'mkb_qty': '500', 'jkb_qty': '200', 'jx_qty': '100', 'gx_qty': '0',
        'mkb_price': '13', 'jkb_price': '23', 'jx_price': '46', 'gx_price': '7',
    })
    con = sqlite3.connect(app_module.DATABASE)
    rows = dict(con.execute("SELECT item_key, price FROM default_prices").fetchall())
    con.close()
    assert rows['mkb'] == 13
    assert rows['jkb'] == 23
    assert rows['jx'] == 46
    assert rows['gx'] == 7


def test_purchase_post_chain_update(client):
    """连续两次 purchase POST：第二次的价格会覆盖第一次的 default。"""
    _login(client, 'hd')
    client.post('/party/hd/purchase', data={
        'year_month': '2026-03', 'mkb_qty': '1', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
        'mkb_price': '10', 'jkb_price': '0', 'jx_price': '0', 'gx_price': '0',
    })
    client.post('/party/hd/purchase', data={
        'year_month': '2026-04', 'mkb_qty': '1', 'jkb_qty': '0', 'jx_qty': '0', 'gx_qty': '0',
        'mkb_price': '20', 'jkb_price': '0', 'jx_price': '0', 'gx_price': '0',
    })
    con = sqlite3.connect(app_module.DATABASE)
    p = con.execute("SELECT price FROM default_prices WHERE item_key='mkb'").fetchone()[0]
    con.close()
    assert p == 20
