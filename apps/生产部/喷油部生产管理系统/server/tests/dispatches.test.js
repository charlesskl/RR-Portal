const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function setupDb() {
  const db = new Database(':memory:');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8');
  db.exec(sql);
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO lines(id,name,sort_order) VALUES (1,'宋沛霖手喷',1),(2,'宋沛霖自动',2),(3,'胡旗移印',3)").run();
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name) VALUES ('TEST','测试')").run();
  const p1 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)")
    .run(pid, '耳朵', '喷油', 1000, 1, 0.1);
  const p2 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)")
    .run(pid, '身', '移印', 2000, 2, 0.05);
  return { db, pid, procIds: [p1.lastInsertRowid, p2.lastInsertRowid] };
}

const { saveDispatches, listDispatches } = require('../routes/dispatches');

test('保存分拉:先删旧再插新(同日期同货号覆盖)', () => {
  const { db, pid, procIds } = setupDb();
  saveDispatches(db, {
    date: '2026-04-18',
    product_id: pid,
    items: [
      { product_process_id: procIds[0], line_id: 1 },
      { product_process_id: procIds[1], line_id: 3 },
    ],
  });
  let rows = db.prepare('SELECT * FROM dispatches WHERE dispatch_date=? AND product_id=?').all('2026-04-18', pid);
  assert.strictEqual(rows.length, 2);

  saveDispatches(db, {
    date: '2026-04-18',
    product_id: pid,
    items: [{ product_process_id: procIds[0], line_id: 2 }],
  });
  rows = db.prepare('SELECT * FROM dispatches WHERE dispatch_date=? AND product_id=?').all('2026-04-18', pid);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].line_id, 2);
});

test('列表返回 join 出 part_name 和 line.name', () => {
  const { db, pid, procIds } = setupDb();
  saveDispatches(db, {
    date: '2026-04-18',
    product_id: pid,
    items: [{ product_process_id: procIds[0], line_id: 1 }],
  });
  const rows = listDispatches(db, { date: '2026-04-18', product_id: pid });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].part_name, '耳朵');
  assert.strictEqual(rows[0].line_name, '宋沛霖手喷');
});
