import io
import openpyxl


def admin_login(client):
    client.post("/api/login", json={"username": "admin", "password": "admin123"})


def loc_id(client, name):
    locs = client.get("/api/locations").json()
    return next(l["id"] for l in locs if l["name"] == name)


def test_export_returns_xlsx_with_summary(client):
    admin_login(client)
    sy = loc_id(client, "邵阳华登")
    client.post("/api/records", json={"rec_type": "inbound_raw", "qty": 1000000})
    client.post("/api/records", json={
        "rec_type": "issue", "location_id": sy, "qty": 1690242})
    client.post("/api/records", json={
        "rec_type": "finished", "location_id": sy, "qty": 928113})

    r = client.get("/api/export")
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]

    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)
    assert "总表" in wb.sheetnames
    ws = wb["总表"]
    # 找到邵阳华登行，校验应存数 = 762129
    found = False
    for row in ws.iter_rows(values_only=True):
        if row and row[0] == "邵阳华登":
            assert row[3] == 762129
            found = True
    assert found
