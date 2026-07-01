import os
import tempfile
import pytest


@pytest.fixture()
def db_path(monkeypatch):
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    monkeypatch.setenv("PCBA_DB", path)
    yield path
    os.unlink(path)


def test_init_creates_locations_and_admin(db_path):
    from pcba import db
    db.init_db()
    conn = db.get_conn()
    locs = conn.execute("SELECT name FROM locations ORDER BY sort").fetchall()
    names = [r["name"] for r in locs]
    assert names == ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴"]
    admin = conn.execute("SELECT role FROM users WHERE username='admin'").fetchone()
    assert admin["role"] == "admin"
    conn.close()


def test_init_is_idempotent(db_path):
    from pcba import db
    db.init_db()
    db.init_db()  # 再次调用不应报错或重复插入
    conn = db.get_conn()
    count = conn.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"]
    assert count == 4
    conn.close()
