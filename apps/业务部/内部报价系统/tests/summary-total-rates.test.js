const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSummaryValues, afterTaxComponents, buildSummaryWorkbook, BASE_SUMMARY_COLUMNS, SUMMARY_COLUMNS } = require('../backend/services/quoteSummary');

const totalRateAmounts = {
  total_profit_before_tax_rate: 'total_profit_before_tax',
  total_gross_after_tax_rate: 'total_gross_after_tax',
  total_profit_after_tax_rate: 'total_profit_after_tax',
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

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

test('总利润率保留小数和亏损，按手算结果计算而不把亏损归零', () => {
  const before = { injection_labor: 0.2, imp_mat: 0.3 };
  const values = calculateSummaryValues(before, afterTaxComponents(before), 3, 0.4);
  // 单价0.4、成本0.5，人工退税为0.2×8%×11.5%=0.00184。
  close(values.production_amount, 1.2);
  close(values.total_profit_before_tax, -0.3);
  close(values.total_profit_before_tax_rate, -0.25);
  close(values.total_gross_after_tax, 0.3);
  close(values.total_gross_after_tax_rate, 0.25);
  close(values.total_profit_after_tax, -0.29448);
  close(values.total_profit_after_tax_rate, -0.2454);
});

test('不同货价数量的客户总计按金额加权，并保留确认的零值和零售价成本', async () => {
  const row = (id, customer, before, qty, price, confirmation = {}) => ({
    id, customer, quote_no: `RATE-${id}`, product_name: '利润率核对', qty, quoted_price: price,
    components_before_tax: before, components: afterTaxComponents(before), confirmation,
  });
  const rows = [
    row(1, 'A', { injection_labor: 2, imp_mat: 3 }, 999, 999, { confirmed_qty: 10, confirmed_price: 20 }),
    row(2, 'A', { injection_labor: 1, dom_mat: 4 }, 30, 10),
    row(3, 'A', { imp_mat: 999 }, 999, 999, { confirmed_qty: 0, confirmed_price: 1000 }),
    row(4, 'A', { imp_mat: 2 }, 4, 999, { confirmed_price: 0 }),
    row(5, 'B', { imp_mat: 3 }, 2, 10),
    row(6, 'C', { imp_mat: 3 }, 0, 10),
  ];
  const reopened = new (require('exceljs').Workbook)();
  await reopened.xlsx.load(await buildSummaryWorkbook(rows).xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('各客报价汇总');
  const columns = [...BASE_SUMMARY_COLUMNS, ...SUMMARY_COLUMNS];
  const col = key => columns.findIndex(([k]) => k === key) + 1;
  const ref = (key, number) => `${sheet.getColumn(col(key)).letter}${number}`;
  close(sheet.getCell(9, col('production_amount')).result, 500);
  // A客户：10×20+30×10=500；零数量不计入，免费订单的8元成本仍计入。
  const expected = {
    total_profit_before_tax: [292, 0.584],
    total_gross_after_tax: [355.8, 0.7116],
    total_profit_after_tax: [306.26, 0.61252],
  };
  for (const [rate, amount] of Object.entries(totalRateAmounts)) {
    close(sheet.getCell(9, col(amount)).result, expected[amount][0]);
    close(sheet.getCell(9, col(rate)).result, expected[amount][1]);
    assert.equal(sheet.getCell(9, col(rate)).formula,
      `IF(${ref('production_amount', 9)}=0,0,SUM(${ref(amount, 9)})/${ref('production_amount', 9)})`);
    // 另一个客户和全零生产金额客户各有独立小计，不能混入A客户金额。
    close(sheet.getCell(11, col(rate)).result, 0.7);
    assert.equal(sheet.getCell(13, col(rate)).result, 0);
    assert.equal(sheet.getCell(7, col(rate)).result, 0);
    assert.equal(sheet.getCell(8, col(rate)).result, 0);
    assert.equal(sheet.getCell(9, col(rate)).numFmt, '0.00%');
  }
  assert.equal(sheet.getCell(7, col('qty')).value, 0);
  assert.equal(sheet.getCell(8, col('quoted_price')).value, 0);
  assert.equal(sheet.getCell(9, col('qty')).result, 44);
});

test('API栏目传递总率金额映射，网页与导出的负责人颜色使用同一元数据', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { createRequire } = require('node:module');
  const filename = path.join(__dirname, '../backend/routes/summary.js');
  const realRequire = createRequire(filename), routes = {};
  const router = { use() {}, post() {}, put() {}, get(url, handler) { routes[url] = handler; } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: { exports: {} },
    require: id => id === 'express' ? { Router: () => router }
      : id === '../db' ? { prepare: () => ({ all: async () => [] }) }
        : id === '../middleware/auth' ? { requireAuth() {}, quoteAccess() {} } : realRequire(id),
  });
  let report;
  await routes['/']({ user: { role: 'admin', active_factory_code: 'test' } }, { json(value) { report = value; } });
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(await buildSummaryWorkbook([]).xlsx.writeBuffer());
  const sheet = workbook.getWorksheet('各客报价汇总');
  for (const item of report.summary_columns) {
    const column = BASE_SUMMARY_COLUMNS.length + SUMMARY_COLUMNS.findIndex(([key]) => key === item.code) + 1;
    assert.equal(sheet.getCell(4, column).value, item.name);
    assert.equal(sheet.getCell(4, column).fill.fgColor.argb, `FF${item.header_style.fill}`);
    assert.equal(sheet.getCell(4, column).font.color.argb, `FF${item.header_style.color}`);
    assert.equal(sheet.getCell(3, column).value, item.header_style.owner);
    assert.equal(sheet.getCell(3, column).fill.fgColor.argb, `FF${item.header_style.owner_fill}`);
    if (totalRateAmounts[item.code]) assert.deepEqual(Array.from(item.share_amounts), [totalRateAmounts[item.code]]);
  }
  assert.equal(sheet.views[0].ySplit, 4);
  assert.equal(sheet.views[0].xSplit, 3);
  assert.match(sheet.autoFilter, /^A4:[A-Z]+4$/);
  assert.deepEqual(sheet.model.merges, ['A1:H1', 'A2:D2', 'E2:H2']);
});
