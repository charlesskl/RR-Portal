import openpyxl
import app as app_module


def test_parse_sheet_returns_rows(tmp_path):
    """构造一个迷你 xlsx 文件 → 跑 parse_sheet → 验证。"""
    path = tmp_path / 'test.xlsx'
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'test_sheet'
    ws['A1'] = '测试'
    ws['A2'] = '日期'; ws['B2'] = '订单号'; ws['C2'] = '胶箱'
    ws['A3'] = '2026-01-01'; ws['B3'] = 'ORD1'; ws['C3'] = 5
    ws['A4'] = '2026-01-02'; ws['B4'] = 'ORD2'; ws['C4'] = 10
    wb.save(path)

    rows = app_module.parse_excel_sheet(
        str(path), 'test_sheet',
        start_row=3,
        columns={0: 'date', 1: 'order_no', 2: 'jx_qty'}
    )
    assert len(rows) == 2
    assert rows[0]['date'] == '2026-01-01'
    assert rows[0]['jx_qty'] == 5
