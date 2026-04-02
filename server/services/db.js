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

    CREATE TABLE IF NOT EXISTS RawMaterial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'plastic',
      material_name TEXT,
      spec TEXT,
      weight_g REAL,
      unit_price_per_kg REAL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS BodyAccessory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      part_no TEXT,
      description TEXT,
      moq INTEGER DEFAULT 2500,
      usage_qty REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS SewingDetail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      product_name TEXT,
      fabric_name TEXT,
      position TEXT,
      cut_pieces INTEGER,
      usage_amount REAL,
      material_price_rmb REAL,
      price_rmb REAL,
      markup_point REAL DEFAULT 1.15,
      total_price_rmb REAL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS RotocastItem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES QuoteVersion(id) ON DELETE CASCADE,
      mold_no TEXT,
      name TEXT,
      output_qty INTEGER,
      usage_pcs INTEGER DEFAULT 1,
      unit_price_hkd REAL,
      total_hkd REAL,
      remark TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);

  // Migrate: add header fields to QuoteVersion if they don't exist yet
  const existingCols = db.prepare('PRAGMA table_info(QuoteVersion)').all().map(c => c.name);
  const migrations = [
    'ALTER TABLE QuoteVersion ADD COLUMN item_rev TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN prepared_by TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN quote_rev TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN fty_delivery_date TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN body_no TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN bd_prepared_by TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN bd_date TEXT',
    'ALTER TABLE QuoteVersion ADD COLUMN body_cost_revision TEXT',
  ];
  const colMap = {
    'ALTER TABLE QuoteVersion ADD COLUMN item_rev TEXT': 'item_rev',
    'ALTER TABLE QuoteVersion ADD COLUMN prepared_by TEXT': 'prepared_by',
    'ALTER TABLE QuoteVersion ADD COLUMN quote_rev TEXT': 'quote_rev',
    'ALTER TABLE QuoteVersion ADD COLUMN fty_delivery_date TEXT': 'fty_delivery_date',
    'ALTER TABLE QuoteVersion ADD COLUMN body_no TEXT': 'body_no',
    'ALTER TABLE QuoteVersion ADD COLUMN bd_prepared_by TEXT': 'bd_prepared_by',
    'ALTER TABLE QuoteVersion ADD COLUMN bd_date TEXT': 'bd_date',
    'ALTER TABLE QuoteVersion ADD COLUMN body_cost_revision TEXT': 'body_cost_revision',
  };
  for (const sql of migrations) {
    if (!existingCols.includes(colMap[sql])) {
      db.exec(sql);
    }
  }

  // Migrate: add format_type to QuoteVersion
  if (!existingCols.includes('format_type')) {
    db.exec("ALTER TABLE QuoteVersion ADD COLUMN format_type TEXT DEFAULT 'injection'");
  }

  // Migrate: add part_category to HardwareItem
  const hwCols = db.prepare('PRAGMA table_info(HardwareItem)').all().map(c => c.name);
  if (!hwCols.includes('part_category')) {
    db.exec("ALTER TABLE HardwareItem ADD COLUMN part_category TEXT DEFAULT 'other'");
  }

  // Migrate: add eng_name to SewingDetail
  const sewCols = db.prepare('PRAGMA table_info(SewingDetail)').all().map(c => c.name);
  if (!sewCols.includes('eng_name')) {
    db.exec("ALTER TABLE SewingDetail ADD COLUMN eng_name TEXT");
  }

  // Migrate: add eng_name to MoldPart, HardwareItem, PackagingItem, ElectronicItem
  const moldCols = db.prepare('PRAGMA table_info(MoldPart)').all().map(c => c.name);
  if (!moldCols.includes('eng_name')) db.exec("ALTER TABLE MoldPart ADD COLUMN eng_name TEXT");

  const hwEngCols = db.prepare('PRAGMA table_info(HardwareItem)').all().map(c => c.name);
  if (!hwEngCols.includes('eng_name')) db.exec("ALTER TABLE HardwareItem ADD COLUMN eng_name TEXT");

  const pkgCols = db.prepare('PRAGMA table_info(PackagingItem)').all().map(c => c.name);
  if (!pkgCols.includes('eng_name')) db.exec("ALTER TABLE PackagingItem ADD COLUMN eng_name TEXT");

  const elecItemCols = db.prepare('PRAGMA table_info(ElectronicItem)').all().map(c => c.name);
  if (!elecItemCols.includes('eng_name')) db.exec("ALTER TABLE ElectronicItem ADD COLUMN eng_name TEXT");

  // Migrate: add eng_name to RawMaterial
  const rawMatCols = db.prepare('PRAGMA table_info(RawMaterial)').all().map(c => c.name);
  if (!rawMatCols.includes('eng_name')) db.exec("ALTER TABLE RawMaterial ADD COLUMN eng_name TEXT");
  if (!rawMatCols.includes('spec_eng')) db.exec("ALTER TABLE RawMaterial ADD COLUMN spec_eng TEXT");

  // Migrate: add eng_name to RotocastItem
  const rotoCols = db.prepare('PRAGMA table_info(RotocastItem)').all().map(c => c.name);
  if (!rotoCols.includes('eng_name')) db.exec("ALTER TABLE RotocastItem ADD COLUMN eng_name TEXT");

  // Migrate: add is_latest to QuoteVersion
  if (!existingCols.includes('is_latest')) {
    db.exec("ALTER TABLE QuoteVersion ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 0");
    // One-time: mark the latest version per product (highest date_code)
    db.exec(`
      UPDATE QuoteVersion
      SET is_latest = 1
      WHERE id IN (
        SELECT id FROM QuoteVersion qv1
        WHERE
          (date_code IS NOT NULL AND date_code = (
            SELECT MAX(date_code) FROM QuoteVersion qv2
            WHERE qv2.product_id = qv1.product_id AND qv2.date_code IS NOT NULL
          ))
          OR
          (date_code IS NULL AND NOT EXISTS (
            SELECT 1 FROM QuoteVersion qv3
            WHERE qv3.product_id = qv1.product_id AND qv3.date_code IS NOT NULL
          ) AND id = (
            SELECT MAX(id) FROM QuoteVersion qv4
            WHERE qv4.product_id = qv1.product_id
          ))
      )
    `);
  }

  return db;
}

function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}

module.exports = { initDb, getDb };
