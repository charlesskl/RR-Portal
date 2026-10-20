'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { migrationPlan, migrateUnquoted } = require('../scripts/migrate-unquoted');
const { buildMonthlyWorkbook } = require('../monthly');
const fixture = () => ({ assembly_orders: ['待报价', '待审核', '待审核', '待审核', '待审核', '待经理审核', '已完成'].map((status, id) => ({ id, status, updated_at: 'unchanged-version' })), assembly_items: [
  { id: 10, order_id: 1, price: null }, { id: 11, order_id: 2, price: 0 },
  { id: 12, order_id: 3, price: 1 }, { id: 13, order_id: 3, price: null },
  { id: 14, order_id: 4, price: null, completion_time: '2026-10-22' }
], unrelated: { preserved: ['all', 1, null] } });
test('migration changes only proven unquoted statuses, preserves partial/ambiguous and every other field', () => {
  const input = fixture(); const { next, receipt } = migrationPlan(input);
  assert.deepEqual(receipt, { renamed: 1, unquoted: 1, preservedAmbiguous: 2 });
  const expected = structuredClone(input); expected.assembly_orders[0].status = '未报价'; expected.assembly_orders[1].status = '未报价';
  assert.deepEqual(next, expected); assert.deepEqual(input, fixture());
  assert.deepEqual(migrationPlan(next).next, next);
});
test('migration is atomic, byte-exact backup/private mode and preserves original file mode; restart no writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr960-migration-'));
  try {
    const file = path.join(dir, 'data.json'); const raw = Buffer.from(JSON.stringify(fixture()));
    fs.writeFileSync(file, raw, { mode: 0o664 }); fs.chmodSync(file, 0o664);
    migrateUnquoted(file);
    const backup = fs.readdirSync(dir).filter(x => x.includes('.bak-unquoted-'));
    assert.equal(backup.length, 1); assert.deepEqual(fs.readFileSync(path.join(dir, backup[0])), raw);
    assert.equal(fs.statSync(path.join(dir, backup[0])).mode & 0o777, 0o600);
    assert.equal(fs.statSync(file).mode & 0o777, 0o664);
    const bytes = fs.readFileSync(file); const before = fs.statSync(file).mtimeMs;
    migrateUnquoted(file); assert.deepEqual(fs.readFileSync(file), bytes); assert.equal(fs.statSync(file).mtimeMs, before);
    assert.equal(fs.readdirSync(dir).filter(x => x.includes('.bak-unquoted-')).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('migration CLI defaults to dry-run; invalid JSON and held migration lock leave original intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr960-migration-fail-'));
  try {
    const file = path.join(dir, 'data.json'); const raw = JSON.stringify(fixture()); fs.writeFileSync(file, raw);
    const run = spawnSync(process.execPath, [path.join(__dirname, '../scripts/migrate-unquoted.js')], { env: { ...process.env, DATA_PATH: dir } });
    assert.equal(run.status, 0); assert.equal(fs.readFileSync(file, 'utf8'), raw); assert.equal(fs.readdirSync(dir).length, 1);
    fs.writeFileSync(file + '.migration-lock', 'held'); assert.throws(() => migrateUnquoted(file)); assert.equal(fs.readFileSync(file, 'utf8'), raw);
    fs.unlinkSync(file + '.migration-lock'); fs.writeFileSync(file, '{invalid'); assert.throws(() => migrateUnquoted(file)); assert.equal(fs.readFileSync(file, 'utf8'), '{invalid');
    fs.writeFileSync(file, JSON.stringify({ assembly_orders: {} })); assert.throws(() => migrateUnquoted(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('migration rename failure retains original and private backup, cleans own temporary lock and permits offline recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr960-migration-rename-')); const rename = fs.renameSync;
  try {
    const file = path.join(dir, 'data.json'); const raw = JSON.stringify(fixture()); fs.writeFileSync(file, raw);
    fs.renameSync = () => { throw new Error('synthetic rename failure'); };
    assert.throws(() => migrateUnquoted(file), /synthetic rename failure/);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.equal(fs.readdirSync(dir).filter(name => name.includes('.bak-unquoted-')).length, 1);
    assert.ok(!fs.existsSync(file + '.migration-lock'));
    assert.ok(!fs.readdirSync(dir).some(name => name.includes('.migration-')));
    fs.renameSync = rename; assert.equal(migrateUnquoted(file).renamed, 1);
  } finally { fs.renameSync = rename; fs.rmSync(dir, { recursive: true, force: true }); }
});
test('workbook uses actual workshop names, distinct categories and multiply RMB→HKD; unsafe names cannot break export', async () => {
  const row = { date: '2026-10-01', order_number: '=1+1', product_name: '合成品', quantity: 2, unit: '套', price: 10, completion_time: '2026-10-22' };
  const wb = await buildMonthlyWorkbook([
    { ...row, workshop: 'A车间', category: '设备' },
    { ...row, workshop: 'A车间', category: '工具', price: 5 },
    { ...row, workshop: 'B/车间[]?:*\\', category: '旧分类', price: 1 },
    { ...row, workshop: '夹具月结总表', category: '工具', price: 0 },
  ], '2026-10', 1.08);
  assert.ok(wb.getWorksheet('A车间')); assert.equal(wb.getWorksheet('兴信A'), undefined);
  assert.equal(wb.getWorksheet('A车间').getCell('B3').value, '=1+1 合成品');
  const summary = wb.getWorksheet('夹具月结总表');
  assert.equal(summary.getCell('D3').value, 20); assert.equal(summary.getCell('E3').value, 21.6);
  assert.equal(summary.getCell('D4').value, 0); assert.equal(summary.getCell('D5').value, 10);
  const rows = []; summary.eachRow(row => rows.push(row.values));
  assert.ok(rows.some(values => values[2] === '未分类' && values[4] === 2));
  assert.equal(summary.getRow(summary.rowCount).getCell(4).value, 32);
  assert.equal(summary.getRow(summary.rowCount).getCell(5).value, 34.56);
  const bytes = await wb.xlsx.writeBuffer(); assert.ok(bytes.byteLength > 1000);
});
