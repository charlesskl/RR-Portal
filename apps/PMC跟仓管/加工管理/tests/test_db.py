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
    assert [r["name"] for r in mats] == ["NFC贴纸", "77794-PCBA板"]
    sticker_types = conn.execute(
        "SELECT name FROM sticker_types ORDER BY sort"
    ).fetchall()
    assert len(sticker_types) == 45
    assert sticker_types[0]["name"] == "1#NFC贴纸"
    assert sticker_types[-1]["name"] == "45#NFC贴纸"
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


def test_init_migrates_renamed_department_accounts_and_records(db_path):
    from pcba import db

    db.init_db()
    conn = db.get_conn()
    conn.execute(
        "DELETE FROM users WHERE username IN ('东莞车间', '东莞加工厂利鸿', '半成品', '碟片半成品')"
    )
    conn.execute(
        "INSERT INTO users(username, password_hash, role, department) VALUES (?,?,?,?)",
        ("装配", "assembly-hash", "operator", "装配"),
    )
    conn.execute(
        "INSERT INTO users(username, password_hash, role, department) VALUES (?,?,?,?)",
        ("外发", "outsource-hash", "operator", "外发"),
    )
    conn.execute(
        "INSERT INTO users(username, password_hash, role, department) VALUES (?,?,?,?)",
        ("半成品", "semi-finished-hash", "operator", "半成品"),
    )
    conn.execute(
        "INSERT INTO records(rec_type, material, qty, department) VALUES (?,?,?,?)",
        ("issue", "NFC贴纸", 10, "装配"),
    )
    conn.execute(
        "INSERT INTO records(rec_type, material, qty, department) VALUES (?,?,?,?)",
        ("issue", "77794-PCBA板", 20, "外发"),
    )
    conn.execute(
        "INSERT INTO records(rec_type, material, qty, department) VALUES (?,?,?,?)",
        ("semi_inbound", "77794-PCBA板", 30, "半成品"),
    )
    conn.execute(
        "INSERT INTO semi_finished_monthly_totals(department, material, sticker_type) "
        "VALUES (?,?,?)",
        ("装配", "NFC贴纸", "1#NFC贴纸"),
    )
    conn.execute(
        "INSERT INTO semi_finished_monthly_totals(department, material, sticker_type) "
        "VALUES (?,?,?)",
        ("半成品", "77794-PCBA板", ""),
    )
    conn.commit()
    conn.close()

    db.init_db()
    conn = db.get_conn()
    users = {
        row["username"]: dict(row)
        for row in conn.execute(
            "SELECT username, department, password_hash FROM users"
        ).fetchall()
    }
    record_departments = [
        row["department"]
        for row in conn.execute("SELECT department FROM records ORDER BY qty").fetchall()
    ]
    monthly_department = conn.execute(
        "SELECT department FROM semi_finished_monthly_totals WHERE material='NFC贴纸'"
    ).fetchone()["department"]
    old_users = conn.execute(
        "SELECT COUNT(*) AS c FROM users WHERE username IN ('装配', '外发', '半成品')"
    ).fetchone()["c"]
    conn.close()

    assert old_users == 0
    assert users["东莞车间"]["department"] == "东莞车间"
    assert users["东莞车间"]["password_hash"] == "assembly-hash"
    assert users["东莞加工厂利鸿"]["department"] == "东莞加工厂利鸿"
    assert users["东莞加工厂利鸿"]["password_hash"] == "outsource-hash"
    assert users["碟片半成品"]["department"] == "碟片半成品"
    assert users["碟片半成品"]["password_hash"] == "semi-finished-hash"
    assert record_departments == ["东莞车间", "东莞加工厂利鸿", "碟片半成品"]
    assert monthly_department == "东莞车间"


def test_init_is_idempotent(db_path):
    from pcba import db
    db.init_db()
    db.init_db()  # 再次调用不应报错或重复插入
    conn = db.get_conn()
    count = conn.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"]
    assert count == 5
    conn.close()


def test_init_migrates_legacy_pcba_material_name(db_path):
    from pcba import db

    db.init_db()
    conn = db.get_conn()
    conn.execute("INSERT INTO materials(name) VALUES ('PCBA板')")
    conn.execute(
        "INSERT INTO records(rec_type, material, qty, department) "
        "VALUES ('inbound_raw', 'PCBA板', 10, '兴信B来料仓')"
    )
    conn.execute(
        "INSERT INTO semi_finished_monthly_totals(department, material, sticker_type, opening_stock) "
        "VALUES ('碟片半成品', 'PCBA板', '', 20)"
    )
    conn.commit()
    conn.close()

    db.init_db()
    conn = db.get_conn()
    materials = [r["name"] for r in conn.execute("SELECT name FROM materials").fetchall()]
    record = conn.execute("SELECT material FROM records").fetchone()
    monthly = conn.execute("SELECT material FROM semi_finished_monthly_totals").fetchone()
    assert "PCBA板" not in materials
    assert "77794-PCBA板" in materials
    assert record["material"] == "77794-PCBA板"
    assert monthly["material"] == "77794-PCBA板"
    conn.close()


def test_init_migrates_legacy_sticker_type_names(db_path):
    from pcba import db

    db.init_db()
    conn = db.get_conn()
    conn.execute("UPDATE sticker_types SET name='贴纸01' WHERE sort=1")
    conn.execute(
        "INSERT INTO records(rec_type, material, sticker_type, qty, department) "
        "VALUES ('inbound_raw', 'NFC贴纸', '贴纸01', 10, '兴信B来料仓')"
    )
    conn.commit()
    conn.close()

    db.init_db()
    conn = db.get_conn()
    sticker_types = conn.execute(
        "SELECT name FROM sticker_types ORDER BY sort"
    ).fetchall()
    record = conn.execute("SELECT sticker_type FROM records").fetchone()
    assert len(sticker_types) == 45
    assert sticker_types[0]["name"] == "1#NFC贴纸"
    assert sticker_types[-1]["name"] == "45#NFC贴纸"
    assert record["sticker_type"] == "1#NFC贴纸"
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
    INSERT INTO users(username, password_hash, role)
    VALUES ('legacy_operator', 'legacy-hash', 'operator');
    INSERT INTO users(username, password_hash, role) VALUES ('legacy_admin', 'legacy-hash', 'admin');
    """)
    conn.commit()
    conn.close()

    from pcba import db
    db.init_db()
    conn = db.get_conn()
    row = conn.execute("SELECT department FROM records").fetchone()
    assert row["department"] == "兴信B来料仓"
    legacy_operator = conn.execute(
        "SELECT department FROM users WHERE username='legacy_operator'"
    ).fetchone()
    legacy_admin = conn.execute("SELECT department FROM users WHERE username='legacy_admin'").fetchone()
    assert legacy_operator["department"] == "兴信B来料仓"
    assert legacy_admin["department"] is None
    names = [r["name"] for r in conn.execute("SELECT name FROM locations ORDER BY sort").fetchall()]
    assert names == ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴", "新邵"]
    record_columns = [r["name"] for r in conn.execute("PRAGMA table_info(records)").fetchall()]
    assert "supplier" in record_columns
    assert "po_no" in record_columns
    assert "customer_name" in record_columns
    conn.close()

