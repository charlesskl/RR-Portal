/**
 * SPIN Vendor Quote Form Export Service
 * Loads VQ-template-spin.xlsx and fills data from DB for Spin Master format.
 */
const ExcelJS = require('exceljs');
const { buildSpinTransportRows } = require('./spinTransport');
const { readTemplateParts } = require('./templateParts');
const { customerEnglish } = require('./vqEnglish');

const SPIN_MACHINE_HOURS = 22;
const SPIN_HKD_USD = 7.75;
const SPIN_UTILIZATION = 0.97;
const SPIN_MACHINE_PRICES = [
  { machine_type: '4A-6A', tonnage: '80T', price_24h_hkd: 1040, target_qty: 4500 },
  { machine_type: '7A-9A', tonnage: '60-80T', price_24h_hkd: 1160, target_qty: 4400 },
  { machine_type: '10A-12A', tonnage: '120T', price_24h_hkd: 1280, target_qty: 4000 },
  { machine_type: '14A-16A', tonnage: '150T', price_24h_hkd: 1650, target_qty: 4000 },
  { machine_type: '20A', tonnage: '200T', price_24h_hkd: 1890, target_qty: 3800 },
  { machine_type: '24A', tonnage: '260T', price_24h_hkd: 2130, target_qty: 3400 },
  { machine_type: '30-32A', tonnage: '320T', price_24h_hkd: 2460, target_qty: 2200 },
  { machine_type: '44A', tonnage: '490T', price_24h_hkd: 2700, target_qty: 2000 },
  { machine_type: '60A-65A', tonnage: '500T', price_24h_hkd: 3430, target_qty: 1600 },
  { machine_type: '105A', tonnage: '800T', price_24h_hkd: 5000, target_qty: 1600 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r2(v) {
  const n = parseFloat(v);
  return (n == null || isNaN(n)) ? null : Math.round(n * 10000) / 10000;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseSections(sections) {
  const payloads = {};
  for (const section of sections || []) {
    try {
      payloads[section.dept] = JSON.parse(section.payload_json || '{}');
    } catch (_) {
      payloads[section.dept] = {};
    }
  }
  return payloads;
}

function safeSheetName(value, fallback) {
  const cleaned = String(value || fallback || 'Product')
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim();
  return (cleaned || fallback || 'Product').slice(0, 31);
}

function sectionsToSpinData({ quote, sections }) {
  const payloads = parseSections(sections);
  const sales = payloads.sales || {};
  const sewing = payloads.sewing || {};
  const engineering = payloads.engineering || {};
  const molding = payloads.molding || {};
  const electronic = payloads.electronic || {};
  const assembly = payloads.assembly || {};

  const header = sales.header || {};
  const pricing = sales.pricing || {};
  const rmbHkd = num(header.fx_rmb_hkd) || 0.85;
  const hkdUsd = SPIN_HKD_USD;
  const laborHkd = num(assembly.assembly_base_rate) || 275;

  const sewingByChar = {};
  const allSewing = [];
  for (const [groupIndex, group] of (sewing.sewing_groups || []).entries()) {
    const charName = safeSheetName(customerEnglish(group.eng_name || group.name), `Product ${groupIndex + 1}`);
    const rows = [];
    let lastFabric = '';
    let lastFabricEng = '';
    for (const item of group.items || []) {
      const sourceFabric = String(item.fabric || '').trim();
      const fabricName = customerEnglish(item.eng_name || sourceFabric || lastFabricEng || lastFabric);
      if (sourceFabric) {
        lastFabric = sourceFabric;
        lastFabricEng = item.eng_name || '';
      }
      const part = customerEnglish(item.part_eng || String(item.part || '').trim());
      const usage = num(item.usage) || 1;
      const materialPrice = num(item.mat_price);
      const isLabor = !part && /裁床|车缝|車縫|手工|人工|cut|sew|stuff|pack|labou?r/i.test(fabricName);
      const row = {
        sub_product: charName,
        product_name: charName,
        fabric_name: fabricName,
        eng_name: fabricName,
        cn_name: sourceFabric || lastFabric,
        cn_part: String(item.part || '').trim(),
        usage_amount: usage,
        material_price_rmb: materialPrice,
        price_rmb: usage * materialPrice,
        position: part ? '__fabric__' : (isLabor ? '__labor__' : (/绣|繡|embroid/i.test(fabricName) ? '__embroidery__' : '__other__')),
      };
      rows.push(row);
      allSewing.push(row);
    }
    sewingByChar[charName] = rows;
  }

  const defaultChar = safeSheetName(customerEnglish(quote.product_name), quote.quote_no);
  if (!Object.keys(sewingByChar).length) sewingByChar[defaultChar] = [];

  const carton = engineering.carton_calc || {};
  const cartonRows = Array.isArray(carton.cartons) ? carton.cartons : [];
  const mainCarton = cartonRows[0] || {};
  const cartonQty = num(mainCarton.qty) || num(carton.qty) || 1;
  const cartonL = num(mainCarton.cl) || num(carton.cl);
  const cartonW = num(mainCarton.cw) || num(carton.cw);
  const cartonH = num(mainCarton.ch) || num(carton.ch);
  const cartonCuft = num(mainCarton.cuft) || num(carton.cuft) || (cartonL * cartonW * cartonH / 1728);

  const engineeringUnitUsd = (item, codePoint = 1) => {
    if (item.unit_price_rmb != null) {
      return hkdUsd ? num(item.unit_price_rmb) / rmbHkd / hkdUsd * codePoint : 0;
    }
    return hkdUsd ? num(item.unit_price) / hkdUsd * codePoint : 0;
  };

  const packagingItems = (engineering.packaging_materials || []).map(item => ({
    name: /胶袋|polybag/i.test(item.name || '')
      ? `Individual polybag ( recycled) ${item.spec_eng || customerEnglish(item.spec || '')}`.trim()
      : customerEnglish(item.eng_name || item.name || ''),
    eng_name: item.eng_name || '',
    cn_name: item.name || '',
    quantity: num(item.qty) || 1,
    new_price: engineeringUnitUsd(item, 1.06),
    pkg_section: /纸箱|紙箱|外箱|carton/i.test(`${item.category || ''} ${item.name || ''}`) ? 'carton' : 'retail',
  }));

  const auxPackagingItems = (engineering.aux_materials || []).map(item => ({
    name: /杂费|胶纸|胶针|dennison/i.test(item.name || '') ? 'Dennison' : customerEnglish(item.eng_name || item.name || ''),
    eng_name: item.eng_name || '',
    cn_name: item.name || '',
    quantity: num(item.qty) || 1,
    new_price: engineeringUnitUsd(item, 1.06),
    pkg_section: 'retail',
  }));
  const polybagIndex = packagingItems.findIndex(item => /polybag/i.test(item.name));
  packagingItems.splice(polybagIndex >= 0 ? polybagIndex : packagingItems.length, 0, ...auxPackagingItems);

  const hasPaperRate = carton.paper_rate != null
    && carton.paper_rate !== ''
    && Number.isFinite(Number(carton.paper_rate))
    && Number(carton.paper_rate) > 0;
  const hasCartonDimensions = cartonL > 0 && cartonW > 0 && cartonH > 0;
  const calculatedCartonHkd = hasPaperRate && hasCartonDimensions
    ? (cartonL + cartonW + 2) * (cartonW + cartonH + 1) * 2
      * num(carton.paper_rate) / 1000
    : 0;
  const cartonHkd = calculatedCartonHkd
    || num(mainCarton.carton_price) || num(mainCarton.price) || num(mainCarton.box_price)
    || num(carton.carton_price) || num(carton.price) || num(carton.box_price)
    || (hasCartonDimensions
      ? (cartonL + cartonW + 2) * (cartonW + cartonH + 1) * 2 * 2.75 / 1000
      : 0);
  const flatCardHkd = num(carton.flat_card);
  if (cartonHkd || flatCardHkd) {
    const paperLabel = String(mainCarton.ka_label || carton.ka_label || 'K3A').replace(/^K=A$/i, 'K3A');
    const dimensionLabel = [cartonL, cartonW, cartonH].map(value => `${value}"`).join(' *');
    packagingItems.push({
      name: `Master carton ${paperLabel} ${dimensionLabel}`.trim(),
      eng_name: '',
      quantity: cartonQty > 0 ? 1 / cartonQty : 1,
      new_price: hkdUsd ? cartonHkd / hkdUsd : 0,
      pkg_section: 'carton',
    });
    if (flatCardHkd) {
      packagingItems.push({
        name: 'Anti-scratch Inner Board',
        eng_name: 'Inner B33',
        quantity: 1,
        new_price: hkdUsd ? flatCardHkd / cartonQty / hkdUsd : 0,
        pkg_section: 'carton',
      });
    }
    packagingItems.push({
      name: 'scotch tape、Tissue',
      eng_name: '',
      quantity: 1,
      new_price: 0.01,
      pkg_section: 'carton',
    });
  }

  const electronicRows = (electronic.electronics?.length ? electronic.electronics : engineering.electronics || []);
  const electronicItems = electronicRows.map(item => ({
    part_name: customerEnglish(item.eng_name || item.name || ''),
    eng_name: item.eng_name || '',
    cn_name: item.name || '',
    cn_spec: item.spec || '',
    spec: customerEnglish(item.spec_eng || item.spec || ''),
    quantity: num(item.qty) || 1,
    unit_price_usd: hkdUsd ? num(item.unit_price) / hkdUsd : 0,
  }));

  const hardwareItems = (engineering.hardware || []).map(item => ({
    name: customerEnglish(item.eng_name || item.name || ''),
    eng_name: item.eng_name || '',
    cn_name: item.name || '',
    quantity: num(item.qty) || 1,
    new_price: num(item.unit_price_rmb ?? item.unit_price),
    part_category: 'hardware',
  }));

  const packagingStepHkd = (assembly.packaging_step_groups || []).reduce((sum, group) => {
    const team = num(group.team) || 1;
    const qty = Math.max(num(group.qty), 1);
    return sum + (group.steps || []).reduce((stepSum, step) => stepSum + laborHkd * num(step.count) * team / qty, 0);
  }, 0);
  const packagingLineHkd = (assembly.packaging_labor || [])
    .reduce((sum, item) => sum + num(item.unit_price) * (num(item.qty) || 1), 0);
  if (packagingStepHkd || packagingLineHkd) {
    hardwareItems.push({
      name: 'Packing Labour',
      quantity: 1,
      new_price: packagingStepHkd + packagingLineHkd,
      part_category: 'labor_assembly',
    });
  }

  const materialPrices = molding.material_prices || [];
  const moldParts = (molding.injection || []).map(item => ({
    description: customerEnglish(item.eng_name || item.name || ''),
    eng_name: item.eng_name || '',
    cn_name: item.name || '',
    mold_no: item.mold_no || '',
    part_no: '',
    cavity_count: num(item.cavity) || num(item.output_qty) || null,
    sets_per_toy: num(item.sets) || 1,
    material: item.material || '',
    weight_g: num(item.weight_g),
    machine_type: item.machine || item.machine_model || '',
    cycle_time_sec: num(item.cycle_sec || item.cycle_time_sec),
    molding_cost_usd: hkdUsd ? num(item.shot_price) / hkdUsd : 0,
  }));

  const electronicExtra = electronic.electronics_extra || engineering.electronics_extra || {};
  const electronicLaborTotalHkd = ['smt_cost', 'labor_cost', 'test_repair', 'packing_shipping']
    .reduce((sum, key) => sum + num(electronicExtra[key]), 0);

  const spinTransport = buildSpinTransportRows({
    cartonCuft,
    pcsPerCarton: cartonQty,
    freightCalc: sales.freight_calc,
    spinConfig: sales.spin_transport,
  });

  return {
    version: {
      id: quote.id,
      quote_rev: quote.version || '',
      prepared_by: quote.created_by_name || 'Charles',
    },
    product: {
      item_no: quote.quote_no || String(quote.id || ''),
      item_desc: customerEnglish(sales.vq_english?.product_name || quote.product_name || ''),
      client: quote.customer || 'SPIN',
    },
    params: {
      rmb_hkd: rmbHkd,
      hkd_usd: hkdUsd,
      labor_hkd: laborHkd,
      markup_body: num(pricing.vq_markup_pct) ? num(pricing.vq_markup_pct) / 100 : 0.15,
      markup_material: 0.15,
      markup_packaging: 0.10,
      markup_labor: 0.15,
      testing_fee_usd: 0,
    },
    sewingByChar,
    fabricItems: allSewing.filter(row => row.position === '__fabric__'),
    otherItems: allSewing.filter(row => !['__fabric__', '__labor__'].includes(row.position)),
    laborItems: allSewing.filter(row => row.position === '__labor__'),
    packagingItems,
    productDim: {
      pcs_per_carton: cartonQty,
      carton_l_inch: cartonL,
      carton_w_inch: cartonW,
      carton_h_inch: cartonH,
      carton_cuft: cartonCuft,
    },
    moldParts,
    hardwareItems,
    electronicItems,
    electronicLaborTotalHkd,
    transportConfig: sales.spin_transport || {},
    spinTransport,
    refMaterials: materialPrices.map(item => ({
      material_name: customerEnglish(item.name || ''),
      client_spin_usd_kg: hkdUsd ? num(item.price) * 1000 / 454 / hkdUsd : 0,
    })),
    refMachines: SPIN_MACHINE_PRICES.map(item => ({
      ...item,
      rate_rmb_24h: item.price_24h_hkd / SPIN_MACHINE_HOURS / SPIN_HKD_USD / SPIN_UTILIZATION,
    })),
  };
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
  const productDescription = customerEnglish(product?.item_desc || '');
  const characterName = customerEnglish(d.charName || '');
  const charSuffix = characterName && !productDescription.includes(characterName)
    ? `--${characterName}`
    : '';
  ws.getCell(7, 3).value = product ? `${productDescription}${charSuffix}` : '';

  // ── Fabric Cost (R23+): cols C=3 eng desc, D=4 cn desc, J=10 USD price, K=11 qty ──
  const fabricEndRow = FABRIC_START + Math.max(FABRIC_SLOTS, sortedFabrics.length) - 1;
  clearRows(ws, FABRIC_START, fabricEndRow, [3, 4, 5, 10, 11, 12]);
  sortedFabrics.forEach((item, i) => {
    const r = 23 + i;
    const engName = customerEnglish(item.eng_name || item.fabric_name || '');
    setVal(ws, r, 3, engName);
    setVal(ws, r, 4, item.cn_name || '');
    if (showProductCol) setVal(ws, r, 5, item.product_name || '');
    // 毛绒: 单价 / 6.8 * 1.06 / 1.1
    const unitPriceUsd = (parseFloat(item.material_price_rmb) || 0) / 6.8 * 1.06 / 1.1;
    const usage = parseFloat(item.usage_amount) || 0;
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
    const oEngName = customerEnglish(item.eng_name || item.fabric_name || '');
    setVal(ws, r, 3, oEngName);
    setVal(ws, r, 4, item.cn_name || '');
    if (showOtherProductCol) setVal(ws, r, 5, item.product_name || '');
    const rmb = parseFloat(item.material_price_rmb) || 0;
    // 电绣: 单价 / 6.8 / 1.1; 毛绒(其他): 单价 / 6.8 * 1.06 / 1.1
    const providedUnitUsd = parseFloat(item.unit_price_usd);
    const unitPriceUsd = Number.isFinite(providedUnitUsd)
      ? providedUnitUsd
      : (item.position === '__embroidery__'
        ? rmb / 6.8 / 1.1
        : rmb / 6.8 * 1.06 / 1.1);
    const usage = parseFloat(item.usage_amount) || 0;
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
      ws.getCell(r, 3).value = customerEnglish(item.eng_name || item.name || '');
      ws.getCell(r, 4).value = item.cn_name || '';
      const price = parseFloat(item.new_price) || 0;
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
    const jCell = ws.getCell(row, 10);
    delete jCell._sharedFormula;
    jCell.value = r2(rateUsd) || 0;
    jCell.numFmt = '0.0000';
    jCell.alignment = { horizontal: 'right' };
    const kCell = ws.getCell(row, 11);
    delete kCell._sharedFormula;
    kCell.value = r2(hours) || 0;
    kCell.numFmt = '0.0000';
    kCell.alignment = { horizontal: 'right' };
    // Keep the exported labor amount auditable: US$ per toy = labor rate × standard hour.
    const lCell = ws.getCell(row, 12);
    delete lCell._sharedFormula;
    const rateNum = parseFloat(rateUsd) || 0;
    const hoursNum = parseFloat(hours) || 0;
    lCell.value = {
      formula: `J${row}*K${row}`,
      result: Math.round(rateNum * hoursNum * 10000) / 10000,
    };
    lCell.numFmt = '0.0000';
    lCell.alignment = { horizontal: 'right' };
  }

  // Clear shared formulas in labor section (L123:L130) BEFORE any writes —
  // otherwise child cells keep inheriting from L123's formula even after
  // we overwrite their value with a literal.
  for (let r = 123; r <= 130; r++) {
    for (const c of [10, 11, 12]) {
      const cell = ws.getCell(r, c);
      delete cell._sharedFormula;
      if (cell._value && cell._value.model) cell._value.model.formula = undefined;
      cell.value = null;
    }
  }

  // Fixed labor rate from params: labor_hkd / 11hr / hkd_usd (e.g. 275/11/7.75 = 3.226)
  const laborHkd = parseFloat(params.labor_hkd) || 0;
  const laborRate = laborHkd ? Math.round(laborHkd / 11 / hkd_usd * 1000) / 1000 : 3.226;
  const sewLabor = findLabor(['车缝', 'sew']);
  const cutLabor = findLabor(['裁床', 'cut']);
  const stuffLabor = findLabor(['手工', 'stuff']);
  const packLabor = findLabor(['包', 'pack', '半成品']);

  // Electronics Assembly (R124): current quotation payload total labor cost.
  const elecLaborTotal = parseFloat(d.electronicLaborTotalHkd) || 0;
  if (elecLaborTotal) {
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
  const PACKING_RE = /半成品人工|包装人工|查货|packing labour|inspection/i;
  const packingItems = (d.hardwareItems || []).filter(h =>
    h.part_category === 'labor_assembly' && PACKING_RE.test(h.name || '')
  );
  if (packingItems.length) {
    const packingTotalUsd = packingItems.reduce((s, h) => s + (parseFloat(h.new_price) || 0) / hkd_usd, 0);
    // Write total as standard_hour = total_usd / rate
    const packHrs = laborRate ? r2(packingTotalUsd / laborRate) : 0;
    writeLaborRow(sewingRow + 2, laborRate, packHrs);
  }

  // Refresh the labor subtotal formula and its cached result so the value is
  // correct both before and after Excel recalculates the workbook.
  let laborSubtotalRow = 0;
  for (let r = sewingRow + 1; r <= sewingRow + 10; r++) {
    if (/^Subtotal:$/i.test(String(ws.getCell(r, 12).value || '').trim())) {
      laborSubtotalRow = r;
      break;
    }
  }
  if (laborSubtotalRow) {
    const laborStartRow = laborSubtotalRow - 8;
    const laborEndRow = laborSubtotalRow - 1;
    let laborSubtotal = 0;
    for (let r = laborStartRow; r <= laborEndRow; r++) {
      const value = ws.getCell(r, 12).value;
      laborSubtotal += num(value && typeof value === 'object' ? value.result : value);
    }
    const subtotalCell = ws.getCell(laborSubtotalRow, 13);
    delete subtotalCell._sharedFormula;
    subtotalCell.value = {
      formula: `SUM(L${laborStartRow}:L${laborEndRow})`,
      result: r2(laborSubtotal),
    };
    subtotalCell.numFmt = '0.0000';
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
    setVal(ws, r, 3, customerEnglish(item.eng_name || item.description || ''));
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

    // Molding Cost = labour rate × cycle seconds ÷ 3600 ÷ sets per toy.
    const moldCost = (rate && cycle) ? r2(rate * cycle / 3600 / sets) : (parseFloat(item.molding_cost_usd) || null);
    const moldCostCell = ws.getCell(r, 14);
    delete moldCostCell._sharedFormula;
    moldCostCell.value = {
      formula: `IF(OR(G${r}="",O${r}="",Q${r}=""),"",Q${r}*O${r}/3600/G${r})`,
      result: moldCost,
    };
    setVal(ws, r, 15, cycle || null);
    setVal(ws, r, 16, machRef ? (machRef.tonnage || item.machine_type || null) : (item.machine_type || null));
    setVal(ws, r, 17, rate || null);
    ws.getCell(r, 17).numFmt = '0.000';
    ws.getCell(r, 10).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(r, 17).alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getColumn(17).width = 22;

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
    ws.getCell(r, 3).value = customerEnglish(item.eng_name || item.name || '');
    ws.getCell(r, 4).value = item.cn_name || '';
    const unitUsd = (parseFloat(item.new_price) || 0) / rmb_hkd / hkd_usd * 1.06;
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
  const elecEnd = elecStart + Math.max(ELEC_SLOTS, elecList.length) - 1;
  clearRows(ws, elecStart, elecEnd, [3, 4, 10, 11, 12]);
  for (let r = elecStart; r <= elecEnd; r++) {
    delete ws.getCell(r, 12)._sharedFormula;
  }
  elecList.forEach((item, i) => {
    const r = elecStart + i;
    setVal(ws, r, 3, customerEnglish(item.eng_name || item.part_name || ''));
    setVal(ws, r, 4, item.cn_name || item.part_name || '');
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
    'HK LCL1':   fclRow + 8,
    'HK LCL2':   fclRow + 9,
    'HK LCL3':   fclRow + 10,
  };

  const formulaNumber = value => {
    const n = num(value);
    return Number.isFinite(n) ? String(n) : '0';
  };
  const setFormula = (row, col, formula, result, numFmt) => {
    const cell = ws.getCell(row, col);
    delete cell._sharedFormula;
    cell.value = { formula, result: num(result) };
    if (numFmt) cell.numFmt = numFmt;
  };

  // 清掉模板示例值，确保本次导出只使用当前报价的参数。
  Object.values(trRows).forEach(row => {
    [3, 9, 12].forEach(col => { ws.getCell(row, col).value = null; });
  });

  function writeTransportRow(row, tr) {
    if (tr.code === 'CHINA FCL' || tr.code === 'HK FCL') {
      setFormula(
        row, 3,
        `IFERROR(INT(${formulaNumber(tr.capacity_20)}/'Summary'!B52)*'Summary'!E45,0)`,
        tr.qty_20,
        '0'
      );
      ws.getCell(row, 4).value = 'pcs';
      setFormula(
        row, 9,
        `IFERROR(INT(${formulaNumber(tr.capacity_40)}/'Summary'!B52)*'Summary'!E45,0)`,
        tr.qty_40,
        '0'
      );
      ws.getCell(row, 10).value = 'pcs';
      setFormula(
        row, 12,
        `IFERROR(${formulaNumber(tr.fee_40_hkd)}/${formulaNumber(tr.fx_hkd_usd)}/I${row},0)`,
        tr.usd_per_toy,
        '0.0000'
      );
      return;
    }
    setFormula(
      row, 9,
      `IFERROR(INT(${formulaNumber(tr.capacity_cuft)}/'Summary'!B52)*'Summary'!E45,0)`,
      tr.qty_40,
      '0'
    );
    ws.getCell(row, 10).value = 'pcs';
    setFormula(
      row, 12,
      `IFERROR(${formulaNumber(tr.unit_hkd)}*'Summary'!B52/'Summary'!E45/${formulaNumber(tr.lcl_divisor)}/${formulaNumber(tr.fx_hkd_usd)},0)`,
      tr.usd_per_toy,
      '0.0000'
    );
  }

  for (const tr of spinTr) {
    if (trRows[tr.code]) writeTransportRow(trRows[tr.code], tr);
  }

  // HK LCL 的单价公式尚未在来源表中确认；装量跟随对应的盐田散货行，避免保留模板样例数值。
  for (let index = 1; index <= 3; index++) {
    const sourceRow = trRows[`CHINA LCL${index}`];
    const targetRow = trRows[`HK LCL${index}`];
    const source = spinTr.find(item => item.code === `CHINA LCL${index}`);
    setFormula(targetRow, 9, `I${sourceRow}`, source?.qty_40 || 0, '0');
    ws.getCell(targetRow, 10).value = 'pcs';
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

  // Apply molding presentation last because template cells share style objects.
  for (let r = 10; r <= 17; r++) {
    ws.getCell(r, 10).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(r, 17).alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getColumn(17).width = 22;
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
      ws.getCell(r, 5).value = parseFloat(productDim?.pcs_per_carton) || 6;
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
    // 公式必须引用完整 CUFT 精度；单元格自身的格式仍负责按模板位数显示。
    if (productDim.carton_cuft) ws.getCell(52, 2).value = productDim.carton_cuft;
    // Fix cm formulas (shared formula expansion issue)
    ws.getCell(48, 5).value = { formula: 'B48*2.54' };
    ws.getCell(49, 5).value = { formula: 'B49*2.54' };
    ws.getCell(50, 5).value = { formula: 'B50*2.54' };
    ws.getCell(52, 5).value = { formula: '(E48*E49*E50)/1000000' };
  }
}

// ─── Main Export Function ─────────────────────────────────────────────────────

async function exportSpin({ quote, sections }) {
  const d = sectionsToSpinData({ quote, sections });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readTemplateParts('VQ-template-spin.xlsx'));

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
        laborItems:  (() => {
          const charLabor = rows.filter(r => r.position === '__labor__');
          return charLabor.length ? charLabor : d.laborItems;
        })(),
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
    // Single-product: fill first non-Summary sheet, rename to product name, remove the rest
    const charWs = templateCharSheets[0];
    if (charWs) {
      const productName = (d.product?.item_desc || d.product?.item_no || 'Product').slice(0, 31);
      charWs.name = productName;
      fillCharacterSheet(charWs, d);
    }
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

module.exports = { exportSpin, sectionsToSpinData, buildSpinTransportRows };
