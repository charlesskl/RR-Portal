const ExcelJS = require('exceljs');
const { detectColumns } = require('../lib/xlsx-headers');

// 从 sheet 名前缀提数字/字母 code,要求至少 4 位数字,避免把 "6款狗仔" 里的 "6" 误认为货号。
// 例如 "47600 货柜车" → "47600","E73814泡泡壶" → "E73814","46720J 木材运输车" → "46720J"
function codeFromSheetName(sheetName) {
  const m = sheetName.match(/^([A-Za-z]?\d{4,}[A-Za-z0-9]*)/);
  return m ? m[1] : null;
}

function rowCellVal(cell) {
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    return JSON.stringify(v);
  }
  return v;
}

function findHeaderRow(sheet) {
  // 扫前 5 行,任意单元格含「货号」「位置」「工序」均视为表头行
  for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = String(rowCellVal(row.getCell(c)) || '');
      if (v.includes('货号') || v.includes('位置') || v === '工序') return r;
    }
  }
  return -1;
}

function headerArray(sheet, headerRowIdx) {
  const row = sheet.getRow(headerRowIdx);
  const arr = [];
  for (let c = 1; c <= sheet.columnCount; c++) arr.push(rowCellVal(row.getCell(c)));
  return arr;
}

function parseCodeAndName(cols, row, nameIsPartCol) {
  if (cols.code === undefined) return null;
  const codeCellIdx = cols.code + 1;
  const raw = rowCellVal(row.getCell(codeCellIdx));
  if (!raw) return null;
  const text = String(raw);

  const firstLine = text.split(/[\r\n]+/)[0].trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9\-]*$/.test(firstLine)) return null;

  if (cols.name !== undefined && !nameIsPartCol) {
    const nameRaw = rowCellVal(row.getCell(cols.name + 1));
    if (/[\r\n]/.test(text)) {
      const parts = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return { code: parts[0], name: parts.slice(1).join(' ') };
    }
    return { code: firstLine, name: nameRaw ? String(nameRaw).trim() : '' };
  }

  if (/[\r\n]/.test(text)) {
    const parts = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { code: parts[0], name: parts.slice(1).join(' ') };
  }

  return { code: firstLine, name: '' };
}

async function parsePricingSheet(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const productsMap = new Map();

  wb.eachSheet((sheet) => {
    const headerRowIdx = findHeaderRow(sheet);
    if (headerRowIdx < 0) return;

    const header = headerArray(sheet, headerRowIdx);
    const cols = detectColumns(header);
    if (cols.part_name === undefined) return;

    // 当 sheet 同时有「货名」和「工序」而无「位置」时,实际数据里「货名」列是部位名,
    // 「工序」列是工艺;detectColumns 把「工序」标成 part_name,需要在 importer 侧纠正。
    const nameIsPartCol = cols.name !== undefined && cols.technique === undefined;
    let partNameCol = cols.part_name;
    let techniqueCol = cols.technique;
    if (nameIsPartCol) {
      partNameCol = cols.name;
      techniqueCol = cols.part_name;
    }

    const fallbackCode = codeFromSheetName(sheet.name);
    const fallbackName = sheet.name.replace(/^[A-Za-z]?\d+[A-Za-z]?\d*\s*/, '').trim();

    let lastPartName = '';

    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);

      let idPair = parseCodeAndName(cols, row, nameIsPartCol);
      let usedFallback = false;
      if (!idPair && fallbackCode) { idPair = { code: fallbackCode, name: fallbackName }; usedFallback = true; }
      if (!idPair || !idPair.code) continue;

      let rowPartNameCol = partNameCol;
      let rowTechniqueCol = techniqueCol;
      if (usedFallback && cols.code !== undefined) {
        const codeCellHasData = rowCellVal(row.getCell(cols.code + 1)) != null;
        if (codeCellHasData) {
          rowPartNameCol = cols.code;
          rowTechniqueCol = cols.part_name;
        }
      }

      const partRaw = rowCellVal(row.getCell(rowPartNameCol + 1));
      const technique = rowTechniqueCol !== undefined
        ? (rowCellVal(row.getCell(rowTechniqueCol + 1)) || '') : '';
      const target_qty = cols.target_qty !== undefined
        ? rowCellVal(row.getCell(cols.target_qty + 1)) : null;
      const worker_count = cols.worker_count !== undefined
        ? rowCellVal(row.getCell(cols.worker_count + 1)) : null;
      const unit_wage = cols.unit_wage !== undefined
        ? rowCellVal(row.getCell(cols.unit_wage + 1)) : null;
      const quote_price = cols.quote_price !== undefined
        ? rowCellVal(row.getCell(cols.quote_price + 1)) : null;
      const remarks = cols.remarks !== undefined
        ? (rowCellVal(row.getCell(cols.remarks + 1)) || '') : '';

      // part_name 可能由于合并/视觉连接而为空,此时若当前行其它数据存在则继承上一行的 part_name
      let part_name = partRaw ? String(partRaw).trim() : '';
      const hasOtherData = technique || target_qty || unit_wage;
      if (!part_name && hasOtherData) {
        part_name = lastPartName;
      }
      if (!part_name) continue;
      if (/^(合计|小计|总计)[\s:：]*$/.test(part_name)) continue;
      if (/^(货号|货名|位置|工序|工艺|目标数|人数|工价|核价|油漆价|总核价|报价|备注|图片)$/.test(part_name)) continue;
      lastPartName = part_name;

      const key = idPair.code;
      if (!productsMap.has(key)) {
        productsMap.set(key, {
          code: idPair.code,
          name: idPair.name || fallbackName || '',
          quote_price: Number(quote_price) || 0,
          processes: [],
        });
      }
      const product = productsMap.get(key);
      if (!product.name && idPair.name) product.name = idPair.name;
      if (!product.quote_price && quote_price) product.quote_price = Number(quote_price) || 0;

      product.processes.push({
        part_name,
        technique: technique ? String(technique).trim() : '',
        target_qty: Number(target_qty) || 0,
        worker_count: Number(worker_count) || 1,
        unit_wage: Number(unit_wage) || 0,
        remarks: remarks ? String(remarks).trim() : '',
      });
    }
  });

  return [...productsMap.values()];
}

module.exports = { parsePricingSheet };
