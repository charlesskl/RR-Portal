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
    assert names == ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴", "新邵"]
    admin = conn.execute("SELECT role FROM users WHERE username='admin'").fetchone()
    assert admin["role"] == "admin"
    user_columns = [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    record_columns = [r["name"] for r in conn.execute("PRAGMA table_info(records)").fetchall()]
    supplier_columns = [r["name"] for r in conn.execute("PRAGMA table_info(suppliers)").fetchall()]
    assert "department" in user_columns
    assert "department" in record_columns
    assert "supplier" in record_columns
    assert "po_no" in record_columns
    assert "customer_name" in record_columns
    assert supplier_columns == ["id", "name", "created_at"]
    mats = conn.execute("SELECT name FROM materials ORDER BY id").fetchall()
    assert [r["name"] for r in mats] == ["NFC贴纸", "PCBA板"]
    conn.close()


def test_init_creates_department_accounts(db_path):
    from pcba import db
    from pcba.auth import verify_password

    db.init_db()
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT username, role, department, password_hash FROM users ORDER BY id"
    ).fetchall()
    users = {row["username"]: dict(row) for row in rows}
    conn.close()

    for department in db.DEPARTMENTS:
        assert department in users
        assert users[department]["role"] == "operator"
        assert users[department]["department"] == department
        assert verify_password("123456", users[department]["password_hash"])


def test_init_is_idempotent(db_path):
    from pcba import db
    db.init_db()
    db.init_db()  # 再次调用不应报错或重复插入
    conn = db.get_conn()
    count = conn.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"]
    assert count == 5
    conn.close()


def test_init_migrates_existing_records_to_default_department(db_path):
    import sqlite3
    conn = sqlite3.connect(db_path)
    conn.executescript("""
    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        sort INTEGER NOT NULL
    );
    CREATE TABLE materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rec_type TEXT NOT NULL,
        location_id INTEGER,
        rec_date TEXT,
        doc_no TEXT,
        material TEXT NOT NULL DEFAULT '77794-PCBA板',
        qty INTEGER NOT NULL,
        remark TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO records(rec_type, qty) VALUES ('inbound_raw', 10);
    """)
    conn.commit()
    conn.close()

    from pcba import db
    db.init_db()
    conn = db.get_conn()
    row = conn.execute("SELECT department FROM records").fetchone()
    assert row["department"] == "兴信B来料仓"
    names = [r["name"] for r in conn.execute("SELECT name FROM locations ORDER BY sort").fetchall()]
    assert names == ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴", "新邵"]
    record_columns = [r["name"] for r in conn.execute("PRAGMA table_info(records)").fetchall()]
    assert "supplier" in record_columns
    assert "po_no" in record_columns
    assert "customer_name" in record_columns
    conn.close()
