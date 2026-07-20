'use strict';

const ExcelJS = require('exceljs');

function toStr(value) {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map(item => item.text || '').join('').trim();
  }
  if (typeof value === 'object' && value.text != null) return String(value.text).trim();
  if (typeof value === 'object' && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

function toNum(value) {
  const text = toStr(value).replace(/[,，￥¥]/g, '').trim();
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function compact(value) {
  return toStr(value).replace(/\s+/g, '').replace(/[：:]/g, ':');
}

function rowValues(row) {
  const values = [];
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    values[column] = cell.value;
  });
  return values;
}

function findAdjacentValue(values, labelPattern) {
  for (let column = 1; column < values.length; column++) {
    if (!labelPattern.test(compact(values[column]))) continue;
    for (let next = column + 1; next < values.length; next++) {
      const value = toStr(values[next]);
      if (value) return value;
    }
  }
  return '';
}

async function parseWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  let selected = null;
  let rows = null;
  let headerRow = -1;
  for (const worksheet of workbook.worksheets) {
    const candidateRows = [];
    worksheet.eachRow({ includeEmpty: true }, row => candidateRows.push(rowValues(row)));
    const candidateHeader = candidateRows.findIndex(values => {
      const labels = values.map(compact);
      return labels.includes('项目') && labels.includes('名称')
        && labels.includes('规格') && labels.includes('用量');
    });
    if (candidateHeader >= 0) {
      selected = worksheet;
      rows = candidateRows;
      headerRow = candidateHeader;
      break;
    }
  }

  if (!selected) {
    return { error: '未识别到联翔电子表头（需要包含 项目/名称/规格/用量）' };
  }

  const allText = rows.map(values => values.map(toStr).join(' ')).join('\n');
  const quoteMatch = allText.match(/报价金额\s*RMB\s*[：:]\s*([\d,.]+)\s*\/\s*套/i);
  const otpMatch = allText.match(/OTP\s*单价\s*[：:]\s*([\d,.]+)\s*\/\s*片/i);
  const quotedPrice = quoteMatch ? toNum(quoteMatch[1]) : 0;
  const otpPrice = otpMatch ? toNum(otpMatch[1]) : 0;
  const totalPrice = quotedPrice + otpPrice;

  const meta = { supplier: toStr(rows[0] && rows[0][1]) };
  for (let i = 0; i < headerRow; i++) {
    const values = rows[i] || [];
    meta.customer ||= findAdjacentValue(values, /^客户:?$/);
    meta.quote_no ||= findAdjacentValue(values, /^编号:?$/);
    meta.date ||= findAdjacentValue(values, /^报价日期:?$/);
    meta.product ||= findAdjacentValue(values, /^产品名称:?$/);
    meta.product_no ||= findAdjacentValue(values, /^产品编号:?$/);
  }
  Object.keys(meta).forEach(key => { if (!meta[key]) delete meta[key]; });

  const header = rows[headerRow].map(compact);
  const column = label => header.indexOf(label);
  const columns = {
    name: column('名称'),
    spec: column('规格'),
    qty: column('用量'),
    note: column('备注'),
  };

  const parts = [];
  let otherFeesHeader = -1;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const values = rows[i] || [];
    const first = values.map(toStr).find(Boolean) || '';
    if (/^其它费用$/.test(first.replace(/\s+/g, ''))) {
      otherFeesHeader = i + 1;
      break;
    }
    if (/^(备注|確認回簽|确认回签)/.test(first)) break;

    const name = toStr(values[columns.name]);
    const spec = toStr(values[columns.spec]);
    const qty = toNum(values[columns.qty]);
    const note = toStr(values[columns.note]);
    if (!name || (!spec && qty == null)) continue;
    const isChip = /(?:^|\b)IC(?:\b|$)|芯片/i.test(name) || /(?:^|\b)IC(?:\b|$)|芯片/i.test(spec);
    const unitPrice = isChip && otpPrice > 0 ? otpPrice : 0;
    parts.push({
      name,
      spec,
      qty: qty == null ? 1 : qty,
      unit_price: unitPrice,
      amount: (qty == null ? 1 : qty) * unitPrice,
      note,
      children: [],
    });
  }

  const otherFees = [];
  if (otherFeesHeader >= 0 && rows[otherFeesHeader]) {
    const feeHeader = rows[otherFeesHeader].map(compact);
    const feeColumns = {
      name: feeHeader.indexOf('名称'),
      qty: feeHeader.indexOf('数量'),
      unitPrice: feeHeader.findIndex(value => /^单价/.test(value)),
      note: feeHeader.indexOf('备注'),
    };
    for (let i = otherFeesHeader + 1; i < rows.length; i++) {
      const values = rows[i] || [];
      const first = values.map(toStr).find(Boolean) || '';
      if (/^(备注|確認回簽|确认回签)/.test(first)) break;
      const name = toStr(values[feeColumns.name]);
      if (!name) continue;
      const qty = toNum(values[feeColumns.qty]) || 0;
      const unitPrice = toNum(values[feeColumns.unitPrice]) || 0;
      const note = toStr(values[feeColumns.note]);
      if (!qty && !unitPrice && !note) continue;
      otherFees.push({ name, qty, unit_price: unitPrice, amount: qty * unitPrice, note });
    }
  }

  if (!parts.length) return { error: '未解析到联翔电子物料行' };

  const moldFeeRmb = otherFees
    .filter(fee => /模具|模费/.test(fee.name))
    .reduce((total, fee) => total + fee.amount, 0);

  return {
    source_format: 'lianxiang',
    sheet_used: selected.name,
    count: parts.length,
    meta,
    parts,
    extras: {
      quoted_price_rmb: quotedPrice,
      total_price_rmb: totalPrice,
      taxed_price: totalPrice,
      otp_price_rmb: otpPrice,
      mold_fee_rmb: moldFeeRmb,
      other_fees: otherFees,
      test_repair: 0,
      packing_shipping: 0,
      profit_pct: 0,
      tax_diff: 0,
      tax_payable: 0,
    },
  };
}

module.exports = { parseWorkbook };
