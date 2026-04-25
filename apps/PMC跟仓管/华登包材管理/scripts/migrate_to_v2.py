"""一次性迁移脚本：旧 schema → v2 schema。

用法: python scripts/migrate_to_v2.py <path/to/huadeng.db>

⚠️ 运行前停掉 Flask 服务，避免：
  1) shutil.copy2 拷不到 -wal/-shm 变更（如果是 WAL 模式）
  2) 并发写入导致 schema 不一致

流程:
1. cp huadeng.db huadeng.db.bak-YYYYMMDD-HHMMSS
2. 建 v2 表 (flow_records, reconciliations, investment_records[v2], monthly_inventory)
3. INSERT INTO flow_records SELECT ... FROM records WHERE status IN ('legacy','confirmed')
4. INSERT INTO investment_records[v2] SELECT ... FROM investment_records[v1]
5. drop 旧表
6. 打印统计 + 断言

draft / pending_approval 记录全部丢弃（用户用 Excel 重新导入）。
"""
import shutil
import sqlite3
import sys
from datetime import datetime

# channel id → (from_party, to_party)
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


def migrate(db_path):
    # Guard: detect already-migrated DB (no legacy records table + has v2 flow_records)
    con_check = sqlite3.connect(db_path)
    try:
        has_records = _table_exists(con_check, 'records')
        has_flow = _table_exists(con_check, 'flow_records')
    finally:
        con_check.close()
    if not has_records and has_flow:
        print('[ABORT] already migrated — flow_records exists and records is gone. '
              'Restore from backup if you need to re-run.', file=sys.stderr)
        sys.exit(2)

    # 1. 备份
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = f'{db_path}.bak-{ts}'
    shutil.copy2(db_path, bak)
    print(f'[OK] 备份: {bak}')

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    # 2. 建 v2 表
    _create_v2_tables(con)
    print('[OK] v2 表已建')

    # 3. 迁 records → flow_records
    migrated = _migrate_records(con)
    print(f'[OK] flow_records 迁入 {migrated} 条')

    # 4. 迁 investment_records
    inv_migrated = _migrate_investment(con)
    print(f'[OK] investment_records 迁入 {inv_migrated} 条')

    # 5. drop 旧表（如果存在）
    # investment_records_v1 已在 _migrate_investment 里 rename+drop 过，
    # 列在这里只是防御：万一 _migrate_investment 中途失败留下 _v1 残留。
    for t in ['records', 'investment_records_v1', 'reconciliations_v1', 'reconciliation_items']:
        con.execute(f'DROP TABLE IF EXISTS {t}')
    print('[OK] 旧表已 drop')

    con.commit()
    con.close()
    print('[OK] 迁移完成')


def _create_v2_tables(con):
    # 偏保守：drop 任何可能残留的 v1 reconciliations / monthly_inventory，再以 v2 schema 重建。
    # flow_records 是 v2 新表，drop 也安全（如果残留必是部分迁移，重跑应清空）。
    # NOT dropping investment_records here — _migrate_investment rename 之后处理。
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

    CREATE TABLE monthly_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL, jkb_qty REAL, jx_qty REAL, gx_qty REAL,
        UNIQUE (recorded_by, counterparty, year_month)
    );
    """)


def _migrate_records(con):
    """records → flow_records。只要 legacy/confirmed。"""
    if not _table_exists(con, 'records'):
        return 0
    rows = con.execute("""
        SELECT * FROM records WHERE status IN ('legacy', 'confirmed')
    """).fetchall()
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
    """旧 investment_records(channel,...) → 新 investment_records(recorded_by, counterparty,...)。"""
    if not _table_exists(con, 'investment_records'):
        return 0
    # 先 rename 旧表
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


def _table_exists(con, name):
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python migrate_to_v2.py <db_path>', file=sys.stderr)
        sys.exit(1)
    migrate(sys.argv[1])
