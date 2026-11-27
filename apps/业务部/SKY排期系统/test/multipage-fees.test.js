const test = require('node:test');
const assert = require('node:assert/strict');
const {parse} = require('../parsers/skycastle-current');
const {normalizeServiceRows, mergeFeeRemarks} = require('../parsers/sky-fees');

const header = 'Product / Service Customer Quantity Price Total';
const text = `No.: PO0000001-RR
Status: Active
Created: Jan 1, 2026
Delivery date: Jan 2, 2026
${header}
Product A
SKU: A1CDU-12
UPC# 123456789012
10 1.00 10.00
Page 1/2 PO0000001-RR
-- 1 of 2 --
${header}
Product B
SKU: B2
5 2.00 10.00
Other
customize collector manual - A1, B2
SKU: zzOther
2 3.00 6.00
Tape cost 1 2.00 2.00
UPC Label Charge (123456789012) 1 0.20 0.20
Total units: 19
Total (USD): $28.20`;

test('保留 RR 后缀及跨页商品，逐项核对费用备注', () => {
  const po = parse(text, 'sample.pdf');
  assert.equal(po.error, undefined);
  assert.equal(po.poNumber, 'PO0000001-RR');
  assert.deepEqual(po.items.map(i => i.quantity), [10, 5]);
  assert.deepEqual(po.items[0].feeRemarks, ['Customize Collector Manual:$3','Tape cost:$2','UPC Label Charge (123456789012):$0.2（$0.02一张）']);
  assert.deepEqual(po.items[1].feeRemarks, ['Customize Collector Manual:$3']);
  assert.deepEqual(normalizeServiceRows(po).items, po.items);
  for (const number of ['PO0000001', 'PO0000001-2']) assert.equal(parse(text.replaceAll('PO0000001-RR',number)).error, undefined);
});

test('跨页拆开的 SKU 仍可匹配，未知费用、错账、错误单号及停用单拒绝导出', () => {
  const split = text.replace('UPC#', 'Page 1/2 PO0000001-RR\n-- 1 of 2 --\n' + header + '\nUPC#');
  assert.equal(parse(split).items.length, 2);
  for (const [a,b] of [['Tape cost','Unknown fee'],['$28.20','$26.20'],['Active','Cancelled'],['No.: PO0000001-RR','No.: PO0000001-XXX']]) {
    assert.ok(parse(text.replace(a,b)).error);
  }
});

test('UPC 和说明书找不到唯一货号时给出核对提示', () => {
  assert.match(parse(text.replace('SKU: B2','SKU: B2\nUPC: 123456789012')).error,/UPC/);
  assert.match(parse(text.replace('Charge (123456789012)','Charge (223456789012)')).error,/UPC/);
  assert.match(parse(text.replace('A1, B2','A1, C3')).error,/说明书/);
  assert.match(parse(text.replace('A1, B2','A1, A1')).error,/数量/);
});

test('粘贴副本只替换本次已识别的费用，保留手写说明', () => {
  const known=['Importer Label Cost:$0.02一张','Tape cost:$2'];
  assert.equal(mergeFeeRemarks('外箱,保留，Importer label cost:$0.02一张,Tape cost:$2',known[0],known),
    '外箱,保留；Importer Label Cost:$0.02一张');
  assert.equal(mergeFeeRemarks('Tape cost:$20', '', known), 'Tape cost:$20');
});
