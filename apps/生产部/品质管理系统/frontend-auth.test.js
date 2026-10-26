'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
      setAttribute() {}, focus() {}, appendChild(child) { this.children.push(child); },
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
    elements.set(id, el); return el;
  }
  for (const id of ['loginScreen','appWrapper','loginUsername','loginPassword','loginError','companySelector','userModal','userModalErr',
    'umUsername','umPassword','umPassword2','umRole','umName','umDept']) element(id);
  const button = element('loginButton');
  const ctx = { console: { log() {}, warn() {}, error() {} }, URLSearchParams, URL, Promise,
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
      if (handler) { const result = handler(url, options, calls); if (result !== undefined) return result; }
      const value = url.includes('/api/session') || url.includes('/api/login') ? auth() : url.includes('/api/ai/status') ? { ready: false } : { ok: true };
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
  b.elements.set('reviewTableWrap', { innerHTML: '' });
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
  assert.equal(b.calls.filter(c => c.method === 'POST').at(-1).parsed.records[0].productNo, 'alice-server');
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
