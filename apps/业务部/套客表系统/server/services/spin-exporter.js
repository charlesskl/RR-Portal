/**
 * SPIN Vendor Quote Form Export Service
 * Loads VQ-template-spin.xlsx and fills data from DB for Spin Master format.
 */
const ExcelJS = require('exceljs');
const path = require('path');
const { getDb } = require('./db');

const TEMPLATE_PATH = path.join(__dirname, '../templates/VQ-template-spin.xlsx');

// ─── Load all version data from DB ───────────────────────────────────────────

function loadData(versionId) {
  const db = getDb();
  const version = db.prepare('SELECT * FROM QuoteVersion WHERE id = ?').get(versionId);
  if (!version) throw new Error(`Version ${versionId} not found`);
  const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(version.product_id);
  const params  = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(versionId) || {};
  const allSewing = db.prepare('SELECT * FROM SewingDetail WHERE version_id = ? ORDER BY sort_order').all(versionId);

  // Group sewing details by sub_product (character sheet name like "Chase", "Rocky")
  const sewingByChar = {};
  for (const row of allSewing) {
    const key = row.sub_product || '__default__';
    if (!sewingByChar[key]) sewingByChar[key] = [];
    sewingByChar[key].push(row);
  }

  return {
    version, product, params,
    sewingByChar,
    // fallback flat lists (for single-product versions)
    fabricItems:    allSewing.filter(r => r.position === '__fabric__'),
    otherItems:     allSewing.filter(r => r.position !== '__fabric__' && r.position !== '__labor__' && !(r.fabric_name || '').includes('人工')),
    laborItems:     allSewing.filter(r => r.position === '__labor__'),
    packagingItems: db.prepare('SELECT * FROM PackagingItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    productDim:     db.prepare('SELECT * FROM ProductDimension WHERE version_id = ?').get(versionId) || {},
    moldParts:      db.prepare('SELECT * FROM MoldPart WHERE version_id = ? ORDER BY sort_order').all(versionId),
    hardwareItems:  db.prepare('SELECT * FROM HardwareItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    electronicItems:db.prepare('SELECT * FROM ElectronicItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    transportConfig:db.prepare('SELECT * FROM TransportConfig WHERE version_id = ?').get(versionId) || {},
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r2(v) {
  const n = parseFloat(v);
  return (n == null || isNaN(n)) ? null : Math.round(n * 10000) / 10000;
}

function setVal(ws, row, col, value) {
  const cell = ws.getCell(row, col);
  // Never overwrite formula cells — they calculate automatically
  if (cell.value && typeof cell.value === 'object' && cell.value.formula) return;
  // Guard against NaN (invalid XML)
  if (typeof value === 'number' && isNaN(value)) value = null;
  cell.value = (value === undefined) ? null : value;
}

function clearRows(ws, startRow, endRow, dataCols) {
  for (let r = startRow; r <= endRow; r++) {
    for (const c of dataCols) {
      // Always clear completely — data input cols (J/K) must accept written values
      ws.getCell(r, c).value = null;
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

// ─── Fill Character (款式) Sheet ──────────────────────────────────────────────

function fillCharacterSheet(ws, d) {
  const { version, product, params, fabricItems, otherItems, laborItems, packagingItems, productDim,
          moldParts, electronicItems, transportConfig } = d;

  // Exchange rate setup
  // rmb_hkd: 1 HKD = rmb_hkd RMB (~0.85)
  // hkd_usd: 1 USD = hkd_usd HKD (~7.75)
  // RMB → USD: rmb / rmb_hkd / hkd_usd
  const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;   // RMB per HKD
  const hkd_usd = parseFloat(params.hkd_usd) || 7.75;   // HKD per USD
  const rmbUsdRate = rmb_hkd * hkd_usd;                  // RMB per USD ≈ 6.6

  // ── Header (force-write to bypass formula cells) ────────────────────────────
  ws.getCell(3, 3).value = 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED';
  ws.getCell(3, 14).value = 'Charles';                   // PREPARED BY — N3
  ws.getCell(4, 3).value = 'SPIN MASTER TOYS FAR EAST LTD';
  ws.getCell(4, 14).value = { formula: 'Summary!N6' };   // REVISION — reference Summary N6
  ws.getCell(5, 3).value = product ? (product.item_no || '') : '';
  ws.getCell(5, 14).value = new Date();                   // DATE — N5
  ws.getCell(6, 3).value = null;  // MATERIAL GROUP — leave blank
  const charSuffix = d.charName ? `--${d.charName}` : '';
  ws.getCell(7, 3).value = product ? ((product.item_desc || '') + charSuffix) : '';

  // ── Fabric Cost (R23-R35): cols C=3 eng desc, D=4 cn desc, J=10 USD price, K=11 qty ──
  // Merge rows with the same fabric_name: sum usage_amount, keep unit price from first occurrence
  const mergedFabrics = [];
  for (const item of fabricItems) {
    const name = item.fabric_name || '';
    const existing = mergedFabrics.find(m => m.fabric_name === name);
    if (existing) {
      existing.usage_amount = (parseFloat(existing.usage_amount) || 0) + (parseFloat(item.usage_amount) || 0);
    } else {
      mergedFabrics.push({ ...item, usage_amount: parseFloat(item.usage_amount) || 0 });
    }
  }

  clearRows(ws, 23, 35, [3, 4, 10, 11, 12]);
  mergedFabrics.slice(0, 13).forEach((item, i) => {
    const r = 23 + i;
    setVal(ws, r, 3, item.eng_name || item.fabric_name || '');
    setVal(ws, r, 4, item.fabric_name || '');
    const unitPriceUsd = r2((parseFloat(item.material_price_rmb) || 0) / 0.85 / 7.75 * 1.06);
    const usage = r2(item.usage_amount);
    setVal(ws, r, 10, unitPriceUsd);
    setVal(ws, r, 11, usage);
    ws.getCell(r, 11).numFmt = '0.0000';
    ws.getCell(r, 12).value = { formula: `J${r}*K${r}` };
  });

  // ── Others Cost (R60-R70): fill from otherItems ──────────────────────────────
  clearRows(ws, 60, 70, [3, 4, 10, 11, 12]);
  otherItems.slice(0, 11).forEach((item, i) => {
    const r = 60 + i;
    setVal(ws, r, 3, item.eng_name || item.fabric_name || '');
    setVal(ws, r, 4, item.fabric_name || '');
    const rmb = parseFloat(item.material_price_rmb) || 0;
    const unitPriceUsd = item.position === '__embroidery__'
      ? r2(rmb / 0.85 / 7.75)
      : r2(rmb / rmbUsdRate * 1.06);
    const usage = r2(parseFloat(item.usage_amount) || 0);
    setVal(ws, r, 10, unitPriceUsd);
    setVal(ws, r, 11, usage);
    ws.getCell(r, 11).numFmt = '0.0000';
    ws.getCell(r, 12).value = { formula: `J${r}*K${r}` };
  });

  // ── Packaging (R84-R97) ─────────────────────────────────────────────────────
  // H-tag → R86, CDU → R87, Master carton → R92 (price from productDim.carton_price)
  const hTagItem  = packagingItems.find(i => i.name && i.name.toLowerCase().includes('h-tag'));
  const cduItem   = packagingItems.find(i => i.name && i.name.toLowerCase().includes('cdu'));

  function writePkgRow(row, item, overrideUnitPrice) {
    const unitPriceRmb = overrideUnitPrice != null
      ? overrideUnitPrice
      : parseFloat(item.unit_price || item.new_price) || 0;
    setVal(ws, row, 4, (item && (item.eng_name || item.name)) || '');
    setVal(ws, row, 10, r2(unitPriceRmb / rmbUsdRate) || 0);
    setVal(ws, row, 11, parseFloat(item && item.quantity) || 1);
    // Col 12 (L) is formula — do not write
  }

  if (hTagItem) writePkgRow(86, hTagItem);
  if (cduItem)  writePkgRow(87, cduItem);

  // Master carton: price from ProductDimension.carton_price (not PackagingItem)
  if (productDim && productDim.carton_price != null) {
    const cartonPriceRmb = parseFloat(productDim.carton_price) || 0;
    const cartonUsdPrice = r2(cartonPriceRmb / rmbUsdRate) || 0;
    // Write desc placeholder and price; qty = 1 per carton
    setVal(ws, 92, 4, 'Master Carton');
    setVal(ws, 92, 10, cartonUsdPrice);
    setVal(ws, 92, 11, 1);
  }

  // ── Labor (R126-R130) ────────────────────────────────────────────────────────
  // Match by fabric_name: sewing→R126, packing→R128, cutting→R129, stuffing→R130
  function findLabor(keywords) {
    return laborItems.find(item => {
      const name = (item.fabric_name || '').toLowerCase();
      return keywords.some(k => name.includes(k));
    });
  }

  function writeLaborRow(row, item) {
    if (!item) return;
    const rateUsd = r2((parseFloat(item.material_price_rmb) || 0) / rmbUsdRate);
    setVal(ws, row, 10, rateUsd);
    setVal(ws, row, 11, parseFloat(item.usage_amount) || 0);
    // Col 12 (L) is formula — do not write
  }

  writeLaborRow(126, findLabor(['缝', 'sew']));
  writeLaborRow(128, findLabor(['包', 'pack']));
  writeLaborRow(129, findLabor(['剪', 'cut']));
  writeLaborRow(130, findLabor(['塞', 'stuff']));

  // ── In-Housed Molding (R10-R17): MoldPart rows ───────────────────────────────
  // Cols: C=3 desc, D=4 mold_no, F=6 cav/up, H=8 cavity, I=9 material,
  //       J=10 resin price USD/kg, K=11 weight_g, N=14 molding cost USD/pc
  clearRows(ws, 10, 17, [3, 4, 6, 8, 9, 10, 11, 14]);
  (moldParts || []).slice(0, 8).forEach((item, i) => {
    const r = 10 + i;
    setVal(ws, r, 3,  item.eng_name || item.description || '');
    setVal(ws, r, 4,  item.part_no || '');
    setVal(ws, r, 6,  item.cavity_count || null);
    setVal(ws, r, 8,  item.sets_per_toy || null);
    setVal(ws, r, 9,  item.material || '');
    // unit_price_hkd_g → USD/kg: (hkd/g * 1000) / hkd_usd
    const hkd_usd = parseFloat(params.hkd_usd) || 7.75;
    const resinUsdKg = r2((parseFloat(item.unit_price_hkd_g) || 0) * 1000 / hkd_usd);
    setVal(ws, r, 10, resinUsdKg);
    setVal(ws, r, 11, item.weight_g || null);
    // molding_labor HKD → USD
    const moldingCostUsd = r2((parseFloat(item.molding_labor) || 0) / hkd_usd);
    setVal(ws, r, 14, moldingCostUsd);
  });

  // ── Metal Parts Cost (R38-R45): HardwareItem where part_category != 'electronic' ─
  // Cols: C=3 eng name, J=10 unit price USD, K=11 quantity
  const metalItems = (d.hardwareItems || []).filter(
    h => !h.part_category || h.part_category.toLowerCase() !== 'electronic'
  );
  clearRows(ws, 38, 45, [3, 10, 11]);
  metalItems.slice(0, 8).forEach((item, i) => {
    const r = 38 + i;
    const hkd_usd = parseFloat(params.hkd_usd) || 7.75;
    setVal(ws, r, 3,  item.eng_name || item.name || '');
    setVal(ws, r, 10, r2((parseFloat(item.new_price) || 0) / hkd_usd));
    setVal(ws, r, 11, parseFloat(item.quantity) || 1);
  });

  // ── Electronic Parts Cost (R48-R57): ElectronicItem rows ─────────────────────
  // Cols: C=3 part name, D=4 spec, J=10 unit price USD, K=11 quantity
  clearRows(ws, 48, 57, [3, 4, 10, 11]);
  (electronicItems || []).slice(0, 10).forEach((item, i) => {
    const r = 48 + i;
    setVal(ws, r, 3,  item.eng_name || item.part_name || '');
    setVal(ws, r, 4,  item.spec || '');
    setVal(ws, r, 10, r2(parseFloat(item.unit_price_usd) || 0));
    setVal(ws, r, 11, parseFloat(item.quantity) || 1);
  });

  // ── Transportation (R162-R168): TransportConfig ───────────────────────────────
  // CHINA FCL  R162: C=20' qty, I=40' qty, L=12 USD/toy
  // HK FCL     R164: L=12 USD/toy (qty references R162 via formula)
  // CHINA LCL1 R166: I=40' qty threshold, L=12 USD/toy
  // CHINA LCL2 R167: I=40' qty threshold, L=12 USD/toy
  // CHINA LCL3 R168: I=40' qty threshold, L=12 USD/toy
  if (transportConfig && transportConfig.cuft_per_box) {
    const hkd_usd  = parseFloat(params.hkd_usd)  || 7.75;
    const pcsBox   = parseFloat(transportConfig.pcs_per_box)     || 1;
    const cuft     = parseFloat(transportConfig.cuft_per_box)    || 0;
    const c40cuft  = parseFloat(transportConfig.container_40_cuft) || 1980;
    const c20cuft  = parseFloat(transportConfig.container_20_cuft) || 883;

    // pcs per container
    const pcs40 = cuft > 0 ? Math.floor(c40cuft / cuft * pcsBox) : null;
    const pcs20 = cuft > 0 ? Math.floor(c20cuft / cuft * pcsBox) : null;

    // freight cost USD/toy = container_cost_hkd / pcs / hkd_usd
    const ytCost40  = parseFloat(transportConfig.yt_40_cost)  || 0;
    const hkCost40  = parseFloat(transportConfig.hk_40_cost)  || 0;
    const hk10cost  = parseFloat(transportConfig.hk_10t_cost) || 0;
    const yt10cost  = parseFloat(transportConfig.yt_10t_cost) || 0;
    const hk5cost   = parseFloat(transportConfig.hk_5t_cost)  || 0;
    const yt5cost   = parseFloat(transportConfig.yt_5t_cost)  || 0;

    const chinaFclUsd = pcs40 ? r2(ytCost40 / pcs40 / hkd_usd) : null;
    const hkFclUsd    = pcs40 ? r2(hkCost40 / pcs40 / hkd_usd) : null;

    // LCL thresholds and costs from transport rows (3-tier: 25%, 50%, 75%)
    // Use truck_10t for LCL1, truck_5t for LCL2, container_20 for LCL3
    const truck10cuft = parseFloat(transportConfig.truck_10t_cuft) || 1166;
    const truck5cuft  = parseFloat(transportConfig.truck_5t_cuft)  || 750;

    const pcsLcl1 = cuft > 0 ? Math.floor(truck10cuft * 0.25 / cuft * pcsBox) : null;
    const pcsLcl2 = cuft > 0 ? Math.floor(truck10cuft * 0.50 / cuft * pcsBox) : null;
    const pcsLcl3 = cuft > 0 ? Math.floor(truck10cuft * 0.75 / cuft * pcsBox) : null;

    const lcl1Usd = pcsLcl1 ? r2(yt10cost / pcsLcl1 / hkd_usd) : null;
    const lcl2Usd = pcsLcl2 ? r2(yt10cost / pcsLcl2 / hkd_usd) : null;
    const lcl3Usd = pcsLcl3 ? r2(yt10cost / pcsLcl3 / hkd_usd) : null;

    // CHINA FCL R162
    if (pcs20 != null) setVal(ws, 162, 3, pcs20);
    if (pcs40 != null) setVal(ws, 162, 9, pcs40);
    if (chinaFclUsd != null) setVal(ws, 162, 12, chinaFclUsd);

    // HK FCL R164
    if (hkFclUsd != null) setVal(ws, 164, 12, hkFclUsd);

    // CHINA LCL1 R166
    if (pcsLcl1 != null) setVal(ws, 166, 9, pcsLcl1);
    if (lcl1Usd  != null) setVal(ws, 166, 12, lcl1Usd);

    // CHINA LCL2 R167
    if (pcsLcl2 != null) setVal(ws, 167, 9, pcsLcl2);
    if (lcl2Usd  != null) setVal(ws, 167, 12, lcl2Usd);

    // CHINA LCL3 R168
    if (pcsLcl3 != null) setVal(ws, 168, 9, pcsLcl3);
    if (lcl3Usd  != null) setVal(ws, 168, 12, lcl3Usd);
  }

  // ── Markup (R135-R138): col 11 only — col 12 is formula ──────────────────────
  // R135 Material markup
  setVal(ws, 135, 11, parseFloat(params.markup_material || params.markup_body) || 0.15);
  // R137 Packaging markup
  setVal(ws, 137, 11, parseFloat(params.markup_packaging) || 0.10);
  // R138 Labor markup (hardcoded)
  setVal(ws, 138, 11, 0.15);
}

// ─── Fill Summary Sheet ───────────────────────────────────────────────────────

function fillSummary(ws, d, charKeys = []) {
  const { product, version } = d;

  setVal(ws, 4, 3, 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED');
  setVal(ws, 4, 14, 'Charles');
  setVal(ws, 5, 3, 'SPIN MASTER TOYS FAR EAST LTD');
  // MATERIAL NO — clear merged cells; REVISION — write from version
  for (const col of [3, 4, 5, 6]) ws.getCell(6, col).value = null;
  ws.getCell(6, 14).value = version ? (version.quote_rev || '') : '';
  setVal(ws, 8, 3, product ? (product.item_desc || '') : '');
  ws.getCell(8, 14).value = new Date(); // force overwrite regardless of formula
  // R12 first row
  setVal(ws, 12, 1, product ? (product.item_no || '') : '');
  setVal(ws, 12, 2, product ? (product.item_desc || '') : '');
  // Qty (per carton) = 6 only for rows that have character data
  const count = charKeys.length || 1;
  for (let i = 0; i < count; i++) setVal(ws, 12 + i, 3, 6);
}

// ─── Main Export Function ─────────────────────────────────────────────────────

async function exportSpinVersion(versionId) {
  const d = loadData(versionId);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  // Force Excel to recalculate all formulas on open
  wb.calcProperties = { fullCalcOnLoad: true };

  fixSharedFormulas(wb);

  // Fill Summary sheet
  const summaryWs = wb.getWorksheet('Summary');
  const charKeys = Object.keys(d.sewingByChar).filter(k => k !== '__default__');
  if (summaryWs) fillSummary(summaryWs, d, charKeys);

  // Fill each character sheet by matching eng_name; remove sheets with no data
  if (charKeys.length > 0) {
    // Remove all non-Summary sheets that have no data
    const sheetsToRemove = wb.worksheets
      .filter(ws => ws.name !== 'Summary' && !charKeys.includes(ws.name))
      .map(ws => ws.name);
    for (const name of sheetsToRemove) {
      wb.removeWorksheet(wb.getWorksheet(name).id);
    }
    // Fill each remaining sheet
    for (const charName of charKeys) {
      const charWs = wb.getWorksheet(charName);
      if (!charWs) continue;
      const rows = d.sewingByChar[charName];
      const charData = {
        ...d,
        charName: charName,
        fabricItems: rows.filter(r => r.position === '__fabric__'),
        otherItems:  rows.filter(r => r.position !== '__fabric__' && r.position !== '__labor__' && !(r.fabric_name || '').includes('人工')),
        laborItems:  rows.filter(r => r.position === '__labor__'),
      };
      fillCharacterSheet(charWs, charData);
    }
  } else {
    // Single-product: fill first non-Summary sheet, remove the rest
    const allCharSheets = wb.worksheets.filter(ws => ws.name !== 'Summary');
    const charWs = allCharSheets[0];
    if (charWs) fillCharacterSheet(charWs, d);
    for (let i = 1; i < allCharSheets.length; i++) {
      wb.removeWorksheet(allCharSheets[i].id);
    }
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { exportSpinVersion };
