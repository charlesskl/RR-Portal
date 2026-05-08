const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { upsertStandard, suggestFromHistory, listStandards } = require('../routes/wage-standards');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.pragma('foreign_keys = ON');
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,workshop_id) VALUES ('T','t',2)").run();
  const stmt = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)");
  for (const w of [0.05, 0.06, 0.08, 0.10, 0.12]) stmt.run(pid,'x','喷油',1000,1,w);
  for (const w of [0.30, 0.40]) stmt.run(pid,'x','喷油',1000,4,w);
  stmt.run(pid,'x','移印',5000,1,0.036);
  return db;
}

test('upsertStandard 插入新行 / 更新已存在', () => {
  const db = setup();
  upsertStandard(db, { technique: '喷油', worker_count: 1, unit_wage: 0.08, workshop_id: 2 });
  let r = db.prepare("SELECT * FROM wage_standards WHERE technique='喷油' AND worker_count=1 AND workshop_id=2").get();
  assert.strictEqual(r.unit_wage, 0.08);
  upsertStandard(db, { technique: '喷油', worker_count: 1, unit_wage: 0.09, workshop_id: 2 });
  r = db.prepare("SELECT * FROM wage_standards WHERE technique='喷油' AND worker_count=1 AND workshop_id=2").get();
  assert.strictEqual(r.unit_wage, 0.09);
});

test('suggestFromHistory 用中位数填空格,不覆盖已有', () => {
  const db = setup();
  upsertStandard(db, { technique: '喷油', worker_count: 1, unit_wage: 0.20, workshop_id: 2 });
  const added = suggestFromHistory(db, 2);
  assert.strictEqual(added, 2);
  const spray4 = db.prepare("SELECT * FROM wage_standards WHERE technique='喷油' AND worker_count=4 AND workshop_id=2").get();
  assert.strictEqual(spray4.unit_wage, 0.35);
  const spray1 = db.prepare("SELECT * FROM wage_standards WHERE technique='喷油' AND worker_count=1 AND workshop_id=2").get();
  assert.strictEqual(spray1.unit_wage, 0.20);
  const print1 = db.prepare("SELECT * FROM wage_standards WHERE technique='移印' AND worker_count=1 AND workshop_id=2").get();
  assert.strictEqual(print1.unit_wage, 0.036);
});
