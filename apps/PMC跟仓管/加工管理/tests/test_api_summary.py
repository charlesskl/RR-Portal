def admin_login(client):
    client.post("/api/login", json={"username": "admin", "password": "admin123"})


def loc_id(client, name):
    locs = client.get("/api/locations").json()
    return next(l["id"] for l in locs if l["name"] == name)


def test_summary_reflects_records(client):
    admin_login(client)
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


def test_summary_requires_login(client):
    r = client.get("/api/summary")
    assert r.status_code == 401
