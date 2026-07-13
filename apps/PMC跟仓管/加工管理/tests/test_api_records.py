DEFAULT_DEPARTMENT = "兴信B来料仓"


def admin_login(client, department=DEFAULT_DEPARTMENT):
    client.post(
        "/api/login",
        json={"username": "admin", "password": "admin123", "department": department},
    )


def make_operator(client, name="op1", pw="pw123456"):
    admin_login(client)
    client.post("/api/users", json={
        "username": name, "password": pw, "role": "operator",
        "department": DEFAULT_DEPARTMENT})
    client.post("/api/logout")
    client.post("/api/login", json={
        "username": name, "password": pw, "department": DEFAULT_DEPARTMENT})


def loc_id(client, name):
    locs = client.get("/api/locations").json()
    return next(l["id"] for l in locs if l["name"] == name)


def test_list_locations(client):
    admin_login(client)
    r = client.get("/api/locations")
    assert r.status_code == 200
    assert [l["name"] for l in r.json()] == [
        "兴信B来料仓", "东莞车间", "碟片半成品", "东莞加工厂利鸿",
        "东莞加工厂鸿亚", "河源华兴", "邵阳华登", "新邵"]


def test_create_and_list_record(client):
    admin_login(client)
    lid = loc_id(client, "东莞车间")
    r = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid,
        "rec_date": "2026-06-20", "doc_no": "X001", "qty": 100, "remark": ""})
    assert r.status_code == 200
    rid = r.json()["id"]
    rows = client.get("/api/records").json()
    assert any(x["id"] == rid and x["qty"] == 100 for x in rows)


def test_records_can_filter_by_date_range(client):
    admin_login(client)
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-07-01", "qty": 10})
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-07-05", "qty": 20})
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-06-30", "qty": 30})

    rows = client.get(
        "/api/records?date_from=2026-07-01&date_to=2026-07-03"
    ).json()

    assert [r["qty"] for r in rows] == [10]


def test_records_can_filter_by_doc_no_fuzzy(client):
    admin_login(client)
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "doc_no": "RK-202607-001", "qty": 10})
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "doc_no": "CK-202607-002", "qty": 20})

    rows = client.get("/api/records?doc_no=RK-202607").json()

    assert [r["qty"] for r in rows] == [10]


def test_records_reject_invalid_date_filter(client):
    admin_login(client)
    r = client.get("/api/records?date_from=2026/07/01")

    assert r.status_code == 400


def test_batch_create_nfc_sticker_records_with_each_quantity(client):
    admin_login(client)
    r = client.post("/api/records/batch", json={
        "rec_type": "inbound_raw",
        "rec_date": "2026-07-08",
        "doc_no": "NFC-001",
        "material": "NFC贴纸",
        "remark": "首批贴纸",
        "items": [
            {"sticker_type": "1#NFC贴纸", "qty": 100},
            {"sticker_type": "2#NFC贴纸", "qty": 250},
        ],
    })

    assert r.status_code == 200
    assert len(r.json()["ids"]) == 2

    rows = client.get("/api/records?doc_no=NFC-001").json()
    by_type = {row["sticker_type"]: row for row in rows}
    assert by_type["1#NFC贴纸"]["material"] == "NFC贴纸"
    assert by_type["1#NFC贴纸"]["qty"] == 100
    assert by_type["2#NFC贴纸"]["qty"] == 250
    assert all(row["doc_no"] == "NFC-001" for row in rows)


def test_batch_create_nfc_stickers_rejects_duplicate_type(client):
    admin_login(client)
    r = client.post("/api/records/batch", json={
        "rec_type": "inbound_raw",
        "material": "NFC贴纸",
        "items": [
            {"sticker_type": "1#NFC贴纸", "qty": 100},
            {"sticker_type": "1#NFC贴纸", "qty": 250},
        ],
    })

    assert r.status_code == 400


def test_batch_create_nfc_stickers_rejects_blank_type(client):
    admin_login(client)
    r = client.post("/api/records/batch", json={
        "rec_type": "inbound_raw",
        "material": "NFC贴纸",
        "items": [
            {"sticker_type": " ", "qty": 100},
        ],
    })

    assert r.status_code == 400


def test_inbound_raw_needs_no_location(client):
    admin_login(client)
    r = client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-06-20", "qty": 5000})
    assert r.status_code == 200


def test_issue_requires_location(client):
    admin_login(client)
    r = client.post("/api/records", json={
        "rec_type": "issue", "qty": 100})
    assert r.status_code == 400


def test_qty_must_be_nonnegative(client):
    admin_login(client)
    r = client.post("/api/records", json={
        "rec_type": "inbound_raw", "qty": -1})
    assert r.status_code == 400


def test_operator_can_edit_own_but_not_others(client):
    # admin 建一条记录
    admin_login(client)
    lid = loc_id(client, "东莞车间")
    rid_admin = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "qty": 100}).json()["id"]
    client.post("/api/logout")
    # operator 建自己的记录
    make_operator(client)
    rid_op = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "qty": 200}).json()["id"]
    # 能改自己的
    r = client.put(f"/api/records/{rid_op}", json={
        "rec_type": "issue", "location_id": lid, "qty": 250})
    assert r.status_code == 200
    # 不能改 admin 的
    r = client.put(f"/api/records/{rid_admin}", json={
        "rec_type": "issue", "location_id": lid, "qty": 999})
    assert r.status_code == 403
    # 不能删 admin 的
    r = client.delete(f"/api/records/{rid_admin}")
    assert r.status_code == 403
    # 能删自己的
    r = client.delete(f"/api/records/{rid_op}")
    assert r.status_code == 200


def test_admin_can_delete_any(client):
    make_operator(client)
    lid = loc_id(client, "东莞车间")
    rid_op = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "qty": 200}).json()["id"]
    client.post("/api/logout")
    admin_login(client)
    r = client.delete(f"/api/records/{rid_op}")
    assert r.status_code == 200


def test_bulk_delete_removes_selected_records_and_linked_records(client):
    admin_login(client, "兴信B来料仓")
    dongguan = loc_id(client, "东莞车间")
    source = client.post("/api/records", json={
        "rec_type": "issue", "location_id": dongguan,
        "material": "NFC贴纸", "sticker_type": "1#NFC贴纸",
        "doc_no": "BULK-LINK-001", "qty": 12}).json()["id"]
    inbound = client.post("/api/records", json={
        "rec_type": "inbound_raw", "material": "77794-PCBA板",
        "doc_no": "BULK-IN-001", "qty": 20}).json()["id"]

    r = client.post("/api/records/bulk-delete", json={"ids": [source, inbound]})

    assert r.status_code == 200
    assert r.json()["deleted"] == 3
    assert client.get("/api/records?doc_no=BULK-LINK-001").json() == []
    assert client.get("/api/records?doc_no=BULK-IN-001").json() == []
    client.post("/api/logout")
    admin_login(client, "东莞车间")
    assert client.get("/api/records?doc_no=BULK-LINK-001").json() == []


def test_bulk_delete_rejects_auto_linked_record(client):
    admin_login(client, "兴信B来料仓")
    dongguan = loc_id(client, "东莞车间")
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dongguan,
        "material": "NFC贴纸", "sticker_type": "1#NFC贴纸",
        "doc_no": "BULK-AUTO-001", "qty": 12})
    client.post("/api/logout")
    admin_login(client, "东莞车间")
    linked_id = client.get("/api/records?doc_no=BULK-AUTO-001").json()[0]["id"]

    r = client.post("/api/records/bulk-delete", json={"ids": [linked_id]})

    assert r.status_code == 400


def test_operator_bulk_delete_rejects_other_users_records(client):
    admin_login(client)
    lid = loc_id(client, "东莞车间")
    rid_admin = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "qty": 100}).json()["id"]
    client.post("/api/logout")
    make_operator(client)

    r = client.post("/api/records/bulk-delete", json={"ids": [rid_admin]})

    assert r.status_code == 403


def test_admin_can_clear_records_by_department_and_material(client):
    admin_login(client, "兴信B来料仓")
    dongguan = loc_id(client, "东莞车间")
    source_id = client.post("/api/records", json={
        "rec_type": "issue", "location_id": dongguan,
        "material": "77794-PCBA板", "doc_no": "CLEAR-PCBA-001", "qty": 18}).json()["id"]
    keep_id = client.post("/api/records", json={
        "rec_type": "inbound_raw", "material": "NFC贴纸",
        "doc_no": "CLEAR-NFC-KEEP", "qty": 30}).json()["id"]

    r = client.post("/api/records/clear", json={
        "department": "兴信B来料仓",
        "material": "77794-PCBA板",
    })

    assert r.status_code == 200
    assert r.json()["matched"] == 1
    assert r.json()["deleted"] == 2
    rows = client.get("/api/records").json()
    assert all(row["id"] != source_id for row in rows)
    assert any(row["id"] == keep_id for row in rows)
    client.post("/api/logout")
    admin_login(client, "东莞车间")
    assert client.get("/api/records?doc_no=CLEAR-PCBA-001").json() == []


def test_clear_records_requires_admin(client):
    make_operator(client)

    r = client.post("/api/records/clear", json={
        "department": "兴信B来料仓",
        "material": "NFC贴纸",
    })

    assert r.status_code == 403


def test_records_are_isolated_by_department(client):
    admin_login(client, "东莞车间")
    lid = loc_id(client, "东莞车间")
    rid = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "qty": 100}).json()["id"]
    assert any(x["id"] == rid for x in client.get("/api/records").json())

    client.post("/api/logout")
    admin_login(client, "河源华兴")
    rows = client.get("/api/records").json()
    assert all(x["id"] != rid for x in rows)


def test_cross_department_record_update_and_delete_return_404(client):
    admin_login(client, "东莞车间")
    lid = loc_id(client, "东莞车间")
    rid = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "qty": 100}).json()["id"]

    client.post("/api/logout")
    admin_login(client, "河源华兴")
    r = client.put(f"/api/records/{rid}", json={
        "rec_type": "issue", "location_id": lid, "qty": 200})
    assert r.status_code == 404
    r = client.delete(f"/api/records/{rid}")
    assert r.status_code == 404


def test_xingxin_record_saves_supplier(client):
    admin_login(client, "兴信B来料仓")
    client.post("/api/suppliers", json={"name": "供应商A"})
    r = client.post("/api/records", json={
        "rec_type": "inbound_raw", "material": "NFC贴纸",
        "qty": 100, "supplier": "供应商A"})
    assert r.status_code == 200
    rid = r.json()["id"]
    rows = client.get("/api/records").json()
    rec = next(x for x in rows if x["id"] == rid)
    assert rec["supplier"] == "供应商A"


def test_non_xingxin_record_clears_supplier(client):
    admin_login(client, "东莞车间")
    lid = loc_id(client, "东莞车间")
    r = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "material": "PCBA板",
        "qty": 100, "supplier": "供应商A"})
    assert r.status_code == 200
    rid = r.json()["id"]
    rows = client.get("/api/records").json()
    rec = next(x for x in rows if x["id"] == rid)
    assert rec["supplier"] is None


def test_xingxin_rejects_finished_records(client):
    admin_login(client, "兴信B来料仓")
    lid = loc_id(client, "东莞车间")
    r = client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid, "material": "PCBA板",
        "qty": 100})
    assert r.status_code == 400


def test_assembly_can_create_semi_finished_record(client):
    admin_login(client, "东莞车间")
    lid = loc_id(client, "东莞车间")
    r = client.post("/api/records", json={
        "rec_type": "semi_finished", "location_id": lid,
        "material": "PCBA板", "qty": 25})
    assert r.status_code == 200
    rid = r.json()["id"]
    rows = client.get("/api/records").json()
    rec = next(x for x in rows if x["id"] == rid)
    assert rec["rec_type"] == "semi_finished"
    assert rec["qty"] == 25


def test_non_assembly_rejects_semi_finished_record(client):
    admin_login(client, "河源华兴")
    lid = loc_id(client, "东莞车间")
    r = client.post("/api/records", json={
        "rec_type": "semi_finished", "location_id": lid,
        "material": "PCBA板", "qty": 25})
    assert r.status_code == 400


def test_heyuan_can_create_issue_and_finished_records(client):
    admin_login(client, "河源华兴")
    lid = loc_id(client, "河源华兴")
    issue = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid,
        "material": "PCBA板", "qty": 100})
    assert issue.status_code == 200
    finished = client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid,
        "material": "PCBA板", "qty": 45})
    assert finished.status_code == 200

    rows = client.get("/api/records").json()
    by_type = {r["rec_type"]: r for r in rows}
    assert by_type["issue"]["qty"] == 100
    assert by_type["finished"]["qty"] == 45
    assert by_type["issue"]["location_id"] == lid
    assert by_type["finished"]["location_id"] == lid


def test_heyuan_rejects_non_issue_or_finished_record_types(client):
    admin_login(client, "河源华兴")
    for rec_type in ("inbound_raw", "semi_finished", "semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_heyuan_issue_and_finished_require_location(client):
    admin_login(client, "河源华兴")
    for rec_type in ("issue", "finished"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_shaoyang_can_create_issue_and_finished_with_po_customer(client):
    admin_login(client, "邵阳华登")
    lid = loc_id(client, "邵阳华登")
    issue = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid,
        "material": "PCBA板", "qty": 100,
        "po_no": "PO-IGNORED", "customer_name": "客户忽略"})
    assert issue.status_code == 200
    finished = client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid,
        "material": "PCBA板", "qty": 45,
        "po_no": "PO-001", "customer_name": "客户A"})
    assert finished.status_code == 200

    rows = client.get("/api/records").json()
    by_type = {r["rec_type"]: r for r in rows}
    assert by_type["issue"]["po_no"] is None
    assert by_type["issue"]["customer_name"] is None
    assert by_type["finished"]["po_no"] == "PO-001"
    assert by_type["finished"]["customer_name"] == "客户A"


def test_shaoyang_rejects_non_issue_or_finished_record_types(client):
    admin_login(client, "邵阳华登")
    for rec_type in ("inbound_raw", "semi_finished", "semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_shaoyang_issue_and_finished_require_location(client):
    admin_login(client, "邵阳华登")
    for rec_type in ("issue", "finished"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_xinshao_can_create_issue_and_finished_with_po_customer(client):
    admin_login(client, "新邵")
    lid = loc_id(client, "新邵")
    issue = client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid,
        "material": "PCBA板", "qty": 100,
        "po_no": "PO-IGNORED", "customer_name": "客户忽略"})
    assert issue.status_code == 200
    finished = client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid,
        "material": "PCBA板", "qty": 45,
        "po_no": "PO-X01", "customer_name": "客户X"})
    assert finished.status_code == 200

    rows = client.get("/api/records").json()
    by_type = {r["rec_type"]: r for r in rows}
    assert by_type["issue"]["po_no"] is None
    assert by_type["issue"]["customer_name"] is None
    assert by_type["finished"]["po_no"] == "PO-X01"
    assert by_type["finished"]["customer_name"] == "客户X"


def test_xinshao_rejects_non_issue_or_finished_record_types(client):
    admin_login(client, "新邵")
    for rec_type in ("inbound_raw", "semi_finished", "semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_xinshao_issue_and_finished_require_location(client):
    admin_login(client, "新邵")
    for rec_type in ("issue", "finished"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_non_shaoyang_record_clears_po_customer(client):
    admin_login(client, "东莞车间")
    lid = loc_id(client, "邵阳华登")
    r = client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid,
        "material": "PCBA板", "qty": 10,
        "po_no": "PO-001", "customer_name": "客户A"})
    assert r.status_code == 200
    rid = r.json()["id"]
    rec = next(x for x in client.get("/api/records").json() if x["id"] == rid)
    assert rec["po_no"] is None
    assert rec["customer_name"] is None


def test_outsource_can_create_finished_and_semi_finished_without_location(client):
    admin_login(client, "东莞加工厂利鸿")
    finished = client.post("/api/records", json={
        "rec_type": "finished", "material": "PCBA板", "qty": 40})
    assert finished.status_code == 200
    semi_finished = client.post("/api/records", json={
        "rec_type": "semi_finished", "material": "NFC贴纸", "qty": 15})
    assert semi_finished.status_code == 200

    rows = client.get("/api/records").json()
    by_type = {r["rec_type"]: r for r in rows}
    assert by_type["finished"]["qty"] == 40
    assert by_type["semi_finished"]["qty"] == 15
    assert by_type["finished"]["location_id"] is None
    assert by_type["semi_finished"]["location_id"] is None


def test_outsource_can_create_issue_with_target_department(client):
    admin_login(client, "东莞加工厂利鸿")
    semi = loc_id(client, "碟片半成品")
    issue = client.post("/api/records", json={
        "rec_type": "issue", "location_id": semi,
        "material": "PCBA板", "qty": 20})
    assert issue.status_code == 200
    row = client.get("/api/records").json()[0]
    assert row["location_id"] == semi


def test_hongya_outsource_can_create_all_outsource_types(client):
    admin_login(client, "东莞加工厂鸿亚")
    semi = loc_id(client, "碟片半成品")

    issue = client.post("/api/records", json={
        "rec_type": "issue", "location_id": semi, "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸", "qty": 120})
    finished = client.post("/api/records", json={
        "rec_type": "finished", "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸", "qty": 80})
    semi_finished = client.post("/api/records", json={
        "rec_type": "semi_finished", "material": "77794-PCBA板", "qty": 15})

    assert issue.status_code == 200
    assert finished.status_code == 200
    assert semi_finished.status_code == 200
    rows = client.get("/api/records").json()
    by_type = {row["rec_type"]: row for row in rows}
    assert by_type["issue"]["location_id"] == semi
    assert by_type["finished"]["location_id"] is None
    assert by_type["semi_finished"]["location_id"] is None


def test_outsource_rejects_other_warehouse_record_types(client):
    admin_login(client, "东莞加工厂利鸿")
    for rec_type in ("inbound_raw", "semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_semi_finished_department_can_create_inbound_and_outbound(client):
    admin_login(client, "碟片半成品")
    hongya = loc_id(client, "东莞加工厂鸿亚")
    inbound = client.post("/api/records", json={
        "rec_type": "semi_inbound", "material": "PCBA板", "qty": 80})
    assert inbound.status_code == 200
    outbound = client.post("/api/records", json={
        "rec_type": "semi_outbound", "location_id": hongya,
        "material": "PCBA板", "qty": 30})
    assert outbound.status_code == 200

    rows = client.get("/api/records").json()
    by_type = {r["rec_type"]: r for r in rows}
    assert by_type["semi_inbound"]["qty"] == 80
    assert by_type["semi_outbound"]["qty"] == 30
    assert by_type["semi_inbound"]["location_id"] is None
    assert by_type["semi_outbound"]["location_id"] == hongya


def test_semi_finished_outbound_requires_target_department(client):
    admin_login(client, "碟片半成品")
    r = client.post("/api/records", json={
        "rec_type": "semi_outbound", "material": "PCBA板", "qty": 30})

    assert r.status_code == 400


def test_non_semi_finished_department_rejects_warehouse_types(client):
    admin_login(client, "东莞车间")
    for rec_type in ("semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_xingxin_nfc_issue_auto_syncs_dongguan_issue_record(client):
    admin_login(client, "兴信B来料仓")
    dongguan = loc_id(client, "东莞车间")
    created = client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "rec_date": "2026-07-10",
        "doc_no": "FLOW-XD-001",
        "qty": 100,
    })
    assert created.status_code == 200
    source_id = created.json()["id"]

    client.post("/api/logout")
    admin_login(client, "东莞车间")
    rows = client.get("/api/records?doc_no=FLOW-XD-001").json()
    assert len(rows) == 1
    assert rows[0]["rec_type"] == "issue"
    assert rows[0]["location_name"] == "东莞车间"
    assert rows[0]["material"] == "NFC贴纸"
    assert rows[0]["sticker_type"] == "1#NFC贴纸"
    assert rows[0]["qty"] == 100
    assert rows[0]["source_record_id"] == source_id

    client.post("/api/logout")
    admin_login(client, "兴信B来料仓")
    updated = client.put(f"/api/records/{source_id}", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "rec_date": "2026-07-10",
        "doc_no": "FLOW-XD-001",
        "qty": 60,
    })
    assert updated.status_code == 200

    client.post("/api/logout")
    admin_login(client, "东莞车间")
    rows = client.get("/api/records?doc_no=FLOW-XD-001").json()
    assert len(rows) == 1
    assert rows[0]["qty"] == 60

    client.post("/api/logout")
    admin_login(client, "兴信B来料仓")
    deleted = client.delete(f"/api/records/{source_id}")
    assert deleted.status_code == 200

    client.post("/api/logout")
    admin_login(client, "东莞车间")
    assert client.get("/api/records?doc_no=FLOW-XD-001").json() == []


def test_xingxin_pcba_issue_auto_syncs_dongguan_issue_record(client):
    admin_login(client, "兴信B来料仓")
    dongguan = loc_id(client, "东莞车间")
    created = client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "77794-PCBA板",
        "rec_date": "2026-07-10",
        "doc_no": "FLOW-PCBA-XD-001",
        "qty": 88,
    })
    assert created.status_code == 200
    source_id = created.json()["id"]

    client.post("/api/logout")
    admin_login(client, "东莞车间")
    rows = client.get("/api/records?doc_no=FLOW-PCBA-XD-001").json()
    assert len(rows) == 1
    assert rows[0]["rec_type"] == "issue"
    assert rows[0]["location_name"] == "东莞车间"
    assert rows[0]["material"] == "77794-PCBA板"
    assert rows[0]["sticker_type"] is None
    assert rows[0]["qty"] == 88
    assert rows[0]["source_record_id"] == source_id


def test_auto_linked_records_cannot_be_edited_or_deleted_directly(client):
    admin_login(client, "兴信B来料仓")
    dongguan = loc_id(client, "东莞车间")
    source_id = client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "FLOW-LOCK-001",
        "qty": 30,
    }).json()["id"]

    client.post("/api/logout")
    admin_login(client, "东莞车间")
    auto_record = client.get("/api/records?doc_no=FLOW-LOCK-001").json()[0]
    assert auto_record["source_record_id"] == source_id

    edit = client.put(f"/api/records/{auto_record['id']}", json={
        "rec_type": "issue",
        "location_id": dongguan,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "FLOW-LOCK-001",
        "qty": 20,
    })
    delete = client.delete(f"/api/records/{auto_record['id']}")

    assert edit.status_code == 400
    assert "原始记录" in edit.json()["detail"]
    assert delete.status_code == 400
    assert "原始记录" in delete.json()["detail"]


def test_semifinished_outbound_to_hongya_auto_creates_hongya_issue(client):
    admin_login(client, "碟片半成品")
    hongya = loc_id(client, "东莞加工厂鸿亚")

    created = client.post("/api/records", json={
        "rec_type": "semi_outbound",
        "location_id": hongya,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "FLOW-HY-001",
        "qty": 70,
    })
    assert created.status_code == 200

    client.post("/api/logout")
    admin_login(client, "东莞加工厂鸿亚")
    rows = client.get("/api/records?doc_no=FLOW-HY-001").json()
    assert len(rows) == 1
    assert rows[0]["rec_type"] == "issue"
    assert rows[0]["material"] == "NFC贴纸"
    assert rows[0]["sticker_type"] == "1#NFC贴纸"
    assert rows[0]["qty"] == 70
    assert rows[0]["location_id"] == hongya


def test_outsource_issue_requires_target_department(client):
    admin_login(client, "东莞加工厂鸿亚")

    r = client.post("/api/records", json={
        "rec_type": "issue",
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "FLOW-HY-NO-TARGET-001",
        "qty": 22,
    })

    assert r.status_code == 400


def test_outsource_issue_auto_syncs_target_department_inbound(client):
    admin_login(client, "东莞加工厂鸿亚")
    semi = loc_id(client, "碟片半成品")

    created = client.post("/api/records", json={
        "rec_type": "issue",
        "location_id": semi,
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "FLOW-HY-TO-SEMI-001",
        "qty": 22,
    })
    assert created.status_code == 200
    source_id = created.json()["id"]

    client.post("/api/logout")
    admin_login(client, "碟片半成品")
    rows = client.get("/api/records?doc_no=FLOW-HY-TO-SEMI-001").json()
    assert len(rows) == 1
    assert rows[0]["rec_type"] == "semi_inbound"
    assert rows[0]["material"] == "NFC贴纸"
    assert rows[0]["sticker_type"] == "1#NFC贴纸"
    assert rows[0]["qty"] == 22
    assert rows[0]["source_record_id"] == source_id


def test_hongya_return_auto_creates_semifinished_inbound(client):
    admin_login(client, "东莞加工厂鸿亚")

    created = client.post("/api/records", json={
        "rec_type": "semi_finished",
        "material": "NFC贴纸",
        "sticker_type": "1#NFC贴纸",
        "doc_no": "FLOW-HY-BACK-001",
        "qty": 55,
    })
    assert created.status_code == 200

    client.post("/api/logout")
    admin_login(client, "碟片半成品")
    rows = client.get("/api/records?doc_no=FLOW-HY-BACK-001").json()
    assert len(rows) == 1
    assert rows[0]["rec_type"] == "semi_inbound"
    assert rows[0]["material"] == "NFC贴纸"
    assert rows[0]["sticker_type"] == "1#NFC贴纸"
    assert rows[0]["qty"] == 55


def test_semifinished_nfc_to_heyuan_auto_creates_heyuan_issue(client):
    admin_login(client, "碟片半成品")
    heyuan = loc_id(client, "河源华兴")

    flow_36 = client.post("/api/records", json={
        "rec_type": "semi_outbound",
        "location_id": heyuan,
        "material": "NFC贴纸",
        "sticker_type": "36#NFC贴纸",
        "doc_no": "FLOW-36-HY-001",
        "qty": 36,
    })
    flow_other = client.post("/api/records", json={
        "rec_type": "semi_outbound",
        "location_id": heyuan,
        "material": "NFC贴纸",
        "sticker_type": "35#NFC贴纸",
        "doc_no": "FLOW-35-HY-001",
        "qty": 35,
    })
    assert flow_36.status_code == 200
    assert flow_other.status_code == 200

    client.post("/api/logout")
    admin_login(client, "河源华兴")
    rows_36 = client.get("/api/records?doc_no=FLOW-36-HY-001").json()
    rows_other = client.get("/api/records?doc_no=FLOW-35-HY-001").json()
    assert len(rows_36) == 1
    assert rows_36[0]["rec_type"] == "issue"
    assert rows_36[0]["location_name"] == "河源华兴"
    assert rows_36[0]["sticker_type"] == "36#NFC贴纸"
    assert rows_36[0]["qty"] == 36
    assert len(rows_other) == 1
    assert rows_other[0]["rec_type"] == "issue"
    assert rows_other[0]["location_name"] == "河源华兴"
    assert rows_other[0]["sticker_type"] == "35#NFC贴纸"
    assert rows_other[0]["qty"] == 35


def test_semifinished_36_nfc_to_shaoyang_huadeng_auto_creates_shaoyang_issue(client):
    admin_login(client, "碟片半成品")
    shaoyang = loc_id(client, "邵阳华登")

    created = client.post("/api/records", json={
        "rec_type": "semi_outbound",
        "location_id": shaoyang,
        "material": "NFC贴纸",
        "sticker_type": "36#NFC贴纸",
        "doc_no": "FLOW-36-SY-001",
        "qty": 66,
    })
    assert created.status_code == 200

    client.post("/api/logout")
    admin_login(client, "邵阳华登")
    rows = client.get("/api/records?doc_no=FLOW-36-SY-001").json()
    assert len(rows) == 1
    assert rows[0]["rec_type"] == "issue"
    assert rows[0]["location_name"] == "邵阳华登"
    assert rows[0]["sticker_type"] == "36#NFC贴纸"
    assert rows[0]["qty"] == 66

