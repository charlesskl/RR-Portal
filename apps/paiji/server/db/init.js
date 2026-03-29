const db = require('./connection');
const fs = require('fs');
const path = require('path');

function initDatabase() {
  // ========== 机台配置表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_no TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      tonnage INTEGER NOT NULL,
      arm_type TEXT NOT NULL,
      model_desc TEXT,
      min_shot_weight REAL DEFAULT 0,
      max_shot_weight REAL DEFAULT 0,
      avg_shot_weight REAL DEFAULT 0,
      record_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ========== 订单表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT,
      mold_no TEXT,
      mold_name TEXT,
      color TEXT,
      color_powder_no TEXT,
      material_type TEXT,
      shot_weight REAL DEFAULT 0,
      material_kg REAL DEFAULT 0,
      sprue_pct REAL DEFAULT 0,
      ratio_pct REAL DEFAULT 0,
      quantity_needed INTEGER DEFAULT 0,
      accumulated INTEGER DEFAULT 0,
      cavity INTEGER DEFAULT 1,
      cycle_time REAL DEFAULT 0,
      order_no TEXT,
      is_three_plate INTEGER DEFAULT 0,
      packing_qty INTEGER DEFAULT 0,
      import_batch TEXT,
      source_file TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ========== 历史生产记录表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_no TEXT NOT NULL,
      product_code TEXT,
      mold_name TEXT,
      color TEXT,
      color_powder_no TEXT,
      material_type TEXT,
      shot_weight REAL DEFAULT 0,
      material_kg REAL DEFAULT 0,
      sprue_pct REAL DEFAULT 0,
      ratio_pct REAL DEFAULT 0,
      accumulated INTEGER DEFAULT 0,
      quantity_needed INTEGER DEFAULT 0,
      shortage INTEGER DEFAULT 0,
      order_no TEXT,
      target_24h INTEGER DEFAULT 0,
      target_11h INTEGER DEFAULT 0,
      packing_qty INTEGER DEFAULT 0,
      notes TEXT,
      source_date TEXT,
      import_batch TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_machine ON history_records(machine_no)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_shot_weight ON history_records(machine_no, shot_weight)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_material ON history_records(material_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_mold ON history_records(mold_name)`);

  // ========== 排机单表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_date TEXT NOT NULL,
      shift TEXT DEFAULT '白班',
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ========== 排机单明细表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      machine_no TEXT NOT NULL,
      product_code TEXT,
      mold_name TEXT,
      color TEXT,
      color_powder_no TEXT,
      material_type TEXT,
      shot_weight REAL DEFAULT 0,
      material_kg REAL DEFAULT 0,
      sprue_pct REAL DEFAULT 0,
      ratio_pct REAL DEFAULT 0,
      accumulated INTEGER DEFAULT 0,
      quantity_needed INTEGER DEFAULT 0,
      shortage INTEGER DEFAULT 0,
      order_no TEXT,
      target_24h INTEGER DEFAULT 0,
      target_11h INTEGER DEFAULT 0,
      days_needed REAL DEFAULT 0,
      packing_qty INTEGER DEFAULT 0,
      notes TEXT,
      robot_arm TEXT,
      clamp TEXT,
      mold_change_time TEXT,
      adjuster TEXT,
      sort_order INTEGER DEFAULT 0,
      order_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_schedule ON schedule_items(schedule_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_machine ON schedule_items(machine_no)`);

  // ========== 模具目标表（24H/11H产量目标） ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS mold_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mold_no TEXT NOT NULL UNIQUE,
      mold_name TEXT,
      target_24h INTEGER DEFAULT 0,
      target_11h INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations (run BEFORE inserts that depend on new columns)
  try { db.prepare("ALTER TABLE orders ADD COLUMN order_notes TEXT DEFAULT ''").run(); } catch(e){}
  try { db.prepare("ALTER TABLE schedule_items ADD COLUMN is_carry_over INTEGER DEFAULT 0").run(); } catch(e){}
  // 多车间支持
  try { db.prepare("ALTER TABLE machines ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE orders ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE schedules ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE history_records ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE mold_targets ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}

  // ========== 预置28台机数据 ==========
  const machines = [
    { no: '1#',  brand: '博创', tonnage: 800, arm: '五轴双臂' },
    { no: '2#',  brand: '博创', tonnage: 500, arm: '五轴双臂' },
    { no: '3#',  brand: '博创', tonnage: 320, arm: '五轴双臂' },
    { no: '4#',  brand: '博创', tonnage: 320, arm: '三轴单臂' },
    { no: '5#',  brand: '博创', tonnage: 200, arm: '五轴双臂' },
    { no: '6#',  brand: '博创', tonnage: 200, arm: '三轴单臂' },
    { no: '7#',  brand: '博创', tonnage: 200, arm: '五轴双臂' },
    { no: '8#',  brand: '博创', tonnage: 200, arm: '五轴双臂' },
    { no: '9#',  brand: '博创', tonnage: 200, arm: '五轴双臂' },
    { no: '10#', brand: '博创', tonnage: 150, arm: '五轴双臂' },
    { no: '11#', brand: '博创', tonnage: 150, arm: '五轴双臂' },
    { no: '12#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '13#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '14#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '15#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '16#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '17#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '18#', brand: '博创', tonnage: 151, arm: '五轴双臂' },
    { no: '19#', brand: '博创', tonnage: 260, arm: '五轴双臂' },
    { no: '20#', brand: '海天', tonnage: 160, arm: '五轴双臂' },
    { no: '21#', brand: '日本东芝', tonnage: 50, arm: '三轴单臂' },
    { no: '22#', brand: '日本东芝', tonnage: 50, arm: '五轴双臂' },
    { no: '23#', brand: '博创', tonnage: 260, arm: '五轴双臂' },
    { no: '24#', brand: '博创', tonnage: 260, arm: '五轴双臂' },
    { no: '25#', brand: '博创', tonnage: 260, arm: '五轴双臂' },
    { no: '26#', brand: '博创', tonnage: 260, arm: '五轴双臂' },
    { no: '27#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
    { no: '28#', brand: '博创', tonnage: 150, arm: '三轴单臂' },
  ];

  const insertMachine = db.prepare(`
    INSERT OR IGNORE INTO machines (machine_no, brand, tonnage, arm_type, model_desc)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((list) => {
    for (const m of list) {
      const desc = `${m.brand}${m.tonnage}T${m.arm}`;
      insertMachine.run(m.no, m.brand, m.tonnage, m.arm, desc);
    }
  });

  insertMany(machines);

  // ========== 预置A车间42台机 ==========
  const machinesA = Array.from({ length: 42 }, (_, i) => ({
    no: `A-${i + 1}#`, brand: '博创', tonnage: 150, arm: '三轴单臂', workshop: 'A'
  }));
  const insertMachineWs = db.prepare(`
    INSERT OR IGNORE INTO machines (machine_no, brand, tonnage, arm_type, model_desc, workshop)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertManyWs = db.transaction((list) => {
    for (const m of list) {
      insertMachineWs.run(m.no, m.brand, m.tonnage, m.arm, `${m.brand}${m.tonnage}T${m.arm}`, m.workshop);
    }
  });
  insertManyWs(machinesA);

  // ========== 预置华登(C车间)34台机 ==========
  const machinesC = Array.from({ length: 34 }, (_, i) => ({
    no: `C-${i + 1}#`, brand: '博创', tonnage: 150, arm: '三轴单臂', workshop: 'C'
  }));
  insertManyWs(machinesC);

  console.log('数据库初始化完成，28台机数据已预置');

  // ========== 从JSON文件导入预置数据（仅首次启动时） ==========
  seedFromJSON();
}

function seedFromJSON() {
  const dataDir = process.env.DATA_PATH || path.join(__dirname, '..', 'data');

  // 导入订单数据（orders.json → orders表）
  const orderCount = db.prepare('SELECT COUNT(*) as cnt FROM orders').get().cnt;
  if (orderCount === 0) {
    const ordersFile = path.join(dataDir, 'orders.json');
    if (fs.existsSync(ordersFile)) {
      try {
        const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
        const insertOrder = db.prepare(`
          INSERT INTO orders (product_code, mold_no, mold_name, color, material_type,
            quantity_needed, status, import_batch, source_file, workshop)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 'json_seed', 'orders.json', 'B')
        `);
        const insertAll = db.transaction((list) => {
          for (const o of list) {
            insertOrder.run(
              o.款号 || '',
              o.模具编号 || '',
              o.工模名称 || '',
              o.颜色 || '',
              o.材料 || '',
              Number(o.啤数) || 0
            );
          }
        });
        insertAll(orders);
        console.log(`从 orders.json 导入 ${orders.length} 条订单`);
      } catch (e) {
        console.error('导入 orders.json 失败:', e.message);
      }
    }
  }

  // 导入模具目标数据（molds.json → mold_targets表）
  const moldCount = db.prepare('SELECT COUNT(*) as cnt FROM mold_targets').get().cnt;
  if (moldCount === 0) {
    const moldsFile = path.join(dataDir, 'molds.json');
    if (fs.existsSync(moldsFile)) {
      try {
        const molds = JSON.parse(fs.readFileSync(moldsFile, 'utf8'));
        const insertMoldTarget = db.prepare(`
          INSERT OR IGNORE INTO mold_targets (mold_no, mold_name, target_24h, target_11h, workshop)
          VALUES (?, ?, ?, ?, 'B')
        `);
        const insertAll = db.transaction((list) => {
          for (const m of list) {
            const cavity = Number(m.模穴) || 1;
            const cycleTime = Number(m.周期) || 30;
            const target24h = Math.round((24 * 3600 / cycleTime) * cavity);
            const target11h = Math.round((11 * 3600 / cycleTime) * cavity);
            insertMoldTarget.run(
              m.模具编号 || '',
              m.工模名称 || '',
              target24h,
              target11h
            );
          }
        });
        insertAll(molds);
        console.log(`从 molds.json 导入 ${molds.length} 条模具目标`);
      } catch (e) {
        console.error('导入 molds.json 失败:', e.message);
      }
    }
  }
}

module.exports = { initDatabase };
