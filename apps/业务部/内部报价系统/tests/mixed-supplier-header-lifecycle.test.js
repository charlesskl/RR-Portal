const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const MixedSku = require('../frontend/mixed-sku');
const MixedMolds = require('../frontend/mixed-molds');

const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
const supplierSource = source.slice(source.indexOf('function attachSupplierMaterialImportUI('), source.indexOf('\nfunction renderEngineering('));
const headerSource = source.slice(source.indexOf('function renderEngineeringQuoteHeader('), source.indexOf('\n// ==================== 跨部门汇总'));

function element(selector = '') {
  const nodes = new Map();
  return {
    innerHTML: '', _textContent: '', value: selector === '[data-supplier-kind]' ? 'packaging_materials' : '',
    get textContent() { return this._textContent; },
    set textContent(value) { this._textContent = value; this.innerHTML = value; },
    selectedOptions: [{ textContent: '包装材料' }], children: [], dataset: {},
    querySelector(key) { if (!nodes.has(key)) nodes.set(key, element(key)); return nodes.get(key); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    insertBefore(child) { this.children.push(child); this.upload = child; },
    setAttribute() {}, prepend() {}, append(...children) { this.children.push(...children); },
  };
}

function setup({ delayed = false, delayedJson = false, selected = 'a' } = {}) {
  const cfg = { enabled: true, mode: 'equal', units_per_pack: 6, products: [
    { id: 'a', code: 'A', name: '甲', ratio: 1 }, { id: 'b', code: 'B', name: '乙', ratio: 1 },
  ] };
  const quote = { id: 1, quote_no: '77957', product_name: '测试套装', customer: 'TEST', qty: 100 };
  const root = { mixed_products: { a: {}, b: {} }, mixed_shared: { packaging_materials: [{ name: '已有共有费用' }] } };
  const host = element(), header = element();
  let changes = 0, items = [];
  const requests = [];
  const response = (rows, request) => ({ ok: true, json: () => delayedJson && request
    ? new Promise(resolve => { request.resolveJson = () => resolve({ items: rows, sheet_used: '供应商报价表' }); request.notifyJson(); })
    : Promise.resolve({ items: rows, sheet_used: '供应商报价表' }) });
  const window = { MixedSku, MixedMolds, __data: { quote, mixed_quote: cfg, sections: [] } };
  const context = vm.createContext({
    window, document: { createElement: element }, sessionStorage: { getItem: () => selected, setItem() {} },
    FormData: class { append() {} },
    fetch: () => {
      const rows = items;
      return delayed ? new Promise((resolve, reject) => {
        const request = { resolve: () => resolve(response(rows, request)), reject };
        request.jsonStarted = new Promise(resolve => { request.notifyJson = resolve; });
        requests.push(request);
      }) : Promise.resolve(response(rows));
    },
    escapeHtml: value => String(value ?? ''), formatNum: String, freeUnitHkd: item => item.unit_price_rmb, confirm: () => true,
  });
  vm.runInContext(supplierSource + '\n' + headerSource, context);
  window.attachSupplierMaterialImportUI = context.attachSupplierMaterialImportUI;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/mixed-quotation.js'), 'utf8'), context);
  window.MixedQuotation.wrap(() => {}, 'engineering')(host, root, true, () => changes++, 1, 1, quote.qty, quote.customer);
  context.renderEngineeringQuoteHeader(header, quote, ['TEST'], async () => {});
  const upload = host.upload;
  return {
    root, quote, changes: () => changes,
    async saveHeader(code) {
      for (const [key, value] of [['#eng-h-no', code], ['#eng-h-pn', quote.product_name], ['#eng-h-ver', 'V1'], ['#eng-h-cu', 'TEST'], ['#eng-h-qty', '100']]) {
        header.querySelector(key).value = value;
      }
      await header.querySelector('#eng-h-save').onclick();
      assert.equal(header.querySelector('#eng-h-msg').textContent, '✓ 已保存');
    },
    choose(code) {
      items = [{ product_code: code, name: '共有包装', qty: 1, unit_price_rmb: .124 }];
      upload.querySelector('[data-supplier-file]').value = 'supplier.xlsx';
      return upload.querySelector('[data-supplier-file]').onchange({ target: { files: [{}] } });
    },
    resolve(index = requests.length - 1) { requests[index].resolve(); },
    resolveJson(index) { requests[index].resolveJson(); },
    jsonStarted(index) { return requests[index].jsonStarted; },
    reject(index, message) { requests[index].reject(new Error(message)); },
    changeKind(value) {
      const control = upload.querySelector('[data-supplier-kind]');
      control.value = value;
      control.selectedOptions = [{ textContent: value }];
      control.onchange();
    },
    action(mode) { return upload.querySelector('[data-supplier-preview]').querySelector(`[data-action="${mode}"]`).onclick; },
    apply(mode = 'replace') { upload.querySelector('[data-supplier-preview]').querySelector(`[data-action="${mode}"]`).onclick(); },
    preview: () => upload.querySelector('[data-supplier-preview]').innerHTML,
    inputValue: () => upload.querySelector('[data-supplier-file]').value,
  };
}

test('工程同页保存新总货号后，新文件按新总号归共有，旧总号不再匹配', async () => {
  const s = setup();
  await s.saveHeader('NEW-TOTAL');
  assert.equal(s.quote.quote_no, 'NEW-TOTAL');
  await s.choose('NEW-TOTAL');
  assert.doesNotMatch(s.preview(), /无法分配/);
  s.apply();
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'NEW-TOTAL');
  assert.equal(s.changes(), 1);

  await s.choose('77957');
  assert.match(s.preview(), /无法分配：77957（未找到）/);
  s.apply();
  assert.equal(s.changes(), 1);
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'NEW-TOTAL');
});

test('生成预览后保存新总货号，旧预览不可替换或追加费用', async () => {
  for (const mode of ['replace', 'append', 'update']) {
    const s = setup();
    await s.choose('77957');
    await s.saveHeader('NEW-TOTAL');
    s.apply(mode);
    assert.match(s.preview(), /总货号已变更，请重新选择文件/);
    assert.equal(s.inputValue(), '');
    assert.equal(s.changes(), 0);
    assert.equal(s.root.mixed_shared.packaging_materials[0].name, '已有共有费用');
  }
});

test('文件解析期间保存新总货号，不展示或应用旧归属预览', async () => {
  const s = setup({ delayed: true });
  const pending = s.choose('77957');
  await s.saveHeader('NEW-TOTAL');
  s.resolve();
  await pending;
  assert.match(s.preview(), /总货号已变更，请重新选择文件/);
  assert.doesNotMatch(s.preview(), /data-action/);
  assert.equal(s.inputValue(), '');
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials[0].name, '已有共有费用');
});

test('总货号全角或空白格式变化沿用相同归属', async () => {
  const s = setup();
  await s.choose('77957');
  await s.saveHeader(' ７７９５７ ');
  s.apply();
  assert.equal(s.changes(), 1);
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, '77957');
});

test('连续选择文件时，较晚返回的旧文件不可覆盖新预览或写入共有费用', async () => {
  const s = setup({ delayed: true, selected: '__shared__' });
  const old = s.choose('OLD-FILE'), latest = s.choose('LATEST-FILE');
  s.resolve(1); await latest;
  assert.match(s.preview(), /LATEST-FILE/);
  s.resolve(0); await old;
  assert.match(s.preview(), /LATEST-FILE/);
  assert.doesNotMatch(s.preview(), /OLD-FILE/);
  s.apply();
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'LATEST-FILE');
  assert.equal(s.changes(), 1);
});

test('切换导入类别后，旧回包和旧预览按钮不可影响当前类别', async () => {
  const s = setup({ delayed: true, selected: '__shared__' });
  const ready = s.choose('OLD-READY'); s.resolve(0); await ready;
  const oldApply = s.action('append');
  const oldPending = s.choose('OLD-PENDING');
  s.changeKind('hardware');
  const latest = s.choose('NEW-HARDWARE');
  oldApply();
  assert.equal(s.changes(), 0);
  s.resolve(1); await oldPending;
  assert.doesNotMatch(s.preview(), /OLD-PENDING/);
  s.resolve(2); await latest;
  s.apply();
  assert.equal(s.root.mixed_shared.hardware[0].product_code, 'NEW-HARDWARE');
  assert.equal(s.root.mixed_shared.packaging_materials[0].name, '已有共有费用');
  assert.equal(s.changes(), 1);
});

test('只切换导入类别也会使已生成预览的旧应用按钮失效', async () => {
  const s = setup({ selected: '__shared__' });
  await s.choose('OLD-PACKAGING');
  const oldApply = s.action('replace');
  s.changeKind('hardware');
  oldApply();
  assert.equal(s.preview(), '');
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials[0].name, '已有共有费用');
  assert.equal(s.root.mixed_shared.hardware, undefined);
});

test('选新文件后旧应用和取消按钮失效，不能写入旧文件或取消新请求', async () => {
  const s = setup({ delayed: true, selected: '__shared__' });
  const first = s.choose('OLD-FILE'); s.resolve(0); await first;
  const oldApply = s.action('replace'), oldCancel = s.action('cancel');
  const latest = s.choose('LATEST-FILE');
  oldApply(); oldCancel();
  assert.equal(s.changes(), 0);
  s.resolve(1); await latest;
  assert.match(s.preview(), /LATEST-FILE/);
  s.apply();
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'LATEST-FILE');
});

test('取消当前预览后，旧回包和已取消的应用按钮均失效', async () => {
  const s = setup({ delayed: true, selected: '__shared__' });
  const old = s.choose('OLD-PENDING'), latest = s.choose('CANCELED-FILE');
  s.resolve(1); await latest;
  const canceledApply = s.action('append');
  s.action('cancel')();
  s.resolve(0); await old;
  canceledApply();
  assert.equal(s.preview(), '');
  assert.equal(s.inputValue(), '');
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials[0].name, '已有共有费用');
  const next = s.choose('NEXT-FILE'); s.resolve(2); await next; s.apply();
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'NEXT-FILE');
});

test('旧请求失败时，不覆盖新文件的有效预览', async () => {
  const s = setup({ delayed: true, selected: '__shared__' });
  const old = s.choose('OLD-ERROR'), latest = s.choose('LATEST-FILE');
  s.resolve(1); await latest;
  s.reject(0, '旧文件解析失败'); await old;
  assert.match(s.preview(), /LATEST-FILE/);
  assert.doesNotMatch(s.preview(), /旧文件解析失败/);
  s.apply();
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'LATEST-FILE');
});

test('旧响应的JSON正文晚返回时，不覆盖新预览', async () => {
  const s = setup({ delayed: true, delayedJson: true, selected: '__shared__' });
  const old = s.choose('OLD-JSON');
  s.resolve(0); await s.jsonStarted(0);
  const latest = s.choose('LATEST-FILE');
  s.resolve(1); await s.jsonStarted(1);
  s.resolveJson(1); await latest;
  s.resolveJson(0); await old;
  assert.match(s.preview(), /LATEST-FILE/);
  assert.doesNotMatch(s.preview(), /OLD-JSON/);
  s.apply();
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, 'LATEST-FILE');
});

test('当前请求失败仍提示解析错误，并保留已有共有费用', async () => {
  const s = setup({ delayed: true, selected: '__shared__' });
  const current = s.choose('ERROR');
  s.reject(0, '当前文件损坏'); await current;
  assert.match(s.preview(), /解析失败：当前文件损坏/);
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials[0].name, '已有共有费用');
});
