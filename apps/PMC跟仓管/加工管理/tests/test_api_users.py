def login(client, username, password):
    return client.post("/api/login", json={"username": username, "password": password})


def test_login_success(client):
    r = login(client, "admin", "admin123")
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


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


def test_admin_can_create_operator(client):
    login(client, "admin", "admin123")
    r = client.post("/api/users", json={
        "username": "op1", "password": "pw123456", "role": "operator"})
    assert r.status_code == 200
    # 新用户能登录
    c2 = login(client, "op1", "pw123456")
    assert c2.status_code == 200
    assert c2.json()["role"] == "operator"


def test_operator_cannot_create_user(client):
    login(client, "admin", "admin123")
    client.post("/api/users", json={
        "username": "op2", "password": "pw123456", "role": "operator"})
    client.post("/api/logout")
    login(client, "op2", "pw123456")
    r = client.post("/api/users", json={
        "username": "op3", "password": "pw123456", "role": "operator"})
    assert r.status_code == 403


def test_logout(client):
    login(client, "admin", "admin123")
    client.post("/api/logout")
    r = client.get("/api/me")
    assert r.status_code == 401
