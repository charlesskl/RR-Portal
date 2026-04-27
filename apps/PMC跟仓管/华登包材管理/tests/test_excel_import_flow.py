import sqlite3
import openpyxl
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def test_import_commits_rows(client, tmp_path):
    """上传 xlsx → 选 sheet + 方向 → 提交 → 入库。"""
    _login(client, 'hd')
    path = tmp_path / 'test.xlsx'
    wb = openpyxl.Workbook()
    ws = wb.active; ws.title = 'sheet1'
    ws['A2'] = '日期'; ws['B2'] = '订单号'; ws['C2'] = '胶箱'
    ws['A3'] = '2026-01-01'; ws['B3'] = 'ORD1'; ws['C3'] = 5
    wb.save(path)

    # 提交（内部流程：upload + commit 一步完成给测试用）
    with open(path, 'rb') as f:
        rv = client.post('/import/commit',
                         data={
                             'sheet_name': 'sheet1',
                             'start_row': '3',
                             'direction': 'hd_to_sy',
                             'col_date': '0', 'col_order_no': '1', 'col_jx_qty': '2',
                             'file': (f, 'test.xlsx'),
                         },
                         content_type='multipart/form-data')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT recorded_by, from_party, to_party, date, order_no, jx_qty FROM flow_records"
    ).fetchone()
    assert row == ('hd', 'hd', 'sy', '2026-01-01', 'ORD1', 5.0)


def test_import_rejects_garbage_start_row(client):
    """非数字 start_row 不应 500，而是 flash + redirect。"""
    _login(client, 'hd')
    rv = client.post('/import/commit',
                     data={'sheet_name': 'sheet1', 'start_row': 'abc', 'direction': 'hd_to_sy'},
                     follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records").fetchone()[0] == 0


def test_import_rejects_invalid_direction(client):
    """direction 不在白名单 → flash + redirect 不入库。"""
    _login(client, 'hd')
    rv = client.post('/import/commit',
                     data={'sheet_name': 'sheet1', 'start_row': '3', 'direction': 'bogus'},
                     follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records").fetchone()[0] == 0


def test_import_rejects_party_not_in_pair(client):
    """xx 想导入 hd_to_sy 方向（自己不在 pair 内）→ 拒。"""
    _login(client, 'xx')
    rv = client.post('/import/commit',
                     data={'sheet_name': 'sheet1', 'start_row': '3', 'direction': 'hd_to_sy'},
                     follow_redirects=False)
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records").fetchone()[0] == 0
