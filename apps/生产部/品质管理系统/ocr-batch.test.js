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
const parse = vm.runInNewContext(server.slice(server.indexOf('function parseDeliveryNote'), server.indexOf('/* 调用视觉模型')) + ';parseDeliveryNote');
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
    assert.equal(fields.orderNo, 'PO-123456'); assert.deepEqual(fields.items, [{ productNo: '15784', productName: '玩具', qty: '1000', unit: fixture[2] }]);
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
  for (const id of ['f_date','f_inspDate','f_supplier','f_client','f_processType','f_productNo','f_productName','f_deliveryNo','f_orderNo','f_qty','f_sampleQty','f_pass','f_fail','f_defectRate','f_defect','f_qc','f_remark','f_type','f_result','f_aqlLevel','modalOverlay','modalTitle','btnSaveContinue','modalModeTabs']) element(id);
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
test('actual backend writer preserves the save result and posts the successfully cached records', async () => {
  const b = browser({ backend: true }); b.start(); b.ctx.saveRecord({ continueEntry: true });
  assert.equal(b.ctx.__qcQueue.idx, 1); await b.ctx.__QC_SYNC_NOW();
  assert.equal(b.requests.length, 2); assert.equal(b.requests[0].body.records[0].productNo, 'P1');
  b.setQuota(true); b.ctx.saveRecord({ continueEntry: true }); await b.ctx.__QC_SYNC_NOW();
  assert.equal(b.ctx.__qcQueue.idx, 1); assert.equal(b.elements.get('f_productNo').value, 'P2');
  assert.equal(b.json('state.records').length, 1); assert.equal(b.requests.at(-1).body.records.length, 1);
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
