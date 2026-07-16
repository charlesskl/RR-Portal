'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const aiOcrSource = fs.readFileSync(path.join(__dirname, 'ai-ocr.js'), 'utf8');
const reportSource = fs.readFileSync(path.join(__dirname, 'report_export.js'), 'utf8');
const mobileCss = fs.readFileSync(path.join(__dirname, 'mobile.css'), 'utf8');

function loadFunction(source, name, context = {}) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return vm.runInNewContext(`(${source.slice(start, index + 1)})`, context);
  }
  throw new Error(`Could not parse ${name}`);
}

test('record snapshot comparison detects data that refresh would overwrite', () => {
  const snapshotsDiffer = loadFunction(appSource, '_recordsSnapshotsDiffer');
  assert.equal(snapshotsDiffer([{ id: 1, value: 'same' }], [{ id: 1, value: 'same' }]), false);
  assert.equal(snapshotsDiffer([{ id: 1, value: 'local' }], [{ id: 1, value: 'server' }]), true);
  assert.equal(snapshotsDiffer([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
});

test('records page trims search text like the server export filter', () => {
  assert.match(appSource, /searchInput'\)\?\.value\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)/);
});

test('OCR keeps an order number out of the delivery number field', () => {
  const values = {};
  const extractFieldsFromOcrText = loadFunction(appSource, 'extractFieldsFromOcrText', {
    _OCR_CUTOFF_KEYWORDS: [],
    findDateNearKeyword: () => '',
    cutAtKeywords: value => value,
    cleanOcrValue: value => String(value || '').replace(/^[：:\s]+/, '').trim(),
    cleanCompanyName: value => value,
    extractCompanyFromTopLines: () => '',
    normalizeOcrNumber: () => '',
    isPhoneNumberLike: () => false,
    extractFirstItemLine: () => null,
    setVal: (id, value) => { values[id] = value; },
  });

  extractFieldsFromOcrText('订单号：PO123456');

  assert.equal(values.ocrOrderNo, 'PO123456');
  assert.equal(values.ocrDeliveryNo, undefined);
});

test('AI OCR carries the PO number through single and queued entry', () => {
  const previewValues = {};
  const aiWindow = {};
  const applyFields = loadFunction(aiOcrSource, 'applyFields', {
    setV: (id, value) => { previewValues[id] = value; },
    document: { getElementById: () => null },
    window: aiWindow,
  });

  applyFields({
    orderNo: 'PO-AI-001',
    items: [{ productNo: '15784', productName: '测试款', qty: 100 }],
  });

  assert.equal(previewValues.ocrOrderNo, 'PO-AI-001');
  assert.equal(aiWindow.__qcAiResult.common.orderNo, 'PO-AI-001');

  const formValues = {};
  const loadQueueItem = loadFunction(aiOcrSource, 'loadQueueItem', {
    setV: (id, value) => { formValues[id] = value; },
    setT: () => {},
    window: {
      openAddModal: () => {},
      onQtyChange: () => {},
      onProductNoChange: () => {},
    },
  });

  loadQueueItem({
    idx: 0,
    common: { orderNo: 'PO-AI-002' },
    items: [{ productNo: '15785', productName: '队列款', qty: 200 }],
  });

  assert.equal(formValues.f_orderNo, 'PO-AI-002');
});

test('clearing OCR also clears the PO number', () => {
  const cleared = [];
  const clearOcr = loadFunction(appSource, 'clearOcr', {
    _ocrImageFile: null,
    document: {
      getElementById: id => id === 'ocrPreview' ? { src: 'data:image/png', style: {} } : { value: 'set' },
      querySelector: () => ({ style: {} }),
    },
    setVal: (id, value) => { if (value === '') cleared.push(id); },
    setText: () => {},
  });

  clearOcr();

  assert.ok(cleared.includes('ocrOrderNo'));
});

test('import mapping keeps customer order numbers separate from delivery numbers', () => {
  const autoMapColumns = loadFunction(appSource, '_buildFieldMap', { FIELD_MAP: {} });

  assert.equal(autoMapColumns(['客户订单号'])['客户订单号'], 'orderNo');
  assert.equal(autoMapColumns(['供应商送货单号'])['供应商送货单号'], 'deliveryNo');
});

test('IQC report renders the PO label and value', () => {
  const aqlRow = {
    range: '1-50', sample: 20, cr: 0, maj065: 0, maj10: 1,
    min25: 1, func_sample: 20, m065: 0,
  };
  const buildIQCCanvas = loadFunction(reportSource, '_buildIQCCanvas', {
    document: { createElement: () => ({ id: '', innerHTML: '' }) },
    _todayStr: () => '2026-07-16',
    _iqcGetRow: () => aqlRow,
    IQC_AQL_TABLE: [aqlRow],
  });

  const canvas = buildIQCCanvas({
    id: 1,
    date: '2026-07-16',
    supplier: '测试供应商',
    productNo: '15784',
    productName: '测试款',
    deliveryNo: 'DN-001',
    orderNo: 'PO-IQC-001',
    qty: 100,
    sampleQty: 20,
    pass: 20,
    fail: 0,
    result: 'PASS',
  });

  assert.match(canvas.innerHTML, /PO&ensp;号/);
  assert.match(canvas.innerHTML, /PO-IQC-001/);
});

test('basic record entry does not grant defect-library management', () => {
  const checkedActions = [];
  const context = {
    can: action => { checkedActions.push(action); return false; },
    showToast: () => {},
    document: { getElementById: () => { throw new Error('permission guard was bypassed'); } },
    _getDefectLib: () => { throw new Error('permission guard was bypassed'); },
  };

  for (const name of ['_openDefLibModal', '_saveDefLibItem', '_toggleDefLibItem']) {
    const fn = loadFunction(appSource, name, context);
    assert.doesNotThrow(() => fn(0));
  }

  assert.deepEqual(checkedActions, ['manageDefectLib', 'manageDefectLib', 'manageDefectLib']);
  assert.match(appSource, /manager:\s*{[^}]*manageDefectLib:true/s);
  assert.match(appSource, /viewer:\s*{[^}]*manageDefectLib:false/s);
  assert.match(appSource, /const canAdd = can\('manageDefectLib'\)/);
});

test('mobile modal controls keep a 16px font to avoid iOS focus zoom', () => {
  assert.match(mobileCss, /html\.qc-mobile \.modal textarea\s*\{[^}]*font-size:\s*16px\s*!important/s);
  assert.match(mobileCss, /html\.qc-narrow \.modal textarea\s*\{[^}]*font-size:\s*16px\s*!important/s);
});
