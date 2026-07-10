DEFAULT_DEPARTMENT = "兴信B来料仓"


def admin_login(client, department=DEFAULT_DEPARTMENT):
    client.post(
        "/api/login",
        json={"username": "admin", "password": "admin123", "department": department},
    )


def loc_id(client, name):
    locs = client.get("/api/locations").json()
    return next(l["id"] for l in locs if l["name"] == name)


def test_summary_reflects_records(client):
    admin_login(client, "东莞车间")
    dg = loc_id(client, "东莞加工厂利鸿")
    client.post("/api/records", json={"rec_type": "inbound_raw", "qty": 200000})
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dg, "qty": 110551})
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": dg, "qty": 53096})
    s = client.get("/api/summary").json()
    by_name = {r["location"]: r for r in s["locations"]}
    assert by_name["东莞加工厂利鸿"]["balance"] == 57455
    assert s["subtotal"]["issue"] == 110551
    assert s["raw"]["inbound"] == 200000
    assert s["raw"]["outbound"] == 110551
    assert s["raw"]["balance"] == 89449


def test_summary_can_filter_by_date_range_and_groups_materials(client):
    admin_login(client, "兴信B来料仓")
    lid = loc_id(client, "东莞车间")
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-07-01",
        "material": "NFC贴纸", "qty": 100})
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "rec_date": "2026-07-02",
        "material": "NFC贴纸", "qty": 30})
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-06-30",
        "material": "PCBA板", "qty": 900})

    s = client.get(
        "/api/summary?date_from=2026-07-01&date_to=2026-07-31"
    ).json()
    materials = {row["material"]: row for row in s["materials"]}

    assert s["raw"]["inbound"] == 100
    assert s["raw"]["outbound"] == 30
    assert s["filters"] == {"date_from": "2026-07-01", "date_to": "2026-07-31"}
    assert materials["NFC贴纸"]["balance"] == 70
    assert "PCBA板" not in materials


def test_summary_can_filter_by_doc_no_fuzzy(client):
    admin_login(client, "兴信B来料仓")
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "doc_no": "RK-ABC-001",
        "material": "NFC贴纸", "qty": 100})
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "doc_no": "RK-XYZ-001",
        "material": "PCBA板", "qty": 900})

    s = client.get("/api/summary?doc_no=ABC").json()
    materials = {row["material"]: row for row in s["materials"]}

    assert s["raw"]["inbound"] == 100
    assert s["raw"]["balance"] == 100
    assert s["filters"]["doc_no"] == "ABC"
    assert set(materials) == {"NFC贴纸"}


def test_summary_groups_nfc_stickers_by_type(client):
    admin_login(client, "兴信B来料仓")
    lid = loc_id(client, "东莞车间")
    client.post("/api/records/batch", json={
        "rec_type": "inbound_raw",
        "material": "NFC贴纸",
        "items": [
            {"sticker_type": "1#NFC贴纸", "qty": 100},
            {"sticker_type": "2#NFC贴纸", "qty": 60},
        ],
    })
    client.post("/api/records/batch", json={
        "rec_type": "issue",
        "location_id": lid,
        "material": "NFC贴纸",
        "items": [
            {"sticker_type": "1#NFC贴纸", "qty": 30},
        ],
    })

    s = client.get("/api/summary").json()
    sticker_types = {row["sticker_type"]: row for row in s["sticker_types"]}

    assert sticker_types["1#NFC贴纸"]["inbound"] == 100
    assert sticker_types["1#NFC贴纸"]["outbound"] == 30
    assert sticker_types["1#NFC贴纸"]["balance"] == 70
    assert sticker_types["2#NFC贴纸"]["inbound"] == 60
    assert sticker_types["2#NFC贴纸"]["balance"] == 60


def test_summary_is_scoped_to_current_department(client):
    admin_login(client, "东莞车间")
    dg = loc_id(client, "东莞加工厂利鸿")
    client.post("/api/records", json={"rec_type": "inbound_raw", "qty": 1000})
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dg, "qty": 300})

    client.post("/api/logout")
    admin_login(client, "兴信B来料仓")
    client.post("/api/records", json={"rec_type": "inbound_raw", "qty": 50})

    s = client.get("/api/summary").json()
    assert s["raw"]["inbound"] == 50
    assert s["raw"]["outbound"] == 0
    assert s["subtotal"]["issue"] == 0


def test_summary_includes_monthly_location_totals(client):
    admin_login(client, "兴信B来料仓")
    dg = loc_id(client, "东莞车间")
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-06-27", "qty": 40})
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-07-05", "qty": 60})
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dg, "rec_date": "2026-06-27", "qty": 10})
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dg, "rec_date": "2026-07-06", "qty": 20})

    s = client.get("/api/summary").json()
    monthly = s["monthly_locations"]
    by_location = {row["location"]: row for row in monthly["locations"]}

    assert [row["label"] for row in monthly["months"]] == [
        "6月月结", "7月", "8月", "9月", "10月", "11月", "12月"]
    assert by_location["东莞车间"]["issue"] == 30
    assert by_location["东莞车间"]["values"][0] == {
        "issue": 10, "finished": 0, "balance": 10}
    assert by_location["东莞车间"]["values"][1] == {
        "issue": 20, "finished": 0, "balance": 20}
    assert monthly["subtotal"]["values"][0]["issue"] == 10
    assert monthly["subtotal"]["values"][1]["issue"] == 20
    assert monthly["raw"]["values"][0] == {
        "inbound": 40, "outbound": 10, "balance": 30}
    assert monthly["raw"]["values"][1] == {
        "inbound": 60, "outbound": 20, "balance": 40}


def test_monthly_location_summary_groups_by_material(client):
    admin_login(client, "兴信B来料仓")
    dg = loc_id(client, "东莞车间")
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dg, "rec_date": "2026-07-06",
        "material": "77794-PCBA板", "qty": 20})
    client.post("/api/records/batch", json={
        "rec_type": "issue", "location_id": dg, "rec_date": "2026-07-06",
        "material": "NFC贴纸",
        "items": [
            {"sticker_type": "1#NFC贴纸", "qty": 10},
            {"sticker_type": "2#NFC贴纸", "qty": 15},
        ],
    })

    s = client.get("/api/summary").json()
    rows = {
        (row["location"], row["material"]): row
        for row in s["monthly_locations"]["locations"]
    }

    assert rows[("东莞车间", "77794-PCBA板")]["issue"] == 20
    assert rows[("东莞车间", "NFC贴纸")]["issue"] == 25
    assert rows[("东莞车间", "NFC贴纸")]["values"][1]["issue"] == 25


def test_assembly_summary_subtracts_semi_finished(client):
    admin_login(client, "东莞车间")
    dg = loc_id(client, "东莞加工厂利鸿")
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": dg, "qty": 100})
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": dg, "qty": 30})
    client.post("/api/records", json={
        "rec_type": "semi_finished", "location_id": dg, "qty": 20})

    s = client.get("/api/summary").json()
    by_name = {r["location"]: r for r in s["locations"]}
    assert by_name["东莞加工厂利鸿"]["finished"] == 50
    assert by_name["东莞加工厂利鸿"]["balance"] == 50
    assert s["subtotal"]["finished"] == 50
    assert s["subtotal"]["balance"] == 50


def test_semi_finished_department_summary_uses_warehouse_balance(client):
    admin_login(client, "半成品")
    client.post("/api/records", json={
        "rec_type": "semi_inbound", "material": "PCBA板", "qty": 80})
    client.post("/api/records", json={
        "rec_type": "semi_outbound", "material": "PCBA板", "qty": 30})

    s = client.get("/api/summary").json()
    assert s["raw"]["inbound"] == 80
    assert s["raw"]["outbound"] == 30
    assert s["raw"]["balance"] == 50
    assert s["subtotal"]["issue"] == 0
    assert s["subtotal"]["finished"] == 0


def test_outsource_summary_counts_finished_and_semi_finished_inbound(client):
    admin_login(client, "东莞加工厂利鸿")
    client.post("/api/records", json={
        "rec_type": "finished", "material": "PCBA板", "qty": 70})
    client.post("/api/records", json={
        "rec_type": "semi_finished", "material": "NFC贴纸", "qty": 30})

    s = client.get("/api/summary").json()
    assert s["raw"]["finished_inbound"] == 70
    assert s["raw"]["semi_finished_inbound"] == 30
    assert s["raw"]["inbound"] == 100
    assert s["raw"]["outbound"] == 0
    assert s["raw"]["balance"] == 100
    assert s["subtotal"]["issue"] == 0
    assert s["subtotal"]["finished"] == 0


def test_heyuan_summary_uses_issue_minus_finished_balance(client):
    admin_login(client, "河源华兴")
    lid = loc_id(client, "河源华兴")
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "material": "PCBA板", "qty": 100})
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid, "material": "PCBA板", "qty": 45})

    s = client.get("/api/summary").json()
    by_name = {r["location"]: r for r in s["locations"]}
    assert by_name["河源华兴"]["issue"] == 100
    assert by_name["河源华兴"]["finished"] == 45
    assert by_name["河源华兴"]["balance"] == 55
    assert s["subtotal"]["issue"] == 100
    assert s["subtotal"]["finished"] == 45
    assert s["subtotal"]["balance"] == 55
    assert s["raw"] == {"inbound": 45, "outbound": 100, "balance": 55}
    assert s["materials"] == [
        {"material": "PCBA板", "inbound": 45, "outbound": 100, "balance": 55}
    ]


def test_shaoyang_summary_uses_issue_minus_finished_balance(client):
    admin_login(client, "邵阳")
    lid = loc_id(client, "邵阳华登")
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "material": "PCBA板", "qty": 100})
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid, "material": "PCBA板", "qty": 45,
        "po_no": "PO-001", "customer_name": "客户A"})

    s = client.get("/api/summary").json()
    by_name = {r["location"]: r for r in s["locations"]}
    assert by_name["邵阳华登"]["issue"] == 100
    assert by_name["邵阳华登"]["finished"] == 45
    assert by_name["邵阳华登"]["balance"] == 55


def test_xinshao_summary_uses_issue_minus_finished_balance(client):
    admin_login(client, "新邵")
    lid = loc_id(client, "新邵")
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": lid, "material": "PCBA板", "qty": 100})
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid, "material": "PCBA板", "qty": 45,
        "po_no": "PO-X01", "customer_name": "客户X"})

    s = client.get("/api/summary").json()
    by_name = {r["location"]: r for r in s["locations"]}
    assert by_name["新邵"]["issue"] == 100
    assert by_name["新邵"]["finished"] == 45
    assert by_name["新邵"]["balance"] == 55


def test_summary_requires_login(client):
    r = client.get("/api/summary")
    assert r.status_code == 401

