const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const app = path.resolve(__dirname, '..');
const editorAccount = () => ({ id: 'synthetic-editor-17', name: 'Synthetic engineering editor', canRead: true, canEdit: true, canReview: false });
const authRequired = { status: 403, body: { error: '个人登录已过期，请重新登录', code: 'EPMS_AUTH_REQUIRED' } };
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

// Execute the actual components with deterministic hook scheduling. Only the UI
// primitives and workbook engine are doubles; API request/error code and each
// component's effects, form handlers, save handler and cleanup are real source.
function fixture(initialSession) {
  const h = { requests: [], uploads: [], toasts: [], creates: 0, destroys: 0, saved: 0,
    parentDirty: false, sheets: null, loginReply: { status: 200, body: editorAccount() },
    sessionReply: { status: 200, body: initialSession }, uploadReply: authRequired, mtime: 100, beforeLogoutCalls: 0 };
  let active;
  const react = {
    createContext(value) { const context = { value }; context.Provider = Symbol('Provider'); return context; },
    useContext(context) { return context.value; },
    useState(initial) {
      const runner = active, i = runner.index++;
      if (!runner.slots[i]) runner.slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = runner.slots[i];
      return [slot.value, value => { const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; runner.pending = true; } }];
    },
    useRef(value) { const runner = active, i = runner.index++; return (runner.slots[i] ??= { current: value }); },
    useCallback(fn, deps) {
      const runner = active, i = runner.index++, old = runner.slots[i];
      if (!old || !sameDeps(old.deps, deps)) runner.slots[i] = { value: fn, deps };
      return runner.slots[i].value;
    },
    useEffect(fn, deps) {
      const runner = active, i = runner.index++, old = runner.slots[i];
      if (!old || !sameDeps(old.deps, deps)) {
        const slot = { deps, cleanup: old?.cleanup }; runner.slots[i] = slot;
        runner.effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); });
      }
    },
  };
  const jsx = { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const listeners = new Map(), windowListeners = new Map();
  const element = { addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status,
    json: async () => body, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const context = vm.createContext({ console, Buffer, Headers, File, Blob, URL, URLSearchParams,
    setTimeout, clearTimeout, queueMicrotask,
    fetch: async (url, options = {}) => {
      h.requests.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
      if (url === 'api/epms/session') return reply(h.sessionReply.status, h.sessionReply.body);
      if (url === 'api/epms/login') return reply(h.loginReply.status, h.loginReply.body);
      if (url === 'api/epms/logout') return reply(200, { ok: true });
      if (String(url).startsWith('api/editor-access?')) return reply(200, { readOnly: false });
      if (String(url).startsWith('api/stat?')) return reply(200, { mtime: h.mtime, size: 3 });
      if (String(url).startsWith('api/file?')) return reply(200, null);
      throw new Error('Unexpected fixture request: ' + url);
    },
    XMLHttpRequest: class {
      constructor() { this.upload = {}; this.headers = {}; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(name, value) { this.headers[name] = value; }
      send(file) {
        h.uploads.push({ method: this.method, url: this.url, headers: this.headers, file });
        const result = h.uploadReply;
        queueMicrotask(() => {
          this.status = result.status; this.responseText = JSON.stringify(result.body);
          if (result.status >= 200 && result.status < 300) h.mtime = 200;
          this.onload();
        });
      }
    },
    document: { getElementById: () => element },
    window: {
      addEventListener: (name, fn) => windowListeners.set(name, fn),
      removeEventListener: (name, fn) => { if (windowListeners.get(name) === fn) windowListeners.delete(name); },
      LuckyExcel: { transformExcelToLucky: (_bytes, onSuccess) => onSuccess({ sheets: [{ name: 'Synthetic sheet', data: [['original value']] }] }) },
      luckysheet: {
        create(options) { h.creates++; h.sheets = options.data; h.engineOptions = options; },
        destroy() { h.destroys++; h.sheets = null; },
        getAllSheets() { return h.sheets; },
      },
    },
  });
  const modules = new Map();
  const stubs = {
    react, 'react/jsx-runtime': jsx,
    '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle'].map(k => [k, k])),
    '@/components/ui/button': { Button: 'Button' },
    'lucide-react': { ArrowLeft: 'ArrowLeft', Download: 'Download', Loader2: 'Loader2', Save: 'Save' },
    sonner: { toast: { error: message => h.toasts.push({ kind: 'error', message }), success: message => h.toasts.push({ kind: 'success', message }) } },
    '@/lib/luckysheet-loader': { ensureLuckysheet: async () => {} },
    '@/lib/lucky-to-xlsx': { luckyToXlsx: async sheets => new Blob([JSON.stringify(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) },
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const filename = path.join(app, relative), module = { exports: {} }; modules.set(relative, module);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const requireSource = name => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name === '@/lib/api') return load('src/lib/api.ts');
      if (name === '@/lib/epms-access') return load('src/lib/epms-access.ts');
      throw new Error('Unexpected component dependency: ' + name);
    };
    vm.runInContext('(function(require, module, exports) {\n' + output + '\n})', context, { filename })(requireSource, module, module.exports);
    return module.exports;
  }
  const accounts = load('src/components/EpmsAccount.tsx');
  h.api = load('src/lib/api.ts').api;
  const access = load('src/lib/epms-access.ts');
  class Runner {
    constructor(component, props = {}) { this.component = component; this.props = props; this.slots = []; this.pending = true; }
    render() {
      this.index = 0; this.effects = []; this.pending = false; active = this;
      try { this.tree = this.component(this.props); } finally { active = undefined; }
      if (this === h.provider) access.AccessContext.value = this.tree.props.value;
      for (const effect of this.effects) effect();
    }
    unmount() { for (const slot of this.slots) slot?.cleanup?.(); }
  }
  h.provider = new Runner(accounts.EpmsAccountProvider, { children: null });
  h.control = new Runner(accounts.CoreAccountControl, { beforeLogout: async () => { h.beforeLogoutCalls++; } });
  h.runners = [h.provider, h.control];
  h.session = () => access.AccessContext.value;
  h.settle = async () => {
    for (let i = 0; i < 20; i++) {
      h.provider.render(); h.control.render(); h.editor?.render();
      await new Promise(resolve => setImmediate(resolve));
      if (!h.runners.some(r => r.pending)) break;
    }
    h.provider.render(); h.control.render(); h.editor?.render();
  };
  h.openEditor = async () => {
    h.editor = new Runner(load('src/sections/DocEditor.tsx').default, {
      path: 'PR-REAUTH/2026/Synthetic/排模表.xlsx', name: '排模表.xlsx',
      onClose() { throw new Error('Unexpected editor close'); }, onSaved() { h.saved++; },
      onDirtyChange(value) { h.parentDirty = value; },
    });
    h.runners.push(h.editor); await h.settle();
    assert.equal(h.creates, 1); assert.equal(h.engineOptions.allowEdit, true);
  };
  h.edit = value => { h.sheets[0].data[0][0] = value; assert.ok(listeners.has('keydown')); listeners.get('keydown')({ key: 'x' }); };
  h.submit = async (username = 'synthetic-editor', password = 'synthetic-password') => {
    const open = find(h.control.tree, n => n.type === 'button' && textOf(n) === (h.session().session ? '重新登录' : '核心账号登录'));
    assert.ok(open); open.props.onClick(); await h.settle();
    find(h.control.tree, n => n.type === 'input' && n.props.autoComplete === 'username').props.onChange({ target: { value: username } });
    find(h.control.tree, n => n.type === 'input' && n.props.autoComplete === 'current-password').props.onChange({ target: { value: password } });
    await h.settle(); let prevented = 0;
    await find(h.control.tree, n => n.type === 'form').props.onSubmit({ preventDefault() { prevented++; } });
    assert.equal(prevented, 1); await h.settle();
  };
  h.save = async () => {
    const button = find(h.editor.tree, n => n.type === 'Button' && textOf(n).includes('保存 (Ctrl+S)'));
    assert.ok(button); assert.equal(button.props.disabled, false);
    await button.props.onClick(); await h.settle();
  };
  h.close = () => { for (const r of h.runners.slice().reverse()) r.unmount(); };
  return h;
}
function children(node) { return node && typeof node === 'object' ? node.props?.children : undefined; }
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const found = find(item, predicate); if (found) return found; } return undefined; }
  if (!node || typeof node !== 'object') return undefined;
  return predicate(node) ? node : find(children(node), predicate);
}
function textOf(node) { if (node == null || typeof node === 'boolean') return ''; if (Array.isArray(node)) return node.map(textOf).join('');
  return typeof node === 'object' ? textOf(children(node)) : String(node); }

test('guest 200 null is a normal anonymous page and failed personal login does not create a session', async () => {
  const h = fixture(null);
  try {
    await h.settle(); assert.equal(h.session().loading, false); assert.equal(h.session().session, null); assert.equal(h.session().error, '');
    assert.ok(find(h.control.tree, n => n.type === 'button' && textOf(n) === '核心账号登录'));
    h.loginReply = authRequired; await h.submit();
    assert.equal(h.session().session, null); assert.equal(h.session().revision, 0);
    assert.match(textOf(h.control.tree), /个人登录已过期/);
    const request = h.requests.find(r => r.url === 'api/epms/login');
    assert.equal(request.body.expectedActorId, undefined); assert.equal(request.body.expectedCanEdit, undefined);
    assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.headers.has('Authorization'), false);
    assert.equal(find(h.control.tree, n => n.type === 'input' && n.props.autoComplete === 'current-password').props.value, '');
  } finally { h.close(); }
});

test('provider treats only the known personal-authentication code as anonymous and exposes service/permission failures', async () => {
  for (const [response, expectedError] of [
    [authRequired, ''],
    [{ status: 401, body: { error: 'synthetic gateway authentication required' } }, 'synthetic gateway authentication required'],
    [{ status: 503, body: { error: 'synthetic account service unavailable' } }, 'synthetic account service unavailable'],
    [{ status: 403, body: { error: 'synthetic origin check failed' } }, 'synthetic origin check failed'],
  ]) {
    const h = fixture(null); h.sessionReply = response;
    try {
      await h.settle(); assert.equal(h.session().loading, false); assert.equal(h.session().session, null);
      assert.equal(h.session().error, expectedError);
      if (expectedError) assert.ok(textOf(h.control.tree).includes(expectedError));
    } finally { h.close(); }
  }
});

test('read-only personal reauthentication sends the false capability guard without clearing it', async () => {
  const reader = { ...editorAccount(), canEdit: false }, h = fixture(reader);
  try {
    await h.settle(); h.loginReply = { status: 200, body: { ...reader } }; await h.submit();
    const request = h.requests.find(r => r.url === 'api/epms/login');
    assert.equal(request.body.expectedActorId, reader.id); assert.equal(request.body.expectedCanEdit, false);
    assert.equal(h.session().session.canEdit, false); assert.equal(h.beforeLogoutCalls, 0);
    await assert.rejects(h.api.upload('PR-REAUTH/2026/Synthetic', new File(['synthetic'], '排模表.xlsx')), /只读/);
    assert.equal(h.uploads.length, 0);
  } finally { h.close(); }
});

test('expired XHR save retains the actual editor buffer; same-account reauthentication saves it without recreating the editor', async () => {
  const originalSession = editorAccount(), h = fixture(originalSession);
  try {
    await h.settle(); await h.openEditor(); h.edit('unsaved synthetic engineering value'); await h.settle();
    const buffer = h.sheets;
    await h.save();
    assert.equal(h.uploads.length, 1); assert.equal(h.saved, 0); assert.equal(h.parentDirty, true);
    assert.equal(h.sheets, buffer); assert.equal(h.sheets[0].data[0][0], 'unsaved synthetic engineering value');
    assert.equal(h.session().session, originalSession); assert.equal(h.creates, 1); assert.equal(h.destroys, 0);
    assert.ok(h.toasts.some(t => t.kind === 'error' && /个人登录已过期/.test(t.message)));
    h.loginReply = { status: 200, body: { ...originalSession, name: 'Synthetic editor reverified' } };
    await h.submit();
    assert.equal(h.session().session.name, 'Synthetic editor reverified'); assert.equal(h.session().revision, 1);
    assert.equal(h.parentDirty, true); assert.equal(h.sheets, buffer); assert.equal(h.creates, 1); assert.equal(h.destroys, 0);
    assert.equal(h.beforeLogoutCalls, 0); assert.equal(h.requests.filter(r => r.url === 'api/epms/logout').length, 0);
    const login = h.requests.filter(r => r.url === 'api/epms/login').at(-1);
    assert.equal(login.body.expectedActorId, originalSession.id); assert.equal(login.body.expectedCanEdit, true);
    h.uploadReply = { status: 200, body: { ok: true, name: '排模表.xlsx' } };
    await h.save();
    assert.equal(h.uploads.length, 2); assert.equal(h.saved, 1); assert.equal(h.parentDirty, false);
    assert.equal(h.sheets, buffer); assert.equal(h.creates, 1); assert.equal(h.destroys, 0);
    assert.deepEqual(JSON.parse(await h.uploads[1].file.text()), [{ name: 'Synthetic sheet', data: [['unsaved synthetic engineering value']] }]);
    assert.ok(h.uploads[1].url.includes('baseMtime=100')); assert.equal(h.uploads[1].headers['X-EPMS-Request'], '1');
    assert.ok(h.toasts.some(t => t.kind === 'success' && t.message === '已保存到系统'));
  } finally { h.close(); }
});

test('failed login and backend identity/permission conflict replies preserve the current session and dirty workbook', async () => {
  const originalSession = editorAccount(), h = fixture(originalSession);
  try {
    await h.settle(); await h.openEditor(); h.edit('must survive failed reauthentication'); await h.settle(); const buffer = h.sheets;
    for (const [username, response] of [
      ['synthetic-editor', authRequired],
      ['different-synthetic-editor', { status: 409, body: { error: '请使用当前个人账号重新登录', code: 'EPMS_ACCOUNT_CHANGED' } }],
      ['synthetic-editor', { status: 409, body: { error: '账号权限已变化，请先下载资料', code: 'EPMS_PERMISSION_CHANGED' } }],
      ['synthetic-editor', { status: 503, body: { error: 'synthetic account service unavailable' } }],
    ]) {
      h.loginReply = response; await h.submit(username);
      const request = h.requests.filter(r => r.url === 'api/epms/login').at(-1);
      assert.equal(request.body.expectedActorId, originalSession.id); assert.equal(request.body.expectedCanEdit, true);
      assert.equal(request.body.username, username);
      assert.equal(h.session().session, originalSession); assert.equal(h.session().revision, 0);
      assert.equal(h.sheets, buffer); assert.equal(h.parentDirty, true); assert.equal(h.creates, 1); assert.equal(h.destroys, 0);
      assert.ok(textOf(h.control.tree).includes(response.body.error));
      assert.equal(find(h.control.tree, n => n.type === 'input' && n.props.autoComplete === 'current-password').props.value, '');
    }
    assert.equal(h.beforeLogoutCalls, 0); assert.equal(h.uploads.length, 0);
  } finally { h.close(); }
});

test('actual fetch and XHR API failures retain personal status/code without clearing local edit capability', async () => {
  const h = fixture(editorAccount());
  try {
    await h.settle(); h.loginReply = authRequired;
    await assert.rejects(h.api.epmsLogin('synthetic-editor', 'synthetic-password', h.session().session),
      error => error.status === 403 && error.code === 'EPMS_AUTH_REQUIRED');
    await assert.rejects(h.api.upload('PR-REAUTH/2026/Synthetic', new File(['synthetic'], '排模表.xlsx')),
      error => error.status === 403 && error.code === 'EPMS_AUTH_REQUIRED');
    h.uploadReply = { status: 200, body: { ok: true, name: '排模表.xlsx' } };
    assert.equal((await h.api.upload('PR-REAUTH/2026/Synthetic', new File(['synthetic retry'], '排模表.xlsx'))).ok, true);
    assert.equal(h.session().session.canEdit, true);
  } finally { h.close(); }
});
