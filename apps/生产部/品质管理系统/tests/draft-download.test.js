'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'qc-backend.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const { XLSX, codec: draftExcel } = require('./fixtures/draft-excel-runtime');
const legacyPath = process.env.QC_LEGACY_APP || path.join(__dirname, 'fixtures', 'legacy-backup-validator.js');
const clone = value => JSON.parse(JSON.stringify(value));

function namedFunction(source, name) {
  const begin = source.indexOf(`function ${name}(`);
  assert.ok(begin >= 0, `${name} exists`);
  const remaining = source.slice(begin + 1);
  const boundary = /\n[ \t]*function \w+\(/.exec(remaining);
  assert.ok(boundary, `${name} has a following function boundary`);
  return source.slice(begin, begin + 1 + boundary.index);
}

const downloadSource = ['recoveryMessage', 'recoveryIsCurrent', 'draftDownloadPackage', 'downloadBlockedDraft']
  .map(name => namedFunction(backend, name)).join('\n');

function sampleDraft(changes = {}) {
  return { owner: '测试检验员', company: 'dg-xingxin', revision: 16,
    token: 'original-token', state: { records: [
      { id: 101, date: '2026-11-09', supplier: '测试供应商', qty: 20,
        defects: [{ desc: '原始不良描述', qty: 1 }], status: 'pending' },
      { id: 102, date: '2026-11-09', supplier: '测试供应商二', qty: 99, status: 'approved' },
    ], nextId: 8894027338886122 }, deletedIds: [100], deleteRevisions: { 100: 1 },
    nextDeleteRevision: 1, replacement: true, ...changes };
}

function harness(raw = JSON.stringify(sampleDraft(), null, 2) + '\r\n', options = {}) {
  const company = options.company || 'dg-xingxin';
  const owner = options.owner || '测试检验员';
  const notices = [], blobs = [], downloads = [], revoked = [], storageMutations = [];
  const pending = 'xingxin_qms_' + company + '_pending_records_' + encodeURIComponent(owner);
  const originalStorage = { [pending]: raw, [pending + '_conflict_copy']: raw };
  const storage = { ...originalStorage };
  const context = {
    COMPANY: company,
    blockedRecovery: { owner, raw, backupKey: pending + '_conflict_copy' },
    window: { __QC_AUTH: { company, user: { username: owner } }, __QC_DRAFT_RECOVERY_BLOCKED: true, __QC_DRAFT_EXCEL: draftExcel },
    XLSX,
    Blob,
    URL: {
      createObjectURL(blob) { blobs.push(blob); return 'blob:test-download'; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'a');
        return { click() { downloads.push({ href: this.href, name: this.download }); }, remove() {} };
      },
      body: { appendChild() {} },
    },
    localStorage: {
      getItem: key => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
      setItem: (key, value) => { storageMutations.push(['set', key]); storage[key] = value; },
      removeItem: key => { storageMutations.push(['remove', key]); delete storage[key]; },
    },
    setTimeout(callback) { callback(); },
    notice(message, error) { notices.push({ message, error }); },
  };
  vm.createContext(context);
  vm.runInContext(downloadSource, context, { filename: 'qc-backend.js:draft-download' });
  return { context, notices, blobs, downloads, revoked, storageMutations, storage, originalStorage, raw };
}

function assertUntouched(h) {
  assert.equal(h.context.blockedRecovery.raw, h.raw);
  assert.equal(h.context.window.__QC_DRAFT_RECOVERY_BLOCKED, true);
  assert.deepEqual(h.storage, h.originalStorage);
  assert.deepEqual(h.storageMutations, []);
}

test('download package exposes a complete standard records backup and preserves exact original raw bytes', () => {
  const raw = JSON.stringify(sampleDraft(), null, '\t').replace(/\n/g, '\r\n') + '\r\n  ';
  const h = harness(raw);
  const result = clone(h.context.draftDownloadPackage(raw));
  assert.equal(result.version, 1);
  assert.equal(result.backupType, 'pending-records');
  assert.equal(result.company, 'dg-xingxin');
  assert.equal(result.owner, '测试检验员');
  assert.equal(result.count, 2);
  assert.ok(typeof result.source === 'string' && result.source);
  assert.ok(Number.isFinite(Date.parse(result.exportedAt)));
  assert.deepEqual(result.records, JSON.parse(raw).state.records);
  assert.equal(result.draftRecovery.originalRaw, raw);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'state'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'replacement'), false);
  assertUntouched(h);
});

test('the actual download handler creates a real Excel draft while leaving the lock and original draft intact', async () => {
  const h = harness();
  assert.equal(h.context.downloadBlockedDraft(), true);
  assert.equal(h.blobs.length, 1);
  assert.match(h.blobs[0].type, /spreadsheetml/);
  const result = draftExcel.decode(XLSX.read(Array.from(new Uint8Array(await h.blobs[0].arrayBuffer())), { type: 'array' }), XLSX);
  assert.equal(result.count, 2);
  assert.deepEqual(result.records, JSON.parse(h.raw).state.records);
  assert.equal(result.draftRecovery.originalRaw, h.raw);
  assert.deepEqual(h.downloads, [{ href: 'blob:test-download', name: '品质未同步草稿-dg-xingxin-测试检验员.xlsx' }]);
  assert.deepEqual(h.revoked, ['blob:test-download']);
  assertUntouched(h);
});

test('malformed or mismatched drafts retain raw-download access and warn they are not importable backups', async () => {
  const invalid = [
    '{bad JSON',
    JSON.stringify(sampleDraft({ company: 'sy-huadeng' })),
    JSON.stringify(sampleDraft({ owner: '另一个账号' })),
    JSON.stringify(sampleDraft({ state: { records: 'not-an-array' } })),
    JSON.stringify(sampleDraft({ state: null })),
  ];
  for (const raw of invalid) {
    const h = harness(raw);
    assert.throws(() => h.context.draftDownloadPackage(raw));
    assert.equal(h.context.downloadBlockedDraft(), true);
    assert.equal(h.blobs.length, 1);
    assert.equal(await h.blobs[0].text(), raw);
    assert.equal(h.downloads.length, 1);
    assert.ok(h.notices.some(entry => entry.error));
    assert.ok(h.notices.some(entry => /导入/.test(entry.message)));
    assertUntouched(h);
  }
});

test('a different current login cannot download the blocked account draft', () => {
  const h = harness();
  h.context.window.__QC_AUTH.user.username = '另一个账号';
  assert.equal(h.context.downloadBlockedDraft(), false);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.blobs.length, 0);
  assertUntouched(h);
});

test('a missing Excel engine leaves the pending draft intact and reports the download failure', () => {
  const h = harness(); delete h.context.XLSX;
  assert.equal(h.context.downloadBlockedDraft(), false);
  assert.equal(h.downloads.length, 0); assertUntouched(h);
  assert.ok(h.notices.some(entry => entry.error));
});

test('new download files pass the actual legacy importer validator through top-level records', {
  skip: !fs.existsSync(legacyPath),
}, () => {
  const legacy = fs.readFileSync(legacyPath, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(process.env.QC_LEGACY_APP ? namedFunction(legacy, '_backupValidate') : legacy, context);
  const h = harness();
  const result = h.context.draftDownloadPackage(h.raw);
  assert.notEqual(context._backupValidate(JSON.parse(h.raw)), null, 'legacy importer rejects the old raw envelope');
  assert.equal(context._backupValidate(result), null, 'legacy importer accepts the standardized download');
  assert.deepEqual(clone(result.records || result), JSON.parse(h.raw).state.records,
    'the same legacy incoming-records expression returns the complete record list');
});

test('the new importer recognizes the standard pending-records package as a draft and forbids replacement', () => {
  const h = harness();
  const result = h.context.draftDownloadPackage(h.raw);
  const section = app.indexOf('   ② 导入 JSON 备份');
  const begin = app.lastIndexOf('/*', section);
  const end = app.indexOf('function backupClearAll()', section);
  const originalRecords = [{ id: 200, date: '2026-11-09', supplier: '服务器已有记录' }];
  let persisted = 0;
  const notices = [];
  const context = {
    window: {}, state: { records: clone(originalRecords), nextId: 31 },
    can: () => true, getCompany: () => 'dg-xingxin',
    persist: () => { persisted++; return true; },
    showToast: message => notices.push(message), _backupLog() {},
  };
  vm.createContext(context);
  vm.runInContext(app.slice(begin, end), context);
  const decoded = context._backupReadPackage(result);
  assert.equal(decoded.isDraft, true);
  assert.deepEqual(clone(decoded.records), JSON.parse(h.raw).state.records);
  assert.equal(context._backupDoImport(result, 'replace'), false);
  assert.deepEqual(clone(context.state.records), originalRecords);
  assert.equal(persisted, 0);
  assert.ok(notices.some(message => /追加|覆盖/.test(message)));
});

test('optional actual user draft exports every record and preserves the original JSON exactly', {
  skip: !process.env.QC_DRAFT_FIXTURE,
}, async () => {
  const raw = fs.readFileSync(process.env.QC_DRAFT_FIXTURE, 'utf8');
  const draft = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const h = harness(raw, { company: draft.company, owner: draft.owner });
  assert.equal(h.context.downloadBlockedDraft(), true);
  const result = draftExcel.decode(XLSX.read(Array.from(new Uint8Array(await h.blobs[0].arrayBuffer())), { type: 'array' }), XLSX);
  assert.equal(result.count, draft.state.records.length);
  assert.deepEqual(result.records, draft.state.records);
  assert.equal(result.draftRecovery.originalRaw, raw);
  assertUntouched(h);
});
