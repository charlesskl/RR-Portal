// Schema for 啤机外发系统. Run on every server boot; CREATE TABLE IF NOT EXISTS
// makes it idempotent so existing tables aren't touched.
const db = require('./connection');

function init() {
  db.exec(`
    -- ========== 外发订单 ==========
    CREATE TABLE IF NOT EXISTS orders (
      id                     TEXT PRIMARY KEY,
      seq                    TEXT,
      workshop               TEXT,
      item_code              TEXT,
      mold                   TEXT,
      order_qty_pcs          INTEGER,
      order_qty_shots        INTEGER,
      target_qty             INTEGER,
      quoted_capacity        INTEGER,
      actual_capacity        INTEGER,
      quote_price_usd        REAL,
      supplier_price_rmb     REAL,
      supplier_price_usd     REAL,
      supplier               TEXT,
      pmc_follow             TEXT,
      order_date             TEXT,
      production_start       TEXT,
      estimated_delivery     TEXT,
      remark                 TEXT,
      status                 TEXT DEFAULT 'open',
      net_outsource_output   REAL,
      source_bill_no         TEXT,
      source_customer        TEXT,
      source_production_no   TEXT,
      source_mold_code       TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_workshop      ON orders(workshop);
    CREATE INDEX IF NOT EXISTS idx_orders_supplier      ON orders(supplier);
    CREATE INDEX IF NOT EXISTS idx_orders_pmc           ON orders(pmc_follow);
    CREATE INDEX IF NOT EXISTS idx_orders_source_bill   ON orders(source_bill_no);
    CREATE INDEX IF NOT EXISTS idx_orders_source_mold   ON orders(source_mold_code);
    CREATE INDEX IF NOT EXISTS idx_orders_created       ON orders(created_at);

    -- ========== 加工厂明细 ==========
    CREATE TABLE IF NOT EXISTS suppliers (
      id              TEXT PRIMARY KEY,
      seq             TEXT,
      name            TEXT,
      total_machines  INTEGER,
      machines_for_xx INTEGER,
      xx_ratio        REAL,
      actual_running  INTEGER,
      running_rate    REAL,
      contact         TEXT,
      address         TEXT,
      mold_count      INTEGER,
      remark          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

    -- ========== 模具映射记忆 ==========
    CREATE TABLE IF NOT EXISTS mold_mappings (
      mold_code   TEXT PRIMARY KEY,
      supplier    TEXT,
      target_qty  INTEGER,
      workshop    TEXT,
      mold_name   TEXT,
      updated_at  TEXT
    );

    -- ========== PC 料外发 ==========
    CREATE TABLE IF NOT EXISTS pc_orders (
      id         TEXT PRIMARY KEY,
      seq        TEXT,
      factory    TEXT,
      item_code  TEXT,
      mold       TEXT,
      mold_sets  TEXT,
      remark     TEXT
    );
  `);
}

module.exports = { init };
