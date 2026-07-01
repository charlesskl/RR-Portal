def admin_login(client):
    client.post("/api/login", json={"username": "admin", "password": "admin123"})


def make_operator(client, name="op1", pw="pw123456"):
    admin_login(client)
    client.post("/api/users", json={"username": name, "password": pw, "role": "operator"})
    client.post("/api/logout")
    client.post("/api/login", json={"username": name, "password": pw})


def loc_id(client, name):
    locs = client.get("/api/locations").json()
    return next(l["id"] for l in locs if l["name"] == name)


def test_list_locations(client):
    admin_login(client)
    r = client.get("/api/locations")
    assert r.status_code == 200
    assert [l["name"] for l in r.json()] == [
        "东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴"]


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
