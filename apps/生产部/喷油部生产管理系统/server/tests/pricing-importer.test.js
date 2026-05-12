const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parsePricingSheet } = require('../services/pricing-importer');

test('解析核价表,按货号聚合产品+工序', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  assert.ok(products.length >= 1);
  const bluey = products.find(p => p.name.includes('布鲁伊'));
  assert.ok(bluey);
  assert.strictEqual(bluey.code, '73622');
  assert.ok(bluey.processes.length >= 1);
  const ear = bluey.processes.find(x => x.part_name === '耳朵');
  assert.strictEqual(ear.technique, '2印');
  assert.strictEqual(ear.unit_wage, 0.03);
});

test('跳过小计行(无工序名)', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  for (const p of products) {
    for (const proc of p.processes) {
      assert.ok(proc.part_name && proc.part_name.length > 0);
    }
  }
});

test('导入全部 5 个 sheet(不止 Sheet 1)', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const codes = products.map(p => p.code);
  assert.ok(codes.includes('73622'), '应含 73622');
  assert.ok(codes.includes('47101'), '应含 47101(收割机)');
  assert.ok(codes.includes('E73814'), '应含 E73814(泡泡壶)');
});

test('收割机:47101 货号独立列,多行不同货名,聚合为单产品', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const harvester = products.find(p => p.code === '47101');
  assert.ok(harvester);
  assert.ok(harvester.processes.length >= 10, '应有多道工序');
  const p1 = harvester.processes.find(x => x.part_name.includes('联合收割机右身'));
  assert.ok(p1);
  assert.strictEqual(p1.technique, '喷油');
});

test('泡泡壶:E73814 有独立「位置」列,part_name 取位置列', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const bubble = products.find(p => p.code === 'E73814');
  assert.ok(bubble);
  const proc = bubble.processes.find(x => x.part_name === '泡泡壶壶身');
  assert.ok(proc);
  assert.strictEqual(proc.technique, '移印');
});

test('跳过小计/合计行(part_name 为空 或 文字是「合计」)', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  for (const p of products) {
    for (const proc of p.processes) {
      assert.ok(proc.part_name, '工序应有 part_name');
      assert.ok(!/^合计$/.test(proc.part_name.trim()), '不应是合计行');
    }
  }
});

test('47367 拖车厢:货号列装的是零件描述,fallback 用 sheet 名「47367」', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const trailer = products.find(p => p.code === '47367');
  assert.ok(trailer, '应有 47367 一个产品(不是 13 个碎片)');
  assert.ok(trailer.processes.length >= 5, '应有多道工序');
  // 零件名应保留(例如「大农场」开头的某件)
  assert.ok(trailer.processes.some(p => p.part_name.includes('大农场')));
  // 不应存在以中文开头的伪 code 作为独立产品
  const junkCodes = products.filter(p => /^[^A-Za-z0-9]/.test(p.code));
  assert.strictEqual(junkCodes.length, 0, '不应有中文 code 的产品: ' + junkCodes.map(j => j.code).join(', '));
});

test('47101 收割机:产品名从 sheet 名取「收割机」,不是首行零件描述', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const harvester = products.find(p => p.code === '47101');
  assert.ok(harvester);
  assert.strictEqual(harvester.name, '收割机', `期望 '收割机',得到 '${harvester.name}'`);
});
