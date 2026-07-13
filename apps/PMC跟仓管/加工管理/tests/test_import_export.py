import io

import openpyxl


DEFAULT_DEPARTMENT = "兴信B来料仓"


def login(client, username="admin", password="admin123", department=DEFAULT_DEPARTMENT):
    return client.post(
        "/api/login",
        json={"username": username, "password": password, "department": department},
    )


def loc_id(client, name):
    locations = client.get("/api/locations").json()
    return next(item["id"] for item in locations if item["name"] == name)


def workbook_bytes(headers, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def upload_xlsx(client, path, headers, rows):
    content = workbook_bytes(headers, rows)
    return client.post(
        path,
        files={
            "file": (
                "import.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


def legacy_semi_finished_workbook_bytes():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "入库明细"
    ws["D1"] = "日期"
    ws["E1"] = "2026-07-01"
    ws["F1"] = "2026-07-02"
    ws["D2"] = "入库单号"
    ws["E2"] = "RK-001"
    ws["F2"] = "RK-002"
    ws["A3"] = "物料名称"
    ws["B3"] = "当月入仓总数"
    ws["C3"] = "6/24东莞车间入库截数"
    ws["D3"] = "6/24鸿亚入库截数"
    ws["A4"] = "1#NFC\n贴纸"
    ws["B4"] = 100
    ws["C4"] = 10
    ws["D4"] = 15
    ws["E4"] = 30
    ws["F4"] = 60
    ws["A5"] = "小计："
    ws["B5"] = 100
    ws["E5"] = 30

    out_ws = wb.create_sheet("邵阳领料")
    out_ws["D1"] = "2026-07-03"
    out_ws["D2"] = "LL-001"
    out_ws["A5"] = "物料名称"
    out_ws["B5"] = "当月出仓总数"
    out_ws["C5"] = "6/24盘点截数"
    out_ws["A6"] = "1#NFC\n贴纸"
    out_ws["B6"] = 40
    out_ws["C6"] = 5
    out_ws["D6"] = 35
    out_ws["A7"] = "小计："
    out_ws["B7"] = 40
    out_ws["D7"] = 35

    total_ws = wb.create_sheet("总表")
    total_ws["A1"] = "总表不用导入"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def legacy_assembly_nfc_workbook_bytes():
    wb = openpyxl.Workbook()
    total_ws = wb.active
    total_ws.title = "总表"
    total_ws["A2"] = "物料名称"
    total_ws["B1"] = "累计入仓总数"
    total_ws["C1"] = "东莞"
    total_ws["D1"] = "7月领料\n总数"
    total_ws["E1"] = "2026-07-01"
    total_ws["A3"] = "1#NFC\n贴纸"
    total_ws["B3"] = 100
    total_ws["C3"] = 40
    total_ws["D3"] = 60

    issue_ws = wb.create_sheet("领料明细")
    issue_ws["B1"] = "当月领料总数"
    issue_ws["C1"] = "7月1日"
    issue_ws["A2"] = "物料名称"
    issue_ws["C2"] = "DG-LL-001"
    issue_ws["A3"] = "1#NFC\n贴纸"
    issue_ws["B3"] = 60
    issue_ws["C3"] = 60

    semi_ws = wb.create_sheet("半成品入仓明细")
    semi_ws["B1"] = "当月入仓总数"
    semi_ws["C1"] = "7月2日"
    semi_ws["A2"] = "物料名称"
    semi_ws["C2"] = "DG-RK-001"
    semi_ws["A3"] = "1#NFC\n贴纸"
    semi_ws["B3"] = 25
    semi_ws["C3"] = 25

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def legacy_outsource_workbook_bytes():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "领料明细"
    ws.append(["日期", "领料编号", "物料名称", "领料数", "备注"])
    ws.append(["截止到6月17号", None, "77794-PCBA板", 90, None])
    ws.append(["2026-07-01", 2518831, "77794-PCBA板", 10, "7月领料"])
    ws.append([None, None, "7月小计：", 10, None])

    inbound_ws = wb.create_sheet("半成品入仓明细")
    inbound_ws.append(["日期", "送货单号", "合同号", "货号", "品名/规格", "数量（pcs）", "备注"])
    inbound_ws.append(["2026-07-03", "BS2026070301", "LH202607", 77794, "光身唱机", 8, None])
    inbound_ws.append([None, None, None, None, "7月小计：", 8, None])

    total_ws = wb.create_sheet("总表")
    total_ws.append(["物料名称", None, "累计出入数", "截6月月结", "7月"])
    total_ws.append(["PCBA主板", "领料总数", 100, 90, 10])
    total_ws.append([None, "半成品入仓总数", 8, 0, 8])
    total_ws.append([None, "应存数", 92, 90, 2])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def legacy_heyuan_workbook_bytes():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "PCB板领料明细"
    ws.append(["日期", "领料编号", "物料名称", "领料数", "备注"])
    ws.append(["2026-06-20", 2519360, "77794-PCBA板", 100, None])
    ws.append(["2026-07-01", 2518791, "77794-PCBA板", 30, None])
    ws.append(["2026-07-02", "退不良品", "77794-PCBA板", -5, None])
    ws.append([None, None, "7月小计：", 25, None])

    finished_ws = wb.create_sheet("成品入仓明细")
    finished_ws.append(["日期", "送货单号", "合同号", "货号", "品名/规格", "数量（pcs）", "备注"])
    finished_ws.append(["2026-07-03", "HY2026070301", "HYHT", 77794, "成品唱机", 20, None])
    finished_ws.append([None, None, None, None, "7月小计：", 20, None])

    total_ws = wb.create_sheet("总表")
    total_ws.append(["物料名称", "领料总数", "截6月月结", "7月"])
    total_ws.append(["PCBA主板", 125, 100, 25])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def legacy_supplier_pcba_workbook_bytes():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "入仓明细"
    ws.append(["日期", "入仓单号", "物料名称", "入仓数", "备注"])
    ws.append(["截止到6月17号", None, "77794-PCBA板", 100, None])
    ws.append(["2026-07-01", 2534693, "77794-PCBA板", 40, "转单：A"])
    ws.append(["2026-07-01", 2534693, "77794-PCBA板", 40, "转单：B"])
    ws.append(["2026-07-02", 2651574, "77794-PCBA板", -5, "退货"])
    ws.append([None, None, "7月小计：", 75, None])

    issue_ws = wb.create_sheet("河源华兴领料")
    issue_ws.append(["日期", "领料单号", "物料名称", "领料数", "备注"])
    issue_ws.append(["2026-06-30", 2518000, "77794-PCBA板", 18, None])
    issue_ws.append(["2026-07-02", 2518791, "77794-PCBA板", 30, None])
    issue_ws.append(["2026-07-03", "退不良品", "77794-PCBA板", -5, None])
    issue_ws.append([None, None, "7月小计：", 43, None])

    total_ws = wb.create_sheet("总表")
    total_ws.append(["物料名称", None, "累计出入总数", "6月月结", "7月"])
    total_ws.append(["PCB主板", "入仓总数", 175, 100, 75])
    total_ws.append(["PCB主板", "河源华兴领料总数", 43, None, 43])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def legacy_supplier_nfc_workbook_bytes():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "总表"
    ws.cell(1, 2).value = "累计入仓总数"
    ws.cell(2, 1).value = "物料名称"
    ws.cell(2, 3).value = "截止6月27号"
    ws.cell(1, 4).value = "7月入仓\n总数"
    ws.cell(1, 11).value = "应存数"
    ws.cell(1, 12).value = "累计出仓总数"
    ws.cell(1, 13).value = "东莞"
    ws.cell(2, 13).value = "截止6月27号"
    ws.cell(1, 14).value = "邵阳领料"
    ws.cell(1, 15).value = "7月出仓\n总数"
    ws.cell(3, 1).value = "1#NFC\n贴纸"
    ws.cell(3, 2).value = 180
    ws.cell(3, 3).value = 100
    ws.cell(3, 4).value = 80
    ws.cell(3, 11).value = 75
    ws.cell(3, 12).value = 105
    ws.cell(3, 13).value = 60
    ws.cell(3, 14).value = 15
    ws.cell(3, 15).value = 30

    inbound_ws = wb.create_sheet("入库明细")
    inbound_ws.cell(1, 2).value = "当月入仓总数"
    inbound_ws.cell(1, 3).value = "2026-07-01"
    inbound_ws.cell(1, 4).value = "2026-07-02"
    inbound_ws.cell(2, 1).value = "物料名称"
    inbound_ws.cell(2, 3).value = "RK-1"
    inbound_ws.cell(2, 4).value = "RK-2"
    inbound_ws.cell(3, 1).value = "1#NFC\n贴纸"
    inbound_ws.cell(3, 2).value = 80
    inbound_ws.cell(3, 3).value = 50
    inbound_ws.cell(3, 4).value = 30
    inbound_ws.cell(4, 1).value = "小计："
    inbound_ws.cell(4, 2).value = 80

    outbound_ws = wb.create_sheet("出库明细")
    outbound_ws.cell(1, 2).value = "当月出仓总数"
    outbound_ws.cell(1, 3).value = "2026-07-03"
    outbound_ws.cell(2, 1).value = "物料名称"
    outbound_ws.cell(2, 3).value = "CK-1"
    outbound_ws.cell(3, 1).value = "1#NFC\n贴纸"
    outbound_ws.cell(3, 2).value = 30
    outbound_ws.cell(3, 3).value = 30

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def legacy_hongya_nfc_workbook_bytes():
    wb = openpyxl.Workbook()
    total_ws = wb.active
    total_ws.title = "总表"
    total_ws.cell(1, 2).value = "累计领料总数"
    total_ws.cell(1, 4).value = "7月领料\n总数"
    total_ws.cell(1, 11).value = "应存数"
    total_ws.cell(1, 12).value = "累计入仓总数"
    total_ws.cell(1, 14).value = "7月入仓\n总数"
    total_ws.cell(2, 1).value = "物料名称"
    total_ws.cell(3, 1).value = "1#NFC\n贴纸"
    total_ws.cell(3, 2).value = 30
    total_ws.cell(3, 4).value = 30
    total_ws.cell(3, 11).value = 10
    total_ws.cell(3, 12).value = 20
    total_ws.cell(3, 14).value = 20

    issue_ws = wb.create_sheet("领料明细")
    issue_ws.cell(1, 2).value = "当月领料总数"
    issue_ws.cell(1, 3).value = "2026-07-01"
    issue_ws.cell(2, 1).value = "物料名称"
    issue_ws.cell(3, 1).value = "1#NFC\n贴纸"
    issue_ws.cell(3, 2).value = 30
    issue_ws.cell(3, 3).value = 30

    inbound_ws = wb.create_sheet("入仓明细")
    inbound_ws.cell(1, 2).value = "当月入仓总数"
    inbound_ws.cell(1, 3).value = "2026-07-02"
    inbound_ws.cell(2, 1).value = "物料名称"
    inbound_ws.cell(3, 1).value = "1#NFC\n贴纸"
    inbound_ws.cell(3, 2).value = 20
    inbound_ws.cell(3, 3).value = 20

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def upload_bytes(client, path, content, filename="legacy.xlsx"):
    return client.post(
        path,
        files={
            "file": (
                filename,
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


def test_record_import_template_exports_expected_headers(client):
    login(client)

    r = client.get("/api/records/import-template")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)
    headers = [cell.value for cell in wb.active[1]]

    assert r.status_code == 200
    assert headers == [
        "类型", "物料名称", "贴纸类型", "加工点", "供应商",
        "日期", "单据编号", "数量", "备注", "PO", "客名",
    ]


def test_non_supplier_record_export_matches_import_template_headers(client):
    login(client, "东莞车间", "123456", "东莞车间")
    dongguan = loc_id(client, "东莞加工厂利鸿")
    client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "77794-PCBA板",
        "rec_date": "2026-07-08",
        "doc_no": "EXP-001",
        "qty": 18,
        "remark": "导出测试",
    })

    r = client.get("/api/records/export")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]
    first_row = [cell.value for cell in ws[2]]

    assert r.status_code == 200
    assert headers == [
        "类型", "物料名称", "贴纸类型", "加工点", "供应商",
        "日期", "单据编号", "数量", "备注", "PO", "客名",
    ]
    assert first_row == [
        "领料", "77794-PCBA板", None, "东莞加工厂利鸿", None,
        "2026-07-08", "EXP-001", 18, "导出测试", None, None,
    ]


def test_xingxin_pcba_export_uses_legacy_warehouse_workbook(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)
    heyuan = loc_id(client, "河源华兴")
    client.post("/api/records", json={
        "rec_type": "inbound_raw",
        "material": "77794-PCBA板",
        "rec_date": "2026-07-01",
        "doc_no": "RK-PCBA-1",
        "qty": 40,
        "remark": "入仓测试",
    })
    client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": heyuan,
        "material": "77794-PCBA板",
        "rec_date": "2026-07-02",
        "doc_no": "LL-PCBA-1",
        "qty": 25,
        "remark": "领料测试",
    })

    r = client.get("/api/records/export?material=77794-PCBA板")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)

    assert r.status_code == 200
    assert wb.sheetnames[:8] == [
        "总表", "入仓明细", "邵阳华登领料", "河源华兴领料",
        "加工厂利鸿领料", "加工厂鸿亚领料", "东莞车间领料", "Sheet2",
    ]
    assert [cell.value for cell in wb["入仓明细"][1]] == [
        "日期", "入仓单号", "物料名称", "入仓数", "备注"]
    assert [cell.value for cell in wb["河源华兴领料"][1]] == [
        "日期", "领料单号", "物料名称", "领料数", "备注"]
    assert wb["入仓明细"].cell(2, 2).value == "RK-PCBA-1"
    assert wb["入仓明细"].cell(2, 4).value == 40
    assert wb["河源华兴领料"].cell(2, 2).value == "LL-PCBA-1"
    assert wb["河源华兴领料"].cell(2, 4).value == 25
    total = wb["总表"]
    assert [total.cell(1, col).value for col in range(1, 12)] == [
        "物料名称", None, "累计出入总数", "6月月结", "7月", "8月",
        "9月", "10月", "11月", "12月", "备注",
    ]
    assert [total.cell(row, 2).value for row in range(2, 10)] == [
        "入仓总数", "邵阳华登领料总数", "河源华兴领料总数",
        "加工厂利鸿领料总数", "加工厂鸿亚领料总数", "东莞车间领料",
        None, "应存数",
    ]
    assert total.cell(2, 1).value == "PCB主板"
    assert total.cell(2, 3).value == 40
    assert total.cell(2, 5).value == 40
    assert total.cell(4, 3).value == 25
    assert total.cell(4, 5).value == 25
    assert total.cell(9, 3).value == 15
    assert total.cell(9, 4).value == 0
    assert total.cell(9, 5).value == 15


def test_xingxin_nfc_export_uses_legacy_matrix_workbook(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)
    dongguan = loc_id(client, "东莞车间")
    client.post("/api/records/batch", json={
        "rec_type": "inbound_raw",
        "material": "NFC贴纸",
        "rec_date": "2026-07-01",
        "doc_no": "RK-NFC-1",
        "items": [{"sticker_type": "1#NFC贴纸", "qty": 50}],
    })
    client.post("/api/records/batch", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "NFC贴纸",
        "rec_date": "2026-07-02",
        "doc_no": "CK-NFC-1",
        "items": [{"sticker_type": "1#NFC贴纸", "qty": 20}],
    })

    r = client.get("/api/records/export?material=NFC贴纸")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)

    assert r.status_code == 200
    assert wb.sheetnames[:3] == ["总表", "入库明细", "出库明细"]
    assert wb["总表"].cell(1, 2).value == "累计入仓总数"
    assert wb["总表"].cell(2, 1).value == "物料名称"
    assert wb["总表"].cell(3, 1).value == "1#NFC\n贴纸"
    assert wb["总表"].cell(3, 2).value == 50
    assert wb["总表"].cell(3, 11).value == 30
    assert wb["总表"].cell(3, 12).value == 20
    assert wb["入库明细"].cell(1, 2).value == "当月入仓总数"
    assert wb["入库明细"].cell(2, 1).value == "物料名称"
    assert wb["入库明细"].cell(2, 3).value == "RK-NFC-1"
    assert wb["入库明细"].cell(3, 2).value == 50
    assert wb["入库明细"].cell(3, 3).value == 50
    assert wb["出库明细"].cell(1, 2).value == "当月出仓总数"
    assert wb["出库明细"].cell(2, 3).value == "CK-NFC-1"
    assert wb["出库明细"].cell(3, 2).value == 20
    assert wb["出库明细"].cell(3, 3).value == 20


def test_xingxin_nfc_record_export_fills_legacy_opening_date(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)
    dongguan = loc_id(client, "东莞车间")
    client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "1#NFC贴纸-东莞期初出仓",
        "qty": 60,
        "remark": "总表东莞期初出仓导入",
    })

    r = client.get("/api/records/export?material=NFC贴纸")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)

    assert r.status_code == 200
    assert wb["出库明细"].cell(1, 3).value == "2026-06-27"


def test_xingxin_nfc_export_groups_opening_stock_by_document_column(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)
    client.post("/api/records", json={
        "rec_type": "inbound_raw",
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "rec_date": "2026-06-27",
        "doc_no": "1#NFC贴纸-期初入仓",
        "qty": 846669,
        "remark": "总表期初入仓导入",
    })
    client.post("/api/records", json={
        "rec_type": "inbound_raw",
        "material": "NFC贴纸",
        "sticker_type": "2#NFC贴纸",
        "rec_date": "2026-06-27",
        "doc_no": "2#NFC贴纸-期初入仓",
        "qty": 865000,
        "remark": "总表期初入仓导入",
    })

    r = client.get("/api/records/export?material=NFC贴纸")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)
    ws = wb["入库明细"]

    assert r.status_code == 200
    assert ws.cell(1, 3).value == "2026-06-27"
    assert ws.cell(2, 3).value == "期初入仓"
    assert ws.cell(3, 3).value == 846669
    assert ws.cell(4, 3).value == 865000
    assert ws.cell(1, 4).value is None
    assert ws.cell(2, 4).value is None


def test_semi_finished_export_uses_legacy_matrix_workbook(client):
    login(client, "碟片半成品", "123456", "碟片半成品")
    upload = upload_bytes(
        client,
        "/api/records/import",
        legacy_semi_finished_workbook_bytes(),
        "塑胶仓77772#CD半成品出入明细.xlsx",
    )
    assert upload.status_code == 200

    r = client.get("/api/records/export?material=NFC贴纸")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)

    assert r.status_code == 200
    assert wb.sheetnames[:5] == [
        "总表", "入库明细", "邵阳领料", "河源华兴36#CD领料", "车间36#CD领料"]
    assert wb["总表"].cell(1, 2).value == "累计入仓总数"
    assert wb["总表"].cell(1, 11).value == "应存数"
    assert wb["总表"].cell(3, 1).value == "1#NFC\n贴纸"
    assert wb["总表"].cell(3, 2).value == 100
    assert wb["总表"].cell(3, 11).value == 60
    assert wb["总表"].cell(3, 12).value == 40

    inbound = wb["入库明细"]
    assert inbound.cell(1, 4).value == "日期"
    assert inbound.cell(2, 4).value == "入库单号"
    assert inbound.cell(3, 1).value == "物料名称"
    assert inbound.cell(3, 2).value == "当月入仓总数"
    assert inbound.cell(3, 3).value == "6/24\n东莞车间入库截数"
    assert inbound.cell(4, 1).value == "1#NFC\n贴纸"
    assert inbound.cell(4, 2).value == 100
    assert inbound.cell(4, 3).value == 25
    assert inbound.cell(1, 5).value == "2026-07-01"
    assert inbound.cell(2, 5).value == "RK-001"
    assert inbound.cell(4, 5).value == 30

    outbound = wb["邵阳领料"]
    assert outbound.cell(5, 1).value == "物料名称"
    assert outbound.cell(5, 2).value == "当月出仓总数"
    assert outbound.cell(6, 1).value == "1#NFC\n贴纸"
    assert outbound.cell(6, 2).value == 40
    assert outbound.cell(6, 3).value == 25
    assert outbound.cell(1, 4).value == "2026-07-03"
    assert outbound.cell(2, 4).value == "LL-001"
    assert outbound.cell(6, 4).value == 35


def test_outsource_record_export_uses_legacy_pcba_workbook(client):
    login(client, "东莞加工厂利鸿", "123456", "东莞加工厂利鸿")
    semi = loc_id(client, "碟片半成品")
    client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": semi,
        "material": "77794-PCBA板",
        "rec_date": "2026-07-01",
        "doc_no": "LL-LH-001",
        "qty": 100,
    })
    client.post("/api/records", json={
        "rec_type": "semi_finished",
        "material": "77794-PCBA板",
        "rec_date": "2026-07-02",
        "doc_no": "BS-LH-001",
        "qty": 35,
        "remark": "LH202607 77794 光身唱机",
    })

    r = client.get("/api/records/export?material=77794-PCBA板")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)

    assert r.status_code == 200
    assert wb.sheetnames[:3] == ["总表", "领料明细", "半成品入仓明细"]
    assert [cell.value for cell in wb["领料明细"][1][:5]] == [
        "日期", "领料编号", "物料名称", "领料数", "备注"]
    assert [cell.value for cell in wb["半成品入仓明细"][1][:7]] == [
        "日期", "送货单号", "合同号", "货号", "品名/规格", "数量（pcs）", "备注"]
    assert wb["领料明细"].cell(2, 2).value == "LL-LH-001"
    assert wb["领料明细"].cell(2, 4).value == 100
    assert wb["半成品入仓明细"].cell(2, 2).value == "BS-LH-001"
    assert wb["半成品入仓明细"].cell(2, 6).value == 35
    assert wb["总表"].cell(2, 2).value == "领料总数"
    assert wb["总表"].cell(2, 3).value == 100
    assert wb["总表"].cell(3, 2).value == "半成品入仓总数"
    assert wb["总表"].cell(3, 3).value == 35


def test_heyuan_record_export_uses_legacy_pcba_workbook(client):
    login(client, "河源华兴", "123456", "河源华兴")
    heyuan = loc_id(client, "河源华兴")
    client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": heyuan,
        "material": "77794-PCBA板",
        "rec_date": "2026-07-03",
        "doc_no": "LL-HY-001",
        "qty": 88,
    })
    client.post("/api/records", json={
        "rec_type": "finished",
        "location_id": heyuan,
        "material": "77794-PCBA板",
        "rec_date": "2026-07-04",
        "doc_no": "BS-HY-001",
        "qty": 66,
        "remark": "HY202607 77794 光身唱机",
    })

    r = client.get("/api/records/export?material=77794-PCBA板")
    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)

    assert r.status_code == 200
    assert wb.sheetnames[:4] == ["总表", "36#CD领料明细", "PCB板领料明细", "成品入仓明细"]
    assert [cell.value for cell in wb["PCB板领料明细"][1][:5]] == [
        "日期", "领料编号", "物料名称", "领料数", "备注"]
    assert [cell.value for cell in wb["成品入仓明细"][1][:7]] == [
        "日期", "送货单号", "合同号", "货号", "品名/规格", "数量（pcs）", "备注"]
    assert wb["PCB板领料明细"].cell(2, 2).value == "LL-HY-001"
    assert wb["PCB板领料明细"].cell(2, 4).value == 88
    assert wb["成品入仓明细"].cell(2, 2).value == "BS-HY-001"
    assert wb["成品入仓明细"].cell(2, 6).value == 66
    assert wb["总表"].cell(2, 1).value == "PCBA主板"
    assert wb["总表"].cell(2, 2).value == 88


def test_operator_can_import_record_rows_from_xlsx(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    r = upload_xlsx(
        client,
        "/api/records/import",
        ["类型", "物料名称", "贴纸类型", "加工点", "供应商", "日期", "单据编号", "数量", "备注"],
        [["入库", "NFC贴纸", "1#NFC\n贴纸", None, "供应商A", "2026-07-08", "IMP-001", 18, "导入测试"]],
    )
    records = client.get("/api/records?doc_no=IMP-001").json()

    assert r.status_code == 200
    assert r.json()["created"] == 1
    assert records[0]["material"] == "NFC贴纸"
    assert records[0]["sticker_type"] == "1#NFC贴纸"
    assert records[0]["qty"] == 18


def test_record_import_rejects_nfc_without_sticker_type(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    r = upload_xlsx(
        client,
        "/api/records/import",
        ["类型", "物料名称", "贴纸类型", "数量"],
        [["入库", "NFC贴纸", "", 18]],
    )

    assert r.status_code == 400
    assert "贴纸类型" in r.json()["detail"]


def test_semi_finished_legacy_workbook_imports_detail_rows_and_monthly_totals(client):
    login(client, "碟片半成品", "123456", "碟片半成品")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_semi_finished_workbook_bytes(),
        "塑胶仓77772#CD半成品出入明细.xlsx",
    )
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 3
    assert r.json()["monthly_totals"] == 1
    rows = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert rows[("semi_inbound", "RK-001")]["qty"] == 30
    assert rows[("semi_inbound", "RK-002")]["qty"] == 60
    assert rows[("semi_outbound", "LL-001")]["qty"] == 35
    assert rows[("semi_inbound", "RK-001")]["sticker_type"] == "1#NFC贴纸"

    public = client.get("/api/public-summary").json()
    semi_rows = public["semi_finished_monthly_totals"]
    assert semi_rows == [{
        "department": "碟片半成品",
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "opening_stock": 25,
        "monthly_inbound": 100,
        "monthly_outbound": 40,
        "monthly_balance": 85,
    }]

    second = upload_bytes(
        client,
        "/api/records/import",
        legacy_semi_finished_workbook_bytes(),
        "塑胶仓77772#CD半成品出入明细.xlsx",
    )
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 3
    assert len(client.get("/api/records").json()) == 3


def test_semi_finished_legacy_workbook_rejects_filename_without_department(client):
    login(client, "碟片半成品", "123456", "碟片半成品")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_semi_finished_workbook_bytes(),
        "legacy.xlsx",
    )

    assert r.status_code == 400
    assert "半成品" in r.json()["detail"]


def test_assembly_nfc_legacy_workbook_rejects_filename_without_department(client):
    login(client, "东莞车间", "123456", "东莞车间")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_assembly_nfc_workbook_bytes(),
        "legacy.xlsx",
    )

    assert r.status_code == 400
    assert "东莞车间" in r.json()["detail"]


def test_assembly_nfc_legacy_workbook_imports_matrix_rows(client):
    login(client, "东莞车间", "123456", "东莞车间")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_assembly_nfc_workbook_bytes(),
        "东莞车间77772#NFC贴纸出入明细.xlsx",
    )
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 2
    assert r.json()["monthly_totals"] == 0
    rows = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert rows[("issue", "DG-LL-001")]["qty"] == 60
    assert rows[("issue", "DG-LL-001")]["rec_date"] == "2026-07-01"
    assert rows[("issue", "DG-LL-001")]["material"] == "NFC贴纸"
    assert rows[("issue", "DG-LL-001")]["sticker_type"] == "1#NFC贴纸"
    assert rows[("issue", "DG-LL-001")]["location_name"] == "东莞车间"
    assert rows[("semi_finished", "DG-RK-001")]["qty"] == 25
    assert rows[("semi_finished", "DG-RK-001")]["rec_date"] == "2026-07-02"
    assert rows[("semi_finished", "DG-RK-001")]["location_name"] == "东莞车间"


def test_outsource_legacy_workbook_rejects_filename_without_department(client):
    login(client, "东莞加工厂利鸿", "123456", "东莞加工厂利鸿")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_outsource_workbook_bytes(),
        "legacy.xlsx",
    )

    assert r.status_code == 400
    assert "东莞加工厂利鸿" in r.json()["detail"]


def test_outsource_legacy_workbook_imports_issue_and_semi_finished_rows(client):
    login(client, "东莞加工厂利鸿", "123456", "东莞加工厂利鸿")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_outsource_workbook_bytes(),
        "东莞加工厂利鸿77794PCB主板出入明细.xlsx",
    )
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 3
    by_type_doc = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert by_type_doc[("issue", "截止到6月17号")]["qty"] == 90
    assert by_type_doc[("issue", "2518831")]["qty"] == 10
    assert by_type_doc[("semi_finished", "BS2026070301")]["qty"] == 8
    assert by_type_doc[("issue", "2518831")]["material"] == "77794-PCBA板"

    summary = client.get("/api/summary").json()
    assert summary["raw"]["issue"] == 100
    assert summary["raw"]["semi_finished_inbound"] == 8
    assert summary["raw"]["balance"] == 92

    second = upload_bytes(
        client,
        "/api/records/import",
        legacy_outsource_workbook_bytes(),
        "东莞加工厂利鸿77794PCB主板出入明细.xlsx",
    )
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 3
    assert len(client.get("/api/records").json()) == 3


def test_hongya_nfc_legacy_workbook_rejects_filename_without_department(client):
    login(client, "东莞加工厂鸿亚", "123456", "东莞加工厂鸿亚")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_hongya_nfc_workbook_bytes(),
        "legacy.xlsx",
    )

    assert r.status_code == 400
    assert "东莞加工厂鸿亚" in r.json()["detail"]


def test_hongya_nfc_legacy_workbook_imports_issue_and_finished_rows(client):
    login(client, "东莞加工厂鸿亚", "123456", "东莞加工厂鸿亚")

    r = upload_bytes(
        client,
        "/api/records/import",
        legacy_hongya_nfc_workbook_bytes(),
        "东莞加工厂鸿亚77772#NFC贴纸出入明细.xlsx",
    )
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 2
    rows = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert rows[("issue", "2026-07-01")]["qty"] == 30
    assert rows[("finished", "2026-07-02")]["qty"] == 20
    assert rows[("issue", "2026-07-01")]["material"] == "NFC贴纸"
    assert rows[("issue", "2026-07-01")]["sticker_type"] == "1#NFC贴纸"
    assert rows[("issue", "2026-07-01")]["location_name"] == "东莞加工厂鸿亚"
    assert rows[("finished", "2026-07-02")]["location_name"] is None

    summary = client.get("/api/summary").json()
    assert summary["raw"]["issue"] == 30
    assert summary["raw"]["finished_inbound"] == 20
    assert summary["raw"]["balance"] == 10

    second = upload_bytes(
        client,
        "/api/records/import",
        legacy_hongya_nfc_workbook_bytes(),
        "东莞加工厂鸿亚77772#NFC贴纸出入明细.xlsx",
    )
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 2
    assert len(client.get("/api/records").json()) == 2


def test_heyuan_legacy_workbook_imports_issue_corrections_and_finished_rows(client):
    login(client, "河源华兴", "123456", "河源华兴")

    r = upload_bytes(client, "/api/records/import", legacy_heyuan_workbook_bytes())
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 4
    by_type_doc = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert by_type_doc[("issue", "2519360")]["qty"] == 100
    assert by_type_doc[("issue", "2518791")]["qty"] == 30
    assert by_type_doc[("issue", "退不良品")]["qty"] == -5
    assert by_type_doc[("finished", "HY2026070301")]["qty"] == 20
    assert by_type_doc[("issue", "2518791")]["location_name"] == "河源华兴"

    summary = client.get("/api/summary").json()
    by_location = {row["location"]: row for row in summary["locations"]}
    assert by_location["河源华兴"]["issue"] == 125
    assert by_location["河源华兴"]["finished"] == 20
    assert by_location["河源华兴"]["balance"] == 105

    second = upload_bytes(client, "/api/records/import", legacy_heyuan_workbook_bytes())
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 4
    assert len(client.get("/api/records").json()) == 4


def test_supplier_pcba_legacy_workbook_imports_inbound_and_issue_rows(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    r = upload_bytes(client, "/api/records/import", legacy_supplier_pcba_workbook_bytes())
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 7
    assert [row["qty"] for row in records if row["doc_no"] == "2534693"] == [40, 40]
    by_type_doc = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert by_type_doc[("inbound_raw", "截止到6月17号")]["qty"] == 100
    assert by_type_doc[("inbound_raw", "2651574")]["qty"] == -5
    assert by_type_doc[("issue", "2518791")]["location_name"] == "河源华兴"
    assert by_type_doc[("issue", "退不良品")]["qty"] == -5

    summary = client.get("/api/summary").json()
    assert summary["raw"] == {"inbound": 175, "outbound": 43, "balance": 132}
    assert summary["materials"] == [
        {"material": "77794-PCBA板", "inbound": 175, "outbound": 43, "balance": 132}
    ]
    monthly_rows = {
        (row["location"], row["material"]): row
        for row in summary["monthly_locations"]["locations"]
    }
    assert monthly_rows[("河源华兴", "77794-PCBA板")]["values"][0]["issue"] == 0
    assert monthly_rows[("河源华兴", "77794-PCBA板")]["values"][1]["issue"] == 43

    second = upload_bytes(client, "/api/records/import", legacy_supplier_pcba_workbook_bytes())
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 7
    assert len(client.get("/api/records").json()) == 7


def test_supplier_nfc_legacy_workbook_keeps_summary_rows_out_of_record_list(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    r = upload_bytes(client, "/api/records/import", legacy_supplier_nfc_workbook_bytes())
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 6
    rows = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert sorted(row["doc_no"] for row in records) == ["CK-1", "RK-1", "RK-2"]
    assert rows[("inbound_raw", "RK-1")]["qty"] == 50
    assert rows[("inbound_raw", "RK-2")]["qty"] == 30
    assert rows[("issue", "CK-1")]["qty"] == 30
    assert rows[("issue", "CK-1")]["location_name"] == "东莞车间"
    assert all(row["sticker_type"] == "1#NFC贴纸" for row in records)

    summary = client.get("/api/summary").json()
    sticker_rows = {row["sticker_type"]: row for row in summary["sticker_types"]}
    assert sticker_rows["1#NFC贴纸"] == {
        "sticker_type": "1#NFC贴纸",
        "inbound": 180,
        "outbound": 105,
        "balance": 75,
    }

    second = upload_bytes(client, "/api/records/import", legacy_supplier_nfc_workbook_bytes())
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 6
    assert len(client.get("/api/records").json()) == 3


def test_operator_can_import_and_export_materials(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    import_r = upload_xlsx(
        client,
        "/api/materials/import",
        ["物料名称"],
        [["测试导入物料"]],
    )
    export_r = client.get("/api/materials/export")
    wb = openpyxl.load_workbook(io.BytesIO(export_r.content), data_only=True)
    names = [row[0] for row in wb.active.iter_rows(min_row=2, values_only=True)]

    assert import_r.status_code == 200
    assert import_r.json()["imported"] == 1
    assert export_r.status_code == 200
    assert "测试导入物料" in names


def test_operator_can_import_and_export_suppliers(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    import_r = upload_xlsx(
        client,
        "/api/suppliers/import",
        ["供应商名称"],
        [["测试导入供应商"]],
    )
    export_r = client.get("/api/suppliers/export")
    wb = openpyxl.load_workbook(io.BytesIO(export_r.content), data_only=True)
    names = [row[0] for row in wb.active.iter_rows(min_row=2, values_only=True)]

    assert import_r.status_code == 200
    assert import_r.json()["imported"] == 1
    assert export_r.status_code == 200
    assert "测试导入供应商" in names


def test_operator_can_import_and_export_sticker_types_by_sort(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    import_r = upload_xlsx(
        client,
        "/api/sticker-types/import",
        ["排序", "贴纸类型"],
        [[1, "1#NFC贴纸-修改"]],
    )
    export_r = client.get("/api/sticker-types/export")
    wb = openpyxl.load_workbook(io.BytesIO(export_r.content), data_only=True)
    first_row = [cell.value for cell in wb.active[2]]

    assert import_r.status_code == 200
    assert import_r.json()["imported"] == 1
    assert export_r.status_code == 200
    assert first_row == [1, "1#NFC贴纸-修改"]
