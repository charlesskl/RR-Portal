const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Excel = require('exceljs');
const { autoParse } = require('../parsers');
const { writeToExcel } = require('../excel-writer');
const { writeFullWorkbook } = require('../full-workbook');

const sample = `skycastletoys.com
No.: PO0000001
Status: Active
Created: Jan 01, 2026
Delivery date: Feb 02, 2026
Product / Service Customer Quantity Price Total
Sample product
SKU: SAMPLE-4
5 2.00 10.00
Rework Cost
1 3.00 3.00
Total units: 6
Total (USD): $13.00`;

test('新 PO 分开识别商品与服务费，拒绝合计不符', () => {
  const po = autoParse(sample, 'test.pdf');
  assert.equal(po.error, undefined);
  assert.equal(po.items.length, 1);
  assert.equal(po.items[0].partNo, 'SAMPLE-4');
  assert.equal(po.fees[0].amount, 3);
  assert.equal(po.shippingDate, '2026-02-02');
  assert.ok(autoParse(sample.replace('$13.00', '$10.00'), 'test.pdf').error);
});

test('按主档写入四代，确认后更新两个计划日期，仅变更处标黄，重导费用不重复', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sky-current-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const input = path.join(dir, 'input.xlsx');
  const output = path.join(dir, 'output.xlsx');
  const template = new Excel.Workbook();
  template.properties.date1904 = true;
  const master = template.addWorksheet('名称');
  master.addRow(['货号','系列','名称']);
  master.addRow(['SAMPLE-4','四代','样品']);
  const order = template.addWorksheet('总接单');
  for (const [index, label] of ['单价USD','金额USD','金额HKD'].entries()) order.getRow(1).getCell(20 + index).value = label;
  order.addRow(['接单期','出货期','CUSTOMER PO','PO号','货号','数量','包装版本','系列']);
  template.addWorksheet('三代排期');
  const sheet = template.addWorksheet('四代排期');
  sheet.addRow(['接单期','系列','客名','生产车间','国家','CUSTOMER PO','PO号','货号','产品名称','数量','贴纸用量','总贴纸用量','外箱','总箱数','计划出货期','计划验货期','备注','单价USD','金额USD','金额HKD']);
  const row = sheet.getRow(3);
  row.getCell(7).value = 'PO0000001';
  row.getCell(8).value = 'SAMPLE-4';
  row.getCell(10).value = 5;
  row.getCell(10).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFE0F0EE'}};
  row.getCell(15).value = new Date('2026-01-12T00:00:00Z');
  row.getCell(16).value = new Date('2026-01-31T00:00:00Z');
  row.getCell(15).font = {bold:true};
  row.getCell(21).value = {formula:'J3+1',result:6};
  await template.xlsx.writeFile(input);
  const orders = [autoParse(sample,'test.pdf')];
  const {wb,type} = await writeToExcel(input, orders);
  let confirmation;
  await assert.rejects(writeFullWorkbook(input,output,wb,type,orders), error => {
    confirmation = error.token;
    assert.deepEqual(error.changes.map(c=>c.slice(3)), [
      ['计划出货期','2026-01-12','2026-02-02'],
      ['计划验货期','2026-01-31','2026-02-02'],
    ]);
    return Boolean(confirmation);
  });
  await writeFullWorkbook(input,output,wb,type,orders,confirmation);
  const read = new Excel.Workbook();
  await read.xlsx.readFile(output);
  const updated = read.getWorksheet('四代排期').getRow(3);
  for (const col of [15,16]) {
    assert.equal(updated.getCell(col).value.toISOString().slice(0,10),'2026-02-02');
    assert.equal(updated.getCell(col).fill.fgColor.argb,'FFFFFF00');
  }
  assert.equal(updated.getCell(10).fill.fgColor.argb,'FFE0F0EE');
  assert.equal(updated.getCell(15).font.bold,true);
  assert.equal(updated.getCell(21).formula,'J3+1');
  assert.equal(read.getWorksheet('总接单').getCell('D3').fill.fgColor.argb,'FFFFFF00');
  const repeat = await writeToExcel(output,orders);
  const again = path.join(dir,'repeat.xlsx');
  await writeFullWorkbook(output,again,repeat.wb,type,orders);
  const replay = new Excel.Workbook();
  await replay.xlsx.readFile(again);
  assert.equal(replay.worksheets.length,read.worksheets.length);
  assert.equal(replay.getWorksheet('费用明细').rowCount,2);
  assert.equal(replay.getWorksheet('费用明细').getCell('E2').value,3);
});
