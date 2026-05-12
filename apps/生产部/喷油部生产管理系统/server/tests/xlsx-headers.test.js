const test = require('node:test');
const assert = require('node:assert');
const { detectColumns } = require('../lib/xlsx-headers');

test('识别标准表头(6款狗仔):货号|货名|工序|...', () => {
  const header = ['货号', '货名', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, 0);
  assert.strictEqual(cols.name, 1);
  assert.strictEqual(cols.part_name, 2);
  assert.strictEqual(cols.target_qty, 3);
  assert.strictEqual(cols.worker_count, 4);
  assert.strictEqual(cols.unit_wage, 5);
  assert.strictEqual(cols.quote_price, 9);
});

test('识别含位置+工序分离列(E73814泡泡壶):图片|货号|位置|工序|...', () => {
  const header = ['图片', '货号', '位置', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, 1);
  assert.strictEqual(cols.part_name, 2);
  assert.strictEqual(cols.technique, 3);
  assert.strictEqual(cols.target_qty, 4);
});

test('识别无货号列(47600 货柜车):图片|位置|工序|...', () => {
  const header = ['图片', '位置', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, undefined);
  assert.strictEqual(cols.part_name, 1);
  assert.strictEqual(cols.technique, 2);
});

test('识别「工序」出现两次:第一次为 part_name,第二次为 technique', () => {
  const header = ['货号', '工序', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, 0);
  assert.strictEqual(cols.part_name, 1);
  assert.strictEqual(cols.technique, 2);
});
