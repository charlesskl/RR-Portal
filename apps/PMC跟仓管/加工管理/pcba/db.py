import os
import sqlite3

from pcba.auth import hash_password

DEFAULT_DB = os.path.join("data", "pcba.db")
LOCATIONS = ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴", "新邵"]
DEFAULT_MATERIALS = ["NFC贴纸", "PCBA板"]
DEFAULT_STICKER_TYPES = [f"贴纸{i:02d}" for i in range(1, 41)]
DEPARTMENTS = ["兴信B来料仓", "装配", "半成品", "外发", "河源华兴", "邵阳", "新邵"]
DEFAULT_DEPARTMENT = DEPARTMENTS[0]
DEFAULT_DEPARTMENT_PASSWORD = "123456"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sticker_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rec_type TEXT NOT NULL,
    location_id INTEGER,
    rec_date TEXT,
    doc_no TEXT,
    material TEXT NOT NULL DEFAULT 'PCBA板',
    sticker_type TEXT,
    qty INTEGER NOT NULL,
    remark TEXT,
    department TEXT NOT NULL DEFAULT '兴信B来料仓',
    supplier TEXT,
    po_no TEXT,
    customer_name TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (location_id) REFERENCES locations(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);
"""


def db_path():
    return os.environ.get("PCBA_DB", DEFAULT_DB)


def get_conn():
    path = db_path()
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _column_exists(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row["name"] == column for row in rows)


def _migrate_schema(conn):
    if not _column_exists(conn, "users", "department"):
        conn.execute("ALTER TABLE users ADD COLUMN department TEXT")
    conn.execute(
        "UPDATE users SET department=? WHERE department IS NULL AND role != 'admin'",
        (DEFAULT_DEPARTMENT,),
    )
    if not _column_exists(conn, "records", "department"):
        conn.execute(
            "ALTER TABLE records ADD COLUMN department TEXT NOT NULL DEFAULT '兴信B来料仓'"
        )
    if not _column_exists(conn, "records", "supplier"):
        conn.execute("ALTER TABLE records ADD COLUMN supplier TEXT")
    if not _column_exists(conn, "records", "sticker_type"):
        conn.execute("ALTER TABLE records ADD COLUMN sticker_type TEXT")
    if not _column_exists(conn, "records", "po_no"):
        conn.execute("ALTER TABLE records ADD COLUMN po_no TEXT")
    if not _column_exists(conn, "records", "customer_name"):
        conn.execute("ALTER TABLE records ADD COLUMN customer_name TEXT")


def init_db():
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
        _migrate_schema(conn)
        # 预置加工点
        for i, name in enumerate(LOCATIONS, start=1):
            conn.execute(
                "INSERT OR IGNORE INTO locations(name, sort) VALUES (?, ?)",
                (name, i),
            )
        # 预置默认物料名称
        for name in DEFAULT_MATERIALS:
            conn.execute(
                "INSERT OR IGNORE INTO materials(name) VALUES (?)", (name,)
            )
        # 预置 NFC 贴纸类型，可在前端继续维护真实名称
        for i, name in enumerate(DEFAULT_STICKER_TYPES, start=1):
            conn.execute(
                "INSERT OR IGNORE INTO sticker_types(name, sort) VALUES (?, ?)",
                (name, i),
            )
        # 预置默认管理员 admin/admin123
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username='admin'"
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO users(username, password_hash, role) VALUES (?,?,?)",
                ("admin", hash_password("admin123"), "admin"),
            )
        for department in DEPARTMENTS:
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username=?", (department,)
            ).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO users(username, password_hash, role, department) "
                    "VALUES (?,?,?,?)",
                    (
                        department,
                        hash_password(DEFAULT_DEPARTMENT_PASSWORD),
                        "operator",
                        department,
                    ),
                )
        conn.commit()
    finally:
        conn.close()
