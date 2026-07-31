'use strict';

// Keep the long-standing internal quotation renderer unchanged.  The contract
// check rejects a new blob larger than 50 KB, so new formula sections live in
// this small post-processor instead of growing exportXlsx.js further.
const { buildWorkbook: buildBaseWorkbook } = require('./exportXlsx');
const { toExcelFormulaInput, fractionNumberFormat } = require('../../frontend/formula-input');

const FONT = 'Microsoft YaHei';
const HKD4 = '"HK$"0.0000';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(rows, getter) {
  return (rows || []).reduce((total, row) => total + num(getter(row)), 0);
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

  for (const model of merges) {
    if (model.top < startRow) continue;
    ws.mergeCells(
      model.top + shift,
      model.left,
      model.bottom + shift,
      model.right
    );
  }

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

function patchSimpleIndoColumns(ws, payloads) {
  const patches = [
    { title: '二、注塑部分', dept: payloads.molding || {}, amountCol: 16, indoCol: 17 },
    { title: '二·B、吹气部分 (HKD)', dept: payloads.molding || {}, amountCol: 11, indoCol: 14 },
    { title: '三、二次加工（印喷报价）', dept: payloads.painting || {}, amountCol: 22, indoCol: 23, factor: 0.3 },
    { title: '四、电子', dept: payloads.electronic || {}, amountCol: 10, indoCol: 11 },
    { title: '五、五金', dept: payloads.engineering || {}, amountCol: 10, indoCol: 11 },
    { title: '六、辅助材料', dept: payloads.engineering || {}, amountCol: 10, indoCol: 11 },
    { title: '七、包装材料', dept: payloads.engineering || {}, amountCol: 10, indoCol: 11 },
  ];

  const refs = {};
  for (const patch of patches) {
    const titleRow = findRow(ws, patch.title);
    if (!titleRow) continue;
    const headerRow = titleRow + 1;
    const totalRow = findRowMatching(
      ws,
      value => /^(合计|小计)/.test(String(value || '')),
      headerRow + 1,
      Math.min(ws.rowCount, headerRow + 100)
    );
    if (!totalRow) continue;
    const pct = num(patch.dept.indo_pct);
    const headerStyle = ws.getCell(headerRow, 1).style;
    ws.getCell(headerRow, patch.indoCol).value = `印尼运费 ${pct}%`;
    applyStyle(ws.getCell(headerRow, patch.indoCol), headerStyle);
    let total = 0;
    for (let row = headerRow + 1; row < totalRow; row += 1) {
      const amountCell = ws.getCell(row, patch.amountCol);
      const amount = num(amountCell.value && typeof amountCell.value === 'object'
        ? amountCell.value.result
        : amountCell.value);
      if (!amount && !ws.getCell(row, 1).value) continue;
      const factor = patch.factor || 1;
      const result = amount * factor * pct / 100;
      const formula = patch.factor
        ? `${colLetter(patch.amountCol)}${row}*30%*${pct}/100`
        : `${colLetter(patch.amountCol)}${row}*${pct}/100`;
      ws.getCell(row, patch.indoCol).value = { formula, result };
      ws.getCell(row, patch.indoCol).numFmt = HKD4;
      applyStyle(ws.getCell(row, patch.indoCol), ws.getCell(row, patch.amountCol).style, HKD4);
      total += result;
    }
    ws.getCell(totalRow, patch.indoCol).value = {
      formula: `SUM(${colLetter(patch.indoCol)}${headerRow + 1}:${colLetter(patch.indoCol)}${totalRow - 1})`,
      result: total,
    };
    applyStyle(ws.getCell(totalRow, patch.indoCol), ws.getCell(totalRow, patch.amountCol).style, HKD4);
    refs[patch.title] = `${colLetter(patch.amountCol)}${totalRow}`;
    refs[`${patch.title}:indo`] = `${colLetter(patch.indoCol)}${totalRow}`;
  }
  return refs;
}

function patchFreeInputFormulas(ws, payloads) {
  const engineering = payloads.engineering || {};
  const sections = [
    { title: '五、五金', rows: engineering.hardware || [] },
    { title: '六、辅助材料', rows: engineering.aux_materials || [] },
    { title: '七、包装材料', rows: engineering.packaging_materials || [] },
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
      if (priceFormula) {
        ws.getCell(row, 8).value = { formula: priceFormula, result: num(item.unit_price_rmb) };
      } else if (priceFractionFmt) {
        ws.getCell(row, 8).value = num(item.unit_price_rmb);
        ws.getCell(row, 8).numFmt = priceFractionFmt;
      }
    });
  }
}

function patchZeroCartonRate(ws, payloads) {
  const cartonCalc = payloads.engineering && payloads.engineering.carton_calc;
  if (!cartonCalc || Number(cartonCalc.paper_rate) !== 0) return;
  const titleRow = findRow(ws, '📦 纸箱 / 运费 计算（参考）');
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

function patchSlush(ws, slush) {
  const titleRow = findRow(ws, '二·C、搪胶部分');
  const items = (slush && slush.slush_items) || [];
  if (!titleRow || !items.length) return {};
  const headerRow = titleRow + 1;
  const dataStart = headerRow + 1;
  const totalRow = dataStart + items.length;
  const pct = num(slush.indo_pct);
  const titleStyle = cloneStyle(ws.getCell(titleRow, 1).style);
  const headerStyle = cloneStyle(ws.getCell(headerRow, 1).style);
  const dataStyle = cloneStyle(ws.getCell(dataStart, 1).style);
  const totalStyle = cloneStyle(ws.getCell(totalRow, 1).style);
  unmergeRows(ws, titleRow, totalRow);
  for (let row = titleRow; row <= totalRow; row += 1) {
    for (let column = 1; column <= 31; column += 1) ws.getCell(row, column).value = null;
  }

  ws.mergeCells(titleRow, 1, titleRow, 31);
  ws.getCell(titleRow, 1).value = '二·C、搪胶部分';
  applyStyle(ws.getCell(titleRow, 1), titleStyle);
  const headers = [
    '序号', '图片', '产品编号', '胶件名称', '材料', '料重(g)', '料价 HK$/lb',
    '24H搪工', '12H批工/烤工', '24H柴油', '24H电费', '色粉', '日产量24H',
    '12H批产量', '腊样', '模费金额', '模费币种', '运费/胶袋', '料价成本',
    '搪工成本', '批工成本', '色粉成本', '柴油成本', '电费成本', '码点',
    '成本合计', '用量(PC)', '货价 HKD', '总价 HKD', `印尼运费 ${pct}%`, '备注',
  ];
  headers.forEach((value, index) => {
    ws.getCell(headerRow, index + 1).value = value;
    applyStyle(ws.getCell(headerRow, index + 1), headerStyle);
  });

  let total = 0;
  items.forEach((item, index) => {
    const row = dataStart + index;
    const costing = slushCosting(item);
    const unitPrice = slushUnitPrice(item);
    const values = [
      index + 1, (item.images || []).length ? `${item.images.length} 张` : '',
      item.item_code || '', item.name || '', item.material || '', num(item.weight_g),
      num(item.material_price_lb), num(item.slush_labor_24h), num(item.batch_labor_12h),
      num(item.diesel_24h), num(item.electricity_24h), num(item.pigment_price),
      num(item.daily_output), num(item.batch_output_12h), num(item.wax_sample),
      num(item.mold_fee), item.mold_fee_currency || '', num(item.shipping_bag),
    ];
    values.forEach((value, offset) => { ws.getCell(row, offset + 1).value = value; });
    ws.getCell(row, 19).value = { formula: `F${row}*G${row}/454`, result: costing.material };
    ws.getCell(row, 20).value = { formula: `IFERROR(H${row}/M${row},0)`, result: costing.slushLabor };
    ws.getCell(row, 21).value = { formula: `IFERROR(I${row}/N${row},0)`, result: costing.batchLabor };
    ws.getCell(row, 22).value = { formula: `F${row}*L${row}/25000`, result: costing.pigment };
    ws.getCell(row, 23).value = { formula: `IFERROR(J${row}/M${row},0)`, result: costing.diesel };
    ws.getCell(row, 24).value = { formula: `IFERROR(K${row}/M${row},0)`, result: costing.electricity };
    ws.getCell(row, 25).value = num(item.markup_x) || 1;
    ws.getCell(row, 26).value = { formula: `SUM(S${row}:X${row})+R${row}`, result: costing.subtotal };
    ws.getCell(row, 27).value = num(item.qty);
    ws.getCell(row, 28).value = hasSlushCostingInputs(item)
      ? { formula: `Z${row}*Y${row}`, result: unitPrice }
      : num(item.unit_price_hkd);
    ws.getCell(row, 29).value = { formula: `AA${row}*AB${row}`, result: num(item.qty) * unitPrice };
    ws.getCell(row, 30).value = { formula: `AC${row}*${pct}/100`, result: num(item.qty) * unitPrice * pct / 100 };
    ws.getCell(row, 31).value = item.note || '';
    for (let column = 1; column <= 31; column += 1) {
      applyStyle(ws.getCell(row, column), dataStyle, column >= 6 && column <= 30 && column !== 17 ? '0.0000' : undefined);
    }
    total += num(item.qty) * unitPrice;
  });

  ws.mergeCells(totalRow, 1, totalRow, 28);
  ws.getCell(totalRow, 1).value = '合计 HKD';
  applyStyle(ws.getCell(totalRow, 1), totalStyle);
  ws.getCell(totalRow, 29).value = {
    formula: `SUM(AC${dataStart}:AC${totalRow - 1})`,
    result: total,
  };
  ws.getCell(totalRow, 30).value = {
    formula: `SUM(AD${dataStart}:AD${totalRow - 1})`,
    result: total * pct / 100,
  };
  for (let column = 29; column <= 30; column += 1) {
    applyStyle(ws.getCell(totalRow, column), totalStyle, HKD4);
    ws.getCell(totalRow, column).font = { bold: true, name: FONT };
  }
  return { slush: `AC${totalRow}`, slushIndo: `AD${totalRow}`, total };
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
  return sum((molding && molding.injection) || [], row => {
    const material = num(row.material_unit_price)
      || num(row.weight_g) * num(row.material_price_lb) / 454;
    return material + num(row.shot_price);
  });
}

function blowSubtotal(molding) {
  return sum((molding && molding.blow_items) || [], row => {
    const material = num(row.weight_g) * num(row.material_price_lb) / 454;
    return (material + num(row.blow_labor) + num(row.flash)) * (num(row.profit_x) || 1);
  });
}

function secondProcSubtotal(painting) {
  const keys = ['clamp', 'pad', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'];
  return sum((painting && painting.painting_items) || [], row =>
    sum(keys, key => num(row[`${key}_qty`]) * num(row[`${key}_unit`]))
  );
}

function appendIndonesiaBlock(ws, row, payloads, refs, fx, styles) {
  const engineering = payloads.engineering || {};
  const electronic = payloads.electronic || {};
  const molding = payloads.molding || {};
  const slush = payloads.slush || {};
  const sewing = payloads.sewing || {};
  const painting = payloads.painting || {};
  const electronicRows = (electronic.electronics || []).length
    ? electronic.electronics
    : (engineering.electronics || []);
  const entries = [
    {
      label: '工程：五金＋辅助＋包装',
      base: freeSubtotal(engineering.hardware, fx)
        + freeSubtotal(engineering.aux_materials, fx)
        + freeSubtotal(engineering.packaging_materials, fx),
      rate: num(engineering.indo_pct),
      formula: [refs['五、五金'], refs['六、辅助材料'], refs['七、包装材料']].filter(Boolean).join('+') || '0',
      note: '三表金额合计',
    },
    {
      label: '电子',
      base: freeSubtotal(electronicRows, fx),
      rate: num(electronic.indo_pct),
      formula: refs['四、电子'] || '0',
      note: '电子金额合计',
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
      label: '车缝材料（不含人工）',
      base: sewWeightedMaterialRmb(sewing) / fx,
      rate: num(sewing.indo_pct),
      formula: refs.sewingMaterialHkd
        ? `${refs.sewingMaterialHkd}/${fx}`
        : String(sewWeightedMaterialRmb(sewing) / fx),
      note: '材料加权合计 RMB ÷ RMB→HKD',
    },
    {
      label: '二次加工（印喷）',
      base: secondProcSubtotal(painting) * 0.3,
      rate: num(painting.indo_pct),
      formula: refs['三、二次加工（印喷报价）']
        ? `${refs['三、二次加工（印喷报价）']}*30%`
        : '0',
      note: '喷油总价 × 30%为基数',
    },
  ];

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
  return findRowMatching(ws, value => value === name);
}

function findMainCartonRow(ws) {
  const freightHeader = findRow(ws, '运费场景');
  for (let row = 1; row < freightHeader; row += 1) {
    const cuft = ws.getCell(row, 5).value;
    const qty = ws.getCell(row, 7).value;
    if (cuft && qty && row > findRow(ws, '📦 纸箱 / 运费 计算（参考）')) return row;
  }
  return 0;
}

function appendSpinTransportBlock(ws, row, quote, sales, engineering, styles) {
  if (String(quote && quote.customer || '').trim().toUpperCase() !== 'SPIN') return row;
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
      const sourceRow = findFreightRow(ws, entry.source);
      ws.getCell(row, 2).value = {
        formula: sourceRow ? `B${sourceRow}` : String(entry.capacity),
        result: entry.capacity,
      };
      ws.getCell(row, 3).value = {
        formula: sourceRow ? `C${sourceRow}` : String(entry.fee),
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
  return row + 1;
}

function enhanceWorkbook(workbook, { quote, sections }) {
  const ws = workbook.getWorksheet('报价明细');
  if (!ws) return workbook;
  const payloads = parseSections(sections);
  const sales = payloads.sales || {};
  const fx = num(sales.header && sales.header.fx_rmb_hkd) || 0.85;

  patchFreeInputFormulas(ws, payloads);
  patchZeroCartonRate(ws, payloads);
  const refs = patchSimpleIndoColumns(ws, payloads);
  Object.assign(refs, patchSlush(ws, payloads.slush || {}));
  const sewingRefs = patchSewingDetail(workbook, payloads.sewing || {});
  if (sewingRefs.sewingMaterialHkd) {
    refs.sewingMaterialHkd = String(sewingRefs.sewingMaterialHkd);
  }

  const summaryTitleRow = findRow(ws, '十、合计');
  if (!summaryTitleRow) return workbook;
  const extraRows = 10 + (String(quote && quote.customer || '').trim().toUpperCase() === 'SPIN' ? 10 : 0);
  const styles = {
    section: cloneStyle(ws.getCell(summaryTitleRow, 1).style),
    header: cloneStyle(ws.getCell(Math.max(1, summaryTitleRow - 10), 1).style),
    data: cloneStyle(ws.getCell(Math.max(1, summaryTitleRow - 9), 1).style),
    total: cloneStyle(ws.getCell(summaryTitleRow + 2, 1).style),
  };
  shiftRowsDown(ws, summaryTitleRow, extraRows);
  let row = summaryTitleRow;
  const indo = appendIndonesiaBlock(ws, row, payloads, refs, fx, styles);
  row = indo.nextRow;
  row = appendSpinTransportBlock(
    ws,
    row,
    quote,
    sales,
    payloads.engineering || {},
    styles
  );

  const movedSummaryTitle = findRow(ws, '十、合计');
  if (movedSummaryTitle) {
    ws.getCell(movedSummaryTitle + 2, 9).value = {
      formula: indo.totalCell,
      result: indo.total,
    };
    ws.getCell(movedSummaryTitle + 2, 9).numFmt = HKD4;
  }
  workbook.calcProperties = { fullCalcOnLoad: true };
  return workbook;
}

async function buildWorkbook(args) {
  const workbook = await buildBaseWorkbook(adaptSurtaxForBase(args));
  return enhanceWorkbook(workbook, args);
}

module.exports = { buildWorkbook, enhanceWorkbook, adaptSurtaxForBase };
