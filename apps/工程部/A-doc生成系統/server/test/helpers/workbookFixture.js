const XlsxPopulate = require('xlsx-populate');

async function createWorkbookFixture(filePath) {
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet(0).name('Visible');
  const rich = new XlsxPopulate.RichText()
    .add('Nama ', { bold: true, fontColor: 'FFFF0000' })
    .add('Produk', { italic: true });

  sheet.cell('A1').value('卡车车身').style('bold', true);
  sheet.cell('A2').formula('LEN(A1)');
  sheet.range('B1:C1').merged(true);
  sheet.cell('B1').value('Nama Produk');
  sheet.cell('D1').value(rich);
  sheet.cell('E1').value(new Date('2026-01-02T00:00:00.000Z'))
    .style('numberFormat', 'yyyy-mm-dd');
  sheet.cell('F1').value(42);
  sheet.row(1).height(24);
  sheet.column('A').width(28);

  workbook.addSheet('Hidden').hidden(true).cell('A1').value('Truck body');
  workbook.addSheet('VeryHidden').hidden('very').cell('A1').value('产品 47193C');

  await workbook.toFileAsync(filePath);
  return filePath;
}

module.exports = { createWorkbookFixture };
