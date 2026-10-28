// All transaction values in these fixtures are invented. No private workbook is read.
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

export const date = (year = 2026, month = 10, day = 12) => new Date(Date.UTC(year, month - 1, day));

export function workbookBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, Array.isArray(sheet) ? XLSX.utils.aoa_to_sheet(sheet) : sheet, name);
  }
  // The source parser supports Excel's shared string representation.
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', bookSST: true });
}

export const templateBuffer = (path) => {
  const buffer = readFileSync(new URL(`../public/${path}`, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

export const emptyBase = () => workbookBuffer({ '合成母版说明': [['Synthetic test base']] });

export function intlSheet({ inv = '91001', when = date(), lines = [['TEST-SKU', 'Synthetic long description', null, 10, null, null, 2.5]], total = 25 } = {}) {
  const rows = [
    [null, null, null, null, null, null, inv],
    ['ZURU INC'],
    [null, null, null, null, null, null, when],
    [null, 'PO NO:TEST-PO'],
    [],
    ...lines,
    ['TOTAL', null, null, null, null, null, null, 'USD', total],
    [null, 'BANK NAME'],
  ];
  return rows;
}

export function usSheet({ inv = 'ZB91001', when = date(), qty = 5, unit = 4, total = qty * unit } = {}) {
  return [
    ['Synthetic source invoice'],
    [null, null, null, null, null, null, null, 'Date:', null, when],
    [null, null, null, null, null, null, null, 'Inv No:', null, inv],
    [null, null, null, null, null, null, null, 'ZURU PO#:', null, 'TEST-US-PO'],
    [],
    ['No.', null, 'SKU No.', null, 'Description', null, null, 'Quantity', 'Price'],
    [1, null, 'TEST-US-SKU', null, 'Synthetic description', null, null, qty, unit],
    ['Total Amount', null, null, null, null, null, null, null, null, total],
  ];
}

export const detailHeader = ['发票日期', 'PO', 'DESCRIPTION', '货号', '数量', '单价USD', '金额USD', null, '发票号'];
export function detailRow({ inv = '92001', when = date(), code = 'TEST-OTHER-SKU', qty = 2, unit = 10, amount = qty * unit, po = 'TEST-PO' } = {}) {
  return [when, po, 'Synthetic goods', code, qty, unit, amount, null, inv];
}

export const cellOf = (xml, ref) => xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`))?.[0] || '';
