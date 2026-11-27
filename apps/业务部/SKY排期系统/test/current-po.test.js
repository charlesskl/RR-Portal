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
  assert.equal(replay.getWorksheet('费用明细'), undefined);
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
  assert.equal(read(buyer, 'Packaging: 2L, will apply importer label').items[0].customerPackaging, 'Jazwares客版（2L）');
  assert.match(read(buyer, 'Packaging: 2L\nUS PACKAGING').error, /核对包装版本/);
});

test('Jazwares 美文版支持带贴纸说明或美文稿件名称的 NOTES', () => {
  for (const note of ['*US Generic packaging, will apply importer label', 'Packaging Artwork: Sky Castle English artwork']) {
    const parse = (customer, notes) => autoParse(sampleWithNotes(customer, notes), 'sample.pdf');
    assert.equal(parse('Jazwares, LLC', note).items[0].customerPackaging, 'Jazwares客版（美文）');
    assert.equal(parse('Another Buyer', note).items[0].customerPackaging, undefined);
    assert.match(parse('Jazwares, LLC', note + '\nPackaging: 2L').error, /核对包装版本/);
  }
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

test('普通客户的三代美文版同步写入总接单与两处排期版本栏', async t => {
  const {writePasteWorkbook} = require('../paste-workbook');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sky-generic-version-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const template=new Excel.Workbook();
  const master=template.addWorksheet('名称');
  master.addRow(['货号','系列','名称']);
  master.addRow(['SAMPLE-4','三代','样品']);
  const order=template.addWorksheet('总接单');
  order.addRow([null,null,null,null,null,null,null,null,'单价USD','金额USD','金额HKD']);
  order.addRow(['接单期','出货期','CUSTOMER PO','PO号','货号','数量','包装版本','系列']);
  template.addWorksheet('四代排期');
  const schedule=template.addWorksheet('三代排期');
  schedule.addRow(['接单期','系列','客名','生产车间','国家','CUSTOMER PO','PO号','货号','产品名称','数量','贴纸用量','总贴纸用量','外箱','总箱数','计划出货期','计划验货期','备注','单价USD','金额USD','金额HKD']);
  schedule.getCell('AE2').value='做货版本';
  schedule.getCell('AG2').value='彩盒/CDU(版本）';
  const input=path.join(dir,'in.xlsx'), output=path.join(dir,'out.xlsx');
  await template.xlsx.writeFile(input);
  const po=autoParse(sampleWithNotes('Toysmith','(1) Packaging Version: Sky Castle Generic US PACKAGING'),'test.pdf');
  const {wb,orders}=await writeToExcel(input,[po]);
  await writePasteWorkbook(input,output,wb,orders);
  const result=new Excel.Workbook();
  await result.xlsx.readFile(output);
  for(const [sheet,addr] of [['总接单','G3'],['三代排期','AE3'],['三代排期','AG3']]) {
    assert.equal(result.getWorksheet(sheet).getCell(addr).value,'第三代美文版');
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
    sheet.getRow(3).height = 27;
    sheet.getRow(3).getCell(sc).font = {name:'宋体',size:9,color:{argb:'FFFF00FF'}};
    sheet.getRow(3).getCell(1).numFmt = 'yyyy/m/d"周"aaa';
    sheet.getRow(3).getCell(2).border = {bottom:{style:'thin'}};
    sheet.getRow(3).getCell(2).alignment = {horizontal:'center',wrapText:true};
    const row = delta.addWorksheet(name+'-粘贴用').addRow([]);
    row.getCell(1).value = 46000;
    row.getCell(1).numFmt = 'yyyy/mm/dd';
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
    assert.equal(sheet.getRow(3).height,27);
    assert.equal(sheet.getRow(3).getCell(sc).font.name,'宋体');
    assert.equal(sheet.getRow(3).getCell(sc).font.color.argb,'FFFF00FF');
    assert.equal(sheet.getCell('A3').numFmt,'yyyy/m/d"周"aaa');
    assert.equal(sheet.getCell('B3').border.bottom.style,'thin');
    assert.equal(sheet.getCell('B3').alignment.wrapText,true);
    assert.equal(sheet.getCell('B3').value,null);
    assert.equal(sheet.getRow(2).getCell(pc).value,'PO号');
    assert.equal(sheet.getRow(3).getCell(pc).value,'PO0000001');
    assert.equal(sheet.getRow(3).getCell(sc).fill.fgColor.argb,'FFFFFF00');
  }
});

test('订单返工费保留原备注，只记一次总额', () => {
  const po = autoParse(sample.replace('Rework Cost','Rework Cost (case pack 24 -> 12)')+'\nNOTES\nQty from TEST\nBILL TO','test.pdf');
  assert.equal(po.items[0].remark,'Qty from TEST；Rework Cost (case pack 24 -> 12):$3');
  assert.equal(po.items[0].amount,10);
});

test('带 zzOther 的贴纸服务按商品数量逐货号记单价，数量不符时提示核对', () => {
  const text = sample.slice(0,sample.indexOf('Sample product')) + `Sample A
SKU: TEST-A
840 0.88 739.20
Sample B
SKU: TEST-B
480 0.93 446.40
Other
importer label cost
SKU: zzOther
1,320 0.02 26.40
Total units: 2,640
Total (USD): $1,212.00`;
  const po = autoParse(text,'test.pdf');
  assert.equal(po.error,undefined);
  assert.deepEqual(po.items.map(x=>[x.partNo,x.quantity,x.amount,x.remark]),[
    ['TEST-A',840,739.20,'Importer Label Cost:$0.02一张'],
    ['TEST-B',480,446.40,'Importer Label Cost:$0.02一张'],
  ]);
  const partial = text.replace('1,320 0.02 26.40','840 0.02 16.80').replace('2,640','2,160').replace('1,212.00','1,202.40');
  assert.match(autoParse(partial,'test.pdf').error,/贴纸数量/);
});

test('旧预览中的 zzOther 贴纸费转换为货号备注，重复转换不重复收费', () => {
  const { normalizeServiceRows } = require('../parsers/sky-fees');
  const original = {items:[
    {partNo:'PART',quantity:12,amount:24,remark:'留样'},
    {partNo:'zzOther',description:'Other\nimporter label cost',quantity:12,unitPrice:0.03,amount:0.36},
  ]};
  const normalized = normalizeServiceRows(original);
  assert.equal(normalized.items.length,1);
  assert.equal(normalized.items[0].remark,'留样；Importer Label Cost:$0.03一张');
  assert.deepEqual(normalizeServiceRows(normalized),normalized);
  assert.equal(original.items.length,2);
});

test('从 NOTES 的 Package 字段识别美文版，进口贴纸说明不作为版本', () => {
  const parse = (customer, notes) => autoParse(sampleWithNotes(customer, notes), 'sample.pdf');
  const note = '* Package: Sky Castle US packaging (in English) + importer label';
  const general = parse('Sample buyer', note);
  assert.equal(general.packaging, 'Sky Castle US packaging');
  assert.equal(general.items[0].customerPackaging, undefined);
  assert.equal(parse('Jazwares, LLC', note).items[0].customerPackaging, 'Jazwares客版（美文）');
  assert.match(parse('Jazwares, LLC', note + '\nPackaging: 2L').error, /请核对包装版本/);
  assert.equal(parse('Sample buyer', '* Package: importer label').packaging, '');
  assert.equal(parse('Sample buyer', '* Package: Sky Castle US packaging (in French)').packaging, '');
});

test('Toysmith 大货与显式样品分别导出，缺主档列入待核对并保留原货号', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sky-samples-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const template=new Excel.Workbook();
  const master=template.addWorksheet('名称');
  master.addRow(['货号','系列','名称']);master.addRow(['KNOWN','四代','已建档产品']);
  const order=template.addWorksheet('总接单');
  order.getRow(1).getCell(10).value='单价USD';
  order.getRow(1).getCell(11).value='金额USD';
  order.getRow(1).getCell(12).value='金额HKD';
  order.addRow(['接单期','出货期','CUSTOMER PO','PO号','货号','数量','包装版本','系列']);
  const sheet=template.addWorksheet('四代排期');
  sheet.addRow(['接单期','系列','客名','生产车间','国家','CUSTOMER PO','PO号','货号','产品名称','数量','贴纸用量','总贴纸用量','外箱','总箱数','计划出货期','计划验货期','备注','单价USD','金额USD','金额HKD']);
  sheet.getRow(2).getCell(23).value='做货版本';
  const input=path.join(dir,'in.xlsx'), output=path.join(dir,'out.xlsx');
  await template.xlsx.writeFile(input);
  const pdfText=sample.replace('Product / Service','SHIP TO\nToysmith [TEST]\nUnited States\nProduct / Service')
    .replace(/Sample product[\s\S]*?Total \(USD\): \$13\.00/, [
      'Toysmith Item# 1','SKU: KNOWN','10 0 0','Toysmith Item# 1 (--- Sample)','SKU: KNOWN','2 0 0',
      'Toysmith Item# 2 (--- Sample)','SKU: UNLISTED','1 2.00 2.00','Total units: 13','Total (USD): $2.00',
    ].join('\n'));
  const po=autoParse(pdfText,'sample.pdf');
  assert.deepEqual(po.items.map(i=>!!i.isSample),[false,true,true]);
  const {wb,orders}=await writeToExcel(input,[po]);
  const {writePasteWorkbook}=require('../paste-workbook');
  await writePasteWorkbook(input,output,wb,orders);
  const read=new Excel.Workbook();await read.xlsx.readFile(output);
  assert.equal(read.getWorksheet('总接单').getCell('F3').value,10);
  assert.equal(read.getWorksheet('总接单（样品）').getCell('F3').value,2);
  assert.equal(read.getWorksheet('四代排期').getCell('Q4').value,'Sample');
  assert.equal(read.getWorksheet('待核对').getCell('H3').value,'UNLISTED');
  assert.equal(read.getWorksheet('待核对').getCell('B3').value,null);
  await assert.rejects(writePasteWorkbook(input,output,wb,[po,po]),/重复/);
});
