const test = require('node:test');
const assert = require('node:assert/strict');
const {parse} = require('../parsers/skycastle-current');
const {normalizeServiceRows, mergeFeeRemarks} = require('../parsers/sky-fees');

const header = 'Product / Service Customer Quantity Price Total';
const text = `No.: PO0000001-RR
Status: Active
Created: Jan 1, 2026
Delivery date: Jan 2, 2026
${header}
Product A
SKU: A1CDU-12
UPC# 123456789012
10 1.00 10.00
Page 1/2 PO0000001-RR
-- 1 of 2 --
${header}
Product B
SKU: B2
5 2.00 10.00
Other
customize collector manual - A1, B2
SKU: zzOther
2 3.00 6.00
Tape cost 1 2.00 2.00
UPC Label Charge (123456789012) 1 0.20 0.20
Total units: 19
Total (USD): $28.20`;

test('保留 RR 后缀及跨页商品，逐项核对费用备注', () => {
  const po = parse(text, 'sample.pdf');
  assert.equal(po.error, undefined);
  assert.equal(po.poNumber, 'PO0000001-RR');
  assert.deepEqual(po.items.map(i => i.quantity), [10, 5]);
  assert.deepEqual(po.items[0].feeRemarks, ['Customize Collector Manual:$3','Tape cost:$2','UPC Label Charge (123456789012):$0.2（$0.02一张）']);
  assert.deepEqual(po.items[1].feeRemarks, ['Customize Collector Manual:$3']);
  assert.deepEqual(normalizeServiceRows(po).items, po.items);
  for (const number of ['PO0000001', 'PO0000001-2']) assert.equal(parse(text.replaceAll('PO0000001-RR',number)).error, undefined);
});

test('跨页拆开的 SKU 仍可匹配，未知费用、错账、错误单号及停用单拒绝导出', () => {
  const split = text.replace('UPC#', 'Page 1/2 PO0000001-RR\n-- 1 of 2 --\n' + header + '\nUPC#');
  assert.equal(parse(split).items.length, 2);
  for (const [a,b] of [['Tape cost','Unknown fee'],['$28.20','$26.20'],['Active','Cancelled'],['No.: PO0000001-RR','No.: PO0000001-XXX']]) {
    assert.ok(parse(text.replace(a,b)).error);
  }
});

test('UPC 和说明书找不到唯一货号时给出核对提示', () => {
  assert.match(parse(text.replace('SKU: B2','SKU: B2\nUPC: 123456789012')).error,/UPC/);
  assert.match(parse(text.replace('Charge (123456789012)','Charge (223456789012)')).error,/UPC/);
  assert.match(parse(text.replace('A1, B2','A1, C3')).error,/说明书/);
  assert.match(parse(text.replace('A1, B2','A1, A1')).error,/数量/);
});

test('粘贴副本只替换本次已识别的费用，保留手写说明', () => {
  const known=['Importer Label Cost:$0.02一张','Tape cost:$2'];
  assert.equal(mergeFeeRemarks('外箱,保留，Importer label cost:$0.02一张,Tape cost:$2',known[0],known),
    '外箱,保留；Importer Label Cost:$0.02一张');
  assert.equal(mergeFeeRemarks('Tape cost:$20', '', known), 'Tape cost:$20');
});

const tapePO = `No.: PO0000001
Status: Active
Created: Jan 1, 2026
Delivery date: Jan 2, 2026
${header}
Product A
SKU: TEST-A
5 1.00 5.00
Product B
SKU: TEST-B
5 1.00 5.00
Tape cost 1 2.00 2.00
Tape cost 1 2.00 2.00
Total units: 12
Total (USD): $14.00`;

test('两笔胶带费逐行累计，旧预览重复导出仍只列整单合计', () => {
  const po = parse(tapePO, 'fixture.pdf');
  assert.equal(po.error, undefined);
  assert.deepEqual(po.fees.map(f => f.amount), [2, 2]);
  assert.deepEqual(po.items.map(i => i.remark), ['Tape cost:$4', '']);
  const old = {...po, items: po.items.map(i => ({...i}))};
  Object.assign(old.items[0], {remark:'手写说明；Tape cost:$2', feeRemarks:['Tape cost:$2']});
  const normalized = normalizeServiceRows(old);
  assert.equal(normalized.items[0].remark,'手写说明；Tape cost:$4');
  assert.deepEqual(normalized.items[0].feeRemarks,['Tape cost:$4']);
  assert.deepEqual(normalizeServiceRows(normalized),normalized);
  const decimal = parse(tapePO.replace('1 2.00 2.00','3 0.10 0.30')
    .replace('1 2.00 2.00','1 0.12 0.12').replace('units: 12','units: 14').replace('$14.00','$10.42'));
  assert.equal(decimal.items[0].remark,'Tape cost:$0.42');
});

test('两货号原表导出并重读，手写富文本保留，追加整单胶带费只出现一次', async t => {
  const Excel = require('exceljs');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const {writeToExcel} = require('../excel-writer');
  const {writePasteWorkbook} = require('../paste-workbook');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'sky-tape-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const original = path.join(dir,'source.xlsx');
  const output = path.join(dir,'copy.xlsx');
  const template = new Excel.Workbook();
  const master = template.addWorksheet('名称');
  master.addRow(['货号','系列','名称']);
  const order = template.addWorksheet('总接单');
  order.addRow([null,null,null,null,null,null,null,null,'单价USD','金额USD','金额HKD']);
  order.addRow(['接单期','出货期','CUSTOMER PO','PO号','货号','数量','包装版本','系列']);
  template.addWorksheet('四代排期');
  const sched = template.addWorksheet('三代排期');
  const headers = ['接单期','系列','客名','生产车间','国家','CUSTOMER PO','PO号','货号','产品名称',
    '数量','贴纸用量','总贴纸用量','外箱','总箱数','计划出货期','计划验货期','备注','单价USD','金额USD','金额HKD'];
  sched.addRow(headers);
  const po = parse(tapePO);
  const rich = {richText:[{text:'客户',font:{bold:true}},{text:'留样'}]};
  for (const [index,item] of po.items.entries()) {
    master.addRow([item.partNo,'三代',item.description]);
    const row = sched.getRow(3 + index);
    row.getCell(7).value = po.poNumber;
    row.getCell(8).value = item.partNo;
    row.getCell(17).value = rich;
  }
  async function exportRemarks() {
    await template.xlsx.writeFile(original);
    const {wb,orders} = await writeToExcel(original,[po]);
    await writePasteWorkbook(original,output,wb,orders);
    const actual = new Excel.Workbook();
    await actual.xlsx.readFile(output);
    const sheet = actual.getWorksheet('三代排期');
    return [sheet.getCell('Q3'),sheet.getCell('Q4')];
  }
  const [a,b] = await exportRemarks();
  assert.deepEqual(a.value.richText,[...rich.richText,{text:'；Tape cost:$4'}]);
  assert.deepEqual(b.value,rich);
  sched.getCell('Q3').value = a.value;
  sched.getCell('Q4').value = {richText:[...rich.richText,{text:'；Tape cost:$2'}]};
  const [again,oldFee] = await exportRemarks();
  assert.deepEqual(again.value,a.value);
  assert.equal(oldFee.text,'客户留样');
});
