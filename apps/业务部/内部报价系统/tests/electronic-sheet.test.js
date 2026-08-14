'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parseElectronicSheet');

test('electronic import preserves an explicit zero quantity and amount', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('电子报价');
  sheet.addRow(['零件名称', '规格', '用量', '单价RMB', '合计RMB', '备注']);
  sheet.addRow(['辅料', '', 0, 0.0172044, { formula: 'C2*D2', result: 0 }, '']);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.parts[0].name, '辅料');
  assert.equal(result.parts[0].qty, 0);
  assert.equal(result.parts[0].unit_price, 0.0172044);
  assert.equal(result.parts[0].amount, 0);
  assert.equal(result.source_currency, 'RMB');
});

test('electronic import detects USD, preserves source values and validates totals', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('报价单 (USD)');
  sheet.addRow(['零件名称', '规格', '用量', '单价USD', '合计USD', '备注']);
  sheet.addRow(['IC', 'DICE', 1, 0, 0, '客供']);
  sheet.addRow(['PCB', '40*35', 1, 0.25, { formula: 'C3*D3', result: 0.25 }, '']);
  sheet.addRow(['', '', '', '零件成本:', 0.25, '']);
  sheet.addRow(['', '', '', '合计成本:', 0.25, '']);
  sheet.addRow(['', '含*12%利润价', '', '含利润价:', 0.28, 'USD不含税价']);
  sheet.addRow(['', '注：此报价按MOQ:5K数量报价', '', '', '', '']);
  sheet.addRow(['', 'PCB模费：USD354', '', '', '', '']);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.source_currency, 'USD');
  assert.equal(result.currency_detection.confidence, 'high');
  assert.equal(result.meta.moq, 5000);
  assert.equal(result.meta.tax_label, '不含税');
  assert.equal(result.parts[0].source_unit_price, 0);
  assert.equal(result.parts[1].source_unit_price, 0.25);
  assert.equal(result.extras.mold_fees[0].amount, 354);
  assert.equal(result.validation.ok, true);
});
