import os
import sqlite3

from pcba.auth import hash_password

DEFAULT_DB = os.path.join("data", "pcba.db")
LOCATIONS = ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴"]
DEFAULT_MATERIALS = ["77794-PCBA板"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rec_type TEXT NOT NULL,
    location_id INTEGER,
    rec_date TEXT,
    doc_no TEXT,
    material TEXT NOT NULL DEFAULT '77794-PCBA板',
    qty INTEGER NOT NULL,
    remark TEXT,
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
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # 多线程/多请求并发下减少 "database is locked"：WAL + 忙等重试
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db():
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
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
        # 预置默认管理员 admin/admin123
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username='admin'"
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO users(username, password_hash, role) VALUES (?,?,?)",
                ("admin", hash_password("admin123"), "admin"),
            )
        conn.commit()
    finally:
        conn.close()
