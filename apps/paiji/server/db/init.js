const db = require('./connection');

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

  // Migrations
  try { db.prepare("ALTER TABLE orders ADD COLUMN order_notes TEXT DEFAULT ''").run(); } catch(e){}
  try { db.prepare("ALTER TABLE schedule_items ADD COLUMN is_carry_over INTEGER DEFAULT 0").run(); } catch(e){}
  // 多车间支持
  try { db.prepare("ALTER TABLE machines ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE orders ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE schedules ADD COLUMN notes TEXT").run(); } catch(e){}
  try { db.prepare("ALTER TABLE schedules ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE history_records ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}
  try { db.prepare("ALTER TABLE mold_targets ADD COLUMN workshop TEXT DEFAULT 'B'").run(); } catch(e){}

  console.log('数据库初始化完成，28台机数据已预置');

  // 种子数据导入（仅在对应表为空或数据不完整时导入，不覆盖已有数据）
  try { seedData(); } catch (e) { console.log('[种子导入失败]', e.message); }
}

/**
 * 种子数据导入
 * 规则：表为空 → 全量导入；表已有数据 → 不动
 * machines 特殊处理：如果现有机台缺少 brand/tonnage（均为默认值），覆盖更新
 */
function seedData() {
  const fs = require('fs');
  const path = require('path');
  const seedDir = path.join(__dirname, '..', 'seed');
  if (!fs.existsSync(seedDir)) { console.log('[种子] 无 seed 目录，跳过'); return; }

  // 1) mold_targets
  const mtCount = db.prepare('SELECT COUNT(*) as c FROM mold_targets').get().c;
  if (mtCount < 100) {
    const file = path.join(seedDir, 'mold_targets.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ins = db.prepare(`INSERT OR IGNORE INTO mold_targets (mold_no, mold_name, target_24h, target_11h, notes, workshop) VALUES (?, ?, ?, ?, ?, ?)`);
      const tx = db.transaction(() => { for (const r of data) ins.run(r.mold_no, r.mold_name, r.target_24h || 0, r.target_11h || 0, r.notes || '', r.workshop || 'B'); });
      tx();
      console.log(`[种子] mold_targets 导入 ${data.length} 条（原 ${mtCount} 条）`);
    }
  }

  // 2) machines（缺失或品牌未设置时补齐）
  const mFile = path.join(seedDir, 'machines.json');
  if (fs.existsSync(mFile)) {
    const data = JSON.parse(fs.readFileSync(mFile, 'utf8'));
    let inserted = 0, updated = 0;
    const tx = db.transaction(() => {
      for (const r of data) {
        const exists = db.prepare('SELECT id, brand, tonnage FROM machines WHERE machine_no = ? AND workshop = ?').get(r.machine_no, r.workshop || 'B');
        if (!exists) {
          try { db.prepare(`INSERT INTO machines (machine_no, brand, tonnage, arm_type, model_desc, status, workshop) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(r.machine_no, r.brand || '', r.tonnage || 0, r.arm_type || '', r.model_desc || '', r.status || 'active', r.workshop || 'B');
            inserted++; } catch(e){}
        } else if (!exists.brand || exists.brand === '-' || exists.tonnage === 0) {
          // 机台存在但信息不完整，更新
          db.prepare(`UPDATE machines SET brand=?, tonnage=?, arm_type=?, model_desc=? WHERE id=?`)
            .run(r.brand || '', r.tonnage || 0, r.arm_type || '', r.model_desc || '', exists.id);
          updated++;
        }
      }
    });
    tx();
    if (inserted || updated) console.log(`[种子] machines 新增 ${inserted} 台，更新 ${updated} 台`);
  }

  // 3) history_records（仅在为空时导入，历史数据量大）
  const hCount = db.prepare('SELECT COUNT(*) as c FROM history_records').get().c;
  if (hCount === 0) {
    const file = path.join(seedDir, 'history_records.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ins = db.prepare(`INSERT INTO history_records (machine_no, product_code, mold_name, color, color_powder_no, material_type, shot_weight, material_kg, sprue_pct, ratio_pct, accumulated, quantity_needed, shortage, order_no, target_24h, target_11h, packing_qty, notes, workshop) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const tx = db.transaction(() => {
        for (const r of data) ins.run(r.machine_no, r.product_code, r.mold_name, r.color, r.color_powder_no, r.material_type, r.shot_weight || 0, r.material_kg || 0, r.sprue_pct || 0, r.ratio_pct || 0, r.accumulated || 0, r.quantity_needed || 0, r.shortage || 0, r.order_no, r.target_24h || 0, r.target_11h || 0, r.packing_qty || 0, r.notes, r.workshop || 'B');
      });
      tx();
      console.log(`[种子] history_records 导入 ${data.length} 条`);
    }
  }
}

module.exports = { initDatabase };
