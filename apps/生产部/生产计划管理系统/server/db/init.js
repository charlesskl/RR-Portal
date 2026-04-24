const fs = require('fs');
const path = require('path');
const db = require('./connection');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop TEXT NOT NULL DEFAULT 'B',
      status TEXT DEFAULT 'active',

      supervisor TEXT,
      line_name TEXT,
      worker_count INTEGER,
      factory_area TEXT,
      client TEXT,
      order_date TEXT,
      third_party TEXT,
      country TEXT,
      contract TEXT,
      item_no TEXT,
      product_name TEXT,
      version TEXT,
      quantity INTEGER,
      work_type TEXT,

      production_count INTEGER DEFAULT 0,
      production_progress REAL DEFAULT 0,
      special_notes TEXT,

      plastic_due TEXT,
      material_due TEXT,
      carton_due TEXT,
      packaging_due TEXT,
      sticker TEXT,

      start_date TEXT,
      complete_date TEXT,
      ship_date TEXT,

      target_time REAL,
      daily_target INTEGER,
      days REAL,
      unit_price REAL,
      process_value REAL,
      inspection_date TEXT,
      month INTEGER,
      warehouse_record TEXT,
      output_value REAL,
      process_price REAL,
      remark TEXT,

      day_1 INTEGER DEFAULT 0,
      day_2 INTEGER DEFAULT 0,
      day_3 INTEGER DEFAULT 0,
      day_4 INTEGER DEFAULT 0,
      day_5 INTEGER DEFAULT 0,
      day_6 INTEGER DEFAULT 0,
      day_7 INTEGER DEFAULT 0,
      day_8 INTEGER DEFAULT 0,
      day_9 INTEGER DEFAULT 0,
      day_10 INTEGER DEFAULT 0,
      day_11 INTEGER DEFAULT 0,
      day_12 INTEGER DEFAULT 0,
      day_13 INTEGER DEFAULT 0,
      day_14 INTEGER DEFAULT 0,
      day_15 INTEGER DEFAULT 0,
      day_16 INTEGER DEFAULT 0,
      day_17 INTEGER DEFAULT 0,
      day_18 INTEGER DEFAULT 0,
      day_19 INTEGER DEFAULT 0,
      day_20 INTEGER DEFAULT 0,
      day_21 INTEGER DEFAULT 0,
      day_22 INTEGER DEFAULT 0,
      day_23 INTEGER DEFAULT 0,
      day_24 INTEGER DEFAULT 0,
      day_25 INTEGER DEFAULT 0,
      day_26 INTEGER DEFAULT 0,
      day_27 INTEGER DEFAULT 0,
      day_28 INTEGER DEFAULT 0,
      day_29 INTEGER DEFAULT 0,
      day_30 INTEGER DEFAULT 0,
      day_31 INTEGER DEFAULT 0,

      cell_format TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 兼容老数据库：如果 cell_format 字段不存在则添加
  try {
    const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
    if (!cols.includes('cell_format')) {
      db.exec('ALTER TABLE orders ADD COLUMN cell_format TEXT');
    }
  } catch {}

  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_workshop ON orders(workshop)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop TEXT NOT NULL,
      line_name TEXT,
      worker_count INTEGER,
      client TEXT,
      month INTEGER,
      value REAL DEFAULT 0,
      year INTEGER,
      weekly_orders REAL DEFAULT 0,
      weekly_remaining REAL DEFAULT 0,
      weekly_cancelled REAL DEFAULT 0,
      remark TEXT
    )
  `);

  // 首次启动时从 seed.json 填充初始数据
  const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  if (orderCount === 0) {
    const seedPath = path.join(__dirname, '../data/seed.json');
    if (fs.existsSync(seedPath)) {
      try {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
        const keys = cols.filter(c => c !== 'id');
        const placeholders = keys.map(() => '?').join(',');
        const stmt = db.prepare(`INSERT INTO orders (${keys.join(',')}) VALUES (${placeholders})`);
        const insertMany = db.transaction((rows) => {
          for (const r of rows) {
            stmt.run(...keys.map(k => r[k] ?? null));
          }
        });
        insertMany(seed);
        console.log(`已从 seed.json 导入 ${seed.length} 条初始数据`);
      } catch (e) {
        console.error('seed.json 加载失败:', e.message);
      }
    }
  }

  console.log('数据库初始化完成');
}

module.exports = { initDatabase };
