'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const core = vm.runInNewContext(source.slice(source.indexOf('const RECORD_COLS'), source.indexOf('function replaceUsers')) +
  ';({SCHEMA_SQL,upsertRecords,deleteRecords,mergeRecordChanges,replaceRecords,rowToRecord,nextRecordId})');
const record = (id, extra = {}) => ({ id, productNo: 'item-' + id, updatedAt: '2026-10-19T01:00:00Z', ...extra });
function database(t) { const db = new DatabaseSync(':memory:'); db.exec(core.SCHEMA_SQL); t.after(() => db.close()); return db; }
const all = db => db.prepare('SELECT * FROM records ORDER BY id').all().map(r => core.rowToRecord(r));

test('stale full arrays keep another browser record and its newer approval', t => {
  const db = database(t);
  core.upsertRecords(db, [record(1, { status: 'approved', updatedAt: '2026-10-19T03:00:00Z' }), record(2)]);
  const result = core.mergeRecordChanges(db, [record(1, { status: 'pending' }), record(3)], []);
  assert.equal(result.skippedStale, 1); assert.deepEqual(all(db).map(r => r.id), [1, 2, 3]);
  assert.equal(all(db)[0].status, 'approved');
});
test('missing timestamps and equal instants cannot roll back an existing record', t => {
  const db = database(t); core.upsertRecords(db, [record(1, { status: 'approved' })]);
  core.upsertRecords(db, [record(1, { status: 'pending', updatedAt: undefined })]);
  core.upsertRecords(db, [record(1, { status: 'pending', updatedAt: '2026-10-19T09:00:00+08:00' })]);
  assert.equal(all(db)[0].status, 'approved');
});
test('AQL multi-level values round-trip with all existing columns', t => {
  const db = database(t); core.upsertRecords(db, [record(1, { aqlLevel: 'MAJ 0.65,MIN 2.5', orderNo: 'PO-1', fail: 150, sampleQty: 100 })]);
  assert.equal(all(db)[0].aqlLevel, 'MAJ 0.65,MIN 2.5'); assert.equal(all(db)[0].orderNo, 'PO-1'); assert.equal(all(db)[0].fail, 150);
});
test('future-dated old tabs cannot resurrect a deleted record', t => {
  const db = database(t); core.upsertRecords(db, [record(1)]); core.deleteRecords(db, [1]);
  const result = core.upsertRecords(db, [record(1, { updatedAt: '2099-01-01T00:00:00Z' })]);
  assert.equal(result.skippedTomb, 1); assert.equal(all(db).length, 0);
});
test('clear and replacement preserve tombstones against an old full-array save', t => {
  const db = database(t); core.upsertRecords(db, [record(1), record(2)]); core.replaceRecords(db, []);
  core.upsertRecords(db, [record(1), record(2)]); assert.equal(all(db).length, 0);
  core.replaceRecords(db, [record(2, { productNo: 'explicit-import' })]);
  core.upsertRecords(db, [record(1, { updatedAt: '2099-01-01T00:00:00Z' })]);
  assert.deepEqual(all(db).map(r => r.id), [2]); assert.equal(all(db)[0].productNo, 'explicit-import');
});
test('bootstrap high-water id stays above deleted ids so new records can be saved', t => {
  const db = database(t); core.upsertRecords(db, [record(500)]); core.deleteRecords(db, [500]);
  assert.equal(core.nextRecordId(db), 501);
  assert.equal(core.upsertRecords(db, [record(core.nextRecordId(db))]).accepted, 1);
  assert.deepEqual(all(db).map(r => r.id), [501]);
});
test('a bad upsert rolls back the same request deletion and its tombstone', t => {
  const db = database(t); core.upsertRecords(db, [record(1)]);
  assert.throws(() => core.mergeRecordChanges(db, [record(2, { supplier: { invalid: true } })], [1]));
  assert.deepEqual(all(db).map(r => r.id), [1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM record_tombstones').get().n, 0);
});
test('failed explicit replacement restores both original rows and original tombstones', t => {
  const db = database(t); core.upsertRecords(db, [record(1), record(2)]); core.deleteRecords(db, [2]);
  assert.throws(() => core.replaceRecords(db, [record(3), record(3)]));
  assert.deepEqual(all(db).map(r => r.id), [1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM record_tombstones WHERE id=2').get().n, 1);
});
// HTTP rejection of legacy VITE/browser-signed SSO tickets is covered in api-auth.test.js.

function browser() {
  const store = new Map([['xingxin_qms_dg-xingxin_records', JSON.stringify({ records: [] })]]);
  const requests = [];
  const sandbox = { window: {}, location: { pathname: '/qc/' }, console: { log() {}, warn() {} },
    document: { addEventListener() {}, getElementById() { return null; } }, localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    XMLHttpRequest: class { open() {} send() { this.status = 200; this.responseText = JSON.stringify({ records: [], user: { username: 'fixture-admin', role: 'admin', enabled: true }, companies: ['dg-xingxin'], csrfToken: 'fixture-csrf' }); } },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, body: JSON.parse(options.body), resolve })), setTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../qc-backend.js'), 'utf8'), sandbox);
  return { window: sandbox.window, requests };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('in-flight success only acknowledges the deletion revisions actually sent', async () => {
  const { window: w, requests } = browser(); w.__QC_MARK_DELETED([1]); const first = w.__QC_SYNC_NOW(); await tick();
  w.__QC_MARK_DELETED([1, 2]); requests[0].resolve({ ok: true, status: 200 }); await first;
  assert.deepEqual(Array.from(w.__QC_PENDING_DELETES), [1, 2]);
  const second = w.__QC_SYNC_NOW(); await tick(); assert.deepEqual(requests[1].body.deletedIds, [1, 2]);
  requests[1].resolve({ ok: true, status: 200 }); await second; assert.equal(w.__QC_PENDING_DELETES.length, 0);
});
test('overlapping replacements remain serialized and the later generation is retained', async () => {
  const { window: w, requests } = browser(); w.__QC_FORCE_REPLACE = 1; const first = w.__QC_SYNC_NOW(); await tick();
  w.__QC_FORCE_REPLACE = 2; const second = w.__QC_SYNC_NOW(); await tick(); assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true, status: 200 }); await first; await tick(); assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/records\/replace\?/); assert.equal(w.__QC_FORCE_REPLACE, 2);
  requests[1].resolve({ ok: true, status: 200 }); await second; assert.equal(w.__QC_FORCE_REPLACE, false);
});
test('failed record writes retain pending deletes and a replacement for retry', async () => {
  const { window: w, requests } = browser(); w.__QC_MARK_DELETED([3]); w.__QC_FORCE_REPLACE = 1;
  const pending = w.__QC_SYNC_NOW(); await tick(); requests[0].resolve({ ok: false, status: 500 }); await pending;
  assert.deepEqual(Array.from(w.__QC_PENDING_DELETES), [3]); assert.equal(w.__QC_FORCE_REPLACE, 1);
});
test('cancelled deletion staging restores earlier revisions without discarding later deletion intents', () => {
  const { window: w } = browser();
  w.__QC_MARK_DELETED([1]);
  const rollback = w.__QC_MARK_DELETED([1,2,2,3]);
  w.__QC_MARK_DELETED([3,4]);
  rollback();
  assert.deepEqual(Array.from(w.__QC_PENDING_DELETES), [1,3,4]);
  rollback(); assert.deepEqual(Array.from(w.__QC_PENDING_DELETES), [1,3,4]);
});

function appFunction(name, context) {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = app.indexOf('function ' + name + '('), body = app.indexOf('{', start);
  assert.notEqual(start, -1);
  let depth = 0;
  for (let i = body; i < app.length; i++) {
    if (app[i] === '{') depth++;
    if (app[i] === '}' && --depth === 0) return vm.runInNewContext('(' + app.slice(start, i + 1) + ')', context);
  }
  throw new Error('Function boundary not found');
}
test('clear acknowledgement followed by new entry uses a fresh id above tombstones', t => {
  const db = database(t); core.upsertRecords(db, [record(500)]);
  const state = { records: [record(500)], nextId: 501 };
  const context = { state, window: {}, recs: () => state.records, _backupConfirm: options => options.onConfirm(),
    persist: () => core.replaceRecords(db, state.records), showToast() {}, _backupLog() {}, _backupRefreshAll() {} };
  appFunction('backupClearAll', context)();
  assert.equal(state.records.length, 0); assert.equal(state.nextId, 501);
  assert.equal(core.upsertRecords(db, [record(state.nextId++)]).accepted, 1);
});
test('backup replace uses the replacement channel and does not reset its allocated ids', () => {
  const state = { records: [record(500)], nextId: 501 };
  const context = { state, window: {}, nowIso: () => '2026-10-19T05:00:00Z', persist() {}, showToast() {}, _backupLog() {}, _backupRefreshAll() {} };
  appFunction('_backupDoImport', context)([{ productNo: 'imported' }], 'replace');
  assert.equal(state.records[0].id, 501); assert.equal(state.nextId, 502);
  assert.ok(context.window.__QC_FORCE_REPLACE);
});
