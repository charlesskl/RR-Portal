'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { parseWorkbook } = require('../backend/services/parseHardwareSheet');
const { rowsFromPage } = require('../backend/services/parseSupplierPdf');

async function buildSupplierWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.getRow(13).values = [
    '序号', '产品编号&产品名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ];
  sheet.getRow(14).values = [1, '五金件A', '20×30mm', '镀锌', 'PCS', '1K', 10, 11.3, null, 'A备注', 15];
  sheet.getRow(15).values = [null, null, null, null, null, '3K', 8, 9.04];
  sheet.getRow(16).values = [null, null, null, null, null, '5K', 7, 7.91, 0.95];
  sheet.getRow(17).values = [null, null, null, null, null, '10K', 6, 6.78];
  sheet.getRow(18).values = [2, '包装件B', '彩盒', '过哑膜', 'PCS', '5K', null, null, 1.2, 'B备注', 20];
  sheet.getCell('A48').value = '📌 备注说明';
  return workbook.xlsx.writeBuffer();
}

test('unified supplier quote imports the 5K tier for hardware, auxiliary and packaging use', async () => {
  const result = await parseWorkbook(await buildSupplierWorkbook(), { targetQty: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.template_type, 'supplier_quote');
  assert.equal(result.target_qty, 5000);
  assert.equal(result.items.length, 2);

  assert.equal(result.items[0].name, '五金件A');
  assert.equal(result.items[0].unit_price_rmb, 7);
  assert.equal(result.items[0].price_type, 'RMB_UNTAXED');
  assert.equal(result.items[0].price_tiers.find(tier => tier.moq === '5K').unit_price_rmb_taxed, 7.91);
  assert.equal(result.items[0].price_tiers.find(tier => tier.moq === '5K').unit_price_usd, 0.95);
  assert.equal(result.items[0].moq, '5K');
  assert.equal(result.items[0].qty, 1);
  assert.match(result.items[0].spec, /20×30mm/);
  assert.match(result.items[0].spec, /镀锌/);
  assert.match(result.items[0].note, /交期：15天/);

  assert.equal(result.items[1].name, '包装件B');
  assert.equal(result.items[1].unit_price_rmb, null);
  assert.equal(result.items[1].unit_price_usd, 1.2);
  assert.equal(result.items[1].source_currency, 'USD');
  assert.equal(result.items[1].moq, '5K');
});

test('unified supplier quote can select MOQ and source currency independently', async () => {
  const usd5k = await parseWorkbook(await buildSupplierWorkbook(), { targetQty: 5000, targetCurrency: 'USD' });
  assert.equal(usd5k.items[0].moq, '5K');
  assert.equal(usd5k.items[0].source_currency, 'USD');
  assert.equal(usd5k.items[0].unit_price_usd, 0.95);
  assert.equal(usd5k.items[0].unit_price_rmb, null);

  const rmb3k = await parseWorkbook(await buildSupplierWorkbook(), { targetQty: 3000, targetCurrency: 'RMB' });
  assert.equal(rmb3k.items[0].moq, '3K');
  assert.equal(rmb3k.items[0].source_currency, 'RMB');
  assert.equal(rmb3k.items[0].unit_price_rmb, 8);
});

test('supplier import preview provides per-item MOQ and currency selectors', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  assert.match(source, /data-tier-index/);
  assert.match(source, /data-price-type-index/);
  assert.match(source, /人民币不含税/);
  assert.match(source, /人民币含税/);
  assert.match(source, /美金不含税/);
  assert.match(source, /可逐项选择识别到的 MOQ 与币种/);
  assert.match(source, /\.xls,\.xlsx,\.pdf,application\/pdf/);
});

test('PDF table rows retain separate MOQ and three price columns for preview selection', async () => {
  const item = (text, x, y) => ({ text, x, y });
  const pageItems = [
    item('序号', 20, 500), item('产品编号', 80, 500), item('物料名称', 170, 500), item('规格描述', 280, 500),
    item('材料&表面处理', 380, 500), item('单位', 490, 500), item('MOQ', 550, 500),
    item('单价(元)不含税', 630, 500), item('单价(元)含税', 740, 500),
    item('单价(USD)不', 850, 500), item('备注', 970, 500), item('交期(天)', 1040, 500),
    item('1', 20, 450), item('MAT-001', 80, 450), item('ABS透明拉管料价', 170, 450), item('14.3x22x0.06', 280, 450),
    item('ABS', 380, 450), item('个', 490, 450), item('5K', 550, 450), item('3', 630, 450),
    item('3.39', 740, 450), item('0.42', 850, 450), item('报价A', 970, 450), item('15', 1040, 450),
    item('2', 20, 410), item('MAT-001', 80, 410), item('ABS透明拉管料价', 170, 410), item('14.3x22x0.06', 280, 410),
    item('ABS', 380, 410), item('个', 490, 410), item('30K', 550, 410), item('2', 630, 410),
    item('2.26', 740, 410), item('0.30', 850, 410), item('报价B', 970, 410), item('20', 1040, 410),
  ];
  const rows = rowsFromPage(pageItems);
  const result = await require('../backend/services/parseHardwareSheet').parseSheets(
    [{ name: 'PDF 第 1 页', rows }], { targetQty: 30000, targetCurrency: 'USD' },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product_code, 'MAT-001');
  assert.deepEqual(result.items[0].price_tiers.map(tier => tier.moq), ['5K', '30K']);
  assert.equal(result.items[0].moq, '30K');
  assert.equal(result.items[0].unit_price_usd, 0.3);
  assert.equal(result.items[0].price_tiers[1].unit_price_rmb_untaxed, 2);
  assert.equal(result.items[0].price_tiers[1].unit_price_rmb_taxed, 2.26);
});

test('numbered rows with the same product and spec merge into selectable MOQ tiers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.addRow([
    '序号', '产品编号&产品名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ]);
  sheet.addRow([1, 'ABS透明拉管料价', '14.3×22×0.06, 1C', '', '个', '5K', 3]);
  sheet.addRow([2, 'ABS透明拉管料价', '14.3×22×0.06, 1C', '', '个', '30K', 2]);
  sheet.addRow([3, 'ABS透明拉管料价', '14.3×22×0.06, 1C', '', '个', '50K', 1.5]);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 30000, targetCurrency: 'RMB' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].moq, '30K');
  assert.equal(result.items[0].unit_price_rmb, 2);
  assert.deepEqual(result.items[0].price_tiers.map(tier => tier.moq), ['5K', '30K', '50K']);
});

test('MOQ tiers merge by normalized product name and spec without using material as a split key', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.addRow([
    '序号', '产品编号&产品名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ]);
  sheet.addRow([1, 'T钉', '2.5 X 43', '不锈钢', 'PCS', '5K', 0.1241]);
  sheet.addRow([2, 'Ｔ 钉', '2.5×43', '镀镍', 'PCS', '10K', 0.1222]);
  sheet.addRow([3, 'T　钉', '', '', 'PCS', '30K', 0.1222]);
  sheet.addRow([4, 'T钉', '', '', 'PCS', '50K', 0.1203]);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 30000 });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].price_tiers.map(tier => tier.moq), ['5K', '10K', '30K', '50K']);
});

test('only blank product rows after the named row merge into the same MOQ group', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.addRow([
    '序号', '产品编号', '物料名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ]);
  sheet.addRow([4, '', '', '', '', '个', '5K', 34, 0.37, 44]);
  sheet.addRow([5, '', 'T钉', '111', '11', '个', '30K', 23, 23, 23]);
  sheet.addRow([6, '', '', '', '', '个', '50K', 4, 4, 4]);

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 30000 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'T钉');
  assert.equal(result.items[0].spec, '111；材料/表面处理：11');
  assert.deepEqual(result.items[0].price_tiers.map(tier => tier.moq), ['30K', '50K']);
});

test('modified supplier template with separate product code and material name columns is supported', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商报价单');
  sheet.getRow(13).values = [
    '序号', '产品编号', '物料名称', '规格描述', '材料&表面处理', '单位', 'MOQ',
    '单价(元)不含税', '单价(元)含税', '单价（USD）不含税', '备注', '交期(天)',
  ];
  sheet.getRow(14).values = [1, 'MAT-001', 'ABS透明拉管料价', '14.3\"*22\"*0.06，1C', '', '个', '5K', 34, 0.365, 44, '新模板', 15];
  sheet.getRow(15).values = [2, 'MAT-001', 'ABS透明拉管料价', '14.3\"*22\"*0.06，1C', '', '个', '30K', 23, 23, 23];
  sheet.getRow(16).values = [3, 'MAT-001', 'ABS透明拉管料价', '14.3\"*22\"*0.06，1C', '', '个', '50K', 4, 4, 4];

  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 30000, targetCurrency: 'USD' });
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'ABS透明拉管料价');
  assert.equal(result.items[0].product_code, 'MAT-001');
  assert.equal(result.items[0].moq, '30K');
  assert.equal(result.items[0].source_currency, 'USD');
  assert.equal(result.items[0].unit_price_usd, 23);
  assert.deepEqual(result.items[0].price_tiers.map(tier => tier.moq), ['5K', '30K', '50K']);
});

test('legacy hardware quotation header remains supported', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('旧五金报价');
  sheet.addRow(['零件名称', '规格', '用量', '单价RMB', '备注']);
  sheet.addRow(['螺丝', 'M3', 4, 0.2, '镀锌']);
  const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    name: '螺丝', spec: 'M3', qty: 4, unit_price_rmb: 0.2, tax_pct: null, note: '镀锌',
  });
});

test('supplier usage is read per material, preserved through MOQ tiers and mixed product allocation', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('系统格式');
  sheet.getRow(13).values = ['序号', '产品编号', '物料名称', '规格描述', '单位', 'MOQ',
    '单价(元)含税（RMB)', '订单数量', '单个产品用量', '备注'];
  sheet.addRow([1, 'BEAUTYM-S3-011', '纸袋', '80开口*100MM', '个', '100K', 0.059, 100000, 1]);
  sheet.addRow([2, 'BEAUTYM-S3-011', '铝箔袋', '35.5开口*31.5MM', '个', '20K', 0.125, 20000,
    { formula: '1+1', result: 2 }, '用量：2个']);
  sheet.addRow([null, null, null, null, null, '100K', 0.1]);
  sheet.addRow([3, 'BEAUTYM-S3-012', '铝箔袋', '35.5开口*31.5MM', '个', '20K', 0.125, 20000, 0.5]);
  sheet.addRow([4, 'BEAUTYM-S3-013', '铝箔袋', '35.5开口*31.5MM', '个', '20K', 0.125, 20000, 0]);
  sheet.addRow([5, 'BEAUTYM-S3-014', '纸袋', '80开口*100MM', '个', '100K', 0.059]);
  const buffer = await workbook.xlsx.writeBuffer();
  for (const targetQty of [20000, 100000]) {
    const result = await parseWorkbook(buffer, { targetQty });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.items.map(item => item.qty), [1, 2, 0.5, 0, 1]);
    assert.equal(result.items[1].price_tiers.length, 2);
    assert.equal(result.items[1].unit_price_rmb, targetQty === 20000 ? 0.125 : 0.1);
    const { planSupplier } = require('../frontend/mixed-sku');
    const config = { products: [11, 12, 13, 14].map(n => ({ id: String(n), code: `BEAUTYM-S3-0${n}` })) };
    const plan = planSupplier(config, result.items);
    assert.deepEqual(plan.unmatched, []);
    assert.equal(plan.groups[0].items[1].qty, 2);
  }
});

test('different explicit usages are not merged into one material and invalid usage is reported', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('报价');
  sheet.addRow(['序号', '产品编号', '物料名称', 'MOQ', '单价(元)不含税', '用量']);
  sheet.addRow([1, 'A', '纸袋', '20K', 0.1, 1]);
  sheet.addRow([2, 'A', '纸袋', '20K', 0.1, 2]);
  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(result.items.map(item => item.qty), [1, 2]);
  sheet.addRow([3, 'B', '纸袋', '20K', 0.1, '待确认']);
  assert.match((await parseWorkbook(await workbook.xlsx.writeBuffer())).error, /第 4 行用量无效/);
});

test('supplier order quantities never become per-product usages or split MOQ tiers', async () => {
  for (const quantityHeader of ['订单数量', '訂單數量', '数量', 'QTY']) {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('报价');
    sheet.addRow(['序号', '产品编号', '物料名称', 'MOQ', '单价(元)不含税', quantityHeader]);
    sheet.addRow([1, 'A', '纸袋', '20K', 0.1, 20000]);
    sheet.addRow([2, 'A', '纸袋', '100K', 0.08, 100000]);
    const result = await parseWorkbook(await workbook.xlsx.writeBuffer(), { targetQty: 100000 });
    assert.equal(result.error, undefined);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].qty, 1);
    assert.equal(result.items[0].price_tiers.length, 2);
    assert.equal(result.items[0].unit_price_rmb, 0.08);
  }
});

test('supplier generic usage takes priority over an earlier order quantity', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('报价');
  sheet.addRow(['序号', '产品编号', '物料名称', 'MOQ', '单价(元)不含税', '订单数量', '用量']);
  sheet.addRow([1, 'A', '纸袋', '20K', 0.1, 20000, 0.5]);
  const result = await parseWorkbook(await workbook.xlsx.writeBuffer());
  assert.equal(result.error, undefined);
  assert.equal(result.items[0].qty, 0.5);
});

 test('mixed supplier import separates identical material names by product code and blocks unknown codes', async () => {
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('报价');
  ws.addRow(['序号','货号','产品名称','规格','MOQ','单价(元)不含税']);
  ws.addRow([1,'BEAUTYM-S3-002','瓶盖','20mm','1K',2]);
  ws.addRow([null,'BEAUTYM-S3-002',null,null,'5K',1]);
  ws.addRow([2,'BEAUTYM-S3-003','瓶盖','20mm','5K',3]);
  const result=await parseWorkbook(await wb.xlsx.writeBuffer(),{targetQty:5000});
  assert.equal(result.error,undefined);assert.equal(result.items.length,2);
  const {planSupplier}=require('../frontend/mixed-sku');
  const config={products:[{id:'a',code:'BEAUTYM-S3-002'},{id:'b',code:'BEAUTYM-S3-003'}]};
  const plan=planSupplier(config,result.items);
  assert.equal(plan.groups.length,2);assert.deepEqual(plan.unmatched,[]);
  assert.equal(plan.groups[0].items[0].unit_price_rmb,1);
  assert.equal(plan.groups[1].items[0].unit_price_rmb,3);
  assert.equal(plan.groups[0].items[0].name,'瓶盖');
  assert.equal(planSupplier(config,[{product_code:'unknown'},{}]).unmatched.length,2);
  assert.equal(planSupplier({products:[...config.products,{id:'c',code:'BEAUTYM-S3-002'}]},result.items).unmatched.length,1);
});

 test('supplier BeautyMini aliases match official SKU suffixes, preserve exact priority and reject ambiguity', () => {
  const {planSupplier}=require('../frontend/mixed-sku');
  const numbers=[3,4,10,32,33,34,56];
  const products=numbers.map((n,i)=>({id:'p'+n,code:'BEAUTYM-S3-'+String(n).padStart(3,'0'),source_number:String(i+1)}));
  products.push({id:'exclusive',code:'BEAUTYM-S3-048-excl',source_number:'60'});
  const items=numbers.map(n=>({product_code:'BEAUTYMINI_S3-'+String(n).padStart(2,'0'),name:'物料',unit_price_rmb:2}));
  items.push({product_code:'Beauty Mini_S3-048',name:'独家款物料'});
  const plan=planSupplier({products},items);
  assert.deepEqual(plan.unmatched,[]);assert.equal(plan.groups.length,8);
  assert.equal(plan.groups[7].product.id,'exclusive');
  assert.equal(plan.groups[0].items[0].name,'物料');
  assert.equal(plan.groups[0].items[0].product_code,'BEAUTYMINI_S3-03');
  const conflicting=[...products,{id:'other',code:'BEAUTYM-S3-003',source_number:'99'}];
  assert.equal(planSupplier({products:conflicting},[items[0]]).unmatched.length,1);
  assert.equal(planSupplier({products},[{product_code:'BEAUTYM-S3-003'}]).groups[0].product.id,'p3');
  assert.equal(planSupplier({products},[{product_code:'UNRELATED-03'}]).unmatched.length,1);
  assert.equal(planSupplier({products},[{product_code:'Beauty Mini_S3-060'}]).unmatched.length,1);
});

test('supplier 59 maps to official 059 even when NO.59 is an exclusive SKU or has been removed', () => {
  const { planSupplier } = require('../frontend/mixed-sku');
  const products = [
    {id:'cake', code:'BEAUTYM-S3-059', source_number:'56'},
    {id:'toner', code:'BEAUTYM-S3-040-excl', source_number:'59'},
    {id:'mask', code:'BEAUTYM-S3-026', source_number:'25'},
    {id:'device', code:'BEAUTYM-S3-027', source_number:'26'},
  ];
  const items = [{product_code:'Beauty Mini_S3-59', name:'彩盒', qty:2},
    {product_code:'Beauty Mini_S3-26', name:'面膜彩盒2', qty:1}];
  for (const config of [{products}, {products:products.filter(p=>p.id!=='toner')}]) {
    const plan = planSupplier(config, items);
    assert.deepEqual(plan.unmatched, []);
    assert.deepEqual(plan.groups.map(g=>g.product.id), ['cake','mask']);
    assert.equal(plan.groups[0].items[0].qty, 2);
  }
  const missing = planSupplier({products:products.filter(p=>p.id!=='cake')}, [items[0]]);
  assert.equal(missing.groups.length, 0);
  assert.match(missing.unmatched[0], /未找到/);
});
