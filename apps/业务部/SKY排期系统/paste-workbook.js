const Excel = require('exceljs');
const XLSX = require('xlsx');

const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const key = (po, sku) => JSON.stringify([String(po ?? '').trim(), String(sku ?? '').trim()]);

function displayValue(cell) {
  return cell.type === Excel.ValueType.Formula ? cell.result ?? null : cell.value;
}

function copyHeaders(source, target, cachedHeaders) {
  for (let col = 1; col <= source.columnCount; col++) {
    const from = source.getColumn(col), to = target.getColumn(col);
    to.width = from.width;
    to.hidden = from.hidden;
  }
  for (let n = 1; n <= 2; n++) {
    const row = source.getRow(n);
    target.getRow(n).height = row.height;
    row.eachCell({includeEmpty: true}, (cell, col) => {
      const out = target.getRow(n).getCell(col);
      if (cell.type === Excel.ValueType.Formula) out.value = cachedHeaders[cell.address]?.v ?? null;
      else if (cell.type !== Excel.ValueType.Merge) out.value = cell.value;
      out.style = cell.style;
    });
  }
  for (const range of source.model.merges) {
    if (/^[A-Z]+[12]:[A-Z]+[12]$/.test(range)) target.mergeCellsWithoutStyle(range);
  }
}

async function writePasteWorkbook(template, destination, generated, orders) {
  const expected = new Set();
  for (const po of orders) {
    if (po.error || po.client !== 'Sky Castle' || !po.items?.length) throw Error('请核对 PO 明细与排期模板');
    for (const item of po.items) {
      if (!po.poNumber?.trim() || !item.partNo?.trim()) throw Error('缺少 PO 号或货号');
      const id = key(po.poNumber, item.partNo);
      if (expected.has(id)) throw Error('本批次含重复 PO 号和货号，请核对');
      expected.add(id);
    }
  }
  if (!expected.size) throw Error('没有可导出的 PO 明细');
  const reference = new Excel.Workbook();
  await reference.xlsx.readFile(template, {ignoreNodes: ['drawing', 'dataValidations', 'conditionalFormatting']});
  const headers = XLSX.readFile(template, {sheetRows: 2, cellDates: true});
  const copy = new Excel.Workbook();
  const written = {order: new Set(), schedule: new Set()};
  for (const delta of generated.worksheets) {
    if (['费用明细', '扣数提示'].includes(delta.name)) {
      const extra = copy.addWorksheet(delta.name);
      delta.eachRow(row => extra.addRow(row.values));
      continue;
    }
    const name = delta.name.replace(/-粘贴用$/, '');
    const order = name === '总接单';
    const [poCol, skuCol] = delta.skyKeyColumns ?? (order ? [4, 5] : [7, 8]);
    const rows = [];
    delta.eachRow(row => {
      if (expected.has(key(row.getCell(poCol).value, row.getCell(skuCol).value))) rows.push(row);
    });
    if (!rows.length) continue;
    const source = reference.getWorksheet(name);
    if (!source) throw Error('排期缺少工作表 ' + name);
    const matches = new Map();
    source.eachRow((row, n) => {
      if (n <= 2) return;
      const id = key(displayValue(row.getCell(poCol)), displayValue(row.getCell(skuCol)));
      if (!expected.has(id)) return;
      if (matches.has(id)) throw Error(name + ' 中有重复的 PO 和货号，无法核对更新位置');
      matches.set(id, row);
    });
    const sheet = copy.addWorksheet(name);
    copyHeaders(source, sheet, headers.Sheets[name]);
    rows.forEach((row, i) => {
      const id = key(row.getCell(poCol).value, row.getCell(skuCol).value);
      const seen = order ? written.order : written.schedule;
      if (seen.has(id)) throw Error('同一 PO 明细重复导出，请核对');
      seen.add(id);
      const original = matches.get(id);
      const out = sheet.getRow(i + 3);
      row.eachCell((cell, col) => {
        if (cell.value == null || cell.value === '') return;
        const target = out.getCell(col);
        const isDate = typeof cell.value === 'number' && cell.numFmt?.startsWith('yyyy/');
        target.value = isDate ? new Date((cell.value - 25569) * 86400000) : cell.value;
        if (isDate) target.numFmt = cell.numFmt;
        const previous = original && displayValue(original.getCell(col));
        const comparable = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
        if (comparable(previous) !== comparable(target.value)) target.fill = yellow;
      });
    });
  }
  if (Object.values(written).some(set => set.size !== expected.size)) throw Error('部分明细未能对应接单表或排期表');
  await copy.xlsx.writeFile(destination);
}
module.exports = { writePasteWorkbook };
