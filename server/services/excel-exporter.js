/**
 * Excel Export Service — Template-Driven
 * Loads VQ-template.xlsx and fills data from DB, preserving all TOMY formatting and formulas.
 */
const ExcelJS = require('exceljs');
const path = require('path');
const { getDb } = require('./db');

const TEMPLATE_PATH = path.join(__dirname, '../templates/VQ-template.xlsx');

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
    rawMaterials:   db.prepare('SELECT * FROM RawMaterial WHERE version_id = ? ORDER BY sort_order').all(versionId),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const { version, product, params, packagingItems, productDim, transportConfig, bodyAccessories } = d;

  // ── Header (rows 2–5) ──────────────────────────────────────────────────────
  setVal(ws, 2, 3, product?.vendor || '');
  setVal(ws, 2, 8, version.prepared_by || '');
  setVal(ws, 3, 3, product?.item_no || '');
  setVal(ws, 3, 8, version.quote_date ? new Date(version.quote_date) : '');
  setVal(ws, 4, 3, product?.item_desc || '');
  setVal(ws, 4, 8, version.quote_rev || '');
  setVal(ws, 5, 3, version.item_rev || '');
  setVal(ws, 5, 8, version.fty_delivery_date || '');

  // ── Section A (rows 11–16): Body Cost — row 11 formula stays (='BCD'!F23) ─
  // Just update part no and description for main body row
  if (product?.item_no) {
    setVal(ws, 11, 1, product.item_no + '-00');
    setVal(ws, 11, 2, product.item_desc || '');
    setVal(ws, 11, 5, 2500);  // default MOQ
    setVal(ws, 11, 6, 1);     // usage 1 per toy
    // G11 = ='Body Cost Breakdown'!F23 — do NOT overwrite (formula)
  }
  // Fill accessory rows 12–16
  clearRows(ws, 12, 16, [1, 2, 5, 6, 7]);
  bodyAccessories.slice(0, 5).forEach((acc, i) => {
    const r = 12 + i;
    setVal(ws, r, 1, acc.part_no || '');
    setVal(ws, r, 2, acc.description || '');
    setVal(ws, r, 5, parseInt(acc.moq) || 2500);
    setVal(ws, r, 6, parseFloat(acc.usage_qty) || 1);
    setVal(ws, r, 7, r2(acc.unit_price) || 0);
  });

  // ── Section B (rows 23–35): Packaging ──────────────────────────────────────
  const PKG_START = 23, PKG_END = 35;
  // Clear first
  clearRows(ws, PKG_START, PKG_END, [1, 2, 3, 5, 6, 7]);
  // Fill packaging items
  const moq = params.moq_default || 2500;
  packagingItems.slice(0, PKG_END - PKG_START + 1).forEach((item, i) => {
    const r = PKG_START + i;
    setVal(ws, r, 2, item.name || '');
    setVal(ws, r, 3, item.remark || '');    // specifications / remark
    setVal(ws, r, 5, moq);
    setVal(ws, r, 6, item.quantity || 1);
    setVal(ws, r, 7, r2(item.new_price) || 0);
    // H col = formula =ROUND(F*G,2) — not touched
  });
  // Mark Up row 36: G36 = markup%
  const pkgMarkup = parseFloat(params.markup_packaging) || 0.12;
  setVal(ws, 36, 7, pkgMarkup);

  // ── Section D (row 52): Master Carton ──────────────────────────────────────
  if (productDim) {
    setVal(ws, 52, 2, parseFloat(productDim.carton_l_inch) || null);
    setVal(ws, 52, 3, parseFloat(productDim.carton_w_inch) || null);
    setVal(ws, 52, 4, parseFloat(productDim.carton_h_inch) || null);
    setVal(ws, 52, 6, parseInt(productDim.pcs_per_carton) || null);
    setVal(ws, 52, 7, r2(productDim.carton_price));
  }

  // ── Section E (row 58): Transport cost parameters ──────────────────────────
  // Template: F58=Ex-Factory cost/CuFt, G58=FOB FCL cost/CuFt, H58=FOB LCL cost/CuFt
  // C58 = formula =B52*C52*D52/1728*F52 (CuFt per toy, don't touch)
  if (transportConfig) {
    setVal(ws, 58, 6, r2(transportConfig.hk_10t_cost) || 0.5);   // Ex-Factory
    setVal(ws, 58, 7, r2(transportConfig.yt_40_cost)  || 4.3);   // FOB FCL
    setVal(ws, 58, 8, r2(transportConfig.hk_40_cost)  || 15.85); // FOB LCL
  }
}

// ─── Fill Body Cost Breakdown sheet ──────────────────────────────────────────

function fillBCD(ws, d) {
  const { version, product, params, moldParts, hardwareItems, electronicItems,
          paintingDetail, materialPrices, rawMaterials } = d;

  // ── Header (row 7) ─────────────────────────────────────────────────────────
  setVal(ws, 7, 1, version.body_no || '');
  setVal(ws, 7, 2, product?.item_desc || '');
  setVal(ws, 7, 3, version.body_cost_revision || '');
  setVal(ws, 7, 4, product?.vendor || '');
  setVal(ws, 7, 6, version.bd_prepared_by || '');
  setVal(ws, 7, 8, version.bd_date ? new Date(version.bd_date) : '');

  // ── Summary section markup % (rows 14–22, col E) ──────────────────────────
  const bodyMkup = parseFloat(params.markup_body) || 0.18;
  for (const r of [14, 15, 16, 19, 20, 21, 22]) {
    setVal(ws, r, 5, bodyMkup);
  }
  setVal(ws, 17, 5, 0); // D (Expensive Components) — markup 0%

  // ── Section A: Raw Material — 3 sub-sections ──────────────────────────────
  // 1. Plastic/Resin: R31–R34 (4 slots), SUM at R36 col G = SUM(F31:F34)
  // 2. Alloy:         R38–R41 (4 slots), no SUM formula in template
  // 3. Fabric:        R43–R55 (13 slots), SUM at R57 col G = SUM(F43:F55)
  // Total:            R59 col G = SUM(G29:G58)

  const plastics = (rawMaterials || []).filter(m => m.category === 'plastic');
  const alloys   = (rawMaterials || []).filter(m => m.category === 'alloy');
  const fabrics  = (rawMaterials || []).filter(m => m.category === 'fabric');

  // Helper: fill a range of rows with raw material items
  function fillMatRows(items, startRow, endRow, hasSpec) {
    const cols = hasSpec ? [2, 3, 4, 5] : [2, 4, 5];
    clearRows(ws, startRow, endRow, cols);
    items.slice(0, endRow - startRow + 1).forEach((m, i) => {
      const r = startRow + i;
      setVal(ws, r, 2, m.material_name || '');
      if (hasSpec) setVal(ws, r, 3, m.spec || '');
      setVal(ws, r, 4, parseFloat(m.weight_g) || null);
      setVal(ws, r, 5, r2(m.unit_price_per_kg));
    });
  }

  // 1. Plastic/Resin R31–R34 (formula: =ROUND(D*E/1000,3))
  fillMatRows(plastics, 31, 34, false);
  // 2. Alloy R38–R41
  fillMatRows(alloys, 38, 41, false);
  // 3. Fabric R43–R55 (formula: =D*E, has spec/position in col C)
  fillMatRows(fabrics, 43, 55, true);

  // ── Section B: Molding Labour (rows 67–90 = injection molding data) ────────
  const MOLD_START = 67, MOLD_END = 90;
  clearRows(ws, MOLD_START, MOLD_END, [1, 2, 3, 4, 5]);

  moldParts.slice(0, MOLD_END - MOLD_START + 1).forEach((part, i) => {
    const r = MOLD_START + i;
    const setsPerToy  = parseFloat(part.sets_per_toy) || 1;
    const shots = setsPerToy > 0 ? 1 / setsPerToy : 1;   // Shot/Toy = 1 ÷ 出模套数
    const laborPerToy = parseFloat(part.molding_labor) || 0;
    const costPerShot = r2(laborPerToy * setsPerToy);   // Cost/Shot = 啤工 × 出模套数

    setVal(ws, r, 1, part.part_no || '');
    setVal(ws, r, 2, part.description || '');
    setVal(ws, r, 3, part.machine_type || '');
    setVal(ws, r, 4, shots);
    setVal(ws, r, 5, r2(costPerShot));
    // F col = formula =D*E — not touched (already in template)
  });

  // ── Section C: Electronics (rows 101–103) ──────────────────────────────────
  const ELEC_START = 101, ELEC_END = 103;
  clearRows(ws, ELEC_START, ELEC_END, [2, 3, 4, 5]);

  electronicItems.slice(0, ELEC_END - ELEC_START + 1).forEach((item, i) => {
    const r = ELEC_START + i;
    setVal(ws, r, 2, item.part_name || '');
    setVal(ws, r, 3, 'pc');
    setVal(ws, r, 4, parseFloat(item.quantity) || 1);
    setVal(ws, r, 5, r2(item.unit_price_usd) || 0);
    // F col = formula =E*D — not touched
  });

  // ── Section C: Other Hardware (rows 113–134) ───────────────────────────────
  const HW_START = 113, HW_END = 134;
  clearRows(ws, HW_START, HW_END, [2, 3, 4, 5]);

  hardwareItems.slice(0, HW_END - HW_START + 1).forEach((item, i) => {
    const r = HW_START + i;
    setVal(ws, r, 2, item.name || '');
    setVal(ws, r, 3, 'pc');
    setVal(ws, r, 4, parseFloat(item.quantity) || 1);
    setVal(ws, r, 5, r2(item.new_price) || 0);
    // F col = formula =D*E — not touched
  });

  // ── Section E: Decoration (row 153) ────────────────────────────────────────
  if (paintingDetail) {
    const sprayOps = parseInt(paintingDetail.spray_count) || 0;
    const laborPerOp = sprayOps > 0
      ? (parseFloat(paintingDetail.labor_cost_hkd) || 0) / sprayOps
      : 0;
    setVal(ws, 153, 4, sprayOps || null);
    setVal(ws, 153, 5, r2(laborPerOp));
    // F153 = formula =E153*D153 — not touched
  }

  // ── Section E: Assembly (row 165) ──────────────────────────────────────────
  // Assembly hours from labor_hkd param (hourly rate) — use a default assembly op
  const assemblyHours = parseFloat(params.assembly_hours) || null;
  const laborRate = parseFloat(params.labor_hkd) || null;
  setVal(ws, 165, 4, assemblyHours);
  setVal(ws, 165, 5, r2(laborRate));
}

// ─── Main Export Function ─────────────────────────────────────────────────────

async function exportVersion(versionId) {
  const d = loadData(versionId);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  // ExcelJS may write NaN formula results as invalid XML — clear them
  wb.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.value && typeof cell.value === 'object' && cell.value.formula !== undefined) {
          const r = cell.value.result;
          if (r === null || r === undefined || (typeof r === 'number' && isNaN(r))) {
            cell.value = { formula: cell.value.formula };  // keep formula, drop bad result
          }
        }
      });
    });
  });

  const vqWs  = wb.getWorksheet('Vendor Quotation');
  const bcdWs = wb.getWorksheet('Body Cost Breakdown');

  if (!vqWs)  throw new Error('Template missing "Vendor Quotation" sheet');
  if (!bcdWs) throw new Error('Template missing "Body Cost Breakdown" sheet');

  fillVQ(vqWs, d);
  fillBCD(bcdWs, d);

  return wb.xlsx.writeBuffer();
}

module.exports = { exportVersion };
