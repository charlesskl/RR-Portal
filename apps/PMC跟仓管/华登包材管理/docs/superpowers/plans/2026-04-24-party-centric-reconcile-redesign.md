# 华登包材 Party-Centric 重构 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将华登包材系统从 section-based 架构重构为 party-based（每 party 看 2 对方 × 2 方向 = 4 张流水表），核对改为"按日期范围汇总比数量"，丢弃 feat/huadeng-reconcile 的 Scheme B 实现，从 main 起新分支重做。

**Architecture:** 单 app.py + Jinja 模板 + SQLite。flow_records 表统一承载所有发/收记录（recorded_by + from_party + to_party），reconciliations 表落库汇总快照 + 批次状态。核对流程为：发起方选范围 → 预览差异 → 确认发起 → 对方审批（同意/打回/撤回）→ 通过则 records locked=1。

**Tech Stack:** Python 3.12, Flask, SQLite, Tailwind CDN, pytest, openpyxl（Excel 导入）

**前置文档：** `docs/superpowers/specs/2026-04-24-party-centric-reconcile-redesign.md`

---

## 文件结构总览

### 将创建 / 重写的文件

| 文件 | 责任 |
|------|------|
| `app.py` | 从 main 起的 1244 行基础上重构，保留 items/prices/helpers，改写所有 section-based 代码为 party-based |
| `templates/base.html` | 保留（顶部 nav 需要小改：指向 /party 而非 /section） |
| `templates/index.html` | 重写：3 party 卡片 |
| `templates/party_login.html` | 新建（取代 section_login.html） |
| `templates/party.html` | 新建（取代 section.html）：2 对方区 × 2 tab |
| `templates/reports.html` | 保留 UI 骨架，数据源切换到 flow_records |
| `templates/reconcile_list.html` | 新建：核对中心列表 |
| `templates/reconcile_detail.html` | 新建：核对详情 + 审批按钮 |
| `templates/import_preview.html` | 重写：上传 → 选 sheet + 选方向 |
| `scripts/migrate_to_v2.py` | 新建：旧 records → flow_records 一次性迁移 |
| `tests/conftest.py` | 保留 |
| `tests/test_*.py` | 除 `test_smoke.py` 外全部重写 |

### 将删除的文件

`templates/section.html`, `templates/section_login.html`（被 party 版本取代）

---

## Phase 0: 分支与骨架

### Task 1: 新建分支 + 落地 spec

**Files:**
- Modify: git 分支 (branch switch)
- Create: `docs/superpowers/specs/2026-04-24-party-centric-reconcile-redesign.md` (已存在，commit)
- Create: `docs/superpowers/plans/2026-04-24-party-centric-reconcile-redesign.md` (本文件，commit)

- [ ] **Step 1: 切到 main 并建新分支**

```bash
cd apps/PMC跟仓管/华登包材管理
# 保证 spec 和 plan 文件不丢（untracked 会跟着分支走）
git checkout main
git checkout -b feat/huadeng-party-v2
git status  # 应该看到 spec + plan 都还在
```

- [ ] **Step 2: commit spec + plan**

```bash
git add docs/superpowers/specs/2026-04-24-party-centric-reconcile-redesign.md
git add docs/superpowers/plans/2026-04-24-party-centric-reconcile-redesign.md
git commit -m "docs(huadeng): add party-centric redesign spec + plan"
```

- [ ] **Step 3: 确认 pytest 基础可用**

```bash
pytest tests/test_smoke.py -v
```

Expected: test_smoke 通过（如果没有则从 main 起就断的，不是我们的问题）。

- [ ] **Step 4: 删除 Scheme B 相关的旧测试文件（保留 test_smoke.py 和 conftest.py）**

```bash
rm tests/test_auth.py tests/test_data_entry.py tests/test_migration.py \
   tests/test_party_model.py tests/test_permissions.py tests/test_reconcile.py \
   tests/test_record_perms.py
git add -A tests/
git commit -m "chore(huadeng): clear old tests for v2 rewrite"
```

（注意：这些测试文件是 main 分支上**没有**的，这里 rm 的是之前误存到 working dir 或从 feat/huadeng-reconcile 带过来的。如果 main 上没有就跳过这步。）

---

## Phase 1: 数据库 Schema + 迁移

### Task 2: 建新 schema（flow_records + reconciliations + 相关表）

**Files:**
- Modify: `app.py` (init_db 函数)
- Create: `tests/test_schema.py`

- [ ] **Step 1: 写测试验证新表创建**

`tests/test_schema.py`:
```python
"""验证新 schema 的所有表和字段正确创建。"""
import sqlite3


def test_flow_records_schema(client):
    """flow_records 表应包含所有必要字段。"""
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(flow_records)")}
    expected = {
        'id', 'recorded_by', 'from_party', 'to_party', 'date', 'order_no',
        'remark', 'reconciliation_id', 'locked', 'created_at', 'updated_at',
        'jx_qty', 'gx_qty', 'zx_qty', 'jkb_qty', 'mkb_qty', 'xb_qty',
        'dz_qty', 'wb_qty', 'pk_qty', 'xzx_qty', 'dgb_qty', 'xjp_qty',
        'dk_qty', 'xs_qty', 'gsb_qty', 'djx_qty', 'zb_qty',
    }
    assert expected.issubset(cols), f"缺字段: {expected - cols}"


def test_reconciliations_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(reconciliations)")}
    expected = {
        'id', 'initiator_party', 'approver_party', 'pair_low', 'pair_high',
        'date_from', 'date_to', 'status', 'snapshot_json', 'notes',
        'created_at', 'approved_at',
    }
    assert expected.issubset(cols)


def test_investment_records_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(investment_records)")}
    expected = {'id', 'recorded_by', 'counterparty', 'year_month',
                'mkb_qty', 'jkb_qty', 'jx_qty', 'gx_qty', 'remark', 'created_at'}
    assert expected.issubset(cols)


def test_monthly_inventory_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(monthly_inventory)")}
    expected = {'id', 'recorded_by', 'counterparty', 'year_month',
                'mkb_qty', 'jkb_qty', 'jx_qty', 'gx_qty'}
    assert expected.issubset(cols)


def test_default_prices_schema(client):
    import app as app_module
    with sqlite3.connect(app_module.DATABASE) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(default_prices)")}
    assert {'item_key', 'price'}.issubset(cols)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_schema.py -v
```

Expected: 全 FAIL（表还不存在或字段不符）。

- [ ] **Step 3: 在 app.py 里重写 init_db**

把 app.py 里旧的 init_db（原 records 表）替换为新 schema：

```python
def init_db():
    """初始化所有新 schema 表。幂等。"""
    con = sqlite3.connect(DATABASE)
    cur = con.cursor()

    # flow_records 主流水表
    cur.execute("""
    CREATE TABLE IF NOT EXISTS flow_records (
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_recorded_by ON flow_records(recorded_by, from_party, to_party)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_pair_date ON flow_records(from_party, to_party, date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_reconc ON flow_records(reconciliation_id)")

    # reconciliations 核对批次
    cur.execute("""
    CREATE TABLE IF NOT EXISTS reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        initiator_party TEXT NOT NULL,
        approver_party  TEXT NOT NULL,
        pair_low  TEXT NOT NULL,
        pair_high TEXT NOT NULL,
        date_from TEXT NOT NULL,
        date_to   TEXT NOT NULL,
        status    TEXT NOT NULL,
        snapshot_json TEXT,
        notes     TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reconc_approver ON reconciliations(approver_party, status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reconc_pair ON reconciliations(pair_low, pair_high, status)")

    # investment_records 投资记录（按 pair）
    cur.execute("""
    CREATE TABLE IF NOT EXISTS investment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL DEFAULT 0, jkb_qty REAL DEFAULT 0,
        jx_qty REAL DEFAULT 0, gx_qty REAL DEFAULT 0,
        remark TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # monthly_inventory 月份实存数
    cur.execute("""
    CREATE TABLE IF NOT EXISTS monthly_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL, jkb_qty REAL, jx_qty REAL, gx_qty REAL,
        UNIQUE (recorded_by, counterparty, year_month)
    )
    """)

    # default_prices 单价表
    cur.execute("""
    CREATE TABLE IF NOT EXISTS default_prices (
        item_key TEXT PRIMARY KEY,
        price    REAL DEFAULT 0
    )
    """)

    con.commit()
    con.close()


init_db()
```

同时把 app.py 顶层原有的"旧 records 表 init + 旧 section 相关建表"整段删掉。

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_schema.py -v
```

Expected: 5 个测试全 PASS。

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_schema.py
git commit -m "feat(huadeng): introduce v2 schema (flow_records/reconciliations/etc)"
```

---

### Task 3: 写迁移脚本 `scripts/migrate_to_v2.py`

**Files:**
- Create: `scripts/migrate_to_v2.py`
- Create: `tests/test_migration.py`

- [ ] **Step 1: 写测试 —— 构造旧 schema 数据 → 迁移 → 断言新 schema**

`tests/test_migration.py`:
```python
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_migration.py -v
```

Expected: 全 FAIL（脚本还没写）。

- [ ] **Step 3: 写迁移脚本**

`scripts/migrate_to_v2.py`:
```python
"""一次性迁移脚本：旧 schema → v2 schema。

用法: python scripts/migrate_to_v2.py <path/to/huadeng.db>

流程:
1. cp huadeng.db huadeng.db.bak-YYYYMMDD-HHMMSS
2. 建 v2 表 (flow_records, reconciliations, investment_records[v2], monthly_inventory)
3. INSERT INTO flow_records SELECT ... FROM records WHERE status IN ('legacy','confirmed')
4. INSERT INTO investment_records[v2] SELECT ... FROM investment_records[v1]
5. drop 旧表
6. 打印统计 + 断言

draft / pending_approval 记录全部丢弃（用户用 Excel 重新导入）。
"""
import os
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
    for t in ['records', 'investment_records_v1', 'reconciliations_v1', 'reconciliation_items']:
        con.execute(f'DROP TABLE IF EXISTS {t}')
    # 因 step 4 里已把旧 investment_records rename 过
    print('[OK] 旧表已 drop')

    con.commit()
    con.close()
    print('[OK] 迁移完成')


def _create_v2_tables(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS flow_records (
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

    CREATE TABLE IF NOT EXISTS reconciliations (
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

    CREATE TABLE IF NOT EXISTS monthly_inventory (
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
    for r in rows:
        from_p, to_p = CHANNEL_MAP.get(r['channel'], (None, None))
        if from_p is None:
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
    return len(rows)


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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest tests/test_migration.py -v
```

Expected: 6 个测试全 PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_to_v2.py tests/test_migration.py
git commit -m "feat(huadeng): migration script records→flow_records"
```

---

## Phase 2: Party 认证 + 首页

### Task 4: Party 常量 + session helpers + 装饰器

**Files:**
- Modify: `app.py`（在 init_db 之后新增 party 模块）
- Create: `tests/test_party_auth.py`

- [ ] **Step 1: 写测试**

`tests/test_party_auth.py`:
```python
"""测试 party 常量 / session helper / @party_required 装饰器。"""
import pytest


def test_parties_constants():
    import app as app_module
    assert app_module.PARTIES == {
        'hd': {'name': '华登',     'counterparties': ['sy', 'xx']},
        'sy': {'name': '邵阳华登', 'counterparties': ['hd', 'xx']},
        'xx': {'name': '兴信',     'counterparties': ['hd', 'sy']},
    }


def test_party_accounts_by_username():
    import app as app_module
    # 默认用户名 hd / sy / xx
    assert app_module.PARTY_BY_USERNAME.get('hd') == 'hd'
    assert app_module.PARTY_BY_USERNAME.get('sy') == 'sy'
    assert app_module.PARTY_BY_USERNAME.get('xx') == 'xx'


def test_current_party_when_not_logged(client):
    with client.session_transaction() as sess:
        sess.clear()
    # current_party() 在没登录时应返回 None
    import app as app_module
    with app_module.app.test_request_context():
        assert app_module.current_party() is None


def test_party_required_redirects_when_not_logged(client):
    rv = client.get('/party/hd', follow_redirects=False)
    assert rv.status_code == 302
    assert '/party/hd/login' in rv.location


def test_party_required_blocks_other_party(client):
    with client.session_transaction() as sess:
        sess['party'] = 'hd'
    rv = client.get('/party/sy', follow_redirects=False)
    # hd 登录访问 /party/sy → 踢回首页
    assert rv.status_code == 302
    assert rv.location.endswith('/')
```

- [ ] **Step 2: 跑 FAIL**

```bash
pytest tests/test_party_auth.py -v
```

- [ ] **Step 3: 在 app.py 加 party 模块 + 删除旧 section 代码**

**要删除的东西**（从 main 起的 app.py 里）：
- `SECTIONS`, `CHANNELS`, `SECTION_ACCOUNTS` 字典
- `_PARTY_BY_DEFAULT_USERNAME`（如有）
- `_ch_to_sec`, `_sec_required`, `_ch_required`, `require_section` 装饰器 / 辅助函数
- 所有 `/section/<int:sec>*` 路由（`section`, `section_login`, `section_logout`, `add_record`, `edit_record`, `delete_record`, 等）
- 所有直接 SELECT/INSERT `records` 表的代码
- `_get_records`, `_calc_summary`（`_calc_summary` 我们后面会重写一个，先删）
- 旧 `reports()` 函数（后面 Task 15 重写）
- 旧 Excel `/import*` 路由（Task 17-18 重写）
- `CHANNEL_OWNER`, `party_of_channel`, `channels_of_party`, `sections_of_party`, `other_party` 等 channel-based helper
- `SECTION_IMPORT_CONFIG`

**如何删**：直接在编辑器里 grep `SECTIONS`、`CHANNELS`、`records[^_]` 逐个删。完了之后 app.py 应该只剩：Flask app 初始化 + DATABASE 常量 + init_db + `@app.route('/health')` + 留着 3 个新路由的 stub（`/`, `/party/<p>`, `/reports` 暂返回空字符串避免 test_smoke 挂）。

然后插入 party 模块（放在 init_db 之后）。新增：

```python
# ==================== Party 常量与认证 ====================

PARTIES = {
    'hd': {'name': '华登',     'counterparties': ['sy', 'xx']},
    'sy': {'name': '邵阳华登', 'counterparties': ['hd', 'xx']},
    'xx': {'name': '兴信',     'counterparties': ['hd', 'sy']},
}

PARTY_ACCOUNTS = {
    'hd': {
        'username': os.environ.get('HUADENG_HD_USER', 'hd'),
        'password': os.environ.get('HUADENG_HD_PASSWORD', 'hd123456'),
    },
    'sy': {
        'username': os.environ.get('HUADENG_SY_USER', 'sy'),
        'password': os.environ.get('HUADENG_SY_PASSWORD', 'sy123456'),
    },
    'xx': {
        'username': os.environ.get('HUADENG_XX_USER', 'xx'),
        'password': os.environ.get('HUADENG_XX_PASSWORD', 'xx123456'),
    },
}

PARTY_BY_USERNAME = {acc['username']: p for p, acc in PARTY_ACCOUNTS.items()}
assert len(PARTY_BY_USERNAME) == 3, 'username 必须 3 个都唯一'

ITEMS = [
    ('jx', '胶箱'), ('gx', '钙塑箱'), ('zx', '纸箱'),
    ('jkb', '胶卡板'), ('mkb', '木卡板'), ('xb', '小板'),
    ('dz', '胶袋'), ('wb', '围布'), ('pk', '平卡'),
    ('xzx', '小纸箱'), ('dgb', '大盖板'), ('xjp', '小胶盆'),
    ('dk', '刀卡'),
    ('xs', '吸塑'), ('gsb', '钙塑板'),
    ('djx', '大胶箱'), ('zb', '纸板'),
]
STAT_ITEMS = [('mkb', '木卡板'), ('jkb', '胶卡板'), ('jx', '胶箱'), ('gx', '钙塑箱')]
TRIANGLE_ITEMS = [('mkb', '木卡板'), ('jkb', '胶卡板'), ('jx', '胶箱'), ('gx', '钙塑箱'), ('zx', '纸箱')]


def current_party():
    return session.get('party')


app.jinja_env.globals['current_party'] = current_party
app.jinja_env.globals['PARTIES'] = PARTIES
app.jinja_env.globals['ITEMS'] = ITEMS


def party_required(fn):
    """装饰器：要求当前 session 有 party，且 URL 里的 party 与之匹配。"""
    @wraps(fn)
    def wrapped(*args, **kwargs):
        url_party = kwargs.get('party')
        sess_party = session.get('party')
        if not sess_party:
            return redirect(url_for('party_login', party=url_party or 'hd'))
        if url_party and url_party != sess_party:
            flash('无权访问其他 party 页面')
            return redirect(url_for('index'))
        return fn(*args, **kwargs)
    return wrapped


@app.context_processor
def inject_pending_count():
    """顶部 nav badge：当前 party 作为 approver 的待处理核对数。"""
    party = session.get('party')
    if not party:
        return {'pending_approval_count': 0}
    try:
        con = sqlite3.connect(DATABASE)
        row = con.execute(
            "SELECT COUNT(*) FROM reconciliations WHERE approver_party=? AND status='pending_approval'",
            (party,)
        ).fetchone()
        con.close()
        return {'pending_approval_count': row[0] if row else 0}
    except Exception:
        return {'pending_approval_count': 0}
```

- [ ] **Step 4: 跑 PASS**

```bash
pytest tests/test_party_auth.py -v
```

注意：`test_party_required_redirects_when_not_logged` / `test_party_required_blocks_other_party` 会 404（/party/hd 路由还没建）。这两个放 Task 5 做。先注释或 skip。

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_party_auth.py
git commit -m "feat(huadeng): party constants + session helpers"
```

---

### Task 5: `/party/<party>/login` + `/party/<party>/logout` + party_login.html

**Files:**
- Modify: `app.py`
- Create: `templates/party_login.html`
- Delete: `templates/section_login.html`
- Modify: `tests/test_party_auth.py` (取消前面 skip 的测试)

- [ ] **Step 1: 写登录测试**

在 `tests/test_party_auth.py` 追加：

```python
def test_login_success(client):
    rv = client.post('/party/hd/login', data={'username': 'hd', 'password': 'hd123456'},
                     follow_redirects=False)
    assert rv.status_code == 302
    assert rv.location.endswith('/party/hd')
    with client.session_transaction() as sess:
        assert sess.get('party') == 'hd'


def test_login_wrong_password(client):
    rv = client.post('/party/hd/login',
                     data={'username': 'hd', 'password': 'WRONG'},
                     follow_redirects=False)
    assert rv.status_code == 302  # 回登录页
    with client.session_transaction() as sess:
        assert sess.get('party') is None


def test_login_wrong_party(client):
    """用 sy 账号登 hd 登录页：应被拒（账号与 URL 不匹配）。"""
    rv = client.post('/party/hd/login', data={'username': 'sy', 'password': 'sy123456'},
                     follow_redirects=False)
    assert rv.status_code == 302
    with client.session_transaction() as sess:
        assert sess.get('party') is None


def test_logout_clears_session(client):
    with client.session_transaction() as sess:
        sess['party'] = 'hd'
    client.get('/party/hd/logout')
    with client.session_transaction() as sess:
        assert sess.get('party') is None
```

- [ ] **Step 2: 删旧 section_login.html + 添加 party_login.html**

```bash
rm -f templates/section_login.html templates/section.html
```

`templates/party_login.html`:
```html
{% extends "base.html" %}
{% block title %}{{ PARTIES[party].name }} 登录{% endblock %}
{% block content %}
<div class="max-w-md mx-auto mt-16 bg-white rounded-xl shadow-md p-8">
    <h1 class="text-xl font-bold text-gray-800 mb-6 text-center">
        {{ PARTIES[party].name }} 登录
    </h1>
    <form method="POST" class="space-y-4">
        <div>
            <label class="block text-xs text-gray-500 mb-1">账号</label>
            <input type="text" name="username" required autofocus
                   class="w-full border rounded px-3 py-2 text-sm">
        </div>
        <div>
            <label class="block text-xs text-gray-500 mb-1">密码</label>
            <input type="password" name="password" required
                   class="w-full border rounded px-3 py-2 text-sm">
        </div>
        <button type="submit"
                class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            登录
        </button>
    </form>
    <div class="text-center mt-4">
        <a href="/" class="text-xs text-gray-500 hover:text-gray-700">返回首页</a>
    </div>
</div>
{% endblock %}
```

- [ ] **Step 3: 在 app.py 加路由**

```python
@app.route('/party/<party>/login', methods=['GET', 'POST'])
def party_login(party):
    if party not in PARTIES:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        # 1. username 必须存在
        user_party = PARTY_BY_USERNAME.get(username)
        if not user_party:
            flash('账号或密码错误')
            return redirect(url_for('party_login', party=party))
        # 2. 与 URL 里的 party 必须一致
        if user_party != party:
            flash('账号与登录入口不符')
            return redirect(url_for('party_login', party=party))
        # 3. 密码校验
        expected = PARTY_ACCOUNTS[party]['password']
        if password != expected:
            flash('账号或密码错误')
            return redirect(url_for('party_login', party=party))
        session.permanent = True
        session['party'] = party
        session.modified = True
        return redirect(url_for('party_page', party=party))
    return render_template('party_login.html', party=party)


@app.route('/party/<party>/logout')
def party_logout(party):
    session.pop('party', None)
    session.modified = True
    return redirect(url_for('index'))
```

- [ ] **Step 4: 跑 PASS**

```bash
pytest tests/test_party_auth.py -v
```

先会遇到 `test_party_required_redirects_when_not_logged` 路由不存在。在 app.py 加临时的：

```python
@app.route('/party/<party>')
@party_required
def party_page(party):
    return f'TODO: party page for {party}'
```

稍后 Task 7 再完整实现。

- [ ] **Step 5: Commit**

```bash
git add app.py templates/party_login.html templates/section_login.html templates/section.html tests/test_party_auth.py
git commit -m "feat(huadeng): party login/logout + auth decorator"
```

---

### Task 6: 首页 `/` - 3 party 卡片

**Files:**
- Modify: `app.py`
- Modify: `templates/index.html`
- Modify: `templates/base.html`（顶部导航 URL 修改）
- Create: `tests/test_index.py`

- [ ] **Step 1: 写测试**

`tests/test_index.py`:
```python
def test_index_shows_3_cards(client):
    rv = client.get('/')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert '华登' in html
    assert '邵阳华登' in html
    assert '兴信' in html
    # 每个 card 链接到 /party/<code>
    assert 'href="/party/hd"' in html
    assert 'href="/party/sy"' in html
    assert 'href="/party/xx"' in html


def test_index_has_reports_link(client):
    rv = client.get('/')
    html = rv.data.decode('utf-8')
    assert '/reports' in html
```

- [ ] **Step 2: 跑 FAIL**

```bash
pytest tests/test_index.py -v
```

- [ ] **Step 3: 重写 index.html**

```html
{% extends "base.html" %}
{% block title %}华登包材管理系统 - 首页{% endblock %}
{% block content %}
<div class="max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold text-gray-800 mb-8 text-center">包材管理 · 选择登录</h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {% set colors = {'hd': 'blue', 'sy': 'green', 'xx': 'purple'} %}
        {% for code, info in PARTIES.items() %}
        <a href="/party/{{ code }}"
           class="block bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow p-8 border border-gray-100 hover:border-{{ colors[code] }}-300">
            <div class="text-center">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-{{ colors[code] }}-100 text-{{ colors[code] }}-600">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M3 21v-4a4 4 0 014-4h10a4 4 0 014 4v4M12 11a4 4 0 100-8 4 4 0 000 8z"/>
                    </svg>
                </div>
                <h2 class="text-xl font-semibold text-gray-800">{{ info.name }}</h2>
                <p class="text-sm text-gray-500 mt-3">登录进入对账系统</p>
            </div>
        </a>
        {% endfor %}
    </div>
    <div class="text-center mt-12">
        <a href="/reports" class="text-blue-600 hover:underline">查看汇总报表 →</a>
    </div>
</div>
{% endblock %}
```

- [ ] **Step 4: 改 app.py 的 `/` 路由**

```python
@app.route('/')
def index():
    return render_template('index.html')
```

删掉旧的 section 过滤逻辑。

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_index.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/index.html tests/test_index.py
git commit -m "feat(huadeng): party-based homepage (3 cards)"
```

---

## Phase 3: Party 主页 + 录入

### Task 7: Party 主页静态骨架（GET /party/<party>）

**Files:**
- Modify: `app.py`
- Create: `templates/party.html`
- Create: `tests/test_party_page.py`

- [ ] **Step 1: 写测试**

`tests/test_party_page.py`:
```python
def _login(client, party='hd'):
    with client.session_transaction() as sess:
        sess['party'] = party


def test_party_page_shows_two_counterparty_panels(client):
    _login(client, 'hd')
    rv = client.get('/party/hd')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert '对邵阳华登' in html
    assert '对兴信' in html


def test_party_page_shows_4_direction_tabs(client):
    _login(client, 'hd')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    assert '发→邵阳华登' in html
    assert '收自邵阳华登' in html
    assert '发→兴信' in html
    assert '收自兴信' in html


def test_party_page_empty_state(client):
    _login(client, 'hd')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    # 4 张表都应是空的
    assert html.count('暂无记录') >= 4
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 写 `party_page` 路由**

```python
@app.route('/party/<party>')
@party_required
def party_page(party):
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row

    counterparties = PARTIES[party]['counterparties']
    panels = []
    for cp in counterparties:
        # 4 个方向：发/收 ×（对 cp）
        sent = _query_flow(con, recorded_by=party, from_party=party, to_party=cp)
        received = _query_flow(con, recorded_by=party, from_party=cp, to_party=party)
        panels.append({
            'cp': cp,
            'cp_name': PARTIES[cp]['name'],
            'sent_records': sent,
            'received_records': received,
            'sent_summary': _calc_summary(sent),
            'received_summary': _calc_summary(received),
        })

    prices = {r['item_key']: r['price']
              for r in con.execute('SELECT * FROM default_prices').fetchall()}
    con.close()
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices)


def _query_flow(con, *, recorded_by, from_party, to_party, date_from=None, date_to=None):
    """查 flow_records。"""
    sql = """SELECT * FROM flow_records
             WHERE recorded_by=? AND from_party=? AND to_party=?"""
    args = [recorded_by, from_party, to_party]
    if date_from:
        sql += ' AND date >= ?'; args.append(date_from)
    if date_to:
        sql += ' AND date <= ?'; args.append(date_to)
    sql += ' ORDER BY date DESC, id DESC'
    return [dict(r) for r in con.execute(sql, args).fetchall()]


def _calc_summary(records):
    """累加 17 包材 qty + 金额。"""
    summary = {k: {'qty': 0, 'amount': 0} for k, _ in ITEMS}
    for r in records:
        for k, _ in ITEMS:
            qty = r.get(f'{k}_qty') or 0
            summary[k]['qty'] += qty
    return summary
```

- [ ] **Step 4: 写 party.html 骨架**

```html
{% extends "base.html" %}
{% block title %}{{ party_name }} · 包材管理{% endblock %}
{% block content %}
<div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-bold">{{ party_name }}</h1>
    <a href="/party/{{ party }}/logout" class="px-3 py-1.5 bg-orange-500 text-white text-sm rounded hover:bg-orange-600">退出</a>
</div>

{% for panel in panels %}
<div class="bg-white rounded-lg shadow-sm mb-6" data-cp="{{ panel.cp }}">
    <div class="flex items-center justify-between px-4 py-3 border-b">
        <h2 class="text-lg font-semibold">对{{ panel.cp_name }}</h2>
        <div class="flex gap-2">
            <button onclick="openReconcileModal('{{ party }}', '{{ panel.cp }}')"
                    class="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700">
                发起对账
            </button>
        </div>
    </div>

    <div class="px-4">
        <!-- Tab 切换 -->
        <div class="flex border-b">
            <button class="tab-btn px-4 py-2 border-b-2 border-blue-600 text-blue-600 font-medium text-sm"
                    data-tab="sent-{{ panel.cp }}" onclick="switchTab('sent-{{ panel.cp }}', '{{ panel.cp }}')">
                发→{{ panel.cp_name }}
            </button>
            <button class="tab-btn px-4 py-2 border-b-2 border-transparent text-gray-500 text-sm"
                    data-tab="received-{{ panel.cp }}" onclick="switchTab('received-{{ panel.cp }}', '{{ panel.cp }}')">
                收自{{ panel.cp_name }}
            </button>
        </div>

        <!-- 发表 -->
        <div id="tab-sent-{{ panel.cp }}" class="tab-content py-3">
            {% set records = panel.sent_records %}
            {% set summary = panel.sent_summary %}
            {% include "_flow_table.html" with context %}
        </div>

        <!-- 收表 -->
        <div id="tab-received-{{ panel.cp }}" class="tab-content hidden py-3">
            {% set records = panel.received_records %}
            {% set summary = panel.received_summary %}
            {% include "_flow_table.html" with context %}
        </div>
    </div>
</div>
{% endfor %}

<script>
function switchTab(tabId, cpKey) {
    const panel = document.querySelector(`[data-cp="${cpKey}"]`);
    panel.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    panel.querySelector('#tab-' + tabId).classList.remove('hidden');
    panel.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('border-blue-600', 'text-blue-600', 'font-medium');
            btn.classList.remove('border-transparent', 'text-gray-500');
        } else {
            btn.classList.remove('border-blue-600', 'text-blue-600', 'font-medium');
            btn.classList.add('border-transparent', 'text-gray-500');
        }
    });
}

function openReconcileModal(party, cp) {
    alert('TODO: open reconcile modal for ' + party + ' vs ' + cp);
}
</script>
{% endblock %}
```

`templates/_flow_table.html`（partial，被 party.html include）:
```html
<div class="table-scroll">
    <table class="text-sm border-collapse w-full">
        <thead>
            <tr class="bg-gray-50">
                <th class="border px-2 py-1.5">日期</th>
                <th class="border px-2 py-1.5">订单号</th>
                {% for key, name in ITEMS %}
                <th class="border px-2 py-1.5 text-right">{{ name }}</th>
                {% endfor %}
                <th class="border px-2 py-1.5">备注</th>
                <th class="border px-2 py-1.5">操作</th>
            </tr>
        </thead>
        <tbody>
            {% for r in records %}
            <tr class="hover:bg-gray-50 {{ 'bg-yellow-50' if r.locked else '' }}">
                <td class="border px-2 py-1">{{ r.date }}</td>
                <td class="border px-2 py-1">{{ r.order_no or '' }}</td>
                {% for key, name in ITEMS %}
                <td class="border px-1 py-1 text-right">{{ r[key + '_qty']|int if r[key + '_qty'] else '' }}</td>
                {% endfor %}
                <td class="border px-2 py-1 text-xs">{{ r.remark or '' }}</td>
                <td class="border px-2 py-1">
                    {% if r.locked %}<span class="text-xs text-gray-400">🔒 已锁</span>{% endif %}
                </td>
            </tr>
            {% endfor %}
            {% if not records %}
            <tr><td colspan="100" class="border px-4 py-8 text-center text-gray-400">暂无记录</td></tr>
            {% endif %}
        </tbody>
        <tfoot>
            <tr class="bg-blue-50 font-semibold">
                <td class="border px-2 py-1" colspan="2">合计</td>
                {% for key, name in ITEMS %}
                <td class="border px-1 py-1 text-right">{{ summary[key].qty|int if summary[key].qty else '' }}</td>
                {% endfor %}
                <td class="border px-2 py-1" colspan="2"></td>
            </tr>
        </tfoot>
    </table>
</div>
```

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_party_page.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/party.html templates/_flow_table.html tests/test_party_page.py
git commit -m "feat(huadeng): party main page skeleton"
```

---

### Task 8: 新增记录（POST /party/<party>/entry）

**Files:**
- Modify: `app.py`
- Modify: `templates/party.html` (追加新增表单)
- Create: `tests/test_entry.py`

- [ ] **Step 1: 写测试**

`tests/test_entry.py`:
```python
def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def test_entry_create_sent(client):
    """hd 在'发→sy' tab 新增一条：应得 recorded_by=hd, from=hd, to=sy。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent',
        'counterparty': 'sy',
        'date': '2026-05-01',
        'order_no': 'ORD-1',
        'jx_qty': '10',
        'remark': 'test',
    }, follow_redirects=False)
    assert rv.status_code == 302

    import app as app_module
    import sqlite3
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT recorded_by, from_party, to_party, date, order_no, jx_qty, locked FROM flow_records"
    ).fetchone()
    assert row == ('hd', 'hd', 'sy', '2026-05-01', 'ORD-1', 10.0, 0)


def test_entry_create_received(client):
    """hd 在'收自sy' tab 新增：应得 recorded_by=hd, from=sy, to=hd。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'received',
        'counterparty': 'sy',
        'date': '2026-05-02',
        'order_no': 'R1',
        'jx_qty': '5',
    })
    assert rv.status_code == 302

    import app as app_module
    import sqlite3
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT recorded_by, from_party, to_party FROM flow_records"
    ).fetchone()
    assert row == ('hd', 'sy', 'hd')


def test_entry_rejects_wrong_counterparty(client):
    """hd 录对 hd（自己）的条 → 400。"""
    _login(client, 'hd')
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'hd', 'date': '2026-05-01', 'jx_qty': '1',
    }, follow_redirects=False)
    assert rv.status_code in (400, 302)  # 400 or redirect back with flash error


def test_entry_requires_login(client):
    rv = client.post('/party/hd/entry', data={
        'direction': 'sent', 'counterparty': 'sy', 'date': '2026-05-01', 'jx_qty': '1',
    }, follow_redirects=False)
    assert rv.status_code == 302
    assert '/login' in rv.location
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 加 entry 路由**

```python
@app.route('/party/<party>/entry', methods=['POST'])
@party_required
def party_entry(party):
    direction = request.form.get('direction')  # 'sent' | 'received'
    cp = request.form.get('counterparty')
    if cp not in PARTIES or cp == party:
        flash('无效的对方')
        return redirect(url_for('party_page', party=party))
    if cp not in PARTIES[party]['counterparties']:
        flash('无权对此 party 录入')
        return redirect(url_for('party_page', party=party))

    if direction == 'sent':
        from_p, to_p = party, cp
    elif direction == 'received':
        from_p, to_p = cp, party
    else:
        flash('无效 direction')
        return redirect(url_for('party_page', party=party))

    date = request.form.get('date', '').strip()
    order_no = request.form.get('order_no', '').strip() or None
    remark = request.form.get('remark', '').strip() or None
    if not date:
        flash('日期必填')
        return redirect(url_for('party_page', party=party))

    qty_cols = [f'{k}_qty' for k, _ in ITEMS]
    qty_vals = []
    for col in qty_cols:
        v = request.form.get(col, '0').strip()
        try:
            qty_vals.append(float(v) if v else 0)
        except ValueError:
            qty_vals.append(0)

    con = sqlite3.connect(DATABASE)
    placeholders = ', '.join(['?'] * len(qty_cols))
    con.execute(f"""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, remark,
                                  {', '.join(qty_cols)})
        VALUES (?, ?, ?, ?, ?, ?, {placeholders})
    """, [party, from_p, to_p, date, order_no, remark, *qty_vals])
    con.commit()
    con.close()
    return redirect(url_for('party_page', party=party))
```

- [ ] **Step 4: 在 party.html 加折叠的"新增记录"表单（在 panel 顶部）**

（完整 form 代码参考 `templates/_flow_entry_form.html`——建一个 partial）

`templates/_flow_entry_form.html`:
```html
<details class="border rounded mb-3">
    <summary class="cursor-pointer px-3 py-2 bg-blue-50 text-blue-700 font-medium text-sm">
        ➕ 新增 {{ '发→' if direction == 'sent' else '收自' }}{{ cp_name }}
    </summary>
    <form method="POST" action="/party/{{ party }}/entry" class="p-3 border-t">
        <input type="hidden" name="direction" value="{{ direction }}">
        <input type="hidden" name="counterparty" value="{{ cp }}">
        <div class="flex gap-3 mb-2 flex-wrap items-end">
            <div>
                <label class="block text-xs text-gray-500 mb-1">日期</label>
                <input type="date" name="date" required class="border rounded px-2 py-1 text-sm">
            </div>
            <div>
                <label class="block text-xs text-gray-500 mb-1">订单号</label>
                <input type="text" name="order_no" class="border rounded px-2 py-1 text-sm w-32">
            </div>
            <div class="flex-1">
                <label class="block text-xs text-gray-500 mb-1">备注</label>
                <input type="text" name="remark" class="border rounded px-2 py-1 text-sm w-full">
            </div>
        </div>
        <div class="table-scroll">
            <table class="text-sm border-collapse w-full">
                <thead><tr class="bg-gray-50">
                    {% for key, name in ITEMS %}<th class="border px-1 py-1">{{ name }}</th>{% endfor %}
                </tr></thead>
                <tbody><tr>
                    {% for key, name in ITEMS %}
                    <td class="border px-1 py-1">
                        <input type="number" step="any" name="{{ key }}_qty" value="0"
                               class="w-16 border rounded px-1 py-0.5 text-right text-sm">
                    </td>
                    {% endfor %}
                </tr></tbody>
            </table>
        </div>
        <button type="submit" class="mt-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
            提交
        </button>
    </form>
</details>
```

在 party.html 的 `sent` 和 `received` tab 各 include 一次：

```jinja
{% set direction = 'sent' %}
{% set cp = panel.cp %}
{% set cp_name = panel.cp_name %}
{% include "_flow_entry_form.html" %}
```

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_entry.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/party.html templates/_flow_entry_form.html tests/test_entry.py
git commit -m "feat(huadeng): add flow record entry form"
```

---

### Task 9: 编辑 / 删除 flow_record（带 lock 校验）

**Files:**
- Modify: `app.py`
- Modify: `templates/_flow_table.html`（操作列加编辑/删除按钮）
- Create: `tests/test_record_edit.py`

- [ ] **Step 1: 写测试**

`tests/test_record_edit.py`:
```python
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(date='2026-05-01', locked=0, recorded_by='hd', from_party='hd', to_party='sy', jx_qty=0):
    con = sqlite3.connect(app_module.DATABASE)
    cur = con.execute(
        "INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, locked) VALUES (?,?,?,?,?,?)",
        (recorded_by, from_party, to_party, date, jx_qty, locked)
    )
    rid = cur.lastrowid
    con.commit(); con.close()
    return rid


def test_edit_own_record(client):
    _login(client, 'hd')
    rid = _insert(jx_qty=5)
    rv = client.post(f'/record/{rid}/edit', data={
        'date': '2026-05-02', 'order_no': 'NEW', 'jx_qty': '99', 'remark': 'edited',
    })
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT date, order_no, jx_qty FROM flow_records WHERE id=?", (rid,)).fetchone()
    assert row == ('2026-05-02', 'NEW', 99.0)


def test_edit_blocks_if_locked(client):
    _login(client, 'hd')
    rid = _insert(locked=1)
    rv = client.post(f'/record/{rid}/edit', data={'date': '2026-05-02', 'jx_qty': '1'},
                     follow_redirects=False)
    assert rv.status_code in (403, 302)  # rejected


def test_edit_blocks_other_party(client):
    """hd 想改 sy 的记录 → 拒。"""
    _login(client, 'hd')
    rid = _insert(recorded_by='sy', from_party='sy', to_party='xx')
    rv = client.post(f'/record/{rid}/edit', data={'date': '2026-05-02', 'jx_qty': '1'},
                     follow_redirects=False)
    assert rv.status_code in (403, 302)


def test_delete_own_record(client):
    _login(client, 'hd')
    rid = _insert()
    rv = client.post(f'/record/{rid}/delete')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE id=?", (rid,)).fetchone()[0] == 0


def test_delete_blocks_if_locked(client):
    _login(client, 'hd')
    rid = _insert(locked=1)
    rv = client.post(f'/record/{rid}/delete', follow_redirects=False)
    assert rv.status_code in (403, 302)
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE id=?", (rid,)).fetchone()[0] == 1  # 还在
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 加路由**

```python
@app.route('/record/<int:rid>/edit', methods=['POST'])
def record_edit(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM flow_records WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('记录不存在'); return redirect(url_for('party_page', party=party))
    if r['recorded_by'] != party:
        con.close(); flash('无权编辑他人记录'); return redirect(url_for('party_page', party=party))
    if r['locked']:
        con.close(); flash('记录已锁定，不能修改'); return redirect(url_for('party_page', party=party))

    date = request.form.get('date', '').strip() or r['date']
    order_no = request.form.get('order_no', '').strip() or None
    remark = request.form.get('remark', '').strip() or None
    qty_cols = [f'{k}_qty' for k, _ in ITEMS]
    qty_vals = []
    for col in qty_cols:
        v = request.form.get(col, '').strip()
        if v == '':
            qty_vals.append(r[col] or 0)
        else:
            try:
                qty_vals.append(float(v))
            except ValueError:
                qty_vals.append(r[col] or 0)
    set_clause = ', '.join([f'{c}=?' for c in ['date', 'order_no', 'remark'] + qty_cols])
    con.execute(
        f"UPDATE flow_records SET {set_clause}, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [date, order_no, remark, *qty_vals, rid]
    )
    con.commit(); con.close()
    return redirect(url_for('party_page', party=party))


@app.route('/record/<int:rid>/delete', methods=['POST'])
def record_delete(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT recorded_by, locked FROM flow_records WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('记录不存在'); return redirect(url_for('party_page', party=party))
    if r['recorded_by'] != party:
        con.close(); flash('无权删除'); return redirect(url_for('party_page', party=party))
    if r['locked']:
        con.close(); flash('记录已锁定'); return redirect(url_for('party_page', party=party))
    con.execute("DELETE FROM flow_records WHERE id=?", (rid,))
    con.commit(); con.close()
    return redirect(url_for('party_page', party=party))
```

- [ ] **Step 4: 操作列加按钮**

改 `templates/_flow_table.html` 的操作 td：

```html
<td class="border px-2 py-1 whitespace-nowrap">
    {% if r.locked %}
        <span class="text-xs text-gray-400">🔒 已锁</span>
    {% else %}
        <button onclick="openEditModal({{ r.id }})" class="text-xs text-blue-600 hover:underline">编辑</button>
        <form method="POST" action="/record/{{ r.id }}/delete" class="inline"
              onsubmit="return confirm('确认删除？')">
            <button class="text-xs text-red-600 hover:underline ml-1">删除</button>
        </form>
    {% endif %}
</td>
```

（编辑 modal 的 JS 接入略，可用 prompt 简单版 — 或者直接点开 modal、填表单 POST，细节放 Task 11。）

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_record_edit.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/_flow_table.html tests/test_record_edit.py
git commit -m "feat(huadeng): record edit/delete with lock check"
```

---

### Task 10: 日期筛选 + 分页

**Files:**
- Modify: `app.py` (party_page route)
- Modify: `templates/party.html`
- Create: `tests/test_filtering.py`

- [ ] **Step 1: 写测试**

`tests/test_filtering.py`:
```python
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert_many(n, date_start='2026-01-01'):
    con = sqlite3.connect(app_module.DATABASE)
    from datetime import datetime, timedelta
    base = datetime.strptime(date_start, '%Y-%m-%d')
    for i in range(n):
        d = (base + timedelta(days=i)).strftime('%Y-%m-%d')
        con.execute("INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty) VALUES ('hd','hd','sy',?,?)",
                    (d, i))
    con.commit(); con.close()


def test_date_filter(client):
    _login(client, 'hd')
    _insert_many(5)  # 2026-01-01 ~ 2026-01-05
    rv = client.get('/party/hd?date_from=2026-01-03&date_to=2026-01-04')
    html = rv.data.decode('utf-8')
    assert '2026-01-03' in html
    assert '2026-01-04' in html
    assert '2026-01-01' not in html
    assert '2026-01-05' not in html


def test_pagination(client):
    _login(client, 'hd')
    _insert_many(60)  # 超过 default 50
    rv = client.get('/party/hd?page_sy_sent=1&page_size=20')
    html = rv.data.decode('utf-8')
    # 第一页 20 条
    assert '共 <b>60</b> 条' in html or '60 条' in html
    assert '第 <b>1</b>' in html or '/ 3 页' in html
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 在 party_page 加筛选 + 分页**

改 party_page 读取 request.args：

```python
@app.route('/party/<party>')
@party_required
def party_page(party):
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    try:
        page_size = int(request.args.get('page_size', 50))
    except ValueError:
        page_size = 50
    if page_size not in (20, 50, 100, 200):
        page_size = 50

    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row

    counterparties = PARTIES[party]['counterparties']
    panels = []
    for cp in counterparties:
        panel = {'cp': cp, 'cp_name': PARTIES[cp]['name']}
        for direction, from_p, to_p in [('sent', party, cp), ('received', cp, party)]:
            all_r = _query_flow(con, recorded_by=party, from_party=from_p, to_party=to_p,
                                date_from=date_from, date_to=date_to)
            page_key = f'page_{cp}_{direction}'
            page = max(1, int(request.args.get(page_key, 1) or 1))
            total = len(all_r)
            pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, pages)
            start = (page - 1) * page_size
            panel[f'{direction}_records'] = all_r[start:start + page_size]
            panel[f'{direction}_summary'] = _calc_summary(all_r)
            panel[f'{direction}_pagination'] = {
                'page': page, 'pages': pages, 'total': total, 'page_size': page_size,
                'start': start + 1 if total else 0,
                'end': start + len(all_r[start:start + page_size]),
                'page_key': page_key,
            }
        panels.append(panel)

    prices = {r['item_key']: r['price'] for r in con.execute('SELECT * FROM default_prices').fetchall()}
    con.close()
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices,
                           date_from=date_from, date_to=date_to, page_size=page_size)
```

- [ ] **Step 4: 在 party.html 顶部加日期筛选 form + 每个表下方加分页控件**

在 party.html 紧跟 h1 后：

```html
<form class="bg-white rounded-lg shadow-sm p-3 mb-4 flex items-end gap-3 flex-wrap" method="GET">
    <div>
        <label class="block text-xs text-gray-500 mb-1">开始日期</label>
        <input type="date" name="date_from" value="{{ date_from }}" class="border rounded px-2 py-1 text-sm">
    </div>
    <div>
        <label class="block text-xs text-gray-500 mb-1">结束日期</label>
        <input type="date" name="date_to" value="{{ date_to }}" class="border rounded px-2 py-1 text-sm">
    </div>
    <button class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded">筛选</button>
    <a href="/party/{{ party }}" class="px-3 py-1.5 bg-gray-200 text-sm rounded">重置</a>
</form>
```

在 `_flow_table.html` 结尾加 pagination 控件：

```html
{% if pagination and pagination.total > 0 %}
<div class="flex items-center justify-between text-xs px-2 py-2 bg-gray-50 border-t">
    <span>共 <b>{{ pagination.total }}</b> 条，{{ pagination.start }}–{{ pagination.end }}，第 <b>{{ pagination.page }}</b> / {{ pagination.pages }} 页</span>
    <div class="flex gap-1">
        {% if pagination.page > 1 %}
        <a href="?{{ pagination.page_key }}=1&date_from={{ date_from }}&date_to={{ date_to }}&page_size={{ pagination.page_size }}" class="px-2 py-0.5 bg-white border rounded">首页</a>
        <a href="?{{ pagination.page_key }}={{ pagination.page - 1 }}&date_from={{ date_from }}&date_to={{ date_to }}&page_size={{ pagination.page_size }}" class="px-2 py-0.5 bg-white border rounded">上一页</a>
        {% endif %}
        {% if pagination.page < pagination.pages %}
        <a href="?{{ pagination.page_key }}={{ pagination.page + 1 }}&date_from={{ date_from }}&date_to={{ date_to }}&page_size={{ pagination.page_size }}" class="px-2 py-0.5 bg-white border rounded">下一页</a>
        <a href="?{{ pagination.page_key }}={{ pagination.pages }}&date_from={{ date_from }}&date_to={{ date_to }}&page_size={{ pagination.page_size }}" class="px-2 py-0.5 bg-white border rounded">末页</a>
        {% endif %}
    </div>
</div>
{% endif %}
```

（需要在 include `_flow_table.html` 时把 pagination 也 pass，或改用 `panel[direction + '_pagination']`。）

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_filtering.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/party.html templates/_flow_table.html tests/test_filtering.py
git commit -m "feat(huadeng): date filter + pagination on party page"
```

---

## Phase 4: 核对功能

### Task 11: `compare_pair()` 纯函数 + 测试

**Files:**
- Modify: `app.py`
- Create: `tests/test_reconcile_algo.py`

- [ ] **Step 1: 写测试**

`tests/test_reconcile_algo.py`:
```python
import sqlite3
import app as app_module


def _insert(recorded_by, from_p, to_p, date, **qtys):
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'from_party', 'to_party', 'date'] + list(qtys.keys())
    placeholders = ', '.join(['?'] * len(cols))
    con.execute(f"INSERT INTO flow_records ({', '.join(cols)}) VALUES ({placeholders})",
                [recorded_by, from_p, to_p, date, *qtys.values()])
    con.commit(); con.close()


def test_compare_pair_matching(client):
    """两方录一致 → 无 diff。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    _insert('sy', 'hd', 'sy', '2026-05-01', jx_qty=100)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-01')
    assert result['hd_to_sy']['diffs'] == {}


def test_compare_pair_mismatch(client):
    """华登发方录 100，邵阳收方录 98 → diff 胶箱 +2。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    _insert('sy', 'hd', 'sy', '2026-05-01', jx_qty=98)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-01')
    assert result['hd_to_sy']['diffs'] == {'jx': 2}


def test_compare_pair_both_directions(client):
    """两个方向都有数据，各比各。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=10)
    _insert('sy', 'hd', 'sy', '2026-05-01', jx_qty=10)
    _insert('sy', 'sy', 'hd', '2026-05-02', gx_qty=5)
    _insert('hd', 'sy', 'hd', '2026-05-02', gx_qty=5)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-02')
    assert result['hd_to_sy']['diffs'] == {}
    assert result['sy_to_hd']['diffs'] == {}
    assert result['hd_to_sy']['sender_recorded']['jx'] == 10
    assert result['sy_to_hd']['sender_recorded']['gx'] == 5


def test_compare_pair_one_side_empty(client):
    """一方漏录 → 另一方的数据作为 diff。"""
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    # sy 没录
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-01')
    assert result['hd_to_sy']['diffs'] == {'jx': 100}


def test_compare_pair_date_range(client):
    """只取范围内的数据。"""
    _insert('hd', 'hd', 'sy', '2026-04-30', jx_qty=99)  # 范围外
    _insert('hd', 'hd', 'sy', '2026-05-01', jx_qty=100)
    result = app_module.compare_pair('hd', 'sy', '2026-05-01', '2026-05-31')
    assert result['hd_to_sy']['sender_recorded']['jx'] == 100
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现 compare_pair**

```python
def compare_pair(party_a, party_b, date_from, date_to):
    """对两方做汇总对比。返回 {'a_to_b': {...}, 'b_to_a': {...}}。"""
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    result = {}
    for sender, receiver in [(party_a, party_b), (party_b, party_a)]:
        sender_sum = _sum_items(con, recorded_by=sender, from_party=sender, to_party=receiver,
                                date_from=date_from, date_to=date_to)
        receiver_sum = _sum_items(con, recorded_by=receiver, from_party=sender, to_party=receiver,
                                  date_from=date_from, date_to=date_to)
        diffs = {k: round(sender_sum[k] - receiver_sum[k], 4)
                 for k, _ in ITEMS
                 if abs(sender_sum[k] - receiver_sum[k]) > 1e-9}
        result[f'{sender}_to_{receiver}'] = {
            'sender_recorded': sender_sum,
            'receiver_recorded': receiver_sum,
            'diffs': diffs,
        }
    con.close()
    return result


def _sum_items(con, *, recorded_by, from_party, to_party, date_from, date_to):
    qty_cols_sql = ', '.join([f'COALESCE(SUM({k}_qty), 0) AS {k}_sum' for k, _ in ITEMS])
    row = con.execute(f"""
        SELECT {qty_cols_sql} FROM flow_records
        WHERE recorded_by=? AND from_party=? AND to_party=? AND date BETWEEN ? AND ?
    """, (recorded_by, from_party, to_party, date_from, date_to)).fetchone()
    return {k: float(row[f'{k}_sum']) for k, _ in ITEMS}
```

- [ ] **Step 4: 跑 PASS**

```bash
pytest tests/test_reconcile_algo.py -v
```

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_reconcile_algo.py
git commit -m "feat(huadeng): compare_pair aggregate reconciliation algorithm"
```

---

### Task 12: POST /reconcile/start + 预览（preview 合并到 start 前）

**Files:**
- Modify: `app.py`
- Create: `tests/test_reconcile_start.py`

- [ ] **Step 1: 写测试**

`tests/test_reconcile_start.py`:
```python
import sqlite3
import json
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _insert(**kw):
    defaults = {'jx_qty': 0}
    defaults.update(kw)
    con = sqlite3.connect(app_module.DATABASE)
    cols = ['recorded_by', 'from_party', 'to_party', 'date'] + [k for k in defaults if k.endswith('_qty')]
    vals = [defaults[k] for k in cols]
    con.execute(f"INSERT INTO flow_records ({', '.join(cols)}) VALUES ({', '.join(['?']*len(cols))})", vals)
    con.commit(); con.close()


def test_reconcile_start_creates_row(client):
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=100)
    rv = client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    })
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT initiator_party, approver_party, pair_low, pair_high, status FROM reconciliations"
    ).fetchone()
    assert row == ('hd', 'sy', 'hd', 'sy', 'pending_approval')


def test_reconcile_start_sets_reconciliation_id(client):
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=10)
    _insert(recorded_by='sy', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=10)
    client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    })
    con = sqlite3.connect(app_module.DATABASE)
    rids = [r[0] for r in con.execute("SELECT reconciliation_id FROM flow_records").fetchall()]
    assert all(rid is not None for rid in rids)
    assert len(set(rids)) == 1  # 同一批


def test_reconcile_start_stores_snapshot(client):
    _login(client, 'hd')
    _insert(recorded_by='hd', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=100)
    _insert(recorded_by='sy', from_party='hd', to_party='sy', date='2026-05-01', jx_qty=98)
    client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-01', 'date_to': '2026-05-01'
    })
    con = sqlite3.connect(app_module.DATABASE)
    snap = con.execute("SELECT snapshot_json FROM reconciliations").fetchone()[0]
    data = json.loads(snap)
    assert data['hd_to_sy']['sender_recorded']['jx'] == 100
    assert data['hd_to_sy']['receiver_recorded']['jx'] == 98
    assert data['hd_to_sy']['diffs']['jx'] == 2


def test_reconcile_start_rejects_overlap_pending(client):
    """同 pair 已有 pending 的范围 overlap → 409。"""
    _login(client, 'hd')
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status)
        VALUES ('hd','sy','hd','sy','2026-05-01','2026-05-31','pending_approval')
    """)
    con.commit(); con.close()
    rv = client.post('/reconcile/start', data={
        'counterparty': 'sy', 'date_from': '2026-05-15', 'date_to': '2026-06-15'
    }, follow_redirects=False)
    # overlap 被拒：redirect 带 flash error
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    ct = con.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0]
    assert ct == 1  # 没新增
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现 /reconcile/start**

```python
@app.route('/reconcile/start', methods=['POST'])
def reconcile_start():
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    cp = request.form.get('counterparty')
    date_from = request.form.get('date_from', '').strip()
    date_to = request.form.get('date_to', '').strip()
    if cp not in PARTIES or cp == party or cp not in PARTIES[party]['counterparties']:
        flash('无效对方'); return redirect(url_for('party_page', party=party))
    if not date_from or not date_to:
        flash('日期必填'); return redirect(url_for('party_page', party=party))

    pair_low, pair_high = sorted([party, cp])

    con = sqlite3.connect(DATABASE)
    # 检查 pending overlap
    overlap = con.execute("""
        SELECT id FROM reconciliations
        WHERE pair_low=? AND pair_high=? AND status='pending_approval'
          AND NOT (date_to < ? OR date_from > ?)
    """, (pair_low, pair_high, date_from, date_to)).fetchone()
    if overlap:
        con.close()
        flash('已存在待审批的核对，范围重叠'); return redirect(url_for('party_page', party=party))

    snapshot = compare_pair(party, cp, date_from, date_to)
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?)
    """, (party, cp, pair_low, pair_high, date_from, date_to, json.dumps(snapshot)))
    reconc_id = cur.lastrowid
    # 绑定 flow_records（未锁）
    con.execute("""
        UPDATE flow_records SET reconciliation_id=?
        WHERE date BETWEEN ? AND ?
          AND ((from_party=? AND to_party=?) OR (from_party=? AND to_party=?))
          AND reconciliation_id IS NULL
    """, (reconc_id, date_from, date_to, party, cp, cp, party))
    con.commit(); con.close()
    flash('核对已发起，等待对方审批'); return redirect(url_for('reconcile_detail', rid=reconc_id))


@app.route('/reconcile/<int:rid>')
def reconcile_detail(rid):
    # 具体 UI 在 Task 14 做。这里仅 stub 避免 404。
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    con.close()
    if not r:
        flash('核对不存在'); return redirect(url_for('index'))
    return f'TODO detail rid={rid}'
```

- [ ] **Step 4: 跑 PASS**

```bash
pytest tests/test_reconcile_start.py -v
```

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_reconcile_start.py
git commit -m "feat(huadeng): POST /reconcile/start with overlap check"
```

---

### Task 13: 审批动作（approve / reject / withdraw / cancel）

**Files:**
- Modify: `app.py`
- Create: `tests/test_reconcile_actions.py`

- [ ] **Step 1: 写测试**

`tests/test_reconcile_actions.py`:
```python
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _create_pending(initiator='hd', approver='sy', date_from='2026-05-01', date_to='2026-05-31'):
    con = sqlite3.connect(app_module.DATABASE)
    pair_low, pair_high = sorted([initiator, approver])
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_approval')
    """, (initiator, approver, pair_low, pair_high, date_from, date_to))
    rid = cur.lastrowid
    # 挂一条 record
    con.execute("""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, reconciliation_id)
        VALUES (?, ?, ?, ?, 10, ?)
    """, (initiator, initiator, approver, '2026-05-15', rid))
    con.commit(); con.close()
    return rid


def test_approve_by_approver(client):
    rid = _create_pending()
    _login(client, 'sy')  # sy 是 approver
    rv = client.post(f'/reconcile/{rid}/approve')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()
    assert row[0] == 'confirmed'
    locked = con.execute("SELECT locked FROM flow_records WHERE reconciliation_id=?", (rid,)).fetchall()
    assert all(r[0] == 1 for r in locked)


def test_approve_blocked_by_initiator(client):
    rid = _create_pending()
    _login(client, 'hd')  # initiator
    rv = client.post(f'/reconcile/{rid}/approve', follow_redirects=False)
    assert rv.status_code in (403, 302)
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'pending_approval'


def test_reject_by_approver(client):
    rid = _create_pending()
    _login(client, 'sy')
    rv = client.post(f'/reconcile/{rid}/reject', data={'notes': 'wrong number'})
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT status, notes FROM reconciliations WHERE id=?", (rid,)).fetchone()
    assert row == ('disputed', 'wrong number')
    # records 解绑
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE reconciliation_id=?", (rid,)).fetchone()[0] == 0


def test_withdraw_by_initiator(client):
    rid = _create_pending()
    _login(client, 'hd')
    rv = client.post(f'/reconcile/{rid}/withdraw')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    assert con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()[0] == 'withdrawn'


def test_cancel_confirmed_unlocks(client):
    rid = _create_pending()
    # 手动先改成 confirmed + locked
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("UPDATE reconciliations SET status='confirmed' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET locked=1 WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    # 任一方都能撤销
    _login(client, 'hd')
    rv = client.post(f'/reconcile/{rid}/cancel')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute("SELECT status FROM reconciliations WHERE id=?", (rid,)).fetchone()
    assert row[0] == 'withdrawn'
    assert con.execute("SELECT COUNT(*) FROM flow_records WHERE locked=1").fetchone()[0] == 0
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现 4 个路由**

```python
@app.route('/reconcile/<int:rid>/approve', methods=['POST'])
def reconcile_approve(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if r['approver_party'] != party:
        con.close(); flash('只有对方才能同意'); return redirect(url_for('reconcile_detail', rid=rid))
    if r['status'] != 'pending_approval':
        con.close(); flash('当前状态不允许操作'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("""UPDATE reconciliations SET status='confirmed', approved_at=CURRENT_TIMESTAMP WHERE id=?""", (rid,))
    con.execute("UPDATE flow_records SET locked=1 WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已确认'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reconcile/<int:rid>/reject', methods=['POST'])
def reconcile_reject(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    notes = request.form.get('notes', '').strip()
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if r['approver_party'] != party:
        con.close(); flash('只有对方才能打回'); return redirect(url_for('reconcile_detail', rid=rid))
    if r['status'] != 'pending_approval':
        con.close(); flash('当前状态不允许操作'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("UPDATE reconciliations SET status='disputed', notes=? WHERE id=?", (notes, rid))
    con.execute("UPDATE flow_records SET reconciliation_id=NULL WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已打回'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reconcile/<int:rid>/withdraw', methods=['POST'])
def reconcile_withdraw(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if r['initiator_party'] != party:
        con.close(); flash('只有发起方能撤回'); return redirect(url_for('reconcile_detail', rid=rid))
    if r['status'] != 'pending_approval':
        con.close(); flash('当前状态不允许撤回'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("UPDATE reconciliations SET status='withdrawn' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET reconciliation_id=NULL WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已撤回'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reconcile/<int:rid>/cancel', methods=['POST'])
def reconcile_cancel(rid):
    """撤销已 confirmed 的核对（任一方都可）。"""
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if party not in (r['initiator_party'], r['approver_party']):
        con.close(); flash('无权'); return redirect(url_for('index'))
    if r['status'] != 'confirmed':
        con.close(); flash('仅 confirmed 状态可撤销'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("UPDATE reconciliations SET status='withdrawn' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET locked=0, reconciliation_id=NULL WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已撤销对账，记录解锁'); return redirect(url_for('reconcile_detail', rid=rid))
```

- [ ] **Step 4: 跑 PASS**

```bash
pytest tests/test_reconcile_actions.py -v
```

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_reconcile_actions.py
git commit -m "feat(huadeng): reconcile approve/reject/withdraw/cancel"
```

---

### Task 14: 核对中心列表 + 详情页 UI

**Files:**
- Modify: `app.py`
- Create: `templates/reconcile_list.html`
- Create: `templates/reconcile_detail.html`
- Create: `tests/test_reconcile_ui.py`

- [ ] **Step 1: 写测试**

`tests/test_reconcile_ui.py`:
```python
import sqlite3
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def _create(initiator='hd', approver='sy', status='pending_approval', date_from='2026-05-01', date_to='2026-05-31'):
    con = sqlite3.connect(app_module.DATABASE)
    pl, ph = sorted([initiator, approver])
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
    """, (initiator, approver, pl, ph, date_from, date_to, status))
    rid = cur.lastrowid
    con.commit(); con.close()
    return rid


def test_reconcile_list_shows_relevant(client):
    """hd 登录，能看到自己发起的 + 自己作为 approver 的。"""
    rid1 = _create('hd', 'sy')
    rid2 = _create('sy', 'hd')
    _create('sy', 'xx')  # hd 无关
    _login(client, 'hd')
    rv = client.get('/reconcile')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert f'/reconcile/{rid1}' in html
    assert f'/reconcile/{rid2}' in html


def test_reconcile_detail_page(client):
    rid = _create('hd', 'sy')
    _login(client, 'hd')
    rv = client.get(f'/reconcile/{rid}')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert 'pending_approval' in html or '待审批' in html


def test_reconcile_detail_shows_approve_button_for_approver(client):
    rid = _create('hd', 'sy')
    _login(client, 'sy')
    rv = client.get(f'/reconcile/{rid}')
    html = rv.data.decode('utf-8')
    assert 'approve' in html or '同意' in html


def test_reconcile_detail_hides_approve_for_initiator(client):
    rid = _create('hd', 'sy')
    _login(client, 'hd')
    rv = client.get(f'/reconcile/{rid}')
    html = rv.data.decode('utf-8')
    # initiator 看到 withdraw 不看到 approve 按钮
    assert '撤回' in html
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现 list + detail 路由 + 模板**

`app.py`:
```python
@app.route('/reconcile')
def reconcile_list():
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        SELECT * FROM reconciliations
        WHERE initiator_party=? OR approver_party=?
        ORDER BY
            CASE status WHEN 'pending_approval' THEN 0 ELSE 1 END,
            created_at DESC
    """, (party, party)).fetchall()
    con.close()
    return render_template('reconcile_list.html', items=[dict(r) for r in rows], party=party)


# reconcile_detail 改为完整实现
@app.route('/reconcile/<int:rid>')
def reconcile_detail(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    con.close()
    if not r:
        flash('核对不存在'); return redirect(url_for('reconcile_list'))
    import json
    snapshot = json.loads(r['snapshot_json']) if r['snapshot_json'] else {}
    return render_template('reconcile_detail.html', r=dict(r), snapshot=snapshot, party=party)
```

`templates/reconcile_list.html`:
```html
{% extends "base.html" %}
{% block title %}核对中心{% endblock %}
{% block content %}
<div class="max-w-5xl mx-auto">
    <h1 class="text-xl font-bold mb-4">核对中心</h1>
    <div class="bg-white rounded-lg shadow-sm">
        <table class="w-full text-sm">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-3 py-2 text-left">发起方</th>
                    <th class="px-3 py-2 text-left">对方</th>
                    <th class="px-3 py-2">日期范围</th>
                    <th class="px-3 py-2">状态</th>
                    <th class="px-3 py-2">操作</th>
                </tr>
            </thead>
            <tbody>
                {% for i in items %}
                <tr class="border-t hover:bg-gray-50">
                    <td class="px-3 py-2">{{ PARTIES[i.initiator_party].name }}</td>
                    <td class="px-3 py-2">{{ PARTIES[i.approver_party].name }}</td>
                    <td class="px-3 py-2">{{ i.date_from }} ~ {{ i.date_to }}</td>
                    <td class="px-3 py-2">
                        {% if i.status == 'pending_approval' %}<span class="text-amber-600">待审批</span>
                        {% elif i.status == 'confirmed' %}<span class="text-green-600">已确认</span>
                        {% elif i.status == 'disputed' %}<span class="text-red-600">待协商</span>
                        {% elif i.status == 'withdrawn' %}<span class="text-gray-500">已撤回</span>
                        {% endif %}
                    </td>
                    <td class="px-3 py-2">
                        <a href="/reconcile/{{ i.id }}" class="text-blue-600 hover:underline">查看</a>
                    </td>
                </tr>
                {% else %}
                <tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">暂无核对</td></tr>
                {% endfor %}
            </tbody>
        </table>
    </div>
</div>
{% endblock %}
```

`templates/reconcile_detail.html`:
```html
{% extends "base.html" %}
{% block title %}核对详情{% endblock %}
{% block content %}
<div class="max-w-4xl mx-auto">
    <h1 class="text-xl font-bold mb-4">
        核对：{{ PARTIES[r.initiator_party].name }} ↔ {{ PARTIES[r.approver_party].name }}
    </h1>
    <div class="bg-white rounded p-4 mb-4">
        <p><b>范围</b>：{{ r.date_from }} ~ {{ r.date_to }}</p>
        <p><b>状态</b>：
            {% if r.status == 'pending_approval' %}<span class="text-amber-600">待审批</span>
            {% elif r.status == 'confirmed' %}<span class="text-green-600">已确认</span>
            {% elif r.status == 'disputed' %}<span class="text-red-600">待协商</span>
            {% elif r.status == 'withdrawn' %}<span class="text-gray-500">已撤回</span>
            {% endif %}
        </p>
        {% if r.notes %}<p class="text-sm text-gray-600 mt-2">备注: {{ r.notes }}</p>{% endif %}
    </div>

    {% for dir_key, data in snapshot.items() %}
    <div class="bg-white rounded p-4 mb-4">
        <h2 class="font-semibold mb-2">{{ dir_key.replace('_', ' → ') }}</h2>
        <table class="text-sm w-full border-collapse">
            <thead class="bg-gray-50">
                <tr><th class="border px-2 py-1">包材</th><th class="border px-2 py-1">发方记的</th><th class="border px-2 py-1">收方记的</th><th class="border px-2 py-1">差</th></tr>
            </thead>
            <tbody>
                {% for key, name in ITEMS %}
                {% set s = data.sender_recorded[key] %}
                {% set rc = data.receiver_recorded[key] %}
                {% if s or rc %}
                <tr class="{{ 'bg-red-50' if data.diffs.get(key) else '' }}">
                    <td class="border px-2 py-1">{{ name }}</td>
                    <td class="border px-2 py-1 text-right">{{ s|int }}</td>
                    <td class="border px-2 py-1 text-right">{{ rc|int }}</td>
                    <td class="border px-2 py-1 text-right font-semibold text-red-600">
                        {{ data.diffs.get(key, '')|int if data.diffs.get(key) else '' }}
                    </td>
                </tr>
                {% endif %}
                {% endfor %}
            </tbody>
        </table>
    </div>
    {% endfor %}

    <div class="flex gap-2">
        {% if r.status == 'pending_approval' %}
            {% if party == r.approver_party %}
            <form method="POST" action="/reconcile/{{ r.id }}/approve">
                <button class="px-4 py-2 bg-green-600 text-white rounded">同意</button>
            </form>
            <details class="inline-block">
                <summary class="px-4 py-2 bg-red-500 text-white rounded cursor-pointer">打回</summary>
                <form method="POST" action="/reconcile/{{ r.id }}/reject" class="mt-2 p-3 bg-white border rounded">
                    <textarea name="notes" placeholder="说明原因" required class="w-full border rounded p-2 text-sm"></textarea>
                    <button class="mt-2 px-3 py-1 bg-red-500 text-white text-sm rounded">提交打回</button>
                </form>
            </details>
            {% endif %}
            {% if party == r.initiator_party %}
            <form method="POST" action="/reconcile/{{ r.id }}/withdraw">
                <button class="px-4 py-2 bg-gray-500 text-white rounded">撤回</button>
            </form>
            {% endif %}
        {% elif r.status == 'confirmed' %}
            <form method="POST" action="/reconcile/{{ r.id }}/cancel"
                  onsubmit="return confirm('撤销对账会解锁范围内所有记录，确认？')">
                <button class="px-4 py-2 bg-orange-500 text-white rounded">撤销对账</button>
            </form>
        {% endif %}
        <a href="/reconcile" class="px-4 py-2 bg-gray-200 text-gray-700 rounded">返回</a>
    </div>
</div>
{% endblock %}
```

- [ ] **Step 4: 跑 PASS**

```bash
pytest tests/test_reconcile_ui.py -v
```

- [ ] **Step 5: 在 party.html 里接通"发起对账" modal**

替换 `openReconcileModal` JS，改为弹一个简单的 prompt（或完整 modal，视时间选择）：

```javascript
function openReconcileModal(party, cp) {
    const df = prompt('开始日期 (YYYY-MM-DD)');
    if (!df) return;
    const dt = prompt('结束日期 (YYYY-MM-DD)');
    if (!dt) return;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/reconcile/start';
    form.innerHTML = `
        <input name="counterparty" value="${cp}">
        <input name="date_from" value="${df}">
        <input name="date_to" value="${dt}">
    `;
    document.body.appendChild(form);
    form.submit();
}
```

（后续可替换成更漂亮的 modal。）

- [ ] **Step 6: Commit**

```bash
git add app.py templates/reconcile_list.html templates/reconcile_detail.html templates/party.html tests/test_reconcile_ui.py
git commit -m "feat(huadeng): reconcile center list + detail page"
```

---

## Phase 5: 汇总报表

### Task 15: `/reports` 路由 + reports.html 改数据源

**Files:**
- Modify: `app.py` (/reports route)
- Modify: `templates/reports.html`
- Create: `tests/test_reports.py`

- [ ] **Step 1: 写测试**

`tests/test_reports.py`:
```python
import sqlite3
import app as app_module


def _insert(recorded_by='hd', from_p='hd', to_p='sy', date='2026-05-01', jx_qty=0, gx_qty=0, mkb_qty=0):
    con = sqlite3.connect(app_module.DATABASE)
    con.execute("""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, jx_qty, gx_qty, mkb_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (recorded_by, from_p, to_p, date, jx_qty, gx_qty, mkb_qty))
    con.commit(); con.close()


def test_reports_uses_sender_records(client):
    """发方记录是权威数据；收方记录应被忽略（不翻倍）。"""
    _insert(recorded_by='hd', from_p='hd', to_p='sy', jx_qty=100)
    _insert(recorded_by='sy', from_p='hd', to_p='sy', jx_qty=100)  # 收方镜像
    rv = client.get('/reports')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    # HD→SY 的胶箱应为 100（不是 200）
    assert '100' in html
    # 简单断言不要有翻倍：看上下文更严格的测试可 parse HTML


def test_reports_triangle_debt_net(client):
    """华登发邵阳 100 胶箱，邵阳发华登 30 胶箱 → 邵阳欠华登 70 胶箱。"""
    _insert(recorded_by='hd', from_p='hd', to_p='sy', jx_qty=100)
    _insert(recorded_by='sy', from_p='sy', to_p='hd', jx_qty=30)
    rv = client.get('/reports')
    html = rv.data.decode('utf-8')
    # triangle_display 应该反映净欠 70 在 HD↔SY 行
    # 粗筛：html 里有 '70' 字样
    assert '70' in html
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现 /reports 路由**

把旧的 reports 路由替换掉。核心是：`channel_summaries` 改成按 (from_party, to_party) 聚合；三角债逻辑基本 copy 旧代码但改查询。

```python
# 3 个 pair（按字母序）
PAIRS = [('hd', 'sy'), ('hd', 'xx'), ('sy', 'xx')]


@app.route('/reports')
def reports():
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    only_confirmed = request.args.get('only_confirmed') == '1'

    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row

    prices = {r['item_key']: r['price']
              for r in con.execute('SELECT * FROM default_prices').fetchall()}

    # 每个方向的汇总（仅发方记录）
    direction_summaries = {}
    for a, b in PAIRS:
        for from_p, to_p in [(a, b), (b, a)]:
            direction_summaries[f'{from_p}_to_{to_p}'] = _sum_flow_records(
                con, from_party=from_p, to_party=to_p,
                only_sender=True, date_from=date_from, date_to=date_to,
                only_confirmed=only_confirmed,
            )

    # 三角债净欠
    triangle_rows = _build_triangle(direction_summaries, prices)
    pair_summary = _build_pair_summary(direction_summaries)

    con.close()
    return render_template('reports.html',
                           direction_summaries=direction_summaries,
                           triangle_rows=triangle_rows,
                           pair_summary=pair_summary,
                           date_from=date_from, date_to=date_to,
                           only_confirmed=only_confirmed,
                           PAIRS=PAIRS)


def _sum_flow_records(con, *, from_party, to_party, only_sender, date_from, date_to, only_confirmed):
    qty_cols_sql = ', '.join([f'COALESCE(SUM({k}_qty), 0) AS {k}_sum' for k, _ in ITEMS])
    sql = f"SELECT {qty_cols_sql} FROM flow_records WHERE from_party=? AND to_party=?"
    args = [from_party, to_party]
    if only_sender:
        sql += ' AND recorded_by=?'
        args.append(from_party)
    if date_from:
        sql += ' AND date >= ?'; args.append(date_from)
    if date_to:
        sql += ' AND date <= ?'; args.append(date_to)
    if only_confirmed:
        sql += " AND locked=1"
    row = con.execute(sql, args).fetchone()
    return {k: float(row[f'{k}_sum']) for k, _ in ITEMS}


def _build_triangle(direction_summaries, prices):
    """按 5 种三角债包材，构造三方互欠表。"""
    rows = []
    for idx, (a, b) in enumerate(PAIRS, 1):
        a_to_b = direction_summaries[f'{a}_to_{b}']
        b_to_a = direction_summaries[f'{b}_to_{a}']
        row = {'idx': idx, 'label': f'{PARTIES[a]["name"]}↔{PARTIES[b]["name"]}'}
        for k, _ in TRIANGLE_ITEMS:
            row[k] = int(a_to_b[k] - b_to_a[k])
        rows.append(row)
    return rows


def _build_pair_summary(direction_summaries):
    """按 pair 汇总净欠，生成'X 欠 Y 多少 item'文案。"""
    out = []
    for a, b in PAIRS:
        a_to_b = direction_summaries[f'{a}_to_{b}']
        b_to_a = direction_summaries[f'{b}_to_{a}']
        nets = {k: a_to_b[k] - b_to_a[k] for k, _ in TRIANGLE_ITEMS}
        out.append({'a': PARTIES[a]['name'], 'b': PARTIES[b]['name'], 'nets': nets})
    return out
```

- [ ] **Step 4: 改 reports.html**

保留主结构，改 template 变量名：

```html
{% extends "base.html" %}
{% block content %}
<div class="max-w-6xl mx-auto">
    <h1 class="text-xl font-bold mb-4">汇总报表</h1>
    <form method="GET" class="bg-white rounded p-3 mb-4 flex gap-3 items-end flex-wrap">
        <div><label class="block text-xs">开始</label>
            <input type="date" name="date_from" value="{{ date_from }}" class="border rounded px-2 py-1 text-sm"></div>
        <div><label class="block text-xs">结束</label>
            <input type="date" name="date_to" value="{{ date_to }}" class="border rounded px-2 py-1 text-sm"></div>
        <label class="flex items-center gap-1 text-sm">
            <input type="checkbox" name="only_confirmed" value="1" {{ 'checked' if only_confirmed else '' }}>
            仅已核对
        </label>
        <button class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded">筛选</button>
    </form>

    <!-- 方向汇总表 -->
    {% for p in PAIRS %}
    <div class="bg-white rounded p-4 mb-4">
        <h2 class="font-semibold mb-2">{{ PARTIES[p[0]].name }} ↔ {{ PARTIES[p[1]].name }}</h2>
        {% for from_p, to_p in [(p[0], p[1]), (p[1], p[0])] %}
        {% set s = direction_summaries[from_p + '_to_' + to_p] %}
        <h3 class="text-sm font-medium mt-2">{{ PARTIES[from_p].name }} → {{ PARTIES[to_p].name }}</h3>
        <table class="text-sm w-full border-collapse mb-2">
            <thead class="bg-gray-50"><tr>
                <th class="border px-2 py-1">包材</th><th class="border px-2 py-1">数量</th></tr>
            </thead>
            <tbody>
                {% for key, name in ITEMS %}
                {% if s[key] %}
                <tr><td class="border px-2 py-1">{{ name }}</td>
                    <td class="border px-2 py-1 text-right">{{ s[key]|int }}</td></tr>
                {% endif %}
                {% endfor %}
            </tbody>
        </table>
        {% endfor %}
    </div>
    {% endfor %}

    <!-- 三角债 -->
    <div class="mb-6 border-2 border-gray-800">
        <div class="bg-yellow-300 py-3 text-center font-bold">三方包材往来净欠表</div>
        <table class="w-full text-center text-sm">
            <thead><tr>
                <th class="border px-3 py-2">车间</th>
                {% for k, n in STAT_ITEMS %}<th class="border px-3 py-2">{{ n }}</th>{% endfor %}
            </tr></thead>
            <tbody>
                {% for row in triangle_rows %}
                <tr>
                    <td class="border px-3 py-2 font-medium">{{ row.label }}</td>
                    {% for k, n in STAT_ITEMS %}
                    <td class="border px-3 py-2">{{ row[k] if row[k] else '' }}</td>
                    {% endfor %}
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </div>

    <!-- 债务总结 -->
    <div class="bg-white rounded p-4 mb-4">
        <h2 class="font-semibold mb-2">两两净额</h2>
        {% for p in pair_summary %}
        <div class="mb-2">
            <b>{{ p.a }} ↔ {{ p.b }}：</b>
            {% set has_debt = false %}
            {% for k, n in STAT_ITEMS %}
            {% set v = p.nets[k] %}
            {% if v > 0 %}
                <span class="text-red-600">{{ p.b }} 欠 {{ p.a }} {{ n }} {{ v|int }} 个</span>.
            {% elif v < 0 %}
                <span class="text-red-600">{{ p.a }} 欠 {{ p.b }} {{ n }} {{ (-v)|int }} 个</span>.
            {% endif %}
            {% endfor %}
        </div>
        {% endfor %}
    </div>
</div>
{% endblock %}
```

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_reports.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/reports.html tests/test_reports.py
git commit -m "feat(huadeng): reports page with new flow_records data source"
```

---

### Task 16: 月度明细表（含"A发/B发/净欠"）

**Files:**
- Modify: `app.py` (reports 里加月度聚合)
- Modify: `templates/reports.html`
- Modify: `tests/test_reports.py`（追加）

- [ ] **Step 1: 追加测试**

```python
def test_reports_monthly_detail(client):
    _insert(recorded_by='hd', from_p='hd', to_p='sy', date='2026-05-01', jx_qty=100)
    _insert(recorded_by='sy', from_p='sy', to_p='hd', date='2026-05-02', jx_qty=30)
    _insert(recorded_by='hd', from_p='hd', to_p='sy', date='2026-06-01', jx_qty=50)
    rv = client.get('/reports')
    html = rv.data.decode('utf-8')
    assert '2026-05' in html
    assert '2026-06' in html
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现月度聚合**

在 reports 路由里加：

```python
# 月度明细
monthly_by_pair = {}
for a, b in PAIRS:
    by_month = {}  # ym -> {'a_sent': {...}, 'b_sent': {...}}
    for from_p, to_p in [(a, b), (b, a)]:
        rows = con.execute(f"""
            SELECT substr(date, 1, 7) AS ym,
                   {', '.join(['COALESCE(SUM(' + k + '_qty), 0) AS ' + k + '_sum' for k, _ in STAT_ITEMS])}
            FROM flow_records
            WHERE from_party=? AND to_party=? AND recorded_by=?
            GROUP BY ym ORDER BY ym
        """, (from_p, to_p, from_p)).fetchall()
        for r in rows:
            ym = r['ym']
            bucket = by_month.setdefault(ym, {'a_sent': {}, 'b_sent': {}})
            key = 'a_sent' if from_p == a else 'b_sent'
            for k, _ in STAT_ITEMS:
                bucket[key][k] = float(r[f'{k}_sum'])
    # 计算 net per month
    for ym, d in by_month.items():
        d['net'] = {}
        for k, _ in STAT_ITEMS:
            d['net'][k] = d.get('a_sent', {}).get(k, 0) - d.get('b_sent', {}).get(k, 0)
    monthly_by_pair[(a, b)] = {'a': PARTIES[a]['name'], 'b': PARTIES[b]['name'],
                               'months': sorted(by_month.items())}
```

把 `monthly_by_pair` 传给模板。

- [ ] **Step 4: 在 reports.html 末尾加折叠面板**

```html
<details class="bg-white rounded p-3 mb-4">
    <summary class="cursor-pointer font-semibold">▶ 各月份往来明细</summary>
    {% for pair_key, p in monthly_by_pair.items() %}
    <div class="mt-3">
        <h3 class="text-sm font-medium">{{ p.a }} ↔ {{ p.b }}</h3>
        <table class="text-xs w-full border-collapse">
            <thead><tr class="bg-gray-50">
                <th rowspan="2" class="border px-2 py-1">月份</th>
                {% for k, n in STAT_ITEMS %}<th colspan="3" class="border px-2 py-1">{{ n }}</th>{% endfor %}
            </tr><tr class="bg-gray-50">
                {% for k, n in STAT_ITEMS %}
                <th class="border px-2 py-1">{{ p.a }}发</th>
                <th class="border px-2 py-1">{{ p.b }}发</th>
                <th class="border px-2 py-1">净欠</th>
                {% endfor %}
            </tr></thead>
            <tbody>
                {% for ym, m in p.months %}
                <tr>
                    <td class="border px-2 py-1">{{ ym }}</td>
                    {% for k, n in STAT_ITEMS %}
                    <td class="border px-2 py-1 text-right">{{ (m.a_sent[k] or 0)|int }}</td>
                    <td class="border px-2 py-1 text-right">{{ (m.b_sent[k] or 0)|int }}</td>
                    <td class="border px-2 py-1 text-right font-semibold">
                        {% set v = m.net[k] %}
                        {% if v > 0 %}+{{ v|int }}{% elif v < 0 %}{{ v|int }}{% else %}—{% endif %}
                    </td>
                    {% endfor %}
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </div>
    {% endfor %}
</details>
```

- [ ] **Step 5: 跑 PASS**

- [ ] **Step 6: Commit**

```bash
git add app.py templates/reports.html tests/test_reports.py
git commit -m "feat(huadeng): monthly pair details in reports"
```

---

## Phase 6: Excel 导入

### Task 17: 导入列映射配置 + 解析器

**Files:**
- Create: `app.py` 里加 `IMPORT_CONFIGS` 字典
- Create: `tests/test_excel_import_parse.py`

- [ ] **Step 1: 手工看 Excel 文件列头，填 IMPORT_CONFIGS**

（实施者需打开每个 xlsx，记录每个 sheet 的列序，填到 dict 里。）

`IMPORT_CONFIGS` dict 结构：
```python
IMPORT_CONFIGS = {
    'huadeng_qingxi_shaoyang': {
        # 26年清溪华登与邵阳华登包材对数表.xlsx
        'filename_pattern': '清溪华登',
        'sheets': {
            '1月': {'direction': 'hd_to_sy', 'start_row': 3,
                    'columns': {0: 'date', 1: 'order_no', 2: 'jx_qty', ...}},
            # ...
        },
    },
    # ... 5 种文件各一条
}
```

（实施者按实际列调校。）

- [ ] **Step 2: 写解析测试**

`tests/test_excel_import_parse.py`:
```python
import os
import openpyxl
from io import BytesIO
import app as app_module


def test_parse_sheet_returns_rows(tmp_path):
    """构造一个迷你 xlsx 文件 → 跑 parse_sheet → 验证。"""
    path = tmp_path / 'test.xlsx'
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'test_sheet'
    ws['A1'] = '测试'
    ws['A2'] = '日期'; ws['B2'] = '订单号'; ws['C2'] = '胶箱'
    ws['A3'] = '2026-01-01'; ws['B3'] = 'ORD1'; ws['C3'] = 5
    ws['A4'] = '2026-01-02'; ws['B4'] = 'ORD2'; ws['C4'] = 10
    wb.save(path)

    rows = app_module.parse_excel_sheet(
        str(path), 'test_sheet',
        start_row=3,
        columns={0: 'date', 1: 'order_no', 2: 'jx_qty'}
    )
    assert len(rows) == 2
    assert rows[0]['date'] == '2026-01-01'
    assert rows[0]['jx_qty'] == 5
```

- [ ] **Step 3: 实现 parse_excel_sheet**

```python
import openpyxl
from datetime import datetime, date as date_cls


def parse_excel_sheet(filepath, sheet_name, start_row, columns):
    """读一个 sheet 按 columns 配置提取行。

    columns: {excel_col_index(0-based): target_field_name}
    start_row: 1-based 数据起始行
    """
    wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
    ws = wb[sheet_name]
    rows = []
    for i, excel_row in enumerate(ws.iter_rows(values_only=True), start=1):
        if i < start_row:
            continue
        if all(v is None for v in excel_row):
            continue
        row = {}
        for idx, field in columns.items():
            if idx >= len(excel_row):
                continue
            v = excel_row[idx]
            if v is None:
                continue
            if field == 'date':
                if isinstance(v, (datetime, date_cls)):
                    row[field] = v.strftime('%Y-%m-%d')
                else:
                    row[field] = str(v).strip()[:10]
            elif field.endswith('_qty'):
                try:
                    row[field] = float(v)
                except (ValueError, TypeError):
                    row[field] = 0
            else:
                row[field] = str(v).strip()
        if 'date' in row:
            rows.append(row)
    return rows
```

- [ ] **Step 4: 跑 PASS**

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_excel_import_parse.py
git commit -m "feat(huadeng): Excel sheet parser"
```

---

### Task 18: 导入 UI + /import/preview + /import/commit

**Files:**
- Modify: `app.py`
- Create: `templates/import_preview.html`
- Create: `tests/test_excel_import_flow.py`

- [ ] **Step 1: 写测试**

`tests/test_excel_import_flow.py`:
```python
import sqlite3
import openpyxl
import app as app_module


def _login(client, p='hd'):
    with client.session_transaction() as s:
        s['party'] = p


def test_import_commits_rows(client, tmp_path):
    """上传 xlsx → 选 sheet + 方向 → 提交 → 入库。"""
    _login(client, 'hd')
    path = tmp_path / 'test.xlsx'
    wb = openpyxl.Workbook()
    ws = wb.active; ws.title = 'sheet1'
    ws['A2'] = '日期'; ws['B2'] = '订单号'; ws['C2'] = '胶箱'
    ws['A3'] = '2026-01-01'; ws['B3'] = 'ORD1'; ws['C3'] = 5
    wb.save(path)

    # 提交（内部流程：upload + commit 一步完成给测试用）
    with open(path, 'rb') as f:
        rv = client.post('/import/commit',
                         data={
                             'sheet_name': 'sheet1',
                             'start_row': '3',
                             'direction': 'hd_to_sy',
                             'col_date': '0', 'col_order_no': '1', 'col_jx_qty': '2',
                             'file': (f, 'test.xlsx'),
                         },
                         content_type='multipart/form-data')
    assert rv.status_code == 302
    con = sqlite3.connect(app_module.DATABASE)
    row = con.execute(
        "SELECT recorded_by, from_party, to_party, date, order_no, jx_qty FROM flow_records"
    ).fetchone()
    assert row == ('hd', 'hd', 'sy', '2026-01-01', 'ORD1', 5.0)
```

- [ ] **Step 2: 跑 FAIL**

- [ ] **Step 3: 实现 /import 页 + /import/commit**

```python
ALLOWED_DIRECTIONS = {
    'hd_to_sy': ('hd', 'sy'), 'sy_to_hd': ('sy', 'hd'),
    'hd_to_xx': ('hd', 'xx'), 'xx_to_hd': ('xx', 'hd'),
    'sy_to_xx': ('sy', 'xx'), 'xx_to_sy': ('xx', 'sy'),
}


@app.route('/import', methods=['GET', 'POST'])
def import_page():
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    if request.method == 'POST' and 'file' in request.files:
        # 上传 → 存 tmp → 读 sheet names → render preview
        f = request.files['file']
        tmp_path = os.path.join(DATA_PATH, 'upload_tmp.xlsx')
        f.save(tmp_path)
        wb = openpyxl.load_workbook(tmp_path, read_only=True)
        sheets = wb.sheetnames
        wb.close()
        return render_template('import_preview.html', party=party, sheets=sheets,
                               filename=f.filename, ALLOWED_DIRECTIONS=ALLOWED_DIRECTIONS)
    return render_template('import_preview.html', party=party,
                           ALLOWED_DIRECTIONS=ALLOWED_DIRECTIONS)


@app.route('/import/commit', methods=['POST'])
def import_commit():
    party = current_party()
    if not party:
        return redirect(url_for('index'))

    # 从 form 或 file 拿
    file = request.files.get('file')
    if file:
        tmp_path = os.path.join(DATA_PATH, 'upload_tmp.xlsx')
        file.save(tmp_path)
    else:
        tmp_path = os.path.join(DATA_PATH, 'upload_tmp.xlsx')

    sheet_name = request.form.get('sheet_name')
    start_row = int(request.form.get('start_row', 3))
    direction = request.form.get('direction')
    if direction not in ALLOWED_DIRECTIONS:
        flash('无效方向'); return redirect(url_for('import_page'))
    from_p, to_p = ALLOWED_DIRECTIONS[direction]

    # party 必须能录这个方向
    if party not in (from_p, to_p):
        flash('无权导入此方向'); return redirect(url_for('import_page'))

    # 列映射（从 form 里读每个字段的列号）
    columns = {}
    for key in ['date', 'order_no', 'remark'] + [f'{k}_qty' for k, _ in ITEMS]:
        col = request.form.get(f'col_{key}')
        if col is not None and col != '':
            try:
                columns[int(col)] = key
            except ValueError:
                pass

    rows = parse_excel_sheet(tmp_path, sheet_name, start_row, columns)

    qty_cols = [f'{k}_qty' for k, _ in ITEMS]
    con = sqlite3.connect(DATABASE)
    for r in rows:
        args = [party, from_p, to_p, r.get('date'), r.get('order_no'), r.get('remark')]
        args += [r.get(c, 0) for c in qty_cols]
        placeholders = ', '.join(['?'] * len(args))
        con.execute(f"""
            INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, remark,
                                      {', '.join(qty_cols)})
            VALUES ({placeholders})
        """, args)
    con.commit(); con.close()
    flash(f'导入 {len(rows)} 条')
    return redirect(url_for('party_page', party=party))
```

- [ ] **Step 4: 写 import_preview.html**

```html
{% extends "base.html" %}
{% block title %}导入 Excel{% endblock %}
{% block content %}
<div class="max-w-3xl mx-auto bg-white rounded p-4">
    <h1 class="text-xl font-bold mb-4">导入 Excel 流水</h1>
    {% if not sheets %}
    <form method="POST" enctype="multipart/form-data" class="space-y-3">
        <input type="file" name="file" accept=".xlsx" required class="block">
        <button class="px-3 py-1.5 bg-blue-600 text-white rounded">上传 → 读 sheet</button>
    </form>
    {% else %}
    <form method="POST" action="/import/commit" enctype="multipart/form-data" class="space-y-3">
        <!-- 重新带一次 file，让 commit 能重新读 -->
        <input type="file" name="file" accept=".xlsx" required class="block">
        <label class="block">
            Sheet:
            <select name="sheet_name" class="border rounded px-2 py-1 text-sm">
                {% for s in sheets %}<option value="{{ s }}">{{ s }}</option>{% endfor %}
            </select>
        </label>
        <label class="block">
            起始行 (1-based):
            <input type="number" name="start_row" value="3" class="border rounded px-2 py-1 text-sm w-20">
        </label>
        <label class="block">
            方向:
            <select name="direction" class="border rounded px-2 py-1 text-sm">
                {% for key, (f, t) in ALLOWED_DIRECTIONS.items() %}
                <option value="{{ key }}">{{ PARTIES[f].name }} → {{ PARTIES[t].name }}</option>
                {% endfor %}
            </select>
        </label>
        <details>
            <summary class="cursor-pointer">列映射（0-based Excel 列号）</summary>
            <div class="grid grid-cols-3 gap-2 mt-2 text-sm">
                <label>date <input type="number" name="col_date" class="border rounded w-16"></label>
                <label>order_no <input type="number" name="col_order_no" class="border rounded w-16"></label>
                <label>remark <input type="number" name="col_remark" class="border rounded w-16"></label>
                {% for k, name in ITEMS %}
                <label>{{ name }}({{ k }}) <input type="number" name="col_{{ k }}_qty" class="border rounded w-16"></label>
                {% endfor %}
            </div>
        </details>
        <button class="px-3 py-1.5 bg-green-600 text-white rounded">提交入库</button>
    </form>
    {% endif %}
</div>
{% endblock %}
```

- [ ] **Step 5: 跑 PASS**

```bash
pytest tests/test_excel_import_flow.py -v
```

- [ ] **Step 6: Commit**

```bash
git add app.py templates/import_preview.html tests/test_excel_import_flow.py
git commit -m "feat(huadeng): Excel import upload + commit flow"
```

---

### Task 19: 手工导入真实文件 + 校对

**Files:** (no code changes, 仅本地跑 + 确认)

此任务是用户亲自跑的，但在 plan 里列出供参考。

- [ ] **Step 1: 本地启动 app**

```bash
python app.py
```

- [ ] **Step 2: 依次导入 5 个 Excel 文件**

用 hd/sy/xx 对应账号登录 → `/import` → 上传对应文件 → 选 sheet + 方向 + 列映射 → 提交。

- [ ] **Step 3: 进 `/reports` 对比数字**

和旧系统 / Excel 里的汇总一致。

- [ ] **Step 4: 跑一次跨方对账**

- [ ] **Step 5: 发现 bug 就追加 task 修**

---

## Phase 7: 生产部署

### Task 20: 部署到服务器

**Files:** (no code, 部署操作)

- [ ] **Step 1: 本地确认所有测试通过**

```bash
pytest -v
```

- [ ] **Step 2: 本地数据备份**

```bash
cp huadeng.db huadeng.db.bak-v2-localverify
```

- [ ] **Step 3: 本地跑迁移脚本 + 验证**

```bash
python scripts/migrate_to_v2.py huadeng.db
python app.py  # 起来试点
```

- [ ] **Step 4: push 分支 + 合到 main**

```bash
git push -u origin feat/huadeng-party-v2
gh pr create --title "refactor(huadeng): party-centric redesign (supersedes scheme B)" \
  --body "see docs/superpowers/specs/2026-04-24-party-centric-reconcile-redesign.md"
```

Merge 后：

- [ ] **Step 5: 服务器迁移**

```bash
ssh rr-portal
cd /opt/rr-portal
docker compose stop huadeng
docker exec rr-portal-huadeng-1 python scripts/migrate_to_v2.py /app/data/huadeng.db
./devops/scripts/safe-redeploy.sh huadeng
```

- [ ] **Step 6: 烟测**

```bash
curl https://<domain>/huadeng/health
```

浏览器验证三账号登录、数据可见。

- [ ] **Step 7: 失败则回滚**

```bash
docker compose stop huadeng
docker exec rr-portal-huadeng-1 cp /app/data/huadeng.db.bak-* /app/data/huadeng.db
git revert <merge-commit> && push
./devops/scripts/safe-redeploy.sh huadeng
```

---

## 成功判据（Plan 级别）

- [ ] Phase 1 完成：`pytest tests/test_schema.py tests/test_migration.py` 全绿
- [ ] Phase 2 完成：三 party 账号都能登录，看到对应首页
- [ ] Phase 3 完成：每 party 4 张表能正常 CRUD，锁定校验生效
- [ ] Phase 4 完成：完整跑一轮核对（发起→审批→锁定 / 打回 / 撤回 / 撤销）
- [ ] Phase 5 完成：`/reports` 数字和手工核对一致
- [ ] Phase 6 完成：5 种 Excel 模板都能导入
- [ ] 手工 E2E 没明显 bug
- [ ] Migration 在本地真实 db 上跑通，数据 count 符合预期
