-- 公司内部报价明细系统 schema v1
-- 字段细节 (payload_json) 待用户提供导出模板后在 P2 阶段扩展

PRAGMA foreign_keys = ON;

-- 厂区：账号登录后进入所属厂区；管理员可切换活动厂区
CREATE TABLE IF NOT EXISTS factories (
  code       TEXT PRIMARY KEY,
  name_cn    TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

-- 部门表：固定 5 行，启动时若空则种入默认数据
CREATE TABLE IF NOT EXISTS departments (
  code           TEXT PRIMARY KEY,           -- sales / engineering / molding / painting / assembly
  name_cn        TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  pin_staff      TEXT NOT NULL,              -- bcrypt hash
  pin_supervisor TEXT NOT NULL               -- bcrypt hash
);

-- 报价单
CREATE TABLE IF NOT EXISTS quotes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no         TEXT NOT NULL,
  product_name     TEXT NOT NULL,
  customer         TEXT,
  qty              INTEGER,
  created_by_dept  TEXT NOT NULL DEFAULT 'sales',
  created_by_name  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  status           TEXT NOT NULL DEFAULT 'drafting',  -- drafting / fully_approved / exported
  version          TEXT,  -- 版本标签：同一产品的不同报价版本（如 V1 / 改色版）
  factory_code     TEXT NOT NULL DEFAULT 'qingxi' REFERENCES factories(code),
  UNIQUE(factory_code, quote_no)
);

-- 每报价单 × 每部门 = 一行 section（创建报价时自动 5 行）
CREATE TABLE IF NOT EXISTS quote_sections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  dept            TEXT    NOT NULL REFERENCES departments(code),
  payload_json    TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'empty',  -- empty / filled / approved / rejected
  filled_by       TEXT,
  filled_at       TEXT,
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  review_comment  TEXT,
  UNIQUE(quote_id, dept)
);

CREATE INDEX IF NOT EXISTS idx_sections_quote ON quote_sections(quote_id);
CREATE INDEX IF NOT EXISTS idx_sections_dept_status ON quote_sections(dept, status);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id  INTEGER,
  dept      TEXT,
  actor     TEXT,
  action    TEXT NOT NULL,    -- login / fill / submit / approve / reject / export
  detail    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_quote ON audit_log(quote_id);

-- 全局参考表 — 单行 JSON，新报价单从这里读默认数据，编辑后写回
CREATE TABLE IF NOT EXISTS ref_tables (
  key        TEXT PRIMARY KEY,           -- 'material_prices' / 'machine_prices'
  data_json  TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS app_migrations (
  key        TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 厂区参考参数。当前先从全局参数复制，后续清溪/河源可分别维护。
CREATE TABLE IF NOT EXISTS factory_ref_tables (
  factory_code TEXT NOT NULL REFERENCES factories(code),
  key          TEXT NOT NULL,
  data_json    TEXT NOT NULL DEFAULT '[]',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   TEXT,
  PRIMARY KEY (factory_code, key)
);

-- 用户账号（替代旧的部门 PIN 登录）
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  dept          TEXT NOT NULL REFERENCES departments(code),
  role          TEXT NOT NULL DEFAULT 'staff',   -- staff / supervisor / admin
  factory_code  TEXT NOT NULL DEFAULT 'qingxi' REFERENCES factories(code),
  locked_until  TEXT,
  login_fails   INTEGER NOT NULL DEFAULT 0,
  last_login    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_dept ON users(dept);

-- User-to-factory access; users.factory_code remains the default factory.
CREATE TABLE IF NOT EXISTS user_factories (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factory_code TEXT NOT NULL REFERENCES factories(code),
  PRIMARY KEY (user_id, factory_code)
);

-- 用户 × 可见客户（多对多；空表 = 看不到任何报价单；admin 不受限）
CREATE TABLE IF NOT EXISTS user_customers (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer TEXT    NOT NULL,
  PRIMARY KEY (user_id, customer)
);

-- 用户 × 菜单 × 4 位权限
CREATE TABLE IF NOT EXISTS user_perms (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  menu       TEXT    NOT NULL,
  can_view   INTEGER NOT NULL DEFAULT 0,
  can_edit   INTEGER NOT NULL DEFAULT 0,
  can_review INTEGER NOT NULL DEFAULT 0,
  can_admin  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, menu)
);
