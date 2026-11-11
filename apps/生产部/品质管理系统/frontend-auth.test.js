'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { XLSX, codec: draftExcel } = require('./tests/fixtures/draft-excel-runtime');
const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const company = 'dg-xingxin';
const prefix = 'xingxin_qms_' + company + '_';
const admin = { username: 'qc-admin', name: '品质', role: 'admin', enabled: true, perms: {} };
const auth = user => ({ ok: true, user: user || admin, companies: [company], csrfToken: 'synthetic-csrf' });
const bootstrap = user => ({ ...auth(user), records: [], nextId: 501, users: [admin], partners: [], defectLib: [] });
const tick = () => new Promise(resolve => setImmediate(resolve));
function browser({ authenticated = true, pathname = '/qc/', cached = [], handler } = {}) {
  const store = new Map(cached), elements = new Map(), calls = [], messages = [], listeners = [], unloadListeners = new Set();
  let data = bootstrap(), status = authenticated ? 200 : 401, reloads = 0, shows = 0;
  function element(id, value = '') {
    const el = { id, value, textContent: '', innerHTML: '', style: {}, dataset: {}, disabled: false, children: [],
      setAttribute() {}, focus() {}, click() { this.clicked = true; }, remove() { this.removed = true; }, appendChild(child) { this.children.push(child); },
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
    elements.set(id, el); return el;
  }
  for (const id of ['loginScreen','appWrapper','loginUsername','loginPassword','loginError','companySelector','userModal','userModalErr',
    'umUsername','umPassword','umPassword2','umRole','umName','umDept']) element(id);
  const button = element('loginButton');
  const ctx = { console: { log() {}, warn() {}, error() {} }, URLSearchParams, URL, Blob, Promise,
    XLSX, __QC_DRAFT_EXCEL: draftExcel,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, requestAnimationFrame() {},
    addEventListener(event, fn) { if (event === 'beforeunload') unloadListeners.add(fn); },
    removeEventListener(event, fn) { if (event === 'beforeunload') unloadListeners.delete(fn); }, navigator: {},
    location: { pathname, search: '', hash: '', reload() { reloads++; } }, history: { replaceState(...args) { ctx.replaced = args[2]; } },
    document: { readyState: 'loading', addEventListener(event, fn) { if (event === 'DOMContentLoaded') listeners.push(fn); },
      getElementById: id => elements.get(id) || Array.from(elements.values()).find(el => el.id === id) || null, querySelector: selector => selector === '#loginFields button' ? button : null,
      querySelectorAll: () => [], createElement: () => element('created-' + elements.size), body: { appendChild() {} } },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    XMLHttpRequest: class { open(method, url, async) { this.url = url; assert.equal(async, false); } send() {
      calls.push({ url: this.url, method: 'XHR' }); this.status = status; this.responseText = JSON.stringify(data);
    } },
    fetch(url, options = {}) {
      calls.push({ url, ...options, parsed: options.body && JSON.parse(options.body) });
      const recordSync = url.includes('/api/records?');
      const request = options.body && JSON.parse(options.body);
      const confirmation = () => ({ ok: true, confirmedRecords: request.records, confirmedDeletedIds: request.deletedIds });
      if (handler) {
        const result = handler(url, options, calls);
        if (result !== undefined) return Promise.resolve(result).then(response => {
          if (recordSync && response.ok && !Object.hasOwn(response, 'json')) return { ...response, json: async () => confirmation() };
          return response;
        });
      }
      const value = recordSync ? confirmation() : url.includes('/api/session') || url.includes('/api/login') ? auth() : url.includes('/api/ai/status') ? { ready: false } : { ok: true };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
    }, confirm: () => true,
  };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(source('qc-backend.js'), ctx);
  vm.runInContext(source('app.js'), ctx);
  ctx.showToast = (text, type) => messages.push({ text, type });
  ctx._showApp = () => shows++;
  ctx.renderUsersPage = () => {};
  const run = code => vm.runInContext(code, ctx);
  return { ctx, store, elements, calls, messages, run, button, listeners, unloadListeners,
    setBootstrap(value, code = 200) { data = value; status = code; }, get shows() { return shows; }, get reloads() { return reloads; } };
}

test('401 bootstrap rejects forged cached admin and old switch credentials, without creating default accounts', () => {
  const b = browser({ authenticated: false, cached: [[prefix + 'session', JSON.stringify({ username: 'jc', role: 'admin' })],
    [prefix + 'users', JSON.stringify([{ username: 'jc', role: 'admin', enabled: true, password: 'forged-hash' }])],
    ['xingxin_qms_switch_ticket', JSON.stringify({ username: 'jc', pwd: 'forged-hash', ts: Date.now() })]] });
  b.ctx.requireLogin();
  assert.equal(b.ctx.getCurrentUser(), null); assert.equal(b.ctx.can('manageUsers'), false); assert.equal(b.ctx.__QC_BACKEND_OK, false);
  assert.equal(b.store.has(prefix + 'session'), false); assert.equal(b.store.has('xingxin_qms_switch_ticket'), false);
  assert.equal(JSON.parse(b.store.get(prefix + 'users'))[0].password, undefined);
  const empty = browser({ authenticated: false }); empty.ctx.requireLogin(); empty.ctx.initData();
  assert.deepEqual(JSON.parse(empty.store.get(prefix + 'users')), []); assert.equal(empty.run('state.records.length'), 0);
  assert.equal(empty.calls.filter(c => c.method === 'POST').length, 0);
});

test('200 bootstrap missing server auth shape fails closed', () => {
  const b = browser(); b.setBootstrap({ records: [] }); assert.equal(b.ctx.__QC_BOOTSTRAP(), false);
  assert.equal(b.ctx.getCurrentUser(), null); assert.equal(b.ctx.can('manageUsers'), false);
});

test('permissions come from server user even if cached same account is promoted', () => {
  const b = browser(); b.setBootstrap(bootstrap({ username: 'reader', role: 'viewer', enabled: true })); b.ctx.__QC_BOOTSTRAP();
  b.store.set(prefix + 'users', JSON.stringify([{ username: 'reader', role: 'admin', enabled: true }]));
  assert.equal(b.ctx._liveUser().role, 'viewer'); assert.equal(b.ctx.can('manageUsers'), false);
});

for (const pathname of ['/', '/qc/']) test('native login uses raw password, company cookie request and fresh bootstrap at ' + pathname, async () => {
  const b = browser({ authenticated: false, pathname }); b.setBootstrap({ ...bootstrap(), records: [{ id: 78 }], nextId: 79 });
  b.elements.get('loginUsername').value = ' qc-admin '; b.elements.get('loginPassword').value = ' raw password ';
  await b.ctx.login();
  const call = b.calls.find(c => c.url.includes('/api/login'));
  assert.equal(call.url, pathname === '/' ? '/api/login?company=' + company : '/qc/api/login?company=' + company);
  assert.equal(call.credentials, 'same-origin'); assert.deepEqual(call.parsed, { username: 'qc-admin', password: ' raw password ' });
  assert.equal(b.run('state.records[0].id'), 78); assert.equal(b.shows, 1); assert.equal(b.button.disabled, false);
  assert.equal(b.calls.some(c => c.url.includes('/api/users')), false);
  assert.equal(b.store.has(prefix + 'session'), false);
});

test('double login submits once; failed login leaves no trusted session or cached fallback', async () => {
  let release;
  const b = browser({ authenticated: false, handler: url => url.includes('/api/login') ? new Promise(resolve => { release = resolve; }) : undefined });
  b.elements.get('loginUsername').value = 'qc-admin'; b.elements.get('loginPassword').value = 'bad';
  const pending = b.ctx.login(); await b.ctx.login(); assert.equal(b.button.disabled, true);
  assert.equal(b.calls.filter(c => c.url.includes('/api/login')).length, 1);
  release({ ok: false, status: 401, json: async () => ({ error: '用户名或密码错误' }) }); await pending;
  assert.equal(b.ctx.getCurrentUser(), null); assert.equal(b.shows, 0); assert.equal(b.button.disabled, false);
  assert.match(b.elements.get('loginError').textContent, /用户名或密码错误/);
});

test('successful login with a failed bootstrap cannot enter app using old cache', async () => {
  const b = browser({ authenticated: false }); b.elements.get('loginUsername').value = 'qc-admin'; b.elements.get('loginPassword').value = 'good-password';
  await b.ctx.login(); assert.equal(b.shows, 0); assert.equal(b.ctx.getCurrentUser(), null);
  assert.match(b.elements.get('loginError').textContent, /数据加载失败/);
});

test('company switch never carries password/hash or creates target-company session', () => {
  const b = browser(); b.store.set('xingxin_qms_switch_ticket', 'old'); b.ctx.swPickCompany('hy-huakang-a');
  assert.equal(b.store.get('xingxin_qms_company'), 'hy-huakang-a'); assert.equal(b.reloads, 1);
  assert.equal(b.store.has('xingxin_qms_switch_ticket'), false); assert.equal(b.store.has('xingxin_qms_hy-huakang-a_session'), false);
});

test('logout sends same-origin cookie and CSRF; server failure keeps current authenticated screen', async () => {
  const b = browser(); await b.ctx.logout();
  const call = b.calls.find(c => c.url.includes('/api/logout'));
  assert.equal(call.headers['X-QC-CSRF'], 'synthetic-csrf'); assert.equal(call.credentials, 'same-origin'); assert.equal(b.ctx.getCurrentUser(), null);
  const failed = browser({ handler: url => url.includes('/api/logout') ? Promise.reject(new Error('offline')) : undefined });
  await failed.ctx.logout(); assert.equal(failed.ctx.getCurrentUser().username, 'qc-admin'); assert.equal(failed.messages.at(-1).type, 'error');
});

for (const code of [401, 403, 500]) test('write ' + code + ' visibly fails and keeps replacement/deletions for retry', async () => {
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: false, status: code }) : undefined });
  b.ctx.__QC_MARK_DELETED([3]); b.ctx.__QC_FORCE_REPLACE = 1;
  assert.equal(await b.ctx.__QC_SYNC_NOW(), false);
  assert.deepEqual(Array.from(b.ctx.__QC_PENDING_DELETES), [3]); assert.equal(b.ctx.__QC_FORCE_REPLACE, 1);
  assert.match(b.ctx.__QC_SYNC_NOTICE, /服务器尚未保存/);
  const call = b.calls.find(c => c.url.includes('/api/records'));
  assert.equal(call.headers['X-QC-CSRF'], 'synthetic-csrf'); assert.equal(call.credentials, 'same-origin');
  assert.equal(b.ctx.getCurrentUser() === null, code === 401);
});

test('serialized writes acknowledge only deletion revisions actually sent', async () => {
  const requests = [];
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => requests.push(resolve)) : undefined });
  b.ctx.__QC_MARK_DELETED([1]); const first = b.ctx.__QC_SYNC_NOW(); await tick();
  b.ctx.__QC_MARK_DELETED([1, 2]); const second = b.ctx.__QC_SYNC_NOW(); await tick(); assert.equal(requests.length, 1);
  requests[0]({ ok: true, status: 200 }); await first; await tick();
  assert.deepEqual(Array.from(b.ctx.__QC_PENDING_DELETES), [1, 2]); requests[1]({ ok: true, status: 200 }); await second;
  assert.equal(b.ctx.__QC_PENDING_DELETES.length, 0);
});

for (const password of ['', ' new raw password ']) test('user edit sends newPassword only when explicitly changed and never caches credentials: ' + !!password, async () => {
  const b = browser(); b.store.set(prefix + 'users', JSON.stringify([admin, { username: 'alice', role: 'viewer', enabled: true }]));
  b.run("_editingUsername='alice'");
  for (const [id, value] of Object.entries({ umUsername: 'alice', umPassword: password, umPassword2: password, umRole: 'viewer', umName: 'Alice', umDept: '品质' })) b.elements.get(id).value = value;
  await b.ctx._saveUser();
  const call = b.calls.find(c => c.url.includes('/api/users')); const user = call.parsed.users.find(u => u.username === 'alice');
  assert.equal(user.password, undefined); assert.equal(Object.hasOwn(user, 'newPassword'), !!password); if (password) assert.equal(user.newPassword, password);
  assert.equal(/password|newPassword/.test(b.store.get(prefix + 'users')), false);
  assert.equal(b.messages.some(m => m.text === '✓ 账号已保存'), true);
});

test('failed user save keeps editor open and does not cache raw password or claim success', async () => {
  const b = browser({ handler: url => url.includes('/api/users') ? Promise.resolve({ ok: false, status: 500 }) : undefined });
  b.run("_editingUsername=null"); b.elements.get('userModal').style.display = 'flex';
  for (const [id, value] of Object.entries({ umUsername: 'newuser', umPassword: 'new-password', umPassword2: 'new-password', umRole: 'viewer' })) b.elements.get(id).value = value;
  await b.ctx._saveUser(); assert.equal(b.elements.get('userModal').style.display, 'flex');
  assert.equal(b.messages.some(m => m.text === '✓ 账号已保存'), false); assert.equal(b.store.get(prefix + 'users').includes('new-password'), false);
});

test('old portal ticket is removed from URL without network calls or fake users/sessions', () => {
  const b = browser({ authenticated: false }); const before = b.calls.length;
  b.ctx.location.search = '?sso_ticket=forged&keep=1'; b.ctx.location.hash = '#target';
  vm.runInContext(source('sso.js'), b.ctx);
  assert.equal(b.ctx.replaced, '/qc/?keep=1#target'); assert.equal(b.calls.length, before);
  assert.equal(b.store.has(prefix + 'session'), false); assert.match(b.ctx.__QC_LEGACY_SSO_NOTICE, /品质账号登录/);
});

for (const code of [401, 403]) test('AI request helper retains company and CSRF; only 401 clears UI trust (' + code + ')', async () => {
  const b = browser({ handler: url => url.includes('/api/ai/ocr-extract') ? Promise.resolve({ ok: false, status: code }) : undefined });
  await b.ctx.__QC_REQUEST('/api/ai/ocr-extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"image":"synthetic"}' });
  const call = b.calls.at(-1); assert.match(call.url, /\/qc\/api\/ai\/ocr-extract\?company=dg-xingxin$/);
  assert.equal(call.headers['X-QC-CSRF'], 'synthetic-csrf'); assert.equal(b.ctx.getCurrentUser() === null, code === 401);
  assert.match(source('ai-ocr.js'), /window\.__QC_REQUEST\('\/api\/ai\/ocr-extract'/);
  assert.doesNotMatch(source('ai-ocr.js'), /fetch\(/);
});

function entryFixture(b) {
  for (const [id, value] of Object.entries({ f_date: '2026-10-24', f_supplier: 'Fixture Supplier', f_qty: '100',
    f_sampleQty: '20', f_result: 'PASS', f_type: '成品', f_aqlLevel: 'MAJ 0.65' })) {
    b.elements.set(id, { value, dataset: {}, style: {} });
  }
  b.elements.set('reviewTableWrap', { innerHTML: '', querySelector: () => null });
  b.elements.set('recordsTableWrap', { innerHTML: '' });
  b.run(`getSupplierOptions=()=>['Fixture Supplier']; getCustomerOptions=()=>[]; getProcessTypeOptions=()=>[];
    renderSupplierDatalist=()=>{}; renderCustomerDatalist=()=>{}; renderProcessTypeDatalist=()=>{};
    renderInspectorDatalist=()=>{}; bindNameWhitelistCheck=()=>{}; syncAqlLevelPills=()=>{};
    switchModalMode=()=>{}; _syncOrderNoNA=()=>{}; updateTopKpis=()=>{};
    _syncCheckAllState=()=>{}; _updateBatchBtn=()=>{}; applyColLock=()=>{};
    closeModalDirect=()=>{editingId=null}; currentPage='test';`);
}

test('record entry permission gates both rendered edit actions and direct open/save handlers', () => {
  const b = browser(); entryFixture(b);
  const reader = { username: 'reader', role: 'viewer', enabled: true, perms: { records: { e: 0 } } };
  b.setBootstrap(bootstrap(reader)); b.ctx.__QC_BOOTSTRAP();
  b.run(`state={records:[{id:1,status:'pending',date:'2026-10-24',supplier:'Fixture Supplier'},
    {id:2,status:'rejected',date:'2026-10-24',supplier:'Fixture Supplier'}],nextId:501};`);
  assert.equal(b.ctx.can('createRecord'), false);
  b.ctx.renderReviewPage();
  assert.doesNotMatch(b.elements.get('reviewTableWrap').innerHTML, /onclick="openEditModal/);
  b.ctx.filterRecords();
  assert.doesNotMatch(b.elements.get('recordsTableWrap').innerHTML, /onclick="openEditModal/);
  b.ctx.openEditModal(1); assert.equal(b.run('editingId'), null);
  const before = b.run('JSON.stringify(state)');
  b.run('editingId=2'); assert.equal(b.ctx.saveRecord(), false);
  assert.equal(b.run('JSON.stringify(state)'), before);
  assert.equal(b.calls.some(call => call.method === 'POST'), false);

  const entrant = { username: 'entry', role: 'viewer', enabled: true, perms: {} };
  b.setBootstrap(bootstrap(entrant)); b.ctx.__QC_BOOTSTRAP();
  assert.equal(b.ctx.can('createRecord'), true); assert.equal(b.ctx.can('editRecord'), false);
  assert.equal(b.ctx.can('reviewRecord'), false); assert.equal(b.ctx.can('deleteRecord'), false);
  b.ctx.renderReviewPage();
  assert.match(b.elements.get('reviewTableWrap').innerHTML, /onclick="openEditModal\(1\)/);
  b.ctx.openEditModal(2); assert.equal(b.run('editingId'), 2);
  assert.equal(b.ctx.saveRecord(), true);
  assert.equal(b.run('state.records[1].status'), 'pending');
  assert.equal(b.run('state.records[1].resubmitted'), true);
  b.run("state.records[0].status='approved'; editingId=null");
  b.ctx.openEditModal(1); assert.equal(b.run('editingId'), null);
  b.run('editingId=1'); assert.equal(b.ctx.saveRecord(), false);
  assert.equal(b.run('state.records[0].status'), 'approved');

  // The API authorizes an approved business edit with review.a, separately
  // from entry.e. Keep the existing reviewer path without exposing a button.
  b.setBootstrap(bootstrap({ username: 'reviewer', role: 'viewer', enabled: true,
    perms: { records: { e: 0 }, review: { a: 1 } } })); b.ctx.__QC_BOOTSTRAP();
  b.ctx.openEditModal(1); assert.equal(b.run('editingId'), 1);
  assert.equal(b.ctx.saveRecord(), true); assert.equal(b.run('state.records[0].status'), 'approved');
});

test('new defect-library values remain text in both datalist attributes and the library table', () => {
  const b = browser();
  b.elements.set('defectDescList', { innerHTML: '' });
  b.elements.set('page-defectlib', { innerHTML: '' });
  const value = { name: '\"><img src=x onerror=alert(1)>', category: "' & <svg onload=alert(2)>",
    defaultLevel: '\"><svg onload=alert(3)>', keywords: ['<img src=x onerror=alert(4)>'], enabled: true };
  b.ctx._saveDefectLib([value]); b.ctx.refreshDefectDescDatalist(); b.ctx.renderDefectLibPage();
  assert.equal(b.elements.get('defectDescList').innerHTML,
    `<option value="${b.ctx._esc(value.name)}" data-level="${b.ctx._esc(value.defaultLevel)}" data-cat="${b.ctx._esc(value.category)}">`);
  const html = b.elements.get('page-defectlib').innerHTML;
  for (const text of [value.name, value.category, value.defaultLevel, value.keywords[0]]) assert.ok(html.includes(b.ctx._esc(text)));
  assert.doesNotMatch(html, /<img|<svg/);
  assert.deepEqual(JSON.parse(b.store.get(prefix + 'defect_library')), [value]);
});

test('confirming a new defect then receiving 403 keeps the entry session and record draft for retry', async () => {
  let rejectRecords = true;
  const b = browser({ handler: url => {
    if (url.includes('/api/defects')) return Promise.resolve({ ok: false, status: 403 });
    if (url.includes('/api/records')) return Promise.resolve({ ok: !rejectRecords, status: rejectRecords ? 403 : 200 });
  } });
  entryFixture(b);
  const entrant = { username: 'entry', role: 'viewer', enabled: true, perms: {} };
  b.setBootstrap(bootstrap(entrant)); b.ctx.__QC_BOOTSTRAP();
  b.run("state={records:[],nextId:501}; _defectRows=[{desc:'Fixture unknown defect',qty:1,level:'MIN 2.5',category:'外观/质量'}]");
  b.listeners[0](); // Installs the actual persist/defect-library writers.
  assert.equal(b.ctx.saveRecord(), true);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), false); await tick();
  assert.equal(b.ctx.getCurrentUser().username, 'entry');
  assert.equal(b.ctx.__QC_BACKEND_OK, true);
  const defectWrite = b.calls.find(call => call.url.includes('/api/defects'));
  assert.equal(defectWrite.parsed.defectLib[0].name, 'Fixture unknown defect');
  assert.equal(defectWrite.headers['X-QC-CSRF'], 'synthetic-csrf');
  assert.match(defectWrite.url, /company=dg-xingxin$/);
  const recordWrite = b.calls.find(call => call.url.includes('/api/records'));
  assert.equal(recordWrite.parsed.records[0].defects[0].desc, 'Fixture unknown defect');
  assert.match(b.ctx.__QC_SYNC_NOTICE, /服务器尚未保存/);
  const key = prefix + 'pending_records_entry';
  assert.equal(JSON.parse(b.store.get(key)).state.records[0].defects[0].desc, 'Fixture unknown defect');
  rejectRecords = false; assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.equal(b.store.has(key), false); assert.equal(b.ctx.getCurrentUser().username, 'entry');
});


test('401 draft survives same-user reauthentication with deletes/replace and requires explicit retry', async () => {
  let reject = true;
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: !reject, status: reject ? 401 : 200 }) : undefined });
  b.store.set(prefix + 'records', JSON.stringify({ records: [{ id: 501, productNo: 'unsynced' }], nextId: 502 }));
  b.ctx.__QC_MARK_DELETED([4]); b.ctx.__QC_FORCE_REPLACE = 2;
  await b.ctx.__QC_SYNC_NOW(); const key = prefix + 'pending_records_qc-admin';
  const draft = JSON.parse(b.store.get(key)); assert.equal(draft.owner, 'qc-admin'); assert.deepEqual(draft.deletedIds, [4]); assert.equal(draft.replacement, 2);
  const posts = b.calls.filter(c => c.method === 'POST').length;
  b.ctx.__QC_BOOTSTRAP(); b.ctx.initData(); await tick();
  assert.equal(b.run('state.records[0].productNo'), 'unsynced'); assert.equal(b.calls.filter(c => c.method === 'POST').length, posts);
  assert.deepEqual(Array.from(b.ctx.__QC_PENDING_DELETES), [4]); assert.equal(b.ctx.__QC_FORCE_REPLACE, 2); assert.match(b.ctx.__QC_SYNC_NOTICE, /不会自动重发/);
  reject = false; assert.equal(await b.ctx.__QC_SYNC_NOW(), true); assert.equal(b.store.has(key), false);
});

test('a different authenticated user cannot view or replay the previous user draft; original draft remains', async () => {
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: false, status: 500 }) : undefined });
  b.store.set(prefix + 'records', JSON.stringify({ records: [{ id: 501, productNo: 'other-user-private-draft' }], nextId: 502 }));
  b.ctx.__QC_MARK_DELETED([7]); b.ctx.__QC_FORCE_REPLACE = 1; await b.ctx.__QC_SYNC_NOW();
  b.setBootstrap({ ...bootstrap({ username: 'alice', role: 'viewer', enabled: true }), records: [{ id: 10, productNo: 'server-record' }] });
  b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'server-record'); assert.equal(b.ctx.getCurrentUser().username, 'alice');
  assert.equal(b.ctx.__QC_PENDING_DELETES.length, 0); assert.equal(b.ctx.__QC_FORCE_REPLACE, false);
  assert.equal(b.store.has(prefix + 'pending_records_qc-admin'), true); assert.equal(b.store.has(prefix + 'pending_records_alice'), false);
});

test('page restart restores draft only after successful server authentication of its owner', async () => {
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: false, status: 500 }) : undefined });
  b.store.set(prefix + 'records', JSON.stringify({ records: [{ id: 501, productNo: 'restart-draft' }], nextId: 502 })); await b.ctx.__QC_SYNC_NOW();
  const anonymous = browser({ authenticated: false, cached: Array.from(b.store) });
  assert.equal(anonymous.ctx.getCurrentUser(), null); assert.equal(anonymous.ctx.__QC_SYNC_NOTICE.includes('草稿'), false);
  const restored = browser({ cached: Array.from(b.store) }); restored.ctx.initData();
  assert.equal(restored.run('state.records[0].productNo'), 'restart-draft'); assert.equal(restored.calls.some(c => c.method === 'POST'), false);
});

test('earlier successful response cannot clear a newer draft revision', async () => {
  const requests = [];
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => requests.push(resolve)) : undefined });
  const first = b.ctx.__QC_SYNC_NOW(); await tick();
  b.store.set(prefix + 'records', JSON.stringify({ records: [{ id: 99 }], nextId: 100 })); const second = b.ctx.__QC_SYNC_NOW();
  requests[0]({ ok: true, status: 200 }); await first; await tick();
  assert.equal(JSON.parse(b.store.get(prefix + 'pending_records_qc-admin')).state.records[0].id, 99);
  requests[1]({ ok: true, status: 200 }); await second; assert.equal(b.store.has(prefix + 'pending_records_qc-admin'), false);
});

test('queued old-session writes do not automatically resume after reauthentication', async () => {
  const requests = [];
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => requests.push(resolve)) : undefined });
  const first = b.ctx.__QC_SYNC_NOW(); await tick(); const second = b.ctx.__QC_SYNC_NOW();
  b.ctx.__QC_CLEAR_AUTH(); b.ctx.__QC_BOOTSTRAP();
  requests[0]({ ok: true, status: 200 }); await first; await second;
  assert.equal(requests.length, 1); assert.equal(b.store.has(prefix + 'pending_records_qc-admin'), true);
});

test('another tab draft token survives an acknowledgement with the same numeric revision', async () => {
  let finish;
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => { finish = resolve; }) : undefined });
  const pending = b.ctx.__QC_SYNC_NOW(); await tick();
  const key = prefix + 'pending_records_qc-admin'; const otherTab = JSON.parse(b.store.get(key));
  otherTab.token = 'different-tab-token'; otherTab.state.records = [{ id: 700, productNo: 'another-tab' }];
  b.store.set(key, JSON.stringify(otherTab)); finish({ ok: true, status: 200 }); await pending;
  assert.equal(JSON.parse(b.store.get(key)).state.records[0].productNo, 'another-tab');
});


test('late session response cannot replace a newer authenticated account', async () => {
  let finish;
  const b = browser({ handler: url => url.includes('/api/session') ? new Promise(resolve => { finish = resolve; }) : undefined });
  const pending = b.ctx.__QC_REFRESH_SESSION();
  b.setBootstrap(bootstrap({ username: 'alice', role: 'viewer', enabled: true })); b.ctx.__QC_BOOTSTRAP();
  finish({ ok: true, status: 200, json: async () => auth(admin) }); await pending;
  assert.equal(b.ctx.getCurrentUser().username, 'alice'); assert.equal(b.ctx.can('manageUsers'), false);
});

function failDraftStorage(b, allWrites = false) {
  const original = b.ctx.localStorage.setItem;
  b.ctx.localStorage.setItem = (key, value) => {
    if (allWrites || key.includes('pending_records_')) throw new Error('QuotaExceededError');
    return original(key, value);
  };
  return () => { b.ctx.localStorage.setItem = original; };
}
const pendingRecord = { id: 501, productNo: 'quota-draft', updatedAt: '2026-10-26T01:00:00Z' };
function setPendingRecord(b, records = [pendingRecord]) {
  b.store.set(prefix + 'records', JSON.stringify({ records, nextId: 502 }));
}

test('quota-degraded sends still run; failed sends survive same-owner bootstrap without automatic replay', async () => {
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: false, status: 500 }) : undefined });
  setPendingRecord(b); failDraftStorage(b);
  b.ctx.__QC_MARK_DELETED([7]); b.ctx.__QC_FORCE_REPLACE = 1;
  assert.equal(await b.ctx.__QC_SYNC_NOW(), false);
  const posts = b.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1);
  assert.equal(posts[0].parsed.records[0].productNo, 'quota-draft');
  assert.equal(b.store.has(prefix + 'pending_records_qc-admin'), false);
  assert.match(b.ctx.__QC_SYNC_NOTICE, /本地草稿备份不可用/);
  assert.equal(b.unloadListeners.size, 1);
  b.ctx.__QC_BOOTSTRAP(); b.ctx.initData(); await tick();
  assert.equal(b.run('state.records[0].productNo'), 'quota-draft');
  assert.deepEqual(Array.from(b.ctx.__QC_PENDING_DELETES), [7]); assert.equal(b.ctx.__QC_FORCE_REPLACE, 1);
  assert.equal(b.calls.filter(c => c.method === 'POST').length, posts.length);
  assert.match(b.ctx.__QC_SYNC_NOTICE, /不会自动重发/);
});

test('healthy routine saves remain quiet and do not install an unload warning', async () => {
  const b = browser(); setPendingRecord(b);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.equal(b.ctx.__QC_SYNC_NOTICE, '服务器已保存修改'); assert.equal(b.unloadListeners.size, 0);
  assert.equal(b.messages.length, 0);
  const banner = Array.from(b.elements.values()).find(el => el.id === 'qcSyncNotice'); assert.equal(banner.style.display, 'none');
});

test('only unprotected unacknowledged data installs beforeunload; confirmed saves remove it', async () => {
  let finish;
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => { finish = resolve; }) : undefined });
  assert.equal(b.unloadListeners.size, 0); setPendingRecord(b); failDraftStorage(b);
  const pending = b.ctx.__QC_SYNC_NOW(); await tick(); assert.equal(b.unloadListeners.size, 1);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  Array.from(b.unloadListeners)[0](event); assert.equal(event.prevented, true); assert.equal(event.returnValue, '');
  finish({ ok: true, status: 200 }); assert.equal(await pending, true);
  assert.equal(b.unloadListeners.size, 0); assert.equal(b.ctx.__QC_SYNC_NOTICE, '服务器已保存修改');
  const banner = Array.from(b.elements.values()).find(el => el.id === 'qcSyncNotice'); assert.equal(banner.style.display, 'none');
  assert.equal(b.messages.some(m => m.text === '服务器已保存修改'), false);
  b.setBootstrap({ ...bootstrap(), records: [pendingRecord], nextId: 502 }); b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'quota-draft'); assert.equal(b.unloadListeners.size, 0);
});

test('quota fallback stays private across authenticated users and retries only for its original owner', async () => {
  let reject = true;
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: !reject, status: reject ? 500 : 200 }) : undefined });
  setPendingRecord(b); failDraftStorage(b); await b.ctx.__QC_SYNC_NOW();
  const posts = b.calls.filter(c => c.method === 'POST').length;
  const alice = { username: 'alice', role: 'viewer', enabled: true };
  b.setBootstrap({ ...bootstrap(alice), records: [{ id: 10, productNo: 'alice-server' }] });
  b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'alice-server');
  assert.equal(b.calls.filter(c => c.method === 'POST').length, posts);
  reject = false; assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.deepEqual(b.calls.filter(c => c.method === 'POST').at(-1).parsed.records, []);
  assert.equal(b.unloadListeners.size, 1); // Original owner's unprotected data remains in memory.
  b.setBootstrap(bootstrap()); b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'quota-draft');
  assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.equal(b.calls.filter(c => c.method === 'POST').at(-1).parsed.records[0].productNo, 'quota-draft');
  assert.equal(b.unloadListeners.size, 0);
});

test('earlier confirmation cannot discard a newer volatile revision', async () => {
  const requests = [];
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => requests.push(resolve)) : undefined });
  setPendingRecord(b); failDraftStorage(b); const first = b.ctx.__QC_SYNC_NOW(); await tick();
  setPendingRecord(b, [{ ...pendingRecord, productNo: 'newer-quota-draft' }]); const second = b.ctx.__QC_SYNC_NOW();
  requests[0]({ ok: true, status: 200 }); await first; await tick(); assert.equal(b.unloadListeners.size, 1);
  assert.equal(requests.length, 2); assert.equal(b.calls.filter(c => c.method === 'POST')[1].parsed.records[0].productNo, 'newer-quota-draft');
  requests[1]({ ok: true, status: 200 }); await second; assert.equal(b.unloadListeners.size, 0);
});

test('confirmed volatile save clears only the stale durable draft it superseded', async () => {
  let reject = true;
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: !reject, status: reject ? 500 : 200 }) : undefined });
  setPendingRecord(b); await b.ctx.__QC_SYNC_NOW(); const key = prefix + 'pending_records_qc-admin'; assert.equal(b.store.has(key), true);
  setPendingRecord(b, [{ ...pendingRecord, productNo: 'confirmed-newer' }]); failDraftStorage(b); reject = false;
  assert.equal(await b.ctx.__QC_SYNC_NOW(), true); assert.equal(b.store.has(key), false); assert.equal(b.unloadListeners.size, 0);
  b.setBootstrap({ ...bootstrap(), records: [{ ...pendingRecord, productNo: 'confirmed-newer' }] }); b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'confirmed-newer');
});

test('a different tab durable draft survives confirmation of an unprotected local revision', async () => {
  let finish;
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => { finish = resolve; }) : undefined });
  setPendingRecord(b); failDraftStorage(b); const pending = b.ctx.__QC_SYNC_NOW(); await tick();
  const other = { owner: 'qc-admin', company, revision: 1, token: 'other-tab', state: { records: [{ id: 700 }] }, deletedIds: [] };
  const key = prefix + 'pending_records_qc-admin'; b.store.set(key, JSON.stringify(other));
  finish({ ok: true, status: 200 }); await pending;
  assert.equal(JSON.parse(b.store.get(key)).token, 'other-tab'); assert.equal(b.unloadListeners.size, 0);
});

test('a late old-user response cannot clear or replay a volatile draft under the new user', async () => {
  let finish;
  const b = browser({ handler: url => url.includes('/api/records') ? new Promise(resolve => { finish = resolve; }) : undefined });
  setPendingRecord(b); failDraftStorage(b); const pending = b.ctx.__QC_SYNC_NOW(); await tick();
  b.setBootstrap({ ...bootstrap({ username: 'alice', role: 'viewer', enabled: true }), records: [{ id: 10, productNo: 'alice-server' }] });
  b.ctx.__QC_BOOTSTRAP(); b.ctx.initData(); finish({ ok: true, status: 200 }); assert.equal(await pending, false);
  assert.equal(b.run('state.records[0].productNo'), 'alice-server'); assert.equal(b.unloadListeners.size, 1);
  assert.equal(b.calls.filter(c => c.method === 'POST').length, 1);
  b.setBootstrap(bootstrap()); b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'quota-draft'); assert.equal(b.calls.filter(c => c.method === 'POST').length, 1);
});

test('complete write failure keeps only page memory and warns; storage recovery can protect then send it', async () => {
  let reject = true;
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: !reject, status: reject ? 500 : 200 }) : undefined });
  setPendingRecord(b); const recoverStorage = failDraftStorage(b, true); await b.ctx.__QC_SYNC_NOW();
  assert.equal(b.unloadListeners.size, 1); assert.equal(b.ctx.__QC_BOOTSTRAP(), false); assert.equal(b.unloadListeners.size, 1);
  recoverStorage(); b.setBootstrap(bootstrap()); assert.equal(b.ctx.__QC_BOOTSTRAP(), true); b.ctx.initData();
  assert.equal(b.run('state.records[0].productNo'), 'quota-draft');
  reject = false; assert.equal(await b.ctx.__QC_SYNC_NOW(), true); assert.equal(b.unloadListeners.size, 0);
});


test('capped records select and delete only visible rows; search still reaches rows outside the cap', () => {
  const b = browser(), wrap = { innerHTML:'' }, search = { value:'' }, originalGet = b.ctx.document.getElementById;
  b.ctx.document.getElementById = id => id === 'recordsTableWrap' ? wrap : id === 'searchInput' ? search : originalGet(id);
  const records = Array.from({length:305}, (_,i) => ({id:i+1,date:'2026-11-03',productNo:'Synthetic-'+String(i+1).padStart(3,'0'),status:'approved'}));
  b.run('state='+JSON.stringify({records,nextId:306})); b.ctx.filterRecords();
  assert.equal((wrap.innerHTML.match(/class="row-check"/g)||[]).length, 300);
  b.ctx._onCheckAll({checked:true}); assert.equal(b.run('_selectedIds.size'), 300); assert.equal(b.run('_selectedIds.has(305)'), false);
  b.run('_recordsShowAll=true;filterRecords()'); b.ctx._onCheckAll({checked:true}); assert.equal(b.run('_selectedIds.size'),305);
  b.run('_recordsShowAll=false;filterRecords()'); assert.equal(b.run('_selectedIds.size'),300);
  b.ctx.batchDelete(); assert.deepEqual(plain(b.run('state.records')).map(r=>r.id), [301,302,303,304,305]);
  b.run('state='+JSON.stringify({records,nextId:306})); search.value='Synthetic-305'; b.ctx.filterRecords();
  assert.equal((wrap.innerHTML.match(/class="row-check"/g)||[]).length,1); assert.match(wrap.innerHTML,/Synthetic-305/);
});

test('import plan preserves source values and reports the actual worksheet row for invalid dates', () => {
  const b=browser();
  b.run(`_importHeaderRowIdx=2;_importMappedFields={date:'date',supplier:'supplier',product:'productNo',po:'orderNo',type:'type',qty:'qty'};
    _importParsedRows=[{date:'',supplier:'',product:'skip'}, {date:'not-a-date',supplier:'Synthetic',product:'P-001',po:'PO-01',type:'',qty:12}];
    Object.defineProperty(_importParsedRows[1],'__sourceRow',{value:8});`);
  const plan=plain(b.ctx._buildImportPlan('append')); assert.equal(plan.records.length,1);
  assert.equal(plan.records[0].date,''); assert.equal(plan.records[0].productNo,'P-001'); assert.equal(plan.records[0].orderNo,'PO-01');
  assert.equal(plan.records[0].type,'来料'); assert.equal(plan.records[0].qty,12);
  assert.ok(plan.warningTexts.some(w=>w.includes('第 8 行「not-a-date」')));
});

async function recoveryDraft({ initial = [], local = initial, server = initial, replacement = false, quota = false } = {}) {
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({ ok: false, status: 500 }) : undefined });
  b.setBootstrap({ ...bootstrap(), records: initial, nextId: 501 }); b.ctx.__QC_BOOTSTRAP();
  b.store.set(prefix + 'records', JSON.stringify({ records: local, nextId: 502 }));
  b.ctx.__QC_FORCE_REPLACE = replacement; if (quota) failDraftStorage(b);
  await b.ctx.__QC_SYNC_NOW();
  const key = prefix + 'pending_records_qc-admin', original = b.store.get(key);
  b.setBootstrap({ ...bootstrap(), records: server, nextId: 501 }); b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  return { b, key, original };
}
const versioned = (id, productNo, updatedAt = '2026-11-03T01:00:00Z') => ({ id, productNo, updatedAt });

for (const kind of ['deleted', 'updated', 'timezone-format', 'collision']) test('draft recovery blocks remote ' + kind + ' without replay or resurrection', async () => {
  const initial = kind === 'collision' ? [] : [versioned(1, 'original')];
  const local = kind === 'collision' ? [versioned(501, 'local-new')] : [versioned(1, 'local-edit', '2026-11-03T03:00:00Z')];
  const server = kind === 'deleted' ? [] : kind === 'collision' ? [versioned(501, 'server-new')] :
    [versioned(1, 'server-latest', kind === 'timezone-format' ? '2026-11-03T09:00:00+08:00' : '2026-11-03T02:00:00Z')];
  const { b, key, original } = await recoveryDraft({ initial, local, server });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, true);
  assert.deepEqual(plain(b.run('state.records')), server);
  assert.equal(b.store.get(key), original);
  const backups = [...b.store].filter(([key]) => key.includes('_conflict_'));
  assert.equal(backups.length, 1); assert.equal(backups[0][1], original);
  const before = b.calls.length; assert.equal(await b.ctx.__QC_SYNC_NOW(), false); assert.equal(b.calls.length, before);
  for (const action of ['createRecord','editRecord','deleteRecord','batchDelete','reviewRecord','importData']) assert.equal(b.ctx.can(action), false);
  const banner = [...b.elements.values()].find(el => el.id === 'qcSyncNotice');
  assert.deepEqual(banner.children.slice(-2).map(el => el.textContent), ['下载草稿 Excel','放弃待恢复草稿']);
  assert.equal(b.ctx.__QC_DOWNLOAD_BLOCKED_DRAFT(), true);
  assert.equal([...b.elements.values()].find(el => el.download).clicked, true);
});

test('provable local edits and new rows recover alongside unrelated fresh server additions', async () => {
  const initial = [versioned(1, 'original')], local = [versioned(1, 'edited', '2026-11-03T02:00:00Z'), versioned(501, 'new')];
  const { b } = await recoveryDraft({ initial, local, server: [...initial, versioned(42, 'other-actor')] });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.deepEqual(plain(b.run('state.records')).map(r => [r.id,r.productNo]), [[1,'edited'],[42,'other-actor'],[501,'new']]);
  assert.equal(b.calls.filter(c => c.method === 'POST').length, 1);
});

test('recovery preserves unrelated remote updates and deletions while retrying only a local edit', async () => {
  const initial = [versioned(1, 'original'), versioned(2, 'other-original'), versioned(3, 'remote-deleted')];
  const local = [{ ...initial[0], productNo: 'local-edit', updatedAt: '2026-11-03T03:00:00Z' }, ...initial.slice(1)];
  const server = [initial[0], versioned(2, 'remote-update', '2026-11-03T04:00:00Z')];
  const { b, key, original } = await recoveryDraft({ initial, local, server });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.equal(b.store.get(key), original);
  assert.deepEqual(plain(b.run('state.records')).map(row => [row.id, row.productNo]), [[1, 'local-edit'], [2, 'remote-update']]);
  await b.ctx.__QC_SYNC_NOW();
  const request = b.calls.filter(call => call.method === 'POST').at(-1).parsed;
  assert.deepEqual(request.records, [local[0]]);
  assert.deepEqual(request.baseVersions, { 1: initial[0].updatedAt });
  assert.deepEqual(request.newIds, []);
});

test('an edit already saved before its response was lost recovers as a confirmed empty retry', async () => {
  const initial = [versioned(1, 'original')];
  const local = [versioned(1, 'saved-edit', '2026-11-03T03:00:00Z')];
  const { b, key } = await recoveryDraft({ initial, local, server: local });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.deepEqual(plain(b.run('state.records')), local);
  // The failed test transport keeps the draft until a successful explicit retry.
  await b.ctx.__QC_SYNC_NOW();
  assert.deepEqual(b.calls.filter(call => call.method === 'POST').at(-1).parsed.records, []);
  assert.equal(b.store.has(key), true);
});

test('an identical created record with server defaults is recognized after a lost response', async () => {
  const local = [versioned(501, 'new')];
  const saved = { ...local[0], status: 'pending', reviewBy: '', reviewAt: '', rejectBy: '', rejectAt: '', rejectReason: '', qty: null, defects: [], measurements: [] };
  const { b } = await recoveryDraft({ local, server: [saved] });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.deepEqual(plain(b.run('state.records')), [saved]);
});

for (const response of [
  { ok: true, status: 200, json: undefined },
  { ok: true, status: 200, json: async () => ({ ok: true, skippedStale: 1 }) },
  { ok: true, status: 200, json: async () => ({ ok: true, confirmedRecords: [], confirmedDeletedIds: [] }) },
]) test('an HTTP success without complete record confirmation retains the pending draft', async () => {
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve(response) : undefined });
  setPendingRecord(b);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), false);
  assert.equal(b.store.has(prefix + 'pending_records_qc-admin'), true);
  assert.match(b.ctx.__QC_SYNC_NOTICE, /服务器尚未保存/);
  assert.equal(b.ctx.__QC_LAST_SYNC.ok, false);
});

test('confirmed server normalization updates unchanged local data and subsequent retries send no old rows', async () => {
  let count = 0;
  const saved = { ...pendingRecord, status: 'pending', reviewBy: '', reviewAt: '' };
  const b = browser({ handler: url => {
    if (url.includes('/api/records') && count++ === 0) return Promise.resolve({
      ok: true, status: 200, json: async () => ({ ok: true, confirmedRecords: [saved], confirmedDeletedIds: [] }),
    });
  } });
  setPendingRecord(b); b.ctx.initData();
  assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.deepEqual(plain(b.run('state.records')), [saved]);
  assert.deepEqual(JSON.parse(b.store.get(prefix + 'records')).records, [saved]);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.deepEqual(b.calls.filter(call => call.method === 'POST').at(-1).parsed.records, []);
});

test('an account change while confirmation JSON is pending cannot acknowledge the old draft', async () => {
  let finish;
  const b = browser({ handler: url => url.includes('/api/records') ? Promise.resolve({
    ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; }),
  }) : undefined });
  setPendingRecord(b);
  const pending = b.ctx.__QC_SYNC_NOW(); await tick();
  const key = prefix + 'pending_records_qc-admin', original = b.store.get(key);
  b.setBootstrap(bootstrap({ username: 'alice', role: 'viewer', enabled: true })); b.ctx.__QC_BOOTSTRAP();
  finish({ ok: true, confirmedRecords: [pendingRecord], confirmedDeletedIds: [] });
  assert.equal(await pending, false);
  assert.equal(b.store.get(key), original);
  assert.equal(b.ctx.getCurrentUser().username, 'alice');
});

test('optional provided legacy draft recovers its changed row alongside unrelated remote changes', {
  skip: !process.env.QC_DRAFT_FILE,
}, async () => {
  const payload = JSON.parse(fs.readFileSync(process.env.QC_DRAFT_FILE, 'utf8').replace(/^\uFEFF/, ''));
  const draft = payload.draftRecovery ? JSON.parse(payload.draftRecovery.originalRaw) : payload;
  const baseline = draft.baseline.versions;
  const dirty = draft.state.records.filter(row => baseline[row.id] !== (row.updatedAt == null ? null : row.updatedAt));
  assert.ok(dirty.length > 0);
  const server = draft.state.records.map(row => ({ ...row, updatedAt: baseline[row.id] }));
  for (const row of server) if (dirty.some(changed => changed.id === row.id)) row.remark = 'synthetic original value';
  const unrelated = server.find(row => !dirty.some(changed => changed.id === row.id));
  unrelated.updatedAt = '2099-01-01T00:00:00Z'; unrelated.remark = 'synthetic unrelated update';
  const key = prefix + 'pending_records_' + encodeURIComponent(draft.owner);
  const b = browser({ authenticated: false, cached: [[key, JSON.stringify(draft)]] });
  b.setBootstrap({ ...bootstrap({ ...admin, username: draft.owner }), records: server, nextId: draft.state.nextId });
  b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.equal(b.run('state.records.length'), server.length);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.deepEqual(b.calls.filter(call => call.method === 'POST').at(-1).parsed.records, dirty);
  assert.equal(b.store.has(key), false);
});

test('replacement recovery never restores a deleted row after the server baseline changed', async () => {
  const { b, key, original } = await recoveryDraft({ initial: [versioned(1,'original')], local: [versioned(1,'stale')], server: [], replacement: 1 });
  assert.deepEqual(plain(b.run('state.records')), []); assert.equal(b.ctx.__QC_FORCE_REPLACE, false);
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, true); assert.equal(b.store.get(key), original);
});

test('volatile recovery compares against the actual new bootstrap, not the old page cache', async () => {
  const { b } = await recoveryDraft({ initial: [versioned(1,'original')], local: [versioned(1,'stale')], server: [], quota: true });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, true); assert.deepEqual(plain(b.run('state.records')), []);
  assert.equal(b.unloadListeners.size, 1); assert.equal(await b.ctx.__QC_SYNC_NOW(), false);
});

test('legacy drafts without a baseline stay intact and require explicit download/discard', () => {
  const key = prefix + 'pending_records_qc-admin';
  const raw = JSON.stringify({ owner:'qc-admin', company, token:'legacy', revision:1, state:{records:[versioned(501,'unknown-old')]}, deletedIds:[] }, null, 2);
  const b = browser({ cached:[[key,raw]] }); b.ctx.initData();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, true); assert.deepEqual(plain(b.run('state.records')), []);
  assert.equal(b.store.get(key), raw);
  b.ctx.confirm = () => false; assert.equal(b.ctx.__QC_DISCARD_BLOCKED_DRAFT(), false); assert.equal(b.store.get(key), raw);
  b.ctx.confirm = () => true; assert.equal(b.ctx.__QC_DISCARD_BLOCKED_DRAFT(), true);
  assert.equal(b.store.has(key), false); assert.equal(b.reloads, 1);
  assert.equal([...b.store].filter(([key]) => key.includes('_conflict_'))[0][1], raw);
  assert.equal(b.calls.some(c => c.method === 'POST'), false);
});

test('conflict discard protects another tab draft and blocked controls disappear for another account', async () => {
  const { b, key } = await recoveryDraft({ initial:[versioned(1,'original')], local:[versioned(1,'local')], server:[] });
  const other = { ...JSON.parse(b.store.get(key)), token:'another-tab' }; b.store.set(key, JSON.stringify(other));
  assert.equal(b.ctx.__QC_DISCARD_BLOCKED_DRAFT(), false); assert.equal(JSON.parse(b.store.get(key)).token, 'another-tab');
  b.setBootstrap(bootstrap({ username:'alice', role:'viewer', enabled:true })); b.ctx.__QC_BOOTSTRAP();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false); assert.equal(b.ctx.__QC_DOWNLOAD_BLOCKED_DRAFT(), false);
  assert.equal(b.store.has(key), true); assert.equal(b.ctx.__QC_DISCARD_BLOCKED_DRAFT(), false);
});

test('company-mismatched drafts never enter the current company record cache', () => {
  const key = prefix + 'pending_records_qc-admin', draft = { owner:'qc-admin',company:'sy-huadeng',state:{records:[versioned(501,'other-company')]} };
  const b = browser({ cached:[[key,JSON.stringify(draft)]] }); b.ctx.initData();
  assert.deepEqual(plain(b.run('state.records')), []); assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.equal(b.store.get(key), JSON.stringify(draft));
});


test('conflict guard prevents local persistence and preserves immutable backups across bootstrap retries', async () => {
  const {b,key,original}=await recoveryDraft({initial:[versioned(1,'original')],local:[versioned(1,'local')],server:[]});
  await b.ctx.__QC_SYNC_NOW(); b.run('state={records:[{id:99}],nextId:100}');
  assert.equal(b.ctx.persist(),false); assert.equal(b.store.get(key),original);
  assert.deepEqual(JSON.parse(b.store.get(prefix+'records')).records,[]);
  const backups=[...b.store].filter(([key])=>key.includes('_conflict_'));
  b.ctx.__QC_BOOTSTRAP(); assert.equal(b.store.get(backups[0][0]),original);
  assert.equal([...b.store].filter(([key])=>key.includes('_conflict_')).length,1);
});

for (const raw of ['{bad-json', JSON.stringify({owner:'qc-admin',company,state:{records:null},token:'invalid-shape'})])
test('unreadable or invalid own draft is preserved and blocks replay: '+raw.slice(0,20),async()=>{
  const key=prefix+'pending_records_qc-admin', b=browser({cached:[[key,raw]]}); b.ctx.initData();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED,true); assert.equal(b.store.get(key),raw);
  assert.deepEqual(plain(b.run('state.records')),[]); assert.equal(await b.ctx.__QC_SYNC_NOW(),false);
  assert.equal(b.store.get(key),raw);
});


test('a random draft below the numeric high-water mark stays protected while explicit tombstone retry is rejected',async()=>{
  let failStatus=500;
  const b=browser({handler:url=>url.includes('/api/records')?Promise.resolve({ok:false,status:failStatus}):undefined});
  b.store.set(prefix+'records',JSON.stringify({records:[versioned(41,'local-random-new')],nextId:502}));
  await b.ctx.__QC_SYNC_NOW();const key=prefix+'pending_records_qc-admin',original=b.store.get(key);
  b.setBootstrap({...bootstrap(),records:[],nextId:9000000000000});b.ctx.__QC_BOOTSTRAP();b.ctx.initData();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED,false);assert.equal(b.run('state.records[0].id'),41);
  assert.equal(b.store.get(key),original);assert.equal(b.calls.filter(c=>c.method==='POST').length,1);
  failStatus=409;assert.equal(await b.ctx.__QC_SYNC_NOW(),false);
  const last=b.calls.filter(c=>c.method==='POST').at(-1);assert.deepEqual(last.parsed.newIds,[41]);
  assert.equal(JSON.parse(b.store.get(key)).state.records[0].productNo,'local-random-new');
  assert.equal(b.ctx.__QC_FORCE_REPLACE,false);assert.equal(b.ctx.__QC_LAST_SYNC.status,409);
});


test('successful new-row acknowledgement advances only the exact sent baseline before later edits',async()=>{
  let finish,postCount=0;
  const b=browser({handler:url=>url.includes('/api/records')?++postCount===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:false,status:500}):undefined});
  const old=versioned(41,'first-new','2026-11-05T01:00:00Z');
  b.store.set(prefix+'records',JSON.stringify({records:[old],nextId:9000000000000}));
  const first=b.ctx.__QC_SYNC_NOW();await tick();
  const local=[{...old,productNo:'later-edit',updatedAt:'2026-11-05T02:00:00Z'},versioned(42,'second-new','2026-11-05T02:00:00Z')];
  b.store.set(prefix+'records',JSON.stringify({records:local,nextId:9000000000000}));const second=b.ctx.__QC_SYNC_NOW();
  finish({ok:true,status:200});await first;await second;
  const posts=b.calls.filter(c=>c.method==='POST');assert.deepEqual(posts[0].parsed.newIds,[41]);assert.deepEqual(posts[1].parsed.newIds,[42]);
  const draft=JSON.parse(b.store.get(prefix+'pending_records_qc-admin'));
  assert.equal(draft.baseline.versions['41'],old.updatedAt);assert.equal('42'in draft.baseline.versions,false);
  assert.deepEqual(draft.state.records,local);
});

test('a failed new-row request never advances the original baseline or loses creation intent',async()=>{
  const b=browser({handler:url=>url.includes('/api/records')?Promise.resolve({ok:false,status:500}):undefined});
  b.store.set(prefix+'records',JSON.stringify({records:[versioned(41,'first-new')],nextId:502}));
  assert.equal(await b.ctx.__QC_SYNC_NOW(),false);assert.equal(await b.ctx.__QC_SYNC_NOW(),false);
  const posts=b.calls.filter(c=>c.method==='POST');assert.deepEqual(posts.map(p=>p.parsed.newIds),[[41],[41]]);
  const draft=JSON.parse(b.store.get(prefix+'pending_records_qc-admin'));
  assert.equal('41'in draft.baseline.versions,false);assert.equal(draft.state.records[0].productNo,'first-new');
});

test('a low unused random draft restores alongside another creator without automatic replay',async()=>{
  const initial=[versioned(9000000000000,'existing')],local=[...initial,versioned(41,'low-random-new')];
  const {b,key,original}=await recoveryDraft({initial,local,server:[...initial,versioned(9000000000001,'other-creator')]});
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED,false);assert.equal(b.store.get(key),original);
  assert.deepEqual(plain(b.run('state.records')).map(r=>r.id),[9000000000000,9000000000001,41]);
  assert.equal(b.calls.filter(c=>c.method==='POST').length,1);
});

test('normal HTML selects all matching modern creation-intent and OCR scripts without changing their load order',()=>{
  const html=source('index.html');const scripts=[...html.matchAll(/<script src="(qc-backend|app|ai-ocr)\.js\?v=([^"]+)"/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(scripts,[['qc-backend','20261111-excel-draft'],['app','20261111-excel-server-ocr'],['ai-ocr','20261111-server-ocr-timeout']]);
});

test('a newer volatile draft retains confirmed server defaults after its next write fails', async () => {
  let finishFirstRequest;
  let requestCount = 0;
  const saved = { ...pendingRecord, status: 'pending', reviewBy: '', reviewAt: '',
    rejectBy: '', rejectAt: '', rejectReason: '' };
  const extra = { ...pendingRecord, id: 502, productNo: 'second-quota-new' };
  const b = browser({ handler: url => {
    if (!url.includes('/api/records')) return;
    requestCount++;
    if (requestCount === 1) return new Promise(resolve => { finishFirstRequest = resolve; });
    return Promise.resolve({ ok: false, status: 500 });
  } });
  setPendingRecord(b);
  failDraftStorage(b);
  const first = b.ctx.__QC_SYNC_NOW();
  await tick();
  setPendingRecord(b, [pendingRecord, extra]);
  const second = b.ctx.__QC_SYNC_NOW();
  finishFirstRequest({ ok: true, status: 200,
    json: async () => ({ ok: true, confirmedRecords: [saved], confirmedDeletedIds: [] }) });
  assert.equal(await first, true);
  assert.equal(await second, false);
  b.setBootstrap({ ...bootstrap(), records: [saved], nextId: 503 });
  b.ctx.__QC_BOOTSTRAP();
  b.ctx.initData();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.deepEqual(plain(b.run('state.records')), [saved, extra]);
  assert.equal(b.unloadListeners.size, 1);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), false);
  const retry = b.calls.filter(call => call.method === 'POST').at(-1).parsed;
  assert.deepEqual(retry.records, [extra]);
  assert.deepEqual(retry.newIds, [extra.id]);
});

for (const status of ['approved', 'rejected']) test('reopened lost ' + status + ' response keeps the review pending until explicit canonical API confirmation', async () => {
  const initial = [{ ...versioned(1, 'review-fixture'), status: 'pending', reviewBy: '', reviewAt: '', rejectBy: '', rejectAt: '', rejectReason: '' }];
  const actorField = status === 'approved' ? 'reviewBy' : 'rejectBy', timeField = status === 'approved' ? 'reviewAt' : 'rejectAt';
  const local = { ...initial[0], status, updatedAt: '2026-11-03T03:00:00Z', [actorField]: admin.name,
    [timeField]: '2026-11-03T02:59:59.999Z', rejectReason: status === 'rejected' ? 'Synthetic reason' : '' };
  const saved = { ...local, [timeField]: '2026-11-03T03:00:01Z' };
  let confirm = false;
  const b = browser({ handler: url => url.includes('/api/records') ? confirm
    ? { ok: true, status: 200, json: async () => ({ ok: true, confirmedRecords: [saved], confirmedDeletedIds: [] }) }
    : { ok: false, status: 500 } : undefined });
  b.setBootstrap({ ...bootstrap(), records: initial }); b.ctx.__QC_BOOTSTRAP();
  b.store.set(prefix + 'records', JSON.stringify({ records: [local], nextId: 501 }));
  await b.ctx.__QC_SYNC_NOW();
  const key = prefix + 'pending_records_qc-admin', raw = b.store.get(key);
  b.setBootstrap({ ...bootstrap(), records: [saved] }); b.ctx.__QC_BOOTSTRAP(); b.ctx.initData();
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, false);
  assert.equal(b.store.get(key), raw); assert.deepEqual(plain(b.run('state.records')), [local]);
  assert.equal(await b.ctx.__QC_SYNC_NOW(), false);
  assert.equal(b.store.has(key), true);
  const submitted = b.calls.filter(call => call.method === 'POST').at(-1).parsed;
  assert.deepEqual(submitted.records, [local]); assert.deepEqual(submitted.baseVersions, { 1: saved.updatedAt });
  confirm = true; assert.equal(await b.ctx.__QC_SYNC_NOW(), true);
  assert.deepEqual(plain(b.run('state.records')), [saved]); assert.equal(b.store.has(key), false);
});

for (const kind of ['actor', 'business', 'version', 'other-audit', 'reason', 'invalid-time']) test('review normalization cannot recover a draft with changed ' + kind, async () => {
  const initial = [{ ...versioned(1, 'review-fixture'), status: 'pending', reviewBy: '', reviewAt: '', rejectBy: '', rejectAt: '', rejectReason: '' }];
  const local = { ...initial[0], status: 'approved', updatedAt: '2026-11-03T03:00:00Z', reviewBy: admin.name, reviewAt: '2026-11-03T02:59:59.999Z' };
  const extra = { actor: { reviewBy: 'other-user' }, business: { productNo: 'different' }, version: { updatedAt: '2026-11-03T04:00:00Z' },
    'other-audit': { rejectBy: 'different' }, reason: { rejectReason: 'different' }, 'invalid-time': { reviewAt: 'invalid' } }[kind];
  const saved = { ...local, reviewAt: '2026-11-03T03:00:01Z', ...extra };
  const { b, key, original } = await recoveryDraft({ initial, local: [local], server: [saved] });
  assert.equal(b.ctx.__QC_DRAFT_RECOVERY_BLOCKED, true); assert.equal(b.store.get(key), original);
  assert.deepEqual(plain(b.run('state.records')), [saved]);
});
