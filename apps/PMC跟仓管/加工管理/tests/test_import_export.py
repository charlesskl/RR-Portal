import io

import openpyxl


DEFAULT_DEPARTMENT = "兴信B来料仓"


def login(client, username="admin", password="admin123", department=DEFAULT_DEPARTMENT):
    return client.post(
        "/api/login",
        json={"username": username, "password": password, "department": department},
    )


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
    ws["C3"] = "6/24装配入库截数"
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
    issue_ws.append(["2026-07-02", 2518791, "77794-PCBA板", 30, None])
    issue_ws.append(["2026-07-03", "退不良品", "77794-PCBA板", -5, None])
    issue_ws.append([None, None, "7月小计：", 25, None])

    total_ws = wb.create_sheet("总表")
    total_ws.append(["物料名称", None, "累计出入总数"])
    total_ws.append(["PCB主板", "入仓总数", 180])

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


def upload_bytes(client, path, content):
    return client.post(
        path,
        files={
            "file": (
                "legacy.xlsx",
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
    login(client, "半成品", "123456", "半成品")

    r = upload_bytes(client, "/api/records/import", legacy_semi_finished_workbook_bytes())
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
        "department": "半成品",
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "opening_stock": 25,
        "monthly_inbound": 100,
        "monthly_outbound": 40,
        "monthly_balance": 85,
    }]

    second = upload_bytes(client, "/api/records/import", legacy_semi_finished_workbook_bytes())
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 3
    assert len(client.get("/api/records").json()) == 3


def test_outsource_legacy_workbook_imports_issue_and_semi_finished_rows(client):
    login(client, "外发", "123456", "外发")

    r = upload_bytes(client, "/api/records/import", legacy_outsource_workbook_bytes())
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

    second = upload_bytes(client, "/api/records/import", legacy_outsource_workbook_bytes())
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 3
    assert len(client.get("/api/records").json()) == 3


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
    assert r.json()["created"] == 6
    assert [row["qty"] for row in records if row["doc_no"] == "2534693"] == [40, 40]
    by_type_doc = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert by_type_doc[("inbound_raw", "截止到6月17号")]["qty"] == 100
    assert by_type_doc[("inbound_raw", "2651574")]["qty"] == -5
    assert by_type_doc[("issue", "2518791")]["location_name"] == "河源华兴"
    assert by_type_doc[("issue", "退不良品")]["qty"] == -5

    summary = client.get("/api/summary").json()
    assert summary["raw"] == {"inbound": 175, "outbound": 25, "balance": 150}
    assert summary["materials"] == [
        {"material": "77794-PCBA板", "inbound": 175, "outbound": 25, "balance": 150}
    ]

    second = upload_bytes(client, "/api/records/import", legacy_supplier_pcba_workbook_bytes())
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["skipped"] == 6
    assert len(client.get("/api/records").json()) == 6


def test_supplier_nfc_legacy_workbook_imports_opening_and_detail_rows(client):
    login(client, "兴信B来料仓", "123456", DEFAULT_DEPARTMENT)

    r = upload_bytes(client, "/api/records/import", legacy_supplier_nfc_workbook_bytes())
    records = client.get("/api/records").json()

    assert r.status_code == 200
    assert r.json()["created"] == 6
    rows = {(row["rec_type"], row["doc_no"]): row for row in records}
    assert rows[("inbound_raw", "1#NFC贴纸-期初入仓")]["qty"] == 100
    assert rows[("issue", "1#NFC贴纸-东莞期初出仓")]["qty"] == 60
    assert rows[("issue", "1#NFC贴纸-邵阳期初领料")]["qty"] == 15
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
    assert len(client.get("/api/records").json()) == 6


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
