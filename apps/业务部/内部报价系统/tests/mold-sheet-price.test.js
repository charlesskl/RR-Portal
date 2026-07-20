'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parseMoldSheet');

test('mold import recognizes 金额（RMB） and 重量 columns', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('模具报价');
  sheet.addRow(['序号', '模具编号', '名称', '图片', '材料', '重量', '颜色', '件/套', '', '模具尺寸（cm)', '内模物料', '入水方式', '金额（RMB)', '备注']);
  sheet.addRow(['1', '20 307 3000/1', '后车胎*2/前小轮', '', 'TPR', '6.5', '黑色', '3出4-12件', '4', '30*40*32', 'S136H', '细水', '￥42,000', '共用模具']);

  const result = parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));

  assert.equal(result.error, undefined);
  assert.equal(result.molds.length, 1);
  assert.equal(result.molds[0].price_rmb, 42000);
  assert.equal(result.molds[0].weight_g, 6.5);
});
