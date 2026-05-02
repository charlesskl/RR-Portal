/**
 * SPIN Vendor Quote Form Export Service
 * Loads VQ-template-spin.xlsx and fills data from DB for Spin Master format.
 */
const ExcelJS = require('exceljs');
const path = require('path');
const { getDb } = require('./db');

// Patch ExcelJS to skip merge conflicts during duplicateRow/spliceRows
const _Worksheet = require('exceljs/lib/doc/worksheet');
const _origMerge = _Worksheet.prototype._mergeCellsInternal;
_Worksheet.prototype._mergeCellsInternal = function(...args) {
  try { return _origMerge.apply(this, args); } catch (_) {}
};

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
    spinTransport:  db.prepare('SELECT * FROM SpinTransportRow WHERE version_id = ? ORDER BY sort_order').all(versionId),
    refMaterials:   db.prepare('SELECT * FROM RefMaterialPrice ORDER BY sort_order').all(),
    refMachines:    db.prepare('SELECT * FROM RefMachineRate ORDER BY sort_order').all(),
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

/**
 * Manually shift rows down and fix formulas — avoids ExcelJS insertRow merge conflicts.
 * Copies all cells from rows [startRow..lastRow] to [startRow+shift..lastRow+shift],
 * clears the gap, and updates formula references.
 */
function shiftRowsDown(ws, startRow, shift) {
  if (!shift || shift <= 0) return;

  // 1. Find last used row
  let lastRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => { if (rowNum > lastRow) lastRow = rowNum; });

  // 2. Copy rows bottom-up to avoid overwrite (from lastRow down to startRow)
  for (let r = lastRow; r >= startRow; r--) {
    const srcRow = ws.getRow(r);
    const dstRow = ws.getRow(r + shift);
    // Copy row height
    if (srcRow.height) dstRow.height = srcRow.height;
    // Copy each cell
    srcRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const dst = dstRow.getCell(colNum);
      dst.value = cell.value;
      dst.style = cell.style;
    });
  }

  // 3. Clear the gap rows
  for (let r = startRow; r < startRow + shift; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: true }, (cell) => { cell.value = null; });
  }

  // 4. Fix merges: shift all merges at or after startRow
  const merges = ws._merges || {};
  const newMerges = {};
  for (const [key, val] of Object.entries(merges)) {
    const m = val?.model;
    if (!m) { newMerges[key] = val; continue; }
    if (m.top >= startRow) {
      const newTop = m.top + shift;
      const newBottom = m.bottom + shift;
      const newKey = key.replace(/\d+/, String(newTop));
      newMerges[newKey] = { model: { top: newTop, left: m.left, bottom: newBottom, right: m.right } };
    } else {
      newMerges[key] = val;
    }
  }
  ws._merges = newMerges;

  // 5. Fix formula references: all row numbers >= startRow shift by `shift`
  const re = /([A-Z]+)(\d+)/g;
  ws.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      const v = cell.value;
      if (!v || typeof v !== 'object') return;
      let formula = v.formula || v.sharedFormula;
      if (!formula) return;
      const newFormula = formula.replace(re, (match, col, rowStr) => {
        const rowNum = parseInt(rowStr, 10);
        if (rowNum >= startRow) return col + (rowNum + shift);
        return match;
      });
      if (newFormula !== formula) {
        cell.value = { formula: newFormula, result: v.result };
      }
    });
  });
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

  // Pre-process: fix shared formulas and clear merges for safe row manipulation
  ws.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      const v = cell.value;
      if (v && typeof v === 'object' && v.sharedFormula) {
        cell.value = { formula: v.sharedFormula, result: v.result };
      }
    });
  });
  ws._merges = {};

  // Exchange rate setup
  const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
  const hkd_usd = parseFloat(params.hkd_usd) || 7.75;
  const rmbUsdRate = rmb_hkd * hkd_usd;

  // ── Fabric Cost: merge & sort data ──────────────────────────────────────────
  const mergedFabrics = [];
  for (const item of fabricItems) {
    const name = item.fabric_name || '';
    const pn = item.product_name || '';
    const existing = mergedFabrics.find(m => m.fabric_name === name && (m.product_name || '') === pn);
    if (existing) {
      existing.usage_amount = (parseFloat(existing.usage_amount) || 0) + (parseFloat(item.usage_amount) || 0);
    } else {
      mergedFabrics.push({ ...item, usage_amount: parseFloat(item.usage_amount) || 0 });
    }
  }
  const productNames = [...new Set(fabricItems.map(d => d.product_name || '').filter(Boolean))];
  const showProductCol = productNames.length > 1;
  const sortedFabrics = showProductCol
    ? [...mergedFabrics].sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''))
    : mergedFabrics;

  // ── Others Cost: sort data ────────────────────────────────────────────────────
  const otherProductNames = [...new Set(otherItems.map(d => d.product_name || '').filter(Boolean))];
  const showOtherProductCol = otherProductNames.length > 1;
  const sortedOthers = showOtherProductCol
    ? [...otherItems].sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''))
    : otherItems;

  // ── Row expansion: Fabric Cost, Electronic, Others Cost ─────────────────────
  // Process bottom-up so earlier expansions don't invalidate later row numbers.
  // Each expansion uses duplicateRow + shiftFormulas, same pattern as Electronic.

  const FABRIC_SLOTS = 13;   // rows 23-35
  const FABRIC_START = 23;
  const fabricOverflow = Math.max(0, sortedFabrics.length - FABRIC_SLOTS);

  const elecList = electronicItems || [];
  const ELEC_SLOTS = 10;
  const ELEC_START = 48;
  const elecOverflow = Math.max(0, elecList.length - ELEC_SLOTS);

  // Others Cost: find header row first (before any expansion)
  let othersHeaderRow = 60;
  for (let r = 55; r <= 80; r++) {
    const c = ws.getCell(r, 3).value;
    if (c && /Others Cost/i.test(String(c))) { othersHeaderRow = r; break; }
  }
  const OTHERS_SLOTS = 11;
  const othersOverflow = Math.max(0, sortedOthers.length - OTHERS_SLOTS);

  // Helper: duplicate rows and shift formulas with range awareness.
  // Three cases handled per formula reference:
  //   (a) Range END equals lastSlotRow      → grow end (subtotal SUM picks up overflow rows)
  //   (b) Row reference >= threshold         → shift by overflow (rows physically moved down)
  //   (c) Row reference  < threshold (and != lastSlotRow as range end) → unchanged
  function expandSection(startRow, slots, overflow) {
    if (overflow <= 0) return;
    const lastSlotRow = startRow + slots - 1;   // template's last data slot before duplication
    const threshold   = startRow + slots;        // first row PHYSICALLY shifted by duplicateRow
    ws.duplicateRow(lastSlotRow, overflow, true);

    // Range pattern: A23:A35, $A$23:$A$35 — capture column+row pairs
    const rangeRe = /(\$?[A-Z]+\$?)(\d+):(\$?[A-Z]+\$?)(\d+)/g;
    const cellRe  = /(\$?[A-Z]+\$?)(\d+)/g;
    // Placeholder uses control chars only (no [A-Z]) so cellRe cannot match it
    const placeholder = i => `\x01\x02${i}\x02\x01`;
    const placeholderRe = /\x01\x02(\d+)\x02\x01/g;

    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value;
        if (!v || typeof v !== 'object' || !v.formula) return;

        // Step 1: replace ranges with placeholders carrying the rewritten ref,
        // so the single-cell pass below doesn't double-shift their endpoints.
        const ranges = [];
        let f = v.formula.replace(rangeRe, (_m, c1, r1, c2, r2) => {
          const rn1 = parseInt(r1, 10);
          const rn2 = parseInt(r2, 10);
          const new1 = rn1 >= threshold ? rn1 + overflow : rn1;
          let   new2;
          if (rn2 === lastSlotRow)   new2 = rn2 + overflow;   // grow end (case a)
          else if (rn2 >= threshold) new2 = rn2 + overflow;   // shift end (case b)
          else                       new2 = rn2;              // unchanged (case c)
          ranges.push(`${c1}${new1}:${c2}${new2}`);
          return placeholder(ranges.length - 1);
        });

        // Step 2: shift remaining single-cell refs (those outside any range)
        f = f.replace(cellRe, (m, col, rowStr) => {
          const rn = parseInt(rowStr, 10);
          return rn >= threshold ? col + (rn + overflow) : m;
        });

        // Step 3: restore ranges
        f = f.replace(placeholderRe, (_, idx) => ranges[parseInt(idx, 10)]);

        if (f !== v.formula) cell.value = { formula: f, result: v.result };
      });
    });
  }

  // Expand bottom-up: Others → Electronic → Fabric
  expandSection(othersHeaderRow + 1, OTHERS_SLOTS, othersOverflow);
  expandSection(ELEC_START, ELEC_SLOTS, elecOverflow);
  expandSection(FABRIC_START, FABRIC_SLOTS, fabricOverflow);

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

  // ── Fabric Cost (R23+): cols C=3 eng desc, D=4 cn desc, J=10 USD price, K=11 qty ──
  const fabricEndRow = FABRIC_START + Math.max(FABRIC_SLOTS, sortedFabrics.length) - 1;
  clearRows(ws, FABRIC_START, fabricEndRow, [3, 4, 5, 10, 11, 12]);
  sortedFabrics.forEach((item, i) => {
    const r = 23 + i;
    const engName = item.eng_name || '';
    const cnName = item.fabric_name || '';
    setVal(ws, r, 3, engName || cnName);
    setVal(ws, r, 4, engName ? cnName : '');
    if (showProductCol) setVal(ws, r, 5, item.product_name || '');
    const unitPriceUsd = r2((parseFloat(item.material_price_rmb) || 0) / 0.85 / 7.75 * 1.06);
    const usage = r2(item.usage_amount);
    setVal(ws, r, 10, unitPriceUsd);
    ws.getCell(r, 10).numFmt = '0.0000';
    ws.getCell(r, 10).alignment = { horizontal: 'right' };
    setVal(ws, r, 11, usage);
    ws.getCell(r, 11).numFmt = '0.0000';
    ws.getCell(r, 11).alignment = { horizontal: 'right' };
    ws.getCell(r, 12).value = { formula: `J${r}*K${r}` };
    ws.getCell(r, 12).numFmt = '0.0000';
    ws.getCell(r, 12).alignment = { horizontal: 'right' };
  });

  // ── Others Cost: find dynamically (post-expansion) ─────────────────────────
  let othersRow = 60;
  for (let r = 55; r <= 100; r++) {
    const c = ws.getCell(r, 3).value;
    if (c && /Others Cost/i.test(String(c))) { othersRow = r + 1; break; }
  }
  const othersEndRow = othersRow + Math.max(OTHERS_SLOTS, sortedOthers.length) - 1;
  clearRows(ws, othersRow, othersEndRow, [3, 4, 10, 11, 12]);
  sortedOthers.forEach((item, i) => {
    const r = othersRow + i;
    const oEngName = item.eng_name || '';
    const oCnName = item.fabric_name || '';
    setVal(ws, r, 3, oEngName || oCnName);
    setVal(ws, r, 4, oEngName ? oCnName : '');
    if (showOtherProductCol) setVal(ws, r, 5, item.product_name || '');
    const rmb = parseFloat(item.material_price_rmb) || 0;
    const unitPriceUsd = item.position === '__embroidery__'
      ? r2(rmb / 0.85 / 7.75)
      : r2(rmb / rmbUsdRate * 1.06);
    const usage = r2(parseFloat(item.usage_amount) || 0);
    setVal(ws, r, 10, unitPriceUsd);
    ws.getCell(r, 10).numFmt = '0.0000';
    ws.getCell(r, 10).alignment = { horizontal: 'right' };
    setVal(ws, r, 11, usage);
    ws.getCell(r, 11).numFmt = '0.0000';
    ws.getCell(r, 11).alignment = { horizontal: 'right' };
    ws.getCell(r, 12).value = { formula: `J${r}*K${r}` };
    ws.getCell(r, 12).numFmt = '0.0000';
    ws.getCell(r, 12).alignment = { horizontal: 'right' };
  });

  // ── Packaging: find dynamically ──────────────────────────────────────────────
  const retailPkgs = packagingItems.filter(p => p.pkg_section === 'retail');
  const cartonPkgs = packagingItems.filter(p => p.pkg_section === 'carton');

  let retailRow = 86, masterRow = 92;
  for (let r = 80; r <= 130; r++) {
    const c = ws.getCell(r, 3).value;
    if (c && /^Retail box$/i.test(String(c).trim())) retailRow = r + 1;
    if (c && /^Master carton$/i.test(String(c).trim())) masterRow = r + 1;
  }
  // Clear packaging data rows (description + price cols), preserve section headers
  for (let r = retailRow; r <= retailRow + 4; r++) {
    for (const c of [3, 4, 5, 6, 7, 8, 9, 10, 11]) ws.getCell(r, c).value = null;
    const lc = ws.getCell(r, 12); delete lc._sharedFormula; lc.value = null;
  }
  // Also clear the row BEFORE masterRow (template may have data there after duplicateRow)
  for (let r = masterRow - 1; r <= masterRow + 4; r++) {
    // Only clear data rows, not the "Master carton" header itself
    const c3 = ws.getCell(r, 3).value;
    if (c3 && /Master carton$/i.test(String(c3).trim())) continue; // skip header
    for (const c of [3, 4, 5, 6, 7, 8, 9, 10, 11]) ws.getCell(r, c).value = null;
    const lc = ws.getCell(r, 12); delete lc._sharedFormula; lc.value = null;
  }

  function writePkgItems(items, startRow, maxSlots) {
    items.slice(0, maxSlots).forEach((item, i) => {
      const r = startRow + i;
      ws.getCell(r, 3).value = item.eng_name || item.name || '';
      ws.getCell(r, 4).value = (item.eng_name && item.eng_name !== item.name) ? (item.name || '') : '';
      const price = r2(parseFloat(item.new_price) || 0);
      const qty = parseFloat(item.quantity) || 1;
      ws.getCell(r, 10).value = price;
      ws.getCell(r, 10).numFmt = '0.0000';
      ws.getCell(r, 11).value = qty;
      ws.getCell(r, 11).numFmt = '0.00';
      const lCell = ws.getCell(r, 12);
      delete lCell._sharedFormula;
      lCell.value = { formula: `J${r}*K${r}`, result: r2(price * qty) };
      lCell.numFmt = '0.0000';
    });
  }
  writePkgItems(retailPkgs, retailRow, 5);
  writePkgItems(cartonPkgs, masterRow, 5);

  // ── Labor Misc (R123-R130+S) ─────────────────────────────────────────────────
  // SewingDetail __labor__: 裁床→Cutting(R129), 车缝→Sewing(R126), 手工→Stuffing(R130), 半成品→Packing(R128)
  function findLabor(keywords) {
    return laborItems.find(item => {
      const name = (item.fabric_name || '').toLowerCase();
      return keywords.some(k => name.includes(k));
    });
  }

  function writeLaborRow(row, rateUsd, hours) {
    if (!rateUsd && !hours) return;
    // Force write (bypass setVal's formula guard)
    ws.getCell(row, 10).value = r2(rateUsd) || 0;
    ws.getCell(row, 10).numFmt = '0.0000';
    ws.getCell(row, 10).alignment = { horizontal: 'right' };
    ws.getCell(row, 11).value = r2(hours) || 0;
    ws.getCell(row, 11).numFmt = '0.0000';
    ws.getCell(row, 11).alignment = { horizontal: 'right' };
    // Write L col formula
    const lCell = ws.getCell(row, 12);
    delete lCell._sharedFormula;
    lCell.value = { formula: `J${row}*K${row}`, result: r2((r2(rateUsd)||0) * (r2(hours)||0)) };
    lCell.numFmt = '0.0000';
    lCell.alignment = { horizontal: 'right' };
  }

  // Fixed labor rate from params: labor_hkd / 11hr / hkd_usd (e.g. 275/11/7.75 = 3.226)
  const laborHkd = parseFloat(params.labor_hkd) || 0;
  const laborRate = laborHkd ? Math.round(laborHkd / 11 / hkd_usd * 1000) / 1000 : 3.226;
  const sewLabor = findLabor(['车缝', 'sew']);
  const cutLabor = findLabor(['裁床', 'cut']);
  const stuffLabor = findLabor(['手工', 'stuff']);
  const packLabor = findLabor(['包', 'pack', '半成品']);

  // Electronics Assembly (R124): from ElectronicSummary total labor cost
  const db2 = getDb();
  const elecSummary = db2.prepare('SELECT * FROM ElectronicSummary WHERE version_id = ?').get(d.version.id);
  if (elecSummary) {
    const elecLaborTotal = (parseFloat(elecSummary.smt_cost) || 0) +
      (parseFloat(elecSummary.labor_cost) || 0) +
      (parseFloat(elecSummary.test_cost) || 0) +
      (parseFloat(elecSummary.packaging_transport) || 0);
    const elecLaborUsd = r2(elecLaborTotal / rmb_hkd / hkd_usd * 1.06 * 1.1);
    if (elecLaborUsd) {
      const elecHrs = laborRate ? r2(elecLaborUsd / laborRate) : 0;
      // Find Electronics Assembly row dynamically
      let elecAssyRow = 124;
      for (let r = 120; r <= 170; r++) {
        const c = ws.getCell(r, 3).value;
        if (c && /Electronics Assembly/i.test(String(c))) { elecAssyRow = r; break; }
      }
      writeLaborRow(elecAssyRow, laborRate, elecHrs);
    }
  }

  // Find Sewing row dynamically
  let sewingRow = 126;
  for (let r = 120; r <= 170; r++) {
    const c = ws.getCell(r, 3).value;
    if (c && /^Sewing$/i.test(String(c).trim())) { sewingRow = r; break; }
  }
  // Standard Hour = price_rmb / rmb_hkd / hkd_usd / laborRate
  function laborHrs(item) {
    const usdPerToy = (parseFloat(item.price_rmb) || 0) / rmb_hkd / hkd_usd;
    return laborRate > 0 ? r2(usdPerToy / laborRate) : 0;
  }
  if (sewLabor)   writeLaborRow(sewingRow, laborRate, laborHrs(sewLabor));
  if (cutLabor)   writeLaborRow(sewingRow + 3, laborRate, laborHrs(cutLabor));
  if (stuffLabor) writeLaborRow(sewingRow + 4, laborRate, laborHrs(stuffLabor));

  // Packing (R128): sum of Packing Labor items (半成品人工, 包装人工, 查货) from HardwareItem
  const PACKING_RE = /半成品人工|包装人工|查货/;
  const packingItems = (d.hardwareItems || []).filter(h =>
    h.part_category === 'labor_assembly' && PACKING_RE.test(h.name || '')
  );
  if (packingItems.length) {
    const packingTotalUsd = packingItems.reduce((s, h) => s + (parseFloat(h.new_price) || 0) / hkd_usd, 0);
    // Write total as standard_hour = total_usd / rate
    const packHrs = laborRate ? r2(packingTotalUsd / laborRate) : 0;
    writeLaborRow(sewingRow + 2, laborRate, packHrs);
  }

  // ── In-Housed Molding (R10-R17): MoldPart rows ───────────────────────────────
  // Cols: C=3 desc, D=4 mold_no, E=5 part_no, F=6 cavity, G=7 sets,
  //       I=9 material, J=10 resin(USD/kg), K=11 weight_g, L=12 US$/toy,
  //       N=14 molding cost(USD/pc), O=15 cycle(sec), P=16 tonnage, Q=17 labour rate
  clearRows(ws, 10, 17, [3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17]);

  // 参考表辅助函数
  const HKD_USD = 7.75, LB_G = 454;
  function findMatRef(matName) {
    if (!matName) return null;
    const t = matName.trim().toUpperCase();
    return (d.refMaterials || []).find(m => m.material_name && m.material_name.trim().toUpperCase() === t) || null;
  }
  function findMachRef(machType) {
    if (!machType) return null;
    const t = (machType + '').trim().toUpperCase();
    let found = (d.refMachines || []).find(m => m.tonnage && m.tonnage.trim().toUpperCase() === t);
    if (found) return found;
    found = (d.refMachines || []).find(m => m.machine_type && m.machine_type.trim().toUpperCase() === t);
    if (found) return found;
    const aMatch = t.match(/^(\d+)A$/);
    if (aMatch) {
      const n = parseInt(aMatch[1]);
      found = (d.refMachines || []).find(m => {
        const parts = (m.machine_type || '').toUpperCase().split('-');
        const lo = parseInt(parts[0]); const hi = parseInt((parts[1] || '').replace(/A$/, '') || parts[0]);
        return !isNaN(lo) && !isNaN(hi) && n >= lo && n <= hi;
      });
    }
    return found || null;
  }

  (moldParts || []).slice(0, 8).forEach((item, i) => {
    const r = 10 + i;
    setVal(ws, r, 3,  item.eng_name && item.description ? `${item.eng_name} ${item.description}` : (item.description || ''));
    // 重置描述列字体颜色（模板可能有红色字体）
    const descCell = ws.getCell(r, 3);
    if (descCell.font) descCell.font = { ...descCell.font, color: { argb: 'FF000000' } };
    setVal(ws, r, 4,  item.mold_no || '');
    setVal(ws, r, 5,  item.part_no || '');
    setVal(ws, r, 6,  item.cavity_count || null);
    setVal(ws, r, 7,  item.sets_per_toy || null);
    setVal(ws, r, 9,  item.material || '');

    // 料价：优先用 resin_price_usd_kg，为 0 则查参考表
    let resin = parseFloat(item.resin_price_usd_kg) || 0;
    if (!resin) {
      const matRef = findMatRef(item.material);
      if (matRef) resin = parseFloat(matRef.client_spin_usd_kg) || parseFloat(matRef.spin_usd_kg) || 0;
    }
    setVal(ws, r, 10, resin || null);

    const wt = parseFloat(item.weight_g) || 0;
    setVal(ws, r, 11, wt || null);

    // US$ per toy = resin × weight / 1000
    const usdToy = resin && wt ? r2(resin * wt / 1000) : null;
    setVal(ws, r, 12, usdToy);

    // 机台参考
    const machRef = findMachRef(item.machine_type);
    const cycle   = parseFloat(item.cycle_time_sec) || 0;
    const sets    = parseFloat(item.sets_per_toy) || 1;
    const rate    = machRef ? (parseFloat(machRef.rate_rmb_24h) || 0) : 0;

    // Molding Cost = 费率 × 周期 ÷ 3600 ÷ 套数
    const moldCost = (rate && cycle) ? r2(rate * cycle / 3600 / sets) : (parseFloat(item.molding_cost_usd) || null);
    setVal(ws, r, 14, moldCost);
    setVal(ws, r, 15, cycle || null);
    setVal(ws, r, 16, machRef ? (machRef.tonnage || item.machine_type || null) : (item.machine_type || null));
    setVal(ws, r, 17, rate || null);
  });

  // ── Metal Parts Cost (R38-R45): HardwareItem where part_category != 'electronic' ─
  // Cols: C=3 eng name, J=10 unit price USD, K=11 quantity
  const metalItems = (d.hardwareItems || []).filter(
    h => !h.part_category || !['electronic', 'labor_assembly'].includes(h.part_category.toLowerCase())
  );
  // Metal: clear all data + L col formulas (shifted by fabric expansion)
  const metalStart = 38 + fabricOverflow;
  clearRows(ws, metalStart, metalStart + 7, [3, 4, 10, 11]);
  for (let r = metalStart; r <= metalStart + 7; r++) { const c = ws.getCell(r, 12); delete c._sharedFormula; c.value = null; }
  metalItems.slice(0, 8).forEach((item, i) => {
    const r = metalStart + i;
    ws.getCell(r, 3).value = item.eng_name || item.name || '';
    ws.getCell(r, 4).value = item.eng_name ? (item.name || '') : '';
    const unitUsd = r2((parseFloat(item.new_price) || 0) / rmb_hkd / hkd_usd * 1.06);
    const qty = parseFloat(item.quantity) || 1;
    setVal(ws, r, 10, unitUsd);
    ws.getCell(r, 10).numFmt = '0.0000';
    ws.getCell(r, 10).alignment = { horizontal: 'right' };
    setVal(ws, r, 11, qty);
    ws.getCell(r, 11).numFmt = '0.00';
    ws.getCell(r, 11).alignment = { horizontal: 'right' };
    const mCell = ws.getCell(r, 12);
    delete mCell._sharedFormula;
    mCell.value = { formula: `J${r}*K${r}`, result: r2(unitUsd * qty) };
    mCell.numFmt = '0.0000';
    mCell.alignment = { horizontal: 'right' };
  });

  // ── Electronic Parts Cost (post-expansion) ──────────────────────────────────
  const elecStart = ELEC_START + fabricOverflow;
  clearRows(ws, elecStart, elecStart + Math.max(ELEC_SLOTS, elecList.length) - 1, [3, 4, 10, 11]);
  elecList.forEach((item, i) => {
    const r = elecStart + i;
    setVal(ws, r, 3,  item.eng_name || item.part_name || '');
    setVal(ws, r, 4,  item.part_name || item.spec || '');
    const unitUsd = r2(parseFloat(item.unit_price_usd) || 0);
    const qty = parseFloat(item.quantity) || 1;
    setVal(ws, r, 10, unitUsd);
    ws.getCell(r, 10).numFmt = '0.0000';
    ws.getCell(r, 10).alignment = { horizontal: 'right' };
    setVal(ws, r, 11, qty);
    ws.getCell(r, 11).numFmt = '0.00';
    ws.getCell(r, 11).alignment = { horizontal: 'right' };
    const eCell = ws.getCell(r, 12);
    delete eCell._sharedFormula;
    eCell.value = { formula: `J${r}*K${r}`, result: r2(unitUsd * qty) };
    eCell.numFmt = '0.0000';
    eCell.alignment = { horizontal: 'right' };
  });

  // ── Transportation (R162-R176+S): from SpinTransportRow ──────────────────────
  // Match UI data: 盐田40HQ→CHINA FCL(R166), 盐田20HQ→20' qty, HK柜货→HK FCL(R168)
  // 盐田散货 3/5/8吨 → CHINA LCL 1/2/3 (R170-R172)
  const spinTr = d.spinTransport || [];
  // Find actual CHINA FCL row dynamically (in case of row shifts)
  let fclRow = 162;
  for (let r = 160; r <= 230; r++) {
    const b = ws.getCell(r, 2).value;
    if (b && /CHINA FCL/i.test(String(b))) { fclRow = r; break; }
  }
  const trRows = {
    'CHINA FCL':  fclRow,
    'HK FCL':    fclRow + 2,
    'CHINA LCL1': fclRow + 4,
    'CHINA LCL2': fclRow + 5,
    'CHINA LCL3': fclRow + 6,
  };

  function writeTransportRow(row, tr) {
    if (tr.qty_20) { ws.getCell(row, 3).value = tr.qty_20; ws.getCell(row, 4).value = 'pcs'; }
    if (tr.qty_40) { ws.getCell(row, 9).value = tr.qty_40; ws.getCell(row, 10).value = 'pcs'; }
    if (tr.usd_per_toy) ws.getCell(row, 12).value = tr.usd_per_toy;
  }

  for (const tr of spinTr) {
    const desc = tr.description || '';
    if (/盐田.*40/i.test(desc)) {
      writeTransportRow(trRows['CHINA FCL'], tr);
    } else if (/盐田.*20/i.test(desc)) {
      // 20' qty also goes to CHINA FCL row col C, and HK FCL row col C
      if (tr.qty_20) {
        ws.getCell(trRows['CHINA FCL'], 3).value = tr.qty_20;
        ws.getCell(trRows['CHINA FCL'], 4).value = 'pcs';
        ws.getCell(trRows['HK FCL'], 3).value = tr.qty_20;
        ws.getCell(trRows['HK FCL'], 4).value = 'pcs';
      }
    } else if (/HK.*40/i.test(desc)) {
      writeTransportRow(trRows['HK FCL'], tr);
    } else if (/HK.*20/i.test(desc)) {
      // HK 20HQ price — no separate row in template
    } else if (/散货.*3吨|LCL.*1/i.test(desc)) {
      if (tr.qty_40) ws.getCell(trRows['CHINA LCL1'], 9).value = tr.qty_40;
      if (tr.usd_per_toy) ws.getCell(trRows['CHINA LCL1'], 12).value = tr.usd_per_toy;
    } else if (/散货.*5吨|LCL.*2/i.test(desc)) {
      if (tr.qty_40) ws.getCell(trRows['CHINA LCL2'], 9).value = tr.qty_40;
      if (tr.usd_per_toy) ws.getCell(trRows['CHINA LCL2'], 12).value = tr.usd_per_toy;
    } else if (/散货.*8吨|LCL.*3/i.test(desc)) {
      if (tr.qty_40) ws.getCell(trRows['CHINA LCL3'], 9).value = tr.qty_40;
      if (tr.usd_per_toy) ws.getCell(trRows['CHINA LCL3'], 12).value = tr.usd_per_toy;
    }
  }

  // ── Markup: find dynamically ──────────────────────────────────────────────────
  let markupRow = 135;
  for (let r = 130; r <= 190; r++) {
    const b = ws.getCell(r, 2).value;
    if (b && /Material.*EXCLUDING/i.test(String(b))) { markupRow = r; break; }
  }
  setVal(ws, markupRow, 11, parseFloat(params.markup_material || params.markup_body) || 0.15);
  setVal(ws, markupRow + 2, 11, parseFloat(params.markup_packaging) || 0.10);
  setVal(ws, markupRow + 3, 11, parseFloat(params.markup_labor) || 0.15);

  // ── Misc Cost: find "testing fee" row and write/clear ──────────────────────────
  let testingRow = 0;
  for (let r = markupRow + 10; r <= markupRow + 30; r++) {
    const b = ws.getCell(r, 2).value;
    if (b && /testing/i.test(String(b))) { testingRow = r; break; }
  }
  const testingFee = parseFloat(params.testing_fee_usd) || 0;
  if (testingRow) {
    ws.getCell(testingRow, 10).value = testingFee ? r2(testingFee) : 0;
    ws.getCell(testingRow, 10).numFmt = '0.0000';
    ws.getCell(testingRow, 11).value = testingFee ? 1 : 0;
    ws.getCell(testingRow, 11).numFmt = '0.00';
    const lCell = ws.getCell(testingRow, 12);
    delete lCell._sharedFormula;
    lCell.value = { formula: `J${testingRow}*K${testingRow}`, result: testingFee ? r2(testingFee) : 0 };
    lCell.numFmt = '0.0000';
  }
}

// ─── Fill Summary Sheet ───────────────────────────────────────────────────────

function fillSummary(ws, d, charKeys = []) {
  const { product, version, productDim } = d;

  setVal(ws, 4, 3, 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED');
  setVal(ws, 4, 14, 'Charles');
  setVal(ws, 5, 3, 'SPIN MASTER TOYS FAR EAST LTD');
  // MATERIAL NO — leave empty
  for (const col of [3, 4, 5, 6]) ws.getCell(6, col).value = null;
  ws.getCell(6, 14).value = version ? (version.quote_rev || '') : '';
  setVal(ws, 8, 3, product ? (product.item_desc || '') : '');
  ws.getCell(8, 14).value = new Date(); // force overwrite regardless of formula
  // R12+ data rows — one per character, clear unused
  const count = charKeys.length || 1;
  for (let i = 0; i < 7; i++) {
    const r = 12 + i;
    if (i < count) {
      ws.getCell(r, 1).value = null; // Clear A12 formula =C6
      ws.getCell(r, 5).value = 6; // Qty per carton
    } else {
      // Clear unused rows completely (including formulas)
      for (let c = 1; c <= 14; c++) {
        const cell = ws.getCell(r, c);
        delete cell._sharedFormula;
        cell.value = null;
      }
    }
  }

  // ── Carton Dimensions (R45 pcs/carton, R48-R52 L/W/H/CFT) ─────────────────
  if (productDim) {
    if (productDim.pcs_per_carton) ws.getCell(45, 5).value = productDim.pcs_per_carton;
    if (productDim.carton_l_inch) ws.getCell(48, 2).value = Math.round(productDim.carton_l_inch * 100) / 100;
    if (productDim.carton_w_inch) ws.getCell(49, 2).value = Math.round(productDim.carton_w_inch * 100) / 100;
    if (productDim.carton_h_inch) ws.getCell(50, 2).value = Math.round(productDim.carton_h_inch * 100) / 100;
    if (productDim.carton_cuft) ws.getCell(52, 2).value = Math.round(productDim.carton_cuft * 100) / 100;
    // Fix cm formulas (shared formula expansion issue)
    ws.getCell(48, 5).value = { formula: 'B48*2.54' };
    ws.getCell(49, 5).value = { formula: 'B49*2.54' };
    ws.getCell(50, 5).value = { formula: 'B50*2.54' };
    ws.getCell(52, 5).value = { formula: '(E48*E49*E50)/1000000' };
  }
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

  // Fill each character sheet
  const templateCharSheets = wb.worksheets.filter(ws => ws.name !== 'Summary');

  if (charKeys.length > 0) {
    // Match charKeys to template sheets by index; reuse template sheets in order
    for (let i = 0; i < charKeys.length; i++) {
      const charName = charKeys[i];
      const rows = d.sewingByChar[charName];
      const charData = {
        ...d,
        charName: charName,
        fabricItems: rows.filter(r => r.position === '__fabric__'),
        otherItems:  rows.filter(r => r.position !== '__fabric__' && r.position !== '__labor__' && !(r.fabric_name || '').includes('人工')),
        laborItems:  rows.filter(r => r.position === '__labor__'),
      };
      // Try exact name match first, then fall back to template sheet by index
      let charWs = wb.getWorksheet(charName);
      if (!charWs) charWs = templateCharSheets[i];
      if (!charWs) continue;
      charWs.name = charName;
      fillCharacterSheet(charWs, charData);
    }
    // Remove unused template sheets (those beyond the number of charKeys)
    for (let i = charKeys.length; i < templateCharSheets.length; i++) {
      wb.removeWorksheet(templateCharSheets[i].id);
    }
  } else {
    // Single-product: fill first non-Summary sheet, remove the rest
    const charWs = templateCharSheets[0];
    if (charWs) fillCharacterSheet(charWs, d);
    for (let i = 1; i < templateCharSheets.length; i++) {
      wb.removeWorksheet(templateCharSheets[i].id);
    }
  }

  // Fix Summary formulas: replace old sheet names and update row offsets
  if (summaryWs) {
    const actualSheets = wb.worksheets.filter(ws => ws.name !== 'Summary');
    const oldNames = ['Rocky', 'Skye', 'Marshall', 'Rex', 'Chase', 'Rubble'];

    // Find row offset in first character sheet by locating Ex-Factory row
    let rowShift = 0;
    if (actualSheets.length > 0) {
      const cs = actualSheets[0];
      for (let r = 175; r <= 240; r++) {
        const a = cs.getCell(r, 1).value;
        if (a && /Ex-Factory/i.test(String(a))) {
          rowShift = r - 179; // template Ex-Factory is at R179
          break;
        }
      }
    }

    const re = /([A-Z]+)(\d+)/g;
    summaryWs.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value;
        if (!v || typeof v !== 'object' || !v.formula) return;
        let f = v.formula;
        // Replace old sheet names
        for (let i = 0; i < oldNames.length; i++) {
          const newName = actualSheets[i]?.name || actualSheets[0]?.name || 'Sheet1';
          f = f.replace(new RegExp("'" + oldNames[i] + "'!", 'g'), "'" + newName + "'!");
          f = f.replace(new RegExp(oldNames[i] + '!', 'g'), "'" + newName + "'!");
        }
        // Update row numbers in cross-sheet references (rows >= 58 shift by rowShift)
        if (rowShift && f.includes('!')) {
          f = f.replace(/!([A-Z]+)(\d+)/g, (match, col, rowStr) => {
            const rn = parseInt(rowStr, 10);
            return rn >= 58 ? '!' + col + (rn + rowShift) : match;
          });
        }
        if (f !== v.formula) {
          cell.value = { formula: f, result: v.result };
        }
      });
    });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { exportSpinVersion };
