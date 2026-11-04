'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const Pricing = require('../frontend/injection-pricing');
const Supplier = require('../frontend/supplier-material-sync');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { buildWorkbook } = require('../backend/services/exportInternal');
const workbench = fs.readFileSync(require.resolve('../frontend/workbench.js'), 'utf8');
function openMolding(payload) {
  const context = vm.createContext({ payload, window: { InjectionPricing: Pricing, __refs: { _loaded: true, _ready: true } },
    num: value => Number(value) || 0, defaultMachinePricesForFactory: () => payload.machine_prices, DEFAULT_MATERIAL_PRICES: [] });
  vm.runInContext(workbench.slice(workbench.indexOf('function lookupMachinePrice('), workbench.indexOf('function syncInjectionMolds(')), context);
  vm.runInContext(workbench.slice(workbench.indexOf('function isBlankInjectionPrice('), workbench.indexOf('function renderMolding(')), context);
  const begin = workbench.indexOf('function renderMolding('), end = workbench.indexOf('  const canEditPrices', begin);
  vm.runInContext(workbench.slice(begin, end) + '\nreturn payload;\n}', context);
  vm.runInContext('renderMolding(null, payload, true, () => {}, [], 1, \"staff\")', context);
}


test('真实隔离保存接口保留自动/手填/历史来源及供应商精确归属', { timeout: 30000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'injection-pricing-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['backend/server.js'], { cwd: path.join(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', DB_DRIVER: 'sqlite', DB_FILE: path.join(temporary, 'test.db'),
    DATABASE_URL: '', TEST_DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1',
    SESSION_SECRET: 'injection-pricing-test-only', COOKIE_SECURE: '0', ADMIN_INITIAL_PASSWORD: 'pricing-test-only',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null) {
      const ended = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await ended;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('test server start timeout: ' + logs)), 15000);
    child.stdout.on('data', data => { if (String(data).includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(Error('test server exited ' + code + ': ' + logs)); });
  });
  let cookie = '';
  async function api(url, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${url}`, { method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data)); return data;
  }
  await api('/auth/login', 'POST', { username: 'admin', password: 'pricing-test-only' });
  const created = await api('/quotes', 'POST', { quote_no: 'PR1060-ISOLATED', product_name: '定价隔离夹具', customer: 'TEST', qty: 1000 });
  const read = () => api('/quotes/' + created.id);
  let quote = await read();
  const section = dept => quote.sections.find(row => row.dept === dept);
  const historical = { mold_no: '01M', machine_model: '20A', machine: '200T', material_unit_price: 0, target: 2000, sets: 1, shot_price: 1.01 };
  const auto = { ...historical, mold_no: '02M', target: 1000 };
  const molding = { material_prices: [{ name: 'Synthetic fixture', price: 0 }], machine_prices: [{ model: '20A', normal: '200T', price: 2020 }], injection: [historical, auto,
    { ...historical, mold_no: 'LEGACY-ZERO', mold_part_index: 1, shot_price: 0 },
    { ...historical, mold_no: 'NULL-ORIGIN-ZERO', mold_part_index: 2, shot_price: 0, shot_price_mode: null },
    { ...historical, mold_no: 'MANUAL-ZERO', mold_part_index: 1, shot_price: 0, shot_price_mode: 'manual' },
    { ...historical, mold_no: 'MANUAL-BLANK', mold_part_index: 2, shot_price: null, shot_price_mode: 'manual' },
    { ...historical, mold_no: 'SAME-MOLD', name: 'Synthetic left', mold_part_index: 0, sets: 2, shot_price: null, shot_price_mode: 'auto' },
    { ...historical, mold_no: 'SAME-MOLD', name: 'Synthetic right', mold_part_index: 1, sets: 2, shot_price: 0, shot_price_mode: 'auto' },
    { ...historical, mold_no: 'STAGED', mold_part_index: 1, catalog_raw_weight: 0, shot_price: .1234, shot_price_mode: 'auto' },
  ] };
  Pricing.reprice(auto, molding.machine_prices);
  openMolding(molding);
  assert.deepEqual(molding.injection.map(row => row.shot_price), [1.01, 2.02, 0, 0, 0, null, .505, .505, .1234]);
  const first = await api('/sections/' + section('molding').id, 'PUT', { payload: molding, base_filled_at: section('molding').filled_at });
  quote = await read();
  assert.deepEqual(JSON.parse(section('molding').payload_json), JSON.parse(JSON.stringify(molding)),
    'compare all transport fields after normalizing only VM-created object prototypes');
  const loaded = JSON.parse(section('molding').payload_json);
  loaded.injection[1].shot_price_mode = 'manual'; // Explicit same-value hand edit remains fixed.
  await api('/sections/' + section('molding').id, 'PUT', { payload: loaded, base_filled_at: first.filled_at });
  quote = await read();
  assert.equal(JSON.parse(section('molding').payload_json).injection[1].shot_price_mode, 'manual');
  assert.deepEqual(JSON.parse(section('molding').payload_json).injection[0], historical);
  const savedMolding = JSON.parse(section('molding').payload_json);
  assert.deepEqual(savedMolding.injection, loaded.injection, 'all per-part provenance/zero/null fields survive real save and reopen');
  const sql = new DatabaseSync(path.join(temporary, 'test.db'), { readOnly: true });
  try {
    const persisted = sql.prepare('SELECT payload_json FROM quote_sections WHERE id=?').get(section('molding').id);
    assert.deepEqual(JSON.parse(persisted.payload_json), savedMolding, 'actual SQLite bytes match all fields reopened through the API');
  } finally { sql.close(); }
  const workbook = await buildWorkbook({ quote: { qty: 1000 }, sections: [{ dept: 'molding', payload_json: JSON.stringify(savedMolding) }] });
  const roundtrip = new (require('exceljs').Workbook)(); await roundtrip.xlsx.load(await workbook.xlsx.writeBuffer());
  for (const name of ['报价明细', '啤机明细']) {
    const sheet = roundtrip.getWorksheet(name); let start;
    sheet.eachRow(row => { if (row.getCell(1).value === '模号' && row.getCell(2).value === '模具名称') start = row.number + 1; });
    assert.ok(start);
    for (const index of [2, 3, 4]) { assert.equal(sheet.getCell(start + index, 9).value, 0); assert.equal(sheet.getCell(start + index, 9).formula, undefined); }
    assert.equal(sheet.getCell(start + 5, 9).value, null);
    for (const index of [6, 7]) { assert.equal(sheet.getCell(start + index, 9).formula, `ROUND(2020/J${start + index}/L${start + index},4)`); assert.equal(sheet.getCell(start + index, 9).result, .505); }
    assert.equal(sheet.getCell(start + 8, 9).value, .1234);
  }
  const targetRow = { mold_no: 'INDEX-260309-08', name: '爆米花桶', product_group_id: '', product_group_name: '',
    source_sheet_name: '排模资料', source_sheet_index: 0, mold_part_index: 0, mold_part_count: 1,
    material: 'PP', weight_g: 57, machine_model: '20A', sets: 1, cycle_sec: 30,
    target: .446, shot_price: 4304.9327, shot_price_mode: 'auto', note: '恢复隔离夹具' };
  savedMolding.injection.push(targetRow);
  savedMolding.machine_prices[0].price = 1920;
  const beforeRecoverySave = await api('/sections/' + section('molding').id, 'PUT', {
    payload: savedMolding, base_filled_at: section('molding').filled_at });
  quote = await read();
  const recovery = JSON.parse(section('molding').payload_json);
  const otherRowsBefore = structuredClone(recovery.injection.slice(0, -1));
  assert.equal(recovery.injection.at(-1).target, .446, '实际保存接口不替用户自动改历史目标');
  const reference = { ...targetRow, target: 2600, shot_price: null };
  const recoveryContext = vm.createContext({ window: { InjectionPricing: Pricing } });
  vm.runInContext(workbench.slice(workbench.indexOf('function engineeringTargetForInjection('),
    workbench.indexOf('// 仅补齐明确自动行')), recoveryContext);
  assert.equal(recoveryContext.applyEngineeringTargetForInjection(recovery.injection.at(-1), [reference], recovery.machine_prices), true);
  assert.equal(recovery.injection.at(-1).target, 2600); assert.equal(recovery.injection.at(-1).shot_price, .7385);
  await api('/sections/' + section('molding').id, 'PUT', { payload: recovery, base_filled_at: beforeRecoverySave.filled_at });
  quote = await read();
  const reopenedRecovery = JSON.parse(section('molding').payload_json);
  assert.deepEqual(reopenedRecovery, recovery, '真实接口保存并重开保留恢复后的全部字段');
  assert.deepEqual(reopenedRecovery.injection.slice(0, -1), otherRowsBefore, '其他历史/手填/空价行逐字段不变');
  const recoverySql = new DatabaseSync(path.join(temporary, 'test.db'), { readOnly: true });
  try {
    assert.deepEqual(JSON.parse(recoverySql.prepare('SELECT payload_json FROM quote_sections WHERE id=?').get(section('molding').id).payload_json), recovery,
      '数据库实际已存2600和0.7385，其他参数与JSON完整保留');
  } finally { recoverySql.close(); }
  const row = { name: '隔离物料', supplier_id: 'A', supplier_name: '同名供应商', qty: 1 };
  const other = { name: '其他供应商物料', supplier_id: 'B', supplier_name: '同名供应商', qty: 5 };
  Supplier.setSupplier(row, '同名供应商', [row, other]);
  const engineering = { hardware: [row, other], aux_materials: [], packaging_materials: [] };
  await api('/sections/' + section('engineering').id, 'PUT', { payload: engineering, base_filled_at: section('engineering').filled_at });
  quote = await read();
  assert.deepEqual(JSON.parse(section('engineering').payload_json), engineering);
});
