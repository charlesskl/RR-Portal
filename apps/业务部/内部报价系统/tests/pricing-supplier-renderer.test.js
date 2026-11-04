'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Pricing = require('../frontend/injection-pricing');
const Supplier = require('../frontend/supplier-material-sync');
const source = fs.readFileSync(require.resolve('../frontend/workbench.js'), 'utf8');

// Exercise the production column renderers and renderTable input handlers with
// synthetic rows. This DOM only implements the operations those renderers use.
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this.classList = { add() {} }; this.value = ''; this.textContent = '';
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  set value(value) { this.inputValue = String(value); }
  get value() { return this.inputValue; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this[key] = value; }
  setCustomValidity(value) { this.validationMessage = value; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.tagName === selector ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
}
function contextFor(payload) {
  const changes = [], alerts = [];
  const context = vm.createContext({
    payload, window: { InjectionPricing: Pricing, SupplierMaterialSync: Supplier },
    document: { createElement: tag => new Element(tag) },
    num: value => Number(value) || 0, setTimeout() {},
    onChange: () => changes.push(JSON.stringify(payload)), alert: message => alerts.push(message),
    confirm: () => true,
    refMolds: [], engineeringImagesForInjection: () => [],
  });
  vm.runInContext(source.slice(source.indexOf('function renderTable('), source.indexOf('// 辅助/包装材料 类别')), context);
  vm.runInContext(source.slice(source.indexOf('function formatNum('), source.indexOf('function legacyFormulaAmount(')), context);
  vm.runInContext(source.slice(source.indexOf('function engineeringTargetForInjection('), source.indexOf('// 仅补齐明确自动行')), context);
  return { context, changes, alerts };
}
function molding(payload, readonly = false, refMolds = []) {
  const fixture = contextFor(payload);
  const { context } = fixture;
  context.refMolds = refMolds;
  const moldingStart = source.indexOf('function renderMolding(');
  const pricingStart = source.indexOf('  const shotRefreshers =', moldingStart);
  const columnsStart = source.indexOf('  const cols = [', moldingStart);
  vm.runInContext(source.slice(pricingStart, source.indexOf("  renderTable(host.querySelector('#wb-material-prices')", pricingStart)) +
    source.slice(columnsStart, source.indexOf('  const wrappedOnChange =', columnsStart)) +
    '\nglobalThis.injectionColumns = cols; globalThis.machineChanged = onMachChange;', context);
  const container = new Element('div');
  context.renderTable(container, context.injectionColumns, payload.injection, { readonly, onChange: context.onChange, showRowNumber: false });
  const cells = container.querySelectorAll('tbody')[0].children.map(row => row.children);
  const cell = (key, index = 0) => cells[index][context.injectionColumns.findIndex(col => col.key === key)];
  const input = (key, index = 0) => cell(key, index).children[0];
  const edit = (key, value, index = 0) => { const node = input(key, index); node.value = value; node.oninput(); };
  const machineStart = source.indexOf('  const machCols = [', pricingStart);
  vm.runInContext(source.slice(machineStart, source.indexOf("  renderTable(host.querySelector('#wb-machine-prices')", machineStart)) +
    '\nglobalThis.machineColumns = machCols;', context);
  const machines = new Element('div');
  context.renderTable(machines, context.machineColumns, payload.machine_prices, { onChange: context.machineChanged, showRowNumber: false });
  const editFee = (index, value) => {
    const node = machines.querySelectorAll('tbody')[0].children[index].children[2].children[0];
    node.value = value; node.oninput();
  };
  return { ...fixture, cell, input, edit, editFee };
}
function payloadWith(row) {
  return { injection: [row], injection_loss_pct: 3, indo_pct: 10, material_prices: [],
    machine_prices: [{ model: '20A', normal: '200T', price: 2020 }, { model: '10A', normal: '120T', price: 1210 }] };
}

test('真实注塑表输入联动啤价、机台及同行金额，JSON重载保留手填价和工程字段', () => {
  const row = { mold_no: '01M', machine_model: '20A', machine: '旧机台', target: 2600, sets: 2,
    cavity: '8+8', side_action: '2', shot_price: .9, weight_g: 10, material_unit_price: .1,
    source_sheet_name: '工程源', mold_size: '200×300', note: '保留手填备注' };
  const payload = payloadWith(row), before = structuredClone(row);
  const ui = molding(payload);
  assert.equal(row.shot_price, .9); // Merely rendering never reprices historical/manual values.
  ui.edit('target', '1760');
  assert.equal(row.shot_price, .5739);
  assert.equal(ui.input('shot_price').value, '0.5739');
  assert.equal(ui.input('machine').value, '200T');
  assert.equal(ui.cell('finished_amt').textContent, '1.6039');
  assert.equal(ui.cell('indo_amt').textContent, '0.1604');
  ui.edit('sets', '1'); assert.equal(row.shot_price, 1.1477);
  ui.edit('cavity', '64'); assert.equal(row.shot_price, 1.1477);
  ui.edit('machine_model', '10A'); assert.equal(row.shot_price, .6875);
  assert.equal(ui.input('machine').value, '120T');
  ui.edit('shot_price', '0.42'); assert.equal(row.shot_price, .42);
  ui.editFee(0, '3000'); assert.equal(row.shot_price, .42); // Unrelated reference row cannot destroy a manual price.
  ui.editFee(1, '1408'); assert.equal(row.shot_price, .42);
  assert.equal(row.shot_price_mode, 'manual');
  ui.edit('sets', '1'); assert.equal(row.shot_price, .8);
  assert.equal(row.shot_price_mode, 'auto');
  assert.equal(ui.input('shot_price').value, '0.8');
  assert.equal(ui.cell('finished_amt').textContent, '1.8300');
  ui.edit('target', '0'); assert.equal(row.shot_price, null); assert.equal(ui.input('shot_price').value, '');
  ui.edit('target', '1760'); ui.edit('shot_price', '.3142');
  const saved = JSON.parse(JSON.stringify(payload));
  const reopened = molding(saved);
  assert.equal(saved.injection[0].shot_price, .3142);
  assert.equal(saved.injection[0].shot_price_mode, 'manual');
  assert.equal(reopened.input('shot_price').value, '0.3142');
  for (const key of ['mold_no', 'side_action', 'source_sheet_name', 'mold_size', 'note']) assert.equal(row[key], before[key]);
  assert.ok(ui.changes.length >= 10);
});

test('只读注塑表随可编辑参考表刷新；共模分摊不被普通公式覆盖', () => {
  const payload = payloadWith({ machine_model: '20A', target: 2000, sets: 1, shot_price: 1.01, shot_price_mode: 'auto' });
  const ui = molding(payload, true);
  assert.equal(ui.cell('shot_price').children.length, 0);
  ui.editFee(0, '3000');
  assert.equal(payload.injection[0].shot_price, 1.5);
  assert.equal(ui.cell('shot_price').textContent, '1.5000');
  assert.equal(ui.cell('finished_amt').textContent, '1.5000');
  const catalog = payloadWith({ catalog_raw_weight: 0, machine_model: '20A', target: 2000, sets: 1, shot_price: .12 });
  const catalogUi = molding(catalog);
  catalogUi.edit('target', '1000'); catalogUi.editFee(0, '4000');
  assert.equal(catalog.injection[0].shot_price, .12);
  assert.equal(catalogUi.input('shot_price').value, '0.12');
});

test('输入事件生成的啤价导出后公式和缓存与页面一致', async () => {
  const payload = payloadWith({ mold_no: '01M', machine_model: '20A', target: 2600, sets: 1, shot_price: .7769 });
  const ui = molding(payload);
  ui.edit('target', '1760'); ui.editFee(0, '1408');
  const saved = JSON.parse(JSON.stringify(payload));
  const reopened = molding(saved);
  assert.equal(saved.injection[0].shot_price_mode, 'auto');
  assert.equal(reopened.input('shot_price').value, '0.8');
  const { buildWorkbook } = require('../backend/services/exportInternal');
  for (const manual of [false, true]) {
    if (manual) reopened.edit('shot_price', '0.8'); // Same numeric value still explicitly means fixed/manual.
    const workbook = await buildWorkbook({ quote: { qty: 1000 }, sections: [{ dept: 'molding', payload_json: JSON.stringify(saved) }] });
    const loaded = new (require('exceljs').Workbook)();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
    for (const name of ['报价明细', '啤机明细']) {
      const sheet = loaded.getWorksheet(name); let first;
      sheet.eachRow(row => { if (row.getCell(1).value === '模号' && row.getCell(2).value === '模具名称') first = row.number + 1; });
      assert.ok(first);
      if (manual) {
        assert.equal(sheet.getCell(first, 9).value, .8);
        assert.match(sheet.getCell(first, 9).note, /固定值/);
      } else {
        assert.equal(sheet.getCell(first, 9).formula, `ROUND(1408/J${first}/L${first},4)`);
        assert.equal(sheet.getCell(first, 9).result, Number(reopened.input('shot_price').value));
      }
    }
  }
});

test('未标记历史价即使等于计算值，也不随参考费用变化；明确改本行参数才进入自动计算', () => {
  const row = { machine_model: '20A', target: 2000, sets: 1, shot_price: 1.01 };
  const payload = payloadWith(row), before = JSON.stringify(row);
  const ui = molding(payload);
  assert.equal(JSON.stringify(row), before);
  ui.editFee(0, '4000');
  assert.equal(row.shot_price, 1.01); assert.equal(row.shot_price_mode, undefined);
  ui.edit('target', '1000');
  assert.equal(row.shot_price, 4); assert.equal(row.shot_price_mode, 'auto');
  ui.editFee(0, '3000'); assert.equal(row.shot_price, 3);
});

test('工程2600与已存0.446差异明确提示；仅确认本行恢复后按目标2600计价，重开仍保留', async () => {
  const { expandEngineeringMolds } = require('../backend/services/engineeringMolds');
  const { parseWorkbook } = require('../backend/services/parseMoldSheet');
  const workbook = new (require('exceljs').Workbook)(); const sheet = workbook.addWorksheet('排模资料');
  sheet.addRow(['序号', '模具编号', '名称', '材料', '净重', '周期', '机型', '目标数', '啤工', '套数']);
  sheet.addRow([1, 'INDEX-260309-08', '爆米花桶', 'PP', 57, 30, '20A', 2600, .446, 1]);
  const parsed = parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(parsed.error, undefined); assert.equal(parsed.molds[0].target, 2600);
  assert.equal(parsed.molds[0].shot_price, .446, '源表啤工价与明确目标数必须保持独立');
  const references = expandEngineeringMolds(parsed.molds);
  assert.equal(references[0].target, 2600, '解析和拆分不把2600改成0.446');
  const row = { ...references[0], target: .446, shot_price: 4304.9327, shot_price_mode: 'auto', note: '原备注' };
  const payload = payloadWith(row); payload.machine_prices[0].price = 1920;
  const syncContext = vm.createContext({ window: { InjectionPricing: Pricing } });
  vm.runInContext(source.slice(source.indexOf('function engineeringMoldSyncKey('), source.indexOf('function engineeringImagesForInjection(')) +
    source.slice(source.indexOf('function syncInjectionMolds('), source.indexOf('// 啤机部料价表默认值')), syncContext);
  const synced = { machine_prices: payload.machine_prices, injection: [structuredClone(row)] };
  syncContext.syncInjectionMolds(synced, references);
  assert.equal(synced.injection[0].target, .446, '默认同步仍保留已存目标；不能批量猜改历史资料');
  const other = { ...row, mold_no: 'UNCHANGED', target: 3300, shot_price: 0, shot_price_mode: 'manual' };
  payload.injection.push(other); const otherBefore = structuredClone(other), before = structuredClone(row);
  const ui = molding(payload, false, references);
  assert.deepEqual(row, before, '打开表格只提示，不自动修复历史目标或价格');
  const buttons = ui.cell('target').querySelectorAll('button'); assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, '使用工程目标数（2600）');
  let confirmation;
  ui.context.confirm = text => { confirmation = text; return false; }; buttons[0].onclick();
  assert.deepEqual(row, before); assert.match(confirmation, /0.446 → 工程 2600/);
  ui.context.confirm = () => true; buttons[0].onclick();
  assert.equal(row.target, 2600); assert.equal(row.shot_price, .7385); assert.equal(row.shot_price_mode, 'auto');
  assert.equal(ui.input('target').value, '2600'); assert.equal(ui.input('shot_price').value, '0.7385');
  assert.equal(row.weight_g, 57); assert.equal(row.cycle_sec, 30); assert.equal(row.note, '原备注');
  assert.deepEqual(other, otherBefore, '不修改其他行的目标数、手填零价或来源');
  const reopenedPayload = JSON.parse(JSON.stringify(payload));
  const reopened = molding(reopenedPayload, false, references);
  assert.equal(reopened.input('target').value, '2600'); assert.equal(reopened.input('shot_price').value, '0.7385');
  assert.equal(reopened.cell('target').querySelectorAll('button').length, 0);
  const exported = await require('../backend/services/exportInternal').buildWorkbook({ quote: { qty: 1000 },
    sections: [{ dept: 'molding', payload_json: JSON.stringify(reopenedPayload) }] });
  const loaded = new (require('exceljs').Workbook)(); await loaded.xlsx.load(await exported.xlsx.writeBuffer());
  for (const name of ['报价明细', '啤机明细']) {
    const ws = loaded.getWorksheet(name); let first;
    ws.eachRow(r => { if (r.getCell(1).value === '模号' && r.getCell(2).value === '模具名称') first = r.number + 1; });
    assert.equal(ws.getCell(first, 12).value, 2600); assert.equal(ws.getCell(first, 9).result, .7385);
    assert.equal(ws.getCell(first, 9).formula, `ROUND(1920/J${first}/L${first},4)`);
  }
});

test('工程目标来源重复或源工作表不同则拒绝恢复；只读只提示，普通手改仍联动', () => {
  const row = { mold_no: 'SAME', name: '零件', product_group_id: 'A', product_group_name: '甲',
    source_sheet_name: '源表', source_sheet_index: 0, mold_part_index: 0, machine_model: '20A', target: .446, sets: 1, shot_price: 1 };
  const reference = { ...row, target: 2600 };
  for (const references of [[reference, { ...reference }], [{ ...reference, source_sheet_name: '其他源表' }]]) {
    const payload = payloadWith({ ...row }), before = structuredClone(payload);
    const ui = molding(payload, false, references);
    assert.equal(ui.cell('target').querySelectorAll('button').length, 0);
    assert.match(ui.cell('target').children[1].textContent, /工程来源不唯一或已变化/);
    assert.deepEqual(payload, before);
  }
  const readonly = molding(payloadWith({ ...row }), true, [reference]);
  assert.equal(readonly.cell('target').querySelectorAll('button').length, 0);
  assert.equal(readonly.input('target').readOnly, true);
  const stalePayload = payloadWith({ ...row }); const staleReference = { ...reference };
  const stale = molding(stalePayload, false, [staleReference]);
  stale.context.confirm = () => { staleReference.target = 3300; return true; };
  stale.cell('target').querySelectorAll('button')[0].onclick();
  assert.equal(stalePayload.injection[0].target, .446, '确认期间来源变动不得应用未确认的3300');
  const editablePayload = payloadWith({ ...row }); const ui = molding(editablePayload, false, [reference]);
  ui.edit('target', '3400'); assert.equal(editablePayload.injection[0].target, 3400);
  assert.equal(editablePayload.injection[0].shot_price, .5941, '正常目标输入使用本单2020费用，仍走原计价规则');
});

test('工程目标恢复使用完整独立字段，不以分隔符拼接、近似模号或缺失值猜来源', () => {
  const payload = payloadWith({ mold_no: 'M|N', name: 'P', target: .446, sets: 1, machine_model: '20A', shot_price: null });
  for (const references of [[{ mold_no: 'M', name: 'N|P', target: 2600 }], [{ mold_no: 'M|N-1', name: 'P', target: 2600 }],
    [{ mold_no: 'M|N', name: 'P', target: null }], [{ mold_no: 'M|N', name: 'P', target: 0 }],
    [{ mold_no: 'M|N', name: 'P', target: true }]]) {
    const before = structuredClone(payload), ui = molding(payload, false, references);
    assert.equal(ui.cell('target').querySelectorAll('button').length, 0); assert.deepEqual(payload, before);
  }
});

test('已由共模目录管理的分阶段行不提供工程目标恢复，直接调用也不修改任何参数', () => {
  const row = { mold_no: 'CATALOG-M', name: '分阶段零件', target: .446, sets: 1, machine_model: '20A',
    shot_price: .1234, shot_price_mode: 'auto', catalog_raw_weight: 0, catalog_part_id: 'OWNED-PART',
    technical: { stages: [{ target: 2800, cavity: 4 }, { target: 3300, cavity: 8 }] } };
  const payload = payloadWith(row), before = structuredClone(payload);
  const references = [{ mold_no: row.mold_no, name: row.name, target: 2600 }];
  const ui = molding(payload, false, references);
  assert.equal(ui.cell('target').querySelectorAll('button').length, 0);
  assert.equal(ui.context.applyEngineeringTargetForInjection(row, references, payload.machine_prices), false);
  assert.deepEqual(payload, before, '独立共模目标、完整阶段参数、价格和来源均不改');
});

test('真实供应商输入保留同名原标识，改名歧义恢复原归属，JSON重载可继续同步', () => {
  const row = { supplier_id: 'A', supplier_name: '同名厂', name: '吸塑', qty: 1, unit_price_rmb: .1 };
  const payload = { hardware: [row, { supplier_id: 'B', supplier_name: '同名厂' }],
    aux_materials: [{ supplier_id: 'C', supplier_name: '另一同名厂' }, { supplier_id: 'D', supplier_name: '另一同名厂' }], packaging_materials: [] };
  const { context, changes, alerts } = contextFor(payload);
  const start = source.indexOf('  const supplierColumn = {');
  vm.runInContext(source.slice(start, source.indexOf('  const freeCols = [', start)) + '\nglobalThis.supplierColumn = supplierColumn;', context);
  const td = new Element('td');
  context.supplierColumn.renderCell(td, row, { readonly: false, onChange: context.onChange });
  const input = td.children[0]; input.onfocus();
  input.value = '同名厂'; input.oninput(); assert.equal(row.supplier_id, 'A');
  input.value = '另一'; input.oninput();
  input.value = '另一同名厂'; input.oninput();
  assert.equal(row.supplier_id, 'A'); assert.equal(row.supplier_name, '同名厂');
  assert.match(input.validationMessage, /多个标识/);
  input.onchange(); assert.equal(input.value, '同名厂'); assert.equal(alerts.length, 1);
  const saved = JSON.parse(JSON.stringify(row));
  const plan = Supplier.plan({ supplier: { id: 'A', name: '同名厂' }, batches: [{ id: 'hardware', existing: [saved, payload.hardware[1]], items: [{ name: '吸塑', qty: 2, unit_price_rmb: .2 }] }] });
  assert.equal(plan.counts.updated, 1); assert.equal(plan.counts.added, 0);
  assert.equal(plan.batches[0].rows[0].qty, 2); assert.equal(plan.batches[0].rows[1].supplier_id, 'B');
  assert.equal(changes.length, 3);
  const readonly = new Element('td');
  context.supplierColumn.renderCell(readonly, row, { readonly: true });
  assert.equal(readonly.children.length, 0); assert.equal(readonly.textContent, '同名厂');
});
