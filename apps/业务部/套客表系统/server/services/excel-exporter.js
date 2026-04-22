/**
 * Excel Export Service — Template-Driven
 * Loads VQ-template.xlsx and fills data from DB, preserving all TOMY formatting and formulas.
 */
const ExcelJS = require('exceljs');
const path = require('path');
const { getDb } = require('./db');

const TEMPLATE_PATH       = path.join(__dirname, '../templates/VQ-template.xlsx');
const TEMPLATE_PATH_PLUSH = path.join(__dirname, '../templates/VQ-template-plush.xlsx');

// ─── Load all version data from DB ───────────────────────────────────────────

function loadData(versionId) {
  const db = getDb();
  const version = db.prepare('SELECT * FROM QuoteVersion WHERE id = ?').get(versionId);
  if (!version) throw new Error(`Version ${versionId} not found`);
  const product  = db.prepare('SELECT * FROM Product WHERE id = ?').get(version.product_id);
  const params   = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(versionId) || {};
  return {
    version, product, params,
    moldParts:      db.prepare('SELECT * FROM MoldPart     WHERE version_id = ? ORDER BY sort_order').all(versionId),
    hardwareItems:  db.prepare('SELECT * FROM HardwareItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    electronicItems:db.prepare('SELECT * FROM ElectronicItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    packagingItems: db.prepare('SELECT * FROM PackagingItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    paintingDetail: db.prepare('SELECT * FROM PaintingDetail WHERE version_id = ?').get(versionId) || {},
    transportConfig:db.prepare('SELECT * FROM TransportConfig WHERE version_id = ?').get(versionId) || {},
    moldCost:       db.prepare('SELECT * FROM MoldCost WHERE version_id = ?').get(versionId) || {},
    productDim:     db.prepare('SELECT * FROM ProductDimension WHERE version_id = ?').get(versionId) || {},
    materialPrices: db.prepare('SELECT * FROM MaterialPrice WHERE version_id = ? ORDER BY id').all(versionId),
    machinePrices:  db.prepare('SELECT * FROM MachinePrice  WHERE version_id = ? ORDER BY id').all(versionId),
    bodyAccessories:db.prepare('SELECT * FROM BodyAccessory WHERE version_id = ? ORDER BY sort_order').all(versionId),
    vqSupplements:  db.prepare('SELECT * FROM VQSupplement WHERE version_id = ? ORDER BY sort_order').all(versionId),
    rawMaterials:   db.prepare('SELECT * FROM RawMaterial WHERE version_id = ? ORDER BY sort_order').all(versionId),
    sewingItems:    db.prepare("SELECT * FROM SewingDetail WHERE version_id = ? AND (position IS NULL OR position = '') ORDER BY sort_order").all(versionId),
    sewingLaborItems: db.prepare("SELECT * FROM SewingDetail WHERE version_id = ? AND position = '__labor__' ORDER BY sort_order").all(versionId),
    assemblyLaborItems: db.prepare("SELECT * FROM HardwareItem WHERE version_id = ? AND part_category = 'labor_assembly' ORDER BY sort_order").all(versionId),
    rotocastItems:  db.prepare('SELECT * FROM RotocastItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Bilingual name: "中文 / English" when eng_name exists, otherwise just Chinese
function biName(zh, eng) {
  if (eng && eng.trim()) return `${zh || ''} / ${eng.trim()}`;
  return zh || '';
}

// Round a numeric value to 2 decimal places (for monetary amounts)
function r2(v) {
  const n = parseFloat(v);
  return (n == null || isNaN(n)) ? null : Math.round(n * 100) / 100;
}

function setVal(ws, row, col, value) {
  const cell = ws.getCell(row, col);
  // Never overwrite formula cells — they calculate automatically
  if (cell.value && typeof cell.value === 'object' && cell.value.formula) return;
  // Guard against NaN (invalid XML)
  if (typeof value === 'number' && isNaN(value)) value = null;
  cell.value = (value === undefined) ? null : value;
}

// Clear a range of data columns (skip formula columns)
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

// ─── Fill Vendor Quotation sheet ─────────────────────────────────────────────

function fillVQ(ws, d) {
  const { version, product, params, packagingItems, productDim, transportConfig, vqSupplements } = d;

  // ── Header (rows 2–5) ──────────────────────────────────────────────────────
  setVal(ws, 2, 3, 'ROYAL REGENT PRODUCTS (H.K.) LIMITED');
  setVal(ws, 2, 8, version.prepared_by || '');
  setVal(ws, 3, 3, product?.item_no || '');
  setVal(ws, 3, 8, new Date());
  setVal(ws, 4, 3, product?.item_desc || '');
  setVal(ws, 4, 8, version.quote_rev || '');
  setVal(ws, 5, 3, version.item_rev || '');
  setVal(ws, 5, 8, version.fty_delivery_date || '');

  // ── Section A (rows 11–16): Body Cost — row 11 formula stays (='BCD'!F23) ─
  // Just update part no and description for main body row
  if (product?.item_no) {
    setVal(ws, 11, 1, product.item_no + '-00');
    setVal(ws, 11, 2, product.item_desc || '');
    const detectedMoq = (packagingItems || []).find(i => i.moq)?.moq || 2500;
    setVal(ws, 11, 5, detectedMoq);  // MOQ from packaging
    setVal(ws, 11, 6, 1);     // usage 1 per toy
    // G11 = ='Body Cost Breakdown'!F23 — do NOT overwrite (formula)
  }
  // Fill accessory rows 12–16
  // Clear rows 12-16 including formula cells
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
    setVal(ws, r, 2, acc.description || '');
    setVal(ws, r, 5, parseInt(acc.moq) || 2500);
    setVal(ws, r, 6, parseFloat(acc.usage_qty) || 1);
    setVal(ws, r, 7, r2(acc.unit_price) || 0);
    // Amount = Usage * Unit Cost
    const amt = r2((parseFloat(acc.usage_qty) || 1) * (r2(acc.unit_price) || 0));
    ws.getCell(r, 8).value = { formula: `F${r}*G${r}`, result: amt };
  });

  // ── Section B (rows 23–35): Packaging ──────────────────────────────────────
  const PKG_START = 23, PKG_END = 35;
  // Clear all columns including shared formula in H col
  for (let r = PKG_START; r <= PKG_END; r++) {
    for (const c of [1, 2, 3, 5, 6, 7, 8]) {
      const cell = ws.getCell(r, c);
      delete cell._sharedFormula;
      cell.value = null;
    }
  }
  // Separate fixed rows from regular items
  const accItem    = packagingItems.find(i => i.name === 'Accessories');
  const labourItem = packagingItems.find(i => i.name === 'Packing Labour');
  const regularItems = packagingItems.filter(i => i.name !== 'Accessories' && i.name !== 'Packing Labour');
  const ACC_ROW    = PKG_END - 2; // row 33
  const LABOUR_ROW = PKG_END - 1; // row 34

  function writePkgRow(r, item) {
    setVal(ws, r, 1, item.pm_no || '');
    setVal(ws, r, 2, biName(item.name, item.eng_name));
    setVal(ws, r, 3, item.remark || '');
    setVal(ws, r, 5, item.moq != null ? item.moq : null);
    setVal(ws, r, 6, item.quantity || 1);
    setVal(ws, r, 7, r2(item.new_price) || 0);
    const amt = r2((parseFloat(item.quantity) || 1) * (r2(item.new_price) || 0));
    const hCell = ws.getCell(r, 8);
    delete hCell._sharedFormula;
    hCell.value = { formula: `ROUND(F${r}*G${r},2)`, result: amt };
  }

  // Fill regular items in rows 23–32
  regularItems.slice(0, ACC_ROW - PKG_START).forEach((item, i) => {
    writePkgRow(PKG_START + i, item);
  });

  // Accessories fixed at row 33
  if (accItem) writePkgRow(ACC_ROW, accItem);

  // Packing Labour fixed at row 34
  if (labourItem) writePkgRow(LABOUR_ROW, labourItem);
  // Mark Up row 36: G36 = markup%
  const pkgMarkup = parseFloat(params.markup_packaging) || 0.12;
  setVal(ws, 36, 7, pkgMarkup);

  // ── Section D (rows 50–52): Master Carton ─────────────────────────────────
  // Row 50 = Polybag, Row 51 = Inner, Row 52 = Master Carton
  if (productDim) {
    setVal(ws, 52, 2, parseFloat(productDim.carton_l_inch) || null);  // L
    setVal(ws, 52, 3, parseFloat(productDim.carton_w_inch) || null);  // W
    setVal(ws, 52, 4, parseFloat(productDim.carton_h_inch) || null);  // H
    // Paper col: leave blank (carton_paper is a label, not paper type)
    const casePackStr = productDim.case_pack || '1';
    const casePackFrac = casePackStr.match(/^(\d+)\s*\/\s*(\d+)$/);
    const casePackNum = casePackFrac ? parseInt(casePackFrac[1]) / parseInt(casePackFrac[2]) : (parseFloat(casePackStr) || 1);
    const cartonAmt = r2(productDim.carton_price) || 0;              // AMOUNT = carton_price
    const unitCostCalc = r2(casePackNum > 0 ? cartonAmt / casePackNum : cartonAmt); // Unit Cost = Amount / Case Pack
    setVal(ws, 52, 6, casePackNum);                                   // Case Pack (numeric, e.g. 0.5)
    setVal(ws, 52, 7, unitCostCalc);                                  // Unit Cost
    // Amount = ROUND(Case Pack * Unit Cost, 2)
    const amtCell = ws.getCell(52, 8);
    delete amtCell._sharedFormula;
    amtCell.value = { formula: `ROUND(F52*G52,2)`, result: cartonAmt };
  }

  // ── Section E (row 58): Transport cost parameters ──────────────────────────
  // Template: F58=Ex-Factory cost/CuFt, G58=FOB FCL cost/CuFt, H58=FOB LCL cost/CuFt
  // C58 = formula =B52*C52*D52/1728*F52 (CuFt per toy, don't touch)
  if (transportConfig) {
    setVal(ws, 58, 6, r2(transportConfig.hk_10t_cost) || 0.5);   // Ex-Factory
    setVal(ws, 58, 7, r2(transportConfig.yt_40_cost)  || 4.3);   // FOB FCL
    setVal(ws, 58, 8, r2(transportConfig.hk_40_cost)  || 15.85); // FOB LCL
  }
  // Rewrite R59 transport cost formulas (may be lost due to shared formula issues)
  for (const col of [6, 7, 8]) {
    const L = ['', 'A','B','C','D','E','F','G','H'][col];
    const cell = ws.getCell(59, col);
    delete cell._sharedFormula;
    cell.value = { formula: `${L}58*$C$58`, result: 0 };
  }

  // ── Vendor Cost Summary (rows 68–75): fix lost formulas ───────────────────
  // Row 68 (5K):  HKD = $I$17+$I$36+$I$44+$I$52+F59  (base + transport)
  // Row 70 (10K): HKD = F68*0.995
  // Row 72 (15K): HKD = F70*0.995
  // Row 74 (20K): HKD = F72*0.995
  // USD rows = ROUND(HKD/7.76, 3)
  const hkdUsdRate = 7.76;
  const colLetters = { 6: 'F', 7: 'G', 8: 'H' };

  // Vendor Cost Summary MOQ rows 68-75: dynamically generate MOQ sequence
  // Sequence: detectedMoq, detectedMoq×2, detectedMoq×4, empty
  const detectedMoq = (packagingItems || []).find(i => i.moq)?.moq || 2500;
  function moqToLabel(n) {
    if (!n) return '';
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${k}K`;
  }
  const MOQ_TIERS = [2500, 5000, 10000, 15000];
  const startIdx = Math.max(0, MOQ_TIERS.indexOf(detectedMoq));
  const moqSequence = [0, 1, 2, 3].map(i => MOQ_TIERS[startIdx + i] || null);
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
        const prevHkdRow = summaryHkdRows[idx - 1];
        hCell.value = moq ? { formula: `${L}${prevHkdRow}*0.995`, result: 0 } : null;
      }
      const uCell = ws.getCell(hkdRow + 1, col);
      delete uCell._sharedFormula;
      uCell.value = moq ? { formula: `ROUND(${L}${hkdRow}/${hkdUsdRate},3)`, result: 0 } : null;
    }
  });

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.getColumn(3).width = 20;  // Cu.Ft./Toy
  ws.getColumn(6).width = 18;  // Ex-Factory
  ws.getColumn(7).width = 18;  // FOB FCL
  ws.getColumn(8).width = 18;  // FOB LCL / Amount
}

// ─── Fill Body Cost Breakdown sheet ──────────────────────────────────────────

function fillBCD(ws, d) {
  const { version, product, params, moldParts, hardwareItems, electronicItems,
          paintingDetail, materialPrices, rawMaterials, bodyAccessories, sewingItems, sewingLaborItems, assemblyLaborItems, rotocastItems } = d;

  // ── Header (row 7) ─────────────────────────────────────────────────────────
  setVal(ws, 7, 1, version.body_no || '');
  setVal(ws, 7, 2, product?.item_desc || '');
  setVal(ws, 7, 3, version.body_cost_revision || '');
  setVal(ws, 7, 4, 'ROYAL REGENT PRODUCTS (H.K.) LIMITED');
  setVal(ws, 7, 6, version.prepared_by || '');
  setVal(ws, 7, 8, new Date());

  // ── Summary section markup % (rows 14–22, col E) ──────────────────────────
  const bodyMkup = parseFloat(params.markup_body) || 0.18;
  for (const r of [14, 15, 16, 19, 20, 21, 22]) {
    setVal(ws, r, 5, bodyMkup);
  }
  setVal(ws, 17, 5, 0); // D (Expensive Components) — markup 0%

  // Fix shared formula bug in col F (Amount) and col G (% to Body) — all summary rows
  // Use ROUND to match template formula exactly
  for (const r of [14, 15, 16, 17, 19, 20, 21, 22]) {
    const fCell = ws.getCell(r, 6);
    delete fCell._sharedFormula;
    fCell.value = { formula: `ROUND(D${r}*(1+E${r}),2)`, result: 0 };
    const gCell = ws.getCell(r, 7);
    delete gCell._sharedFormula;
    gCell.value = { formula: `ROUND(F${r}/$F$23,3)`, result: 0 };
  }

  // ── Section A: Raw Material — 3 sub-sections ──────────────────────────────
  // 1. Plastic/Resin: R31–R34 (4 slots), SUM at R36 col G = SUM(F31:F34)
  // 2. Alloy:         R38–R41 (4 slots), no SUM formula in template
  // 3. Fabric:        R43–R55 (13 slots), SUM at R57 col G = SUM(F43:F55)
  // Total:            R59 col G = SUM(G29:G58)

  const plastics = (rawMaterials || []).filter(m => m.category === 'plastic');
  const alloys   = (rawMaterials || []).filter(m => m.category === 'alloy');
  const fabrics  = (rawMaterials || []).filter(m => m.category === 'fabric');

  // Helper: fill a range of rows with raw material items
  // Force-clear a range including shared formula metadata, then write formula to col 6
  function forceWriteFormula(r, col, formula, result) {
    const cell = ws.getCell(r, col);
    cell.value = null;
    if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
    delete cell._sharedFormula;
    cell.value = { formula, result: result ?? 0 };
  }

  function fillMatRows(items, startRow, endRow, hasSpec) {
    // Force-clear cols 2-6 including formula cells and shared formula metadata
    for (let r = startRow; r <= endRow; r++) {
      for (let c = 2; c <= 6; c++) {
        const cell = ws.getCell(r, c);
        cell.value = null;
        if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
        delete cell._sharedFormula;
      }
    }
    items.slice(0, endRow - startRow + 1).forEach((m, i) => {
      const r = startRow + i;
      setVal(ws, r, 2, biName(m.material_name, m.eng_name));
      const usage = parseFloat(m.weight_g) || 0;
      const price = parseFloat(m.unit_price_per_kg) || 0;
      if (hasSpec) {
        // Fabric: usage in pcs, price per pcs → Amount = D*E
        const posText = m.spec_eng && m.spec_eng !== m.spec ? `${m.spec || ''} / ${m.spec_eng}` : (m.spec || '');
        setVal(ws, r, 3, posText);
        setVal(ws, r, 4, usage || null);
        setVal(ws, r, 5, r2(price));
        forceWriteFormula(r, 6, `D${r}*E${r}`, r2(usage * price));
      } else {
        // Plastic/Alloy: usage in grams, price per KG → Amount = ROUND(D*E/1000,3)
        setVal(ws, r, 4, usage || null);
        setVal(ws, r, 5, r2(price));
        forceWriteFormula(r, 6, `ROUND(D${r}*E${r}/1000,3)`, r2(usage * price / 1000));
      }
    });
  }

  // 1. Plastic/Resin R31–R34 (formula: =ROUND(D*E/1000,3))
  fillMatRows(plastics, 31, 34, false);
  // 2. Alloy R38–R41
  fillMatRows(alloys, 38, 41, false);
  // 3. Fabric R43–R55 (formula: =D*E, has spec/position in col C)
  const fabricsFiltered = fabrics.filter(m => m.spec !== '__labor__');
  const FABRIC_START = 43, FABRIC_SLOTS = 13; // template has 13 slots (R43-R55)
  const FABRIC_SUBTOTAL = FABRIC_START + FABRIC_SLOTS; // R56 sub-total
  const fabricExtra = Math.max(0, fabricsFiltered.length - FABRIC_SLOTS);
  for (let i = 0; i < fabricExtra; i++) ws.insertRow(FABRIC_SUBTOTAL + i, [], 'i+');
  const fabricEnd = FABRIC_START + Math.max(FABRIC_SLOTS, fabricsFiltered.length) - 1;
  fillMatRows(fabricsFiltered, FABRIC_START, fabricEnd, true);
  const fabricShift = fabricExtra;
  // Rewrite fabric subtotal SUM to cover actual data range (original R56 shifts down by fabricExtra)
  const fabricSubRow = FABRIC_SUBTOTAL + fabricExtra;
  const fabricSum = fabricsFiltered.reduce((s, m) => s + (parseFloat(m.weight_g) || 0) * (parseFloat(m.unit_price_per_kg) || 0), 0);
  { const c = ws.getCell(fabricSubRow, 7); delete c._sharedFormula; c.value = { formula: `SUM(F${FABRIC_START}:F${fabricEnd})`, result: Math.round(fabricSum * 1000) / 1000 }; }
  // Clear stale formula rows between fabricSubRow and A.TOTAL row
  for (let rr = fabricSubRow + 1; rr <= fabricSubRow + 3; rr++) {
    for (let c = 4; c <= 7; c++) { const cc = ws.getCell(rr, c); delete cc._sharedFormula; cc.value = null; }
  }
  // Rewrite A. TOTAL RAW MATERIAL COST formula (template R59, shifts by fabricShift)
  const aTotalRow = 59 + fabricShift;
  { const c = ws.getCell(aTotalRow, 7); delete c._sharedFormula; c.value = { formula: `SUM(G29:G${fabricSubRow})`, result: null }; }
  // Fix Summary row 14 (Raw Material Cost) to reference correct aTotalRow
  if (fabricShift !== 0) {
    const c = ws.getCell(14, 4); delete c._sharedFormula; c.value = { formula: `$G$${aTotalRow}`, result: null };
  }

  // ── Section B1: Injection Molding (rows 67–86) ──────────────────────────────
  const MOLD_START = 67 + fabricShift, MOLD_END = 86 + fabricShift;
  // Clear ALL cells — must splice shared formula metadata to prevent ExcelJS
  // from re-expanding F68:F86 shared formula over E column on file open
  for (let r = MOLD_START; r <= MOLD_END; r++) {
    for (let c = 1; c <= 7; c++) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      // Force-clear any shared formula reference that ExcelJS preserves in memory
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
    ws.getCell(r, 2).value = biName(part.description, part.eng_name);
    ws.getCell(r, 3).value = part.machine_type || '';
    ws.getCell(r, 4).value = shots;
    ws.getCell(r, 5).value = r2(costPerShot);
    forceWriteFormula(r, 6, `D${r}*E${r}`, r2(shots * costPerShot));
  });

  // Delete extra empty rows in injection section — keep only 3 blank rows after data
  const KEEP_BLANK = 3;
  const injDataEnd = MOLD_START + moldParts.length - 1;
  const injKeepEnd = injDataEnd + KEEP_BLANK;
  const injDeleteStart = injKeepEnd + 1;
  const injDeleteCount = MOLD_END - injKeepEnd;
  if (injDeleteCount > 0) ws.spliceRows(injDeleteStart, injDeleteCount);
  const injShift = injDeleteCount > 0 ? injDeleteCount : 0;

  // ── Section B2: Blow Molding / Rotocast (row 90 shifted up by deleted rows) ──
  const BLOW_TEMPLATE_ROW = 90 + fabricShift - injShift;
  const BLOW_SUBTOTAL_ROW = 91 + fabricShift - injShift;
  const rotoList = (rotocastItems || []).filter(r =>
    r.mold_no && /^[A-Za-z]+\d+/.test(r.mold_no.trim())
  );

  // Insert extra rows before subtotal if more than 1 item
  const rotoExtra = Math.max(0, rotoList.length - 1);
  for (let i = 0; i < rotoExtra; i++) {
    ws.insertRow(BLOW_SUBTOTAL_ROW + i, [], 'i+');
  }

  // Clear + fill blow molding rows
  for (let i = 0; i < Math.max(1, rotoList.length); i++) {
    const r = BLOW_TEMPLATE_ROW + i;
    if (i < rotoList.length) {
      const item = rotoList[i];
      const usagePcs   = parseInt(item.usage_pcs) || 1;
      // 单价(HK$) = unit_price_hkd × 1.08 (matches UI display)
      const unitPrice  = r2((parseFloat(item.unit_price_hkd) || 0) * 1.08);
      setVal(ws, r, 1, item.mold_no || '');
      setVal(ws, r, 2, item.name || '');
      setVal(ws, r, 3, '');
      setVal(ws, r, 4, usagePcs);                    // Shot/Toy = 用量
      setVal(ws, r, 5, unitPrice);                   // Cost/Shot = unit_price_hkd × 1.08
      forceWriteFormula(r, 6, `D${r}*E${r}`, r2(usagePcs * unitPrice));
    } else {
      for (let c = 1; c <= 7; c++) ws.getCell(r, c).value = null;
    }
  }

  // All sections below shift by: rotoExtra inserted rows - injShift deleted rows
  const blowShift = fabricShift + rotoExtra - injShift;

  // ── Rewrite B subtotal and B TOTAL formulas after row shifts ─────────────────
  // Template: Blow subtotal at row 91, B TOTAL at row 94 (both shift by blowShift)
  const BLOW_SUB_ROW  = 91 + blowShift;
  const B_TOTAL_ROW   = 94 + blowShift;
  const injSectionStart = MOLD_START; // row 67 (fixed)
  const blowSectionEnd  = BLOW_TEMPLATE_ROW + Math.max(0, rotoList.length - 1); // last roto row
  // Blow subtotal: SUM of G column from injection start to end of blow section
  forceWriteFormula(BLOW_SUB_ROW, 7, `SUM(F${injSectionStart}:F${blowSectionEnd})`,
    null);
  // B TOTAL: same value (only one subtotal row feeds into it)
  forceWriteFormula(B_TOTAL_ROW, 7, `G${BLOW_SUB_ROW}`, null);

  // ── Section C: Electronics (rows 101–103) ──────────────────────────────────
  const ELEC_START = 101 + blowShift, ELEC_END = 103 + blowShift;
  // Clear cols 2-6 including F col formula to prevent stale template formulas
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
    setVal(ws, r, 2, biName(item.part_name, item.eng_name));
    setVal(ws, r, 3, 'pc');
    setVal(ws, r, 4, parseFloat(item.quantity) || 1);
    setVal(ws, r, 5, r2(item.unit_price_usd) || 0);
    forceWriteFormula(r, 6, `D${r}*E${r}`,
      r2((parseFloat(item.quantity) || 1) * (r2(item.unit_price_usd) || 0)));
  });

  // Rewrite Electronics sub-total SUM formula (template R104, shifts by blowShift)
  const ELEC_SUBTOTAL_ROW = ELEC_END + 1; // row 104 + blowShift
  forceWriteFormula(ELEC_SUBTOTAL_ROW, 7, `SUM(F${ELEC_START}:F${ELEC_END})`, null);

  // ── Section C2: Sewing Accessories (rows 106–109 data, row 110 sub-total) ──
  const SEW_START = 106 + blowShift, SEW_DATA_TEMPLATE_END = 109 + blowShift;
  const SEW_SUBTOTAL_TEMPLATE = 110 + blowShift; // sub-total row in template
  const hkdRmb = parseFloat(params.rmb_hkd) || 0.85;
  const sewList = sewingItems || [];
  const baList  = bodyAccessories || [];

  // Insert extra rows before sub-total row if more data than template slots (4)
  const sewExtra = Math.max(0, sewList.length - (SEW_DATA_TEMPLATE_END - SEW_START + 1));
  for (let i = 0; i < sewExtra; i++) {
    ws.insertRow(SEW_SUBTOTAL_TEMPLATE + i, [], 'i+');
  }
  const SEW_END = SEW_DATA_TEMPLATE_END + sewExtra;

  // Clear + fill sewing rows
  clearRows(ws, SEW_START, SEW_END, [2, 3, 4, 5]);
  const SEW_FONT = { size: 12, name: 'Arial', charset: 134 };
  sewList.forEach((item, i) => {
    const r = SEW_START + i;
    const totalHkd = hkdRmb > 0 ? (parseFloat(item.total_price_rmb) || 0) / hkdRmb : 0;
    const usage = parseFloat(item.usage_amount) || 1;
    const unitPriceHkd = Math.round(totalHkd / usage * 10000) / 10000; // 4 decimal places to avoid rounding to 0
    const c2 = ws.getCell(r, 2); c2.value = biName(item.fabric_name, item.eng_name); c2.font = SEW_FONT; c2.alignment = { vertical: 'middle', wrapText: true };
    const c3 = ws.getCell(r, 3); c3.value = usage > 1 ? 'pcs' : 'pc'; c3.font = SEW_FONT; c3.alignment = { horizontal: 'center' };
    const c4 = ws.getCell(r, 4); c4.value = usage; c4.font = SEW_FONT;
    const c5 = ws.getCell(r, 5); c5.value = unitPriceHkd; c5.font = SEW_FONT; c5.style = { numFmt: '#,##0.0000', font: SEW_FONT, alignment: { horizontal: 'right' } };
    forceWriteFormula(r, 6, `ROUND(D${r}*E${r},2)`, r2(totalHkd));
    const c6 = ws.getCell(r, 6); c6.font = SEW_FONT; c6.numFmt = '$#,##0.00';
  });

  // Rewrite Sewing Accessories sub-total SUM formula (template R110, shifts by blowShift + sewExtra)
  const SEW_SUBTOTAL_ROW = SEW_END + 1; // row 110 + blowShift + sewExtra
  forceWriteFormula(SEW_SUBTOTAL_ROW, 7, `SUM(F${SEW_START}:F${SEW_END})`, null);

  // ── Section C3: Other Components (body accessories) ──────────────────────────
  // Template: data rows 113-134 (22 slots), Sub Total (SUM) at row 135, gap 136-138, C.TOTAL at 140
  const totalShift = blowShift + sewExtra;
  const C3_DATA_START = 113 + totalShift;
  const C3_SLOTS = 22;     // data rows 113-134 in original template
  const C3_SUBTOTAL_ROW = C3_DATA_START + C3_SLOTS; // row 135 (+ shift)
  const C3_GAP = 4;        // always leave 4 empty rows after data before subtotal
  const c3Need = baList.length + C3_GAP; // total rows needed (data + gap)
  const c3Extra = Math.max(0, c3Need - C3_SLOTS); // extra rows to insert
  const c3Delete = Math.max(0, C3_SLOTS - c3Need); // excess rows to delete
  // Insert extra rows if needed
  for (let i = 0; i < c3Extra; i++) {
    ws.insertRow(C3_SUBTOTAL_ROW + i, [], 'i+');
  }
  // Delete excess empty rows if data is less than template slots
  if (c3Delete > 0) ws.spliceRows(C3_DATA_START + baList.length, c3Delete);
  const C3_TOTAL = C3_SLOTS + c3Extra - c3Delete;
  // Sub Total row shifts accordingly
  const c3SubTotalRow = C3_DATA_START + C3_TOTAL;

  // Force-clear cols 2-6 (incl. formula cells and shared formula metadata)
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
    ws.getCell(r, 2).value = biName(item.description, item.eng_name);
    ws.getCell(r, 3).value = usage > 1 ? 'pcs' : 'pc';
    ws.getCell(r, 4).value = usage;
    ws.getCell(r, 5).value = unitPrice;
    forceWriteFormula(r, 6, `D${r}*E${r}`, r2(usage * unitPrice));
  });

  // Rewrite Sub Total SUM formula to cover actual data range
  const c3DataEnd = C3_DATA_START + baList.length - 1;
  const c3Sum = baList.reduce((s, item) => {
    const usage = parseFloat(item.usage_qty) ?? 0;
    const price = r2(item.unit_price) || 0;
    return s + r2(usage * price);
  }, 0);
  forceWriteFormula(c3SubTotalRow, 7, `SUM(F${C3_DATA_START}:F${c3DataEnd})`, r2(c3Sum));

  // Rewrite C. TOTAL PURCHASE PARTS SUM formula to cover full section C range
  // Template: C.TOTAL is 2 rows after the C3 sub-total row (c3SubTotalRow+2)
  const C_TOTAL_ROW = c3SubTotalRow + 2;
  const C_SUM_END   = C_TOTAL_ROW - 1;
  // C section starts at ELEC_START (101 + blowShift), use dynamic start instead of hardcoded 97
  const C_SUM_START = ELEC_START;
  forceWriteFormula(C_TOTAL_ROW, 7, `SUM(G${C_SUM_START}:G${C_SUM_END})`, null);

  // ── Section E: E. OTHER LABOUR & PROCESS ─────────────────────────────────────
  // Anchor all Section D/E rows relative to c3SubTotalRow (template row 135).
  // This avoids eShift arithmetic errors from mixed insertions/deletions above.
  // Template offsets from c3SubTotalRow=135:
  //   D data: +6..+8 (rows 141-143)   D.SUB: +9 (144)   D.TOTAL: +10 (145)
  //   Ransburg: +17 (152)   Spraying: +18 (153)   Vacuum: +19 (154)
  //   DECO subtotal: +20 (155)
  //   Trimming: +22 (157)   Polishing: +23 (158)   TRIM subtotal: +24 (159)
  //   WOOD CUTTING: +25 (160)   WOOD subtotal: +26 (161)
  //   SEWING data: +27 (162)   SEWING subtotal: +28 (163)
  //   ASSEMBLY: +30 (165)   E.TOTAL: +35 (170)
  const E0 = c3SubTotalRow - 135; // net shift applied to all template row numbers

  // Clear stale data columns D-G in section D+E range
  for (let r = 141 + E0; r <= 175 + E0; r++) {
    for (const c of [4, 5, 6, 7]) {
      const cell = ws.getCell(r, c);
      delete cell._sharedFormula;
      if (!(cell.value && typeof cell.value === 'object' && cell.value.formula)) cell.value = null;
    }
  }

  // Fix Section D (EXPENSIVE COMPONENT) sub-total and D.TOTAL formulas
  const D_SUB_ROW   = 144 + E0;
  const D_TOTAL_ROW = 145 + E0;
  forceWriteFormula(D_SUB_ROW,   7, `SUM(F${141 + E0}:F${143 + E0})`, 0);
  forceWriteFormula(D_TOTAL_ROW, 7, `SUM(G${141 + E0}:G${144 + E0})`, 0);

  // Helper: force-write a numeric value to G column (clears template formulas/shared formulas)
  function writeSubTotal(row, value) {
    const cell = ws.getCell(row, 7);
    cell.value = null;
    if (cell._value && cell._value._type !== undefined) cell._value._type = 0;
    delete cell._sharedFormula;
    cell.value = { formula: `SUM(F${row - 4}:F${row - 1})`, result: r2(value) ?? 0 };
  }

  // 1. DECORATION — find Spraying row dynamically by scanning col B for "Spraying"
  let decoSprayRow = 153 + E0; // fallback
  let decoSubTotalRow = 155 + E0;
  for (let r = Math.max(1, 140 + E0); r <= Math.min(ws.rowCount, 170 + E0); r++) {
    const label = String(ws.getCell(r, 2).value || '').trim();
    if (label === 'Spraying') { decoSprayRow = r; decoSubTotalRow = r + 2; break; }
  }
  let decoAmount = 0;
  if (paintingDetail) {
    const totalOps  = parseInt(paintingDetail.total_operations) || 0;
    const quotedPrice = parseFloat(paintingDetail.quoted_price_hkd) || 0;
    const unitCost  = totalOps > 0 ? Math.round(quotedPrice / totalOps * 100) / 100 : null;
    decoAmount = r2((totalOps || 0) * (unitCost || 0)) || 0;
    ws.getCell(decoSprayRow, 4).value = totalOps || null;
    ws.getCell(decoSprayRow, 5).value = unitCost;
    forceWriteFormula(decoSprayRow, 6, `D${decoSprayRow}*E${decoSprayRow}`, decoAmount);
  }
  // DECORATION G sub-total = SUM(Ransburg + Spraying + Vacuum Plating)
  forceWriteFormula(decoSubTotalRow, 7,
    `SUM(F${decoSprayRow - 1}:F${decoSprayRow + 1})`, decoAmount);

  // 2. TRIMMING & DEGATING sub-total (rows 157-158, sub-total row 159)
  const trimSubRow = 159 + E0;
  forceWriteFormula(trimSubRow, 7, `SUM(F${157 + E0}:F${158 + E0})`, 0);

  // 3. WOOD CUTTING sub-total (row 161) — clear surrounding cells to break shared formula chain
  for (let rr = 157 + E0; rr <= 162 + E0; rr++) {
    const cc = ws.getCell(rr, 7);
    delete cc._sharedFormula;
    if (cc.value && typeof cc.value === 'object' && cc.value.sharedFormula) cc.value = null;
  }
  forceWriteFormula(161 + E0, 7, `SUM(F${160 + E0}:F${160 + E0})`, 0);

  // 4. SEWING — data on R162 (header row), sub-total G on R163
  const sewLaborList = sewingLaborItems || [];
  let sewAmount = 0;
  const sewDataRow = 162 + E0;  // data fills the SEWING header row
  const sewRow     = 163 + E0;  // sub-total row (used by fixSubTotal)
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

  // 5. OTHERS — Assembly labour
  const asmList = (assemblyLaborItems || []).filter(h => !/(喷油|油漆|包装人工)/.test(h.name || ''));
  const asmItem = asmList.find(h => (h.name || '').includes('装配')) || asmList[0];
  let asmAmount = 0;
  if (asmItem) {
    // asmTotalQuoted = sum of new_price for all non-spray assembly items (same logic as UI assemblySub)
    const assemblySub = asmList
      .filter(h => !/(喷油|油漆)/.test(h.name || ''))
      .reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
    const asmTotalQuoted = r2(assemblySub * 1.08);  // 含码点 ×1.08，同UI报价逻辑
    const asmQty   = 11;  // fixed at 11 hours
    const asmPrice = r2(asmTotalQuoted / asmQty);  // unit cost = quoted total / 11
    asmAmount = r2(asmQty * asmPrice) || 0;
    const asmRow = 165 + E0;
    setVal(ws, asmRow, 4, asmQty);
    setVal(ws, asmRow, 5, asmPrice);
    forceWriteFormula(asmRow, 6, `D${asmRow}*E${asmRow}`, asmAmount);
  }
  // OTHERS sub-total (row 168 = 165+3): sum Assembly + Plush + Bonding
  forceWriteFormula(168 + E0, 7, `SUM(F${165 + E0}:F${167 + E0})`, asmAmount);

  // E. TOTAL LABOUR & PROCESS COST (template row 170)
  const totalEAmount = r2(decoAmount + sewAmount + asmAmount);
  forceWriteFormula(170 + E0, 7,
    `SUM(G${153 + E0}:G${168 + E0})`, totalEAmount);

  // ── Fix Summary section Sub Total column (col D, rows 16/17/19-22) ───────────
  // Template references these row numbers in col D; after row insertions they drift.
  // Row 16 C = C.TOTAL (G col), Row 17 D = D.TOTAL (G col)
  // Rows 19-22 E sub-sections = respective G sub-total rows
  const fixSubTotal = (summaryRow, srcRow) => {
    const cell = ws.getCell(summaryRow, 4);
    delete cell._sharedFormula;
    cell.value = { formula: `G${srcRow}`, result: 0 };
  };
  fixSubTotal(15, B_TOTAL_ROW);                // B Molding Labour
  fixSubTotal(16, C_TOTAL_ROW);                // C Purchase Parts
  fixSubTotal(17, D_TOTAL_ROW);                // D Expensive Components
  fixSubTotal(19, decoSubTotalRow);            // E.1 Decoration
  fixSubTotal(20, trimSubRow);                 // E.2 Trimming
  fixSubTotal(21, sewRow);                     // E.3 Sewing (= 163+eShift)
  fixSubTotal(22, 168 + E0);                    // E.4 Others
}

// ─── Fill Plush Template (3K报价 format) ──────────────────────────────────────

function fillPlush(ws, d) {
  const { version, product, params, moldParts, rotocastItems } = d;

  // ── Product info ──
  ws.getCell('C1').value = product ? `${product.item_no || ''}-${product.item_desc || ''}` : '';
  ws.getCell('B15').value = version.quote_date ? `日期:${version.quote_date.slice(0, 10).replace(/-/g, '.')}` : '';

  // ── Exchange rate params (rows 11-14) ──
  if (params.hkd_rmb_quote) ws.getCell('D11').value = parseFloat(params.hkd_rmb_quote);
  if (params.hkd_rmb_check) ws.getCell('D12').value = parseFloat(params.hkd_rmb_check);
  if (params.rmb_hkd)       ws.getCell('D13').value = parseFloat(params.rmb_hkd);
  if (params.hkd_usd)       ws.getCell('D14').value = parseFloat(params.hkd_usd);
  if (params.labor_hkd)     ws.getCell('G13').value = parseFloat(params.labor_hkd);

  // ── Section: Injection Mold (row 17+) ────────────────────────────────────────
  const INJ_TEMPLATE_ROW = 17;
  const injList = moldParts || [];

  // Insert extra rows if more than 1 injection part
  for (let i = 1; i < injList.length; i++) {
    ws.insertRow(INJ_TEMPLATE_ROW + i, [], 'i+');
  }
  const injCount = Math.max(1, injList.length);

  // Clear + fill injection rows
  injList.forEach((part, i) => {
    const r = INJ_TEMPLATE_ROW + i;
    if (i === 0) ws.getCell(r, 1).value = '注塑模具';
    else ws.getCell(r, 1).value = null;
    ws.getCell(r, 2).value = part.part_no || '';
    ws.getCell(r, 3).value = biName(part.description, part.eng_name);
    ws.getCell(r, 4).value = part.material || '';
    ws.getCell(r, 5).value = parseFloat(part.weight_g) || null;
    // Col F (price/g) — formula references material lookup table, keep as-is for row 17
    // For inserted rows write directly
    if (i > 0) ws.getCell(r, 6).value = parseFloat(part.unit_price_hkd_g) || null;
    ws.getCell(r, 7).value = part.machine_type || '';
    ws.getCell(r, 8).value = parseInt(part.cavity_count) || null;
    ws.getCell(r, 9).value = parseInt(part.sets_per_toy) || null;
    ws.getCell(r, 10).value = parseInt(part.target_qty) || null;
    // Col K (molding labor) — formula, keep for row 17; write directly for inserted rows
    if (i > 0) ws.getCell(r, 11).value = r2(part.molding_labor);
    // Col L (material cost) — formula, keep for row 17; write directly for inserted rows
    if (i > 0) ws.getCell(r, 12).value = r2(part.material_cost_hkd);
    ws.getCell(r, 13).value = r2(part.mold_cost_rmb);
    ws.getCell(r, 14).value = part.remark || '';
  });

  // ── Section: Rotocast / Blow Molding (row 21+, shifted by extra inj rows) ──
  const ROTO_TEMPLATE_START = 21;
  const rotoList = (rotocastItems || []).filter(r =>
    r.mold_no && /^[A-Za-z]+\d+/.test(r.mold_no.trim())
  );
  const rotoShift = injCount - 1; // rows shifted due to injection inserts
  const ROTO_START = ROTO_TEMPLATE_START + rotoShift;
  const ROTO_TEMPLATE_END = ROTO_TEMPLATE_START + 1; // template has 2 rows (21-22)

  // Insert extra rows if more than 2 rotocast items
  const rotoTemplateCount = 2;
  const rotoExtra = Math.max(0, rotoList.length - rotoTemplateCount);
  for (let i = 0; i < rotoExtra; i++) {
    ws.insertRow(ROTO_START + rotoTemplateCount + i, [], 'i+');
  }

  // Clear + fill rotocast rows
  for (let i = 0; i < Math.max(rotoTemplateCount, rotoList.length); i++) {
    const r = ROTO_START + i;
    if (i === 0) ws.getCell(r, 1).value = '搪胶模具';
    else ws.getCell(r, 1).value = null;
    if (i < rotoList.length) {
      const item = rotoList[i];
      ws.getCell(r, 2).value = item.mold_no || '';
      ws.getCell(r, 3).value = item.name || '';
      ws.getCell(r, 4).value = parseInt(item.output_qty) || null;
      ws.getCell(r, 5).value = parseInt(item.usage_pcs) || 1;
      ws.getCell(r, 6).value = r2(item.unit_price_hkd);
      // G col = formula =F*E for template row; write directly for extra rows
      if (i < rotoTemplateCount) {
        // keep template formula (auto-calc)
      } else {
        const total = (parseFloat(item.unit_price_hkd) || 0) * (parseInt(item.usage_pcs) || 1);
        ws.getCell(r, 7).value = { formula: `F${r}*E${r}`, result: r2(total) || 0 };
      }
      ws.getCell(r, 8).value = item.remark || '';
    } else {
      // Clear empty template rows
      for (let c = 1; c <= 8; c++) {
        const cell = ws.getCell(r, c);
        if (!cell.value?.formula) cell.value = null;
      }
    }
  }
}

// ─── Main Export Function ─────────────────────────────────────────────────────

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

async function exportVersion(versionId) {
  const d = loadData(versionId);
  const isPlush = d.version.format_type === 'plush';
  const templatePath = isPlush ? TEMPLATE_PATH_PLUSH : TEMPLATE_PATH;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  // Force Excel to recalculate all formulas on open
  wb.calcProperties = { fullCalcOnLoad: true };

  fixSharedFormulas(wb);

  if (isPlush) {
    // Plush template: first sheet has a dynamic name (e.g. "3K报价-印尼-260321")
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Plush template has no worksheets');
    fillPlush(ws, d);
  } else {
    const vqWs  = wb.getWorksheet('Vendor Quotation');
    const bcdWs = wb.getWorksheet('Body Cost Breakdown');
    if (!vqWs)  throw new Error('Template missing "Vendor Quotation" sheet');
    if (!bcdWs) throw new Error('Template missing "Body Cost Breakdown" sheet');
    fillVQ(vqWs, d);
    fillBCD(bcdWs, d);
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { exportVersion };
