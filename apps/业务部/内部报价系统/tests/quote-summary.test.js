const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  QUOTE_COMPONENTS, TAX_DEDUCTION_RATES, groupSummaryRows, buildQuoteSummary, buildSummaryWorkbook,
} = require('../backend/services/quoteSummary');

test('报价汇总读取报价基本资料和客价', () => {
  const quote = { id: 9, quote_no: 'A-100', product_name: '测试产品', customer: 'ZURU', qty: 5000, status: 'fully_approved' };
  const sections = [
    { dept: 'sales', status: 'approved', payload_json: JSON.stringify({ pricing_summary: {
      t1: { base_price: 20, dom_mat: 2, electronic: 1, slush: 0.5 },
      t2: { color_box: 1, carton: 0.5 },
      t3: { injection_labor: 1, painting_labor: 0.7, paint_material: 0.3, assembly_labor: 2, no_labor_cost: 8, total_cost: 10 },
      t4: { carton: { amt: 0.5, rate: 13 }, slush3: { amt: 0.5, rate: 3 } },
    } }) },
    { dept: 'molding', status: 'approved', payload_json: '{}' },
    { dept: 'painting', status: 'approved', payload_json: '{}' },
    { dept: 'assembly', status: 'approved', payload_json: '{}' },
  ];
  const result = buildQuoteSummary(quote, sections);
  assert.equal(result.quoted_price, 20);
  assert.equal(result.customer, 'ZURU');
  assert.equal(result.qty, 5000);
  assert.equal(result.components.dom_mat, 1.77);
  assert.equal(result.components.injection_labor, 1);
  assert.equal(result.components_before_tax.dom_mat, 2);
  assert.equal(result.components_before_tax.injection_labor, 1);
  assert.equal(result.component_basis, 'after_tax');
});

test('报价汇总直接统计各部门明细，不依赖业务部历史快照', () => {
  const quote = { id: 10, quote_no: 'LIVE-100', product_name: '历史报价', customer: 'TOMY', qty: 5000, factory_code: 'qingxi' };
  const sections = [
    { dept: 'sales', payload_json: JSON.stringify({
      header: { fx_rmb_hkd: 0.85, fx_hkd_usd: 7.8 },
      shipping: { markup_x: 1.2, freight_pct: 48, lifting_pct: 52, scenarios: [{ name: '盐田40柜', _freight_rate: 10 }] },
    }) },
    { dept: 'molding', payload_json: JSON.stringify({
      injection: [{ material: 'PVC', weight_g: 2, material_unit_price: 1, shot_price: 3 }],
      injection_loss_pct: 0,
    }) },
    { dept: 'electronic', payload_json: JSON.stringify({ electronics: [{ name: '主控IC', qty: 1, unit_price_rmb: 0.85 }] }) },
    { dept: 'engineering', payload_json: JSON.stringify({ hardware: [{ name: '马达', qty: 1, unit_price_rmb: 1.7 }] }) },
  ];
  const result = buildQuoteSummary(quote, sections);
  assert.equal(result.components.dom_mat, 1.77);
  assert.equal(result.components.injection_labor, 3);
  assert.equal(result.components.electronic, 1);
  assert.equal(result.components.motor, 1.77);
  assert.equal(result.components.hardware, 0);
  assert.equal(result.components.freight, 4.40352);
  assert.equal(result.components.cabinet, 5.2);
  assert.equal(result.quoted_price, 21.6);
});

test('报价汇总按减税明细口径计算各项减税后单价', () => {
  const quote = { id: 11, quote_no: 'TAX-100', product_name: '减税测试', customer: 'TOMY', qty: 100 };
  const sections = [{
    dept: 'sales', payload_json: JSON.stringify({ pricing_summary: {
      t1: { base_price: 30, imp_mat: 10, dom_mat: 10, slush: 10, sewing_hair: 10, electronic: 10, suction: 10 },
      t2: { color_box: 10, plating: 10, carton: 10, freight: 10, cabinet: 10, misc: 10 },
      t3: { injection_labor: 10, paint_material: 10 },
    } }),
  }];
  const result = buildQuoteSummary(quote, sections);
  assert.equal(TAX_DEDUCTION_RATES.dom_mat, 11.5);
  assert.equal(result.components.imp_mat, 10);
  assert.equal(result.components.dom_mat, 8.85);
  assert.equal(result.components.injection_labor, 10);
  assert.equal(result.components.paint_material, 8.85);
  assert.equal(result.components.slush, 9.7);
  assert.equal(result.components.sewing_hair, 8.85);
  assert.equal(result.components.electronic, 10);
  assert.equal(result.components.suction, 9.4);
  assert.equal(result.components.color_box, 8.85);
  assert.equal(result.components.plating, 9.901);
  assert.equal(result.components.carton, 8.85);
  assert.equal(result.components.freight, 9.174);
  assert.equal(result.components.cabinet, 10);
  assert.equal(result.components.misc, 10);
});

test('报价汇总项目按参考表顺序排列，系统新增项目插入同类位置', () => {
  assert.deepEqual(QUOTE_COMPONENTS.map(([key]) => key), [
    'injection_labor', 'assembly_labor', 'painting_labor',
    'imp_mat', 'dom_mat', 'blow',
    'color_box', 'glue_bag', 'suction', 'carton', 'plating',
    'electronic', 'motor', 'battery', 'libao', 'hardware',
    'slush', 'sewing_hair', 'sewing_cloth', 'paint_material',
    'other_buy', 'misc', 'freight', 'cabinet',
  ]);
});

test('导出表横向展开报价项目并保留客户确认和实际生产车间', async () => {
  const row = {
    id: 1, customer: 'Sky Castle', quote_no: 'SC-1', product_name: '产品', version: 'V1', qty: 100,
    quoted_price: 10, created_at: '2026-09-08T09:00:00Z',
    components_before_tax: { injection_labor: 1.5, dom_mat: 2 },
    components: { injection_labor: 1.5, dom_mat: 1.77 },
    confirmation: { status: 'confirmed', workshops: ['xingxin_a'], confirmed_price: 10, confirmed_qty: 100, note: '已确认' },
  };
  const workbook = buildSummaryWorkbook([row], { customer: 'Sky Castle' });
  const sheet = workbook.getWorksheet('各客报价汇总');
  const totalShareColumn = 9 + QUOTE_COMPONENTS.length * 4;
  const workflowStart = totalShareColumn + 1;
  assert.equal(sheet.getCell(4, 1).value, '序号');
  assert.equal(sheet.getCell(5, 1).value, 1);
  assert.equal(sheet.getCell(5, 2).value, 'Sky Castle');
  assert.equal(sheet.getCell(4, 3).value, '实际生产车间');
  assert.equal(sheet.getCell(5, 3).value, '兴信A');
  assert.equal(sheet.getCell(4, 4).value, '货号');
  assert.equal(sheet.getCell(4, 9).value, '啤工');
  assert.equal(sheet.getCell(4, 10).value, '退税后啤工');
  assert.equal(sheet.getCell(4, 11).value, '啤工金额');
  assert.equal(sheet.getCell(4, 12).value, '啤工占比');
  assert.equal(sheet.getCell(5, 9).value, 1.5);
  assert.deepEqual(sheet.getCell(5, 10).value, { formula: 'I5', result: 1.5 });
  assert.deepEqual(sheet.getCell(5, 11).value, { formula: 'J5*$G5', result: 150 });
  assert.equal(sheet.getCell(5, 12).value.formula, 'IF($H5=0,0,J5/$H5)');
  assert.ok(Math.abs(sheet.getCell(5, 12).value.result - 0.15) < 1e-12);
  assert.equal(sheet.getCell(5, 26).value.formula, 'Y5*(1-11.5%)');
  assert.equal(sheet.getCell(5, 27).value.formula, 'Z5*$G5');
  assert.equal(sheet.getCell(4, totalShareColumn).value, '各金额占比求和');
  assert.match(sheet.getCell(5, totalShareColumn).value.formula, /^SUM\(L5,/);
  assert.ok(Math.abs(sheet.getCell(5, totalShareColumn).value.result - 0.327) < 1e-12);
  assert.equal(sheet.getCell(4, workflowStart).value, '客价确认');
  assert.equal(sheet.getCell(5, workflowStart).value, '已确认');
  assert.equal(sheet.getCell(5, 8).value, 10);
  ['top', 'left', 'bottom', 'right'].forEach(edge => {
    assert.equal(sheet.getCell(5, 1).border[edge].style, 'thin');
    assert.equal(sheet.getCell(5, totalShareColumn).border[edge].style, 'thin');
  });
  assert.equal(sheet.getCell(6, 4).value, '客户总计');
  assert.equal(sheet.getCell(6, 2).border.top.style, 'medium');
  assert.equal(sheet.getCell(6, 2).border.left.style, 'thin');
  assert.equal(sheet.getCell(6, 2).border.bottom.style, 'thin');
  assert.equal(sheet.getCell(6, 2).border.right.style, 'thin');
  assert.equal(sheet.getCell(6, 7).value.formula, 'SUM(G5:G5)');
  assert.equal(sheet.getCell(6, 8).value.formula, 'SUM(H5:H5)');
  assert.equal(sheet.getCell(6, 9).value.formula, 'SUM(I5:I5)');
  assert.equal(sheet.getCell(6, 10).value.formula, 'SUM(J5:J5)');
  assert.equal(sheet.getCell(6, 11).value.formula, 'SUM(K5:K5)');
  assert.equal(sheet.getCell(6, 12).value.formula, 'SUM(L5:L5)');
  assert.match(sheet.getCell(6, totalShareColumn).value.formula, /^SUM\(L6,/);
  assert.ok(Math.abs(sheet.getCell(6, totalShareColumn).value.result - 0.327) < 1e-12);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 1000);
  const reopened = new (require('exceljs').Workbook)();
  await reopened.xlsx.load(buffer);
  assert.equal(reopened.getWorksheet('各客报价汇总').getCell('J5').value.formula, 'I5');
  assert.equal(reopened.getWorksheet('各客报价汇总').getCell('K5').value.formula, 'J5*$G5');
  assert.equal(reopened.getWorksheet('各客报价汇总').getCell('L5').value.formula, 'IF($H5=0,0,J5/$H5)');
  assert.match(reopened.getWorksheet('各客报价汇总').getCell(5, totalShareColumn).value.formula, /^SUM\(L5,/);
});

test('报价汇总按客户排序分组，序号由每个客户组内重新开始', () => {
  const groups = groupSummaryRows([
    { id: 1, customer: 'TOMY', created_at: '2026-09-01' },
    { id: 2, customer: 'SpinMaster', created_at: '2026-09-03' },
    { id: 3, customer: 'TOMY', created_at: '2026-09-05' },
  ]);
  assert.deepEqual(groups.map(group => [group.customer, group.rows.map(row => row.id)]), [
    ['SpinMaster', [2]],
    ['TOMY', [3, 1]],
  ]);
});

test('导出表按客户组内逐条编号并在总计行留空', () => {
  const base = {
    product_name: '产品', qty: 1, quoted_price: 10,
    components_before_tax: {}, components: {}, confirmation: {},
  };
  const workbook = buildSummaryWorkbook([
    { ...base, id: 1, customer: 'TOMY', quote_no: 'T-1', created_at: '2026-09-01' },
    { ...base, id: 2, customer: 'TOMY', quote_no: 'T-2', created_at: '2026-09-02' },
    { ...base, id: 3, customer: 'ZURU', quote_no: 'Z-1', created_at: '2026-09-03' },
  ]);
  const sheet = workbook.getWorksheet('各客报价汇总');
  assert.equal(sheet.getCell('A5').value, 1);
  assert.equal(sheet.getCell('A6').value, 2);
  assert.equal(sheet.getCell('A7').value, '');
  assert.equal(sheet.getCell('A8').value, 1);
  assert.equal(sheet.getCell('A9').value, '');
});

test('客户总计逐列汇总货价、单价和占比，即使接单数量为零', () => {
  const base = {
    customer: 'TOMY', product_name: '产品', qty: 0,
    components_before_tax: {}, confirmation: { confirmed_qty: 0 },
  };
  const workbook = buildSummaryWorkbook([
    { ...base, id: 1, quote_no: 'T-1', quoted_price: 10, components_before_tax: { injection_labor: 1 }, components: { injection_labor: 1 } },
    { ...base, id: 2, quote_no: 'T-2', quoted_price: 20, components_before_tax: { injection_labor: 2 }, components: { injection_labor: 2 } },
  ]);
  const sheet = workbook.getWorksheet('各客报价汇总');
  const totalShareColumn = 9 + QUOTE_COMPONENTS.length * 4;
  assert.deepEqual(sheet.getCell('H7').value, { formula: 'SUM(H5:H6)', result: 30 });
  assert.deepEqual(sheet.getCell('I7').value, { formula: 'SUM(I5:I6)', result: 3 });
  assert.deepEqual(sheet.getCell('J7').value, { formula: 'SUM(J5:J6)', result: 3 });
  assert.equal(sheet.getCell('K7').value.formula, 'SUM(K5:K6)');
  assert.deepEqual(sheet.getCell('L7').value, { formula: 'SUM(L5:L6)', result: 0.2 });
  assert.equal(sheet.getCell(7, totalShareColumn).value.result, 0.2);
});

test('导出表长内容自动换行并增加行高', () => {
  const customer = 'SpinMaster-毛绒（印度尼西亚）长客户名称';
  const workbook = buildSummaryWorkbook([{
    id: 1, customer, quote_no: 'LONG-QUOTE-NUMBER-2026', product_name: '名称较长需要自动换行显示的产品',
    qty: 1, quoted_price: 10, created_at: '2026-09-09',
    components_before_tax: {}, components: {},
    confirmation: { note: '这是一段较长的备注内容，需要在导出的单元格中自动换行显示完整' },
  }]);
  const sheet = workbook.getWorksheet('各客报价汇总');
  assert.equal(sheet.getCell('B5').alignment.wrapText, true);
  assert.ok(sheet.getRow(5).height > 22);
  assert.ok(sheet.getRow(6).height > 22);
});

test('网页汇总的接单数量和货价列使用紧凑宽度', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../frontend/styles.css'), 'utf8');
  assert.match(styles, /th:nth-child\(7\).*width:112px/);
  assert.match(styles, /th:nth-child\(8\).*width:126px/);
  assert.match(styles, /td:nth-child\(7\) input.*width:100%/);
});

test('网页汇总的原价和退税后单价列保持等宽', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../frontend/styles.css'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../frontend/summary.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../frontend/summary.html'), 'utf8');
  assert.match(styles, /th\.component-unit,.summary-table td\.component-value\{[^}]*width:92px[^}]*max-width:92px/);
  assert.match(styles, /summary-table\{table-layout:fixed\}/);
  assert.match(styles, /td:nth-child\(2\).*white-space:normal.*overflow-wrap:anywhere.*word-break:break-word/);
  assert.match(source, /state\.components\.forEach\(\(\) => widths\.push\(92, 92, 96, 78\)\)/);
  assert.match(source, /各金额<br>占比求和/);
  assert.match(source, /class="component-share component-share-total"/);
  assert.match(html, /<colgroup id="summary-cols"><\/colgroup>/);
});
