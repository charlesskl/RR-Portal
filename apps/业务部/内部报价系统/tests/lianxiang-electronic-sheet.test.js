'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { parseWorkbook } = require('../backend/services/parseLianxiangElectronicSheet');

test('lianxiang import reads materials, quotation, OTP price and other fees', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(['东莞市虎门联翔塑胶电子厂']);
  sheet.addRow([]);
  sheet.addRow(['客户：', '华登制品发展有限公司', '', '编号:', '2024010412']);
  sheet.addRow(['报价日期:', '2026/7/4', '', '产品名称:', '203747021']);
  sheet.addRow(['报价金额 RMB：2.85/套（含芯片单价） OTP单价：0.88/片 SOP-8']);
  sheet.addRow([]);
  sheet.addRow(['项目', '名称', '规格', '用量', '备注']);
  sheet.addRow(['物料', '主板', '38*19*1.6MM单面板', 1, '']);
  sheet.addRow(['', 'IC', '语音IC SOP-8', 1, '']);
  sheet.addRow(['其它费用']);
  sheet.addRow(['序号', '名称', '数量', '单价（RMB)', '备注']);
  sheet.addRow([1, 'PCB模具费', 2, 1200, '共2400']);
  sheet.addRow(['备注']);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());

  assert.equal(result.error, undefined);
  assert.equal(result.source_format, 'lianxiang');
  assert.equal(result.count, 2);
  assert.equal(result.meta.customer, '华登制品发展有限公司');
  assert.equal(result.meta.quote_no, '2024010412');
  assert.equal(result.extras.quoted_price_rmb, 2.85);
  assert.equal(result.extras.otp_price_rmb, 0.88);
  assert.equal(result.extras.total_price_rmb, 3.73);
  assert.equal(result.extras.taxed_price, 3.73);
  assert.equal(result.extras.mold_fee_rmb, 2400);
  assert.equal(result.parts[1].unit_price, 0.88);
  assert.deepEqual(result.extras.other_fees[0], {
    name: 'PCB模具费', qty: 2, unit_price: 1200, amount: 2400, note: '共2400',
  });
});
