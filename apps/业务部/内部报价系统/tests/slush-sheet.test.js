'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parseSlushSheet');

test('slush import parses the costing card and ignores blank sheets', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('搪胶模板');
  workbook.addWorksheet('空白页');
  sheet.getCell('A1').value = '搪胶报价';
  sheet.getCell('A2').value = '料价：';
  sheet.getCell('B2').value = 6.2;
  sheet.getCell('A3').value = '24小时搪工：';
  sheet.getCell('B3').value = 900;
  sheet.getCell('A4').value = '12批工/烤工：';
  sheet.getCell('B4').value = 280;
  sheet.getCell('D2').value = '24小时柴油：';
  sheet.getCell('E2').value = 500;
  sheet.getCell('D3').value = '24小时电费：';
  sheet.getCell('E3').value = 150;
  sheet.getCell('D4').value = '色粉';
  sheet.getCell('E4').value = 16;
  sheet.getCell('D5').value = '24小时生产数:';
  sheet.getCell('E5').value = 2000;
  sheet.getCell('D6').value = '12小时批产量:';
  sheet.getCell('E6').value = 4000;
  sheet.getCell('D8').value = '模费:1000';
  sheet.getCell('D9').value = '料重：';
  sheet.getCell('E9').value = 240;
  sheet.getCell('A5').value = '料价';
  sheet.getCell('B5').value = { formula: 'E9*B2/454', result: 3.27753303964758 };
  sheet.getCell('A6').value = '搪工';
  sheet.getCell('B6').value = { formula: 'B3/E5', result: 0.45 };
  sheet.getCell('A7').value = '批工';
  sheet.getCell('B7').value = { formula: 'B4/E6', result: 0.07 };
  sheet.getCell('A8').value = '色粉';
  sheet.getCell('B8').value = { formula: 'E4/(25000/E9)', result: 0.1536 };
  sheet.getCell('A9').value = '柴油';
  sheet.getCell('B9').value = { formula: 'E2/E5', result: 0.25 };
  sheet.getCell('A10').value = '电费';
  sheet.getCell('B10').value = { formula: 'E3/E5', result: 0.075 };
  sheet.getCell('A11').value = '运费、胶袋';
  sheet.getCell('B11').value = 0.02;
  sheet.getCell('A12').value = '合计：';
  sheet.getCell('B12').value = { formula: 'SUM(B5:B11)', result: 4.29613303964758 };
  sheet.getCell('A13').value = '码点：';
  sheet.getCell('B13').value = 1.14;
  sheet.getCell('A14').value = '货价：';
  sheet.getCell('B14').value = { formula: 'B12*B13', result: 4.89759166519824 };

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.count, 1);
  assert.deepEqual(result.sheets_used, ['搪胶模板']);
  assert.equal(result.items[0].material_price_lb, 6.2);
  assert.equal(result.items[0].pigment_price, 16);
  assert.equal(result.items[0].pigment_cost, 0.1536);
  assert.equal(result.items[0].weight_g, 240);
  assert.equal(result.items[0].daily_output, 2000);
  assert.equal(result.items[0].mold_fee, 1000);
  assert.equal(result.items[0].markup_x, 1.14);
  assert.equal(result.items[0].unit_price_hkd, 4.89759166519824);
  assert.equal(result.items[0].qty, 1);
});

test('slush frontend wires template import, formula calculation, and image display', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'workbench.js'), 'utf8');
  assert.match(source, /fetch\('\/api\/uploads\/slush-sheet'/);
  assert.match(source, /function slushCosting\(row\)/);
  assert.match(source, /weight \* num\(row && row\.material_price_lb\) \/ 454/);
  assert.match(source, /renderImageCell\(td, row/);
  assert.doesNotMatch(source, /搪胶部门（占位）/);
});

test('slush upload route is registered and authorizes the slush department', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'uploads.js'), 'utf8');
  assert.match(source, /router\.post\('\/slush-sheet'/);
  assert.match(source, /\['slush', 'sales', 'engineering'\]/);
  assert.match(source, /parseSlushWorkbook/);
});
