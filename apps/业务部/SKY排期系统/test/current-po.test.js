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
  const sheet = template.addWorksheet('四代排期');
  sheet.addRow(['归档','接单期','系列','客名','生产车间','国家','CUSTOMER PO','PO号','货号','产品名称','数量','贴纸用量','总贴纸用量','外箱','总箱数','计划出货期','计划验货期','备注','单价USD','金额USD','金额HKD']);
  const row = sheet.getRow(3);
  row.getCell(8).value = 'PO0000001';
  row.getCell(9).value = 'SAMPLE-4';
  row.getCell(11).value = 5;
  row.getCell(11).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFE0F0EE'}};
  row.getCell(12).value = 2;
  row.getCell(13).value = 10;
  row.getCell(14).value = 4;
  row.getCell(15).value = 2;
  row.getCell(16).value = new Date('2026-01-12T00:00:00Z');
  row.getCell(17).value = new Date('2026-01-31T00:00:00Z');
  row.getCell(16).font = {bold:true};
  row.getCell(22).value = {formula:'K3+1',result:6};
  await template.xlsx.writeFile(input);
  const orders = [autoParse(sample,'test.pdf')];
  const {wb,type} = await writeToExcel(input, orders);
  assert.equal(orders[0].isRevised, true);
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
  for (const col of [16,17]) {
    assert.equal(updated.getCell(col).value.toISOString().slice(0,10),'2026-02-02');
    assert.equal(updated.getCell(col).fill.fgColor.argb,'FFFFFF00');
  }
  assert.equal(updated.getCell(11).fill.fgColor.argb,'FFE0F0EE');
  assert.equal(updated.getCell(16).font.bold,true);
  assert.equal(updated.getCell(22).formula,'K3+1');
  assert.equal(read.getWorksheet('总接单').getCell('D3').fill.fgColor.argb,'FFFFFF00');
  Object.assign(orders[0].items[0], {quantity: 11, amount: 22});
  const repeat = await writeToExcel(output,orders);
  const again = path.join(dir,'repeat.xlsx');
  await writeFullWorkbook(output,again,repeat.wb,type,orders);
  const replay = new Excel.Workbook();
  await replay.xlsx.readFile(again);
  assert.equal(replay.worksheets.length,read.worksheets.length);
  assert.equal(replay.getWorksheet('费用明细').rowCount,2);
  assert.equal(replay.getWorksheet('费用明细').getCell('E2').value,3);
  const revised = replay.getWorksheet('四代排期').getRow(3);
  assert.equal(revised.getCell(13).value,22);
  assert.equal(revised.getCell(15).value,3);
  assert.equal(revised.getCell(15).fill.fgColor.argb,'FFFFFF00');
});

function sampleWithNotes(customer, notes) {
  return sample.replace('SKU: SAMPLE-4', 'SKU: SAMPLE-4\n' + customer) + '\nNOTES\n' + notes + '\nBILL TO';
}

test('按商品客户和 NOTES 区分 Jazwares 两种包装，不从收货地、文件名或数量推断', () => {
  const read = (customer, notes) => autoParse(sampleWithNotes(customer, notes), 'Jazwares_US.pdf');
  const buyer = 'Jazwares,\nLLC\n[TEST]';
  const note = '12pcs from REF01\nShip To: JAZWARES - WALMART CANADA (IMPORT)\n';
  assert.equal(read(buyer, '(1) US PACKAGING').items[0].customerPackaging, 'Jazwares客版（美文）');
  assert.equal(read(buyer, note + 'Packaging: 2L').items[0].customerPackaging, 'Jazwares客版（2L）');
  assert.equal(read('Another Buyer', note + 'Packaging: 2L').items[0].customerPackaging, undefined);
  assert.equal(read(buyer, note).items[0].customerPackaging, undefined);
  assert.match(read(buyer, 'Packaging: 2L\nUS PACKAGING').error, /核对包装版本/);
});

test('重新导入只更新匹配订单的三个包装版本栏，改动标黄', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sky-packaging-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const template = new Excel.Workbook();
  const master = template.addWorksheet('名称');
  master.addRow(['货号','系列','名称']);
  master.addRow(['SAMPLE-4','四代','样品']);
  const order = template.addWorksheet('总接单');
  order.getRow(1).getCell(12).value='单价USD';
  order.getRow(1).getCell(13).value='金额USD';
  order.getRow(1).getCell(14).value='金额HKD';
  order.addRow(['接单期','出货期','CUSTOMER PO','PO号','货号','数量','包装版本','系列']);
  const sched = template.addWorksheet('四代排期');
  sched.addRow(['接单期','系列','客名','生产车间','国家','CUSTOMER PO','PO号','货号','产品名称','数量','贴纸用量','总贴纸用量','外箱','总箱数','计划出货期','计划验货期','备注','单价USD','金额USD','金额HKD']);
  sched.getRow(2).getCell(24).value = '做货版本';
  sched.getRow(2).getCell(29).value = '彩盒/CDU(版本）';
  const input=path.join(dir,'template.xlsx');
  await template.xlsx.writeFile(input);
  async function apply(file, note, dest) {
    const po=autoParse(sampleWithNotes('Jazwares, LLC',note),'test.pdf');
    const {wb,type}=await writeToExcel(file,[po]);
    await writeFullWorkbook(file,dest,wb,type,[po]);
    const result=new Excel.Workbook();
    await result.xlsx.readFile(dest);
    return result;
  }
  let file=input;
  for (const [i,note,expected] of [[1,'US PACKAGING','美文'],[2,'Packaging: 2L','2L'],[3,'核对中','2L']]) {
    const dest=path.join(dir,i+'.xlsx');
    const result=await apply(file,note,dest);
    for (const [sheet,addr] of [['总接单','G3'],['四代排期','X3'],['四代排期','AC3']]) {
      const cell=result.getWorksheet(sheet).getCell(addr);
      assert.equal(cell.value,'Jazwares客版（'+expected+'）');
      assert.equal(cell.fill.fgColor.argb,'FFFFFF00');
    }
    file=dest;
  }
});

test('粘贴副本保留两行表头、列宽和合并区域，只输出本批 PO，原文件逐字节不变', async t => {
  const {writePasteWorkbook} = require('../paste-workbook');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'paste-test-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const file = path.join(dir,'original.xlsx'), output = path.join(dir,'copy.xlsx');
  const source = new Excel.Workbook(), delta = new Excel.Workbook();
  for (const [name,pc,sc] of [['总接单',4,5],['三代排期',7,8]]) {
    const sheet = source.addWorksheet(name);
    sheet.mergeCells('A1:B1');
    sheet.getCell('A1').value = '订单';
    sheet.getRow(2).getCell(pc).value = 'PO号';
    sheet.getColumn(sc).width = 26;
    sheet.getRow(3).getCell(pc).value = 'HISTORICAL';
    sheet.getRow(3).getCell(sc).value = 'OLD';
    const row = delta.addWorksheet(name+'-粘贴用').addRow([]);
    row.getCell(pc).value = 'PO0000001';
    row.getCell(sc).value = 'TEST';
  }
  source.addWorksheet('历史记录').getCell('A1').value='历史';
  await source.xlsx.writeFile(file);
  const before = await fs.readFile(file);
  await writePasteWorkbook(file,output,delta,[{client:'Sky Castle',poNumber:'PO0000001',items:[{partNo:'TEST'}]}]);
  assert.deepEqual(await fs.readFile(file), before);
  const copy = new Excel.Workbook();
  await copy.xlsx.readFile(output);
  assert.deepEqual(copy.worksheets.map(s=>s.name),['总接单','三代排期']);
  for (const [sheet,pc,sc] of [[copy.worksheets[0],4,5],[copy.worksheets[1],7,8]]) {
    assert.deepEqual(sheet.model.merges,['A1:B1']);
    assert.equal(sheet.getColumn(sc).width,26);
    assert.equal(sheet.rowCount,3);
    assert.equal(sheet.getRow(2).getCell(pc).value,'PO号');
    assert.equal(sheet.getRow(3).getCell(pc).value,'PO0000001');
    assert.equal(sheet.getRow(3).getCell(sc).fill.fgColor.argb,'FFFFFF00');
  }
});
