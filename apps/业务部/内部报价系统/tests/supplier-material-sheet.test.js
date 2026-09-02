'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { parseWorkbook } = require('../backend/services/parseHardwareSheet');

async function buildSupplierWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.getRow(13).values = [
    '序号', '产品编号&产品名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ];
  sheet.getRow(14).values = [1, '五金件A', '20×30mm', '镀锌', 'PCS', '1K', 10, 11.3, null, 'A备注', 15];
  sheet.getRow(15).values = [null, null, null, null, null, '3K', 8, 9.04];
  sheet.getRow(16).values = [null, null, null, null, null, '5K', 7, 7.91, 0.95];
  sheet.getRow(17).values = [null, null, null, null, null, '10K', 6, 6.78];
  sheet.getRow(18).values = [2, '包装件B', '彩盒', '过哑膜', 'PCS', '5K', null, null, 1.2, 'B备注', 20];
  sheet.getCell('A48').value = '📌 备注说明';
  return workbook.xlsx.writeBuffer();
}

test('unified supplier quote imports the 5K tier for hardware, auxiliary and packaging use', async () => {
  const result = await parseWorkbook(await buildSupplierWorkbook(), { targetQty: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.template_type, 'supplier_quote');
  assert.equal(result.target_qty, 5000);
  assert.equal(result.items.length, 2);

  assert.equal(result.items[0].name, '五金件A');
  assert.equal(result.items[0].unit_price_rmb, 7);
  assert.equal(result.items[0].price_type, 'RMB_UNTAXED');
  assert.equal(result.items[0].price_tiers.find(tier => tier.moq === '5K').unit_price_rmb_taxed, 7.91);
  assert.equal(result.items[0].price_tiers.find(tier => tier.moq === '5K').unit_price_usd, 0.95);
  assert.equal(result.items[0].moq, '5K');
  assert.equal(result.items[0].qty, 1);
  assert.match(result.items[0].spec, /20×30mm/);
  assert.match(result.items[0].spec, /镀锌/);
  assert.match(result.items[0].note, /交期：15天/);

  assert.equal(result.items[1].name, '包装件B');
  assert.equal(result.items[1].unit_price_rmb, null);
  assert.equal(result.items[1].unit_price_usd, 1.2);
  assert.equal(result.items[1].source_currency, 'USD');
  assert.equal(result.items[1].moq, '5K');
});

test('unified supplier quote can select MOQ and source currency independently', async () => {
  const usd5k = await parseWorkbook(await buildSupplierWorkbook(), { targetQty: 5000, targetCurrency: 'USD' });
  assert.equal(usd5k.items[0].moq, '5K');
  assert.equal(usd5k.items[0].source_currency, 'USD');
  assert.equal(usd5k.items[0].unit_price_usd, 0.95);
  assert.equal(usd5k.items[0].unit_price_rmb, null);

  const rmb3k = await parseWorkbook(await buildSupplierWorkbook(), { targetQty: 3000, targetCurrency: 'RMB' });
  assert.equal(rmb3k.items[0].moq, '3K');
  assert.equal(rmb3k.items[0].source_currency, 'RMB');
  assert.equal(rmb3k.items[0].unit_price_rmb, 8);
});

test('supplier import preview provides per-item MOQ and currency selectors', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /data-tier-index/);
  assert.match(source, /data-price-type-index/);
  assert.match(source, /人民币不含税/);
  assert.match(source, /人民币含税/);
  assert.match(source, /美金不含税/);
  assert.match(source, /可逐项选择识别到的 MOQ 与币种/);
});

test('numbered rows with the same product and spec merge into selectable MOQ tiers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.addRow([
    '序号', '产品编号&产品名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ]);
  sheet.addRow([1, 'ABS透明拉管料价', '14.3×22×0.06, 1C', '', '个', '5K', 3]);
  sheet.addRow([2, 'ABS透明拉管料价', '14.3×22×0.06, 1C', '', '个', '30K', 2]);
  sheet.addRow([3, 'ABS透明拉管料价', '14.3×22×0.06, 1C', '', '个', '50K', 1.5]);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 30000, targetCurrency: 'RMB' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].moq, '30K');
  assert.equal(result.items[0].unit_price_rmb, 2);
  assert.deepEqual(result.items[0].price_tiers.map(tier => tier.moq), ['5K', '30K', '50K']);
});

test('legacy hardware quotation header remains supported', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('旧五金报价');
  sheet.addRow(['零件名称', '规格', '用量', '单价RMB', '备注']);
  sheet.addRow(['螺丝', 'M3', 4, 0.2, '镀锌']);
  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    name: '螺丝', spec: 'M3', qty: 4, unit_price_rmb: 0.2, tax_pct: null, note: '镀锌',
  });
});
