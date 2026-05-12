const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { buildLedger, LEDGER_COLUMNS } = require('../lib/ledger');
const { seedWorkshops } = require('../db/seed');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  // init.sql 还没把 daily_records / ledger_edits 的 workshop_id 加进去,这里 ALTER 补上
  for (const t of ['daily_records', 'ledger_edits']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    if (!cols.includes('workshop_id')) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN workshop_id INTEGER NOT NULL DEFAULT 2`);
    }
  }
  seedWorkshops(db);
  db.prepare("INSERT INTO lines(id,name,sort_order,workshop_id) VALUES (1,'宋沛霖手喷',1,2),(2,'宋沛霖自动',2,2),(3,'胡旗移印',3,2)").run();
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,quote_price,workshop_id) VALUES ('73622','布鲁伊爸爸杯',2.22,2)").run();
  const p1 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid, '耳朵', '喷油', 1000, 1, 0.1);
  const p2 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid, '身', '移印', 2000, 2, 0.05);
  db.prepare('INSERT INTO daily_records(record_date,line_id,product_id,product_process_id,produced_qty,worker_count,workshop_id) VALUES (?,?,?,?,?,?,?)').run('2026-04-18', 1, pid, p1.lastInsertRowid, 1000, 1, 2);
  db.prepare('INSERT INTO daily_records(record_date,line_id,product_id,product_process_id,produced_qty,worker_count,workshop_id) VALUES (?,?,?,?,?,?,?)').run('2026-04-18', 3, pid, p2.lastInsertRowid, 2000, 2, 2);
  return { db, pid };
}

test('聚合:每个已分拉货号生成 3 行(每条拉一行),未分拉的行值全 0', () => {
  const { db, pid } = setupDb();
  const { rows } = buildLedger(db, '2026-04-18', 2);
  assert.strictEqual(rows.length, 3);
  const handSpray = rows.find(r => r.line_name === '宋沛霖手喷' && r.product_id === pid);
  assert.ok(handSpray);
  assert.strictEqual(handSpray.values.total_output, 2220);
  assert.strictEqual(handSpray.values.worker_wage_total, 100);
  const autoLine = rows.find(r => r.line_name === '宋沛霖自动' && r.product_id === pid);
  assert.strictEqual(autoLine.values.total_output, 0);
});

test('工时固定 11,总时间=员工人数×11,员工人均产值=产值/员工人数', () => {
  const { db, pid } = setupDb();
  db.prepare("INSERT INTO ledger_edits(ledger_date,line_id,product_id,column_key,value,workshop_id) VALUES (?,?,?,?,?,?)")
    .run('2026-04-18', 1, pid, 'employee_count', '39', 2);
  const { rows } = buildLedger(db, '2026-04-18', 2);
  const handSpray = rows.find(r => r.line_name === '宋沛霖手喷' && r.product_id === pid);
  assert.strictEqual(handSpray.values.work_hours, 11);
  assert.strictEqual(handSpray.values.total_time, 39 * 11);
  assert.strictEqual(handSpray.values.per_employee_output, Math.round((2220 / 39) * 100) / 100);
});

test('columns 定义包含 32 列,editable/computed 正确标注', () => {
  assert.strictEqual(LEDGER_COLUMNS.length, 32);
  const dateCol = LEDGER_COLUMNS.find(c => c.key === 'date');
  assert.strictEqual(dateCol.computed, true);
  const rentCol = LEDGER_COLUMNS.find(c => c.key === 'rent');
  assert.strictEqual(rentCol.editable, true);
});
