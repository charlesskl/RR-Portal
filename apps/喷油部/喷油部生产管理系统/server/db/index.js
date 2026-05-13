const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'penyou.db');
const INIT_SQL = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(INIT_SQL);

function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumnIfMissing('dispatches', 'started_at', 'DATETIME');
addColumnIfMissing('dispatches', 'completed_at', 'DATETIME');
addColumnIfMissing('order_schedule_lines', 'actual_capacity', 'INTEGER');
db.exec(`UPDATE order_schedule_lines SET actual_capacity = daily_capacity WHERE actual_capacity IS NULL`);
addColumnIfMissing('product_processes', 'default_line_id', 'INTEGER');
addColumnIfMissing('order_schedule_lines', 'sort_order', 'INTEGER');
db.exec(`UPDATE order_schedule_lines SET sort_order = id WHERE sort_order IS NULL`);

const { seedLines, seedLineDefaults, seedWorkshops, seedLinesPerWorkshop } = require('./seed');
seedWorkshops(db);
seedLines(db);
seedLineDefaults(db);

addColumnIfMissing('lines', 'workshop_id', 'INTEGER');
addColumnIfMissing('products', 'workshop_id', 'INTEGER');
addColumnIfMissing('wage_standards', 'workshop_id', 'INTEGER');
addColumnIfMissing('technique_line_defaults', 'workshop_id', 'INTEGER');
addColumnIfMissing('production_orders', 'workshop_id', 'INTEGER');
addColumnIfMissing('daily_records', 'workshop_id', 'INTEGER');
addColumnIfMissing('ledger_edits', 'workshop_id', 'INTEGER');

for (const t of ['lines','products','wage_standards','technique_line_defaults',
                 'production_orders','daily_records','ledger_edits']) {
  db.exec(`UPDATE ${t} SET workshop_id=2 WHERE workshop_id IS NULL`);
}

function migrateLinesUniqueConstraint(db) {
  // 检查 lines 表是否已经是 UNIQUE(workshop_id, name)
  // 老结构: UNIQUE(name) - 通过 sql 字段查 CREATE 语句判断
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lines'").get();
  if (!row) return;
  if (row.sql.includes('UNIQUE(workshop_id, name)') || row.sql.includes('UNIQUE (workshop_id, name)')) {
    return; // 已迁移
  }

  // 关 FK 检查再做表重建,DROP/RENAME 才不会因外键引用失败
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE lines_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        workshop_id INTEGER NOT NULL DEFAULT 2,
        UNIQUE(workshop_id, name)
      );
      INSERT INTO lines_new(id, name, sort_order, workshop_id)
        SELECT id, name, sort_order, COALESCE(workshop_id, 2) FROM lines;
      DROP TABLE lines;
      ALTER TABLE lines_new RENAME TO lines;
      COMMIT;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

migrateLinesUniqueConstraint(db);
seedLinesPerWorkshop(db);

function migrateLineDefaultsConstraint(db) {
  // 检查 technique_line_defaults 主键是否已是 (workshop_id, technique)
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='technique_line_defaults'").get();
  if (!row) return;
  if (row.sql.includes('PRIMARY KEY(workshop_id, technique)') ||
      row.sql.includes('PRIMARY KEY (workshop_id, technique)')) {
    return; // 已迁移
  }

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE technique_line_defaults_new (
        workshop_id INTEGER NOT NULL,
        technique TEXT NOT NULL,
        line_id INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(workshop_id, technique),
        FOREIGN KEY(line_id) REFERENCES lines(id)
      );
      INSERT INTO technique_line_defaults_new(workshop_id, technique, line_id, updated_at)
        SELECT COALESCE(workshop_id, 2), technique, line_id, updated_at FROM technique_line_defaults;
      DROP TABLE technique_line_defaults;
      ALTER TABLE technique_line_defaults_new RENAME TO technique_line_defaults;
      COMMIT;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

migrateLineDefaultsConstraint(db);
// 重新调一次 seedLineDefaults — 它现在按 3 车间生成,湖南/华登 以前没有数据,会被新加;兴信 已有用 INSERT OR IGNORE 跳过
seedLineDefaults(db);

function migrateWageStandardsUniqueConstraint(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wage_standards'").get();
  if (!row) return;
  if (row.sql.includes('UNIQUE(workshop_id, technique, worker_count)') ||
      row.sql.includes('UNIQUE (workshop_id, technique, worker_count)')) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE wage_standards_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        technique TEXT NOT NULL,
        worker_count INTEGER NOT NULL,
        unit_wage REAL NOT NULL,
        workshop_id INTEGER NOT NULL DEFAULT 2,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workshop_id, technique, worker_count)
      );
      INSERT INTO wage_standards_new(id, technique, worker_count, unit_wage, workshop_id, updated_at)
        SELECT id, technique, worker_count, unit_wage, COALESCE(workshop_id, 2), updated_at FROM wage_standards;
      DROP TABLE wage_standards;
      ALTER TABLE wage_standards_new RENAME TO wage_standards;
      CREATE INDEX IF NOT EXISTS idx_wage_standards_tech ON wage_standards(technique);
      COMMIT;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

migrateWageStandardsUniqueConstraint(db);

module.exports = db;
