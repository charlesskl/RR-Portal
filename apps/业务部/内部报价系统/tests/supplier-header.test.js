const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseWorkbook } = require('../backend/services/parseHardwareSheet');

function details(workbook, sheetName, supplier) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell('A1').value = '供应商报价单';
  sheet.mergeCells('A4:B4');
  sheet.getCell('A4').value = '供应商名称：';
  sheet.mergeCells('C4:F4');
  sheet.getCell('C4').value = supplier;
  sheet.getCell('G4').value = '报价单号：';
  sheet.getRow(13).values = ['序号', '产品编号', '物料名称', '规格描述', '材料&表面处理', '单位', 'MOQ', '单价(元)不含税', '单价(元)含税', '单价（USD）不含税'];
  sheet.getRow(14).values = [1, 'Beauty Mini_S3-04', 'PET收缩膜', '40*28*0.03MM', 'PET', '个', '50K', null, 0.05];
  return sheet;
}

test('读取合并单元格中的供应商抬头，并保留包装报价、货号、用量', async () => {
  const book = new ExcelJS.Workbook();
  details(book, '收缩膜', '测试科技(深圳)有限公司');
  const result = await parseWorkbook(await book.xlsx.writeBuffer(), { allSheets: true });
  assert.equal(result.supplier_name, '测试科技(深圳)有限公司');
  assert.deepEqual(result.supplier_names, ['测试科技(深圳)有限公司']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product_code, 'Beauty Mini_S3-04');
  assert.equal(result.items[0].qty, 1);
  assert.equal(result.items[0].unit_price_rmb, 0.05);
});

test('支持中文、繁体及英文供应商名称标签', async () => {
  for (const label of ['供应商名称：测试公司', '供應商名稱：測試公司', 'SUPPLIER NAME: Test Supplier']) {
    const book = new ExcelJS.Workbook();
    const sheet = details(book, '报价', null);
    sheet.getCell('A4').value = label;
    const result = await parseWorkbook(await book.xlsx.writeBuffer());
    assert.equal(result.supplier_name, label.split(/[:：]/)[1].trim());
  }
});

test('只读明细前的明确标签，不把标题、备注或下一字段当作供应商', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = details(book, '报价', null);
  sheet.getCell('A1').value = 'Supplier Quotation';
  sheet.getCell('G4').value = '报价单号：';
  sheet.getCell('H4').value = 'Q123';
  sheet.getCell('A20').value = '供应商名称：备注中的另一公司';
  const result = await parseWorkbook(await book.xlsx.writeBuffer());
  assert.equal(result.supplier_name, '');
  assert.deepEqual(result.supplier_names, []);
});

test('完整文件读取封面供应商，同一供应商多表合并，冲突不选第一家', async () => {
  const book = new ExcelJS.Workbook();
  const cover = book.addWorksheet('封面');
  cover.getCell('A4').value = '供应商名称：';
  cover.getCell('C4').value = '测试公司';
  details(book, '包装', '测试公司');
  details(book, '辅料', '测试公司');
  let result = await parseWorkbook(await book.xlsx.writeBuffer(), { allSheets: true });
  assert.equal(result.supplier_name, '测试公司');
  assert.equal(result.items.length, 2);
  book.getWorksheet('辅料').getCell('C4').value = '另一公司';
  result = await parseWorkbook(await book.xlsx.writeBuffer(), { allSheets: true });
  assert.equal(result.supplier_name, '');
  assert.deepEqual(result.supplier_names, ['测试公司', '另一公司']);
});
