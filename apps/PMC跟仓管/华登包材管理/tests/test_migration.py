"""测试迁移脚本：旧 records 表 → 新 flow_records。"""
import os
import sqlite3
import subprocess
import sys
import pytest


@pytest.fixture
def old_db(tmp_data_dir):
    """构造旧 schema + 样本数据。"""
    db_path = os.path.join(tmp_data_dir, 'huadeng.db')
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("""
    CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel INTEGER NOT NULL,
        date TEXT, order_no TEXT, remark TEXT,
        jx_qty REAL DEFAULT 0, gx_qty REAL DEFAULT 0, zx_qty REAL DEFAULT 0,
        jkb_qty REAL DEFAULT 0, mkb_qty REAL DEFAULT 0, xb_qty REAL DEFAULT 0,
        dz_qty REAL DEFAULT 0, wb_qty REAL DEFAULT 0, pk_qty REAL DEFAULT 0,
        xzx_qty REAL DEFAULT 0, dgb_qty REAL DEFAULT 0, xjp_qty REAL DEFAULT 0,
        dk_qty REAL DEFAULT 0,
        xs_qty REAL DEFAULT 0, gsb_qty REAL DEFAULT 0,
        djx_qty REAL DEFAULT 0, zb_qty REAL DEFAULT 0,
        status TEXT, source_party TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    # 样本：ch1 legacy, ch3 confirmed, ch2 draft (将被丢弃)
    cur.executemany("""
        INSERT INTO records (channel, date, order_no, jx_qty, status, source_party)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [
        (1, '2026-01-01', 'A1', 10, 'legacy', None),
        (1, '2026-01-02', 'A2', 20, 'confirmed', 'hd'),
        (3, '2026-02-01', 'B1', 5,  'legacy', None),
        (2, '2026-03-01', 'C1', 99, 'draft', 'hd'),  # 应被丢弃
        (2, '2026-03-02', 'C2', 88, 'pending_approval', 'hd'),  # 应被丢弃
    ])
    # 旧 investment_records（channel-based）
    cur.execute("""
    CREATE TABLE investment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel INTEGER, year_month TEXT,
        mkb_qty REAL, jkb_qty REAL, jx_qty REAL, gx_qty REAL,
        remark TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    cur.execute("""INSERT INTO investment_records (channel, year_month, mkb_qty) VALUES (1, '2026-01', 5)""")
    cur.execute("""
    CREATE TABLE default_prices (item_key TEXT PRIMARY KEY, price REAL)""")
    cur.execute("INSERT INTO default_prices VALUES ('jx', 1.5)")
    con.commit()
    con.close()
    return db_path


def test_migration_maps_records(old_db):
    """迁移后 flow_records 仅包含 legacy/confirmed 的记录，字段正确映射。"""
    result = subprocess.run(
        [sys.executable, 'scripts/migrate_to_v2.py', old_db],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr

    con = sqlite3.connect(old_db)
    rows = con.execute("""
        SELECT recorded_by, from_party, to_party, order_no, jx_qty, locked
        FROM flow_records ORDER BY order_no
    """).fetchall()
    assert rows == [
        ('hd', 'hd', 'sy', 'A1', 10, 1),  # ch1 legacy: source null → sender=hd; locked=1
        ('hd', 'hd', 'sy', 'A2', 20, 1),  # ch1 confirmed
        ('hd', 'hd', 'xx', 'B1', 5,  1),  # ch3 legacy
    ]
    con.close()


def test_migration_drops_drafts(old_db):
    subprocess.run([sys.executable, 'scripts/migrate_to_v2.py', old_db], check=True)
    con = sqlite3.connect(old_db)
    draft_ct = con.execute(
        "SELECT COUNT(*) FROM flow_records WHERE order_no IN ('C1','C2')"
    ).fetchone()[0]
    assert draft_ct == 0
    con.close()


def test_migration_preserves_investment(old_db):
    subprocess.run([sys.executable, 'scripts/migrate_to_v2.py', old_db], check=True)
    con = sqlite3.connect(old_db)
    rows = con.execute(
        "SELECT recorded_by, counterparty, year_month, mkb_qty FROM investment_records"
    ).fetchall()
    assert rows == [('hd', 'sy', '2026-01', 5)]
    con.close()


def test_migration_preserves_prices(old_db):
    subprocess.run([sys.executable, 'scripts/migrate_to_v2.py', old_db], check=True)
    con = sqlite3.connect(old_db)
    row = con.execute("SELECT item_key, price FROM default_prices").fetchone()
    assert row == ('jx', 1.5)
    con.close()


def test_migration_creates_backup(old_db):
    subprocess.run([sys.executable, 'scripts/migrate_to_v2.py', old_db], check=True)
    # 备份文件名 huadeng.db.bak-YYYYMMDD-HHMMSS
    dir_, fname = os.path.split(old_db)
    backups = [f for f in os.listdir(dir_) if f.startswith(fname + '.bak-')]
    assert len(backups) == 1


def test_migration_drops_old_tables(old_db):
    subprocess.run([sys.executable, 'scripts/migrate_to_v2.py', old_db], check=True)
    con = sqlite3.connect(old_db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'records' not in tables  # 旧表应 drop
    assert 'flow_records' in tables
    con.close()
