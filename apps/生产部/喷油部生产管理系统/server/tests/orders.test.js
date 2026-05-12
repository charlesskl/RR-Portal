const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createOrder, getOrder, listOrders, updateScheduleLine } = require('../routes/orders');
const { seedLines, seedLineDefaults, seedWorkshops } = require('../db/seed');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.pragma('foreign_keys = ON');
  // init.sql 还没把 production_orders.workshop_id 加进去,这里 ALTER 补上(实际生产 db 已有,通过 db/index.js 的 addColumnIfMissing)
  const cols = db.prepare('PRAGMA table_info(production_orders)').all().map(c => c.name);
  if (!cols.includes('workshop_id')) {
    db.exec('ALTER TABLE production_orders ADD COLUMN workshop_id INTEGER NOT NULL DEFAULT 2');
  }
  seedWorkshops(db);
  seedLines(db);
  seedLineDefaults(db);
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,quote_price,workshop_id) VALUES ('T','t',1.5,2)").run();
  db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'车轮','喷油',500,4,0.4);
  db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'身','移印',1000,1,0.05);
  db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'眼','UV',400,1,0.1);
  return { db, pid };
}

test('createOrder 展开每道工序为 schedule_line,默认拉按 line_defaults,est_days/end_date 算对', () => {
  const { db, pid } = setup();
  const oid = createOrder(db, { order_name: 'O1', product_id: pid, total_qty: 1500, start_date: '2026-05-01', remarks: '', workshop_id: 2 });
  const lines = db.prepare('SELECT * FROM order_schedule_lines WHERE order_id=? ORDER BY id').all(oid);
  assert.strictEqual(lines.length, 3);
  // 车轮喷油:line_id = null(喷油默认 NULL)
  assert.strictEqual(lines[0].line_id, null);
  assert.strictEqual(lines[0].qty, 1500);
  assert.strictEqual(lines[0].daily_capacity, 500);
  assert.strictEqual(lines[0].est_days, 3);        // ceil(1500/500)
  assert.strictEqual(lines[0].end_date, '2026-05-03');
  // 身移印:line 是胡旗移印
  const printLine = db.prepare("SELECT id FROM lines WHERE name='胡旗移印'").get();
  assert.strictEqual(lines[1].line_id, printLine.id);
  assert.strictEqual(lines[1].est_days, 2);         // ceil(1500/1000)
  // 眼 UV:line 是 UV
  const uvLine = db.prepare("SELECT id FROM lines WHERE name='UV'").get();
  assert.strictEqual(lines[2].line_id, uvLine.id);
  assert.strictEqual(lines[2].est_days, 4);         // ceil(1500/400)
});

test('getOrder 返回 order + schedule_lines JOIN product_process + line_name', () => {
  const { db, pid } = setup();
  const oid = createOrder(db, { order_name: 'O1', product_id: pid, total_qty: 500, start_date: '2026-05-01', workshop_id: 2 });
  const o = getOrder(db, oid, 2);
  assert.strictEqual(o.order_name, 'O1');
  assert.strictEqual(o.schedule_lines.length, 3);
  assert.ok(o.schedule_lines[0].part_name);
});

test('updateScheduleLine 改 qty 自动重算 est_days 和 end_date', () => {
  const { db, pid } = setup();
  const oid = createOrder(db, { order_name: 'O1', product_id: pid, total_qty: 1000, start_date: '2026-05-01', workshop_id: 2 });
  const sl = db.prepare('SELECT * FROM order_schedule_lines WHERE order_id=? ORDER BY id').all(oid)[0];
  updateScheduleLine(db, sl.id, { qty: 2500 });
  const after = db.prepare('SELECT * FROM order_schedule_lines WHERE id=?').get(sl.id);
  assert.strictEqual(after.qty, 2500);
  assert.strictEqual(after.est_days, 5); // ceil(2500/500)
  assert.strictEqual(after.end_date, '2026-05-05');
});
