"""验证新 schema 的所有表和字段正确创建。"""
import sqlite3


def test_flow_records_schema(client):
    """flow_records 表应包含所有必要字段。"""
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(flow_records)")}
    expected = {
        'id', 'recorded_by', 'from_party', 'to_party', 'date', 'order_no',
        'remark', 'reconciliation_id', 'locked', 'created_at', 'updated_at',
        'jx_qty', 'gx_qty', 'zx_qty', 'jkb_qty', 'mkb_qty', 'xb_qty',
        'dz_qty', 'wb_qty', 'pk_qty', 'xzx_qty', 'dgb_qty', 'xjp_qty',
        'dk_qty', 'xs_qty', 'gsb_qty', 'djx_qty', 'zb_qty',
    }
    assert expected.issubset(cols), f"缺字段: {expected - cols}"


def test_reconciliations_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(reconciliations)")}
    expected = {
        'id', 'initiator_party', 'approver_party', 'pair_low', 'pair_high',
        'date_from', 'date_to', 'status', 'snapshot_json', 'notes',
        'created_at', 'approved_at',
    }
    assert expected.issubset(cols)


def test_investment_records_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(investment_records)")}
    expected = {'id', 'recorded_by', 'counterparty', 'year_month',
                'mkb_qty', 'jkb_qty', 'jx_qty', 'gx_qty', 'remark', 'created_at'}
    assert expected.issubset(cols)


def test_monthly_inventory_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(monthly_inventory)")}
    expected = {'id', 'recorded_by', 'counterparty', 'year_month',
                'mkb_qty', 'jkb_qty', 'jx_qty', 'gx_qty'}
    assert expected.issubset(cols)


def test_default_prices_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(default_prices)")}
    assert {'item_key', 'price'}.issubset(cols)
