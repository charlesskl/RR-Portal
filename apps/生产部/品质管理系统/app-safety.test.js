'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
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
