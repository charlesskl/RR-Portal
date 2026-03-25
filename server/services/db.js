const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/quotation.db');

let db = null;

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Product (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_no TEXT NOT NULL,
      item_desc TEXT,
      vendor TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS QuoteVersion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES Product(id) ON DELETE CASCADE,
      version_name TEXT,
      source_sheet TEXT,
      date_code TEXT,
      quote_date TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS QuoteParams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      hkd_rmb_quote REAL,
      hkd_rmb_check REAL,
      rmb_hkd REAL,
      hkd_usd REAL,
      markup_body REAL,
      markup_packaging REAL,
      labor_hkd REAL,
      box_price_hkd REAL,
      tax_point REAL,
      markup_point REAL,
      payment_divisor REAL,
      surcharge_pct REAL,
      mold_subsidy REAL
    );

    CREATE TABLE IF NOT EXISTS MaterialPrice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      material_type TEXT,
      price_hkd_per_lb REAL,
      price_hkd_per_g REAL,
      price_rmb_per_g REAL
    );

    CREATE TABLE IF NOT EXISTS MachinePrice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      machine_type TEXT,
      price_hkd REAL,
      price_rmb REAL
    );

    CREATE TABLE IF NOT EXISTS MoldPart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      part_no TEXT,
      description TEXT,
      material TEXT,
      weight_g REAL,
      unit_price_hkd_g REAL,
      machine_type TEXT,
      cavity_count INTEGER,
      sets_per_toy INTEGER,
      target_qty INTEGER,
      molding_labor REAL,
      material_cost_hkd REAL,
      mold_cost_rmb REAL,
      remark TEXT,
      is_old_mold INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS HardwareItem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      name TEXT,
      quantity REAL,
      old_price REAL,
      new_price REAL,
      difference REAL,
      tax_type TEXT,
      remark TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ElectronicItem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      part_name TEXT,
      spec TEXT,
      quantity REAL,
      unit_price_usd REAL,
      total_usd REAL,
      remark TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ElectronicSummary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      parts_cost REAL,
      bonding_cost REAL,
      smt_cost REAL,
      labor_cost REAL,
      test_cost REAL,
      packaging_transport REAL,
      total_cost REAL,
      profit_margin REAL,
      final_price_usd REAL,
      pcb_mold_cost_usd REAL
    );

    CREATE TABLE IF NOT EXISTS PaintingDetail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      labor_cost_hkd REAL,
      paint_cost_hkd REAL,
      clamp_count INTEGER,
      print_count INTEGER,
      wipe_count INTEGER,
      edge_count INTEGER,
      spray_count INTEGER,
      total_operations INTEGER,
      quoted_price_hkd REAL
    );

    CREATE TABLE IF NOT EXISTS PackagingItem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      name TEXT,
      quantity REAL,
      old_price REAL,
      new_price REAL,
      difference REAL,
      tax_type TEXT,
      remark TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS TransportConfig (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      cuft_per_box REAL,
      pcs_per_box INTEGER,
      truck_10t_cuft REAL,
      truck_5t_cuft REAL,
      container_40_cuft REAL,
      container_20_cuft REAL,
      hk_40_cost REAL,
      hk_20_cost REAL,
      yt_40_cost REAL,
      yt_20_cost REAL,
      hk_10t_cost REAL,
      yt_10t_cost REAL,
      hk_5t_cost REAL,
      yt_5t_cost REAL,
      transport_pct REAL,
      handling_pct REAL
    );

    CREATE TABLE IF NOT EXISTS MoldCost (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      mold_cost_rmb REAL,
      hardware_mold_cost_rmb REAL,
      paint_mold_cost_rmb REAL,
      total_mold_rmb REAL,
      total_mold_usd REAL,
      customer_subsidy_usd REAL,
      amortization_qty INTEGER,
      amortization_rmb REAL,
      amortization_usd REAL,
      customer_quote_usd REAL
    );

    CREATE TABLE IF NOT EXISTS ProductDimension (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      product_l_inch REAL,
      product_w_inch REAL,
      product_h_inch REAL,
      carton_l_inch REAL,
      carton_paper TEXT,
      carton_w_inch REAL,
      carton_h_inch REAL,
      carton_cuft REAL,
      carton_price REAL,
      pcs_per_carton INTEGER
    );
  `);

  return db;
}

function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}

module.exports = { initDb, getDb };
