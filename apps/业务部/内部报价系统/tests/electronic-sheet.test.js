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
});
