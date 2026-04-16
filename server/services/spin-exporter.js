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
  return {
    version, product, params,
    fabricItems:    db.prepare("SELECT * FROM SewingDetail WHERE version_id = ? AND (position IS NULL OR position = '') ORDER BY sort_order").all(versionId),
    laborItems:     db.prepare("SELECT * FROM SewingDetail WHERE version_id = ? AND position = '__labor__' ORDER BY sort_order").all(versionId),
    packagingItems: db.prepare('SELECT * FROM PackagingItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    productDim:     db.prepare('SELECT * FROM ProductDimension WHERE version_id = ?').get(versionId) || {},
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Fill Character (款式) Sheet ──────────────────────────────────────────────

function fillCharacterSheet(ws, d) {
  const { version, product, params, fabricItems, laborItems, packagingItems, productDim } = d;

  // Exchange rate setup
  // rmb_hkd: 1 HKD = rmb_hkd RMB (~0.85)
  // hkd_usd: 1 USD = hkd_usd HKD (~7.75)
  // RMB → USD: rmb / rmb_hkd / hkd_usd
  const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;   // RMB per HKD
  const hkd_usd = parseFloat(params.hkd_usd) || 7.75;   // HKD per USD
  const rmbUsdRate = rmb_hkd * hkd_usd;                  // RMB per USD ≈ 6.6

  // ── Header ──────────────────────────────────────────────────────────────────
  setVal(ws, 3, 3, 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED');
  setVal(ws, 3, 14, version.prepared_by || '');
  setVal(ws, 4, 3, 'SPIN MASTER TOYS FAR EAST LTD');
  setVal(ws, 5, 3, product ? (product.item_no || '') : '');
  setVal(ws, 5, 14, new Date());
  setVal(ws, 7, 3, product ? `${product.item_no || ''} - ${product.item_desc || ''}` : '');

  // ── Fabric Cost (R23-R35): cols C=3 eng desc, D=4 cn desc, J=10 USD price, K=11 qty ──
  clearRows(ws, 23, 35, [3, 4, 10, 11]);
  fabricItems.slice(0, 13).forEach((item, i) => {
    const r = 23 + i;
    setVal(ws, r, 3, item.fabric_name || '');
    setVal(ws, r, 4, item.fabric_name || '');
    const unitPriceUsd = r2((parseFloat(item.material_price_rmb) || 0) / rmbUsdRate);
    setVal(ws, r, 10, unitPriceUsd);
    setVal(ws, r, 11, parseFloat(item.usage_amount) || 0);
    // Col 12 (L) is formula =J*K — do not write
  });

  // ── Others Cost (R60-R70): leave blank ──────────────────────────────────────
  clearRows(ws, 60, 70, [3, 4, 10, 11]);

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

  // ── Markup (R135-R138): col 11 only — col 12 is formula ──────────────────────
  // R135 Material markup
  setVal(ws, 135, 11, parseFloat(params.markup_material || params.markup_body) || 0.15);
  // R137 Packaging markup
  setVal(ws, 137, 11, parseFloat(params.markup_packaging) || 0.10);
  // R138 Labor markup (hardcoded)
  setVal(ws, 138, 11, 0.15);
}

// ─── Fill Summary Sheet ───────────────────────────────────────────────────────

function fillSummary(ws, d) {
  const { version, product } = d;

  setVal(ws, 4, 3, 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED');
  setVal(ws, 4, 14, version.prepared_by || '');
  setVal(ws, 5, 3, 'SPIN MASTER TOYS FAR EAST LTD');
  setVal(ws, 6, 3, product ? (product.item_no || '') : '');
  setVal(ws, 8, 3, product ? `${product.item_no || ''} - ${product.item_desc || ''}` : '');
  // R12 first row
  setVal(ws, 12, 1, product ? (product.item_no || '') : '');
  setVal(ws, 12, 2, product ? (product.item_desc || '') : '');
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
  if (summaryWs) fillSummary(summaryWs, d);

  // Fill first character (non-Summary) sheet
  const charWs = wb.worksheets.find(ws => ws.name !== 'Summary');
  if (charWs) fillCharacterSheet(charWs, d);

  return wb.xlsx.writeBuffer();
}

module.exports = { exportSpinVersion };
