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

test('mold import recognizes traditional Chinese HKD quotation headers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('26069飛碟-工模報價');
  sheet.addRow(['河源成興精密模具有限公司']);
  sheet.addRow(['26069飛碟-工模報價']);
  sheet.addRow([
    '模號', '圖片', '項目內容', '物料', '件*套', '',
    '工模尺寸(長*寬*厚)mm', '內模物料', '日產能(啤)/机台大小',
    '膠件重量(g)', '啤工', '模價(HKD)', '備註',
  ]);
  sheet.addRow(['M01', '', '飛碟底蓋', 'PC', 4, 2, '300*400*320', 'S136H加硬', 7, 9, 4000, 'HK$33,000', '潛水']);
  sheet.addRow(['M02', '', '飛碟大身', '透明PC', 1, 1, '450*450*500', 'S136H加硬', 18, 44, 2600, 'HK$68,000', '開放式熱流道2咀']);

  const result = parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));

  assert.equal(result.error, undefined);
  assert.equal(result.molds.length, 2);
  assert.deepEqual(result.molds.map(m => m.mold_no), ['M01', 'M02']);
  assert.equal(result.molds[0].name, '飛碟底蓋');
  assert.equal(result.molds[0].material, 'PC');
  assert.equal(result.molds[0].cavity, '4');
  assert.equal(result.molds[0].sets, 2);
  assert.equal(result.molds[0].weight_g, 9);
  assert.equal(result.molds[0].machine_model, '7A');
  assert.equal(result.molds[0].target, 4000);
  assert.equal(result.molds[0].price_rmb, null);
  assert.equal(result.molds[0].price_hkd, 33000);
  assert.equal(result.molds[0].detail.mold_size, '300*400*320');
  assert.equal(result.molds[0].detail.mold_material, 'S136H加硬');
  assert.equal(result.molds[0].note, '潛水');
});
