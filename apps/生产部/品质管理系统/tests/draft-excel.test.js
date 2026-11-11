'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { XLSX, codec } = require('./fixtures/draft-excel-runtime');
function sample() {
  const draft = { owner: 'fixture', company: 'dg-xingxin', revision: 1, token: 'fixture',
    state: { records: [{ id: 8894027338886122, date: '2026-11-10', supplier: 'fixture', productNo: '00123',
      qty: 0, remark: '=literal text', defects: [{ desc: 'fixture', qty: 1 }], sampleQty: null }], nextId: 8894027338886123 },
    baseline: { versions: { 8894027338886122: '2026-11-09T00:00:00.000Z' } }, deletedIds: [] };
  return { version: 1, backupType: 'pending-records', owner: draft.owner, company: draft.company,
    count: 1, records: draft.state.records, draftRecovery: { originalRaw: JSON.stringify(draft, null, 2) } };
}
function roundtrip(workbook) {
  return XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }), { type: 'array', raw: true });
}
test('real XLSX preserves exact long IDs, zero/null, nested details, literal formulas and original draft bytes', () => {
  const original = sample(), workbook = roundtrip(codec.encode(original, XLSX));
  assert.equal(workbook.Sheets.验货草稿.A2.t, 's');
  assert.equal(workbook.Sheets.验货草稿.A2.v, '8894027338886122');
  assert.equal(workbook.Sheets.验货草稿.G2.v, '00123');
  assert.equal(workbook.Workbook.Sheets[1].Hidden, 1);
  assert.deepEqual(codec.decode(workbook, XLSX), original);
});
test('editing a visible quantity updates only its record and retains the original server baseline', () => {
  const original = sample(), workbook = codec.encode(original, XLSX);
  workbook.Sheets.验货草稿.L2 = { t: 'n', v: 25 };
  const decoded = codec.decode(roundtrip(workbook), XLSX), draft = JSON.parse(decoded.draftRecovery.originalRaw);
  assert.equal(decoded.records[0].qty, 25);
  assert.deepEqual(draft.baseline, JSON.parse(original.draftRecovery.originalRaw).baseline);
  assert.deepEqual(draft.changedIds, [8894027338886122]);
  assert.deepEqual(draft.state.records, decoded.records);
});
test('hidden metadata chunks and oversized detail cells retain complete Unicode source content', () => {
  const original = sample();
  original.records[0].remark = '合成内容🙂'.repeat(12000);
  const draft = JSON.parse(original.draftRecovery.originalRaw); draft.state.records = original.records;
  original.draftRecovery.originalRaw = JSON.stringify(draft);
  const workbook = roundtrip(codec.encode(original, XLSX));
  assert.ok(XLSX.utils.decode_range(workbook.Sheets._QMS草稿恢复['!ref']).e.r > 1);
  assert.deepEqual(codec.decode(workbook, XLSX), original);
});
test('missing metadata, changed headers, duplicate IDs and real formula cells cannot silently become a normal import', () => {
  let workbook = codec.encode(sample(), XLSX); delete workbook.Sheets._QMS草稿恢复;
  assert.throws(() => codec.decode(workbook, XLSX), /恢复信息/);
  workbook = codec.encode(sample(), XLSX); workbook.Sheets.验货草稿.A1.v = 'changed';
  assert.throws(() => codec.decode(workbook, XLSX), /表头/);
  workbook = codec.encode(sample(), XLSX); workbook.Sheets.验货草稿.L2.f = '1+1';
  assert.throws(() => codec.decode(workbook, XLSX), /公式/);
  const original = sample(); original.records.push({ ...original.records[0] });
  const draft = JSON.parse(original.draftRecovery.originalRaw); draft.state.records = original.records;
  original.draftRecovery.originalRaw = JSON.stringify(draft);
  assert.throws(() => codec.decode(codec.encode(original, XLSX), XLSX), /重复编号/);
});
test('an ordinary workbook continues through the ordinary spreadsheet import route', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['供应商','数量'],['fixture',1]]), 'Sheet1');
  assert.equal(codec.decode(workbook, XLSX), null);
});

test('an Excel-edited date serial is decoded to the application calendar format', () => {
  const workbook = codec.encode(sample(), XLSX);
  workbook.Sheets.验货草稿.B2 = { t: 'n', v: 46337 };
  const decoded = codec.decode(roundtrip(workbook), XLSX);
  const expected = XLSX.SSF.parse_date_code(46337);
  assert.equal(decoded.records[0].date, `${expected.y}-${String(expected.m).padStart(2, '0')}-${String(expected.d).padStart(2, '0')}`);
});
test('optional user-provided pending draft survives real XLSX export and import without record or baseline loss', {
  skip: !process.env.QC_DRAFT_FILE,
}, () => {
  const original = JSON.parse(fs.readFileSync(process.env.QC_DRAFT_FILE, 'utf8').replace(/^\uFEFF/, ''));
  const decoded = codec.decode(roundtrip(codec.encode(original, XLSX)), XLSX);
  assert.deepEqual(decoded, original);
  assert.equal(decoded.records.length, original.count);
});

test('Excel 1904 date system preserves the edited calendar date through binary roundtrip', () => {
  const workbook = codec.encode(sample(), XLSX);
  workbook.Workbook.WBProps = { date1904: true };
  workbook.Sheets.验货草稿.B2 = { t: 'n', v: 44875, z: 'yyyy-mm-dd' };
  const decoded = codec.decode(roundtrip(workbook), XLSX);
  assert.equal(decoded.records[0].date, '2026-11-11');
});

test('Excel error values cannot silently replace a draft quantity with an empty value', () => {
  const original = sample(), workbook = codec.encode(original, XLSX);
  const before = JSON.stringify(original);
  workbook.Sheets.验货草稿.L2 = { t: 'e', v: 7 };
  assert.throws(() => codec.decode(roundtrip(workbook), XLSX), /错误单元格/);
  assert.equal(JSON.stringify(original), before);
});
