/**
 * 报客表 (Vendor Quotation / VQ) 导出服务 — 模板驱动
 *
 * 复用「报价系统」TOMY 的 VQ-template.xlsx 版式与填充逻辑（fillVQ / fillBCD 原样搬运，
 * 仅数据来源改为本系统 quote_sections.payload_json）。
 *
 * 思路：sectionsToData() 把内部报价各部门 payload 归一化成与报价系统 loadData() 相同的
 * 中间对象 `d`，再交给原样搬运的 fillVQ / fillBCD 填模板，最大限度减少与源系统的版式偏差。
 *
 * 覆盖范围：TOMY 与 SPIN；按客户分派到各自模板及填充逻辑。
 */
const ExcelJS = require('exceljs');
const { exportSpin } = require('./exportSpin');
const { readTemplateParts } = require('./templateParts');
const { customerEnglish } = require('./vqEnglish');
const { ensureExplicitProductGroups, weightedRowsSum } = require('./productMix');


// 报客表「Mark Up (%)」固定加价率 — 统一套到原料/人工/购买件/车缝等成本行。
// 需要调整报客表加价时，改这一个数即可（模板里 D. Expensive Component 行始终 0%，不受此值影响）。
const VQ_MARKUP = 0.18;   // 18%
const SEWING_DEFAULT_MARKUP = 1.08;
const ASSEMBLY_MARKUP = 1.10;
const HKD_FMT = '$#,##0.00';
const HKD_LABEL_FMT = '"HK$"#,##0.00';

// ─── Helpers（搬运自报价系统 excel-exporter.js）──────────────────────────────

const num = (v) => Number(v) || 0;
const sewingMarkup = (row) => {
  if (!row || row.markup === undefined || row.markup === null || row.markup === '') return SEWING_DEFAULT_MARKUP;
  return num(row.markup) || SEWING_DEFAULT_MARKUP;
};

// TOMY 报客表同一单元格显示英文和中文；已有英文优先，否则套常见内部名称英译。
function biName(zh, eng) {
  const z = (zh || '').trim();
  const e = customerEnglish((eng || '').trim() || z);
  if (/[\u3400-\u9fff]/.test(z) && e && e !== z) return `${e}\n${z}`;
  return e || z;
}

// Round a numeric value to 2 decimal places (for monetary amounts)
function r2(v) {
  const n = parseFloat(v);
  return (n == null || isNaN(n)) ? null : Math.round(n * 100) / 100;
}

function r4(v) {
  const n = parseFloat(v);
  return (n == null || isNaN(n)) ? null : Math.round(n * 10000) / 10000;
}

function setVal(ws, row, col, value) {
  const cell = ws.getCell(row, col);
  if (cell.value && typeof cell.value === 'object' && cell.value.formula) return;
  if (typeof value === 'number' && isNaN(value)) value = null;
  cell.value = (value === undefined) ? null : value;
}

function setBiVal(ws, row, col, zh, eng) {
  const value = biName(zh, eng);
  setVal(ws, row, col, value);
  if (!value.includes('\n')) return;
  const cell = ws.getCell(row, col);
  cell.alignment = {
    ...(cell.alignment || {}),
    vertical: 'middle',
    wrapText: true,
  };
  const requiredHeight = value.length > 70 ? 46 : 34;
  ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, requiredHeight);
}

function clearRows(ws, startRow, endRow, dataCols) {
  for (let r = startRow; r <= endRow; r++) {
    for (const c of dataCols) {
      const cell = ws.getCell(r, c);
      if (!(cell.value && typeof cell.value === 'object' && cell.value.formula)) {
        cell.value = null;
      }
    }
  }
}

function fixSharedFormulas(wb) {
  wb.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.value && typeof cell.value === 'object') {
          const v = cell.value;
          if (v.sharedFormula) {
            cell.value = { formula: v.sharedFormula, result: v.result };
          } else if (v.formula !== undefined) {
            const r = v.result;
            if (r === null || r === undefined || (typeof r === 'number' && isNaN(r))) {
              cell.value = { formula: v.formula };
            }
          }
        }
      });
    });
  });
}

function normalizeHkdFormats(ws) {
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      if (typeof cell.numFmt === 'string' && cell.numFmt.includes('$') && !cell.numFmt.includes('%')) {
        cell.numFmt = HKD_FMT;
      }
    }
  }
}

// ─── Fill Vendor Quotation sheet（搬运自 excel-exporter.js fillVQ）──────────────

function fillVQ(ws, d) {
  const { version, product, params, packagingItems, productDim, transportConfig, vqSupplements } = d;

  setVal(ws, 2, 3, 'ROYAL REGENT PRODUCTS (H.K.) LIMITED');
  setVal(ws, 2, 8, version.prepared_by || (product?.client === 'TOMY' ? 'Michelle' : ''));
  setVal(ws, 3, 3, product?.item_no || '');
  setVal(ws, 3, 8, new Date());
  setBiVal(ws, 4, 3, product?.item_desc, product?.item_desc_eng);
  setVal(ws, 4, 8, version.quote_rev || '');
  setVal(ws, 5, 3, version.item_rev || '');
  setVal(ws, 5, 8, version.fty_delivery_date || '');

  if (product?.item_no) {
    setVal(ws, 11, 1, product.item_no + '-00');
    setBiVal(ws, 11, 2, product.item_desc, product.item_desc_eng);
    const detectedMoq = num(product.moq) || (packagingItems || []).find(i => i.moq)?.moq || 2500;
    setVal(ws, 11, 5, detectedMoq);
    setVal(ws, 11, 6, 1);
  }
  for (let r = 12; r <= 16; r++) {
    for (const c of [1, 2, 5, 6, 7, 8]) {
      const cell = ws.getCell(r, c);
      delete cell._sharedFormula;
      cell.value = null;
    }
  }
  vqSupplements.slice(0, 5).forEach((acc, i) => {
    const r = 12 + i;
    setVal(ws, r, 1, acc.part_no || '');
    setBiVal(ws, r, 2, acc.description, acc.eng_name);
    setVal(ws, r, 5, parseInt(acc.moq) || 2500);
    setVal(ws, r, 6, parseFloat(acc.usage_qty) || 1);
    setVal(ws, r, 7, r2(acc.unit_price) || 0);
    const amt = r2((parseFloat(acc.usage_qty) || 1) * (r2(acc.unit_price) || 0));
    ws.getCell(r, 8).value = { formula: `F${r}*G${r}`, result: amt };
  });

  const PKG_START = 23, PKG_END = 35;
  for (let r = PKG_START; r <= PKG_END; r++) {
    for (const c of [1, 2, 3, 5, 6, 7, 8]) {
      const cell = ws.getCell(r, c);
      delete cell._sharedFormula;
      cell.value = null;
    }
  }
  const accItem    = packagingItems.find(i => i.name === 'Accessories');
  const labourItem = packagingItems.find(i => i.name === 'Packing Labour');
  const regularItems = packagingItems.filter(i => i.name !== 'Accessories' && i.name !== 'Packing Labour');
  const ACC_ROW = PKG_END - 1;
  const LABOUR_ROW = PKG_END;
  const detectedMoq = num(product.moq) || (packagingItems || []).find(i => i.moq)?.moq || 2500;
  let pkgSubtotal = 0;

  const PKG_FONT = { size: 12, name: 'Arial', charset: 134 };
  function writePkgRow(r, item) {
    setVal(ws, r, 1, item.pm_no || '');
    setBiVal(ws, r, 2, item.name, item.eng_name);
    setBiVal(ws, r, 3, item.remark, item.remark_eng);
    for (const c of [1, 2, 3, 5, 6, 7, 8]) {
      ws.getCell(r, c).font = PKG_FONT;
    }
    setVal(ws, r, 5, item.moq != null ? item.moq : detectedMoq);
    setVal(ws, r, 6, item.quantity || 1);
    setVal(ws, r, 7, r2(item.new_price) || 0);
    const amt = r2((parseFloat(item.quantity) || 1) * (r2(item.new_price) || 0));
    pkgSubtotal += amt || 0;
    const hCell = ws.getCell(r, 8);
    delete hCell._sharedFormula;
    hCell.value = { formula: `ROUND(F${r}*G${r},2)`, result: amt };
  }

  regularItems.slice(0, ACC_ROW - PKG_START).forEach((item, i) => {
    writePkgRow(PKG_START + i, item);
  });
  if (accItem) {
    writePkgRow(ACC_ROW, accItem);
    ws.getCell(ACC_ROW, 5).value = null;
  }
  if (labourItem) {
    writePkgRow(LABOUR_ROW, labourItem);
    ws.getCell(LABOUR_ROW, 5).value = null;
  }
  const pkgMarkup = 0.12;
  setVal(ws, 36, 7, pkgMarkup);
  const pkgMarkupAmt = r2(pkgSubtotal * pkgMarkup) || 0;
  const pkgTotalAmt = r2(pkgSubtotal + pkgMarkupAmt) || 0;
  const pkgMarkupCell = ws.getCell(36, 8);
  delete pkgMarkupCell._sharedFormula;
  pkgMarkupCell.value = { formula: 'ROUND((SUM(H23:H35)*G36),2)', result: pkgMarkupAmt };
  const pkgTotalCell = ws.getCell(36, 9);
  delete pkgTotalCell._sharedFormula;
  pkgTotalCell.value = { formula: 'SUM(H23:H36)', result: pkgTotalAmt };

  if (productDim) {
    setVal(ws, 52, 2, parseFloat(productDim.carton_l_inch) || null);
    setVal(ws, 52, 3, parseFloat(productDim.carton_w_inch) || null);
    setVal(ws, 52, 4, parseFloat(productDim.carton_h_inch) || null);
    const casePackStr = productDim.case_pack || '1';
    const casePackFrac = String(casePackStr).match(/^(\d+)\s*\/\s*(\d+)$/);
    const casePackNum = casePackFrac ? parseInt(casePackFrac[1]) / parseInt(casePackFrac[2]) : (parseFloat(casePackStr) || 1);
    const unitCostCalc = r2(productDim.carton_price) || 0;
    const cartonAmt = r2(casePackNum * unitCostCalc) || 0;
    setVal(ws, 52, 6, casePackNum);
    ws.getCell(52, 6).numFmt = '# ?/?';
    setVal(ws, 52, 7, unitCostCalc);
    const amtCell = ws.getCell(52, 8);
    delete amtCell._sharedFormula;
    amtCell.value = { formula: 'ROUND(F52*G52,2)', result: cartonAmt };
    amtCell.numFmt = HKD_FMT;
  }

  if (transportConfig) {
    setVal(ws, 58, 6, r2(transportConfig.hk_10t_cost) || 0.5);
    setVal(ws, 58, 7, r2(transportConfig.yt_40_cost)  || 4.3);
    setVal(ws, 58, 8, r2(transportConfig.hk_40_cost)  || 15.85);
  }
  for (const col of [6, 7, 8]) {
    const L = ['', 'A','B','C','D','E','F','G','H'][col];
    const cell = ws.getCell(59, col);
    delete cell._sharedFormula;
    cell.value = { formula: `${L}58*$C$58`, result: 0 };
  }

  const hkdUsdRate = parseFloat(params.hkd_usd) || 7.76;  // 统一用内部报价的 HKD→USD 汇率
  const colLetters = { 6: 'F', 7: 'G', 8: 'H' };
  const summaryMoq = detectedMoq;
  function moqToLabel(n) {
    if (!n) return '';
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${k}K`;
  }
  const MOQ_TIERS = [2500, 5000, 10000, 15000];
  const startIdx = MOQ_TIERS.indexOf(summaryMoq);
  const moqSequence = startIdx >= 0
    ? [0, 1, 2, 3].map(i => MOQ_TIERS[startIdx + i] || null)
    : [summaryMoq, ...MOQ_TIERS.filter(n => n > summaryMoq)].slice(0, 4);
  const summaryHkdRows = [68, 70, 72, 74];
  summaryHkdRows.forEach((hkdRow, idx) => {
    const moq = moqSequence[idx];
    ws.getCell(hkdRow, 5).value = moqToLabel(moq);
    ws.getCell(hkdRow + 1, 5).value = moqToLabel(moq);
    for (const col of [6, 7, 8]) {
      const L = colLetters[col];
      const hCell = ws.getCell(hkdRow, col);
      delete hCell._sharedFormula;
      if (idx === 0) {
        hCell.value = moq ? { formula: `$I$17+$I$36+$I$44+$I$52+${L}59`, result: 0 } : null;
      } else {
        const mult = (1 - 0.005 * idx).toFixed(3);
        hCell.value = moq ? { formula: `${L}68*${mult}`, result: 0 } : null;
      }
      const uCell = ws.getCell(hkdRow + 1, col);
      delete uCell._sharedFormula;
      uCell.value = moq ? { formula: `ROUND(${L}${hkdRow}/${hkdUsdRate},3)`, result: 0 } : null;
    }
  });

  ws.getColumn(3).width = 20;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 18;
  ws.getColumn(8).width = 18;

  for (let r = 23; r <= 35; r++) {
    ws.getCell(r, 7).numFmt = HKD_FMT;
    ws.getCell(r, 8).numFmt = HKD_FMT;
    ws.getCell(r, 9).numFmt = HKD_FMT;
  }
  ws.getCell(36, 7).numFmt = '0.00%';
  ws.getCell(36, 8).numFmt = HKD_FMT;
  ws.getCell(36, 9).numFmt = HKD_FMT;
  for (const r of [17, 44, 52, 59, 68, 70, 72, 74]) {
    for (const c of [6, 7, 8, 9]) ws.getCell(r, c).numFmt = HKD_FMT;
  }
  // F52 is Case Pack: keep it numeric for formulas, but display 0.25 as 1/4.
  ws.getCell(52, 6).numFmt = '# ?/?';
}

// ─── Fill Body Cost Breakdown sheet（搬运自 excel-exporter.js fillBCD）───────────

function fillBCD(ws, d) {
  const { version, product, params, moldParts, hardwareItems, electronicItems,
          paintingDetail, materialPrices, rawMaterials, bodyAccessories, sewingItems, sewingLaborItems, assemblyLaborItems, rotocastItems } = d;

  setVal(ws, 7, 1, version.body_no || (product?.item_no ? product.item_no + '-00' : ''));
  setBiVal(ws, 7, 2, product?.item_desc, product?.item_desc_eng);
  setVal(ws, 7, 3, version.body_cost_revision || '');
  setVal(ws, 7, 4, 'ROYAL REGENT PRODUCTS (H.K.) LIMITED');
  setVal(ws, 7, 6, version.prepared_by || (product?.client === 'TOMY' ? 'Michelle' : ''));
  setVal(ws, 7, 8, new Date());

  const bodyMkup = parseFloat(params.markup_body) || 0.18;
  for (const r of [14, 15, 16, 19, 20, 21, 22]) {
    setVal(ws, r, 5, bodyMkup);
  }
  setVal(ws, 17, 5, 0);

  for (const r of [14, 15, 16, 17, 19, 20, 21, 22]) {
    const fCell = ws.getCell(r, 6);
    delete fCell._sharedFormula;
    fCell.value = { formula: `ROUND(D${r}*(1+E${r}),2)`, result: 0 };
    const gCell = ws.getCell(r, 7);
    delete gCell._sharedFormula;
    gCell.value = { formula: `ROUND(F${r}/$F$23,3)`, result: 0 };
  }

  const plastics = (rawMaterials || []).filter(m => m.category === 'plastic');
  const alloys   = (rawMaterials || []).filter(m => m.category === 'alloy');
  const fabrics  = (rawMaterials || []).filter(m => m.category === 'fabric');

  function forceWriteFormula(r, col, formula, result) {
    const cell = ws.getCell(r, col);
    cell.value = null;
    if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
    delete cell._sharedFormula;
    cell.value = { formula, result: result ?? 0 };
  }

  function fillMatRows(items, startRow, endRow, hasSpec) {
    for (let r = startRow; r <= endRow; r++) {
      for (let c = 2; c <= 7; c++) {
        const cell = ws.getCell(r, c);
        cell.value = null;
        if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
        delete cell._sharedFormula;
      }
    }
    items.slice(0, endRow - startRow + 1).forEach((m, i) => {
      const r = startRow + i;
      setBiVal(ws, r, 2, m.material_name, m.eng_name);
      const usage = parseFloat(m.usage_g ?? m.weight_g) || 0;
      const rawPrice = parseFloat(m.unit_price_per_kg) || 0;
      const price = hasSpec ? rawPrice : Math.round(rawPrice);
      if (hasSpec) {
        const posText = m.spec_eng && m.spec_eng !== m.spec ? `${m.spec || ''} / ${m.spec_eng}` : (m.spec || '');
        setVal(ws, r, 3, posText);
        setVal(ws, r, 4, usage || null);
        setVal(ws, r, 5, r2(price));
        forceWriteFormula(r, 6, `D${r}*E${r}`, r2(usage * price));
        // 统一小数位：用量 3 位、单价 2 位、金额 HK$ 2 位（避免首行沿用模板旧格式导致不一致）
        ws.getCell(r, 4).numFmt = '0.000';
        ws.getCell(r, 5).numFmt = '0.00';
        ws.getCell(r, 6).numFmt = '"HK$"#,##0.00';
      } else {
        setVal(ws, r, 4, usage || null);
        setVal(ws, r, 5, r2(price));
        forceWriteFormula(r, 6, `ROUND(D${r}*E${r}/1000,2)`, r2(usage * price / 1000));
        ws.getCell(r, 4).numFmt = '0.0';
        ws.getCell(r, 5).numFmt = '0.000';
        ws.getCell(r, 6).numFmt = '"HK$"#,##0.00';
      }
    });
  }

  const PLASTIC_START = 31;
  const PLASTIC_SLOTS = 4;
  const plasticExtra = Math.max(0, plastics.length - PLASTIC_SLOTS);
  for (let i = 0; i < plasticExtra; i++) ws.insertRow(35 + i, [], 'i+');
  const plasticEnd = PLASTIC_START + Math.max(PLASTIC_SLOTS, plastics.length) - 1;
  fillMatRows(plastics, PLASTIC_START, plasticEnd, false);
  // 合金段：内部报价一般无合金数据 → 保留模板固定标签（ZINC ALLOY / ALUMINUM），有数据才填
  if (alloys.length) fillMatRows(alloys, 38, 41, false);
  const ALLOY_START = 38 + plasticExtra;
  const ALLOY_SLOTS = 4;
  const alloyExtra = Math.max(0, alloys.length - ALLOY_SLOTS);
  for (let i = 0; i < alloyExtra; i++) ws.insertRow(42 + plasticExtra + i, [], 'i+');
  const alloyEnd = ALLOY_START + Math.max(ALLOY_SLOTS, alloys.length) - 1;
  if (alloys.length) fillMatRows(alloys, ALLOY_START, alloyEnd, false);
  else {
    setVal(ws, 37 + plasticExtra, 2, 'ALLOY');
    setVal(ws, 38 + plasticExtra, 2, 'ZINC ALLOY');
    setVal(ws, 39 + plasticExtra, 2, 'ALUMINUM');
  }

  const fabricsFiltered = fabrics.filter(m => m.spec !== '__labor__');
  const baseMatShift = plasticExtra + alloyExtra;
  const FABRIC_START = 43 + baseMatShift, FABRIC_SLOTS = 13;
  const FABRIC_SUBTOTAL = FABRIC_START + FABRIC_SLOTS;
  const fabricExtra = Math.max(0, fabricsFiltered.length - FABRIC_SLOTS);
  for (let i = 0; i < fabricExtra; i++) ws.insertRow(FABRIC_SUBTOTAL + i, [], 'i+');
  const fabricEnd = FABRIC_START + Math.max(FABRIC_SLOTS, fabricsFiltered.length) - 1;
  fillMatRows(fabricsFiltered, FABRIC_START, fabricEnd, true);
  const fabricHeaderRow = FABRIC_START - 1;
  for (let r = fabricHeaderRow; r <= fabricEnd; r++) {
    ws.getCell(r, 3).alignment = {
      ...ws.getCell(r, 3).alignment,
      horizontal: 'center',
      vertical: 'middle',
    };
  }
  for (let r = FABRIC_START; r <= fabricEnd; r++) {
    ws.getCell(r, 5).numFmt = '0.00';
  }
  const fabricShift = baseMatShift + fabricExtra;
  const fabricSubRow = FABRIC_SUBTOTAL + fabricExtra;
  const fabricSum = fabricsFiltered.reduce((s, m) => s + (parseFloat(m.weight_g) || 0) * (parseFloat(m.unit_price_per_kg) || 0), 0);
  { const c = ws.getCell(fabricSubRow, 7); delete c._sharedFormula; c.value = { formula: `SUM(F${FABRIC_START}:F${fabricEnd})`, result: Math.round(fabricSum * 1000) / 1000 }; }
  for (let rr = fabricSubRow + 1; rr <= fabricSubRow + 3; rr++) {
    for (let c = 4; c <= 7; c++) { const cc = ws.getCell(rr, c); delete cc._sharedFormula; cc.value = null; }
  }
  const aTotalRow = 59 + fabricShift;
  { const c = ws.getCell(aTotalRow, 7); delete c._sharedFormula; c.value = { formula: `SUM(G29:G${fabricSubRow})`, result: null }; }
  if (fabricShift !== 0) {
    const c = ws.getCell(14, 4); delete c._sharedFormula; c.value = { formula: `$G$${aTotalRow}`, result: null };
  }

  const MOLD_START = 71 + fabricShift, MOLD_END = 90 + fabricShift;
  for (let r = MOLD_START; r <= MOLD_END; r++) {
    for (let c = 1; c <= 7; c++) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
      delete cell._sharedFormula;
    }
  }

  moldParts.slice(0, MOLD_END - MOLD_START + 1).forEach((part, i) => {
    const r = MOLD_START + i;
    const setsPerToy  = parseFloat(part.sets_per_toy) || 1;
    const shots = setsPerToy > 0 ? 1 / setsPerToy : 1;
    const laborPerToy = parseFloat(part.molding_labor) || 0;
    const costPerShot = r2(laborPerToy * setsPerToy * 1.08);
    ws.getCell(r, 1).value = part.part_no || '';
    setBiVal(ws, r, 2, part.description, part.eng_name);
    ws.getCell(r, 3).value = part.machine_type || '';
    ws.getCell(r, 4).value = shots;
    ws.getCell(r, 5).value = r2(costPerShot);
    forceWriteFormula(r, 6, `D${r}*E${r}`, r2(shots * costPerShot));
  });
  for (let r = MOLD_START; r <= MOLD_START + moldParts.length - 1; r++) {
    const desc = String(ws.getCell(r, 2).value || '');
    ws.getRow(r).height = desc.length > 28 ? 48 : (desc.length > 14 ? 34 : 24);
    for (let c = 1; c <= 6; c++) {
      ws.getCell(r, c).alignment = {
        vertical: 'middle',
        horizontal: c === 2 ? 'left' : (c >= 4 ? 'right' : 'center'),
        wrapText: c === 2,
      };
    }
  }

  const KEEP_BLANK = 3;
  const injDataEnd = MOLD_START + moldParts.length - 1;
  const injKeepEnd = injDataEnd + KEEP_BLANK;
  const injDeleteStart = injKeepEnd + 1;
  const injDeleteCount = MOLD_END - injKeepEnd;
  if (injDeleteCount > 0) ws.spliceRows(injDeleteStart, injDeleteCount);
  const injShift = injDeleteCount > 0 ? injDeleteCount : 0;

  const BLOW_TEMPLATE_ROW = 94 + fabricShift - injShift;
  const BLOW_SUBTOTAL_ROW = 95 + fabricShift - injShift;
  const rotoList = (rotocastItems || []).filter(r =>
    r.mold_no && /^[A-Za-z]+\d+/.test(r.mold_no.trim())
  );

  const rotoExtra = Math.max(0, rotoList.length - 1);
  for (let i = 0; i < rotoExtra; i++) {
    ws.insertRow(BLOW_SUBTOTAL_ROW + i, [], 'i+');
  }

  for (let i = 0; i < Math.max(1, rotoList.length); i++) {
    const r = BLOW_TEMPLATE_ROW + i;
    if (i < rotoList.length) {
      const item = rotoList[i];
      const usagePcs   = parseInt(item.usage_pcs) || 1;
      const unitPrice  = r2((parseFloat(item.unit_price_hkd) || 0) * 1.08);
      setVal(ws, r, 1, item.mold_no || '');
      setBiVal(ws, r, 2, item.name, item.eng_name);
      setVal(ws, r, 3, '');
      setVal(ws, r, 4, usagePcs);
      setVal(ws, r, 5, unitPrice);
      forceWriteFormula(r, 6, `D${r}*E${r}`, r2(usagePcs * unitPrice));
    } else {
      for (let c = 1; c <= 7; c++) ws.getCell(r, c).value = null;
    }
  }

  const blowShift = fabricShift + rotoExtra - injShift;

  const BLOW_SUB_ROW  = 95 + blowShift;
  const B_TOTAL_ROW   = 98 + blowShift;
  const injSectionStart = MOLD_START;
  const blowSectionEnd  = BLOW_TEMPLATE_ROW + Math.max(0, rotoList.length - 1);
  forceWriteFormula(BLOW_SUB_ROW, 7, `SUM(F${injSectionStart}:F${blowSectionEnd})`, null);
  forceWriteFormula(B_TOTAL_ROW, 7, `G${BLOW_SUB_ROW}`, null);

  const ELEC_START = 105 + blowShift, ELEC_END = 107 + blowShift;
  for (let r = ELEC_START; r <= ELEC_END; r++) {
    for (let c = 2; c <= 6; c++) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
      delete cell._sharedFormula;
    }
  }

  electronicItems.slice(0, ELEC_END - ELEC_START + 1).forEach((item, i) => {
    const r = ELEC_START + i;
    const unitPrice = (parseFloat(item.unit_price_usd) || 0) * (parseFloat(item.markup) || 1);
    setBiVal(ws, r, 2, item.part_name, item.eng_name);
    setVal(ws, r, 3, 'pc');
    setVal(ws, r, 4, parseFloat(item.quantity) || 1);
    setVal(ws, r, 5, r2(unitPrice) || 0);
    forceWriteFormula(r, 6, `D${r}*E${r}`,
      r2((parseFloat(item.quantity) || 1) * (r2(unitPrice) || 0)));
  });

  const ELEC_SUBTOTAL_ROW = ELEC_END + 1;
  forceWriteFormula(ELEC_SUBTOTAL_ROW, 7, `SUM(F${ELEC_START}:F${ELEC_END})`, null);

  const SEW_START = 110 + blowShift, SEW_DATA_TEMPLATE_END = 113 + blowShift;
  const SEW_SUBTOTAL_TEMPLATE = 114 + blowShift;
  const hkdRmb = parseFloat(params.rmb_hkd) || 0.85;
  const sewList = sewingItems || [];

  const sewExtra = Math.max(0, sewList.length - (SEW_DATA_TEMPLATE_END - SEW_START + 1));
  for (let i = 0; i < sewExtra; i++) {
    ws.insertRow(SEW_SUBTOTAL_TEMPLATE + i, [], 'i+');
  }
  const SEW_END = SEW_DATA_TEMPLATE_END + sewExtra;

  clearRows(ws, SEW_START, SEW_END, [2, 3, 4, 5]);
  const SEW_FONT = { size: 12, name: 'Arial', charset: 134 };
  sewList.forEach((item, i) => {
    const r = SEW_START + i;
    const totalHkd = hkdRmb > 0 ? (parseFloat(item.total_price_rmb) || 0) / hkdRmb : 0;
    const usage = parseFloat(item.usage_amount) || 1;
    const unitPriceHkd = Math.round(totalHkd / usage * 10000) / 10000;
    setBiVal(ws, r, 2, item.fabric_name, item.eng_name);
    const c2 = ws.getCell(r, 2); c2.font = SEW_FONT; c2.alignment = { vertical: 'middle', wrapText: true };
    const c3 = ws.getCell(r, 3); c3.value = usage > 1 ? 'pcs' : 'pc'; c3.font = SEW_FONT; c3.alignment = { horizontal: 'center' };
    const c4 = ws.getCell(r, 4); c4.value = usage; c4.font = SEW_FONT;
    const c5 = ws.getCell(r, 5); c5.value = unitPriceHkd; c5.font = SEW_FONT; c5.style = { numFmt: '#,##0.0000', font: SEW_FONT, alignment: { horizontal: 'right' } };
    forceWriteFormula(r, 6, `ROUND(D${r}*E${r},2)`, r2(totalHkd));
    const c6 = ws.getCell(r, 6); c6.font = SEW_FONT; c6.numFmt = HKD_FMT;
  });

  const SEW_SUBTOTAL_ROW = SEW_END + 1;
  forceWriteFormula(SEW_SUBTOTAL_ROW, 7, `SUM(F${SEW_START}:F${SEW_END})`, null);

  const totalShift = blowShift + sewExtra;
  const C3_DATA_START = 117 + totalShift;
  const C3_SLOTS = 22;
  const C3_SUBTOTAL_ROW = C3_DATA_START + C3_SLOTS;
  const C3_GAP = 4;
  const baList  = bodyAccessories || [];
  const c3Need = baList.length + C3_GAP;
  const c3Extra = Math.max(0, c3Need - C3_SLOTS);
  const c3Delete = Math.max(0, C3_SLOTS - c3Need);
  for (let i = 0; i < c3Extra; i++) {
    ws.insertRow(C3_SUBTOTAL_ROW + i, [], 'i+');
  }
  if (c3Delete > 0) ws.spliceRows(C3_DATA_START + baList.length, c3Delete);
  const C3_TOTAL = C3_SLOTS + c3Extra - c3Delete;
  const c3SubTotalRow = C3_DATA_START + C3_TOTAL;

  for (let r = C3_DATA_START; r < C3_DATA_START + C3_TOTAL; r++) {
    for (let c = 2; c <= 6; c++) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
      delete cell._sharedFormula;
    }
  }
  baList.forEach((item, i) => {
    const r = C3_DATA_START + i;
    const usage = parseFloat(item.usage_qty) || 1;
    const unitPrice = r2(parseFloat(item.unit_price) || 0);
    setBiVal(ws, r, 2, item.description, item.eng_name);
    ws.getCell(r, 3).value = usage > 1 ? 'pcs' : 'pc';
    ws.getCell(r, 3).alignment = { horizontal: 'center' };
    ws.getCell(r, 4).value = usage;
    ws.getCell(r, 5).value = unitPrice;
    forceWriteFormula(r, 6, `D${r}*E${r}`, r2(usage * unitPrice));
  });

  const c3DataEnd = C3_DATA_START + baList.length - 1;
  const c3Sum = baList.reduce((s, item) => {
    const usage = parseFloat(item.usage_qty) ?? 0;
    const price = r2(item.unit_price) || 0;
    return s + r2(usage * price);
  }, 0);
  forceWriteFormula(c3SubTotalRow, 7, `SUM(F${C3_DATA_START}:F${c3DataEnd})`, r2(c3Sum));

  const C_TOTAL_ROW = c3SubTotalRow + 2;
  const C_SUM_END   = C_TOTAL_ROW - 1;
  const C_SUM_START = ELEC_START;
  forceWriteFormula(C_TOTAL_ROW, 7, `SUM(G${C_SUM_START}:G${C_SUM_END})`, null);

  const E0 = c3SubTotalRow - 135;

  for (let r = 141 + E0; r <= 175 + E0; r++) {
    for (const c of [4, 5, 6, 7]) {
      const cell = ws.getCell(r, c);
      delete cell._sharedFormula;
      const v = cell.value;
      const isFormula = v && typeof v === 'object' && v.formula;
      const isLabel = typeof v === 'string' && v.trim();
      if (!isFormula && !isLabel) cell.value = null;
    }
  }

  const D_SUB_ROW   = 144 + E0;
  const D_TOTAL_ROW = 145 + E0;
  forceWriteFormula(D_SUB_ROW,   7, `SUM(F${141 + E0}:F${143 + E0})`, 0);
  forceWriteFormula(D_TOTAL_ROW, 7, `SUM(G${141 + E0}:G${144 + E0})`, 0);

  let decoSprayRow = 153 + E0;
  let decoSubTotalRow = 155 + E0;
  for (let r = Math.max(1, 140 + E0); r <= Math.min(ws.rowCount, 170 + E0); r++) {
    const label = String(ws.getCell(r, 2).value || '').trim();
    if (label === 'Spraying') { decoSprayRow = r; decoSubTotalRow = r + 2; break; }
  }
  let decoAmount = 0;
  if (paintingDetail) {
    const totalOps  = parseFloat(paintingDetail.total_operations) || 0;
    const quotedPrice = parseFloat(paintingDetail.quoted_price_hkd) || 0;
    const unitCost  = totalOps > 0 ? quotedPrice / totalOps : null;
    decoAmount = r2(quotedPrice) || 0;
    ws.getCell(decoSprayRow, 4).value = totalOps || null;
    ws.getCell(decoSprayRow, 5).value = unitCost == null ? null : r4(unitCost);
    forceWriteFormula(decoSprayRow, 6, `D${decoSprayRow}*E${decoSprayRow}`, decoAmount);
  }
  forceWriteFormula(decoSubTotalRow, 7,
    `SUM(F${decoSprayRow - 1}:F${decoSprayRow + 1})`, decoAmount);

  const trimSubRow = 159 + E0;
  forceWriteFormula(trimSubRow, 7, `SUM(F${157 + E0}:F${158 + E0})`, 0);

  for (let rr = 157 + E0; rr <= 162 + E0; rr++) {
    const cc = ws.getCell(rr, 7);
    delete cc._sharedFormula;
    if (cc.value && typeof cc.value === 'object' && cc.value.sharedFormula) cc.value = null;
  }
  forceWriteFormula(161 + E0, 7, `SUM(F${160 + E0}:F${160 + E0})`, 0);

  const sewLaborList = sewingLaborItems || [];
  let sewAmount = 0;
  const sewDataRow = 162 + E0;
  const sewRow     = 163 + E0;
  if (sewLaborList.length > 0) {
    const sewItem = sewLaborList[0];
    const hkdRmbRate = parseFloat(params.rmb_hkd) || 0.85;
    const sewUnitCostHkd = hkdRmbRate > 0 ? (parseFloat(sewItem.material_price_rmb) || 0) / hkdRmbRate : 0;
    const sewQty = parseFloat(sewItem.usage_amount) || 0;
    sewAmount = r2(sewQty * sewUnitCostHkd) || 0;
    setVal(ws, sewDataRow, 4, sewQty || null);
    setVal(ws, sewDataRow, 5, r2(sewUnitCostHkd));
    forceWriteFormula(sewDataRow, 6, `D${sewDataRow}*E${sewDataRow}`, sewAmount);
  }
  forceWriteFormula(sewRow, 7, `SUM(F${sewDataRow}:F${sewDataRow})`, sewAmount);

  const asmList = (assemblyLaborItems || []).filter(h => !/(喷油|油漆|包装人工|拆查货|拆货)/.test(h.name || ''));
  const asmItem = asmList.find(h => (h.name || '').includes('装配')) || asmList[0];
  let asmAmount = 0;
  for (let r = 165 + E0; r <= 167 + E0; r++) {
    for (let c = 4; c <= 6; c++) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
      delete cell._sharedFormula;
    }
  }
  if (asmItem) {
    const assemblySub = asmList
      .filter(h => !/(喷油|油漆)/.test(h.name || ''))
      .reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
    const asmTotalQuoted = r2(assemblySub * ASSEMBLY_MARKUP);
    const asmQty   = 11;
    const asmPrice = asmQty > 0 ? asmTotalQuoted / asmQty : null;
    asmAmount = asmTotalQuoted || 0;
    const asmRow = 165 + E0;
    setVal(ws, asmRow, 4, asmQty);
    setVal(ws, asmRow, 5, asmPrice == null ? null : r4(asmPrice));
    forceWriteFormula(asmRow, 6, `D${asmRow}*E${asmRow}`, asmAmount);
  }
  forceWriteFormula(168 + E0, 7, `SUM(F${165 + E0}:F${167 + E0})`, asmAmount);

  const totalEAmount = r2(decoAmount + sewAmount + asmAmount);
  forceWriteFormula(170 + E0, 7,
    `SUM(G${153 + E0}:G${168 + E0})`, totalEAmount);

  const fixSubTotal = (summaryRow, srcRow) => {
    const cell = ws.getCell(summaryRow, 4);
    delete cell._sharedFormula;
    cell.value = { formula: `G${srcRow}`, result: 0 };
  };
  fixSubTotal(15, B_TOTAL_ROW);
  fixSubTotal(16, C_TOTAL_ROW);
  fixSubTotal(17, D_TOTAL_ROW);
  fixSubTotal(19, decoSubTotalRow);
  fixSubTotal(20, trimSubRow);
  fixSubTotal(21, sewRow);
  fixSubTotal(22, 168 + E0);

  for (const r of [14, 15, 16, 17, 19, 20, 21, 22, 23]) {
    ws.getCell(r, 4).numFmt = HKD_LABEL_FMT;
    ws.getCell(r, 6).numFmt = HKD_LABEL_FMT;
  }
  for (let r = 29; r <= aTotalRow; r++) {
    ws.getCell(r, 6).numFmt = HKD_FMT;
    ws.getCell(r, 7).numFmt = HKD_FMT;
  }
  for (let r = MOLD_START; r <= 170 + E0; r++) {
    ws.getCell(r, 5).numFmt = HKD_FMT;
    ws.getCell(r, 6).numFmt = HKD_FMT;
    ws.getCell(r, 7).numFmt = HKD_FMT;
  }
}

// ─── 内部报价 payload → 报价系统 loadData() 中间对象 `d` 的适配器 ─────────────

function sectionsToData({ quote, sections }) {
  const get = (dept) => {
    const s = sections.find(x => x.dept === dept);
    if (!s || !s.payload_json) return {};
    try { return JSON.parse(s.payload_json); } catch (e) { return {}; }
  };
  const sales       = get('sales');
  const eng         = get('engineering');
  const electronic  = get('electronic');
  const molding     = get('molding');
  const painting    = get('painting');
  const assembly    = get('assembly');
  const sewing      = get('sewing');
  const slush       = get('slush');

  const header  = sales.header  || {};
  const pricing = sales.pricing || {};
  const psum    = sales.pricing_summary || {};
  const t3      = psum.t3 || {};
  const fxRH    = num(header.fx_rmb_hkd) || 0.85;   // RMB→HKD
  const fxHU    = num(header.fx_hkd_usd) || 7.8;    // HKD→USD

  const product = {
    item_no:   quote.quote_no || String(quote.id || ''),
    item_desc: quote.product_name || '',
    item_desc_eng: customerEnglish(sales.vq_english?.product_name || quote.product_name || ''),
    client:    quote.customer || 'TOMY',
    moq:       num(quote.qty),
  };
  const version = {
    prepared_by:        (quote.customer || 'TOMY') === 'TOMY' ? 'Michelle' : (quote.created_by_name || ''),
    quote_rev:          '',
    item_rev:           '',
    fty_delivery_date:  '',
    body_no:            (quote.quote_no || '') + '-00',
    body_cost_revision: '',
    quote_date:         quote.created_at || '',
  };
  // 报客加价率：优先用业务在算价参数里填的 vq_markup_pct（百分数，如 18），缺省回落到常量
  const vqMarkup = (pricing.vq_markup_pct != null && pricing.vq_markup_pct !== '')
    ? num(pricing.vq_markup_pct) / 100 : VQ_MARKUP;
  const params = {
    markup_body:      vqMarkup,
    markup_packaging: vqMarkup,
    markup_labor:     vqMarkup,
    rmb_hkd:          fxRH,
    hkd_usd:          fxHU,
    hkd_rmb_quote:    fxRH ? 1 / fxRH : 0,
  };

  // 注塑人工（BCD B 段）：mold_no / name / machine / sets / 啤价
  const injectionLossM = 1 + num(molding.injection_loss_pct ?? 3) / 100;
  const moldParts = (molding.injection || []).map(r => ({
    part_no:      r.mold_no || '',
    description:  r.name || '',
    eng_name:     customerEnglish(r.eng_name || r.name || ''),
    machine_type: r.machine || r.machine_model || '',
    sets_per_toy: num(r.sets) || 1,
    // 系统注塑表的啤价已是 HK$/啤，BCD 直接使用，后续只乘码点。
    molding_labor: num(r.shot_price),
  }));

  // 原料成本（BCD A 段）：注塑料 → plastic；车缝面料 → fabric
  const rawMaterials = [];
  (molding.injection || []).forEach(r => {
    if (!num(r.weight_g)) return;
    const usageG = r2(num(r.weight_g) * injectionLossM);
    rawMaterials.push({
      category: 'plastic',
      material_name: r.material || r.name || '',
      eng_name: customerEnglish(r.material_eng || r.material || r.eng_name || r.name || ''),
      weight_g: num(r.weight_g),
      usage_g: usageG,
      unit_price_per_kg: num(r.material_unit_price) * 1000,
    });
  });
  // 车缝物料拆分：有「部位」的是面料裁片 → A 段 Fabric；无部位的是辅料(商标/线/棉带/棉花…) → C2 Sewing Accessories
  const sewingItems = [];
  (sewing.sewing_groups || []).forEach(g => {
    let lastFabric = '';
    let lastFabricEng = '';
    (g.items || []).forEach(it => {
      if (/人工/.test(it.fabric || it.part || it.name || '')) return;  // 人工归到 E 段
      const fabric = (it.fabric || '').trim() || lastFabric;
      const fabricEng = it.eng_name || (!(it.fabric || '').trim() ? lastFabricEng : '');
      if (it.fabric) {
        lastFabric = it.fabric;
        lastFabricEng = it.eng_name || '';
      }
      const hasPart = (it.part || '').trim() !== '';
      if (hasPart) {
        // 面料裁片 → A 段 Fabric
        const fabHkdPerYd = num(it.mat_price) * SEWING_DEFAULT_MARKUP;  // 面料 HK$/YD 固定按 1.08 码点
        rawMaterials.push({
          category: 'fabric',
          material_name: fabric || g.name || '',
          eng_name: customerEnglish(fabricEng || fabric || g.eng_name || g.name || ''),
          spec: it.part || '',
          spec_eng: customerEnglish(it.part_eng || it.part || ''),
          weight_g: num(it.usage),   // 用量/码（裁片数 pieces 不参与成本，仅信息列）
          // 物料价内部为 RMB/码 → HK$/YD（模板面料列为 HK$/YD）
          unit_price_per_kg: fxRH ? fabHkdPerYd / fxRH : fabHkdPerYd,
        });
      } else {
        // 车缝辅料 → C2 Sewing Accessories（fillBCD 内部按 RMB→HKD 换算）
        const accessoryTotalRmb = num(it.usage) * num(it.mat_price) * SEWING_DEFAULT_MARKUP;
        sewingItems.push({
          fabric_name: fabric || '',
          eng_name: customerEnglish(fabricEng || fabric || ''),
          total_price_rmb: accessoryTotalRmb,
          usage_amount: num(it.usage) || 1,
        });
      }
    });
  });

  // 注塑原料按材质汇总，同材质合并为一行；车缝面料保持逐行明细。
  const groupedPlasticMap = new Map();
  const groupedRawMaterials = [];
  rawMaterials.forEach(item => {
    if (item.category !== 'plastic') {
      groupedRawMaterials.push(item);
      return;
    }
    const key = `${item.category}::${item.material_name || ''}::${r2(item.unit_price_per_kg) || 0}`;
    const existing = groupedPlasticMap.get(key);
    if (existing) {
      existing.weight_g = r2(num(existing.weight_g) + num(item.weight_g));
      existing.usage_g = r2(num(existing.usage_g) + num(item.usage_g ?? item.weight_g));
    } else {
      const copy = { ...item };
      copy.usage_g = num(copy.usage_g ?? copy.weight_g);
      groupedPlasticMap.set(key, copy);
    }
  });
  groupedRawMaterials.unshift(...groupedPlasticMap.values());

  // 购买件 — 电子（BCD C 段）：优先电子部，回退工程
  const elecSrc = (electronic.electronics && electronic.electronics.length)
    ? electronic.electronics : (eng.electronics || []);
  const electronicItems = elecSrc.map(r => ({
    part_name: r.name || '',
    eng_name: customerEnglish(r.eng_name || r.name || ''),
    quantity: num(r.qty) || 1,
    // 内部电子单价为 HKD，模板电子列为 USD → 按内部 HKD→USD 汇率换算
    unit_price_usd: num(r.unit_price) / fxHU,
    markup: /P?ACB|PCB/i.test(String(r.name || '')) ? SEWING_DEFAULT_MARKUP : 1,
  }));

  const isProductLibao = r => /^(产品利宝|利宝)$/i.test(String(r.category || '').trim())
    || (/利宝|libao|sticker|贴纸/i.test(String(`${r.name || ''} ${r.spec || ''}`))
      && !/彩盒/i.test(String(`${r.category || ''} ${r.name || ''} ${r.spec || ''}`)));

  // 其他购买件（BCD C3 Other Components）：对应工程部「五金」+ 辅助材料「产品利宝」。
  const bodyAccessories = [
    ...(eng.hardware || []),
    ...(eng.aux_materials || []).filter(isProductLibao),
  ].filter(r => (r.name || r.spec || '').trim() || num(r.unit_price) || num(r.qty))
  .map(r => ({
    description: r.name || '',
    eng_name: customerEnglish(r.eng_name || r.name || ''),
    usage_qty: num(r.qty) || 1,
    unit_price: num(r.unit_price) * SEWING_DEFAULT_MARKUP,
  }));

  // 装饰 / 喷油（BCD DECORATION 段）：次数取喷油七工序数量合计，金额取喷油完整港币值。
  const paintingProcKeys = ['clamp', 'pad', 'spray', 'edge', 'color', 'dip', 'oil'];
  const paintingRows = painting.painting_items || painting.second_proc || [];
  ensureExplicitProductGroups(paintingRows);
  const paintOps = weightedRowsSum(painting, paintingRows, row =>
    paintingProcKeys.reduce((total, key) => total + num(row[`${key}_qty`]), 0));
  const paintDetailAmt = (num(t3.painting_labor) + num(t3.paint_material)) * SEWING_DEFAULT_MARKUP;
  const paintingDetail = paintDetailAmt
    ? { total_operations: paintOps || 1, quoted_price_hkd: paintDetailAmt }
    : {};

  // 搪胶（BCD Blow/Rotocast 段）：slush_items → 需要 mold_no 形如 S1 才会被填
  const rotocastItems = (slush.slush_items || []).map((r, i) => ({
    mold_no: 'S' + (i + 1),
    name: r.name || '',
    eng_name: customerEnglish(r.eng_name || r.name || ''),
    usage_pcs: num(r.qty) || 1,
    unit_price_hkd: num(r.unit_price_hkd),
  }));

  // 车缝人工（BCD E.SEWING 段）：D列=人工用量，E列=物料价×码点÷汇率。
  let sewLaborQty = 0;
  let sewLaborRmb = 0;
  (sewing.sewing_groups || []).forEach(g => {
    const items = g.items || [];
    const laborItems = items.filter(it => /人工/.test(it.fabric || it.part || it.name || ''));
    if (laborItems.length > 0) {
      laborItems.forEach(it => {
        const qty = num(it.usage) || 1;
        sewLaborQty += qty;
        sewLaborRmb += qty * num(it.mat_price) * sewingMarkup(it);
      });
    } else if (num(g.labor_amount)) {
      // 旧数据只保存了人工总额时，无法拆出单价，按 1 个单位保留总金额。
      sewLaborQty += 1;
      sewLaborRmb += num(g.labor_amount);
    }
  });
  const sewingLaborItems = sewLaborRmb
    ? [{ material_price_rmb: sewLaborQty ? sewLaborRmb / sewLaborQty : sewLaborRmb, usage_amount: sewLaborQty || 1 }]
    : [];

  // 装配人工（BCD E.OTHERS 段）：只用装配部真实「组装人工」，不取成本汇总里的残留值。
  const asmLineHkd = (assembly.assembly_labor || []).reduce((s, r) => s + num(r.unit_price) * num(r.qty), 0);
  const asmBase = num(assembly.assembly_base_rate ?? 310);
  const asmStepHkd = (assembly.assembly_step_groups || []).reduce((s, g) => {
    const team = num(g.team ?? 1) || 1;
    const qty = Math.max(num(g.qty), 1);
    return s + (g.steps || []).reduce((a, step) => a + asmBase * num(step.count) * team / qty, 0);
  }, 0);
  const asmHkd = asmLineHkd + asmStepHkd;
  const assemblyLaborItems = asmHkd
    ? [{ name: 'Assembly', new_price: asmHkd }]
    : [];

  const pkgLineHkd = (assembly.packaging_labor || [])
    .reduce((s, r) => s + num(r.unit_price) * num(r.qty || 1), 0);
  const pkgStepHkd = (assembly.packaging_step_groups || []).reduce((s, g) => {
    const team = num(g.team ?? 1) || 1;
    const qty = Math.max(num(g.qty), 1);
    return s + (g.steps || []).reduce((a, step) => a + asmBase * num(step.count) * team / qty, 0);
  }, 0);
  const packingLabourHkd = pkgLineHkd + pkgStepHkd;

  // 包装（VQ Section B）：工程辅助材料 + 包装材料
  const packagingItems = [
    ...(eng.aux_materials || []).filter(r => !isProductLibao(r)),
    ...(eng.packaging_materials || []),
  ].map(r => ({
    pm_no: r.code || r.item_code || '',
    name: r.name || '',
    eng_name: customerEnglish(r.eng_name || r.name || ''),
    remark: r.spec || r.note || '',
    remark_eng: customerEnglish(r.spec_eng || r.note_eng || r.spec || r.note || ''),
    moq: r.moq != null ? num(r.moq) : null,
    quantity: num(r.qty) || 1,
    new_price: num(r.unit_price) * SEWING_DEFAULT_MARKUP,
  }));
  if (!packagingItems.some(i => i.name === 'Accessories')) {
    packagingItems.push({ name: 'Accessories', quantity: 1, new_price: 0.15 });
  }
  if (!packagingItems.some(i => i.name === 'Packing Labour')) {
    packagingItems.push({ name: 'Packing Labour', quantity: 1, new_price: packingLabourHkd * ASSEMBLY_MARKUP });
  }

  // 主纸箱（VQ Section D）
  const cc = eng.carton_calc || {};
  const masterCarton = (Array.isArray(cc.cartons) && cc.cartons[0]) ? cc.cartons[0] : {};
  const cartonL = num(masterCarton.cl) || num(cc.cl);
  const cartonW = num(masterCarton.cw) || num(cc.cw);
  const cartonH = num(masterCarton.ch) || num(cc.ch);
  const cartonQty = num(masterCarton.qty) || num(cc.qty) || 1;
  const cartonRate = num(cc.paper_rate) || 2.75;
  const hasPaperRate = cc.paper_rate != null
    && cc.paper_rate !== ''
    && Number.isFinite(Number(cc.paper_rate))
    && Number(cc.paper_rate) > 0;
  const calculatedBoxPrice = hasPaperRate && cartonL > 0 && cartonW > 0 && cartonH > 0
    ? (cartonL + cartonW + 2) * (cartonW + cartonH + 1) * 2 * cartonRate / 1000
    : 0;
  const masterBoxPrice = calculatedBoxPrice
    || num(masterCarton.carton_price) || num(masterCarton.price) || num(masterCarton.box_price)
    || num(cc.carton_price) || num(cc.price) || num(cc.box_price)
    || ((cartonL + cartonW + 2) * (cartonW + cartonH + 1) * 2 * 2.75 / 1000);
  const flatCards = Array.isArray(masterCarton.flat_cards) ? masterCarton.flat_cards : [];
  const masterFlatPrice = flatCards.length
    ? flatCards.reduce((s, f) => s + ((num(f.l) || cartonL) + 1) * ((num(f.w) || cartonW) + 1) * 2 / 1000, 0)
    : num(cc.flat_card);
  const cartonPrice = masterBoxPrice + masterFlatPrice;
  const productDim = {
    carton_l_inch: cartonL || null,
    carton_w_inch: cartonW || null,
    carton_h_inch: cartonH || null,
    case_pack: cartonQty > 1 ? `1/${cartonQty}` : 1,
    carton_price: cartonPrice,
  };

  const vqSupplements = ((sales.shipping && sales.shipping.customer_supplied_products) || [])
    .filter(item => String(item && item.name || '').trim() || num(item && item.amount_usd))
    .slice(0, 5)
    .map((item, index) => ({
      part_no: `CUSTOMER-${index + 1}`,
      description: item.name || `客供成品${index + 1}`,
      eng_name: customerEnglish(item.name || `客供成品${index + 1}`),
      moq: num(quote.qty) || 2500,
      usage_qty: 1,
      unit_price: num(item.amount_usd),
    }));

  // 运输（VQ Section E）：内部无 CuFt 单价，留空走模板默认
  const transportConfig = {};

  return {
    version, product, params,
    moldParts,
    hardwareItems: [],
    electronicItems,
    packagingItems,
    paintingDetail,
    transportConfig,
    moldCost: {},
    productDim,
    materialPrices: [],
    machinePrices: [],
    bodyAccessories,
    vqSupplements,
    rawMaterials: groupedRawMaterials,
    sewingItems,                // 车缝辅料(无部位) → C2 Sewing Accessories；面料裁片(有部位)在 rawMaterials(fabric)
    sewingLaborItems,
    assemblyLaborItems,
    rotocastItems,
  };
}

// ─── 对外入口 ────────────────────────────────────────────────────────────────

async function exportVQ({ quote, sections }) {
  const client = String(quote.customer || '').trim().toUpperCase();
  if (client === 'SPIN') {
    return exportSpin({ quote, sections });
  }
  if (client !== 'TOMY') {
    throw new Error(`客户「${quote.customer || '未设置'}」暂未配置报客表模板`);
  }

  const d = sectionsToData({ quote, sections });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readTemplateParts('VQ-template.xlsx'));
  wb.calcProperties = { fullCalcOnLoad: true };
  if (wb._definedNames) {
    wb._definedNames.model = (wb._definedNames.model || []).filter(dn => !dn.ranges?.some(r => /\[/.test(r)));
  }

  fixSharedFormulas(wb);
  const vqWs  = wb.getWorksheet('Vendor Quotation');
  const bcdWs = wb.getWorksheet('Body Cost Breakdown');
  if (!vqWs)  throw new Error('模板缺少 "Vendor Quotation" sheet');
  if (!bcdWs) throw new Error('模板缺少 "Body Cost Breakdown" sheet');
  fillVQ(vqWs, d);
  fillBCD(bcdWs, d);
  normalizeHkdFormats(bcdWs);
  for (const r of [14, 15, 16, 17, 19, 20, 21, 22, 23]) {
    bcdWs.getCell(r, 4).numFmt = HKD_LABEL_FMT;
    bcdWs.getCell(r, 6).numFmt = HKD_LABEL_FMT;
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { exportVQ, sectionsToData };
