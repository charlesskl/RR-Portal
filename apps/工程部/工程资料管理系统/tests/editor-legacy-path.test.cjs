const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const app = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(app, 'src/sections/DocEditor.tsx'), 'utf8');
const tree = ts.createSourceFile('DocEditor.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('ensureLuckysheet')) effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(effect);
const effectJs = ts.transpileModule('(' + effect.getText(tree) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function open(file, exists) {
  const calls = [], values = {};
  const context = vm.createContext({ writable: true, path: file, fileName: path.basename(file), dirtyRef: { current: false }, destroyedRef: { current: false }, CONTAINER_ID: 'test-editor',
    api: { stat: async p => { calls.push(['stat', p]); if (!exists.includes(p)) throw Error('404'); return { mtime: 100, size: 1 }; }, fileUrl: p => p },
    fetch: async p => { calls.push(['fetch', p]); return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; },
    ensureLuckysheet: async () => calls.push(['engine']),
    window: { LuckyExcel: { transformExcelToLucky: (_buf, cb) => cb({ sheets: [{}] }) }, luckysheet: { create: () => calls.push(['create']), destroy() {} } },
    setResolvedPath: p => { values.resolvedPath = p; }, setBaseMtime: n => { values.baseMtime = n; },
    setError: e => { values.error = e; }, setPhase: p => { values.phase = p; },
    document: { getElementById: () => ({ addEventListener() {} }) }, markDirty() {},
  });
  vm.runInContext(effectJs, context)();
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  return { calls, values };
}

test('legacy XLS redirects to its same-directory xlsx and obtains the xlsx conflict timestamp', async () => {
  const { calls, values } = await open('客户/2026/资料/排模表.XLS', ['客户/2026/资料/排模表.xlsx']);
  assert.equal(values.resolvedPath, '客户/2026/资料/排模表.xlsx');
  assert.equal(values.phase, 'ready'); assert.equal(values.baseMtime, 100);
  assert.deepEqual(calls.filter(c => c[0] === 'fetch'), [['fetch', '客户/2026/资料/排模表.xlsx']]);
});
test('xlsx opens directly and a missing sibling preserves the unsupported legacy error', async () => {
  const normal = await open('客户/排模表.XLSX', ['客户/排模表.XLSX']);
  assert.equal(normal.values.phase, 'ready');
  assert.deepEqual(normal.calls.filter(c => c[0] === 'stat'), [['stat', '客户/排模表.XLSX']]);
  const missing = await open('客户/排模表.xls', ['客户/排模表.xls']);
  assert.equal(missing.values.phase, 'error'); assert.match(missing.values.error, /旧版.*xls/);
  assert.ok(!missing.calls.some(c => c[0] === 'engine' || c[0] === 'fetch'));
});
test('other document types never enter the Excel resolver or workbook parser', async () => {
  for (const file of ['客户/生产注意事项.pdf', '客户/排模表.xlsm']) {
    const result = await open(file, [file]); assert.equal(result.values.phase, 'error');
    assert.deepEqual(result.calls, []);
  }
});

// Extract actual read-only route dependencies and handler, rather than reimplement selection.
const server = fs.readFileSync(path.join(app, 'vite-plugin-docs-api.ts'), 'utf8');
const source = ts.createSourceFile('plugin.ts', server, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && ['resolveSafe', 'walk'].includes(n.name?.text)).map(n => n.getText(source));
const routes = source.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations[0]?.name.getText(source) === 'routes').declarationList.declarations[0].initializer;
const route = routes.properties.find(n => n.name.getText(source) === '"/api/doctypes"');
const handler = route.initializer.properties.find(n => n.name.getText(source) === 'handler').initializer.getText(source);
const routeJs = ts.transpileModule(declarations.join('\n') + '\n globalThis.handler = ' + handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('actual doctypes route prefers xlsx case-insensitively while retaining legacy fallback and traversal guard', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-legacy-path-'));
  try {
    const project = '客户/2026/项目';
    for (const name of ['a/排模表.xls', 'b/排模表.XLSX', 'a/排模图.xls', 'a/外购清单.xls']) {
      const p = path.join(root, project, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'synthetic');
    }
    let result;
    const context = vm.createContext({ fs, fsp, path, SKIP_DIRS: new Set(), json: (_res, status, body) => { result = { status, body }; } });
    vm.runInContext(routeJs, context);
    await context.handler({ res: {}, url: new URL('http://local/api/doctypes?project=' + encodeURIComponent(project)), root, projectRoot: root });
    assert.equal(result.status, 200);
    assert.equal(result.body.items.find(i => i.name === '排模表').existing, 'b/排模表.XLSX');
    assert.equal(result.body.items.find(i => i.name === '排模图').existing, 'a/排模图.xls');
    assert.equal(result.body.items.find(i => i.name === '外购件清单').existing, 'a/外购清单.xls');
    await context.handler({ res: {}, url: new URL('http://local/api/doctypes?project=../outside'), root, projectRoot: root });
    assert.ok(result.body.items.every(i => i.existing === null));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('actual loading effect survives cleanup/setup reuse and rejects its stale parser callback', async () => {
  const calls = [], values = {}, parserCallbacks = [];
  const context = vm.createContext({
    writable: true, path: '客户/排模表.xlsx', fileName: '排模表.xlsx',
    destroyedRef: { current: false }, CONTAINER_ID: 'strict-editor',
    api: { stat: async () => ({ mtime: 100 }), fileUrl: p => p },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
    ensureLuckysheet: async () => {},
    window: { LuckyExcel: { transformExcelToLucky: (_buf, cb) => parserCallbacks.push(cb) },
      luckysheet: { create: () => calls.push('create'), destroy: () => calls.push('destroy') } },
    setResolvedPath() {}, setBaseMtime() {}, setError: e => { values.error = e; },
    setPhase: p => { values.phase = p; }, markDirty() {},
    document: { getElementById: () => ({ addEventListener() {} }) },
  });
  const setup = vm.runInContext(effectJs, context);
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
  const cleanupFirst = setup();
  await flush();
  assert.equal(parserCallbacks.length, 1);
  cleanupFirst();
  const cleanupSecond = setup();
  await flush();
  assert.equal(parserCallbacks.length, 2);
  parserCallbacks[0]({ sheets: [{}] });
  assert.deepEqual(calls, ['destroy'], 'cancelled first parser must not create an editor');
  parserCallbacks[1]({ sheets: [{}] });
  assert.equal(values.phase, 'ready', 'reused effect must clear its prior destroyed flag');
  assert.equal(values.error, undefined);
  assert.deepEqual(calls, ['destroy', 'create']);
  cleanupSecond();
  parserCallbacks[1]({ sheets: [{}] });
  assert.deepEqual(calls, ['destroy', 'create', 'destroy'], 'late callback after final cleanup stays inert');
});
