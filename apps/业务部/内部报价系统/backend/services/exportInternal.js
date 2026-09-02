'use strict';

// Keep the long-standing internal quotation renderer unchanged.  The contract
// check rejects a new blob larger than 50 KB, so new formula sections live in
// this small post-processor instead of growing exportXlsx.js further.
const { buildWorkbook: buildBaseWorkbook } = require('./exportXlsx');
const { isSpinCustomer } = require('./customerProfiles');
const { toExcelFormulaInput, fractionNumberFormat } = require('../../frontend/formula-input');
const {
  ensureExplicitProductGroups,
  productGroups,
  weightedRowsSum,
  weightedInjectionSum,
  weightedColumnFormula,
} = require('./productMix');

const FONT = 'Microsoft YaHei';
const HKD4 = '"HK$"0.0000';
const EXPORT_COLORS = {
  navy: 'FF17365D',
  blue: 'FF5B9BD5',
  section: 'FFDCE6F1',
  border: 'FFB8C6D1',
  soft: 'FFF3F6FA',
  subtotal: 'FFEAF2F8',
  total: 'FFDCE6F1',
  white: 'FFFFFFFF',
};

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(rows, getter) {
  return (rows || []).reduce((total, row) => total + num(getter(row)), 0);
}

function isIcElectronicRow(row) {
  return /^IC$/i.test(String(row && row.name || '').trim());
}

function parseSections(sections) {
  const result = {};
  for (const section of sections || []) {
    try {
      result[section.dept] = JSON.parse(section.payload_json || '{}');
    } catch {
      result[section.dept] = {};
    }
  }
  return result;
}

// exportXlsx.js 的历史公式把附加税视为 RMB，再除以人民币兑港币汇率。
// 页面和数据库现在直接保存 HKD，因此仅在调用旧导出器时临时换回它预期的
// RMB 输入；后续增强逻辑仍使用原始 HKD 数据。
function adaptSurtaxForBase({ quote, sections }) {
  return {
    quote,
    sections: (sections || []).map(section => {
      if (section.dept === 'engineering') {
        let payload;
        try {
          payload = JSON.parse(section.payload_json || '{}');
        } catch {
          return section;
        }
        const items = payload.mold_costs && Array.isArray(payload.mold_costs.items)
          ? payload.mold_costs.items
          : [];
        let changed = false;
        items.forEach(item => {
          if (String(item && item.name || '').trim() !== '超声模费用') return;
          item.name = '夹具模费用';
          changed = true;
        });
        return changed ? { ...section, payload_json: JSON.stringify(payload) } : section;
      }
      if (section.dept !== 'sales') return section;
      let payload;
      try {
        payload = JSON.parse(section.payload_json || '{}');
      } catch {
        return section;
      }
      if (payload.pricing_summary?.surtax == null) return section;
      const fx = num(payload.header?.fx_rmb_hkd) || 0.85;
      payload.pricing_summary.surtax = num(payload.pricing_summary.surtax) * fx;
      return { ...section, payload_json: JSON.stringify(payload) };
    }),
  };
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function colLetter(column) {
  let value = column;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function applyPrintLayout(workbook) {
  workbook.eachSheet(worksheet => {
    // columnCount/rowCount 会把只有样式的空白格也算进去，导致打印区域被无意义地
    // 拉宽后整页缩小。这里只按真正有内容（含公式）的单元格确定打印边界。
    let lastRow = 1;
    let lastColumn = 1;
    worksheet.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.value === null || cell.value === undefined || cell.value === '') return;
        lastRow = Math.max(lastRow, cell.row);
        lastColumn = Math.max(lastColumn, cell.col);

        // 标题（14号及以上）保持原设计；仅将正文和普通表头适度放大到12号，
        // 避免正文/合计反而大过章节标题。
        const font = cell.font || {};
        const currentSize = Number(font.size) || 11;
        const nextSize = currentSize >= 14 ? currentSize : Math.max(currentSize, 12);
        cell.font = { ...font, name: FONT, size: nextSize };
      });
    });
    const isMain = worksheet.name === '报价明细';

    worksheet.properties.defaultRowHeight = 20;
    worksheet.views = [{
      ...(worksheet.views && worksheet.views[0] ? worksheet.views[0] : {}),
      showGridLines: false,
      zoomScale: isMain ? 85 : 90,
    }];
    worksheet.pageSetup = {
      ...(worksheet.pageSetup || {}),
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      verticalCentered: false,
      pageOrder: 'overThenDown',
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
      printArea: `A1:${colLetter(lastColumn)}${lastRow}`,
      printTitlesRow: isMain ? '1:2' : '1:1',
    };
    worksheet.headerFooter = {
      oddHeader: isMain ? '&C&B内部报价明细' : `&C&B${worksheet.name}`,
      oddFooter: '&L内部报价系统&C第 &P 页 / 共 &N 页&R&D',
      evenHeader: isMain ? '&C&B内部报价明细' : `&C&B${worksheet.name}`,
      evenFooter: '&L内部报价系统&C第 &P 页 / 共 &N 页&R&D',
    };
  });
}

function findRow(ws, value, column = 1) {
  let found = 0;
  ws.eachRow(row => {
    if (!found && row.getCell(column).value === value) found = row.number;
  });
  return found;
}

function findRowMatching(ws, matcher, start = 1, end = ws.rowCount, column = 1) {
  for (let row = start; row <= end; row += 1) {
    if (matcher(ws.getCell(row, column).value)) return row;
  }
  return 0;
}

function unmergeRows(ws, start, end) {
  const ranges = [];
  for (const merge of Object.values(ws._merges || {})) {
    const model = merge && merge.model;
    if (!model || model.bottom < start || model.top > end) continue;
    ranges.push(`${colLetter(model.left)}${model.top}:${colLetter(model.right)}${model.bottom}`);
  }
  for (const range of ranges) {
    try { ws.unMergeCells(range); } catch {}
  }
}

function copyCell(source, target) {
  target.value = source.value;
  target.style = cloneStyle(source.style);
  if (source.numFmt) target.numFmt = source.numFmt;
}

function shiftRowsDown(ws, startRow, shift) {
  if (!shift) return;
  const lastRow = ws.rowCount;
  const merges = Object.values(ws._merges || {})
    .map(merge => merge && merge.model)
    .filter(Boolean)
    .map(model => ({ ...model }));

  for (const model of merges) {
    if (model.top < startRow) continue;
    try {
      ws.unMergeCells(
        `${colLetter(model.left)}${model.top}:${colLetter(model.right)}${model.bottom}`
      );
    } catch {}
  }

  for (let row = lastRow; row >= startRow; row -= 1) {
    const source = ws.getRow(row);
    const target = ws.getRow(row + shift);
    target.height = source.height;
    for (let column = 1; column <= Math.max(source.cellCount, 31); column += 1) {
      copyCell(source.getCell(column), target.getCell(column));
      source.getCell(column).value = null;
    }
  }

  // 必须在恢复合并单元格之前调整公式。ExcelJS 的合并占位格会共享
  // 顶左单元格的 value；若先 merge 再 eachCell，同一公式会被重复平移多次。
  const formulaPattern = /([A-Z]+)(\d+)/g;
  ws.eachRow(row => {
    row.eachCell(cell => {
      const value = cell.value;
      if (!value || typeof value !== 'object' || !value.formula) return;
      const formula = value.formula.replace(formulaPattern, (match, column, rowText) => {
        const formulaRow = Number(rowText);
        return formulaRow >= startRow ? `${column}${formulaRow + shift}` : match;
      });
      if (formula !== value.formula) cell.value = { formula, result: value.result };
    });
  });

  for (const model of merges) {
    if (model.top < startRow) continue;
    ws.mergeCells(
      model.top + shift,
      model.left,
      model.bottom + shift,
      model.right
    );
  }
}

function applyStyle(cell, style, numFmt) {
  cell.style = cloneStyle(style);
  if (numFmt) cell.numFmt = numFmt;
}

function paintHeader(ws, row, columns, style) {
  for (let column = 1; column <= columns; column += 1) applyStyle(ws.getCell(row, column), style);
}

function isSewLaborRow(row) {
  return /人工/.test((row && (row.fabric || row.part || row.name)) || '');
}

function sewGroupQty(group) {
  const value = group && group.product_qty;
  if (value == null || value === '') return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function sewTotalQty(sewing) {
  const override = sewing && sewing.sewing_total_qty;
  if (override != null && override !== '' && num(override) > 0) return num(override);
  return sum((sewing && sewing.sewing_groups) || [], sewGroupQty) || 1;
}

function sewMaterialOnlyAmount(group) {
  return sum((group && group.items) || [], row => isSewLaborRow(row)
    ? 0
    : num(row.usage) * num(row.mat_price) * (num(row.markup) || 1));
}

function sewWeightedMaterialRmb(sewing) {
  const groups = (sewing && sewing.sewing_groups) || [];
  return sum(groups, group => sewMaterialOnlyAmount(group) * sewGroupQty(group))
    / sewTotalQty(sewing);
}

function hasSlushCostingInputs(row) {
  return [
    'material_price_lb', 'slush_labor_24h', 'batch_labor_12h', 'diesel_24h',
    'electricity_24h', 'pigment_price', 'daily_output', 'batch_output_12h',
    'weight_g', 'shipping_bag', 'markup_x',
  ].some(key => row && row[key] !== null && row[key] !== undefined && row[key] !== '');
}

function slushCosting(row) {
  const weight = num(row && row.weight_g);
  const dailyOutput = num(row && row.daily_output);
  const batchOutput = num(row && row.batch_output_12h);
  const material = weight * num(row && row.material_price_lb) / 454;
  const slushLabor = dailyOutput ? num(row && row.slush_labor_24h) / dailyOutput : 0;
  const batchLabor = batchOutput ? num(row && row.batch_labor_12h) / batchOutput : 0;
  const pigment = weight * num(row && row.pigment_price) / 25000;
  const diesel = dailyOutput ? num(row && row.diesel_24h) / dailyOutput : 0;
  const electricity = dailyOutput ? num(row && row.electricity_24h) / dailyOutput : 0;
  const shippingBag = num(row && row.shipping_bag);
  const subtotal = material + slushLabor + batchLabor + pigment + diesel + electricity + shippingBag;
  return {
    material, slushLabor, batchLabor, pigment, diesel, electricity, shippingBag,
    subtotal,
    unitPrice: subtotal * (num(row && row.markup_x) || 1),
  };
}

function slushUnitPrice(row) {
  return hasSlushCostingInputs(row) ? slushCosting(row).unitPrice : num(row && row.unit_price_hkd);
}

function patchPaintingProductMix(ws, painting) {
  const payload = painting || {};
  const items = payload.painting_items || [];
  ensureExplicitProductGroups(items);
  const groups = productGroups(payload, items);
  if (groups.length <= 1) return;

  const titleRow = findRow(ws, '五、二次加工（印喷报价）');
  if (!titleRow) return;
  const headerRow = titleRow + 1;
  // 喷油表使用两层表头（工序名 + 数量/单价），数据从标题下第 3 行开始。
  const dataStart = headerRow + 2;
  const originalTotalRow = dataStart + items.length;
  const amountKeys = ['clamp', 'pad', 'roast', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'];
  const amountColumn = 4 + amountKeys.length * 2;
  const ratioColumn = amountColumn - 1;
  const ratioLetter = colLetter(ratioColumn);
  const amountLetter = colLetter(amountColumn);
  const amountOf = item => sum(amountKeys, key => num(item[`${key}_qty`]) * num(item[`${key}_unit`]));
  const weightedTotal = weightedRowsSum(payload, items, amountOf);

  shiftRowsDown(ws, originalTotalRow, groups.length);
  const movedTotalRow = originalTotalRow + groups.length;
  const totalStyle = ws.getCell(movedTotalRow, amountColumn).style;
  const labelStyle = ws.getCell(movedTotalRow, 1).style;

  groups.forEach((group, index) => {
    const row = originalTotalRow + index;
    const subtotal = sum(group.rows, entry => amountOf(entry.row));
    const amountCells = group.rows.map(entry => `${amountLetter}${dataStart + entry.index}`);
    ws.mergeCells(row, 1, row, ratioColumn - 1);
    ws.getCell(row, 1).value = `${group.name} 小计 · 配比`;
    ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    applyStyle(ws.getCell(row, 1), labelStyle);
    for (let column = 2; column < ratioColumn; column += 1) {
      applyStyle(ws.getCell(row, column), labelStyle);
    }
    ws.getCell(row, ratioColumn).value = group.ratio;
    applyStyle(ws.getCell(row, ratioColumn), totalStyle, '0.####');
    ws.getCell(row, amountColumn).value = {
      formula: amountCells.length ? amountCells.join('+') : '0',
      result: subtotal,
    };
    applyStyle(ws.getCell(row, amountColumn), totalStyle, '0.0000');
  });

  ws.getCell(movedTotalRow, amountColumn).value = {
    formula: `(IFERROR(SUMPRODUCT(${ratioLetter}${originalTotalRow}:${ratioLetter}${movedTotalRow - 1},${amountLetter}${originalTotalRow}:${amountLetter}${movedTotalRow - 1})/SUM(${ratioLetter}${originalTotalRow}:${ratioLetter}${movedTotalRow - 1}),0))`,
    result: weightedTotal,
  };
  ws.getCell(movedTotalRow, amountColumn).numFmt = HKD4;
}

function patchSimpleIndoColumns(ws, payloads) {
  const engineering = payloads.engineering || {};
  const electronic = payloads.electronic || {};
  const electronicRows = (electronic.electronics || []).length
    ? electronic.electronics
    : (engineering.electronics || []);
  const patches = [
    { title: '二、注塑部分', dept: payloads.molding || {}, amountCol: 14, indoCol: 15, weighted: true },
    { title: '二·B、吹气部分 (HKD)', dept: payloads.molding || {}, amountCol: 12, indoCol: 15 },
    { title: '五、二次加工（印喷报价）', refKey: 'paintingDetail', dept: payloads.painting || {}, amountCol: 24, indoCol: 25, factor: 0.3, totalFromAmount: true },
    {
      title: '六、电子',
      refKey: 'electronic',
      dept: electronic,
      amountCol: 10,
      indoCol: 11,
      rows: electronicRows,
      exclude: isIcElectronicRow,
    },
    { title: '七、五金', refKey: 'hardware', dept: payloads.engineering || {}, amountCol: 10, indoCol: 11 },
    { title: '八、包装材料', refKey: 'packaging', dept: payloads.engineering || {}, amountCol: 10, indoCol: 11 },
    { title: '九、辅助材料', refKey: 'aux', dept: payloads.engineering || {}, amountCol: 10, indoCol: 11 },
  ];

  const refs = {};
  for (const patch of patches) {
    const titleRow = findRow(ws, patch.title);
    if (!titleRow) continue;
    const headerRow = titleRow + 1;
    const totalRow = findRowMatching(
      ws,
      value => /^(加权合计|合计|小计)/.test(String(value || '')),
      headerRow + 1,
      Math.min(ws.rowCount, headerRow + 100)
    );
    if (!totalRow) continue;
    const pct = num(patch.dept.indo_pct);
    const headerStyle = ws.getCell(headerRow, 1).style;
    ws.getCell(headerRow, patch.indoCol).value = `印尼运费 ${pct}%`;
    applyStyle(ws.getCell(headerRow, patch.indoCol), headerStyle);
    let total = 0;
    const rowResults = [];
    const eligibleAmountCells = [];
    for (let row = headerRow + 1; row < totalRow; row += 1) {
      const amountCell = ws.getCell(row, patch.amountCol);
      const amount = num(amountCell.value && typeof amountCell.value === 'object'
        ? amountCell.value.result
        : amountCell.value);
      if (!amount && !ws.getCell(row, 1).value) continue;
      const factor = patch.factor || 1;
      const item = (patch.rows || [])[row - (headerRow + 1)];
      const excluded = Boolean(patch.exclude && patch.exclude(item));
      const result = excluded ? 0 : amount * factor * pct / 100;
      const formula = excluded
        ? '0'
        : patch.factor
          ? `${colLetter(patch.amountCol)}${row}*30%*${pct}/100`
          : `${colLetter(patch.amountCol)}${row}*${pct}/100`;
      ws.getCell(row, patch.indoCol).value = { formula, result };
      ws.getCell(row, patch.indoCol).numFmt = HKD4;
      applyStyle(ws.getCell(row, patch.indoCol), ws.getCell(row, patch.amountCol).style, HKD4);
      total += result;
      rowResults.push(result);
      if (!excluded) eligibleAmountCells.push(`${colLetter(patch.amountCol)}${row}`);
    }
    if (patch.weighted) {
      total = weightedInjectionSum(patch.dept, (_row, index) => rowResults[index]);
    }
    if (patch.totalFromAmount) {
      const totalAmountCell = ws.getCell(totalRow, patch.amountCol);
      const totalAmount = num(totalAmountCell.value && typeof totalAmountCell.value === 'object'
        ? totalAmountCell.value.result
        : totalAmountCell.value);
      total = totalAmount * (patch.factor || 1) * pct / 100;
    }
    const hasDetailRows = totalRow > headerRow + 1;
    ws.getCell(totalRow, patch.indoCol).value = {
      formula: !hasDetailRows
        ? '0'
        : patch.totalFromAmount
          ? `${colLetter(patch.amountCol)}${totalRow}*30%*${pct}/100`
        : patch.weighted
          ? weightedColumnFormula(patch.dept, headerRow + 1, colLetter(patch.indoCol))
          : `SUM(${colLetter(patch.indoCol)}${headerRow + 1}:${colLetter(patch.indoCol)}${totalRow - 1})`,
      result: total,
    };
    applyStyle(ws.getCell(totalRow, patch.indoCol), ws.getCell(totalRow, patch.amountCol).style, HKD4);
    refs[patch.title] = `${colLetter(patch.amountCol)}${totalRow}`;
    refs[`${patch.title}:indo`] = `${colLetter(patch.indoCol)}${totalRow}`;
    refs[`${patch.title}:indoBase`] = eligibleAmountCells.join('+') || '0';
    if (patch.refKey) {
      refs[patch.refKey] = refs[patch.title];
      refs[`${patch.refKey}:indo`] = refs[`${patch.title}:indo`];
      refs[`${patch.refKey}:indoBase`] = refs[`${patch.title}:indoBase`];
    }
  }
  return refs;
}

function patchUnifiedCostTable(ws, payloads) {
  let headerRow = 0;
  for (let row = 1; row <= ws.rowCount; row += 1) {
    if (String(ws.getCell(row, 1).value || '').trim() === '序号'
      && String(ws.getCell(row, 2).value || '').trim() === '类别'
      && String(ws.getCell(row, 3).value || '').trim() === '名称'
      && String(ws.getCell(row, 11).value || '').trim() === '金额 HKD') {
      headerRow = row;
      break;
    }
  }
  if (!headerRow) return {};

  let totalRow = 0;
  for (let row = headerRow + 1; row <= ws.rowCount; row += 1) {
    if (String(ws.getCell(row, 1).value || '').trim() === '合计 HKD') {
      totalRow = row;
      break;
    }
  }
  if (!totalRow) return {};

  const refs = { partRows: { electronic: [], hardware: [], packaging: [], aux: [] } };
  const buckets = {
    '组装人工': 'asmLabor',
    '包装/混装人工': 'pkgLabor',
    '印喷': 'secondProc',
    '电子': 'electronic',
    '五金': 'hardware',
    '包装材料': 'packaging',
    '辅助材料': 'aux',
    '车缝': 'sewingHkd',
  };
  const amountCells = {};
  const eligibleElectronicCells = [];
  const electronicRows = ((payloads.electronic && payloads.electronic.electronics) || []).length
    ? payloads.electronic.electronics
    : (((payloads.engineering || {}).electronics) || []);
  const payloadRows = {
    electronic: electronicRows.filter(item => !item.is_subtotal),
    hardware: (((payloads.engineering || {}).hardware) || []).filter(item => !item.is_subtotal),
    packaging: (((payloads.engineering || {}).packaging_materials) || []).filter(item => !item.is_subtotal),
    aux: (((payloads.engineering || {}).aux_materials) || []).filter(item => !item.is_subtotal),
  };
  const indexes = { electronic: 0, hardware: 0, packaging: 0, aux: 0 };

  for (let row = headerRow + 1; row < totalRow; row += 1) {
    const category = String(ws.getCell(row, 2).value || '').trim();
    const key = buckets[category];
    if (!key) continue;
    amountCells[key] = amountCells[key] || [];
    amountCells[key].push(`K${row}`);
    if (key === 'sewingHkd' && String(ws.getCell(row, 3).value || '').trim() === '车缝物料') {
      refs.sewingMaterialRmb = `I${row}`;
    }
    if (!Object.prototype.hasOwnProperty.call(payloadRows, key)) continue;

    const item = payloadRows[key][indexes[key]++] || {};
    const qtyFormula = toExcelFormulaInput(item.qty_raw);
    const priceFormula = toExcelFormulaInput(item.unit_price_rmb_raw);
    const qtyFractionFmt = fractionNumberFormat(item.qty_raw);
    const priceFractionFmt = fractionNumberFormat(item.unit_price_rmb_raw);
    if (qtyFormula) ws.getCell(row, 8).value = { formula: qtyFormula, result: num(item.qty) };
    else if (qtyFractionFmt) ws.getCell(row, 8).numFmt = qtyFractionFmt;
    if (priceFormula && String(item.source_currency || '').toUpperCase() !== 'USD') {
      ws.getCell(row, 9).value = { formula: priceFormula, result: num(item.unit_price_rmb) };
    } else if (priceFractionFmt && String(item.source_currency || '').toUpperCase() !== 'USD') {
      ws.getCell(row, 9).numFmt = priceFractionFmt;
    }
    ws.getCell(row, 11).value = {
      formula: `H${row}*J${row}`,
      result: num(ws.getCell(row, 11).value && ws.getCell(row, 11).value.result),
    };
    refs.partRows[key].push({
      name: item.name || ws.getCell(row, 3).value || '',
      spec: item.spec || ws.getCell(row, 4).value || '',
      category: item.category || '',
      cell: `K${row}`,
    });
    if (key === 'electronic' && !isIcElectronicRow(item)) eligibleElectronicCells.push(`K${row}`);
  }

  Object.entries(buckets).forEach(([, key]) => {
    refs[key] = (amountCells[key] || []).join('+') || '0';
  });
  refs['electronic:indoBase'] = eligibleElectronicCells.join('+') || '0';
  refs.unifiedCostTotal = `K${totalRow}`;
  refs.unifiedIndoTotal = `L${totalRow}`;
  return refs;
}

function patchFreeInputFormulas(ws, payloads) {
  const engineering = payloads.engineering || {};
  const sections = [
    {
      title: '六、电子',
      rows: (payloads.electronic && payloads.electronic.electronics) || [],
    },
    { title: '七、五金', rows: engineering.hardware || [] },
    { title: '八、包装材料', rows: engineering.packaging_materials || [] },
    { title: '九、辅助材料', rows: engineering.aux_materials || [] },
  ];

  for (const section of sections) {
    const titleRow = findRow(ws, section.title);
    if (!titleRow) continue;
    const dataStart = titleRow + 2;
    section.rows.forEach((item, index) => {
      const row = dataStart + index;
      const qtyFormula = toExcelFormulaInput(item.qty_raw);
      const priceFormula = toExcelFormulaInput(item.unit_price_rmb_raw);
      const qtyFractionFmt = fractionNumberFormat(item.qty_raw);
      const priceFractionFmt = fractionNumberFormat(item.unit_price_rmb_raw);
      if (qtyFormula) {
        ws.getCell(row, 7).value = { formula: qtyFormula, result: num(item.qty) };
      } else if (qtyFractionFmt) {
        ws.getCell(row, 7).value = num(item.qty);
        ws.getCell(row, 7).numFmt = qtyFractionFmt;
      }
      if (!section.quantityOnly && priceFormula) {
        ws.getCell(row, 8).value = { formula: priceFormula, result: num(item.unit_price_rmb) };
      } else if (!section.quantityOnly && priceFractionFmt) {
        ws.getCell(row, 8).value = num(item.unit_price_rmb);
        ws.getCell(row, 8).numFmt = priceFractionFmt;
      }
    });
  }
}

function patchMoldProductGroups(ws, payloads) {
  const molds = (payloads.engineering && payloads.engineering.molds) || [];
  if (!molds.some(mold => mold.product_group_id)) return;
  const titleRow = findRow(ws, '一、模具部分');
  if (!titleRow) return;
  ws.getCell(titleRow + 1, 1).value = '产品 / 序号';
  const counters = {};
  let previousGroup = '';
  for (let index = 0; index < molds.length; index += 1) {
    const mold = molds[index];
    const row = titleRow + 2 + index;
    const groupId = mold.product_group_id || '';
    if (!groupId) continue;
    counters[groupId] = (counters[groupId] || 0) + 1;
    const groupNumber = Object.keys(counters).indexOf(groupId) + 1;
    ws.getCell(row, 1).value = `${groupNumber}.${counters[groupId]}`;
    if (groupId !== previousGroup) {
      const groupName = mold.product_group_name || `产品${groupNumber}`;
      ws.getCell(row, 1).value = `${groupName}\n${groupNumber}.${counters[groupId]}`;
      ws.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(row, 1).font = { ...ws.getCell(row, 1).font, bold: true, name: FONT };
      ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, 34);
      // 模具表最后一个实际业务列是 Q（17）；不要把表格外的 R 列也染成分组蓝色。
      for (let column = 1; column <= 17; column += 1) {
        ws.getCell(row, column).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0F2FE' },
        };
      }
    }
    previousGroup = groupId;
  }
}

function patchMoldingProductGroups(ws, payloads) {
  const rows = (payloads.molding && payloads.molding.injection) || [];
  if (!rows.some(item => item.product_group_id || item.product_group_name)) return;
  const titleRow = findRow(ws, '二、注塑部分');
  if (!titleRow) return;
  ws.getCell(titleRow + 1, 1).value = '产品 / 序号';
  const counters = {};
  const groupNumbers = {};
  let groupCount = 0;
  let previousGroup = '';
  rows.forEach((item, index) => {
    const row = titleRow + 2 + index;
    const groupId = item.product_group_id || item.product_group_name || '';
    if (!groupId) return;
    if (!groupNumbers[groupId]) groupNumbers[groupId] = ++groupCount;
    counters[groupId] = (counters[groupId] || 0) + 1;
    ws.getCell(row, 1).value = `${groupNumbers[groupId]}.${counters[groupId]}`;
    if (groupId !== previousGroup) {
      const groupName = item.product_group_name || `产品${groupNumbers[groupId]}`;
      ws.getCell(row, 1).value = `${groupName}\n${groupNumbers[groupId]}.${counters[groupId]}`;
      ws.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(row, 1).font = { ...ws.getCell(row, 1).font, bold: true, name: FONT };
      ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, 34);
      for (let column = 1; column <= 15; column += 1) {
        ws.getCell(row, column).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' },
        };
      }
    }
    previousGroup = groupId;
  });
}

function patchZeroCartonRate(ws, payloads) {
  const cartonCalc = payloads.engineering && payloads.engineering.carton_calc;
  if (!cartonCalc || Number(cartonCalc.paper_rate) !== 0) return;
  const titleRow = findRow(ws, '📦 纸箱 / 运费 计算');
  if (!titleRow) return;
  const cartons = Array.isArray(cartonCalc.cartons) ? cartonCalc.cartons : [];
  const names = new Set(cartons.map((carton, index) => carton.name || `纸箱${index + 1}`));
  for (let row = titleRow + 1; row <= Math.min(ws.rowCount, titleRow + 100); row += 1) {
    const name = ws.getCell(row, 1).value;
    if (!names.has(name)) continue;
    ws.getCell(row, 6).value = {
      formula: `(B${row}+C${row}+2)*(C${row}+D${row}+1)*2*0/1000`,
      result: 0,
    };
    ws.getCell(row, 6).numFmt = '"HK$"0.0000';
  }
}

function patchUnitLabels(ws) {
  const productSizeRow = findRow(ws, '产品尺寸 CM');
  if (productSizeRow) ws.getCell(productSizeRow, 1).value = '产品尺寸（英寸）';
}

function patchSlush(ws, slush) {
  const titleRow = findRow(ws, '二·C、搪胶部分');
  const items = (slush && slush.slush_items) || [];
  if (!titleRow || !items.length) return {};
  const pct = num(slush.indo_pct);
  const titleStyle = cloneStyle(ws.getCell(titleRow, 1).style);
  const clearEnd = Math.max(ws.rowCount, titleRow + items.length * 20 + 5);
  unmergeRows(ws, titleRow, clearEnd);
  for (let row = titleRow; row <= clearEnd; row += 1) {
    for (let column = 1; column <= 31; column += 1) ws.getCell(row, column).value = null;
  }
  ws.columns = [
    { width: 17 }, { width: 18 }, { width: 16 }, { width: 16 },
    { width: 20 }, { width: 18 }, { width: 16 }, { width: 18 },
  ];
  const border = {
    top: { style: 'thin', color: { argb: EXPORT_COLORS.border } },
    left: { style: 'thin', color: { argb: EXPORT_COLORS.border } },
    bottom: { style: 'thin', color: { argb: EXPORT_COLORS.border } },
    right: { style: 'thin', color: { argb: EXPORT_COLORS.border } },
  };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const styleRange = (row, start, end, options = {}) => {
    for (let column = start; column <= end; column += 1) {
      const cell = ws.getCell(row, column);
      cell.border = border;
      cell.font = { name: FONT, size: 10, bold: !!options.bold, color: options.color ? { argb: options.color } : undefined };
      cell.alignment = { vertical: 'middle', horizontal: options.align || 'center', wrapText: true };
      if (options.fill) cell.fill = fill(options.fill);
      if (options.numFmt) cell.numFmt = options.numFmt;
    }
  };
  let total = 0;
  const totalCells = [];
  const indoCells = [];
  let row = titleRow;
  items.forEach((item, index) => {
    const costing = slushCosting(item);
    const unitPrice = slushUnitPrice(item);
    ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 1).value = `搪胶报价 · ${index + 1}# ${item.name || item.source_sheet || '产品'}`;
    applyStyle(ws.getCell(row, 1), titleStyle);
    ws.getCell(row, 1).fill = fill(EXPORT_COLORS.navy);
    ws.getCell(row, 1).font = { ...ws.getCell(row, 1).font, color: { argb: EXPORT_COLORS.white } };
    row += 1;
    [['产品编号', item.item_code || ''], ['胶件名称', item.name || ''], ['材料', item.material || ''], ['来源工作表', item.source_sheet || '']]
      .forEach(([label, value], pair) => {
        const column = pair * 2 + 1;
        ws.getCell(row, column).value = label;
        ws.getCell(row, column + 1).value = value;
        styleRange(row, column, column, { bold: true, fill: EXPORT_COLORS.section });
        styleRange(row, column + 1, column + 1, { align: 'left' });
      });
    row += 1;
    ws.mergeCells(row, 1, row, 4); ws.getCell(row, 1).value = '成本明细（HK$/PC）';
    ws.mergeCells(row, 5, row, 8); ws.getCell(row, 5).value = '生产参数（按导入模板）';
    styleRange(row, 1, 8, { bold: true, fill: EXPORT_COLORS.section, color: EXPORT_COLORS.navy });
    row += 1;
    const costStart = row;
    const costLabels = ['产品料价', '搪工', '批工/烤工', '色粉', '柴油', '电费', '运费/胶袋'];
    const paramLabels = ['料重(g)', '料价 HK$/lb', '24H搪工', '12H批工/烤工', '24H柴油', '24H电费', '色粉'];
    const paramValues = [item.weight_g, item.material_price_lb, item.slush_labor_24h, item.batch_labor_12h, item.diesel_24h, item.electricity_24h, item.pigment_price];
    for (let offset = 0; offset < 7; offset += 1) {
      const dataRow = row + offset;
      ws.mergeCells(dataRow, 1, dataRow, 2); ws.getCell(dataRow, 1).value = costLabels[offset];
      ws.mergeCells(dataRow, 3, dataRow, 4);
      ws.mergeCells(dataRow, 5, dataRow, 6); ws.getCell(dataRow, 5).value = paramLabels[offset];
      ws.mergeCells(dataRow, 7, dataRow, 8); ws.getCell(dataRow, 7).value = num(paramValues[offset]);
      styleRange(dataRow, 1, 2, { align: 'left' }); styleRange(dataRow, 3, 4, { numFmt: HKD4 });
      styleRange(dataRow, 5, 6, { align: 'left', fill: EXPORT_COLORS.soft }); styleRange(dataRow, 7, 8, { numFmt: '0.0000' });
    }
    ws.getCell(costStart, 3).value = { formula: `G${costStart}*G${costStart + 1}/454`, result: costing.material };
    ws.getCell(costStart + 1, 3).value = { formula: `IFERROR(G${costStart + 2}/G${costStart + 7},0)`, result: costing.slushLabor };
    ws.getCell(costStart + 2, 3).value = { formula: `IFERROR(G${costStart + 3}/G${costStart + 8},0)`, result: costing.batchLabor };
    ws.getCell(costStart + 3, 3).value = { formula: `G${costStart}*G${costStart + 6}/25000`, result: costing.pigment };
    ws.getCell(costStart + 4, 3).value = { formula: `IFERROR(G${costStart + 4}/G${costStart + 7},0)`, result: costing.diesel };
    ws.getCell(costStart + 5, 3).value = { formula: `IFERROR(G${costStart + 5}/G${costStart + 7},0)`, result: costing.electricity };
    ws.getCell(costStart + 6, 3).value = num(item.shipping_bag);
    row += 7;
    const extraParams = [
      ['日产量24H', item.daily_output], ['12H批产量', item.batch_output_12h],
      ['腊样', item.wax_sample], ['模费', item.mold_fee],
      ['模费币种', item.mold_fee_currency || ''], ['备注', item.note || ''],
    ];
    extraParams.forEach(([label, value], offset) => {
      const dataRow = costStart + 7 + offset;
      ws.mergeCells(dataRow, 5, dataRow, 6); ws.getCell(dataRow, 5).value = label;
      ws.mergeCells(dataRow, 7, dataRow, 8); ws.getCell(dataRow, 7).value = typeof value === 'number' ? num(value) : value;
      styleRange(dataRow, 5, 6, { align: 'left', fill: EXPORT_COLORS.soft }); styleRange(dataRow, 7, 8, { numFmt: '0.0000' });
    });
    const subtotalRow = row;
    const rows = [
      ['成本合计', { formula: `SUM(C${costStart}:C${costStart + 6})`, result: costing.subtotal }],
      ['利润 ×', num(item.markup_x) || 1],
      ['货价 HKD/PC', hasSlushCostingInputs(item) ? { formula: `C${subtotalRow}*C${subtotalRow + 1}`, result: unitPrice } : num(item.unit_price_hkd)],
      ['用量(PC)', num(item.qty)],
      ['总价 HKD', { formula: `C${subtotalRow + 2}*C${subtotalRow + 3}`, result: num(item.qty) * unitPrice }],
      [`印尼运费 ${pct}%`, { formula: `C${subtotalRow + 4}*${pct}/100`, result: num(item.qty) * unitPrice * pct / 100 }],
    ];
    rows.forEach(([label, value], offset) => {
      const dataRow = subtotalRow + offset;
      ws.mergeCells(dataRow, 1, dataRow, 2); ws.getCell(dataRow, 1).value = label;
      ws.mergeCells(dataRow, 3, dataRow, 4); ws.getCell(dataRow, 3).value = value;
      styleRange(dataRow, 1, 2, { bold: offset >= 4, align: 'left', fill: offset >= 4 ? EXPORT_COLORS.subtotal : undefined });
      styleRange(dataRow, 3, 4, { bold: offset >= 4, numFmt: offset === 1 || offset === 3 ? '0.0000' : HKD4, fill: offset >= 4 ? EXPORT_COLORS.subtotal : undefined });
    });
    totalCells.push(`C${subtotalRow + 4}`);
    indoCells.push(`C${subtotalRow + 5}`);
    total += num(item.qty) * unitPrice;
    row = subtotalRow + 7;
  });
  ws.mergeCells(row, 1, row, 6); ws.getCell(row, 1).value = '搪胶合计 HKD';
  ws.mergeCells(row, 7, row, 8); ws.getCell(row, 7).value = { formula: totalCells.join('+'), result: total };
  styleRange(row, 1, 8, { bold: true, fill: EXPORT_COLORS.total, numFmt: HKD4 });
  const totalRow = row;
  row += 1;
  ws.mergeCells(row, 1, row, 6); ws.getCell(row, 1).value = `搪胶印尼运费合计 HKD（${pct}%）`;
  ws.mergeCells(row, 7, row, 8); ws.getCell(row, 7).value = { formula: indoCells.join('+'), result: total * pct / 100 };
  styleRange(row, 1, 8, { bold: true, fill: EXPORT_COLORS.subtotal, numFmt: HKD4 });
  ws.views = [{ state: 'frozen', ySplit: titleRow - 1 }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return { slush: `G${totalRow}`, slushIndo: `G${row}`, total };
}

function patchSewingDetail(workbook, sewing) {
  const ws = workbook.getWorksheet('车缝明细');
  const groups = (sewing && sewing.sewing_groups) || [];
  if (!ws || !groups.length) return {};
  const pct = num(sewing.indo_pct);
  let row = 3;
  const weightedTerms = [];
  let weightedResult = 0;
  for (const group of groups) {
    const items = group.items || [];
    const start = row + 1;
    ws.getCell(row, 12).value = `印尼运费 ${pct}%`;
    applyStyle(ws.getCell(row, 12), ws.getCell(row, 11).style);
    items.forEach((item, index) => {
      const dataRow = start + index;
      const material = isSewLaborRow(item)
        ? 0
        : num(item.usage) * num(item.mat_price) * (num(item.markup) || 1);
      ws.getCell(dataRow, 12).value = isSewLaborRow(item)
        ? 0
        : { formula: `J${dataRow}*${pct}/100`, result: material * pct / 100 };
      applyStyle(ws.getCell(dataRow, 12), ws.getCell(dataRow, 11).style, HKD4);
    });
    const totalRow = start + items.length;
    const groupResult = sewMaterialOnlyAmount(group) * pct / 100;
    ws.getCell(totalRow, 12).value = items.length
      ? { formula: `SUM(L${start}:L${totalRow - 1})`, result: groupResult }
      : 0;
    applyStyle(ws.getCell(totalRow, 12), ws.getCell(totalRow, 10).style, HKD4);
    weightedTerms.push(`L${totalRow}*${sewGroupQty(group)}`);
    weightedResult += groupResult * sewGroupQty(group);
    row = totalRow + 4;
  }
  const overallRow = row - 2;
  if (overallRow <= ws.rowCount) {
    ws.getCell(overallRow, 12).value = {
      formula: `(${weightedTerms.join('+')})/${sewTotalQty(sewing)}`,
      result: weightedResult / sewTotalQty(sewing),
    };
    applyStyle(ws.getCell(overallRow, 12), ws.getCell(overallRow, 10).style, HKD4);
  }
  return { sewingMaterialHkd: sewWeightedMaterialRmb(sewing) };
}

function freeSubtotal(rows, fx) {
  return sum(rows || [], row => {
    if (row.unit_price_hkd != null && row.unit_price_hkd !== '') return num(row.qty) * num(row.unit_price_hkd);
    if (row.unit_price != null && row.unit_price !== '') return num(row.qty) * num(row.unit_price);
    return num(row.qty) * num(row.unit_price_rmb) / fx;
  });
}

function injectionSubtotal(molding) {
  const payload = molding || {};
  const lossM = 1 + num(payload.injection_loss_pct ?? 3) / 100;
  return weightedInjectionSum(payload, row =>
    num(row.weight_g) * lossM * num(row.material_unit_price) + num(row.shot_price));
}

function blowSubtotal(molding) {
  return sum((molding && molding.blow_items) || [], row => {
    const hasImportedMaterial = row.material_cost_hkd !== undefined
      && row.material_cost_hkd !== null && row.material_cost_hkd !== '';
    const material = hasImportedMaterial
      ? num(row.material_cost_hkd)
      : num(row.weight_g) * num(row.material_price_lb) / 454;
    const usage = row.usage_qty !== undefined && row.usage_qty !== null && row.usage_qty !== ''
      ? num(row.usage_qty)
      : 1;
    return (material + num(row.blow_labor) + num(row.flash)) * (num(row.profit_x) || 1) * usage;
  });
}

function secondProcSubtotal(painting) {
  const keys = ['clamp', 'pad', 'roast', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'];
  const payload = painting || {};
  const items = payload.painting_items || [];
  ensureExplicitProductGroups(items);
  return weightedRowsSum(payload, items, row =>
    sum(keys, key => num(row[`${key}_qty`]) * num(row[`${key}_unit`]))
  );
}

function indonesiaEntries(payloads, refs, fx) {
  const engineering = payloads.engineering || {};
  const electronic = payloads.electronic || {};
  const molding = payloads.molding || {};
  const slush = payloads.slush || {};
  const sewing = payloads.sewing || {};
  const painting = payloads.painting || {};
  const electronicRows = (electronic.electronics || []).length
    ? electronic.electronics
    : (engineering.electronics || []);
  return [
    {
      label: '工程：五金＋辅助＋包装',
      base: freeSubtotal(engineering.hardware, fx)
        + freeSubtotal(engineering.aux_materials, fx)
        + freeSubtotal(engineering.packaging_materials, fx),
      rate: num(engineering.indo_pct),
      formula: [refs.hardware, refs.packaging, refs.aux].filter(Boolean).join('+') || '0',
      note: '三表金额合计',
    },
    {
      label: '电子',
      base: freeSubtotal(electronicRows.filter(row => !isIcElectronicRow(row)), fx),
      rate: num(electronic.indo_pct),
      formula: refs['electronic:indoBase'] || '0',
      note: '电子金额合计（IC除外）',
    },
    {
      label: '注塑＋吹气',
      base: injectionSubtotal(molding) + blowSubtotal(molding),
      rate: num(molding.indo_pct),
      formula: [refs['二、注塑部分'], refs['二·B、吹气部分 (HKD)']].filter(Boolean).join('+') || '0',
      note: '啤机部金额合计',
    },
    {
      label: '搪胶',
      base: sum(slush.slush_items || [], item => slushUnitPrice(item) * num(item.qty)),
      rate: num(slush.indo_pct),
      formula: refs.slush || '0',
      note: '搪胶金额合计',
    },
    {
      label: '车缝物料（不含人工）',
      base: sewWeightedMaterialRmb(sewing) / fx,
      rate: num(sewing.indo_pct),
      formula: refs.sewingMaterialRmb
        ? `${refs.sewingMaterialRmb}/${fx}`
        : String(sewWeightedMaterialRmb(sewing) / fx),
      note: '车缝物料加权合计 RMB ÷ RMB→HKD',
    },
    {
      label: '二次加工（印喷）',
      base: secondProcSubtotal(painting) * 0.3,
      rate: num(painting.indo_pct),
      formula: refs.secondProc
        ? `${refs.secondProc}*30%`
        : '0',
      note: '喷油总价 × 30%为基数',
    },
  ];
}

function calculateIndonesiaSummary(workbook, ws, refs) {
  const terms = [];
  let total = 0;
  const append = (sheet, cellRef, formulaRef) => {
    if (!sheet || !cellRef || cellRef === '0') return;
    const value = sheet.getCell(cellRef).value;
    terms.push(formulaRef || cellRef);
    total += num(value && typeof value === 'object' ? value.result : value);
  };

  // 统一成本表已经包含：工程三表、电子（IC 除外）、印喷、车缝物料。
  append(ws, refs.unifiedIndoTotal);
  // 注塑、吹气与搪胶不在统一成本表中，直接引用各部门已经计算好的运费合计。
  append(ws, refs['二、注塑部分:indo']);
  append(ws, refs['二·B、吹气部分 (HKD):indo']);
  const slushWs = workbook.getWorksheet('搪胶明细');
  if (slushWs && refs.slushIndo) {
    append(slushWs, refs.slushIndo, `'搪胶明细'!${refs.slushIndo}`);
  }

  return { formula: terms.length ? terms.join('+') : '0', total };
}

function appendIndonesiaBlock(ws, row, payloads, refs, fx, styles) {
  const entries = indonesiaEntries(payloads, refs, fx);

  ws.mergeCells(row, 1, row, 14);
  ws.getCell(row, 1).value = '印尼运费明细（各部门基数 × 点数%）';
  applyStyle(ws.getCell(row, 1), styles.section);
  row += 1;
  ['来源', '计算基数 HKD', '点数 %', '印尼运费 HKD', '口径说明'].forEach((value, index) => {
    ws.getCell(row, index + 1).value = value;
    applyStyle(ws.getCell(row, index + 1), styles.header);
  });
  ws.mergeCells(row, 5, row, 14);
  paintHeader(ws, row, 14, styles.header);
  row += 1;
  const start = row;
  let total = 0;
  for (const entry of entries) {
    const amount = entry.base * entry.rate / 100;
    ws.getCell(row, 1).value = entry.label;
    ws.getCell(row, 2).value = { formula: entry.formula, result: entry.base };
    ws.getCell(row, 3).value = entry.rate;
    ws.getCell(row, 4).value = { formula: `B${row}*C${row}/100`, result: amount };
    ws.mergeCells(row, 5, row, 14);
    ws.getCell(row, 5).value = entry.note;
    for (let column = 1; column <= 14; column += 1) applyStyle(ws.getCell(row, column), styles.data);
    ws.getCell(row, 2).numFmt = HKD4;
    ws.getCell(row, 4).numFmt = HKD4;
    total += amount;
    row += 1;
  }
  ws.mergeCells(row, 1, row, 3);
  ws.getCell(row, 1).value = '印尼运费合计 HKD';
  ws.getCell(row, 4).value = { formula: `SUM(D${start}:D${row - 1})`, result: total };
  for (let column = 1; column <= 14; column += 1) applyStyle(ws.getCell(row, column), styles.total);
  ws.getCell(row, 4).numFmt = HKD4;
  const totalCell = `D${row}`;
  return { nextRow: row + 2, totalCell, total };
}

function findFreightRow(ws, name) {
  let match = null;
  ws.eachRow(row => row.eachCell(cell => {
    if (!match && cell.value === name) match = { row: row.number, col: cell.col };
  }));
  return match;
}

function findMainCartonRow(ws) {
  const freightHeader = findRow(ws, '运费场景');
  for (let row = 1; row < freightHeader; row += 1) {
    const cuft = ws.getCell(row, 5).value;
    const qty = ws.getCell(row, 7).value;
    if (cuft && qty && row > findRow(ws, '📦 纸箱 / 运费 计算')) return row;
  }
  return 0;
}

function appendSpinTransportBlock(ws, row, quote, sales, engineering, styles) {
  if (!isSpinCustomer(quote && quote.customer)) return row;
  const freight = sales.freight_calc || {};
  const spin = sales.spin_transport || {};
  const fx = num(spin.fx_hkd_usd) || 7.75;
  const divisor = num(spin.lcl_divisor) || 0.98;
  const carton = ((engineering.carton_calc || {}).cartons || [])[0] || engineering.carton_calc || {};
  const cartonCuft = num(carton.cuft) || num(carton.cl) * num(carton.cw) * num(carton.ch) / 1728;
  const pcs = num(carton.qty) || 1;
  const cartonRow = findMainCartonRow(ws);
  const defaults = [
    { label: '盐田散货 3吨', capacity_cuft: 450, unit_hkd: 16.8 },
    { label: '盐田散货 5吨', capacity_cuft: 850, unit_hkd: 11.24 },
    { label: '盐田散货 8吨', capacity_cuft: 1000, unit_hkd: 9.67 },
  ];
  const lcl = defaults.map((item, index) => ({ ...item, ...((spin.china_lcl || [])[index] || {}) }));
  const entries = [
    { label: '盐田 40HQ', capacity: num(freight.cap_40), fee: num(freight.yt40), source: 'YT 40柜' },
    { label: '盐田 20HQ', capacity: num(freight.cap_20), fee: num(freight.yt20), source: 'YT 20柜' },
    { label: 'HK 40HQ', capacity: num(freight.cap_40), fee: num(freight.hk40), source: 'HK 40柜' },
    { label: 'HK 20HQ', capacity: num(freight.cap_20), fee: num(freight.hk20), source: 'HK 20柜' },
    ...lcl.map(item => ({ label: item.label, capacity: num(item.capacity_cuft), fee: num(item.unit_hkd), lcl: true })),
  ];

  const blockStartRow = row;
  ws.mergeCells(row, 1, row, 13);
  ws.getCell(row, 1).value = 'SPIN 报客表运费计算（公式）';
  applyStyle(ws.getCell(row, 1), styles.section);
  row += 1;
  [
    '运输方式', '容量 CUFT', '运费/单价 HKD', 'HKD→USD', '散货找数',
    '每箱 CUFT', '每箱 PCS', '整箱数', '实际报客数量', '产品运费 USD/PCS',
    'SPIN散货参数', '容量 CUFT', '单价 HKD',
  ].forEach((value, index) => {
    ws.getCell(row, index + 1).value = value;
    applyStyle(ws.getCell(row, index + 1), styles.header);
  });
  row += 1;
  entries.forEach(entry => {
    const boxes = cartonCuft > 0 ? Math.floor(entry.capacity / cartonCuft) : 0;
    const actualQty = boxes * pcs;
    const result = entry.lcl
      ? (cartonCuft && pcs && divisor && fx ? entry.fee * cartonCuft / pcs / divisor / fx : 0)
      : (actualQty && fx ? entry.fee / fx / actualQty : 0);
    ws.getCell(row, 1).value = entry.label;
    if (entry.lcl) {
      ws.getCell(row, 11).value = entry.label;
      ws.getCell(row, 12).value = entry.capacity;
      ws.getCell(row, 13).value = entry.fee;
      ws.getCell(row, 2).value = { formula: `L${row}`, result: entry.capacity };
      ws.getCell(row, 3).value = { formula: `M${row}`, result: entry.fee };
    } else {
      const sourceCell = findFreightRow(ws, entry.source);
      ws.getCell(row, 2).value = {
        formula: sourceCell ? ws.getCell(sourceCell.row, sourceCell.col + 1).address : String(entry.capacity),
        result: entry.capacity,
      };
      ws.getCell(row, 3).value = {
        formula: sourceCell ? ws.getCell(sourceCell.row, sourceCell.col + 2).address : String(entry.fee),
        result: entry.fee,
      };
    }
    ws.getCell(row, 4).value = fx;
    ws.getCell(row, 5).value = entry.lcl ? divisor : null;
    ws.getCell(row, 6).value = cartonRow
      ? { formula: `E${cartonRow}`, result: cartonCuft }
      : cartonCuft;
    ws.getCell(row, 7).value = cartonRow ? { formula: `G${cartonRow}`, result: pcs } : pcs;
    ws.getCell(row, 8).value = { formula: `IFERROR(INT(B${row}/F${row}),0)`, result: boxes };
    ws.getCell(row, 9).value = { formula: `H${row}*G${row}`, result: actualQty };
    ws.getCell(row, 10).value = {
      formula: entry.lcl
        ? `IFERROR(C${row}*F${row}/G${row}/E${row}/D${row},0)`
        : `IFERROR(C${row}/D${row}/I${row},0)`,
      result,
    };
    for (let column = 1; column <= 13; column += 1) applyStyle(ws.getCell(row, column), styles.data);
    ws.getCell(row, 10).numFmt = '0.0000';
    row += 1;
  });
  // 保留运费表与“十、合计”之间的空白行，但仍套用完整表格边框，
  // 避免导出后 E:M 列看起来像缺失单元格。
  for (let column = 1; column <= 13; column += 1) {
    applyStyle(ws.getCell(row, column), styles.data);
  }
  // SPIN 运费表只使用 A:M。模板在 N:Q 可能残留黄色表头样式；这些格子没有内容，
  // 导出时应保持无填充，避免表格右侧出现悬空色块。
  for (let clearRow = blockStartRow; clearRow <= row; clearRow += 1) {
    for (let column = 14; column <= 17; column += 1) {
      const cell = ws.getCell(clearRow, column);
      if (cell.value === null || cell.value === undefined || cell.value === '') {
        cell.fill = { type: 'pattern', pattern: 'none' };
      }
    }
  }
  return row + 1;
}

function enhanceWorkbook(workbook, { quote, sections }) {
  const ws = workbook.getWorksheet('报价明细');
  if (!ws) return workbook;
  const paintingWs = workbook.getWorksheet('喷油明细');
  const slushWs = workbook.getWorksheet('搪胶明细');
  const payloads = parseSections(sections);
  const sales = payloads.sales || {};
  const fx = num(sales.header && sales.header.fx_rmb_hkd) || 0.85;

  patchMoldProductGroups(ws, payloads);
  patchMoldingProductGroups(ws, payloads);
  patchPaintingProductMix(paintingWs || ws, payloads.painting || {});
  patchUnitLabels(ws);
  patchFreeInputFormulas(ws, payloads);
  patchZeroCartonRate(ws, payloads);
  const refs = patchSimpleIndoColumns(ws, payloads);
  Object.assign(refs, patchUnifiedCostTable(ws, payloads));
  if (paintingWs) Object.assign(refs, patchSimpleIndoColumns(paintingWs, payloads));
  Object.assign(refs, patchSlush(slushWs || ws, payloads.slush || {}));
  const paintingSummaryRow = findRow(ws, '五、二次加工（印喷汇总）');
  if (paintingSummaryRow && refs.paintingDetail) {
    ws.getCell(paintingSummaryRow + 1, 9).value = {
      formula: `'喷油明细'!${refs.paintingDetail}`,
      result: weightedRowsSum(
        payloads.painting || {},
        (payloads.painting && payloads.painting.painting_items) || [],
        item => sum(
          ['clamp', 'pad', 'roast', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'],
          key => num(item[`${key}_qty`]) * num(item[`${key}_unit`])
        )
      ),
    };
    ws.getCell(paintingSummaryRow + 1, 9).numFmt = HKD4;
    // 印尼运费与后续汇总统一引用主表上的印喷汇总单元格，避免把喷油明细
    // 工作表里的裸地址误当作主表地址，Excel 重算后得到 0。
    refs.secondProc = `I${paintingSummaryRow + 1}`;
  }
  const slushSummaryRow = findRow(ws, '二·C、搪胶部分（汇总）');
  if (slushSummaryRow && refs.slush) {
    ws.getCell(slushSummaryRow + 1, 9).value = {
      formula: `'搪胶明细'!${refs.slush}`,
      result: num(refs.total),
    };
    ws.getCell(slushSummaryRow + 1, 9).numFmt = HKD4;
    refs.slush = `I${slushSummaryRow + 1}`;
  }
  const sewingRefs = patchSewingDetail(workbook, payloads.sewing || {});
  if (!refs.sewingMaterialRmb && sewingRefs.sewingMaterialHkd) {
    refs.sewingMaterialRmb = String(sewingRefs.sewingMaterialHkd);
  }

  const summaryTitleRow = findRow(ws, '十、合计');
  if (!summaryTitleRow) {
    applyPrintLayout(workbook);
    return workbook;
  }
  // 主表不再重复插入印尼运费明细，只在「十、合计」显示汇总。
  // SPIN 专用运费计算表仍放在生产模具费用前面。
  const moldCostsTitleRow = findRow(ws, '生产模具费用');
  const insertRow = moldCostsTitleRow || summaryTitleRow;
  const isSpin = isSpinCustomer(quote && quote.customer);
  const extraRows = isSpin ? 10 : 0;
  const styles = {
    section: cloneStyle(ws.getCell(summaryTitleRow, 1).style),
    header: cloneStyle(ws.getCell(Math.max(1, summaryTitleRow - 10), 1).style),
    data: cloneStyle(ws.getCell(Math.max(1, summaryTitleRow - 9), 1).style),
    total: cloneStyle(ws.getCell(summaryTitleRow + 2, 1).style),
  };
  if (extraRows > 0) {
    shiftRowsDown(ws, insertRow, extraRows);
    appendSpinTransportBlock(
      ws,
      insertRow,
      quote,
      sales,
      payloads.engineering || {},
      styles
    );
  }

  const indo = calculateIndonesiaSummary(workbook, ws, refs);

  const movedSummaryTitle = findRow(ws, '十、合计');
  if (movedSummaryTitle) {
    ws.getCell(movedSummaryTitle + 2, 9).value = {
      formula: indo.formula,
      result: indo.total,
    };
    ws.getCell(movedSummaryTitle + 2, 9).numFmt = HKD4;
  }
  workbook.calcProperties = { fullCalcOnLoad: true };
  applyPrintLayout(workbook);
  return workbook;
}

async function buildWorkbook(args) {
  const workbook = await buildBaseWorkbook(adaptSurtaxForBase(args));
  return enhanceWorkbook(workbook, args);
}

module.exports = { buildWorkbook, enhanceWorkbook, adaptSurtaxForBase };
