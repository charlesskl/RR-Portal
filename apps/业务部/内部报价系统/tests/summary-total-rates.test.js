const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSummaryValues, afterTaxComponents, buildSummaryWorkbook, BASE_SUMMARY_COLUMNS, SUMMARY_COLUMNS } = require('../backend/services/quoteSummary');

test('总利润和退税后毛利率使用生产金额，零数量和零售价安全归零', async () => {
  const before = { injection_labor: 2, imp_mat: 3 };
  const after = afterTaxComponents(before);
  const keys = ['total_profit_before_tax', 'total_gross_after_tax', 'total_profit_after_tax'];
  for (const [qty, price] of [[10, 20], [0, 20], [10, 0]]) {
    const values = calculateSummaryValues(before, after, qty, price);
    for (const key of keys) assert.equal(values[`${key}_rate`], qty * price ? values[key] / (qty * price) : 0);
  }
  const rows = [10, 30, 0].map((qty, i) => ({ id: i + 1, customer: '测试客户', quote_no: `T${i}`, product_name: '测试', qty, quoted_price: 10 + i * 10, components_before_tax: before, components: after }));
  const workbook = buildSummaryWorkbook(rows);
  const reopened = new (require('exceljs').Workbook)();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('各客报价汇总');
  const columns = [...BASE_SUMMARY_COLUMNS, ...SUMMARY_COLUMNS];
  const col = key => columns.findIndex(([k]) => k === key) + 1;
  const ref = (key, row) => `${sheet.getColumn(col(key)).letter}${row}`;
  for (const key of keys) {
    for (const row of [5, 6, 7]) {
      const cell = sheet.getCell(row, col(`${key}_rate`));
      assert.equal(cell.formula, `IF(${ref('production_amount', row)}=0,0,${ref(key, row)}/${ref('production_amount', row)})`);
      if (row === 7) assert.equal(cell.result, 0);
    }
    const total = sheet.getCell(8, col(key)).result;
    assert.equal(sheet.getCell(8, col(`${key}_rate`)).result, total / 700);
    assert.equal(sheet.getCell(8, col(`${key}_rate`)).formula, `IF(${ref('production_amount', 8)}=0,0,SUM(${ref(key, 8)})/${ref('production_amount', 8)})`);
  }
});
