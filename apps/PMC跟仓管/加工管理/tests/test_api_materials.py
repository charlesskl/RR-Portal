DEFAULT_DEPARTMENT = "兴信B来料仓"


def login(client, username, password, department=DEFAULT_DEPARTMENT):
    return client.post(
        "/api/login",
        json={"username": username, "password": password, "department": department},
    )


def admin_login(client, department=DEFAULT_DEPARTMENT):
    login(client, "admin", "admin123", department)


def make_operator(client, name="material_op", pw="pw123456"):
    admin_login(client)
    client.post("/api/users", json={
        "username": name, "password": pw, "role": "operator",
        "department": DEFAULT_DEPARTMENT})
    client.post("/api/logout")
    login(client, name, pw)


def test_operator_can_list_but_not_create_update_or_delete_material(client):
    admin_login(client)
    material_id = client.post("/api/materials", json={"name": "测试物料A"}).json()["id"]
    client.post("/api/logout")
    make_operator(client)

    assert client.get("/api/materials").status_code == 200
    assert client.post("/api/materials", json={"name": "测试物料B"}).status_code == 403
    assert client.put(f"/api/materials/{material_id}", json={"name": "测试物料C"}).status_code == 403
    assert client.delete(f"/api/materials/{material_id}").status_code == 403


def test_admin_can_update_material_name(client):
    admin_login(client)
    material_id = client.post("/api/materials", json={"name": "测试物料A"}).json()["id"]

    r = client.put(f"/api/materials/{material_id}", json={"name": "测试物料A-修改"})
    rows = client.get("/api/materials").json()

    assert r.status_code == 200
    assert any(m["id"] == material_id and m["name"] == "测试物料A-修改" for m in rows)
