// 解析“搪胶报价”型 xls/xlsx。
// 模板为单产品核价卡：左侧是成本分解，右侧是生产参数；每个有效 sheet 返回一条 slush_item。
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

function toStr(value) {
  if (value == null) return '';
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
  if (typeof value === 'object' && value.text != null) return String(value.text).trim();
  if (typeof value === 'object' && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

function toNum(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value.result != null) return toNum(value.result);
  const parsed = Number(String(value).replace(/[,，\s]/g, '').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedLabel(value) {
  return toStr(value).replace(/\s+/g, '').replace(/[：:]+$/, '');
}

function sheetjsToRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }).map(row => {
    const cells = [];
    (row || []).forEach((value, index) => { cells[index + 1] = value; });
    return cells;
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
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => { cells[column] = cell.value; });
        rows.push(cells);
      });
      sheets.push({ name: sheet.name, rows });
    }
  } catch {}
  if (sheets.length) return sheets;

  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  return workbook.SheetNames.map(name => ({ name, rows: sheetjsToRows(workbook.Sheets[name]) }));
}

function findPair(rows, wanted, options = {}) {
  const matches = [];
  rows.forEach((row, rowIndex) => {
    (row || []).forEach((value, columnIndex) => {
      const rawLabel = toStr(value);
      const inline = /^(.+?)[：:]\s*([-+]?\d[\d,，]*(?:\.\d+)?)\s*$/.exec(rawLabel);
      if (inline && normalizedLabel(inline[1]) === wanted) {
        matches.push({
          rawLabel: inline[1] + '：',
          value: inline[2],
          row: rowIndex,
          col: columnIndex,
        });
      } else if (normalizedLabel(value) === wanted) {
        matches.push({
          rawLabel,
          value: row[columnIndex + 1],
          row: rowIndex,
          col: columnIndex,
        });
      }
    });
  });
  if (!matches.length) return null;
  if (options.withColon) {
    const colonMatch = matches.find(match => /[：:]$/.test(match.rawLabel));
    if (colonMatch) return colonMatch.value;
  }
  if (options.withoutColon) {
    const plainMatch = matches.find(match => !/[：:]$/.test(match.rawLabel));
    if (plainMatch) return plainMatch.value;
  }
  return matches[0].value;
}

function parseSheet(sheet) {
  const rows = sheet.rows || [];
  const allText = rows.flatMap(row => (row || []).map(toStr)).filter(Boolean);
  const looksLikeSlush = allText.some(text => /搪胶报价/.test(text))
    || ['24小时搪工', '12批工/烤工', '24小时生产数', '料重'].filter(label => allText.some(text => normalizedLabel(text) === label)).length >= 3;
  if (!looksLikeSlush) return null;

  const item = {
    item_code: '',
    name: '',
    material: '搪胶料',
    qty: 1,
    images: [],
    material_price_lb: toNum(findPair(rows, '料价', { withColon: true })),
    slush_labor_24h: toNum(findPair(rows, '24小时搪工')),
    batch_labor_12h: toNum(findPair(rows, '12批工/烤工')),
    diesel_24h: toNum(findPair(rows, '24小时柴油')),
    electricity_24h: toNum(findPair(rows, '24小时电费')),
    pigment_price: toNum(findPair(rows, '色粉', { withColon: false })),
    daily_output: toNum(findPair(rows, '24小时生产数')),
    batch_output_12h: toNum(findPair(rows, '12小时批产量')),
    wax_sample: toNum(findPair(rows, '腊样')),
    mold_fee: toNum(findPair(rows, '模费')),
    weight_g: toNum(findPair(rows, '料重')),
    shipping_bag: toNum(findPair(rows, '运费、胶袋')),
    material_cost: toNum(findPair(rows, '料价', { withoutColon: true })),
    slush_labor_cost: toNum(findPair(rows, '搪工')),
    batch_labor_cost: toNum(findPair(rows, '批工')),
    pigment_cost: toNum(findPair(rows, '色粉', { withoutColon: true })),
    diesel_cost: toNum(findPair(rows, '柴油')),
    electricity_cost: toNum(findPair(rows, '电费')),
    subtotal_hkd: toNum(findPair(rows, '合计')),
    markup_x: toNum(findPair(rows, '码点')),
    unit_price_hkd: toNum(findPair(rows, '货价')),
  };

  // 模板通常把色粉输入写在 D4、成本写在 A8；若无冒号，以列位置区分。
  const pigmentMatches = [];
  rows.forEach((row, rowIndex) => {
    (row || []).forEach((value, columnIndex) => {
      if (normalizedLabel(value) === '色粉') pigmentMatches.push({ value: row[columnIndex + 1], row: rowIndex, col: columnIndex });
    });
  });
  const pigmentInput = pigmentMatches.find(match => match.col >= 4);
  const pigmentCost = pigmentMatches.find(match => match.col < 4);
  if (pigmentInput) item.pigment_price = toNum(pigmentInput.value);
  if (pigmentCost) item.pigment_cost = toNum(pigmentCost.value);

  // 某些 Excel/WPS 文件没有保存公式缓存值；此时按模板公式重新计算。
  const n = value => Number(value) || 0;
  if (item.material_cost == null) item.material_cost = n(item.weight_g) * n(item.material_price_lb) / 454;
  if (item.slush_labor_cost == null) item.slush_labor_cost = n(item.daily_output) ? n(item.slush_labor_24h) / n(item.daily_output) : 0;
  if (item.batch_labor_cost == null) item.batch_labor_cost = n(item.batch_output_12h) ? n(item.batch_labor_12h) / n(item.batch_output_12h) : 0;
  if (item.pigment_cost == null) item.pigment_cost = n(item.weight_g) * n(item.pigment_price) / 25000;
  if (item.diesel_cost == null) item.diesel_cost = n(item.daily_output) ? n(item.diesel_24h) / n(item.daily_output) : 0;
  if (item.electricity_cost == null) item.electricity_cost = n(item.daily_output) ? n(item.electricity_24h) / n(item.daily_output) : 0;
  if (item.subtotal_hkd == null) {
    item.subtotal_hkd = item.material_cost + item.slush_labor_cost + item.batch_labor_cost
      + item.pigment_cost + item.diesel_cost + item.electricity_cost + n(item.shipping_bag);
  }
  if (item.unit_price_hkd == null) item.unit_price_hkd = item.subtotal_hkd * (n(item.markup_x) || 1);
  return item;
}

async function parseWorkbook(buffer) {
  let sheets;
  try {
    sheets = await readSheets(buffer);
  } catch (error) {
    return { error: '解析失败：' + error.message };
  }
  if (!sheets.length) return { error: '工作簿为空' };

  const items = [];
  const sheetNames = [];
  for (const sheet of sheets) {
    const item = parseSheet(sheet);
    if (!item) continue;
    item.source_sheet = sheet.name;
    items.push(item);
    sheetNames.push(sheet.name);
  }
  if (!items.length) return { error: '未找到搪胶报价模板（需包含“搪胶报价”及生产参数）' };
  return { items, count: items.length, sheets_used: sheetNames };
}

module.exports = { parseWorkbook };
