DEFAULT_DEPARTMENT = "兴信B来料仓"


def login(client, username, password, department=DEFAULT_DEPARTMENT):
    return client.post(
        "/api/login",
        json={"username": username, "password": password, "department": department},
    )


def admin_login(client, department=DEFAULT_DEPARTMENT):
    login(client, "admin", "admin123", department)


def make_operator(client, name="supplier_op", pw="pw123456"):
    admin_login(client)
    client.post("/api/users", json={
        "username": name, "password": pw, "role": "operator",
        "department": DEFAULT_DEPARTMENT})
    client.post("/api/logout")
    login(client, name, pw)


def test_admin_can_create_and_list_supplier(client):
    admin_login(client)
    r = client.post("/api/suppliers", json={"name": "供应商A"})
    assert r.status_code == 200
    rows = client.get("/api/suppliers").json()
    assert any(s["name"] == "供应商A" for s in rows)


def test_supplier_name_must_be_unique(client):
    admin_login(client)
    assert client.post("/api/suppliers", json={"name": "供应商A"}).status_code == 200
    r = client.post("/api/suppliers", json={"name": "供应商A"})
    assert r.status_code == 400


def test_admin_can_delete_supplier_without_deleting_history(client):
    admin_login(client)
    supplier_id = client.post("/api/suppliers", json={"name": "供应商A"}).json()["id"]
    r = client.delete(f"/api/suppliers/{supplier_id}")
    assert r.status_code == 200
    rows = client.get("/api/suppliers").json()
    assert all(s["id"] != supplier_id for s in rows)


def test_operator_can_create_update_and_delete_supplier(client):
    admin_login(client)
    supplier_id = client.post("/api/suppliers", json={"name": "供应商A"}).json()["id"]
    client.post("/api/logout")
    make_operator(client)

    assert client.get("/api/suppliers").status_code == 200
    r = client.post("/api/suppliers", json={"name": "供应商B"})
    assert r.status_code == 200
    r = client.put(f"/api/suppliers/{supplier_id}", json={"name": "供应商C"})
    assert r.status_code == 200
    r = client.delete(f"/api/suppliers/{supplier_id}")
    assert r.status_code == 200


def test_admin_can_update_supplier_name(client):
    admin_login(client)
    supplier_id = client.post("/api/suppliers", json={"name": "供应商A"}).json()["id"]

    r = client.put(f"/api/suppliers/{supplier_id}", json={"name": "供应商A-修改"})
    rows = client.get("/api/suppliers").json()

    assert r.status_code == 200
    assert any(s["id"] == supplier_id and s["name"] == "供应商A-修改" for s in rows)
