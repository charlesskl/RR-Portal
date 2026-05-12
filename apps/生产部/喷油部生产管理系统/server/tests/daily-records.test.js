const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { upsertRecord, listByDate } = require('../routes/daily-records');
const { seedLines, seedWorkshops } = require('../db/seed');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.pragma('foreign_keys = ON');
  // init.sql 还没把 daily_records.workshop_id 加进去,这里 ALTER 补上(实际生产 db 已有,通过 db/index.js 的 addColumnIfMissing)
  const cols = db.prepare('PRAGMA table_info(daily_records)').all().map(c => c.name);
  if (!cols.includes('workshop_id')) {
    db.exec('ALTER TABLE daily_records ADD COLUMN workshop_id INTEGER NOT NULL DEFAULT 2');
  }
  seedWorkshops(db);
  seedLines(db);
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,quote_price,workshop_id) VALUES ('T','t',1.5,2)").run();
  const ppid = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'耳','喷油',1000,1,0.1).lastInsertRowid;
  return { db, pid, ppid };
}

test('upsert:同 (date, line, process) 更新而非插入', () => {
  const { db, pid, ppid } = setup();
  upsertRecord(db, { record_date: '2026-04-21', line_id: 1, product_id: pid, product_process_id: ppid, produced_qty: 100, worker_count: 2 }, 2);
  upsertRecord(db, { record_date: '2026-04-21', line_id: 1, product_id: pid, product_process_id: ppid, produced_qty: 250, worker_count: 3 }, 2);
  const all = db.prepare('SELECT * FROM daily_records').all();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].produced_qty, 250);
  assert.strictEqual(all[0].worker_count, 3);
});

test('listByDate 含 line_name / product_code / part_name / unit_wage / quote_price', () => {
  const { db, pid, ppid } = setup();
  upsertRecord(db, { record_date: '2026-04-21', line_id: 1, product_id: pid, product_process_id: ppid, produced_qty: 100, worker_count: 2 }, 2);
  const rows = listByDate(db, '2026-04-21', 2);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].line_name, '宋沛霖手喷');
  assert.strictEqual(rows[0].product_code, 'T');
  assert.strictEqual(rows[0].part_name, '耳');
  assert.strictEqual(rows[0].unit_wage, 0.1);
  assert.strictEqual(rows[0].quote_price, 1.5);
});
