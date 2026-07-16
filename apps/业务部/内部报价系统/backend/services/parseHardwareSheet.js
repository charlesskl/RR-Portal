// 解析“五金/外购件报价单”型 xls/xlsx。
// 常见表头：零件名称 / 配件用处 / 规格 / 用量 / 单位 / 单价RMB / 总价 / 备注。
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map(x => x.text).join('').trim();
  if (typeof v === 'object' && v.text != null) return String(v.text).trim();
  if (typeof v === 'object' && v.result != null) return String(v.result).trim();
  return String(v).trim();
}

function toNum(v) {
  if (v == null || v === '') return null;
  const raw = typeof v === 'object' && v.result != null ? v.result : v;
  const n = Number(String(raw).replace(/[￥¥$,，\s元RMB]/gi, ''));
  return Number.isFinite(n) ? n : null;
}

function norm(v) {
  return toStr(v).replace(/\s+/g, '').toUpperCase();
}

function isHeader(row) {
  const text = (row || []).map(norm).join('|');
  return /(零件名称|零件名稱|PARTNAME)/.test(text)
    && /(用量|数量|數量|QTY|QUANTITY)/.test(text)
    && /(单价|單價|UNITPRICE)/.test(text);
}

function indexHeader(row) {
  const cols = {};
  (row || []).forEach((value, index) => {
    const s = norm(value);
    if (!s) return;
    if (cols.name == null && /(零件名称|零件名稱|PARTNAME)/.test(s)) cols.name = index;
    else if (cols.spec == null && /(规格|規格|SPEC)/.test(s)) cols.spec = index;
    else if (cols.qty == null && /(用量|数量|數量|QTY|QUANTITY)/.test(s)) cols.qty = index;
    else if (cols.unitPrice == null && /(单价RMB|單價RMB|RMB单价|RMB單價|UNITPRICE)/.test(s)) cols.unitPrice = index;
    else if (cols.note == null && /(备注|備註|REMARK)/.test(s)) cols.note = index;
  });
  return cols;
}

function sheetjsRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }).map(row => {
    const values = [];
    (row || []).forEach((value, index) => { values[index + 1] = value; });
    return values;
  });
}

async function readSheets(buffer) {
  const sheets = [];
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    for (const sheet of workbook.worksheets || []) {
      const rows = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const values = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => { values[column] = cell.value; });
        rows.push(values);
      });
      sheets.push({ name: sheet.name, rows });
    }
  } catch {}

  if (sheets.length) return sheets;
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.map(name => ({ name, rows: sheetjsRows(workbook.Sheets[name]) }));
}

async function parseWorkbook(buffer) {
  let sheets;
  try {
    sheets = await readSheets(buffer);
  } catch (error) {
    return { error: '解析失败：' + error.message };
  }
  if (!sheets.length) return { error: '工作簿为空' };

  let picked = null;
  let headerRow = -1;
  for (const sheet of sheets) {
    const index = sheet.rows.findIndex(isHeader);
    if (index >= 0) {
      picked = sheet;
      headerRow = index;
      break;
    }
  }
  if (!picked) return { error: '未找到五金表头（零件名称 / 用量 / 单价RMB）' };

  const cols = indexHeader(picked.rows[headerRow]);
  if (cols.name == null || cols.qty == null || cols.unitPrice == null) {
    return { error: '五金表头字段不完整（需要 零件名称 / 用量 / 单价RMB）' };
  }

  const items = [];
  for (let index = headerRow + 1; index < picked.rows.length; index += 1) {
    const row = picked.rows[index] || [];
    const name = toStr(row[cols.name]);
    const rowText = row.map(toStr).join('|');
    if (/^(合计|合計|小计|小計|总计|總計)/.test(name) || /^附[:：]/.test(name)) break;
    if (!name) continue;

    const qty = toNum(row[cols.qty]);
    const unitPrice = toNum(row[cols.unitPrice]);
    if (qty == null && unitPrice == null && /合计|合計|总计|總計/.test(rowText)) continue;

    items.push({
      name,
      spec: cols.spec == null ? '' : toStr(row[cols.spec]),
      qty: qty ?? 1,
      unit_price_rmb: unitPrice ?? 0,
      tax_pct: null,
      note: cols.note == null ? '' : toStr(row[cols.note]),
    });
  }

  if (!items.length) return { error: '未解析到五金明细行' };
  return { items, count: items.length, sheet_used: picked.name, header_row: headerRow + 1 };
}

module.exports = { parseWorkbook };
