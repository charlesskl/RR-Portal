DEFAULT_DEPARTMENT = "兴信B来料仓"


def login(client, username, password, department=DEFAULT_DEPARTMENT):
    return client.post(
        "/api/login",
        json={"username": username, "password": password, "department": department},
    )


def test_login_success(client):
    r = login(client, "admin", "admin123")
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    assert r.json()["department"] == DEFAULT_DEPARTMENT


def test_login_wrong_password(client):
    r = login(client, "admin", "bad")
    assert r.status_code == 401


def test_me_requires_login(client):
    r = client.get("/api/me")
    assert r.status_code == 401


def test_me_after_login(client):
    login(client, "admin", "admin123")
    r = client.get("/api/me")
    assert r.status_code == 200
    assert r.json()["username"] == "admin"
    assert r.json()["department"] == DEFAULT_DEPARTMENT


def test_list_departments(client):
    r = client.get("/api/departments")
    assert r.status_code == 200
    assert r.json() == [
        "兴信B来料仓", "东莞车间", "碟片半成品", "东莞加工厂利鸿",
        "东莞加工厂鸿亚", "河源华兴", "邵阳华登", "新邵"]


def test_default_hongya_operator_can_login(client):
    r = login(client, "东莞加工厂鸿亚", "123456", "东莞加工厂鸿亚")
    assert r.status_code == 200
    assert r.json()["role"] == "operator"
    assert r.json()["department"] == "东莞加工厂鸿亚"


def test_admin_can_create_operator(client):
    login(client, "admin", "admin123")
    r = client.post("/api/users", json={
        "username": "op1", "password": "pw123456", "role": "operator",
        "department": "东莞车间"})
    assert r.status_code == 200
    # 新用户能登录
    c2 = login(client, "op1", "pw123456", "东莞车间")
    assert c2.status_code == 200
    assert c2.json()["role"] == "operator"
    assert c2.json()["department"] == "东莞车间"


def test_operator_login_rejects_wrong_department(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_wrong_dept", "password": "pw123456",
        "role": "operator", "department": "东莞车间"})
    client.post("/api/logout")
    r = login(client, "op_wrong_dept", "pw123456", "东莞加工厂利鸿")
    assert r.status_code == 403


def test_admin_can_login_to_any_department(client):
    r = login(client, "admin", "admin123", "新邵")
    assert r.status_code == 200
    assert r.json()["department"] == "新邵"


def test_admin_can_switch_department_without_relogin(client):
    login(client, "admin", "admin123")
    departments = client.get("/api/departments").json()
    target_department = departments[1]

    client.post("/api/records", json={
        "rec_type": "inbound_raw", "doc_no": "SWITCH-DEFAULT", "qty": 5})

    r = client.post("/api/me/department", json={"department": target_department})

    assert r.status_code == 200
    assert r.json()["department"] == target_department
    assert client.get("/api/me").json()["department"] == target_department

    client.post("/api/records", json={
        "rec_type": "inbound_raw", "doc_no": "SWITCH-TARGET", "qty": 7})
    rows = client.get("/api/records").json()
    assert any(row["doc_no"] == "SWITCH-TARGET" for row in rows)
    assert all(row["doc_no"] != "SWITCH-DEFAULT" for row in rows)

    r = client.post("/api/me/department", json={"department": DEFAULT_DEPARTMENT})

    assert r.status_code == 200
    rows = client.get("/api/records").json()
    assert any(row["doc_no"] == "SWITCH-DEFAULT" for row in rows)
    assert all(row["doc_no"] != "SWITCH-TARGET" for row in rows)


def test_operator_cannot_switch_department(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_switch_department", "password": "pw123456",
        "role": "operator", "department": DEFAULT_DEPARTMENT})
    target_department = client.get("/api/departments").json()[1]
    client.post("/api/logout")
    login(client, "op_switch_department", "pw123456")

    r = client.post("/api/me/department", json={"department": target_department})

    assert r.status_code == 403
    assert client.get("/api/me").json()["department"] == DEFAULT_DEPARTMENT


def test_operator_requires_department_when_created(client):
    login(client, "admin", "admin123")
    r = client.post("/api/users", json={
        "username": "op_no_dept", "password": "pw123456", "role": "operator"})
    assert r.status_code == 400


def test_users_include_department(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_list_dept", "password": "pw123456",
        "role": "operator", "department": "碟片半成品"})
    rows = client.get("/api/users").json()
    user = next(u for u in rows if u["username"] == "op_list_dept")
    assert user["department"] == "碟片半成品"


def test_operator_cannot_create_user(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op2", "password": "pw123456", "role": "operator",
        "department": DEFAULT_DEPARTMENT})
    client.post("/api/logout")
    login(client, "op2", "pw123456")
    r = client.post("/api/users", json={
        "username": "op3", "password": "pw123456", "role": "operator"})
    assert r.status_code == 403


def test_user_can_change_own_password(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_self_pw", "password": "oldpw123",
        "role": "operator", "department": DEFAULT_DEPARTMENT})
    client.post("/api/logout")
    login(client, "op_self_pw", "oldpw123")

    r = client.put("/api/me/password", json={"password": "newpw123"})
    client.post("/api/logout")
    old_login = login(client, "op_self_pw", "oldpw123")
    new_login = login(client, "op_self_pw", "newpw123")

    assert r.status_code == 200
    assert old_login.status_code == 401
    assert new_login.status_code == 200


def test_admin_can_reset_any_user_password(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_reset_pw", "password": "oldpw123",
        "role": "operator", "department": DEFAULT_DEPARTMENT})
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "op_reset_pw")

    r = client.put(f"/api/users/{user_id}/password", json={"password": "newpw123"})
    client.post("/api/logout")
    new_login = login(client, "op_reset_pw", "newpw123")

    assert r.status_code == 200
    assert new_login.status_code == 200


def test_admin_can_update_user_role_and_department(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_update_user", "password": "pw123456",
        "role": "operator", "department": DEFAULT_DEPARTMENT})
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "op_update_user")

    r = client.put(f"/api/users/{user_id}", json={
        "role": "operator",
        "department": "东莞车间",
    })
    row = next(u for u in client.get("/api/users").json() if u["id"] == user_id)

    assert r.status_code == 200
    assert row["department"] == "东莞车间"


def test_operator_session_uses_current_database_department(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_session_department", "password": "pw123456",
        "role": "operator", "department": DEFAULT_DEPARTMENT})
    user_id = next(
        u["id"] for u in client.get("/api/users").json()
        if u["username"] == "op_session_department"
    )
    client.post("/api/logout")
    login(client, "op_session_department", "pw123456", DEFAULT_DEPARTMENT)

    from fastapi.testclient import TestClient
    from pcba.main import app

    with TestClient(app) as admin_client:
        login(admin_client, "admin", "admin123")
        r = admin_client.put(f"/api/users/{user_id}", json={
            "role": "operator",
            "department": "东莞车间",
        })
        assert r.status_code == 200

    r = client.get("/api/me")
    assert r.status_code == 200
    assert r.json()["department"] == "东莞车间"


def test_operator_cannot_update_other_user(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op_no_update", "password": "pw123456",
        "role": "operator", "department": DEFAULT_DEPARTMENT})
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "op_no_update")
    client.post("/api/logout")
    login(client, "op_no_update", "pw123456")

    r = client.put(f"/api/users/{user_id}", json={
        "role": "operator",
        "department": "东莞车间",
    })

    assert r.status_code == 403


def test_logout(client):
    login(client, "admin", "admin123")
    client.post("/api/logout")
    r = client.get("/api/me")
    assert r.status_code == 401
