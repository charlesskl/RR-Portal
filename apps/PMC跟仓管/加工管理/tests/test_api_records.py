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
        "东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴", "新邵"]


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
    admin_login(client, "邵阳")
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
    admin_login(client, "邵阳")
    for rec_type in ("inbound_raw", "semi_finished", "semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_shaoyang_issue_and_finished_require_location(client):
    admin_login(client, "邵阳")
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


def test_outsource_can_create_issue_finished_and_semi_finished_without_location(client):
    admin_login(client, "东莞加工厂利鸿")
    issue = client.post("/api/records", json={
        "rec_type": "issue", "material": "PCBA板", "qty": 20})
    assert issue.status_code == 200


def test_outsource_rejects_other_warehouse_record_types(client):
    admin_login(client, "东莞加工厂利鸿")
    for rec_type in ("inbound_raw", "semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400


def test_semi_finished_department_can_create_inbound_and_outbound(client):
    admin_login(client, "半成品")
    inbound = client.post("/api/records", json={
        "rec_type": "semi_inbound", "material": "PCBA板", "qty": 80})
    assert inbound.status_code == 200
    outbound = client.post("/api/records", json={
        "rec_type": "semi_outbound", "material": "PCBA板", "qty": 30})
    assert outbound.status_code == 200

    rows = client.get("/api/records").json()
    by_type = {r["rec_type"]: r for r in rows}
    assert by_type["semi_inbound"]["qty"] == 80
    assert by_type["semi_outbound"]["qty"] == 30
    assert by_type["semi_inbound"]["location_id"] is None
    assert by_type["semi_outbound"]["location_id"] is None


def test_non_semi_finished_department_rejects_warehouse_types(client):
    admin_login(client, "东莞车间")
    for rec_type in ("semi_inbound", "semi_outbound"):
        r = client.post("/api/records", json={
            "rec_type": rec_type, "material": "PCBA板", "qty": 10})
        assert r.status_code == 400

