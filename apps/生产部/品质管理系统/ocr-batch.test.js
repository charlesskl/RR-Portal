'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const source = name => process.env.QMS_TEST_REF
  ? execFileSync('git', ['show', process.env.QMS_TEST_REF + ':apps/生产部/品质管理系统/' + name], { cwd: __dirname, encoding: 'utf8' })
  : fs.readFileSync(path.join(__dirname, name), 'utf8');
const server = source('server/server.js');
const parserStart = server.includes('function _parseGrounding(') ? 'function _parseGrounding(' : 'function parseDeliveryNote';
const parse = vm.runInNewContext(server.slice(server.indexOf(parserStart), server.indexOf('/* 调用视觉模型')) + ';parseDeliveryNote');
const plain = value => JSON.parse(JSON.stringify(value));

test('traditional split-header rows retain quantity even when the next cell is a numeric amount', () => {
  const fields = plain(parse('華登製品廠\nDATE: 2026.10.20\nDGHD.2673728\n| 貨 | 名 | 數量 | 金額 |\n| 玩具眼睛 | 100 | 250 |'));
  assert.equal(fields.supplier, '華登製品廠'); assert.equal(fields.date, '2026-10-20'); assert.equal(fields.deliveryNo, 'DGHD.2673728');
  assert.deepEqual(fields.items, [{ productNo: '', productName: '玩具眼睛', qty: '100', unit: '' }]);
});
test('traditional split-header shifted rows keep their unit and PO columns', () => {
  const fields = plain(parse('華登製品廠\n| 貨 | 名 | 數量 | 單位 | 訂單 |\n| 玩具眼睛 | 100 | 個 | PO-123456 |'));
  assert.equal(fields.items[0].qty, '100'); assert.equal(fields.items[0].unit, '個'); assert.equal(fields.orderNo, 'PO-123456');
});
test('traditional order labels never become delivery IDs and dotted delivery IDs are complete', () => {
  for (const label of ['訂單號', '訂 單 號', '订单号', '訂單編號']) {
    const fields = plain(parse('華登製品廠\n' + label + '：PO123456\n| 貨號 | 品名 | 數量 |\n| 15784 | 玩具 | 100 |'));
    assert.equal(fields.deliveryNo, ''); assert.equal(fields.orderNo, 'PO123456');
  }
  const fields = plain(parse('華登製品廠\n送貨單號：DGHD.2673728\n| 貨號 | 品名 | 數量 |\n| 15784 | 玩具 | 100 |'));
  assert.equal(fields.deliveryNo, 'DGHD.2673728');
  const both = plain(parse('華登製品廠\n訂單號：PO123456\n送貨單號：DGHD.2673728'));
  assert.equal(both.deliveryNo, 'DGHD.2673728'); assert.equal(both.orderNo, 'PO123456');
});
test('standalone delivery IDs do not replace a short supplier name', () => {
  const fields = plain(parse('DGHD.2673728\n華登\nDATE: 2026.10.20\n| 貨號 | 品名 | 數量 |\n| 15784 | 玩具 | 100 |'));
  assert.equal(fields.deliveryNo, 'DGHD.2673728'); assert.equal(fields.supplier, '華登');
});
test('simplified and aligned traditional documents keep their original mappings', () => {
  for (const fixture of [
    ['宏福制品厂\n日期：2026-10-20\n送货单号：DN-123456\n| 订单 | 货号 | 品名 | 数量 | 单位 |\n| PO-123456 | 15784 | 玩具 | 1,000 | 个 |', '宏福制品厂', '个'],
    ['華登製品廠\nDATE: 2026.10.20\nDGHD.2673728\n| 訂單 | 貨號 | 貨 | 名 | 數量 | 單位 |\n| PO-123456 | 15784 | 玩具 | | 1,000 | 個 |', '華登製品廠', '個'],
  ]) {
    const fields = plain(parse(fixture[0])); assert.equal(fields.supplier, fixture[1]); assert.equal(fields.date, '2026-10-20');
    assert.equal(fields.orderNo, 'PO-123456'); assert.deepEqual(fields.items, [{ productNo: '15784', productName: '玩具', qty: '1000', unit: fixture[2], orderNo: 'PO-123456' }]);
  }
});

function browser({ quota = false, backend = false } = {}) {
  const elements = new Map(), store = new Map(), messages = [], requests = [], listeners = [];
  const element = (id, value = '') => {
    const classes = new Set();
    const node = { value: String(value), dataset: {}, style: {}, textContent: '', innerHTML: '', focus() {},
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} } };
    let val = String(value); Object.defineProperty(node, 'value', { get: () => val, set: x => { val = String(x); } });
    elements.set(id, node); return node;
  };
  for (const id of ['f_date','f_inspDate','f_supplier','f_client','f_processType','f_productNo','f_productName','f_deliveryNo','f_orderNo','f_qty','f_sampleQty','f_pass','f_fail','f_defectRate','f_defect','f_qc','f_remark','f_type','f_result','f_aqlLevel','modalOverlay','modalTitle','btnSaveContinue','modalModeTabs',
    'ocrDate','ocrSupplier','ocrProductNo','ocrProductName','ocrDeliveryNo','ocrOrderNo','ocrQty','ocrType','ocrRemark']) element(id);
  const ctx = { console, setTimeout() {}, clearTimeout() {}, setInterval() {}, addEventListener() {}, removeEventListener() {}, navigator: {}, location: { pathname: '/qc/' },
    document: { readyState: 'complete', addEventListener: (event, handler) => { if (event === 'DOMContentLoaded') listeners.push(handler); }, getElementById: id => elements.get(id) || null, querySelectorAll: () => [], querySelector: () => null },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => { if (quota) throw new Error('QuotaExceededError'); store.set(key, value); }, removeItem: key => store.delete(key) },
    fetch: (url, options) => { if (options?.method === 'POST') requests.push({ url, body: JSON.parse(options.body) }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ready: false }) }); }, confirm: () => true,
    XMLHttpRequest: class { open() {} send() { this.status = 200; this.responseText = JSON.stringify({ records: [], nextId: 501, user: { username: 'fixture-admin', role: 'admin', enabled: true }, companies: ['dg-xingxin'], csrfToken: 'fixture-csrf' }); } },
    __QC_STORAGE_PREFIX: 'xingxin_qms_test_',
  };
  ctx.window = ctx; vm.createContext(ctx);
  if (backend) vm.runInContext(source('qc-backend.js'), ctx);
  const backendListeners = listeners.slice();
  vm.runInContext(source('app.js'), ctx);
  vm.runInContext(`state={records:[],nextId:501};currentPage='test';can=()=>true;_liveUser=()=>({name:'QC'});
    initDefectLib=()=>{};_checkUnknownDefects=()=>{};getSupplierOptions=()=>['Test Supplier'];getCustomerOptions=()=>[];getProcessTypeOptions=()=>[];
    renderSupplierDatalist=()=>{};renderCustomerDatalist=()=>{};renderProcessTypeDatalist=()=>{};renderInspectorDatalist=()=>{};
    renderReviewPage=()=>{};updateTopKpis=()=>{};bindNameWhitelistCheck=()=>{};refreshDefectDescDatalist=()=>{};switchModalMode=()=>{};
    _loadDefectRows=()=>{};_loadMeasRows=()=>{};onQtyChange=()=>{};onProductNoChange=()=>{};
    openAddModal=()=>{editingId=null;clearForm();setVal('f_date','2026-10-21');document.getElementById('modalOverlay').classList.add('show')};`, ctx);
  ctx.showToast = (message, type) => messages.push({ message, type });
  backendListeners.forEach(handler => handler());
  vm.runInContext(source('ai-ocr.js'), ctx);
  const run = code => vm.runInContext(code, ctx), json = code => JSON.parse(run('JSON.stringify(' + code + ')'));
  const start = () => { ctx.__qcAiResult = { common: { date: '2026-10-20', supplier: 'Test Supplier', deliveryNo: 'DN-123', orderNo: 'PO-123', type: '来料' }, items: [1,2,3].map(i => ({ productNo: 'P' + i, productName: 'Item ' + i, qty: i * 100 })) }; ctx.applyOcrToForm(); };
  return { ctx, elements, store, messages, requests, run, json, start, setQuota: value => { quota = value; } };
}
test('mixed continue and save buttons persist every queued item once and finish the queue', () => {
  const b = browser(); b.start(); b.ctx.saveRecord({ continueEntry: true });
  assert.equal(b.ctx.__qcQueue.idx, 1); assert.equal(b.elements.get('f_productNo').value, 'P2');
  b.ctx.saveRecord(); assert.equal(b.ctx.__qcQueue.idx, 2); assert.equal(b.elements.get('f_productNo').value, 'P3');
  b.ctx.saveRecord(); assert.equal(b.ctx.__qcQueue, null); assert.equal(b.elements.get('modalOverlay').classList.contains('show'), false);
  assert.deepEqual(b.json('state.records.map(r=>[r.productNo,r.qty,r.deliveryNo,r.orderNo,r.aqlLevel])'), [1,2,3].map(i => ['P'+i,i*100,'DN-123','PO-123','MAJ 1.0,MIN 2.5']));
});
test('the OCR queue saves each actual item PO and retains the document fallback for legacy items', () => {
  const b = browser();
  b.ctx.__qcAiResult = { common: { date: '2026-10-20', supplier: 'Test Supplier', orderNo: 'PO-DOCUMENT', type: '来料' },
    items: [{ productNo: 'P1', productName: 'Item 1', qty: 100, orderNo: 'PO-FIRST' },
      { productNo: 'P2', productName: 'Item 2', qty: 200, orderNo: 'PO-SECOND' },
      { productNo: 'P3', productName: 'Item 3', qty: 300 }] };
  b.ctx.applyOcrToForm();
  for (const expected of ['PO-FIRST', 'PO-SECOND', 'PO-DOCUMENT']) {
    assert.equal(b.elements.get('f_orderNo').value, expected);
    b.ctx.saveRecord();
  }
  assert.deepEqual(b.json('state.records.map(r=>[r.productNo,r.orderNo,r.status])'),
    [['P1','PO-FIRST','pending'],['P2','PO-SECOND','pending'],['P3','PO-DOCUMENT','pending']]);
});
test('blank OCR dates preserve the add-form default on every queued item and persist that date', () => {
  for (const date of ['', '   ', undefined]) {
    const b = browser();
    b.ctx.__qcAiResult = { common: { date, supplier: 'Test Supplier' },
      items: [{ productNo: '0254', productName: '', qty: '8760' }, { productNo: 'C031', productName: '', qty: '2400' }] };
    b.ctx.applyOcrToForm();
    for (let i = 0; i < 2; i++) {
      assert.equal(b.elements.get('f_date').value, '2026-10-21');
      assert.equal(b.ctx.saveRecord(), true);
    }
    assert.deepEqual(b.json('state.records.map(r=>[r.productNo,r.qty,r.date,r.status])'),
      [['0254',8760,'2026-10-21','pending'],['C031',2400,'2026-10-21','pending']]);
  }
});
test('a recognized OCR date keeps its exact day through queue saves', () => {
  const b = browser();
  b.ctx.__qcAiResult = { common: { date: '2026-10-19', supplier: 'Test Supplier' },
    items: [{ productNo: 'P1', productName: 'Item 1', qty: '100' }, { productNo: 'P2', productName: 'Item 2', qty: '200' }] };
  b.ctx.applyOcrToForm();
  for (let i = 0; i < 2; i++) {
    assert.equal(b.elements.get('f_date').value, '2026-10-19');
    assert.equal(b.ctx.saveRecord(), true);
  }
  assert.deepEqual(b.json('state.records.map(r=>r.date)'), ['2026-10-19','2026-10-19']);
});
test('fractional OCR quantities warn and cannot be truncated into a saved record or advance the queue', () => {
  for (const qty of ['8.760', '0.650', '1.234.567']) {
    const b = browser();
    b.ctx.__qcAiResult = { common: { date: '2026-10-20', supplier: 'Test Supplier' },
      items: [{ productNo: 'P1', productName: 'Item 1', qty, unit: 'KG' }, { productNo: 'P2', productName: 'Item 2', qty: '200' }] };
    b.ctx.applyOcrToForm();
    assert.equal(b.messages.at(-1).type, 'error');
    assert.match(b.messages.at(-1).message, /核对单位/);
    const before = b.store.get('xingxin_qms_test_records');
    assert.equal(b.ctx.saveRecord({ continueEntry: true }), false, qty);
    assert.deepEqual(b.json('state.records'), []);
    assert.equal(b.ctx.__qcQueue.idx, 0);
    assert.equal(b.store.get('xingxin_qms_test_records'), before);
    assert.equal(b.elements.get('f_productNo').value, 'P1');
    // Real number inputs clear invalid multi-dot text; that must not become qty=0.
    b.elements.get('f_qty').value = '';
    assert.equal(b.ctx.saveRecord(), false);
    assert.deepEqual(b.json('state.records'), []);
    b.elements.get('f_qty').value = '8760'; // user explicitly corrects/converts the count
    assert.equal(b.ctx.saveRecord(), true);
    assert.equal(b.ctx.__qcQueue.idx, 1);
    assert.deepEqual(b.json('state.records.map(r=>[r.productNo,r.qty,r.status])'), [['P1',8760,'pending']]);
    assert.equal(b.ctx.saveRecord(), true);
    assert.deepEqual(b.json('state.records.map(r=>r.qty)'), [8760,200]);
  }
});
test('single-item AI OCR retains the review requirement when a number input clears ambiguous raw text', () => {
  for (const qty of ['8.760', '1.234.567']) {
    const b = browser(); b.ctx.openAddModal();
    b.elements.get('ocrSupplier').value = 'Test Supplier';
    b.elements.get('ocrProductNo').value = '0254';
    b.elements.get('ocrQty').value = qty.includes('.', qty.indexOf('.') + 1) ? '' : qty;
    b.ctx.__qcAiResult = { common: { supplier: 'Test Supplier' }, items: [{ productNo: '0254', productName: '', qty }] };
    b.ctx.applyOcrToForm();
    assert.equal(b.messages.at(-1).type, 'error');
    assert.equal(b.ctx.saveRecord(), false);
    assert.deepEqual(b.json('state.records'), []);
    b.elements.get('f_qty').value = '1000';
    assert.equal(b.ctx.saveRecord(), true);
    assert.deepEqual(b.json('state.records.map(r=>[r.productNo,r.qty])'), [['0254',1000]]);
  }
});
test('integer, blank and zero OCR quantities keep their existing save behavior', () => {
  const b = browser();
  b.ctx.__qcAiResult = { common: { date: '2026-10-20', supplier: 'Test Supplier' },
    items: ['8760', '', '0', '8.000'].map((qty, i) => ({ productNo: 'P' + i, productName: 'Item ' + i, qty })) };
  b.ctx.applyOcrToForm();
  for (let i = 0; i < 4; i++) assert.equal(b.ctx.saveRecord(), true);
  assert.deepEqual(b.json('state.records.map(r=>r.qty)'), [8760,0,0,8]);
});
test('flagged uncertain queue quantities cannot turn a blank into saved zero or persist parser-only flags', () => {
  const b = browser();
  b.ctx.__qcAiResult = { common: { date: '2026-11-03', supplier: 'Test Supplier' }, items: [
    { productNo: '', productName: '待核对原行：1 PO100001 SKU001 合成零件 1000 20 1.50', qty: '', unit: '', quantityNeedsReview: true },
    { productNo: 'P2', productName: 'Item 2', qty: '100' },
  ] };
  b.ctx.applyOcrToForm();
  assert.equal(b.elements.get('f_qty').value, '');
  assert.equal(b.messages.at(-1).type, 'error');
  assert.equal(b.ctx.saveRecord(), false);
  assert.equal(b.ctx.__qcQueue.idx, 0);
  assert.deepEqual(b.json('state.records'), []);
  b.elements.get('f_qty').value = '1000';
  assert.equal(b.ctx.saveRecord(), true);
  const record = b.json('state.records[0]');
  assert.equal(record.qty, 1000);
  assert.equal(record.productNo, '');
  assert.equal('quantityNeedsReview' in record, false);
  assert.equal('rawLine' in record, false);
});
test('flagged single-item OCR clears a stale form quantity and blocks saving until explicit correction', () => {
  const b = browser(); b.ctx.openAddModal();
  b.elements.get('f_qty').value = '777';
  b.elements.get('ocrSupplier').value = 'Test Supplier';
  b.elements.get('ocrProductName').value = '待核对原行：1 PO100001 SKU001 合成零件 1000 20 1.50';
  b.ctx.__qcAiResult = { common: { supplier: 'Test Supplier' }, items: [
    { productNo: '', productName: b.elements.get('ocrProductName').value, qty: '', unit: '', quantityNeedsReview: true },
  ] };
  b.ctx.applyOcrToForm();
  assert.equal(b.elements.get('f_qty').value, '');
  assert.equal(b.ctx.saveRecord(), false);
  assert.deepEqual(b.json('state.records'), []);
  b.elements.get('f_qty').value = '1000';
  assert.equal(b.ctx.saveRecord(), true);
  assert.equal(b.json('state.records[0]').qty, 1000);
  assert.equal('quantityNeedsReview' in b.json('state.records[0]'), false);
});
test('a fresh uncertain recognition clears previous-image metadata through the actual start/apply path', async () => {
  const b = browser(); b.ctx.openAddModal();
  b.elements.set('ocrPreview', { src: '', style: {} });
  b.ctx.FileReader = class { readAsDataURL() { this.onload({ target: { result: 'data:image/png;base64,fixture' } }); } };
  b.ctx.Image = class {
    constructor() { this.width=100;this.height=200; }
    set src(value) { this.onload(); }
  };
  b.ctx.document.createElement = tag => {
    assert.equal(tag,'canvas');
    return {width:0,height:0,getContext:()=>({fillRect(){},translate(){},rotate(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,fixture'};
  };
  b.ctx.__QC_AUTH = { user: { username:'fixture-admin' } };
  b.ctx.handleOcrFile({type:'image/png',size:10});
  // Prefill stale values after actual upload/reset so recognition itself must
  // replace them. Do not bypass the product image state or decoder contract.
  for (const [id,value] of [['ocrDate','2026-10-01'],['ocrProductNo','PREVIOUS-SKU'],['ocrOrderNo','PREVIOUS-PO'],['ocrDeliveryNo','PREVIOUS-DN'],['ocrQty','777']]) b.elements.get(id).value = value;
  b.elements.get('f_productNo').value = 'STALE-FORM-SKU';
  b.elements.get('f_orderNo').value = 'STALE-FORM-PO';
  b.elements.get('f_qty').value = '777';
  const fields = { date:'', supplier:'Test Supplier', deliveryNo:'', orderNo:'', type:'来料', items:[
    { productNo:'', productName:'待核对原行：1 PO100001 SKU001 合成零件 1000 20 1.50', qty:'', unit:'', quantityNeedsReview:true },
  ] };
  b.ctx.__QC_REQUEST = async route => ({ok:true,status:200,json:async()=>route==='/api/ai/status'?{ready:true,ocrModel:'fixture-model'}:{ok:true,fields,rawText:'Synthetic raw transcript'}});
  await b.ctx.startOcr();
  for (const id of ['ocrDate','ocrProductNo','ocrOrderNo','ocrDeliveryNo','ocrQty']) assert.equal(b.elements.get(id).value,'',id);
  b.ctx.applyOcrToForm();
  for (const id of ['f_productNo','f_orderNo','f_qty']) assert.equal(b.elements.get(id).value,'',id);
  assert.equal(b.ctx.saveRecord(),false);
  assert.deepEqual(b.json('state.records'),[]);
  b.elements.get('f_qty').value='1000';
  assert.equal(b.ctx.saveRecord(),true);
  assert.equal(b.json('state.records[0]').productNo,'');
  assert.equal(b.json('state.records[0]').orderNo,'');
});
test('the real frontend writer never posts a truncated OCR quantity and posts the corrected count', async () => {
  const b = browser({ backend: true });
  b.ctx.__qcAiResult = { common: { date: '2026-10-20', supplier: 'Test Supplier' },
    items: [{ productNo: 'P1', productName: 'Item 1', qty: '8.760', unit: 'KG' }, { productNo: 'P2', productName: 'Item 2', qty: '200' }] };
  b.ctx.applyOcrToForm();
  assert.equal(b.ctx.saveRecord(), false);
  await b.ctx.__QC_SYNC_NOW();
  assert.ok(b.requests.every(request => request.body.records.length === 0));
  assert.deepEqual(b.json('state.records'), []);
  b.elements.get('f_qty').value = '8760';
  assert.equal(b.ctx.saveRecord(), true);
  await b.ctx.__QC_SYNC_NOW();
  assert.equal(b.requests.at(-1).body.records[0].qty, 8760);
  assert.equal(b.requests.at(-1).body.records[0].productNo, 'P1');
});
test('an OCR quantity edited into a noninteger is rejected without a partial save', () => {
  const b = browser(); b.start();
  b.elements.get('f_qty').value = '1e3';
  assert.equal(b.ctx.saveRecord(), false);
  b.elements.get('f_qty').value = '1.5';
  assert.equal(b.ctx.saveRecord(), false);
  assert.deepEqual(b.json('state.records'), []);
  assert.equal(b.ctx.__qcQueue.idx, 0);
  b.elements.get('f_qty').value = '1500';
  assert.equal(b.ctx.saveRecord(), true);
  assert.deepEqual(b.json('state.records.map(r=>r.qty)'), [1500]);
});
test('starting a manual record or opening an existing record clears only the OCR review marker', () => {
  const b = browser(); b.start();
  b.elements.get('f_qty').value = '1.5';
  assert.equal(b.ctx.saveRecord(), false);
  b.ctx.closeModalDirect(); b.ctx.openAddModal();
  assert.equal(b.elements.get('f_qty').dataset.ocrApplied, undefined);
  b.elements.get('f_supplier').value = 'Test Supplier';
  b.elements.get('f_productName').value = 'Manual';
  assert.equal(b.ctx.saveRecord(), true);
  assert.equal(b.json('state.records')[0].qty, 0);
  b.run("state.records.push({id:123,date:'2026-10-01',supplier:'Test Supplier',productName:'Original',qty:7})");
  b.ctx._markOcrQuantity('1.234.567');
  b.ctx.openEditModal(123);
  assert.equal(b.elements.get('f_qty').dataset.ocrApplied, undefined);
  assert.equal(b.ctx.saveRecord(), true);
  assert.equal(b.json('state.records.find(r=>r.id===123)').qty, 7);
});
test('validation and cancelled sample confirmation leave the current queued item available', () => {
  const b = browser(); b.start(); b.elements.get('f_supplier').value = 'Unlisted'; b.ctx.saveRecord({ continueEntry: true });
  assert.equal(b.ctx.__qcQueue.idx, 0); assert.equal(b.json('state.records').length, 0);
  b.elements.get('f_supplier').value = 'Test Supplier'; b.elements.get('f_sampleQty').value = '1'; b.elements.get('f_sampleQty').dataset.manualEdit = '1'; b.ctx.confirm = () => false;
  b.ctx.saveRecord({ continueEntry: true }); assert.equal(b.ctx.__qcQueue.idx, 0); assert.equal(b.json('state.records').length, 0);
});
test('manual close cancels queue and reapplying starts a fresh queue without wrapping twice', () => {
  const b = browser(); b.start(); b.ctx.closeModalDirect(); assert.equal(b.ctx.__qcQueue, null);
  b.start(); b.ctx.saveRecord({ continueEntry: true }); assert.equal(b.ctx.__qcQueue.idx, 1); assert.equal(b.json('state.records').length, 1);
});
test('failed localStorage write preserves the form and queue, and retry saves exactly once', () => {
  const b = browser({ quota: true }); b.start(); b.ctx.saveRecord({ continueEntry: true });
  assert.equal(b.json('state.records').length, 0); assert.equal(b.ctx.__qcQueue.idx, 0); assert.equal(b.elements.get('f_productNo').value, 'P1');
  assert.equal(b.json('state.nextId'), 501); assert.equal(b.messages.at(-1).type, 'error');
  b.setQuota(false); b.ctx.saveRecord({ continueEntry: true });
  assert.equal(b.json('state.records').length, 1); assert.equal(b.ctx.__qcQueue.idx, 1); assert.equal(b.elements.get('f_productNo').value, 'P2');
});
test('actual backend writer preserves the save result and posts both durable and memory-cached records', async () => {
  const b = browser({ backend: true }); b.start(); b.ctx.saveRecord({ continueEntry: true });
  assert.equal(b.ctx.__qcQueue.idx, 1); await b.ctx.__QC_SYNC_NOW();
  assert.equal(b.requests.length, 2); assert.equal(b.requests[0].body.records[0].productNo, 'P1');
  b.setQuota(true); b.ctx.saveRecord({ continueEntry: true }); await b.ctx.__QC_SYNC_NOW();
  assert.equal(b.ctx.__qcQueue.idx, 2); assert.equal(b.elements.get('f_productNo').value, 'P3');
  assert.equal(b.json('state.records').length, 2); assert.deepEqual(b.requests.at(-1).body.records.map(r=>r.productNo),['P1','P2']);
});
test('new AQL defaults do not rewrite an old record or its edit form fallback', () => {
  const b = browser(); b.run("state.records=[{id:1,date:'2026-10-01',supplier:'Test Supplier',aqlLevel:'MAJ 0.65'}]");
  b.ctx.openEditModal(1); assert.equal(b.elements.get('f_aqlLevel').value, 'MAJ 0.65');
  b.ctx.openAddModal(); assert.equal(b.elements.get('f_aqlLevel').value, 'MAJ 1.0,MIN 2.5'); assert.equal(b.json('state.records[0]').aqlLevel, 'MAJ 0.65');
  b.run('delete state.records[0].aqlLevel'); b.ctx.openEditModal(1); assert.equal(b.elements.get('f_aqlLevel').value, 'MAJ 0.65');
});
test('failed edit persistence also preserves the previous record and current edits for retry', () => {
  const b = browser(); b.run("state.records=[{id:1,date:'2026-10-01',supplier:'Test Supplier',productName:'Original'}]");
  b.ctx.openEditModal(1); b.elements.get('f_productName').value = 'Edited'; b.setQuota(true);
  assert.equal(b.ctx.saveRecord(), false); assert.equal(b.json('state.records[0]').productName, 'Original');
  assert.equal(b.elements.get('f_productName').value, 'Edited'); assert.equal(b.run('editingId'), 1);
  b.setQuota(false); assert.equal(b.ctx.saveRecord(), true); assert.equal(b.json('state.records[0]').productName, 'Edited');
});
