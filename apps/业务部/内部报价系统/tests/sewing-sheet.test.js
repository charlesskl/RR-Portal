'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parseSewingSheet');

test('sewing import finds detail sheet and reads merged product groups under one header', async () => {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('总表');
  summary.addRow(['报价单', '货名', '不含税货价']);

  const detail = workbook.addWorksheet('明细');
  detail.addRow(['物料名称', '裁片部位', '供应商', '', '', '用量/码', '单价', '成本', '码点', '价钱', '备注']);
  detail.mergeCells('A2:K2');
  detail.getCell('A2').value = '产品甲';
  detail.addRow(['面料甲', '前身', '', '', '', 0.5, 10, 5, 1.1, 5.5, '']);
  detail.addRow(['胶件/包装由总部报价']);
  detail.addRow(['', '', '', '', '', '', '', '', '合计', 5.5, '']);
  detail.mergeCells('A6:K6');
  detail.getCell('A6').value = '产品乙';
  detail.addRow(['面料乙', '后身', '', '', '', 0.25, 12, 3, 1.1, 3.3, '']);
  detail.addRow(['', '', '', '', '', '', '', '', '合计', 3.3, '']);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.sheet_used, '明细');
  assert.equal(result.count, 2);
  assert.deepEqual(result.groups.map(group => group.name), ['产品甲', '产品乙']);
  assert.deepEqual(result.groups.map(group => group.items[0].material), ['面料甲', '面料乙']);
});
