const ExcelJS = require('exceljs');
const { calculateQuoteCosts } = require('./quoteCostSummary');

const WORKSHOPS = [
  ['xingxin_a', '兴信A'],
  ['xingxin_b', '兴信B'],
  ['huadeng', '华登'],
  ['heyuan', '河源'],
];

const QUOTE_COMPONENTS = [
  ['injection_labor', '啤工', 't3'],
  ['assembly_labor', '装工', 't3'],
  ['painting_labor', '喷印工', 't3'],
  ['imp_mat', '进口料', 't1'],
  ['dom_mat', '国内料', 't1'],
  ['blow', '吹气', 't1'],
  ['color_box', '彩盒/内咭', 't2'],
  ['glue_bag', '胶袋', 't1'],
  ['suction', '吸塑', 't1'],
  ['carton', '纸箱', 't2'],
  ['plating', '电镀', 't2'],
  ['electronic', '电子', 't1'],
  ['motor', '马达', 't1'],
  ['battery', '电池', 't2'],
  ['libao', '利宝', 't2'],
  ['hardware', '五金', 't1'],
  ['slush', '搪胶', 't1'],
  ['sewing_hair', '车发', 't1'],
  ['sewing_cloth', '车衣', 't1'],
  ['paint_material', '油漆', 't3'],
  ['other_buy', '其他外购', 't2'],
  ['misc', '杂项', 't2'],
  ['freight', '运费', 't2'],
  ['cabinet', '吊柜费', 't2'],
];

// 与报价单“减税明细”保持同一口径。汇总页和汇总导出均展示减税后单价。
// 未列出的项目（人工、进口料、吹气、电子、吊柜费、杂项）不减税。
const TAX_DEDUCTION_RATES = Object.freeze({
  paint_material: 11.5,
  dom_mat: 11.5,
  slush: 3,
  sewing_hair: 11.5,
  sewing_cloth: 11.5,
  hardware: 11.5,
  motor: 11.5,
  suction: 6,
  glue_bag: 11.5,
  color_box: 11.5,
  battery: 11.5,
  libao: 11.5,
  plating: 0.99,
  other_buy: 11.5,
  carton: 11.5,
  freight: 8.26,
});

const BASE_SUMMARY_COLUMNS = [
  ['serial', '序号', 'serial'], ['customer', '客名', 'text'], ['workshop', '实际生产车间', 'workshop'],
  ['quote_no', '货号', 'link'], ['product_name', '货品名称', 'text'], ['created_at', '报价日期', 'date'],
  ['qty', '实际接单数量', 'qty'], ['quoted_price', '货价 (HK$)', 'price'],
];

const SUMMARY_COLUMNS = [];
function addComponentColumns(key, label, options = {}) {
  SUMMARY_COLUMNS.push([key, label, 'unit']);
  if (options.afterTax !== false) SUMMARY_COLUMNS.push([`${key}_after_tax`, `退税后${label}`, 'unit']);
  if (options.amount !== false) SUMMARY_COLUMNS.push([`${key}_amount`, `${label}金额`, 'amount']);
  if (options.share !== false) SUMMARY_COLUMNS.push([`${key}_share`, `${label}占比`, 'percent']);
}
addComponentColumns('injection_labor', '啤工');
addComponentColumns('assembly_labor', '装工');
addComponentColumns('painting_labor', '喷印工');
SUMMARY_COLUMNS.push(['imp_mat', '料价进口料', 'unit'], ['dom_mat', '料价国内料', 'unit'],
  ['raw_material_after_tax', '退税后原料', 'unit'], ['raw_material_amount', '原料金额', 'amount'],
  ['raw_material_share', '原料占比', 'percent'], ['abs_material_cost', 'ABS料价成本', 'unit'],
  ['abs_material_share', 'ABS占货价%', 'percent'], ['total_purchase_price', '总采购价', 'unit']);
addComponentColumns('color_box', '彩盒');
addComponentColumns('libao', '贴纸');
addComponentColumns('suction', '吸塑');
addComponentColumns('carton', '纸箱');
SUMMARY_COLUMNS.push(['plating', '电镀', 'unit']);
addComponentColumns('electronic', '电子');
addComponentColumns('battery', '电池');
addComponentColumns('hardware', '五金');
addComponentColumns('slush', '搪胶');
addComponentColumns('sewing_hair', '车发');
addComponentColumns('sewing_cloth', '车衣');
addComponentColumns('paint_material', '油漆');
addComponentColumns('other_buy', '其他外购');
addComponentColumns('misc', '杂项');
SUMMARY_COLUMNS.push(['freight', '运费', 'unit'], ['cabinet', '吊柜费', 'unit'],
  ['freight_after_tax', '退税后运费', 'unit'], ['freight_amount', '运费金额', 'amount'],
  ['freight_share', '运费占比', 'percent'], ['surtax_04', '附加税0.4%', 'unit'],
  ['rmb_purchase_cost', '人民币采购成本', 'unit'], ['rmb_purchase_share', '人民币采购成本占比', 'percent'],
  ['gross_before_tax', '未退税前毛利', 'unit'], ['gross_before_tax_rate', '未退税前毛利率', 'percent'],
  ['profit_before_tax', '未退税前利润', 'unit'], ['profit_before_tax_rate', '未退税前利润率', 'percent'],
  ['markup_before_tax', '未退税前码点', 'number'], ['tax_1_cost', '含税1%成本', 'unit'],
  ['labor_13_cost', '人工类13%成本', 'unit'], ['freight_9_cost', '运费含税9%成本', 'unit'],
  ['tax_13_cost', '含税13%成本', 'unit'], ['carton_13_cost', '纸箱(含税13%）成本', 'unit'],
  ['slush_3_cost', '搪胶类3%成本', 'unit'], ['hair_13_cost', '车发类13%成本', 'unit'],
  ['cloth_13_cost', '车衣类13%成本', 'unit'], ['suction_6_cost', '吸塑类6%成本', 'unit'],
  ['rebate_reduction', '总退税可减少成本', 'unit'], ['cost_after_rebate', '退税及返点后总成本（含人工）', 'unit'],
  ['markup_after_tax', '退税后码数', 'number'], ['raw_cost_after_tax', '退税后原料成本', 'unit'],
  ['labor_cost_after_tax', '退税后人工成本', 'unit'], ['no_labor_cost_after_tax', '退税后不含人工成本', 'unit'],
  ['gross_after_tax', '退税后毛利', 'unit'], ['gross_after_tax_rate', '退税后毛利率', 'percent'],
  ['profit_after_tax', '退税后利润', 'unit'], ['profit_after_tax_rate', '退税后利润率', 'percent'],
  ['production_amount', '总生产金额', 'amount'], ['production_cost', '总生产成本', 'amount'],
  ['total_gross_before_tax', '总未退税前毛利', 'amount'], ['total_gross_before_tax_rate', '总未退税前毛利率', 'percent'],
  ['total_profit_before_tax', '总未退税前利润', 'amount'], ['total_profit_before_tax_rate', '总未退税前利润率', 'percent'],
  ['total_raw_before_tax', '总未退税前料价', 'amount'], ['total_raw_before_tax_share', '总未退税前料价占比', 'percent'],
  ['total_labor_before_tax', '总未退税人工成本', 'amount'], ['total_labor_before_tax_share', '总未退税人工成本占比', 'percent'],
  ['total_rmb_purchase', '总人民币结算外购件成本', 'amount'], ['total_rmb_purchase_share', '总人民币结算外购件成本占比', 'percent'],
  ['total_rebate_reduction', '总退税及返点减少成本金额', 'amount'],
  ['total_no_labor_after_tax', '退税后不含人工成本', 'amount'], ['total_no_labor_after_tax_share', '退税后不含人工成本占比', 'percent'],
  ['total_gross_after_tax', '总退税后毛利', 'amount'], ['total_gross_after_tax_rate', '总退税后毛利率', 'percent'],
  ['total_profit_after_tax', '总退税后利润', 'amount'], ['total_profit_after_tax_rate', '总退税后利润率', 'percent'],
  ['total_raw_after_tax', '总退税后料成本', 'amount'], ['total_raw_after_tax_share', '总未退税前料成本占比', 'percent'],
  ['total_labor_after_tax', '总退税后人工成本', 'amount'], ['total_labor_after_tax_share', '总退税后人工成本占比', 'percent'],
  ['amount_share_total', '各金额占比求和', 'percent']);

const AMOUNT_SHARE_KEYS = [
  'injection_labor_share', 'assembly_labor_share', 'painting_labor_share', 'raw_material_share',
  'color_box_share', 'libao_share', 'suction_share', 'carton_share', 'electronic_share', 'battery_share',
  'hardware_share', 'slush_share', 'sewing_hair_share', 'sewing_cloth_share', 'paint_material_share',
  'other_buy_share', 'misc_share', 'freight_share',
];

function calculateSummaryValues(before, after, qty, price, absMaterialCost = 0) {
  const values = {};
  const setComponent = key => {
    values[key] = num(before[key]); values[`${key}_after_tax`] = num(after[key]);
    values[`${key}_amount`] = values[`${key}_after_tax`] * qty;
    values[`${key}_share`] = price ? values[`${key}_after_tax`] / price : 0;
  };
  ['injection_labor', 'assembly_labor', 'painting_labor', 'color_box', 'libao', 'suction', 'carton',
    'electronic', 'battery', 'hardware', 'slush', 'sewing_hair', 'sewing_cloth', 'paint_material',
    'other_buy', 'misc'].forEach(setComponent);
  values.imp_mat = num(before.imp_mat); values.dom_mat = num(before.dom_mat); values.plating = num(before.plating);
  values.freight = num(before.freight); values.cabinet = num(before.cabinet);
  values.raw_material_after_tax = num(after.imp_mat) + num(after.dom_mat);
  values.raw_material_amount = values.raw_material_after_tax * qty;
  values.raw_material_share = price ? values.raw_material_after_tax / price : 0;
  values.abs_material_cost = num(absMaterialCost); values.abs_material_share = price ? values.abs_material_cost / price : 0;
  values.total_purchase_price = ['color_box','libao','suction','carton','plating','electronic','battery','hardware','slush','sewing_hair','sewing_cloth','paint_material','other_buy','misc'].reduce((s,k)=>s+num(before[k]),0);
  values.freight_after_tax = num(after.freight) + num(after.cabinet);
  values.freight_amount = values.freight_after_tax * qty;
  values.freight_share = price ? values.freight_after_tax / price : 0;
  values.surtax_04 = price * 0.004;
  const laborBefore = num(before.injection_labor)+num(before.assembly_labor)+num(before.painting_labor);
  const totalBefore = Object.values(before).reduce((s,v)=>s+num(v),0);
  values.rmb_purchase_cost = num(before.misc)+num(before.other_buy)+num(before.paint_material)+num(before.sewing_cloth)+num(before.sewing_hair)+num(before.hardware)+num(before.battery)+num(before.electronic)+num(before.plating)+num(before.carton)+num(before.libao)+num(before.color_box)+num(before.dom_mat);
  values.rmb_purchase_share = price ? values.rmb_purchase_cost/price : 0;
  values.gross_before_tax = price-(totalBefore-laborBefore); values.gross_before_tax_rate = price ? values.gross_before_tax/price : 0;
  values.profit_before_tax = price-totalBefore; values.profit_before_tax_rate = price ? values.profit_before_tax/price : 0;
  values.markup_before_tax = totalBefore ? price/totalBefore : 0;
  values.tax_1_cost = num(before.plating); values.labor_13_cost = laborBefore*0.08;
  values.freight_9_cost = num(before.freight); values.tax_13_cost = num(before.color_box)+num(before.libao)+num(before.hardware)+num(before.battery)+num(before.other_buy)+num(before.paint_material)+num(before.dom_mat);
  values.carton_13_cost = num(before.carton); values.slush_3_cost = num(before.slush);
  values.hair_13_cost = num(before.sewing_hair); values.cloth_13_cost = num(before.sewing_cloth); values.suction_6_cost = num(before.suction);
  values.rebate_reduction = values.tax_1_cost*0.0099 + values.labor_13_cost*0.115 + values.freight_9_cost*0.0826 + values.tax_13_cost*0.115 + values.carton_13_cost/1.1*0.115 + values.slush_3_cost*0.03 + values.hair_13_cost*0.115 + values.cloth_13_cost*0.115 + values.suction_6_cost*0.06;
  values.cost_after_rebate = totalBefore-values.rebate_reduction;
  values.markup_after_tax = values.cost_after_rebate ? price/values.cost_after_rebate : 0;
  values.raw_cost_after_tax = values.raw_material_after_tax;
  values.labor_cost_after_tax = laborBefore-values.labor_13_cost*0.115;
  values.no_labor_cost_after_tax = values.cost_after_rebate-values.labor_cost_after_tax;
  values.gross_after_tax = price-values.no_labor_cost_after_tax; values.gross_after_tax_rate = price ? values.gross_after_tax/price : 0;
  values.profit_after_tax = price-values.cost_after_rebate; values.profit_after_tax_rate = price ? values.profit_after_tax/price : 0;
  values.production_amount=price*qty; values.production_cost=totalBefore*qty;
  values.total_gross_before_tax=values.gross_before_tax*qty; values.total_gross_before_tax_rate=values.gross_before_tax_rate;
  values.total_profit_before_tax=values.profit_before_tax*qty; values.total_profit_before_tax_rate=values.profit_before_tax_rate;
  values.total_raw_before_tax=(num(before.imp_mat)+num(before.dom_mat))*qty; values.total_raw_before_tax_share=values.production_amount?values.total_raw_before_tax/values.production_amount:0;
  values.total_labor_before_tax=laborBefore*qty; values.total_labor_before_tax_share=values.production_amount?values.total_labor_before_tax/values.production_amount:0;
  values.total_rmb_purchase=values.rmb_purchase_cost*qty; values.total_rmb_purchase_share=values.production_amount?values.total_rmb_purchase/values.production_amount:0;
  values.total_rebate_reduction=values.rebate_reduction*qty;
  values.total_no_labor_after_tax=values.no_labor_cost_after_tax*qty; values.total_no_labor_after_tax_share=values.production_amount?values.total_no_labor_after_tax/values.production_amount:0;
  values.total_gross_after_tax=values.gross_after_tax*qty; values.total_gross_after_tax_rate=values.gross_after_tax_rate;
  values.total_profit_after_tax=values.profit_after_tax*qty; values.total_profit_after_tax_rate=values.profit_after_tax_rate;
  values.total_raw_after_tax=values.raw_cost_after_tax*qty; values.total_raw_after_tax_share=values.production_amount?values.total_raw_after_tax/values.production_amount:0;
  values.total_labor_after_tax=values.labor_cost_after_tax*qty; values.total_labor_after_tax_share=values.production_amount?values.total_labor_after_tax/values.production_amount:0;
  values.amount_share_total=AMOUNT_SHARE_KEYS.reduce((sum,key)=>sum+num(values[key]),0);
  return values;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function wrappedLineCount(value, width) {
  return String(value ?? '').split(/\r?\n/).reduce((total, line) => {
    const displayWidth = [...line].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0);
    return total + Math.max(1, Math.ceil(displayWidth / width));
  }, 0);
}

function parseJson(raw, fallback = {}) {
  try { return JSON.parse(raw || '') || fallback; } catch { return fallback; }
}

function afterTaxComponents(components) {
  return Object.fromEntries(QUOTE_COMPONENTS.map(([key]) => {
    const rate = num(TAX_DEDUCTION_RATES[key]);
    return [key, +(num(components?.[key]) * (1 - rate / 100)).toFixed(6)];
  }));
}

function groupSummaryRows(rows) {
  const groups = new Map();
  [...rows].sort((a, b) => {
    const byCustomer = String(a.customer || '').localeCompare(String(b.customer || ''), 'zh-CN');
    if (byCustomer) return byCustomer;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  }).forEach(row => {
    const customer = row.customer || '未填写';
    if (!groups.has(customer)) groups.set(customer, []);
    groups.get(customer).push(row);
  });
  return [...groups.entries()].map(([customer, customerRows]) => ({
    customer, rows: customerRows,
  }));
}

function buildQuoteSummary(quote, sections) {
  const salesSection = (sections || []).find(section => section.dept === 'sales');
  const sales = parseJson(salesSection && salesSection.payload_json);
  const pricing = sales?.pricing_summary || {};
  const calculated = calculateQuoteCosts(quote, sections);
  const beforeTaxComponents = Object.fromEntries(QUOTE_COMPONENTS.map(([key, , table]) => {
    const liveValue = calculated.components[key];
    return [key, calculated.hasSourceData ? num(liveValue) : num(pricing[table]?.[key])];
  }));
  const components = afterTaxComponents(beforeTaxComponents);
  const qty = num(quote.qty);
  const quotedPrice = calculated.hasSourceData ? num(calculated.quotedPrice) : num(pricing.t1?.base_price);
  return {
    id: quote.id,
    quote_no: quote.quote_no,
    product_name: quote.product_name,
    customer: quote.customer || '',
    qty,
    version: quote.version || '',
    created_at: quote.created_at,
    quote_status: quote.status,
    quoted_price: quotedPrice,
    components_before_tax: beforeTaxComponents,
    components,
    component_basis: 'after_tax',
    abs_material_cost: num(calculated.components.abs_material),
    summary_values: calculateSummaryValues(beforeTaxComponents, components, qty, quotedPrice, calculated.components.abs_material),
  };
}

function buildSummaryWorkbook(rows, filters = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '内部报价系统';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  wb.calcProperties.forceFullCalc = true;
  wb.calcProperties.calcMode = 'auto';
  const ws = wb.addWorksheet('各客报价汇总', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
  });
  ws.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
  };
  ws.headerFooter = {
    oddHeader: '&C&B各客报价汇总',
    oddFooter: '&L内部报价系统&C第 &P 页 / 共 &N 页&R&D',
  };
  const baseHeaders = ['序号', '客名', '实际生产车间', '货号', '货品名称', '报价日期', '实际接单数量', '货价 (HK$)'];
  const workflowHeaders = ['客价确认', '确认人', '确认时间', '备注'];
  const totalShareColumn = baseHeaders.length + QUOTE_COMPONENTS.length * 4 + 1;
  const totalColumns = totalShareColumn + workflowHeaders.length;
  ws.getCell(1, 1).value = `${new Date().getFullYear()}年`;
  ws.getCell(1, 1).font = { bold: true, size: 14, name: 'Microsoft YaHei' };
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells(1, 2, 1, totalColumns);
  ws.getCell(1, 2).value = '各客产品报价汇总表';
  ws.getCell(1, 2).font = { bold: true, size: 16, name: 'Microsoft YaHei' };
  ws.getCell(1, 2).alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, totalColumns);
  ws.getCell(2, 1).value = `客户：${filters.customer || '全部'}    导出日期：${new Date().toLocaleDateString('zh-CN')}`;
  ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF52647A' }, name: 'Microsoft YaHei' };
  ws.getCell(2, 1).alignment = { horizontal: 'left' };
  const headerStyle = (cell, fill = 'FFFFFFFF') => {
    cell.font = { bold: true, color: { argb: 'FF153A5B' }, name: 'Microsoft YaHei' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } }, left: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'thin', color: { argb: 'FF94A3B8' } }, right: { style: 'thin', color: { argb: 'FF94A3B8' } },
    };
  };
  let column = 1;
  baseHeaders.forEach(header => {
    ws.getCell(4, column).value = header;
    headerStyle(ws.getCell(4, column));
    column += 1;
  });
  QUOTE_COMPONENTS.forEach(([, label], componentIndex) => {
    const fill = componentIndex % 2 ? 'FFEAF0F8' : 'FFD9E2F3';
    [label, `退税后${label}`, `${label}金额`, `${label}占比`].forEach((header, offset) => {
      ws.getCell(4, column + offset).value = header;
      headerStyle(ws.getCell(4, column + offset), offset ? fill : 'FFFFFFFF');
    });
    column += 4;
  });
  ws.getCell(4, column).value = '各金额占比求和';
  headerStyle(ws.getCell(4, column), 'FFD9E2F3');
  column += 1;
  workflowHeaders.forEach(header => {
    ws.getCell(4, column).value = header;
    headerStyle(ws.getCell(4, column), 'FFFFF2CC');
    column += 1;
  });
  ws.getRow(4).height = 42;
  let targetRow = 5;
  groupSummaryRows(rows).forEach(group => {
    const groupStartRow = targetRow;
    const componentBeforeTaxTotals = Object.fromEntries(QUOTE_COMPONENTS.map(([key]) => [key, 0]));
    const componentAfterTaxTotals = Object.fromEntries(QUOTE_COMPONENTS.map(([key]) => [key, 0]));
    const componentAmountTotals = Object.fromEntries(QUOTE_COMPONENTS.map(([key]) => [key, 0]));
    const componentShareTotals = Object.fromEntries(QUOTE_COMPONENTS.map(([key]) => [key, 0]));
    group.rows.forEach((row, index) => {
    const confirmation = row.confirmation || {};
    const workshopNames = (confirmation.workshops || []).map(code => {
      const match = WORKSHOPS.find(item => item[0] === code);
      return match ? match[1] : code;
    }).join('、');
    const qty = confirmation.confirmed_qty ?? row.qty;
    const price = confirmation.confirmed_price ?? row.quoted_price;
    const componentValues = QUOTE_COMPONENTS.flatMap(([key]) => {
      const beforeTax = num(row.components_before_tax?.[key]);
      const afterTax = num(row.components?.[key]);
      componentBeforeTaxTotals[key] += beforeTax;
      componentAfterTaxTotals[key] += afterTax;
      componentAmountTotals[key] += afterTax * num(qty);
      componentShareTotals[key] += price ? afterTax / num(price) : 0;
      return [beforeTax, afterTax, afterTax * num(qty), price ? afterTax / price : 0];
    });
    const shareTotal = QUOTE_COMPONENTS.reduce((sum, [key]) => (
      sum + (num(price) ? num(row.components?.[key]) / num(price) : 0)
    ), 0);
    const values = [
      index + 1, row.customer, workshopNames, row.quote_no, row.product_name,
      row.created_at ? new Date(row.created_at) : '',
      qty, price,
      ...componentValues,
      shareTotal,
      confirmation.status === 'confirmed' ? '已确认' : '待确认',
      confirmation.confirmed_by || '',
      confirmation.confirmed_at ? new Date(confirmation.confirmed_at) : '',
      confirmation.note || '',
    ];
    values.forEach((value, columnIndex) => {
      const cell = ws.getCell(targetRow, columnIndex + 1);
      cell.value = value;
      cell.font = { name: 'Microsoft YaHei', size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF7FAFC' : 'FFFFFFFF' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
    });
    ws.getCell(targetRow, 6).numFmt = 'yyyy-mm-dd';
    ws.getCell(targetRow, 7).numFmt = '#,##0';
    ws.getCell(targetRow, 8).numFmt = '#,##0.0000';
    QUOTE_COMPONENTS.forEach((_, componentIndex) => {
      const startColumn = 9 + componentIndex * 4;
      const beforeTaxCell = ws.getCell(targetRow, startColumn);
      const afterTaxCell = ws.getCell(targetRow, startColumn + 1);
      const amountCell = ws.getCell(targetRow, startColumn + 2);
      const shareCell = ws.getCell(targetRow, startColumn + 3);
      const key = QUOTE_COMPONENTS[componentIndex][0];
      const beforeTax = num(row.components_before_tax?.[key]);
      const afterTax = num(row.components?.[key]);
      const rate = num(TAX_DEDUCTION_RATES[key]);
      beforeTaxCell.numFmt = '#,##0.0000';
      afterTaxCell.value = {
        formula: rate ? `${beforeTaxCell.address}*(1-${rate}%)` : beforeTaxCell.address,
        result: afterTax,
      };
      afterTaxCell.numFmt = '#,##0.0000';
      amountCell.value = {
        formula: `${afterTaxCell.address}*$G${targetRow}`,
        result: afterTax * num(qty),
      };
      amountCell.numFmt = '#,##0.00';
      shareCell.value = {
        formula: `IF($H${targetRow}=0,0,${afterTaxCell.address}/$H${targetRow})`,
        result: price ? afterTax / price : 0,
      };
      shareCell.numFmt = '0.00%';
    });
    const detailShareCells = QUOTE_COMPONENTS.map((_, componentIndex) => (
      ws.getCell(targetRow, 12 + componentIndex * 4).address
    ));
    ws.getCell(targetRow, totalShareColumn).value = {
      formula: `SUM(${detailShareCells.join(',')})`,
      result: shareTotal,
    };
    ws.getCell(targetRow, totalShareColumn).numFmt = '0.00%';
    ws.getCell(targetRow, totalColumns - 1).numFmt = 'yyyy-mm-dd hh:mm';
    const detailLineCount = Math.max(
      wrappedLineCount(row.customer, 18),
      wrappedLineCount(workshopNames, 16),
      wrappedLineCount(row.quote_no, 16),
      wrappedLineCount(row.product_name, 24),
      wrappedLineCount(confirmation.confirmed_by, 14),
      wrappedLineCount(confirmation.note, 26),
    );
    ws.getRow(targetRow).height = Math.max(22, detailLineCount * 15);
    targetRow += 1;
    });

    const groupEndRow = targetRow - 1;
    const subtotalRow = targetRow;
    const subtotalValues = ['', group.customer, '', '客户总计', '', '', '', ''];
    subtotalValues.forEach((value, columnIndex) => { ws.getCell(subtotalRow, columnIndex + 1).value = value; });
    ws.mergeCells(subtotalRow, 4, subtotalRow, 5);
    ws.getCell(subtotalRow, 7).value = {
      formula: `SUM(G${groupStartRow}:G${groupEndRow})`,
      result: group.rows.reduce((sum, row) => sum + num(row.confirmation?.confirmed_qty ?? row.qty), 0),
    };
    ws.getCell(subtotalRow, 7).numFmt = '#,##0';
    ws.getCell(subtotalRow, 8).value = {
      formula: `SUM(H${groupStartRow}:H${groupEndRow})`,
      result: group.rows.reduce((sum, row) => sum + num(row.confirmation?.confirmed_price ?? row.quoted_price), 0),
    };
    ws.getCell(subtotalRow, 8).numFmt = '#,##0.0000';
    QUOTE_COMPONENTS.forEach(([key], componentIndex) => {
      const startColumn = 9 + componentIndex * 4;
      const beforeTaxCell = ws.getCell(subtotalRow, startColumn);
      const afterTaxCell = ws.getCell(subtotalRow, startColumn + 1);
      const amountCell = ws.getCell(subtotalRow, startColumn + 2);
      const shareCell = ws.getCell(subtotalRow, startColumn + 3);
      const detailBeforeTaxColumn = ws.getColumn(startColumn).letter;
      const detailAfterTaxColumn = ws.getColumn(startColumn + 1).letter;
      const detailAmountColumn = ws.getColumn(startColumn + 2).letter;
      const detailShareColumn = ws.getColumn(startColumn + 3).letter;
      beforeTaxCell.value = {
        formula: `SUM(${detailBeforeTaxColumn}${groupStartRow}:${detailBeforeTaxColumn}${groupEndRow})`,
        result: componentBeforeTaxTotals[key],
      };
      beforeTaxCell.numFmt = '#,##0.0000';
      afterTaxCell.value = {
        formula: `SUM(${detailAfterTaxColumn}${groupStartRow}:${detailAfterTaxColumn}${groupEndRow})`,
        result: componentAfterTaxTotals[key],
      };
      afterTaxCell.numFmt = '#,##0.0000';
      amountCell.value = {
        formula: `SUM(${detailAmountColumn}${groupStartRow}:${detailAmountColumn}${groupEndRow})`,
        result: componentAmountTotals[key],
      };
      amountCell.numFmt = '#,##0.00';
      shareCell.value = {
        formula: `SUM(${detailShareColumn}${groupStartRow}:${detailShareColumn}${groupEndRow})`,
        result: componentShareTotals[key],
      };
      shareCell.numFmt = '0.00%';
    });
    const subtotalShareCells = QUOTE_COMPONENTS.map((_, componentIndex) => (
      ws.getCell(subtotalRow, 12 + componentIndex * 4).address
    ));
    const subtotalShareTotal = Object.values(componentShareTotals).reduce((sum, share) => sum + share, 0);
    ws.getCell(subtotalRow, totalShareColumn).value = {
      formula: `SUM(${subtotalShareCells.join(',')})`,
      result: subtotalShareTotal,
    };
    ws.getCell(subtotalRow, totalShareColumn).numFmt = '0.00%';
    ws.getRow(subtotalRow).height = Math.max(22, wrappedLineCount(group.customer, 18) * 15);
    for (let columnIndex = 1; columnIndex <= totalColumns; columnIndex += 1) {
      const cell = ws.getCell(subtotalRow, columnIndex);
      cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF0B4369' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBFA' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF3B82F6' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
      cell.alignment = { vertical: 'middle', horizontal: columnIndex <= 8 ? 'center' : 'right' };
    }
    targetRow += 1;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, targetRow - 1), column: totalColumns } };
  [8, 18, 18, 16, 24, 14, 18, 15].forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  QUOTE_COMPONENTS.forEach((_, componentIndex) => {
    const startColumn = 9 + componentIndex * 4;
    ws.getColumn(startColumn).width = 11;
    ws.getColumn(startColumn + 1).width = 12;
    ws.getColumn(startColumn + 2).width = 14;
    ws.getColumn(startColumn + 3).width = 11;
  });
  ws.getColumn(totalShareColumn).width = 14;
  [13, 14, 19, 26].forEach((width, index) => { ws.getColumn(totalShareColumn + 1 + index).width = width; });
  return wb;
}

function buildDetailedSummaryWorkbook(rows, filters = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '内部报价系统'; wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true; wb.calcProperties.forceFullCalc = true; wb.calcProperties.calcMode = 'auto';
  const ws = wb.addWorksheet('各客报价汇总', { views: [{ state: 'frozen', ySplit: 4, xSplit: 3, showGridLines: false }] });
  const workflow = [['confirmation_status','客价确认'], ['confirmed_by','确认人'], ['confirmed_at','确认时间'], ['note','备注']];
  const columns = [...BASE_SUMMARY_COLUMNS, ...SUMMARY_COLUMNS, ...workflow];
  const columnByKey = Object.fromEntries(columns.map(([key], index) => [key, index + 1]));
  const headerFillFor = (key, index) => {
    if (index < BASE_SUMMARY_COLUMNS.length) return 'FFFFFFFF';
    if (workflow.some(([workflowKey]) => workflowKey === key)) return 'FFFFE699';
    if (/^(injection_labor|assembly_labor|painting_labor)/.test(key)) return 'FFD9EAF7';
    if (/^(imp_mat|dom_mat|raw_material|abs_material|total_purchase_price)/.test(key)) return 'FFE2F0D9';
    if (/^(color_box|libao|suction|carton)/.test(key)) return 'FFFFF2CC';
    if (/^(plating|electronic|battery|hardware)/.test(key)) return 'FFE4DFEC';
    if (/^(slush|sewing_hair|sewing_cloth|paint_material)/.test(key)) return 'FFFCE4D6';
    if (/^(other_buy|misc|freight|cabinet|surtax|rmb_purchase)/.test(key)) return 'FFDDEBF7';
    if (/^(production_|total_)/.test(key)) return 'FFD9EAD3';
    return 'FFF4CCCC';
  };
  const ref = (key, row) => `${ws.getColumn(columnByKey[key]).letter}${row}`;
  const rawKeys = ['injection_labor','assembly_labor','painting_labor','imp_mat','dom_mat','color_box','libao','suction','carton','plating','electronic','battery','hardware','slush','sewing_hair','sewing_cloth','paint_material','other_buy','misc','freight','cabinet'];
  const formulaFor = (key, row, source) => {
    const qty=ref('qty',row), price=ref('quoted_price',row);
    const rawSum=`SUM(${rawKeys.map(k=>ref(k,row)).join(',')})+${num(source.components_before_tax?.blow)+num(source.components_before_tax?.glue_bag)+num(source.components_before_tax?.motor)}`;
    const labor=`SUM(${ref('injection_labor',row)},${ref('assembly_labor',row)},${ref('painting_labor',row)})`;
    const componentAfter = key.match(/^(.+)_after_tax$/);
    if (componentAfter && columnByKey[componentAfter[1]]) {
      const base=componentAfter[1], rate=num(TAX_DEDUCTION_RATES[base]);
      return rate?`${ref(base,row)}*(1-${rate}%)`:ref(base,row);
    }
    const componentAmount = key.match(/^(.+)_amount$/);
    if (componentAmount && columnByKey[`${componentAmount[1]}_after_tax`]) return `${ref(`${componentAmount[1]}_after_tax`,row)}*${qty}`;
    const componentShare = key.match(/^(.+)_share$/);
    if (componentShare && columnByKey[`${componentShare[1]}_after_tax`]) return `IF(${price}=0,0,${ref(`${componentShare[1]}_after_tax`,row)}/${price})`;
    const formulas = {
      raw_material_after_tax:`${ref('imp_mat',row)}+${ref('dom_mat',row)}*(1-11.5%)`,
      raw_material_amount:`${ref('raw_material_after_tax',row)}*${qty}`,
      raw_material_share:`IF(${price}=0,0,${ref('raw_material_after_tax',row)}/${price})`,
      abs_material_share:`IF(${price}=0,0,${ref('abs_material_cost',row)}/${price})`,
      total_purchase_price:`SUM(${['color_box','libao','suction','carton','plating','electronic','battery','hardware','slush','sewing_hair','sewing_cloth','paint_material','other_buy','misc'].map(k=>ref(k,row)).join(',')})`,
      freight_after_tax:`${ref('freight',row)}*(1-8.26%)+${ref('cabinet',row)}`,
      freight_amount:`${ref('freight_after_tax',row)}*${qty}`,
      freight_share:`IF(${price}=0,0,${ref('freight_after_tax',row)}/${price})`,
      surtax_04:`${price}*0.4%`,
      rmb_purchase_cost:`SUM(${['misc','other_buy','paint_material','sewing_cloth','sewing_hair','hardware','battery','electronic','plating','carton','libao','color_box','dom_mat'].map(k=>ref(k,row)).join(',')})`,
      rmb_purchase_share:`IF(${price}=0,0,${ref('rmb_purchase_cost',row)}/${price})`,
      gross_before_tax:`${price}-(${rawSum}-${labor})`, gross_before_tax_rate:`IF(${price}=0,0,${ref('gross_before_tax',row)}/${price})`,
      profit_before_tax:`${price}-${rawSum}`, profit_before_tax_rate:`IF(${price}=0,0,${ref('profit_before_tax',row)}/${price})`,
      markup_before_tax:`IF(${rawSum}=0,0,${price}/(${rawSum}))`, tax_1_cost:ref('plating',row), labor_13_cost:`(${labor})*8%`,
      freight_9_cost:ref('freight',row),
      tax_13_cost:`SUM(${['color_box','libao','battery','paint_material','dom_mat','hardware','other_buy'].map(k=>ref(k,row)).join(',')})`,
      carton_13_cost:ref('carton',row), slush_3_cost:ref('slush',row), hair_13_cost:ref('sewing_hair',row), cloth_13_cost:ref('sewing_cloth',row), suction_6_cost:ref('suction',row),
      rebate_reduction:`${ref('tax_1_cost',row)}*0.99%+${ref('labor_13_cost',row)}*11.5%+${ref('freight_9_cost',row)}*8.26%+${ref('tax_13_cost',row)}*11.5%+${ref('carton_13_cost',row)}/1.1*11.5%+${ref('slush_3_cost',row)}*3%+${ref('hair_13_cost',row)}*11.5%+${ref('cloth_13_cost',row)}*11.5%+${ref('suction_6_cost',row)}*6%`,
      cost_after_rebate:`${rawSum}-${ref('rebate_reduction',row)}`,
      markup_after_tax:`IF(${ref('cost_after_rebate',row)}=0,0,${price}/${ref('cost_after_rebate',row)})`,
      raw_cost_after_tax:ref('raw_material_after_tax',row), labor_cost_after_tax:`${labor}-${ref('labor_13_cost',row)}*11.5%`,
      no_labor_cost_after_tax:`${ref('cost_after_rebate',row)}-${ref('labor_cost_after_tax',row)}`,
      gross_after_tax:`${price}-${ref('no_labor_cost_after_tax',row)}`, gross_after_tax_rate:`IF(${price}=0,0,${ref('gross_after_tax',row)}/${price})`,
      profit_after_tax:`${price}-${ref('cost_after_rebate',row)}`, profit_after_tax_rate:`IF(${price}=0,0,${ref('profit_after_tax',row)}/${price})`,
      production_amount:`${price}*${qty}`, production_cost:`(${rawSum})*${qty}`,
      total_gross_before_tax:`${ref('gross_before_tax',row)}*${qty}`, total_gross_before_tax_rate:ref('gross_before_tax_rate',row),
      total_profit_before_tax:`${ref('profit_before_tax',row)}*${qty}`, total_profit_before_tax_rate:ref('profit_before_tax_rate',row),
      total_raw_before_tax:`(${ref('imp_mat',row)}+${ref('dom_mat',row)})*${qty}`, total_raw_before_tax_share:`IF(${ref('production_amount',row)}=0,0,${ref('total_raw_before_tax',row)}/${ref('production_amount',row)})`,
      total_labor_before_tax:`(${labor})*${qty}`, total_labor_before_tax_share:`IF(${ref('production_amount',row)}=0,0,${ref('total_labor_before_tax',row)}/${ref('production_amount',row)})`,
      total_rmb_purchase:`${ref('rmb_purchase_cost',row)}*${qty}`, total_rmb_purchase_share:`IF(${ref('production_amount',row)}=0,0,${ref('total_rmb_purchase',row)}/${ref('production_amount',row)})`,
      total_rebate_reduction:`${ref('rebate_reduction',row)}*${qty}`,
      total_no_labor_after_tax:`${ref('no_labor_cost_after_tax',row)}*${qty}`, total_no_labor_after_tax_share:`IF(${ref('production_amount',row)}=0,0,${ref('total_no_labor_after_tax',row)}/${ref('production_amount',row)})`,
      total_gross_after_tax:`${ref('gross_after_tax',row)}*${qty}`, total_gross_after_tax_rate:ref('gross_after_tax_rate',row),
      total_profit_after_tax:`${ref('profit_after_tax',row)}*${qty}`, total_profit_after_tax_rate:ref('profit_after_tax_rate',row),
      total_raw_after_tax:`${ref('raw_cost_after_tax',row)}*${qty}`, total_raw_after_tax_share:`IF(${ref('production_amount',row)}=0,0,${ref('total_raw_after_tax',row)}/${ref('production_amount',row)})`,
      total_labor_after_tax:`${ref('labor_cost_after_tax',row)}*${qty}`, total_labor_after_tax_share:`IF(${ref('production_amount',row)}=0,0,${ref('total_labor_after_tax',row)}/${ref('production_amount',row)})`,
      amount_share_total:`SUM(${AMOUNT_SHARE_KEYS.map(key=>ref(key,row)).join(',')})`,
    };
    return formulas[key] || null;
  };
  ws.pageSetup = { orientation:'landscape', paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0,
    margins:{left:.2,right:.2,top:.35,bottom:.35,header:.1,footer:.1} };
  ws.mergeCells(1, 2, 1, columns.length); ws.getCell(1,1).value=`${new Date().getFullYear()}年`;
  ws.getCell(1,2).value='各客产品报价汇总表'; ws.getCell(1,2).font={bold:true,size:16,name:'Microsoft YaHei'};
  ws.mergeCells(2,1,2,columns.length); ws.getCell(2,1).value=`客户：${filters.customer||'全部'}    导出日期：${new Date().toLocaleDateString('zh-CN')}`;
  const border = { top:{style:'thin',color:{argb:'FF94A3B8'}}, left:{style:'thin',color:{argb:'FF94A3B8'}}, bottom:{style:'thin',color:{argb:'FF94A3B8'}}, right:{style:'thin',color:{argb:'FF94A3B8'}} };
  columns.forEach(([key,label],i)=>{ const c=ws.getCell(4,i+1); c.value=label; c.font={bold:true,color:{argb:'FF153A5B'},name:'Microsoft YaHei'}; c.alignment={horizontal:'center',vertical:'middle',wrapText:true}; c.border=border; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:headerFillFor(key,i)}}; });
  ws.getRow(4).height=52;
  let rowNo=5;
  groupSummaryRows(rows).forEach(group=>{
    const start=rowNo;
    group.rows.forEach((row,index)=>{
      const confirmation=row.confirmation||{};
      const qty=num(confirmation.confirmed_qty??row.qty), price=num(confirmation.confirmed_price??row.quoted_price);
      const workshop=(confirmation.workshops||[]).map(code=>(WORKSHOPS.find(x=>x[0]===code)||[,code])[1]).join('、');
      const base={serial:index+1,customer:row.customer,workshop,quote_no:row.quote_no,product_name:row.product_name,created_at:row.created_at?new Date(row.created_at):'',qty,quoted_price:price,
        confirmation_status:confirmation.status==='confirmed'?'已确认':'待确认',confirmed_by:confirmation.confirmed_by||'',confirmed_at:confirmation.confirmed_at?new Date(confirmation.confirmed_at):'',note:confirmation.note||''};
      const values=calculateSummaryValues(row.components_before_tax,row.components,qty,price,row.abs_material_cost);
      row.summary_values = values;
      columns.forEach(([key,,type],i)=>{
        const c=ws.getCell(rowNo,i+1); const value=Object.hasOwn(base,key)?base[key]:values[key];
        const formula=!Object.hasOwn(base,key) ? formulaFor(key,rowNo,row) : null;
        c.value=formula?{formula,result:num(value)}:value;
        c.font={name:'Microsoft YaHei',size:9}; c.alignment={vertical:'middle',wrapText:true}; c.border=border;
        c.fill={type:'pattern',pattern:'solid',fgColor:{argb:index%2?'FFF7FAFC':'FFFFFFFF'}};
        if(type==='percent') c.numFmt='0.00%'; else if(['unit','price','number'].includes(type)) c.numFmt='#,##0.0000'; else if(['amount','qty'].includes(type)) c.numFmt='#,##0.00'; else if(type==='date') c.numFmt='yyyy-mm-dd';
      });
      const statusCell=ws.getCell(rowNo,columnByKey.confirmation_status);
      statusCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:confirmation.status==='confirmed'?'FFC6EFCE':'FFFFEB9C'}};
      statusCell.font={name:'Microsoft YaHei',size:9,bold:true,color:{argb:confirmation.status==='confirmed'?'FF006100':'FF9C6500'}};
      ws.getRow(rowNo).height=Math.max(24,wrappedLineCount(row.customer,18)*15,wrappedLineCount(row.product_name,22)*15); rowNo++;
    });
    const end=rowNo-1, subtotal=rowNo;
    ws.getCell(subtotal,1).value=''; ws.getCell(subtotal,2).value=group.customer; ws.getCell(subtotal,4).value='客户总计'; ws.mergeCells(subtotal,4,subtotal,5);
    columns.forEach(([,,type],i)=>{
      const c=ws.getCell(subtotal,i+1); const letter=ws.getColumn(i+1).letter;
      if(i>=6 && !['text','date','link','workshop','serial'].includes(type)) {
        const key=columns[i][0];
        const result=group.rows.reduce((s,r)=>s+num(key==='qty'?(r.confirmation?.confirmed_qty??r.qty):key==='quoted_price'?(r.confirmation?.confirmed_price??r.quoted_price):(r.summary_values||{})[key]),0);
        c.value={formula:`SUM(${letter}${start}:${letter}${end})`,result};
      }
      c.font={name:'Microsoft YaHei',size:9,bold:true,color:{argb:'FF0B4369'}}; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEBFA'}}; c.border=border; c.alignment={vertical:'middle',wrapText:true};
      if(type==='percent') c.numFmt='0.00%'; else if(['unit','price','number'].includes(type)) c.numFmt='#,##0.0000'; else if(['amount','qty'].includes(type)) c.numFmt='#,##0.00';
    }); ws.getRow(subtotal).height=Math.max(24,wrappedLineCount(group.customer,18)*15); rowNo++;
  });
  columns.forEach(([,,type],i)=>{ ws.getColumn(i+1).width=i===1?20:i===2?16:i===4?22:type==='percent'?12:type==='amount'?15:13; });
  ws.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,rowNo-1),column:columns.length}};
  return wb;
}

module.exports = {
  WORKSHOPS, QUOTE_COMPONENTS, TAX_DEDUCTION_RATES, BASE_SUMMARY_COLUMNS, SUMMARY_COLUMNS,
  afterTaxComponents, calculateSummaryValues, groupSummaryRows, buildQuoteSummary,
  buildSummaryWorkbook: buildDetailedSummaryWorkbook, parseJson,
};
