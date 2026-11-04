// Actual loopback HTTP -> Docs middleware -> unchanged core adapter.
// Synthetic core responses and a new temporary document tree only; no live core.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..'), cache = new Map();
function load(name) {
  const filename = path.join(APP, name);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename;
  mod.paths = Module._nodeModulePaths(APP); cache.set(filename, mod);
  const native = mod.require.bind(mod);
  mod.require = name => ['./epms-store', './epms-auth', './docs-trash'].includes(name)
    ? load(name.slice(2) + '.ts') : name === './vite-plugin-xlsx-images'
      ? { preserveImagesOnOverwrite: async () => {} } : native(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
  return mod.exports;
}
const { docsApi } = load('vite-plugin-docs-api.ts');
const { createCoreEpmsAuth } = load('epms-auth.ts');
const JWT = 'SYNTHETIC.PAYLOAD.SIGNATURE';
const BASIC = 'Basic ' + Buffer.from('synthetic-portal:synthetic-only').toString('base64');
const user = { id: 31, username: 'synthetic-engineer', full_name: 'Synthetic engineer', department: '工程部', role: 'user', permissions: ['epms:edit'], is_active: true };
const actor = { id: '31', name: user.full_name, canRead: true, canEdit: true, canReview: false };
function snapshot(root) {
  const values = {};
  function walk(p) {
    for (const name of fs.readdirSync(p).sort()) {
      const file = path.join(p, name), st = fs.lstatSync(file);
      values[path.relative(root, file)] = { mode: st.mode, ino: st.ino, size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs,
        sha256: st.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null };
      if (st.isDirectory()) walk(file);
    }
  }
  walk(root); return values;
}
async function fixture() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-personal-session-'));
  const root = path.join(scratch, 'docs'), project = 'Client/2026/Project', rel = project + '/工程放产资料/plain.txt';
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), 'synthetic document bytes must be retained');
  const state = { meStatus: 200, loginStatus: 200, user: structuredClone(user), calls: [], browserRequests: [] };
  const auth = createCoreEpmsAuth(async (url, init) => {
    assert.ok(['http://core:8000/api/auth/login', 'http://core:8000/api/auth/me'].includes(url));
    assert.equal(init.redirect, 'error');
    state.calls.push({ route: url.endsWith('/login') ? 'login' : 'me' });
    if (url.endsWith('/me')) assert.equal(init.headers.Authorization, 'Bearer ' + JWT);
    const status = url.endsWith('/login') ? state.loginStatus : state.meStatus;
    return new Response(JSON.stringify(url.endsWith('/login') ? { access_token: JWT } : state.user), {
      status, headers: status === 401 ? { 'WWW-Authenticate': 'Bearer realm="synthetic-core"' } : {},
    });
  });
  const previous = process.env.DOCS_ROOT; process.env.DOCS_ROOT = root;
  let plugin;
  try { plugin = docsApi({ coreAuth: auth }); plugin.configResolved({ root: APP }); }
  finally { if (previous === undefined) delete process.env.DOCS_ROOT; else process.env.DOCS_ROOT = previous; }
  let middleware; plugin.configureServer({ middlewares: { use(fn) { middleware = fn; } } });
  const server = http.createServer((req, res) => {
    state.browserRequests.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
    middleware(req, res, () => { res.writeHead(404); res.end('synthetic not found'); });
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { fs.rmSync(scratch, { recursive: true, force: true }); throw error; }
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(route, body, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: BASIC, ...(options.cookie ? { Cookie: 'rr_epms_session=' + JWT } : {}),
        Origin: base, 'X-EPMS-Request': '1', ...options.headers },
      ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
    });
    const raw = Buffer.from(await response.arrayBuffer());
    const isJson = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, body: isJson ? JSON.parse(raw.toString()) : raw, raw, headers: response.headers };
  }
  return { root, rel, project, state, auth, call, close: async () => {
    server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(scratch, { recursive: true, force: true });
  } };
}
function noChallenge(result) { assert.equal(result.headers.get('www-authenticate'), null); }
function authRequired(result) {
  assert.equal(result.status, 403); assert.equal(result.body.code, 'EPMS_AUTH_REQUIRED');
  assert.equal(typeof result.body.error, 'string'); assert.ok(result.body.error.length); noChallenge(result);
}

test('anonymous personal session is 200 null while Basic-bearing document requests keep working', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root);
    for (let round = 0; round < 2; round++) {
      const session = await x.call('/api/epms/session');
      assert.equal(session.status, 200); assert.equal(session.body, null); noChallenge(session);
      assert.equal(session.headers.get('cache-control'), 'no-store');
      const file = await x.call('/api/file?path=' + encodeURIComponent(x.rel));
      assert.equal(file.status, 200); assert.equal(file.raw.toString(), 'synthetic document bytes must be retained'); noChallenge(file);
    }
    assert.equal(x.state.calls.length, 0);
    assert.ok(x.state.browserRequests.every(request => request.authorization === BASIC));
    assert.deepEqual(snapshot(x.root), before);
  } finally { await x.close(); }
});

test('valid personal sessions preserve capabilities and reload department/permissions on each HTTP request', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root);
    const valid = await x.call('/api/epms/session', undefined, { cookie: true });
    assert.equal(valid.status, 200); assert.deepEqual(valid.body, actor); noChallenge(valid);
    x.state.user = { ...user, department: '业务部', role: 'admin', permissions: [] };
    const revoked = await x.call('/api/epms/session', undefined, { cookie: true });
    assert.deepEqual(revoked.body, { ...actor, canEdit: false, canReview: true });
    assert.equal(x.state.calls.length, 2); assert.deepEqual(snapshot(x.root), before);
  } finally { await x.close(); }
});

test('expired or inactive personal credentials become anonymous status without a browser 401', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root);
    for (const status of [401, 403]) {
      x.state.meStatus = status;
      const session = await x.call('/api/epms/session', undefined, { cookie: true });
      assert.equal(session.status, 200); assert.equal(session.body, null); noChallenge(session);
      const file = await x.call('/api/file?path=' + encodeURIComponent(x.rel)); assert.equal(file.status, 200); noChallenge(file);
    }
    assert.deepEqual(snapshot(x.root), before);
  } finally { await x.close(); }
});

test('wrong personal login is typed 403 without a challenge or a new cookie', async () => {
  const x = await fixture(); try {
    x.state.loginStatus = 401; const before = snapshot(x.root);
    const denied = await x.call('/api/epms/login', { username: user.username, password: 'synthetic-wrong' });
    authRequired(denied); assert.equal(denied.body.error, '账号或登录凭据无效');
    assert.equal(denied.headers.get('set-cookie'), null); assert.deepEqual(snapshot(x.root), before);
    // The trusted-core adapter itself retains its original 401 contract.
    await assert.rejects(() => x.auth.login({ method: 'POST', socket: {}, headers: { host: 'fixture.example', origin: 'http://fixture.example', 'x-epms-request': '1' } }, { setHeader() { assert.fail('must not set a failed-login cookie'); } }, { username: user.username, password: 'synthetic-wrong' }), error => error.status === 401);
  } finally { await x.close(); }
});

test('missing/expired writers and expired editor access deny before any document mutation', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root);
    for (const expired of [false, true]) {
      x.state.meStatus = expired ? 401 : 200;
      const options = { cookie: expired };
      for (const [route, body, method] of [
        ['/api/mkdir', { path: x.project + '/denied' }],
        ['/api/rename', { path: x.rel, newName: 'denied.txt' }],
        ['/api/upload?path=' + encodeURIComponent(path.dirname(x.rel)) + '&name=plain.txt&overwrite=1', Buffer.from('must not replace')],
        ['/api/item?path=' + encodeURIComponent(x.rel), undefined, 'DELETE'],
      ]) authRequired(await x.call(route, body, { ...options, ...(method ? { method } : {}) }));
    }
    const editor = await x.call('/api/editor-access?path=' + encodeURIComponent(x.rel), undefined, { cookie: true }); authRequired(editor);
    assert.deepEqual(snapshot(x.root), before);
    assert.equal(fs.readFileSync(path.join(x.root, x.rel), 'utf8'), 'synthetic document bytes must be retained');
  } finally { await x.close(); }
});

test('ordinary permission/CSRF denials remain 403 without the authentication-required code', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root); x.state.user.permissions = [];
    const permission = await x.call('/api/mkdir', { path: x.project + '/denied' }, { cookie: true });
    assert.equal(permission.status, 403); assert.equal(permission.body.code, undefined); noChallenge(permission);
    assert.equal(permission.body.error, '没有工程资料新建或编辑权限');
    x.state.user = structuredClone(user);
    for (const headers of [{ 'X-EPMS-Request': '' }, { Origin: 'http://synthetic-invalid.example' }]) {
      const csrf = await x.call('/api/mkdir', { path: x.project + '/denied' }, { cookie: true, headers });
      assert.equal(csrf.status, 403); assert.equal(csrf.body.code, undefined); noChallenge(csrf);
    }
    assert.deepEqual(snapshot(x.root), before);
  } finally { await x.close(); }
});

test('upstream unavailability remains 503 for status/login/writes instead of anonymous success', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root); x.state.meStatus = x.state.loginStatus = 503;
    for (const [route, body] of [['/api/epms/session', undefined], ['/api/epms/login', { username: user.username, password: 'synthetic-only' }], ['/api/mkdir', { path: x.project + '/denied' }]]) {
      const response = await x.call(route, body, { cookie: true });
      assert.equal(response.status, 503); assert.equal(response.body.code, undefined); noChallenge(response);
      assert.equal(response.body.error, '账号服务暂不可用，请稍后重试');
    }
    assert.deepEqual(snapshot(x.root), before);
  } finally { await x.close(); }
});

test('guarded HTTP re-login cannot replace an existing cookie on identity or edit-right changes', async () => {
  const x = await fixture(); try {
    const before = snapshot(x.root);
    for (const fresh of [{ ...user, id: 32 }, { ...user, permissions: [] }]) {
      x.state.user = fresh;
      const response = await x.call('/api/epms/login', { username: user.username, password: 'synthetic-only', expectedActorId: actor.id, expectedCanEdit: true }, { cookie: true });
      assert.equal(response.status, 409); assert.equal(response.body.code, undefined); noChallenge(response);
      assert.match(response.body.error, /保存或下载.*退出账号再登录/);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    x.state.user = structuredClone(user);
    const accepted = await x.call('/api/epms/login', { username: user.username, password: 'synthetic-only', expectedActorId: actor.id, expectedCanEdit: true }, { cookie: true });
    assert.equal(accepted.status, 200); assert.deepEqual(accepted.body, actor);
    assert.match(accepted.headers.get('set-cookie'), /^rr_epms_session=/); noChallenge(accepted);
    assert.deepEqual(snapshot(x.root), before);
  } finally { await x.close(); }
});
