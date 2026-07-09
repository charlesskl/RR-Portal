DEFAULT_DEPARTMENT = "兴信B来料仓"


def admin_login(client, department=DEFAULT_DEPARTMENT):
    client.post(
        "/api/login",
        json={"username": "admin", "password": "admin123", "department": department},
    )


def loc_id(client, name):
    locs = client.get("/api/locations").json()
    return next(l["id"] for l in locs if l["name"] == name)


def _payload_text(value):
    if isinstance(value, dict):
        return " ".join(_payload_text(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(_payload_text(v) for v in value)
    return "" if value is None else str(value)


def test_public_summary_requires_no_login(client):
    r = client.get("/api/public-summary")

    assert r.status_code == 200
    assert r.json()["record_count"] == 0


def test_private_routes_still_require_login(client):
    assert client.get("/api/records").status_code == 401
    assert client.get("/api/summary").status_code == 401
    assert client.get("/api/export").status_code == 401


def test_public_summary_groups_materials_departments_and_filters_dates(client):
    admin_login(client, "兴信B来料仓")
    client.post("/api/suppliers", json={"name": "供应商A"})
    client.post("/api/records", json={
        "rec_type": "inbound_raw",
        "rec_date": "2026-07-01",
        "doc_no": "DOC-SECRET",
        "material": "NFC贴纸",
        "qty": 100,
        "supplier": "供应商A",
        "remark": "内部备注",
    })
    client.post("/api/records", json={
        "rec_type": "inbound_raw",
        "rec_date": "2026-06-30",
        "material": "PCBA板",
        "qty": 900,
    })

    client.post("/api/logout")
    admin_login(client, "邵阳")
    lid = loc_id(client, "邵阳华登")
    client.post("/api/records", json={
        "rec_type": "finished",
        "location_id": lid,
        "rec_date": "2026-07-02",
        "material": "PCBA板",
        "qty": 40,
        "po_no": "PO-SECRET",
        "customer_name": "客户A",
    })
    client.post("/api/logout")

    r = client.get(
        "/api/public-summary?date_from=2026-07-01&date_to=2026-07-31"
    )
    data = r.json()
    materials = {row["material"]: row for row in data["materials"]}
    departments = {row["department"]: row for row in data["department_totals"]}
    text = _payload_text(data)

    assert r.status_code == 200
    assert data["record_count"] == 2
    assert data["totals"] == {"inbound": 140, "outbound": 0, "balance": 140}
    assert materials["NFC贴纸"]["inbound"] == 100
    assert materials["PCBA板"]["inbound"] == 40
    assert departments["兴信B来料仓"]["inbound"] == 100
    assert departments["邵阳"]["inbound"] == 40
    assert "供应商A" not in text
    assert "DOC-SECRET" not in text
    assert "内部备注" not in text
    assert "PO-SECRET" not in text
    assert "客户A" not in text


def test_public_summary_can_filter_by_material_and_department(client):
    admin_login(client, "兴信B来料仓")
    client.post("/api/records", json={
        "rec_type": "inbound_raw", "rec_date": "2026-07-01",
        "material": "NFC贴纸", "qty": 100})

    client.post("/api/logout")
    admin_login(client, "装配")
    lid = loc_id(client, "东莞车间")
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": lid, "rec_date": "2026-07-01",
        "material": "PCBA板", "qty": 80})
    client.post("/api/logout")

    r = client.get("/api/public-summary?department=装配&material=PCBA板")
    data = r.json()

    assert data["record_count"] == 1
    assert data["totals"] == {"inbound": 80, "outbound": 0, "balance": 80}
    assert data["materials"] == [
        {"material": "PCBA板", "inbound": 80, "outbound": 0, "balance": 80}
    ]


def test_public_summary_uses_outsource_balance_direction(client):
    admin_login(client, "外发")
    client.post("/api/records", json={
        "rec_type": "issue", "rec_date": "2026-07-01",
        "material": "PCBA板", "qty": 100})
    client.post("/api/records", json={
        "rec_type": "semi_finished", "rec_date": "2026-07-02",
        "material": "PCBA板", "qty": 60})
    client.post("/api/logout")

    r = client.get("/api/public-summary?department=外发&material=PCBA板")
    data = r.json()
    materials = {row["material"]: row for row in data["materials"]}
    departments = {row["department"]: row for row in data["department_totals"]}

    assert data["totals"] == {"inbound": 60, "outbound": 100, "balance": 40}
    assert materials["PCBA板"]["balance"] == 40
    assert departments["外发"]["balance"] == 40


def test_public_summary_rejects_invalid_department(client):
    r = client.get("/api/public-summary?department=不存在")

    assert r.status_code == 400
