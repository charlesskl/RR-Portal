'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const Auth = require('./auth');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const { SCHEMA_SQL } = vm.runInNewContext(source.slice(source.indexOf('const RECORD_COLS'), source.indexOf('const toNum')) + ';({SCHEMA_SQL})');
const companies = ['dg-xingxin', 'dg-huadeng-a', 'dg-huadeng-b', 'dg-huajia', 'hy-huakang-a', 'hy-huakang-b',
  'hy-huakang-c', 'hy-huakang-d', 'hy-huadeng', 'hy-huaxing', 'sy-huadeng', 'sy-xingxin', 'xs-huadeng'];
const A = companies[0], B = companies[4], password = 'fixture-password-2026';
const integrationToken = Buffer.alloc(32, 7).toString('base64url');
const tables = ['users', 'records', 'record_tombstones', 'partners', 'defect_library'];
const allZero = Object.fromEntries(Auth.MENUS.map(menu => [menu, { v: 0, e: 0, a: 0, m: 0 }]));
let directory, dataPath, child, base, marker;

function database(company = A) { return new DatabaseSync(path.join(dataPath, company, 'qc.db')); }
function sql(company, callback) {
  const db = database(company);
  try { return callback(db); } finally { db.close(); }
}
function seed(company) {
  const db = database(company);
  try {
    db.exec(SCHEMA_SQL);
    for (const col of ['name', 'dept', 'perms']) {
      if (!db.prepare('PRAGMA table_info(users)').all().some(row => row.name === col)) db.exec('ALTER TABLE users ADD COLUMN ' + col + ' TEXT');
    }
    db.exec('BEGIN');
    for (const table of tables) db.exec('DELETE FROM ' + table);
    const insert = db.prepare('INSERT INTO users(username,password,role,enabled,name,perms) VALUES(?,?,?,?,?,?)');
    for (const [username, role, enabled, perms] of [
      ['jc', 'admin', 1, null], ['viewer', 'viewer', 1, null], ['manager', 'manager', 1, null],
      ['disabled', 'admin', 0, null], ['restricted', 'manager', 1, allZero],
      ['stringzero', 'viewer', 1, { records: { e: '0' } }],
    ]) insert.run(username, Auth.legacyHash(password), role, enabled, username + ' display', perms && JSON.stringify(perms));
    const record = db.prepare('INSERT INTO records(id,date,supplier,productNo,status,updatedAt,defects,measurements,reviewBy,reviewAt,rejectReason,rejectBy,rejectAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const [id, status] of [[1, 'approved'], [2, 'pending'], [3, 'rejected']]) {
      record.run(id, '2026-01-01', company + ' supplier', 'P' + id, status, '2026-01-01T00:00:00.000Z', '[]', '[]', '', '', status === 'rejected' ? 'fixture rejection' : '', '', '');
    }
    db.prepare('INSERT INTO defect_library(name,category,enabled,keywords) VALUES(?,?,1,?)').run('Scratch', 'appearance', '[]');
    db.prepare('INSERT INTO partners(name,type) VALUES(?,?)').run(company + ' supplier', 'supplier');
    db.exec('COMMIT');
  } finally { db.close(); }
}
function snapshot() {
  return JSON.stringify(companies.map(company => sql(company, db => Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])))));
}
function noSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!/^(password|newPassword|salt|hash)$/i.test(key), 'credential field must never be returned: ' + key);
    noSecrets(item);
  }
  assert.ok(!JSON.stringify(value).includes('scrypt$'));
  assert.ok(!JSON.stringify(value).includes(Auth.legacyHash(password)));
}
async function request(route, { method = 'GET', body, session, company = A, headers = {} } = {}) {
  const opts = { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(session ? { cookie: session.cookie, ...(!['GET', 'HEAD'].includes(method) ? { 'x-qc-csrf': session.csrf } : {}) } : {}), ...headers } };
  if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(base + route + (route.includes('?') ? '&' : '?') + 'company=' + encodeURIComponent(company), opts);
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  return { response, status: response.status, text, json };
}
async function login(username = 'jc', company = A) {
  const r = await request('/api/login', { method: 'POST', company, body: { username, password } });
  assert.equal(r.status, 200, r.text); noSecrets(r.json);
  const setCookie = r.response.headers.get('set-cookie');
  assert.match(setCookie, /; HttpOnly; SameSite=Strict; Path=\/; Max-Age=/);
  const cookie = setCookie.split(';')[0]; assert.match(cookie, /=([a-f0-9]{64})$/);
  assert.match(r.json.csrfToken, /^[a-f0-9]{64}$/);
  return { cookie, csrf: r.json.csrfToken, user: r.json.user };
}
function changed(id, extra = {}) {
  const row = sql(A, db => db.prepare('SELECT * FROM records WHERE id=?').get(id));
  return { ...row, defects: JSON.parse(row.defects || '[]'), measurements: JSON.parse(row.measurements || '[]'),
    updatedAt: '2026-10-21T12:00:00.000Z', ...extra };
}
const fresh = (id = 100, extra = {}) => ({ id, productNo: 'new-' + id, updatedAt: '2026-10-21T12:00:00.000Z', ...extra });

test.before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qms-api-auth-'));
  dataPath = path.join(directory, 'data'); marker = path.join(directory, 'unexpected-model-call');
  const serverDir = path.join(directory, 'server'); fs.mkdirSync(serverDir);
  for (const filename of ['server.js', 'auth.js']) fs.copyFileSync(path.join(__dirname, filename), path.join(serverDir, filename));
  fs.writeFileSync(path.join(serverDir, 'seed.json'), JSON.stringify({ records: [], defectLib: [], users: [{ username: 'jc', password: Auth.legacyHash(password) }] }));
  fs.writeFileSync(path.join(serverDir, 'ai-config.json'), JSON.stringify({ enabled: false, apiKey: '', baseURL: 'http://127.0.0.1:1/disabled-test-only' }));
  fs.writeFileSync(path.join(directory, 'model-guard.cjs'), "global.fetch = async () => { require('node:fs').appendFileSync(process.env.MODEL_CALL_MARKER, 'called'); throw new Error('Unexpected model call in auth regression'); };\n");
  for (const company of companies) { fs.mkdirSync(path.join(dataPath, company), { recursive: true }); seed(company); }
  child = spawn(process.execPath, ['--require', path.join(directory, 'model-guard.cjs'), path.join(serverDir, 'server.js')], {
    env: { ...process.env, PORT: '0', DATA_PATH: dataPath, QC_INSPECTIONS_READ_TOKEN: integrationToken,
      DASHSCOPE_API_KEY: '', QC_BAILIAN_API_KEY: '', SSO_SECRET: 'public-browser-vite-test-key', MODEL_CALL_MARKER: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Synthetic QMS server failed startup: ' + output)), 10000);
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/localhost:(\d+)\/index.html/);
      if (match && Number(match[1]) > 0) { base = 'http://127.0.0.1:' + match[1]; clearTimeout(timeout); resolve(); }
    });
    child.stderr.on('data', data => { output += data; });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Synthetic QMS server exited: ' + code + ' ' + output)); });
  });
  assert.equal((await request('/api/health')).status, 200);
});
test.after(async () => {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
test.beforeEach(() => { seed(A); seed(B); });

test('every protected GET, HEAD and POST rejects anonymous callers without DB or model effects', async () => {
  const before = snapshot(), files = fs.readdirSync(dataPath).sort();
  for (const route of ['/api/bootstrap', '/api/session', '/api/export/records.csv', '/api/export/factory-excel.xls', '/api/ai/status', '/api/integration/inspections']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await request(route, { method })).status, 401, method + ' ' + route);
  }
  for (const route of ['/api/records', '/api/records/delete', '/api/records/replace', '/api/users', '/api/partners', '/api/defects', '/api/ai/reload', '/api/ai/ocr-extract', '/api/logout']) {
    assert.equal((await request(route, { method: 'POST', body: { records: [], users: [], ids: [1], image: 'data:image/png;base64,AA==' } })).status, 401, route);
  }
  assert.equal(snapshot(), before); assert.deepEqual(fs.readdirSync(dataPath).sort(), files); assert.equal(fs.existsSync(marker), false);
});

test('login, bootstrap and session disclose no password; valid cookies are server issued and scoped', async () => {
  const wrong = await request('/api/login', { method: 'POST', body: { username: 'viewer', password: 'wrong-password' } });
  assert.equal(wrong.status, 401); assert.equal(wrong.response.headers.get('set-cookie'), null);
  assert.equal((await request('/api/login', { method: 'POST', body: { username: 'disabled', password } })).status, 401);
  const session = await login('viewer');
  for (const route of ['/api/bootstrap', '/api/session']) {
    const r = await request(route, { session }); assert.equal(r.status, 200); noSecrets(r.json);
    assert.deepEqual(r.json.companies, [A]); assert.equal(r.json.user.role, 'viewer');
    assert.equal(r.response.headers.get('cache-control'), 'no-store');
  }
  assert.match(sql(A, db => db.prepare("SELECT password FROM users WHERE username='viewer'").get().password), /^scrypt\$/);
});

test('viewer creates pending records, including missing status, alongside unchanged approved rows', async () => {
  const session = await login('viewer');
  const r = await request('/api/records', { method: 'POST', session, body: { records: [changed(1, { updatedAt: '2026-01-01T00:00:00Z' }), fresh(100), fresh(101, { status: 'pending' })] } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(sql(A, db => db.prepare('SELECT status FROM records WHERE id>=100 ORDER BY id').all()).map(r => r.status), ['pending', 'pending']);
  assert.equal(sql(A, db => db.prepare('SELECT status FROM records WHERE id=1').get().status), 'approved');
});

test('viewer cannot edit, review, forge audit fields, delete, replace, manage users or reload AI', async () => {
  const session = await login('viewer');
  const cases = [
    ['/api/records', { records: [changed(2, { productNo: 'forbidden' })] }],
    ['/api/records', { records: [changed(2, { status: 'approved', reviewBy: 'forged' })] }],
    ['/api/records', { records: [fresh(100, { status: 'approved' })] }],
    ['/api/records', { records: [fresh(100, { reviewBy: 'forged' })] }],
    ['/api/records', { records: [], deletedIds: [2] }], ['/api/records/delete', { ids: [2] }],
    ['/api/records/replace', { records: [] }], ['/api/users', { users: [] }], ['/api/partners', { partners: [] }],
    ['/api/defects', { defectLib: [] }], ['/api/ai/reload', {}],
  ];
  const before = snapshot();
  for (const [route, body] of cases) assert.equal((await request(route, { method: 'POST', session, body })).status, 403, route + ' ' + JSON.stringify(body));
  assert.equal(snapshot(), before); assert.equal(fs.existsSync(marker), false);
});

test('a mixed allowed-create and forbidden-edit batch is atomic', async () => {
  const session = await login('viewer'), before = snapshot();
  const r = await request('/api/records', { method: 'POST', session, body: { records: [fresh(100), changed(2, { productNo: 'forbidden' })] } });
  assert.equal(r.status, 403); assert.equal(snapshot(), before);
});

test('manager edits, reviews with server attribution, resubmits, maintains lists and imports', async () => {
  const session = await login('manager');
  assert.equal((await request('/api/records', { method: 'POST', session, body: { records: [changed(2, { productNo: 'edited' })] } })).status, 200);
  assert.equal((await request('/api/records', { method: 'POST', session, body: { records: [changed(2, { status: 'approved', reviewBy: 'forged', reviewAt: '1900-01-01', updatedAt: '2026-10-21T12:00:01Z' })] } })).status, 200);
  const reviewed = sql(A, db => db.prepare('SELECT * FROM records WHERE id=2').get());
  assert.equal(reviewed.reviewBy, 'manager display'); assert.notEqual(reviewed.reviewAt, '1900-01-01');
  assert.equal((await request('/api/records', { method: 'POST', session, body: { records: [changed(3, { productNo: 'resubmitted', status: 'pending', rejectReason: '', rejectBy: '', rejectAt: '' })] } })).status, 200);
  assert.equal((await request('/api/partners', { method: 'POST', session, body: { partners: [{ name: 'Managed supplier', type: 'supplier' }] } })).status, 200);
  const defects = (await request('/api/bootstrap', { session })).json.defectLib;
  assert.equal((await request('/api/defects', { method: 'POST', session, body: { defectLib: [...defects, { name: 'Dent', category: 'appearance', enabled: true }] } })).status, 200);
  assert.equal((await request('/api/records/replace', { method: 'POST', session, body: { records: [fresh(200, { status: 'approved' })] } })).status, 200);
  assert.deepEqual(sql(A, db => db.prepare('SELECT id FROM records').all()).map(r => r.id), [200]);
});

test('manager cannot delete records or existing defects, manage users, or reload AI', async () => {
  const session = await login('manager'), before = snapshot();
  for (const [route, body] of [['/api/records/delete', { ids: [2] }], ['/api/records', { records: [], deletedIds: [2] }], ['/api/defects', { defectLib: [] }], ['/api/users', { users: [] }], ['/api/ai/reload', {}]]) {
    assert.equal((await request(route, { method: 'POST', session, body })).status, 403, route);
  }
  assert.equal(snapshot(), before);
});

test('authorized OCR reaches disabled-AI validation without any model request', async () => {
  const viewer = await login('viewer');
  const status = await request('/api/ai/status', { session: viewer });
  assert.equal(status.status, 200); assert.equal(status.json.ready, false); noSecrets(status.json);
  const r = await request('/api/ai/ocr-extract', { method: 'POST', session: viewer, body: { image: 'data:image/png;base64,AA==' } });
  assert.equal(r.status, 503); assert.equal(r.json.code, 'NO_AI');
  const admin = await login();
  assert.equal((await request('/api/ai/reload', { method: 'POST', session: admin, body: {} })).status, 200);
  assert.equal(fs.existsSync(marker), false);
});

test('custom zero and string-zero bits deny capabilities and privileged bootstrap fields', async () => {
  sql(A, db => db.prepare('INSERT INTO users(username,password,role,enabled) VALUES(?,?,?,1)').run('unknown', Auth.legacyHash(password), 'invented-role'));
  for (const username of ['restricted', 'stringzero', 'unknown']) {
    const session = await login(username);
    for (const route of ['/api/records', '/api/ai/ocr-extract']) {
      assert.equal((await request(route, { method: 'POST', session, body: { records: [fresh()], image: 'data:image/png;base64,AA==' } })).status, 403, username + route);
    }
    const bootstrap = await request('/api/bootstrap', { session }); noSecrets(bootstrap.json);
    if (username !== 'stringzero') { assert.deepEqual(bootstrap.json.records, []); assert.deepEqual(bootstrap.json.partners, []); assert.equal(bootstrap.json.users.length, 1); }
  }
  assert.equal(fs.existsSync(marker), false);
});

test('company cookie copying, spoofed roles, bearer payloads and cache fields confer no authority', async () => {
  const session = await login('viewer');
  assert.equal((await request('/api/bootstrap', { session, company: B, headers: { 'x-user-role': 'admin', 'x-company': B } })).status, 401);
  const renamed = { ...session, cookie: session.cookie.replace('dg_xingxin', 'hy_huakang_a') };
  assert.equal((await request('/api/bootstrap', { session: renamed, company: B })).status, 401);
  assert.equal((await request('/api/bootstrap', { headers: { authorization: 'Bearer ' + Buffer.from(JSON.stringify({ username: 'jc', role: 'admin' })).toString('base64url'), 'x-qc-user': 'jc' } })).status, 401);
  assert.equal((await request('/api/records/delete', { session, method: 'POST', body: { ids: [2], user: { role: 'admin' }, session: { role: 'admin' }, perms: { records: { m: 1 } } }, headers: { 'x-role': 'admin' } })).status, 403);
  assert.equal((await request('/api/bootstrap', { session, company: 'dongguan' })).status, 200);
});

test('JSON, same-origin and CSRF requirements reject writes before effects', async () => {
  const session = await login('viewer'), before = snapshot(), body = { records: [fresh()] };
  for (const [headers, expected] of [[{ 'x-qc-csrf': '' }, 403], [{ 'x-qc-csrf': 'forged' }, 403], [{ origin: 'https://foreign.invalid' }, 403], [{ origin: 'null' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415]]) {
    assert.equal((await request('/api/records', { session, method: 'POST', body, headers })).status, expected);
  }
  assert.equal((await request('/api/records', { session, method: 'POST', body: '{' })).status, 400);
  assert.equal(snapshot(), before);
  assert.equal((await request('/api/records', { session, method: 'POST', body, headers: { origin: base } })).status, 200);
});

test('safe user updates retain omitted passwords; new passwords use scrypt and never round-trip', async () => {
  const session = await login(), users = (await request('/api/bootstrap', { session })).json.users;
  const old = sql(A, db => db.prepare("SELECT password FROM users WHERE username='viewer'").get().password);
  users.find(u => u.username === 'viewer').name = 'Renamed';
  assert.equal((await request('/api/users', { session, method: 'POST', body: { users } })).status, 200);
  assert.equal(sql(A, db => db.prepare("SELECT password FROM users WHERE username='viewer'").get().password), old);
  users.push({ username: 'created', role: 'viewer', enabled: true, newPassword: 'new-fixture-password' });
  const saved = await request('/api/users', { session, method: 'POST', body: { users } }); assert.equal(saved.status, 200); noSecrets(saved.json);
  const stored = sql(A, db => db.prepare("SELECT password FROM users WHERE username='created'").get().password);
  assert.match(stored, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/); assert.equal(Auth.checkPassword('new-fixture-password', stored), true);
  const authenticated = await request('/api/login', { method: 'POST', body: { username: 'created', password: 'new-fixture-password' } }); assert.equal(authenticated.status, 200); noSecrets(authenticated.json);
  for (const route of ['/api/bootstrap', '/api/session']) noSecrets((await request(route, { session })).json);
});

test('user validation is atomic and rejects credential injection, invalid bits and loss of superadmin', async () => {
  const session = await login(), users = (await request('/api/bootstrap', { session })).json.users, before = snapshot();
  const cases = [users.map(u => ({ ...u, ...(u.username === 'viewer' ? { password: '1' } : {}) })), users.map(u => ({ ...u, ...(u.username === 'viewer' ? { perms: { records: { e: '0' } } } : {}) })), users.filter(u => u.username !== 'jc'), users.map(u => ({ ...u, ...(u.username === 'jc' ? { enabled: false } : {}) }))];
  for (const input of cases) assert.equal((await request('/api/users', { session, method: 'POST', body: { users: input } })).status, 400);
  assert.equal(snapshot(), before);
});

test('short legacy passwords transparently upgrade but new administrator resets require six characters', async () => {
  sql(A, db => db.prepare('INSERT INTO users(username,password,role,enabled) VALUES(?,?,?,1)').run('short-legacy', Auth.legacyHash('x'), 'viewer'));
  const r = await request('/api/login', { method: 'POST', body: { username: 'short-legacy', password: 'x' } });
  assert.equal(r.status, 200); noSecrets(r.json);
  const stored = sql(A, db => db.prepare("SELECT password FROM users WHERE username='short-legacy'").get().password);
  assert.match(stored, /^scrypt\$/); assert.equal(Auth.checkPassword('x', stored), true);
  const session = await login(), users = (await request('/api/bootstrap', { session })).json.users;
  users.find(u => u.username === 'short-legacy').newPassword = 'x';
  const before = snapshot();
  assert.equal((await request('/api/users', { session, method: 'POST', body: { users } })).status, 400);
  assert.equal(snapshot(), before);
});

test('disable, deletion and password reset immediately revoke previously issued sessions', async () => {
  const admin = await login();
  for (const mode of ['disable', 'delete', 'password']) {
    const session = await login('viewer');
    const users = (await request('/api/bootstrap', { session: admin })).json.users;
    const input = mode === 'delete' ? users.filter(u => u.username !== 'viewer') : users.map(u => u.username === 'viewer' ? { ...u, ...(mode === 'disable' ? { enabled: false } : { newPassword: 'reset-fixture-password' }) } : u);
    assert.equal((await request('/api/users', { session: admin, method: 'POST', body: { users: input } })).status, 200);
    assert.equal((await request('/api/session', { session })).status, 401, mode);
    sql(A, db => db.prepare('INSERT OR REPLACE INTO users(username,password,role,enabled,name) VALUES(?,?,?,?,?)').run('viewer', Auth.legacyHash(password), 'viewer', 1, 'viewer display'));
  }
});

test('a disabled then re-enabled account cannot revive an old cookie without logging in', async () => {
  const admin = await login(), viewer = await login('viewer');
  const users = (await request('/api/bootstrap', { session: admin })).json.users;
  const account = users.find(user => user.username === 'viewer');
  account.enabled = false;
  assert.equal((await request('/api/users', { session: admin, method: 'POST', body: { users } })).status, 200);
  // No request with the viewer cookie occurs while disabled. Revocation must
  // happen when the administrator disables the account, not lazily on use.
  account.enabled = true;
  assert.equal((await request('/api/users', { session: admin, method: 'POST', body: { users } })).status, 200);
  assert.equal((await request('/api/session', { session: viewer })).status, 401);
  await login('viewer');
});

test('role and permission reductions affect an existing session without client refresh', async () => {
  const session = await login('manager');
  sql(A, db => db.prepare("UPDATE users SET role='viewer',perms=? WHERE username='manager'").run(JSON.stringify({ records: { e: 0 } })));
  assert.equal((await request('/api/records', { method: 'POST', session, body: { records: [changed(2, { productNo: 'no' })] } })).status, 403);
  assert.equal((await request('/api/records', { method: 'POST', session, body: { records: [fresh()] } })).status, 403);
  assert.equal((await request('/api/session', { session })).json.user.role, 'viewer');
});

test('logout invalidates the server token and expires its HttpOnly cookie', async () => {
  const session = await login('viewer');
  const r = await request('/api/logout', { method: 'POST', session, body: {} }); assert.equal(r.status, 200); assert.match(r.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/session', { session })).status, 401);
});

test('legacy VITE/browser-signed SSO tickets never establish an HTTP session', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  for (const exp of [Date.now() + 60000, 'not-a-number']) {
    const payload = Buffer.from(JSON.stringify({ sub: 'jc', app: 'xingxin-qms', role: 'admin', companies, exp, perms: { users: { m: 1 } } })).toString('base64url');
    const ticket = header + '.' + payload + '.' + crypto.createHmac('sha256', 'public-browser-vite-test-key').update(header + '.' + payload).digest('base64url');
    const r = await request('/api/sso-verify', { method: 'POST', body: { ticket } }); assert.equal(r.status, 401); assert.equal(r.response.headers.get('set-cookie'), null);
  }
  assert.equal((await request('/api/session')).status, 401);
});

test('integration token permits only the fixed read-only inspection projection', async () => {
  const before = snapshot(), headers = { authorization: 'Bearer ' + integrationToken };
  const r = await request('/api/integration/inspections', { headers }); assert.equal(r.status, 200); noSecrets(r.json);
  const fields = ['id', 'date', 'inspDate', 'supplier', 'client', 'productNo', 'productName', 'deliveryNo', 'orderNo', 'type', 'qty', 'sampleQty', 'fail', 'defectRate', 'result', 'defect', 'qc', 'remark'].sort();
  assert.deepEqual(Object.keys(r.json).sort(), ['company', 'records']);
  for (const row of r.json.records) assert.deepEqual(Object.keys(row).sort(), fields);
  assert.equal((await request('/api/integration/inspections', { headers: { authorization: 'Bearer forged' } })).status, 401);
  assert.equal((await request('/api/integration/inspections', { session: await login() })).status, 401);
  const afterLogin = snapshot();
  for (const route of ['/api/bootstrap', '/api/session', '/api/ai/status']) assert.equal((await request(route, { headers })).status, 401);
  for (const method of ['POST', 'HEAD']) assert.equal((await request('/api/integration/inspections', { headers, method, ...(method === 'POST' ? { body: {} } : {}) })).status, 401);
  assert.equal(snapshot(), afterLogin); assert.equal(fs.existsSync(marker), false); assert.notEqual(before, afterLogin); // Only the explicit fixture login changes lastLoginAt/password.
});

test('session expiry uses the injectable clock and does not trust a supplied username', () => {
  let now = 1000; const sessions = Auth.createSessions({ now: () => now, lifetime: 100 });
  const headers = {}, req = { headers: {}, socket: {} }, res = { setHeader: (k, v) => { headers[k] = v; } };
  const user = { username: 'viewer', password: Auth.legacyHash(password), role: 'viewer', enabled: 1 };
  sessions.login(req, res, A, user); req.headers.cookie = headers['Set-Cookie'].split(';')[0];
  now = 1099; assert.equal(sessions.authenticate(req, A, name => name === user.username ? user : null).user, user);
  now = 1100; assert.throws(() => sessions.authenticate(req, A, () => ({ ...user, username: 'jc', role: 'admin' })), error => error.status === 401);
});
