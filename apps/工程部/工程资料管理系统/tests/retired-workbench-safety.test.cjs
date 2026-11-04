// Actual plugin/store/core adapter, isolated filesystem and synthetic core responses only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { Readable, Writable } = require('node:stream');
const { test } = require('node:test');
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
const { EpmsStore } = load('epms-store.ts');
const { createCoreEpmsAuth } = load('epms-auth.ts');
const editor = { id: '11', name: 'Synthetic editor', canRead: true, canEdit: true, canReview: false };
const reviewer = { id: '12', name: 'Synthetic reviewer', canRead: true, canEdit: false, canReview: true };
const user = { id: 11, username: 'synthetic-editor', full_name: editor.name, department: '工程部', role: 'user', permissions: ['epms:edit'], is_active: true };
const JWT = 'SYNTHETIC.PAYLOAD.SIGNATURE';
function snapshot(root) {
  const values = {};
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), st = fs.lstatSync(file), key = path.relative(root, file);
      values[key] = { mode: st.mode, inode: st.ino, mtime: st.mtimeMs, ctime: st.ctimeMs,
        body: st.isSymbolicLink() ? fs.readlinkSync(file) : st.isFile() ? fs.readFileSync(file).toString('base64') : null };
      if (st.isDirectory()) walk(file);
    }
  }
  walk(root); return values;
}
function fixture() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pr1054-retired-')), root = path.join(scratch, 'docs');
  const project = 'Client/2026/Project', directory = path.join(root, project, '工程放产资料');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'plain.txt'), 'ordinary document');
  const state = { user: structuredClone(user), coreStatus: 200, coreCalls: 0 };
  const core = createCoreEpmsAuth(async (url, init) => {
    assert.ok(['http://core:8000/api/auth/login', 'http://core:8000/api/auth/me'].includes(url));
    assert.equal(init.redirect, 'error'); state.coreCalls++;
    return new Response(JSON.stringify(url.endsWith('/login') ? { access_token: JWT } : state.user), { status: state.coreStatus });
  });
  const previous = process.env.DOCS_ROOT; process.env.DOCS_ROOT = root;
  const plugin = docsApi({ coreAuth: core }); plugin.configResolved({ root: APP });
  if (previous === undefined) delete process.env.DOCS_ROOT; else process.env.DOCS_ROOT = previous;
  let middleware; plugin.configureServer({ middlewares: { use(f) { middleware = f; } } });
  const call = (url, body, options = {}) => new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url, method: options.method || (body === undefined ? 'GET' : 'POST'), socket: {}, headers: {
      host: 'fixture.example', origin: 'http://fixture.example', 'x-epms-request': '1',
      ...(options.anonymous ? {} : { cookie: 'rr_epms_session=' + JWT }), ...options.headers,
    } });
    const chunks = []; let status = 200; const headers = {};
    const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    response.setHeader = (key, value) => { headers[key.toLowerCase()] = value; };
    response.writeHead = (code, values = {}) => { status = code; for (const [key, value] of Object.entries(values)) response.setHeader(key, value); };
    const timeout = setTimeout(() => reject(Error('isolated middleware timeout')), 4000);
    response.on('error', reject);
    response.on('finish', () => { clearTimeout(timeout); const raw = Buffer.concat(chunks); let result;
      try { result = JSON.parse(raw.toString()); } catch { result = raw; }
      resolve({ status, body: result, raw, headers });
    });
    middleware(request, response, () => { clearTimeout(timeout); reject(Error('unexpected route fallthrough')); });
  });
  return { scratch, root, project, directory, state, call, store: new EpmsStore(root),
    cleanup() { fs.rmSync(scratch, { recursive: true, force: true }); } };
}
async function controlled(x, status = 'draft', name = x.project) {
  const directory = path.join(x.root, name, '工程放产资料'); fs.mkdirSync(directory, { recursive: true });
  const file = name + '/工程放产资料/作业指导书.txt'; fs.writeFileSync(path.join(x.root, file), 'controlled original');
  const lock = await x.store.lock(name, '作业指导书', editor);
  if (status !== 'draft') {
    await x.store.status(name, '作业指导书', editor, 'submit', 0, lock.lockToken);
    if (status === 'approved') {
      const review = await x.store.lock(name, '作业指导书', reviewer);
      await x.store.status(name, '作业指导书', reviewer, 'approve', 1, review.lockToken);
    }
  }
  return { file, token: lock.lockToken };
}
test('initialization and account-only endpoints never create document records; retired business endpoints are 404', async () => {
  const x = fixture(); try {
    const original = snapshot(x.root);
    assert.equal(fs.existsSync(path.join(x.root, x.project, '.epms')), false);
    const session = await x.call('/api/epms/session'); assert.equal(session.status, 200); assert.deepEqual(session.body, editor);
    const anonymousSession = await x.call('/api/epms/session', undefined, { anonymous: true });
    assert.equal(anonymousSession.status, 200); assert.equal(anonymousSession.body, null);
    const login = await x.call('/api/epms/login', { username: user.username, password: 'synthetic-only' });
    assert.equal(login.status, 200); assert.match(login.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
    assert.equal((await x.call('/api/epms/logout', {})).status, 200);
    for (const endpoint of ['', '/lock', '/unlock', '/save', '/status']) {
      const r = await x.call('/api/epms' + endpoint, { path: x.project, doc: '作业指导书', action: 'approve', data: { rows: [] } });
      assert.equal(r.status, 404);
    }
    assert.deepEqual(snapshot(x.root), original);
  } finally { x.cleanup(); }
});
test('editor access is read-only for anonymous, readonly, revoked, unavailable identities and historical records', async () => {
  const x = fixture(); try {
    const url = '/api/editor-access?path=' + encodeURIComponent(x.project + '/工程放产资料/plain.txt');
    assert.deepEqual((await x.call(url)).body, { readOnly: false });
    assert.equal((await x.call(url, undefined, { anonymous: true })).body.readOnly, true);
    x.state.user.permissions = []; assert.equal((await x.call(url)).body.readOnly, true);
    x.state.coreStatus = 401;
    const expired = await x.call(url);
    assert.equal(expired.status, 403); assert.equal(expired.body.code, 'EPMS_AUTH_REQUIRED');
    x.state.coreStatus = 503; assert.equal((await x.call(url)).status, 503);
    x.state.coreStatus = 200; x.state.user = structuredClone(user);
    for (const status of ['draft', 'pending', 'approved']) {
      const name = 'Client/2026/' + status; const c = await controlled(x, status, name), before = snapshot(x.root);
      const result = await x.call('/api/editor-access?path=' + encodeURIComponent(c.file), undefined, { headers: { 'x-epms-lock-token': c.token } });
      assert.equal(result.status, 200); assert.equal(result.body.readOnly, true); assert.ok(result.body.reason);
      assert.deepEqual(snapshot(x.root), before);
    }
  } finally { x.cleanup(); }
});
test('all legacy write routes enforce fresh engineering edit permission even on ordinary documents', async () => {
  const x = fixture(); try {
    const source = x.project + '/工程放产资料/plain.txt';
    const attempts = [
      ['/api/project', { client: 'Client', year: '2026', name: 'Denied' }], ['/api/mkdir', { path: x.project + '/denied' }],
      ['/api/rename', { path: source, newName: 'denied.txt' }], ['/api/copy', { src: source, destDir: x.project, newName: 'denied.txt' }],
      ['/api/batch-delete', { paths: [source] }], ['/api/restore', { trashName: 'missing' }], ['/api/purge', { trashName: 'missing' }],
      ['/api/item?path=' + encodeURIComponent(source), undefined, { method: 'DELETE' }],
      ['/api/upload?path=' + encodeURIComponent(x.project + '/工程放产资料') + '&name=plain.txt&overwrite=1', Buffer.from('denied')],
    ];
    const before = snapshot(x.root);
    for (const identity of ['anonymous', 'reader', 'approve-only', 'admin-without-edit']) {
      x.state.user = { ...user, permissions: identity === 'approve-only' ? ['epms:approve'] : [], role: identity === 'admin-without-edit' ? 'admin' : 'user' };
      for (const [url, body, options = {}] of attempts) {
        const result = await x.call(url, body, { ...options, anonymous: identity === 'anonymous', headers: { 'x-role': 'admin', 'x-can-edit': 'true' } });
        assert.equal(result.status, 403);
        assert.equal(result.body.code, identity === 'anonymous' ? 'EPMS_AUTH_REQUIRED' : undefined);
      }
      assert.deepEqual(snapshot(x.root), before);
    }
    x.state.user = structuredClone(user);
    assert.equal((await x.call('/api/mkdir', { path: x.project + '/allowed' })).status, 200);
    const calls = x.state.coreCalls; x.state.user.permissions = [];
    assert.equal((await x.call('/api/mkdir', { path: x.project + '/revoked' })).status, 403);
    assert.ok(x.state.coreCalls > calls); assert.equal(fs.existsSync(path.join(x.root, x.project, 'revoked')), false);
  } finally { x.cleanup(); }
});
test('draft, pending and approved artifacts cannot be changed with retired lock tokens or parent operations', async () => {
  const x = fixture(); try {
    for (const status of ['draft', 'pending', 'approved']) {
      const project = 'Client/2026/' + status, c = await controlled(x, status, project), before = snapshot(x.root);
      const attempts = [
        ['/api/upload?path=' + encodeURIComponent(project + '/工程放产资料') + '&name=' + encodeURIComponent('作业指导书.txt') + '&overwrite=1', Buffer.from('changed')],
        ['/api/rename', { path: c.file, newName: '作业指导书-new.txt' }],
        ['/api/item?path=' + encodeURIComponent(c.file), undefined, { method: 'DELETE' }],
        ['/api/item?path=' + encodeURIComponent(project), undefined, { method: 'DELETE' }],
        ['/api/rename', { path: project, newName: status + '-renamed' }],
        ['/api/copy', { src: x.project + '/工程放产资料/plain.txt', destDir: project + '/工程放产资料', newName: '作业指导书-copy.txt' }],
        ['/api/batch-delete', { paths: [x.project + '/工程放产资料/plain.txt', c.file] }],
      ];
      for (const [url, body, options = {}] of attempts) {
        const response = await x.call(url, body, { ...options, headers: { 'x-epms-lock-token': c.token } });
        assert.equal(response.status, 409, url); assert.deepEqual(snapshot(x.root), before);
      }
    }
  } finally { x.cleanup(); }
});
test('canonical aliases and metadata paths retain the original read/write barriers', async () => {
  const x = fixture(); try {
    const c = await controlled(x, 'approved');
    const outside = path.join(x.scratch, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'outside');
    fs.symlinkSync(outside, path.join(x.root, 'outside-alias'), 'dir');
    fs.symlinkSync(path.join(x.root, x.project, '.epms'), path.join(x.root, 'metadata-alias'), 'dir');
    fs.symlinkSync(x.directory, path.join(x.root, 'document-alias'), 'dir');
    const before = snapshot(x.scratch);
    for (const p of [x.project + '/.epms/作业指导书.json', 'metadata-alias/作业指导书.json']) {
      assert.equal((await x.call('/api/stat?path=' + encodeURIComponent(p))).status, 403);
      assert.equal((await x.call('/api/file?path=' + encodeURIComponent(p))).status, 403);
      assert.equal((await x.call('/api/copy', { src: p, destDir: x.project, newName: 'leak.json' })).status, 403);
    }
    assert.equal((await x.call('/api/stat?path=outside-alias/keep.txt')).status, 400);
    assert.equal((await x.call('/api/upload?path=outside-alias&name=keep.txt&overwrite=1', Buffer.from('changed'))).status, 400);
    assert.equal((await x.call('/api/editor-access?path=' + encodeURIComponent('document-alias/作业指导书.txt'))).body.readOnly, true);
    assert.equal((await x.call('/api/rename', { path: 'document-alias/作业指导书.txt', newName: 'changed.txt' })).status, 409);
    assert.deepEqual(snapshot(x.scratch), before); assert.equal(fs.readFileSync(path.join(x.root, c.file), 'utf8'), 'controlled original');
  } finally { x.cleanup(); }
});
test('restoring a recycle member cannot bypass an existing controlled artifact', async () => {
  const x = fixture(); try {
    const file = x.project + '/工程放产资料/作业指导书.txt'; fs.writeFileSync(path.join(x.root, file), 'older revision');
    const removed = await x.call('/api/item?path=' + encodeURIComponent(file), undefined, { method: 'DELETE' }); assert.equal(removed.status, 200);
    await controlled(x, 'approved'); const before = snapshot(x.root);
    const restored = await x.call('/api/restore', { trashName: removed.body.trashName });
    assert.equal(restored.status, 409); assert.deepEqual(snapshot(x.root), before);
  } finally { x.cleanup(); }
});
test('malformed historical records fail closed without initialization or migration', async () => {
  const x = fixture(); try {
    const c = await controlled(x, 'draft'), record = path.join(x.root, x.project, '.epms/作业指导书.json');
    fs.writeFileSync(record, '{"status":"draft","data":'); const before = snapshot(x.root);
    const access = await x.call('/api/editor-access?path=' + encodeURIComponent(c.file));
    assert.equal(access.status, 200); assert.equal(access.body.readOnly, true);
    assert.equal((await x.call('/api/rename', { path: c.file, newName: 'changed.txt' })).status, 409);
    assert.deepEqual(snapshot(x.root), before);
  } finally { x.cleanup(); }
});
test('ordinary documents still support real create, copy, upload, download, rename, recycle, restore and purge', async () => {
  const x = fixture(); try {
    assert.equal((await x.call('/api/project', { client: 'Client', year: '2026', name: 'Ordinary' })).status, 200);
    const directory = 'Client/2026/Ordinary/工程放产资料', source = x.project + '/工程放产资料/plain.txt';
    assert.equal((await x.call('/api/copy', { src: source, destDir: directory, newName: 'copy.txt' })).status, 200);
    const upload = await x.call('/api/upload?path=' + encodeURIComponent(directory) + '&name=copy.txt&overwrite=1', Buffer.from('complete replacement\n第二行'));
    assert.equal(upload.status, 200); assert.equal(fs.readFileSync(path.join(x.root, directory, 'copy.txt'), 'utf8'), 'complete replacement\n第二行');
    const download = await x.call('/api/file?path=' + encodeURIComponent(directory + '/copy.txt'));
    assert.equal(download.status, 200); assert.deepEqual(download.raw, Buffer.from('complete replacement\n第二行'));
    assert.equal((await x.call('/api/rename', { path: directory + '/copy.txt', newName: 'renamed.txt' })).status, 200);
    const file = directory + '/renamed.txt', deleted = await x.call('/api/item?path=' + encodeURIComponent(file), undefined, { method: 'DELETE' });
    assert.equal(deleted.status, 200); assert.equal((await x.call('/api/restore', { trashName: deleted.body.trashName })).status, 200);
    assert.equal(fs.readFileSync(path.join(x.root, file), 'utf8'), 'complete replacement\n第二行');
    const again = await x.call('/api/item?path=' + encodeURIComponent(file), undefined, { method: 'DELETE' });
    assert.equal((await x.call('/api/purge', { trashName: again.body.trashName })).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(x.root, '.回收站/manifest.json'), 'utf8')), []);
  } finally { x.cleanup(); }
});
test('both existing purchase-list names remain discoverable with case-insensitive xlsx preference and xls fallback', async () => {
  const x = fixture(); try {
    for (const [index, name] of ['外购清单', '外购件清单'].entries()) {
      const project = 'Client/2026/Alias' + index, directory = path.join(x.root, project, '工程放产资料');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, name + '.xls'), 'synthetic legacy file');
      fs.writeFileSync(path.join(directory, name + '.XLSX'), 'synthetic modern file');
      const before = snapshot(x.root);
      const response = await x.call('/api/doctypes?project=' + encodeURIComponent(project));
      assert.equal(response.status, 200);
      assert.equal(response.body.items.find(item => item.name === '外购件清单').existing, '工程放产资料/' + name + '.XLSX');
      assert.deepEqual(snapshot(x.root), before);
      fs.unlinkSync(path.join(directory, name + '.XLSX'));
      const fallback = await x.call('/api/doctypes?project=' + encodeURIComponent(project));
      assert.equal(fallback.body.items.find(item => item.name === '外购件清单').existing, '工程放产资料/' + name + '.xls');
    }
  } finally { x.cleanup(); }
});
