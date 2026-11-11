'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Execute the production parser and provider orchestration, not a mirrored parser.
// All input documents and responses are synthetic. No server/config/database or network.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const declarations = source.slice(source.indexOf('const OCR_READ_PROMPT ='), source.indexOf('/* ── 记录表列顺序'));
const plain = value => JSON.parse(JSON.stringify(value));
const packet = (content, finish = 'stop') => ({ choices: [{ finish_reason: finish, message: { content } }] });
function runtime(responses = []) {
  const calls = [], warnings = [], signals = [];
  const context = vm.createContext({
    AI: { ready: true, ocrModel: 'synthetic', baseURL: 'https://synthetic.invalid/v1', apiKey: 'synthetic-key' },
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    setTimeout: callback => callback(),
    AbortSignal,
    fetch: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      signals.push(request.signal);
      assert.ok(responses.length, 'unexpected provider request in isolated fixture');
      const next = responses.shift();
      if (next instanceof Error) throw next;
      const response = typeof next === 'string' ? { data: packet(next) } : next;
      return { status: response.status || 200, text: async () => response.raw ?? JSON.stringify(response.data) };
    },
  });
  vm.runInContext(declarations + ';globalThis.actual={parseDeliveryNote,aiVisionExtract};', context);
  return { parse: text => plain(context.actual.parseDeliveryNote(text)),
    extract: async () => plain(await context.actual.aiVisionExtract('data:image/png;base64,c3ludGhldGlj')),
    calls, warnings, signals };
}
const goods = '|货号|品名|数量|单位|\n|SKU-001|合成零件|100|PCS|';
const headers = '供应商：合成供应商有限公司\n日期：2026-11-06\n送货单号：DN-123456';

test('one supplementary response fills missing document headers without replacing original goods or raw source', async () => {
  const r = runtime([goods, headers + '\n|订单号|货号|品名|数量|单位|\n|PO-OTHER|OTHER|另一零件|999|PCS|']);
  const before = r.parse(goods), result = await r.extract();
  assert.equal(r.calls.length, 2);
  assert.ok(r.signals[0] instanceof AbortSignal, 'primary recognition has a cancellation deadline');
  assert.ok(r.signals[1] instanceof AbortSignal, 'optional recovery has a cancellation deadline');
  assert.deepEqual(result.fields.items, before.items);
  assert.equal(result.rawText, goods);
  assert.equal(result.fields.supplier, '合成供应商有限公司');
  assert.equal(result.fields.date, '2026-11-06');
  assert.equal(result.fields.deliveryNo, 'DN-123456');
  assert.equal(result.fields.orderNo, '', 'a supplemental row PO is not the original goods PO');
  assert.equal(result.needsManualReview, false);
});

test('supplementary headers preserve already recognized date and supplier', async () => {
  const original = '供应商：原供应商有限公司\n日期：2026-11-05\n' + goods;
  const r = runtime([original, headers]), result = await r.extract();
  assert.equal(r.calls.length, 2);
  assert.equal(result.fields.supplier, r.parse(original).supplier);
  assert.equal(result.fields.date, '2026-11-05');
  assert.equal(result.fields.deliveryNo, 'DN-123456');
  assert.equal(result.rawText, original);
});

test('a complete first response makes no supplementary request', async () => {
  const raw = headers + '\n' + goods, r = runtime([raw]), result = await r.extract();
  assert.equal(r.calls.length, 1);
  assert.deepEqual(result.fields, r.parse(raw));
});

test('supplementary text-part arrays follow the same header-only contract', async () => {
  const r = runtime([goods, { data: packet([{ type: 'text', text: headers }]) }]);
  const result = await r.extract();
  assert.equal(result.fields.deliveryNo, 'DN-123456');
  assert.deepEqual(result.fields.items, r.parse(goods).items);
});

for (const [label, response] of [
  ['network failure', new Error('private-provider-body-must-not-be-logged')],
  ['403 denial', { status: 403, raw: 'AccessDenied private-provider-body-must-not-be-logged' }],
  ['429 limit', { status: 429, raw: 'private-provider-body-must-not-be-logged' }],
  ['503 outage', { status: 503, raw: 'private-provider-body-must-not-be-logged' }],
  ['invalid JSON', { raw: 'private-provider-body-must-not-be-logged' }],
  ['empty choices', { data: { choices: [] } }],
  ['missing finish reason', { data: { choices: [{ message: { content: headers } }] } }],
  ['truncated header text', { data: packet(headers + '\n' + goods, 'length') }],
  ['upright grounding', { data: packet(JSON.stringify([{ rotate_rect: [0, 0, 10, 20, 0], text: headers + '\n' + goods }])) }],
  ['rotated grounding', { data: packet(JSON.stringify([{ rotate_rect: [0, 0, 10, 20, 90], text: headers }])) }],
]) {
  test('supplementary ' + label + ' retains the original successful goods without retry or disclosure', async () => {
    const r = runtime([goods, response]), result = await r.extract();
    assert.equal(r.calls.length, 2, 'one optional request is bounded even on denial');
    assert.deepEqual(result.fields, r.parse(goods));
    assert.equal(result.rawText, goods);
    assert.equal(result.needsManualReview, false);
    assert.ok(!r.warnings.join('\n').includes('private-provider-body-must-not-be-logged'));
  });
}

test('independent explicit headers do not reparse or replace ambiguous supplemental goods', async () => {
  const r = runtime([goods, headers + '\nDescription\n胶套外壳\n鸭子\nQty\n1,000\n2,000']);
  const result = await r.extract();
  assert.equal(r.calls.length, 2); assert.equal(result.fields.deliveryNo, 'DN-123456');
  assert.deepEqual(result.fields.items, r.parse(goods).items); assert.equal(result.needsManualReview, false);
});

test('conflicting explicit document headers stay empty instead of choosing one', async () => {
  const r = runtime([goods, headers + '\n供应商：第二供应商有限公司\n日期：2026-11-05\n送货单号：DN-654321']);
  const result = await r.extract();
  assert.deepEqual(result.fields, r.parse(goods));
});

test('invalid calendar dates and header labels inside goods rows do not supply missing identity', async () => {
  const r = runtime([goods, '日期：2026-02-30\n|货号|品名|数量|\n|SKU-002|合成零件|100|\n' + headers]);
  const result = await r.extract();
  assert.deepEqual(result.fields, r.parse(goods));
});

for (const boundary of ['<TABLE><TR><TH>货号</TH></TR></TABLE>', 'Description', 'Qty', '货名 数量']) {
  test('supplementary metadata after a table boundary is not a document header: ' + boundary, async () => {
    const r = runtime([goods, boundary + '\n' + headers]), result = await r.extract();
    assert.deepEqual(result.fields, r.parse(goods));
  });
}

test('manual original source does not trigger header recovery or acquire its identity', async () => {
  const raw = 'Description\n胶套外壳\n鸭子\nQty\n1,000\n2,000', r = runtime([raw]);
  const result = await r.extract();
  assert.equal(r.calls.length, 1); assert.equal(result.needsManualReview, true);
  assert.deepEqual(result.fields, r.parse(raw)); assert.equal(result.rawText, raw);
});

test('goods needing rotation do not acquire supplementary headers before rotation', async () => {
  const raw = JSON.stringify([{ rotate_rect: [0, 0, 10, 20, 90], text: goods }]), r = runtime([raw]);
  const result = await r.extract();
  assert.equal(r.calls.length, 1); assert.equal(result.needRotate, 90); assert.deepEqual(result.fields.items, []);
});

const table = rows => '|订单号|货号|品名|数量|单位|\n' + rows.map(row => '|' + row.join('|') + '|').join('\n');
test('same names and counts in distinct unnumbered POs remain independent rows', () => {
  const rows = [['PO-100001', 'SKU001', '同名零件', '100', 'PCS'],
    ['PO-100002', 'SKU001', '同名零件', '100', 'PCS'],
    ['兴信-100001', 'SKU001', '同名零件', '100', 'PCS'],
    ['ＰＯ－１００００２', 'SKU001', '同名零件', '100', 'PCS']];
  const items = runtime().parse(table(rows)).items;
  assert.equal(items.length, rows.length);
  assert.deepEqual(items.map(it => it.orderNo), rows.map(row => row[0]));
});

test('same names and counts with distinct actual SKUs are not a repeated model row', () => {
  const rows = [['PO-100001', 'SKU001', '同名零件', '100', 'PCS'], ['PO-100001', 'SKU002', '同名零件', '100', 'PCS']];
  const items = runtime().parse(table(rows)).items;
  assert.deepEqual(items.map(it => it.productNo), ['SKU001', 'SKU002']);
});

test('a numeric PO that equals a positioned delivered quantity remains the real PO', () => {
  const items = runtime().parse(table([['1000', 'SKU001', '合成零件', '1000', 'PCS']])).items;
  assert.equal(items.length, 1); assert.equal(items[0].orderNo, '1000'); assert.equal(items[0].qty, '1000');
});

test('a short SKU matching a unit token is not unconditionally discarded', () => {
  const items = runtime().parse(table([['PO-100001', 'PCS', '合成零件', '1000', 'PCS']])).items;
  assert.equal(items.length, 1); assert.equal(items[0].productNo, 'PCS'); assert.equal(items[0].qty, '1000');
});

test('anchored incomplete English, numeric and company-word product names remain reviewable', () => {
  const rows = ['WASHER', '504/504', '公司标牌', 'NOTEBOOK外壳'].map((name, i) => ['PO-100001', 'SKU00' + i, name, '', 'PCS']);
  const items = runtime().parse(table(rows)).items;
  assert.deepEqual(items.map(it => [it.productNo, it.productName, it.qty]), rows.map(row => [row[1], row[2], '']));
});

test('a fully repeated table heading is excluded without dropping ordinary adjacent goods', () => {
  const raw = '|订单号|货号|品名|数量|单位|\n|PO-100001|SKU001|合成甲|100|PCS|\n' +
    '|订单号|货号|品名|数量|单位|\n|PO-100002|SKU002|合成乙|200|PCS|';
  const items = runtime().parse(raw).items;
  assert.deepEqual(items.map(it => [it.orderNo, it.productNo, it.productName, it.qty]),
    [['PO-100001', 'SKU001', '合成甲', '100'], ['PO-100002', 'SKU002', '合成乙', '200']]);
});
