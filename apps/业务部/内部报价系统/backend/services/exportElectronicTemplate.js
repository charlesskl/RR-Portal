'use strict';

const FONT = 'Microsoft YaHei';
const WHITE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const HIGHLIGHT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
const BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

const num = value => Number(value) || 0;
const sum = (rows, getter) => (rows || []).reduce((total, item) => total + num(getter(item)), 0);

function cleanMetaValue(value, label) {
  const text = String(value || '').replace(new RegExp(`^${label}[：:]\\s*`), '').trim();
  return /^(产品名称|产品编号|客户|报价日期)[：:]/.test(text) ? '' : text;
}

function getExportDateText(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const valueOf = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${valueOf('year')}.${valueOf('month')}.${valueOf('day')}`;
}

function sourceUnit(part) {
  return part && part.source_unit_price != null ? num(part.source_unit_price) : num(part && part.unit_price);
}

function styleRow(ws, row, { fill = WHITE, bold = false } = {}) {
  for (let column = 1; column <= 6; column += 1) {
    const cell = ws.getCell(row, column);
    cell.fill = fill;
    cell.border = BORDER;
    cell.font = { name: FONT, size: 11, bold, color: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}

function setSummaryRow(ws, row, label, value, currency, options = {}) {
  styleRow(ws, row, options);
  ws.getCell(row, 4).value = label;
  ws.getCell(row, 4).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell(row, 5).value = value;
  ws.getCell(row, 5).numFmt = '#,##0.0000';
  ws.getCell(row, 5).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell(row, 6).value = currency;
  ws.getCell(row, 6).alignment = { horizontal: 'left', vertical: 'middle' };
}

function addElectronicTemplateSheet(workbook, electronic, quote) {
  const doc = electronic && electronic.electronics_doc;
  if (!doc || !Array.isArray(doc.parts) || !doc.parts.length) return;

  const currency = doc.source_currency || 'RMB';
  const extras = doc.source_extras || doc.extras || {};
  const meta = doc.meta || {};
  const ws = workbook.addWorksheet('电子明细');
  ws.columns = [
    { width: 17 },
    { width: 68 },
    { width: 7 },
    { width: 12 },
    { width: 12 },
    { width: 37 },
  ];

  const mergedLine = (row, value, font, alignment = {}) => {
    ws.mergeCells(row, 1, row, 6);
    const cell = ws.getCell(row, 1);
    cell.value = value;
    cell.font = { name: FONT, color: { argb: 'FF000000' }, ...font };
    cell.alignment = { horizontal: 'center', vertical: 'middle', ...alignment };
  };

  mergedLine(1, '东莞市登信电子有限公司', { bold: true, size: 26 });
  mergedLine(2, '香港地址:九龙尖沙咀科学馆道1号康宏广场南座12字楼07-08室　国内地址：东莞市清溪镇上元管理区登信厂', { size: 11 });
  mergedLine(3, 'TEL:(852)24250720  FAX:(852)24243407            TEL:0769-87312864   FAX:0769-87312894', { size: 11 });
  mergedLine(4, '电子报价单', { bold: true, size: 18 });
  ws.getRow(1).height = 33;
  ws.getRow(4).height = 24;

  styleRow(ws, 5);
  const product = cleanMetaValue(meta.product, '产品名称') || (quote && quote.product_name) || '';
  const productNo = cleanMetaValue(meta.product_no, '产品编号') || (quote && quote.quote_no) || '';
  const customer = cleanMetaValue(meta.customer, '客户') || (quote && quote.customer) || '';
  const quoteDate = getExportDateText();
  ws.mergeCells(5, 1, 5, 6);
  ws.getCell(5, 1).value = [
    `产品名称：${product}`,
    `产品编号：${productNo}`,
    `客户：${customer}`,
    `报价日期：${quoteDate}`,
  ].join('          ');
  ws.getCell(5, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(5).height = 24;

  const headers = ['零件名称', '规格', '用量', `单价${currency}`, `合计${currency}`, '备注'];
  styleRow(ws, 6, { bold: true });
  headers.forEach((header, index) => {
    const cell = ws.getCell(6, index + 1);
    cell.value = header;
    cell.font = { name: FONT, size: 12, bold: true, color: { argb: 'FF000000' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getRow(6).height = 24;

  let row = 7;
  const dataStart = row;
  const writePart = (part, child = false) => {
    styleRow(ws, row);
    ws.getCell(row, 1).value = child ? '' : (part.name || '');
    ws.getCell(row, 2).value = part.spec || part.specification || '';
    ws.getCell(row, 3).value = num(part.qty);
    ws.getCell(row, 4).value = sourceUnit(part);
    ws.getCell(row, 5).value = {
      formula: `C${row}*D${row}`,
      result: num(part.qty) * sourceUnit(part),
    };
    ws.getCell(row, 6).value = part.note || '';
    ws.getCell(row, 3).numFmt = '0';
    ws.getCell(row, 4).numFmt = '#,##0.0000';
    ws.getCell(row, 5).numFmt = '#,##0.0000';
    [1, 2, 6].forEach(column => {
      ws.getCell(row, column).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    });
    [3, 4, 5].forEach(column => {
      ws.getCell(row, column).alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws.getRow(row).height = 20;
    row += 1;
  };

  doc.parts.forEach(part => {
    writePart(part);
    (part.children || []).forEach(child => writePart(child, true));
  });
  const dataEnd = row - 1;
  ws.views = [{ state: 'frozen', ySplit: 6, activeCell: 'A7', showGridLines: false }];

  (extras.mold_fees || []).forEach(fee => {
    styleRow(ws, row);
    ws.getCell(row, 2).value = `${fee.name || '模费'}：${fee.currency || currency} ${num(fee.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    ws.getCell(row, 2).alignment = { horizontal: 'left', vertical: 'middle' };
    row += 1;
  });

  row += 1;
  const partsCost = sum(doc.parts, part => num(part.qty) * sourceUnit(part)
    + sum(part.children || [], child => num(child.qty) * sourceUnit(child)));
  const costs = [
    ['零件成本', partsCost, `SUM(E${dataStart}:E${dataEnd})`],
    ['邦定成本', num(extras.bonding_cost)],
    ['贴片成本', num(extras.smt_cost)],
    ['人工成本', num(extras.labor_cost)],
    ['测试费用', num(extras.test_repair)],
    ['包装运输', num(extras.packing_shipping)],
  ];
  const summaryStart = row;
  costs.forEach(([label, result, formula]) => {
    setSummaryRow(ws, row, label, formula ? { formula, result } : result, currency);
    row += 1;
  });

  const totalCost = costs.reduce((total, entry) => total + num(entry[1]), 0);
  setSummaryRow(ws, row, '合计成本', {
    formula: `SUM(E${summaryStart}:E${row - 1})`,
    result: totalCost,
  }, currency, { bold: true });
  ws.getCell(row, 2).value = '此报价为ROHS+6P不含利润';
  const totalCostRow = row;
  row += 1;

  const profitPct = num(extras.profit_pct);
  const profitPrice = extras.profit_price != null
    ? num(extras.profit_price)
    : totalCost * (1 + profitPct / 100);
  setSummaryRow(ws, row, '含利润价', {
    formula: `E${totalCostRow}*(1+${profitPct}/100)`,
    result: profitPrice,
  }, `${currency} 不含税价`, { fill: HIGHLIGHT, bold: true });
  ws.getCell(row, 2).value = `含 ${profitPct}% 利润价（月结以此价为准）`;
  const profitRow = row;
  row += 1;

  setSummaryRow(ws, row, '抵税差额', num(extras.tax_diff), currency);
  const taxDiffRow = row;
  row += 1;
  setSummaryRow(ws, row, '应交税负', num(extras.tax_payable), currency);
  const taxPayableRow = row;
  row += 1;

  const taxedPrice = extras.taxed_price != null
    ? num(extras.taxed_price)
    : profitPrice + num(extras.tax_diff) + num(extras.tax_payable);
  setSummaryRow(ws, row, '含税报价', {
    formula: `E${profitRow}+E${taxDiffRow}+E${taxPayableRow}`,
    result: taxedPrice,
  }, `${currency} 含税价`, { fill: HIGHLIGHT, bold: true });
  row += 1;

  styleRow(ws, row);
  ws.getCell(row, 2).value = `注：此报价按 MOQ：${meta.moq || (quote && quote.qty) || ''} 数量报价`;
  ws.getCell(row, 2).alignment = { horizontal: 'left', vertical: 'middle' };

  const otherFees = extras.other_fees || [];
  if (otherFees.length) {
    row += 2;
    styleRow(ws, row, { bold: true });
    ws.getCell(row, 1).value = '其它费用（不计入单套电子成本）';
    row += 1;
    const feeHeaders = ['费用名称', '数量', '单价 RMB', '合计 RMB', '备注'];
    styleRow(ws, row, { bold: true });
    feeHeaders.forEach((header, index) => {
      ws.getCell(row, index + 1).value = header;
      ws.getCell(row, index + 1).alignment = { horizontal: 'center', vertical: 'middle' };
    });
    row += 1;
    const feeStart = row;
    otherFees.forEach(fee => {
      styleRow(ws, row);
      const amount = num(fee.amount) || num(fee.qty) * num(fee.unit_price);
      ws.getCell(row, 1).value = fee.name || '';
      ws.getCell(row, 2).value = num(fee.qty);
      ws.getCell(row, 3).value = num(fee.unit_price);
      ws.getCell(row, 4).value = amount;
      ws.getCell(row, 5).value = fee.note || '';
      ws.getCell(row, 2).numFmt = '0';
      ws.getCell(row, 3).numFmt = '#,##0.00';
      ws.getCell(row, 4).numFmt = '#,##0.00';
      row += 1;
    });
    styleRow(ws, row, { fill: HIGHLIGHT, bold: true });
    ws.getCell(row, 1).value = '其它费用合计';
    ws.getCell(row, 4).value = {
      formula: `SUM(D${feeStart}:D${row - 1})`,
      result: sum(otherFees, fee => num(fee.amount) || num(fee.qty) * num(fee.unit_price)),
    };
    ws.getCell(row, 4).numFmt = '#,##0.00';
  }
}

module.exports = { addElectronicTemplateSheet };
