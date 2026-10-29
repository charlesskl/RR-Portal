'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parsePlan, rowJson, digest, repair, tableHash } = require('../paiji-repair-receipt-timestamps.cjs');

function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'paiji-timestamp-cas-'));
  const db = new Database(path.join(folder, 'synthetic.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE pi_warehouse_orders (
    id INTEGER PRIMARY KEY, workshop TEXT, status TEXT, material_name TEXT,
    delivery_pcs INTEGER, delivery_shots INTEGER, cavity INTEGER, amount REAL,
    notes TEXT, checked_in_at TEXT, updated_at TEXT)`);
  const insert = db.prepare('INSERT INTO pi_warehouse_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let id = 340; id < 404; id++) insert.run(id, 'AT', 'checked-in', `fixture-name-${id}`, 16, 2, 8, 1.25, 'synthetic', '2041-02-03 04:05:06', '2041-02-03 04:05:06');
  const current = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id=372').get();
  const restore = { checked_in_at: '2040-01-02 03:04:05', updated_at: '2040-01-03T04:05:06.789Z' };
  const plan = { id: 372, workshop: 'AT', expectedRowSha256: digest(rowJson(current)), restoredRowSha256: digest(rowJson({ ...current, ...restore })), restore };
  return { db, plan, close() { db.close(); fs.rmSync(folder, { recursive: true }); } };
}
function all(db) { return db.prepare('SELECT * FROM pi_warehouse_orders ORDER BY id').all(); }

test('real WAL SQLite repairs exactly two columns and preserves every other field of 64 receipts', () => {
  const f = fixture();
  try {
    const before = all(f.db); const proof = repair(f.db, parsePlan(JSON.stringify(f.plan))); const after = all(f.db);
    assert.equal(proof.changes, 1); assert.equal(proof.unchangedExceptTwoTimestamps, true);
    assert.deepEqual(after, before.map(row => row.id === 372 ? { ...row, ...f.plan.restore } : row));
    assert.equal(f.db.inTransaction, false);
    const output = JSON.stringify(proof); assert.ok(!output.includes('2040-')); assert.ok(!output.includes('fixture-name'));
  } finally { f.close(); }
});
test('one-field stale CAS rejects and leaves all rows unchanged', () => {
  const f = fixture(); try {
    f.db.prepare('UPDATE pi_warehouse_orders SET delivery_pcs=17 WHERE id=372').run(); const before = all(f.db);
    assert.throws(() => repair(f.db, f.plan), /full receipt hash differs/); assert.deepEqual(all(f.db), before); assert.equal(f.db.inTransaction, false);
  } finally { f.close(); }
});
test('restored hash mismatch rejects before UPDATE', () => {
  const f = fixture(); try {
    const before = all(f.db); f.plan.restoredRowSha256 = 'a'.repeat(64);
    assert.throws(() => repair(f.db, f.plan), /Restored full receipt hash differs/); assert.deepEqual(all(f.db), before);
  } finally { f.close(); }
});
test('trigger modifying another row is detected and entire transaction is rolled back', () => {
  const f = fixture(); try {
    f.db.exec("CREATE TRIGGER accidental_side_effect AFTER UPDATE ON pi_warehouse_orders WHEN new.id=372 BEGIN UPDATE pi_warehouse_orders SET amount=999 WHERE id=373; END");
    const before = all(f.db); assert.throws(() => repair(f.db, f.plan), /Additional SQLite writes|outside the two timestamps/); assert.deepEqual(all(f.db), before);
  } finally { f.close(); }
});
test('trigger modifying the target name is detected and rolled back', () => {
  const f = fixture(); try {
    f.db.exec("CREATE TRIGGER accidental_side_effect AFTER UPDATE ON pi_warehouse_orders WHEN new.id=372 BEGIN UPDATE pi_warehouse_orders SET material_name='invalid' WHERE id=372; END");
    const before = all(f.db); assert.throws(() => repair(f.db, f.plan), /Additional SQLite writes|outside the two timestamps/); assert.deepEqual(all(f.db), before);
  } finally { f.close(); }
});
test('trigger writing a second table is detected and both tables are rolled back', () => {
  const f = fixture(); try {
    f.db.exec("CREATE TABLE synthetic_ledger (id INTEGER); CREATE TRIGGER cross_table_write AFTER UPDATE ON pi_warehouse_orders WHEN new.id=372 BEGIN INSERT INTO synthetic_ledger VALUES(1); END");
    const before = all(f.db); assert.throws(() => repair(f.db, f.plan), /Additional SQLite writes/);
    assert.deepEqual(all(f.db), before); assert.deepEqual(f.db.prepare('SELECT * FROM synthetic_ledger').all(), []); assert.equal(f.db.inTransaction, false);
  } finally { f.close(); }
});
test('a second connection writer is blocked while BEGIN IMMEDIATE owns the CAS snapshot', () => {
  const f = fixture(); let other;
  try {
    other = new Database(f.db.name, { timeout: 0 }); const original = f.db.prepare.bind(f.db); let checked = false;
    f.db.prepare = function (sql) {
      if (!checked && sql.startsWith('SELECT *')) {
        checked = true; assert.equal(f.db.inTransaction, true);
        assert.throws(() => other.prepare('UPDATE pi_warehouse_orders SET amount=8 WHERE id=372').run(), error => error.code === 'SQLITE_BUSY');
      }
      return original(sql);
    };
    assert.equal(repair(f.db, f.plan).verified, true); assert.equal(checked, true);
  } finally { if (other) other.close(); f.close(); }
});
test('retry refuses rather than reapplying a completed recovery', () => {
  const f = fixture(); try { repair(f.db, f.plan); const before = all(f.db); assert.throws(() => repair(f.db, f.plan), /full receipt hash differs/); assert.deepEqual(all(f.db), before); } finally { f.close(); }
});
test('wrong receipt id, workshop, arbitrary fields and SQL are forbidden at the plan boundary', () => {
  const f = fixture(); try {
    for (const extra of [{ id: 373 }, { workshop: 'A' }, { sql: 'UPDATE anything' }, { restore: { ...f.plan.restore, material_name: 'bad' } }, { expectedRowSha256: 'x' }, { restore: { ...f.plan.restore, updated_at: null } }]) assert.throws(() => parsePlan(JSON.stringify({ ...f.plan, ...extra })));
  } finally { f.close(); }
});
test('wrong status refuses even when the provided full-row hash matches', () => {
  const f = fixture(); try {
    f.db.prepare("UPDATE pi_warehouse_orders SET status='pending' WHERE id=372").run();
    f.plan.expectedRowSha256 = digest(rowJson(f.db.prepare('SELECT * FROM pi_warehouse_orders WHERE id=372').get()));
    const before = all(f.db); assert.throws(() => repair(f.db, f.plan), /state differs/); assert.deepEqual(all(f.db), before);
  } finally { f.close(); }
});
test('single timestamp no-op is rejected, never treated as a two-field restore', () => {
  const f = fixture(); try {
    f.plan.restore.checked_in_at = '2041-02-03 04:05:06'; const before = all(f.db); assert.throws(() => repair(f.db, f.plan), /both timestamps/); assert.deepEqual(all(f.db), before);
  } finally { f.close(); }
});
test('canonical row hash ignores key insertion order and preserves Unicode and null', () => {
  assert.equal(digest(rowJson({ z: null, a: '测试', n: 1.25 })), digest(rowJson({ n: 1.25, a: '测试', z: null })));
  assert.notEqual(tableHash([{ id: 1 }]), tableHash([{ id: 2 }]));
});
