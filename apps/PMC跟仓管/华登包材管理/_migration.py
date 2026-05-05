"""V1 → V2 schema migration logic for huadeng.

调用方:
- app.py init_db()         — 容器启动时 auto-migrate
- scripts/migrate_to_v2.py — 独立 CLI（不需要起 Flask）

特性:
- Idempotent: 已迁移 / 全新 DB 都会跳过
- Atomic-ish: 备份 → 单连接 commit；失败时备份保命
- 与 app.py init_db 的 v2 schema 完全对齐（monthly_inventory 不含 counterparty）
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

# v1 records.channel → (from_party, to_party)
CHANNEL_MAP = {
    1: ('hd', 'sy'), 2: ('sy', 'hd'),
    3: ('hd', 'xx'), 4: ('xx', 'hd'),
    5: ('sy', 'xx'), 6: ('xx', 'sy'),
}

QTY_COLS = [
    'jx_qty', 'gx_qty', 'zx_qty', 'jkb_qty', 'mkb_qty', 'xb_qty',
    'dz_qty', 'wb_qty', 'pk_qty', 'xzx_qty', 'dgb_qty', 'xjp_qty',
    'dk_qty', 'xs_qty', 'gsb_qty', 'djx_qty', 'zb_qty',
]


def _table_exists(con, name):
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def needs_v1_to_v2_migration(db_path):
    """True when DB 还有 v1 `records` 表（=未迁移）。新 DB / 已迁移 DB 都返回 False。"""
    if not os.path.isfile(db_path):
        return False
    con = sqlite3.connect(db_path)
    try:
        return _table_exists(con, 'records')
    finally:
        con.close()


def run_v1_to_v2_migration(db_path, log=print):
    """V1 schema → V2 迁移（含备份）。

    幂等：
    - 检测到 records 已 drop 且 flow_records 存在 → 跳过
    - 检测不到 records → 全新 DB，跳过

    Args:
        db_path: SQLite DB 文件路径
        log:     可调用的日志函数（默认 print；app.py 传 logger.info）

    Returns:
        bool: True 实际跑了迁移，False 跳过
    """
    con_check = sqlite3.connect(db_path)
    try:
        has_records = _table_exists(con_check, 'records')
        has_flow = _table_exists(con_check, 'flow_records')
    finally:
        con_check.close()

    if not has_records:
        # 全新 DB 或已完成迁移
        return False

    if has_records and has_flow:
        # 罕见：v1 表还在但 flow_records 也在 — 视为半完成，重跑安全（_create_v2_tables 会 drop+recreate）
        log('[migration] WARNING: both v1 records and v2 flow_records exist — re-running migration')

    # 1. 备份
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = f'{db_path}.bak-{ts}'
    shutil.copy2(db_path, bak)
    log(f'[migration] backup: {bak}')

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        # 2. 建 v2 表
        _create_v2_tables(con)

        # 3. records → flow_records
        n_records = _migrate_records(con)
        log(f'[migration] flow_records 迁入 {n_records} 条')

        # 4. investment_records v1 → v2
        n_inv = _migrate_investment(con)
        log(f'[migration] investment_records 迁入 {n_inv} 条')

        # 5. drop legacy 表（若有）
        for t in ['records', 'investment_records_v1', 'reconciliations_v1', 'reconciliation_items']:
            con.execute(f'DROP TABLE IF EXISTS {t}')

        con.commit()
        log('[migration] v1 → v2 完成')
        return True
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _create_v2_tables(con):
    """建 v2 schema。flow_records / reconciliations / monthly_inventory 均 drop+recreate。

    monthly_inventory 与 app.py init_db() 完全对齐（无 counterparty 列）。
    """
    con.execute('DROP TABLE IF EXISTS flow_records')
    con.execute('DROP TABLE IF EXISTS reconciliations')
    con.execute('DROP TABLE IF EXISTS monthly_inventory')

    con.executescript("""
    CREATE TABLE flow_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        from_party  TEXT NOT NULL,
        to_party    TEXT NOT NULL,
        date        TEXT NOT NULL,
        order_no    TEXT,
        remark      TEXT,
        jx_qty REAL DEFAULT 0, gx_qty REAL DEFAULT 0, zx_qty REAL DEFAULT 0,
        jkb_qty REAL DEFAULT 0, mkb_qty REAL DEFAULT 0, xb_qty REAL DEFAULT 0,
        dz_qty REAL DEFAULT 0, wb_qty REAL DEFAULT 0, pk_qty REAL DEFAULT 0,
        xzx_qty REAL DEFAULT 0, dgb_qty REAL DEFAULT 0, xjp_qty REAL DEFAULT 0,
        dk_qty REAL DEFAULT 0,
        xs_qty REAL DEFAULT 0, gsb_qty REAL DEFAULT 0,
        djx_qty REAL DEFAULT 0, zb_qty REAL DEFAULT 0,
        reconciliation_id INTEGER,
        locked INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_flow_recorded_by ON flow_records(recorded_by, from_party, to_party);
    CREATE INDEX IF NOT EXISTS idx_flow_pair_date ON flow_records(from_party, to_party, date);

    CREATE TABLE reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        initiator_party TEXT NOT NULL,
        approver_party  TEXT NOT NULL,
        pair_low TEXT NOT NULL, pair_high TEXT NOT NULL,
        date_from TEXT NOT NULL, date_to TEXT NOT NULL,
        status TEXT NOT NULL,
        snapshot_json TEXT, notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP
    );

    -- 与 app.py init_db() 对齐：v2 monthly_inventory 是按 party-month 一行，
    -- 不分对方/方向（旧 schema 的 counterparty 字段在 v2 已废弃）
    CREATE TABLE monthly_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL, jkb_qty REAL, jx_qty REAL, gx_qty REAL,
        remark TEXT,
        UNIQUE (recorded_by, year_month)
    );
    """)


def _migrate_records(con):
    """records → flow_records。只搬 status IN ('legacy','confirmed') 的记录。"""
    if not _table_exists(con, 'records'):
        return 0
    rows = con.execute(
        "SELECT * FROM records WHERE status IN ('legacy', 'confirmed')"
    ).fetchall()
    qty_cols_str = ', '.join(QTY_COLS)
    qty_placeholders = ', '.join(['?'] * len(QTY_COLS))
    ct = 0
    for r in rows:
        from_p, to_p = CHANNEL_MAP.get(r['channel'], (None, None))
        if from_p is None:
            print(f'[WARN] skip records.id={r["id"]} unknown channel={r["channel"]}', file=sys.stderr)
            continue
        recorded_by = r['source_party'] if r['source_party'] else from_p
        con.execute(f"""
            INSERT INTO flow_records (
                recorded_by, from_party, to_party, date, order_no, remark,
                {qty_cols_str},
                locked, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, {qty_placeholders}, 1, ?)
        """, [
            recorded_by, from_p, to_p, r['date'], r['order_no'], r['remark'],
            *[r[c] or 0 for c in QTY_COLS],
            r['created_at'],
        ])
        ct += 1
    return ct


def _migrate_investment(con):
    """investment_records v1 (channel) → v2 (recorded_by, counterparty)。

    只在表存在且为 v1 schema (有 `channel` 列) 时迁移。
    """
    if not _table_exists(con, 'investment_records'):
        return 0
    cols = {r[1] for r in con.execute("PRAGMA table_info(investment_records)").fetchall()}
    if 'channel' not in cols:
        return 0  # 已是 v2 schema 或刚建出来的空 v2

    con.execute('ALTER TABLE investment_records RENAME TO investment_records_v1')
    con.execute("""
        CREATE TABLE investment_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_by TEXT NOT NULL,
            counterparty TEXT NOT NULL,
            year_month TEXT NOT NULL,
            mkb_qty REAL DEFAULT 0, jkb_qty REAL DEFAULT 0,
            jx_qty REAL DEFAULT 0,  gx_qty REAL DEFAULT 0,
            remark TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    rows = con.execute("SELECT * FROM investment_records_v1").fetchall()
    ct = 0
    for r in rows:
        from_p, to_p = CHANNEL_MAP.get(r['channel'], (None, None))
        if from_p is None:
            print(f'[WARN] skip investment_records.id={r["id"]} unknown channel={r["channel"]}', file=sys.stderr)
            continue
        con.execute("""
            INSERT INTO investment_records (
                recorded_by, counterparty, year_month,
                mkb_qty, jkb_qty, jx_qty, gx_qty, remark, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (from_p, to_p, r['year_month'],
              r['mkb_qty'] or 0, r['jkb_qty'] or 0, r['jx_qty'] or 0, r['gx_qty'] or 0,
              r['remark'], r['created_at']))
        ct += 1
    con.execute('DROP TABLE investment_records_v1')
    return ct
