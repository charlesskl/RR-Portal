const ExcelJS = require('exceljs');
const fs = require('fs');

// ─── Cell Value Helper ────────────────────────────────────────────────────────

function cellVal(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.result !== undefined) return v.result; // formula
  if (typeof v === 'object' && v.text !== undefined) return v.text;     // shared string
  if (typeof v === 'object' && Array.isArray(v.richText)) {             // rich text
    return v.richText.map(r => r.text || '').join('');
  }
  return v;
}

function numVal(cell) {
  const v = cellVal(cell);
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function strVal(cell) {
  const v = cellVal(cell);
  if (v === null || v === undefined) return null;
  return String(v).trim();
}

// ─── MOQ Price Column Detector ────────────────────────────────────────────────
// Scans header rows for MOQ labels like "5K", "2.5K", "看图报价 5K"
// Returns { col, moq } — col is the column index, moq is the numeric MOQ value
function detectPriceCol(ws, defaultCol = 4) {
  const moqCols = {}; // numeric moq -> col index
  for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 12; c++) {
      const v = strVal(row.getCell(c));
      if (!v) continue;
      const m = v.match(/(\d+\.?\d*)\s*[Kk]/);
      if (m) {
        const moqNum = Math.round(parseFloat(m[1]) * 1000); // e.g. 2.5K -> 2500, 5K -> 5000
        moqCols[moqNum] = c;
      }
    }
    if (Object.keys(moqCols).length > 0) break;
  }
  if (Object.keys(moqCols).length === 0) return { col: defaultCol, moq: 2500 };
  // Prefer 5000, else pick the largest available MOQ
  const moqNums = Object.keys(moqCols).map(Number).sort((a, b) => b - a);
  const preferred = moqNums.includes(5000) ? 5000 : moqNums[0];
  return { col: moqCols[preferred], moq: preferred };
}

// ─── Sheet Detection ──────────────────────────────────────────────────────────

function detectFormat(workbook) {
  const sheetNames = workbook.worksheets.map(ws => ws.name);

  // SPIN detection: has '装配' sheet and Row 2 of that sheet contains 'SPIN' (any column)
  const assemblySheet = workbook.worksheets.find(ws => ws.name === '装配');
  if (assemblySheet) {
    let hasSpinLabel = false;
    assemblySheet.getRow(2).eachCell(cell => {
      const v = (strVal(cell) || '').normalize('NFKC');
      if (v.includes('SPIN')) hasSpinLabel = true;
    });
    if (hasSpinLabel) return 'spin';
  }

  const hasPlushIndicator = sheetNames.some(n =>
    n && (n.includes('车缝明细') || n.includes('搪胶'))
  );
  return hasPlushIndicator ? 'plush' : 'injection';
}

function detectLatestSheet(workbook) {
  const sheets = workbook.worksheets.map(ws => ws.name);

  // Extract date/number from anywhere in sheet name for sorting
  function parseSheetDate(name) {
    // Find all 6-digit sequences anywhere in the name (e.g. 260406 in "260406改噶件")
    const all6 = [...name.matchAll(/(\d{6})/g)].map(m => parseInt(m[1], 10));
    if (all6.length > 0) return Math.max(...all6);
    // Trailing 4-digit
    const m2 = name.match(/(\d{4})/);
    if (m2) return parseInt(m2[1], 10);
    const vm = name.match(/V(\d+)/i);
    if (vm) return parseInt(vm[1], 10);
    return 0;
  }

  // Prefer "报价明细" sheets (injection format)
  const mingxiCandidates = sheets.filter(n => n && n.includes('报价明细'));
  if (mingxiCandidates.length > 0) {
    mingxiCandidates.sort((a, b) => parseSheetDate(b) - parseSheetDate(a));
    return mingxiCandidates[0];
  }

  // Fallback: any sheet containing "报价" — pick latest by date suffix
  const quoteCandidates = sheets.filter(n => n && n.includes('报价'));
  if (quoteCandidates.length > 0) {
    quoteCandidates.sort((a, b) => parseSheetDate(b) - parseSheetDate(a));
    return quoteCandidates[0];
  }

  // Last resort: first sheet
  return sheets[0];
}

// ─── Header Parser (R1–R16) ───────────────────────────────────────────────────

function parseHeader(ws, format, workbook) {
  // R1: product_no
  // Injection: A1="产品编号：", B1=value
  // Plush:     B1="产品编号：", C1=value
  // Try B1 first; if it looks like a label, use C1
  let product_no = strVal(ws.getCell('B1'));
  if (!product_no || (typeof product_no === 'string' && product_no.includes('编号'))) {
    product_no = strVal(ws.getCell('C1'));
  }

  // SPIN: product_no from 总表 sheet, Row 8, Col 2, format "货号：#29090"
  if (format === 'spin' && workbook) {
    const summarySheet = workbook.worksheets.find(ws => ws.name.includes('总表'));
    if (summarySheet) {
      const raw = strVal(summarySheet.getCell(8, 2)) || '';
      const m = raw.match(/\d+/);
      if (m) product_no = m[0];
    }
  }

  // item_desc: scan for row containing "货号" in col B, take col B of next row
  let item_desc = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
    const b = strVal(ws.getCell(r, 2));
    if (b && b.includes('货号')) {
      item_desc = strVal(ws.getCell(r + 1, 2)) || null;
      break;
    }
  }

  // R2-R6: Material price table
  // Row 2: 料型 labels (B2:V2)
  // Row 4: 单价HKD/磅 (B4:V4)
  // Row 5: 料单价HKD/g (B5:V5)
  // Row 6: 料单价RMB/g (B6:V6)
  const materialPrices = [];
  // Columns B through V (2..22)
  for (let col = 2; col <= 22; col++) {
    const material_type = strVal(ws.getCell(2, col));
    if (!material_type) continue;
    const price_hkd_per_lb = numVal(ws.getCell(4, col));
    const price_hkd_per_g = numVal(ws.getCell(5, col));
    const price_rmb_per_g = numVal(ws.getCell(6, col));
    if (material_type) {
      materialPrices.push({ material_type, price_hkd_per_lb, price_hkd_per_g, price_rmb_per_g });
    }
  }

  // R8-R10: Machine price table
  // Row 8: 机型 labels (B8:N8)
  // Row 9: 啤工价HKD (B9:N9)
  // Row 10: 啤工价RMB (B10:N10)
  const machinePrices = [];
  for (let col = 2; col <= 14; col++) {
    const machine_type = strVal(ws.getCell(8, col));
    if (!machine_type) continue;
    const price_hkd = numVal(ws.getCell(9, col));
    const price_rmb = numVal(ws.getCell(10, col));
    machinePrices.push({ machine_type, price_hkd, price_rmb });
  }

  // R11-R14: Exchange rates and params
  // Injection: values at C11-C14; Plush: labels at C11-C14, values at D11-D14
  // Try C first; if null try D (plush layout)
  const hkd_rmb_quote = numVal(ws.getCell('C11')) || numVal(ws.getCell('D11'));
  const hkd_rmb_check = numVal(ws.getCell('C12')) || numVal(ws.getCell('D12'));
  const rmb_hkd = numVal(ws.getCell('C13')) || numVal(ws.getCell('D13'));
  const hkd_usd = numVal(ws.getCell('C14')) || numVal(ws.getCell('D14'));
  // Labor: F13 (injection) or G13 (plush); Box: F14 (injection) or G14 (plush, may be string)
  const labor_hkd = numVal(ws.getCell('G13')) || numVal(ws.getCell('F13'));
  const box_price_hkd = numVal(ws.getCell('G14')) || numVal(ws.getCell('F14'));

  // R15: date_code, R16: reference number
  const date_code = strVal(ws.getCell('A15')) || strVal(ws.getCell('B15')) || strVal(ws.getCell('C15'));
  const ref_no = strVal(ws.getCell('A16')) || strVal(ws.getCell('B16')) || strVal(ws.getCell('C16'));

  return {
    product_no,
    materialPrices,
    machinePrices,
    params: { hkd_rmb_quote, hkd_rmb_check, rmb_hkd, hkd_usd, labor_hkd, box_price_hkd },
    date_code,
    ref_no,
    item_desc,
  };
}

// ─── Mold Parts Parser (R17+) ────────────────────────────────────────────────

function parseMoldParts(ws, startRow = 18) {
  const moldParts = [];

  // Dynamically find header row containing "模号" to handle varying layouts
  let detectedStart = 0;
  for (let r = 1; r < startRow + 10; r++) {
    const b = strVal(ws.getCell(r, 2));
    const c = strVal(ws.getCell(r, 3));
    if (/模号|模具/.test(b) && /名称/.test(c)) { detectedStart = r + 1; break; }
  }
  let row = detectedStart || startRow;
  let sortOrder = 0;

  // Mold part columns are offset by 1 (col A is empty, data starts at col B=2)
  // B=part_no, C=description, D=material, E=weight_g, F=unit_price, G=machine_type,
  // H=cavity_count, I=sets_per_toy, J=target_qty, K=molding_labor, L=material_cost, M=mold_cost, N=remark
  const C_PART   = 2,  C_DESC  = 3,  C_MAT  = 4,  C_WGHT = 5,
        C_UPRICE = 6,  C_MACH = 7,  C_CAV  = 8,  C_SETS = 9,
        C_TGT   = 10, C_MLBR = 11, C_MCST = 12, C_MCRMB = 13, C_REM  = 14;

  while (row <= 200) {
    const colB = strVal(ws.getCell(row, C_PART));
    const colD = strVal(ws.getCell(row, C_MAT));
    const colJ = strVal(ws.getCell(row, C_TGT));

    // Stop on 合计 row
    if (
      (colB && colB.includes('合计')) ||
      (colD && colD.includes('合计')) ||
      (colJ && colJ.includes('合计'))
    ) {
      break;
    }

    // Skip empty rows (no part_no and no description)
    const part_no = strVal(ws.getCell(row, C_PART));
    const description = strVal(ws.getCell(row, C_DESC));

    if (!part_no && !description) {
      row++;
      continue;
    }

    // Stop when hitting cost summary rows (not mold parts)
    const COST_ROW_PATTERN = /料价|啤工|人工|油漆|喷油|搪胶|车缝|拆货|包装|吊咭|合计|总计|利润|运费/;
    if (COST_ROW_PATTERN.test(part_no) || COST_ROW_PATTERN.test(description)) {
      break;
    }

    const material = strVal(ws.getCell(row, C_MAT));
    const weight_g = numVal(ws.getCell(row, C_WGHT));
    const unit_price_hkd_g = numVal(ws.getCell(row, C_UPRICE));
    const machine_type = strVal(ws.getCell(row, C_MACH));
    const cavity_count = numVal(ws.getCell(row, C_CAV));
    const sets_per_toy = numVal(ws.getCell(row, C_SETS));
    const target_qty = numVal(ws.getCell(row, C_TGT));
    const molding_labor = numVal(ws.getCell(row, C_MLBR));
    const material_cost_hkd = numVal(ws.getCell(row, C_MCST));
    const mold_cost_rmb = numVal(ws.getCell(row, C_MCRMB));
    const remark = strVal(ws.getCell(row, C_REM));

    const is_old_mold = (remark && remark.includes('旧模')) || mold_cost_rmb === null ? 1 : 0;

    moldParts.push({
      part_no,
      description,
      material,
      weight_g,
      unit_price_hkd_g,
      machine_type,
      cavity_count: cavity_count ? Math.round(cavity_count) : null,
      sets_per_toy: sets_per_toy || null,
      target_qty: target_qty ? Math.round(target_qty) : null,
      molding_labor,
      material_cost_hkd,
      mold_cost_rmb,
      remark,
      is_old_mold,
      sort_order: sortOrder++,
    });

    row++;
  }

  return moldParts;
}

// ─── Rotocast Items Parser (Plush: R20-R23) ────────────────────────────────

function parseRotocastItems(ws) {
  const items = [];
  // Dynamically find header row containing 模号/名称/出数
  let startRow = 0;
  for (let r = 1; r <= 50; r++) {
    const b = strVal(ws.getCell(r, 2));
    const c = strVal(ws.getCell(r, 3));
    const d = strVal(ws.getCell(r, 4));
    if (/模号/.test(b) && /名称/.test(c) && /出数/.test(d)) { startRow = r + 1; break; }
  }
  if (!startRow) return items; // no rotocast section found

  let row = startRow;
  let sortOrder = 0;

  while (row <= startRow + 30) {
    const colF = strVal(ws.getCell(row, 6));
    if (colF && colF.includes('合计')) break;

    const mold_no = strVal(ws.getCell(row, 2));  // col B
    const name = strVal(ws.getCell(row, 3));      // col C
    if (!mold_no && !name) { row++; continue; }

    items.push({
      mold_no, name,
      output_qty: numVal(ws.getCell(row, 4)) ? Math.round(numVal(ws.getCell(row, 4))) : null,
      usage_pcs: numVal(ws.getCell(row, 5)) ? Math.round(numVal(ws.getCell(row, 5))) : null,
      unit_price_hkd: numVal(ws.getCell(row, 6)),
      total_hkd: numVal(ws.getCell(row, 7)),
      remark: strVal(ws.getCell(row, 8)),
      sort_order: sortOrder++,
    });
    row++;
  }
  return items;
}

// ─── Sewing Details Parser (车缝明细 sheet) ────────────────────────────────

function parseSewingDetails(workbook) {
  const wsNames = workbook.worksheets.map(ws => ws.name);

  // Collect ALL 车缝明细 sheets — each may represent a different sub-product (character)
  const sewingSheets = wsNames.filter(n => n.includes('车缝明细'));
  if (!sewingSheets.length) return [];

  const allItems = [];

  for (const sewingSheet of sewingSheets) {
    // Derive sub_product from sheet name suffix, e.g. "车缝明细 3-15" → "3-15", "车缝明细" → null
    const subMatch = sewingSheet.replace('车缝明细', '').trim();
    const sub_product = subMatch || null;

    const ws = workbook.getWorksheet(sewingSheet);
    let currentProductName = null;
    let currentProductEng = null;
    let lastFabricName = null;
    let sortOrder = allItems.length;

    // Dynamically find header row (contains 物料名称 or 裁片部位)
    // Also detect usage and price columns from header row
    let dataStartRow = 4;
    let usageCol = 6;  // default col F
    let priceCol = 7;  // default col G
    for (let r = 1; r <= 10; r++) {
      const b = strVal(ws.getCell(r, 2));
      const c = strVal(ws.getCell(r, 3));
      if ((b && b.includes('物料名称')) || (c && c.includes('裁片部位'))) {
        dataStartRow = r + 1;
        // Detect usage/price columns from this header row
        for (let col = 4; col <= 12; col++) {
          const hdr = strVal(ws.getCell(r, col)) || '';
          if (/用量/.test(hdr)) usageCol = col;
          if (/单价/.test(hdr)) priceCol = col;
        }
        // Capture product name from the row just before the header
        if (r > 1) {
          const prevB = strVal(ws.getCell(r - 1, 2));
          const prevC = strVal(ws.getCell(r - 1, 3));
          if (prevB) currentProductName = prevB;
          if (prevC) currentProductEng = prevC;
        }
        break;
      }
      // If this row has a product name (B non-empty, no numeric usage), capture it
      if (b && !numVal(ws.getCell(r, usageCol)) && !b.includes('物料名称')) {
        currentProductName = b;
      }
    }

    for (let row = dataStartRow; row <= 300; row++) {
      const colI = strVal(ws.getCell(row, 9));
      // 合计行：重置状态继续读取下一个产品段（不 break）
      if (colI && colI.includes('合计')) {
        lastFabricName = null;
        continue;
      }

      const colB = strVal(ws.getCell(row, 2));
      const colC = strVal(ws.getCell(row, 3));
      const colD = strVal(ws.getCell(row, 4));
      const colF = numVal(ws.getCell(row, usageCol));
      const colG = numVal(ws.getCell(row, priceCol));

      // New product section: B has product name, C has English name (or empty), no numeric usage
      // Detected by: colB non-empty, colF null, AND (colC non-numeric or empty), not a header row
      if (colB && colF == null && !colB.includes('物料名称') && !(colC && colC.includes('裁片部位'))) {
        // Check next row is a header row — confirms this is a product title row
        const nextB = strVal(ws.getCell(row + 1, 2));
        const nextC = strVal(ws.getCell(row + 1, 3));
        if ((nextB && nextB.includes('物料名称')) || (nextC && nextC.includes('裁片部位'))) {
          currentProductName = colB;
          currentProductEng = colC || null; // e.g. "Chase"
          lastFabricName = null;
          row++; // skip the header row
          continue;
        }
        // Also treat as product name if B has value, C+D+F+G all empty, no usage, no price
        // Exception: rows containing 人工 are labor items, not product headers
        if (!colC && !colD && colG == null && !/人工/.test(colB)) {
          currentProductName = colB;
          currentProductEng = null;
          lastFabricName = null;
          continue;
        }
      }

      // Skip truly empty rows (but keep labor rows even if they have no usage/spec data)
      if (!colC && !colD && colF == null && colG == null && !/人工/.test(colB || '')) continue;

      // Inherit fabric_name from 物料名称 (col B) — merged cell carries across rows
      if (colB) lastFabricName = colB;
      const fabricName = colB || lastFabricName;

      const colA = strVal(ws.getCell(row, 1));
      const isLabor = fabricName === '人工' || colC === '人工' || /人工/.test(fabricName || '');
      const isEmbroidery = colA && colA.includes('电绣');
      const position = isLabor ? '__labor__' : isEmbroidery ? '__embroidery__' : (colC || '__other__');

      // Skip __other__ items with no price
      if (position === '__other__' && !numVal(ws.getCell(row, priceCol))) continue;

      allItems.push({
        product_name: currentProductName,
        product_eng: currentProductEng,
        fabric_name: fabricName,
        position,
        sub_product,
        cut_pieces: numVal(ws.getCell(row, 5)) ? Math.round(numVal(ws.getCell(row, 5))) : null,
        usage_amount: numVal(ws.getCell(row, usageCol)),
        material_price_rmb: numVal(ws.getCell(row, priceCol)) || 0,
        price_rmb: numVal(ws.getCell(row, priceCol + 1)),
        markup_point: numVal(ws.getCell(row, 9)) || 1.15,
        total_price_rmb: numVal(ws.getCell(row, 10)),
        sort_order: sortOrder++,
      });
    }
  }

  return allItems;
}

// ─── Cost Items Parser ───────────────────────────────────────────────────────

function parseCostItems(ws, format) {
  // Parse a range of rows into items [{name, quantity, old_price, new_price, difference, tax_type}]
  // R40 is the header row; R41-R43 are summary computed rows (料价进口料, 料价国内采购, 啤工)
  // Actual labor items start at R44
  function parseItemRange(startRow, endRow) {
    const items = [];
    for (let r = startRow; r <= endRow; r++) {
      // col A is category label (may be null), col B is item name
      const name = strVal(ws.getCell(r, 2));
      if (!name) continue;
      const quantity = numVal(ws.getCell(r, 3));
      const old_price = numVal(ws.getCell(r, 4));
      const new_price = numVal(ws.getCell(r, 5));
      const difference = numVal(ws.getCell(r, 6));
      const tax_type = strVal(ws.getCell(r, 9));
      items.push({ name, quantity, old_price, new_price, difference, tax_type });
    }
    return items;
  }

  // R44-R47: Labor items (装配人工, 包装人工, 喷油人工, 油漆) — injection format fixed rows
  // Plush format: scan full sheet for rows where col B contains 人工
  let laborItems = [];
  if (format === 'plush' || format === 'spin') {
    for (let r = 1; r <= ws.rowCount; r++) {
      const colA = strVal(ws.getCell(r, 1));
      const name = strVal(ws.getCell(r, 2));
      if (!name || colA) continue;
      if (!name.includes('人工')) continue;
      const quantity = numVal(ws.getCell(r, 3));
      const new_price = numVal(ws.getCell(r, 4));
      laborItems.push({ name, quantity, old_price: null, new_price, difference: null, tax_type: null });
    }
  } else {
    laborItems = parseItemRange(44, 47);
  }

  // R48-R76: Hardware items (五金件, 电镀件, 贴纸, IC, PCBA, 电池)
  const hardwareItems = parseItemRange(48, 76);

  // R77-R93: Packaging items (Window Box, Insert card, etc.)
  const packagingItems = parseItemRange(77, 93);

  return { laborItems, hardwareItems, packagingItems };
}

// ─── Summary Parser ──────────────────────────────────────────────────────────

function parseSummary(ws) {
  // R94: 包装合计 (C94), R95: 附加税 (C95)
  const packaging_total = numVal(ws.getCell('C94'));
  const surcharge = numVal(ws.getCell('C95'));

  // R97-R106: Cost progression (column C = 盐田40柜 scenario)
  const factory_price = numVal(ws.getCell('C97'));
  const transport_cost = numVal(ws.getCell('C99'));    // 运费
  const mark_point = numVal(ws.getCell('C102'));        // 码点
  const payment_adj = numVal(ws.getCell('C104'));       // 找数 ÷
  const total_hkd = numVal(ws.getCell('C105'));         // TOTAL HK$
  const total_usd = numVal(ws.getCell('C106'));         // USD

  // Dynamically locate dimension rows by scanning all columns for keyword labels
  let productDimRow = 0, cartonDimRow = 0, cuftRow = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    let rowText = '';
    for (let c = 1; c <= 16; c++) rowText += strVal(ws.getCell(r, c));
    if (!productDimRow && /产品尺寸/.test(rowText)) { productDimRow = r; }
    if (!cartonDimRow  && /纸箱尺寸|外箱尺寸/.test(rowText)) { cartonDimRow = r; }
    if (!cuftRow       && /CU\.?FT/i.test(rowText)) { cuftRow = r; break; }
  }

  // Find L/W/H header row (a row that contains L, W, H as separate cells)
  // Usually one row above productDimRow
  let lwh_header_row = productDimRow > 1 ? productDimRow - 1 : 0;
  let lCol = 0, wCol = 0, hCol = 0;
  if (lwh_header_row) {
    for (let c = 1; c <= 16; c++) {
      const v = strVal(ws.getCell(lwh_header_row, c)) || '';
      if (v === 'L' && !lCol) lCol = c;
      else if (v === 'W' && !wCol) wCol = c;
      else if (v === 'H' && !hCol) hCol = c;
    }
  }
  // Fallback column positions (injection default)
  if (!lCol) lCol = 8;
  if (!wCol) wCol = 10;
  if (!hCol) hCol = 12;
  if (!productDimRow) productDimRow = 108;
  if (!cartonDimRow)  cartonDimRow  = 109;
  if (!cuftRow)       cuftRow       = 110;

  const product_l = numVal(ws.getCell(productDimRow, lCol));
  const product_w = numVal(ws.getCell(productDimRow, wCol));
  const product_h = numVal(ws.getCell(productDimRow, hCol));
  const carton_l  = numVal(ws.getCell(cartonDimRow, lCol));
  const carton_w  = numVal(ws.getCell(cartonDimRow, wCol));
  const carton_h  = numVal(ws.getCell(cartonDimRow, hCol));
  const carton_paper = strVal(ws.getCell(cartonDimRow, lCol - 1)) || strVal(ws.getCell(cartonDimRow, lCol - 2));
  const carton_cuft  = numVal(ws.getCell(cuftRow, lCol));
  const pcs_per_carton = numVal(ws.getCell(cuftRow, hCol));

  // Carton price: sum of all rows where col A contains "纸箱" × 1.08
  // Case pack: first row where col B contains "外箱" or "纸箱"
  const { col: mainPriceCol } = detectPriceCol(ws);
  let carton_price_raw = 0;
  let case_pack = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const colA = strVal(row.getCell(1)) || '';
    const colB = strVal(row.getCell(2)) || '';
    if (/纸箱/.test(colA)) {
      carton_price_raw += numVal(row.getCell(mainPriceCol)) || 0;
    }
    if (case_pack == null && /外箱|纸箱/.test(colB)) {
      const cp = strVal(row.getCell(3));
      if (cp) case_pack = cp;
    }
  }
  const carton_price = Math.round(carton_price_raw * 1.08 * 100) / 100;

  // R129-R136: Mold costs
  // R129-R130: section headers
  // R131=模具费用, R132=五金模/夹具, R133=喷油模具, R134=模具总计
  // R135=客补贴模费美金, R136=模费分摊
  const mold_cost_rmb = numVal(ws.getCell('C131'));
  const hardware_mold_cost_rmb = numVal(ws.getCell('C132'));
  const paint_mold_cost_rmb = numVal(ws.getCell('C133'));
  const total_mold_rmb = numVal(ws.getCell('C134'));
  const customer_subsidy_usd = numVal(ws.getCell('C135'));
  const amortization_rmb = numVal(ws.getCell('C136'));
  const amortization_usd = numVal(ws.getCell('D136'));
  const hkd_usd = numVal(ws.getCell('C14'));
  const total_mold_usd = total_mold_rmb && hkd_usd ? total_mold_rmb * hkd_usd : null;

  return {
    pricing: { packaging_total, surcharge, factory_price, transport_cost, mark_point, payment_adj, total_hkd, total_usd },
    dimensions: {
      product_l_inch: product_l, product_w_inch: product_w, product_h_inch: product_h,
      carton_l_inch: carton_l, carton_w_inch: carton_w, carton_h_inch: carton_h,
      carton_cuft, carton_price, pcs_per_carton: pcs_per_carton ? Math.round(pcs_per_carton) : null,
      carton_paper, case_pack,
    },
    moldCost: {
      mold_cost_rmb, hardware_mold_cost_rmb, paint_mold_cost_rmb,
      total_mold_rmb, total_mold_usd, customer_subsidy_usd,
      amortization_qty: null,
      amortization_rmb, amortization_usd, customer_quote_usd: null,
    },
  };
}

// ─── Transport Parser (R141–R155) ────────────────────────────────────────────

function parseTransport(ws) {
  // Actual layout (verified against real file):
  // R141: section header
  // R142: 1箱的CUFT: [B]=value [C]=CUFT
  // R143: 1箱装的个数: [B]=value [C]=PCS
  // R144: 10吨车: [B]=cuft
  // R145: 5吨车: [B]=cuft
  // R146: 40": [B]=cuft
  // R147: 20": [B]=cuft
  // R148-R155: shipping costs in B column (HK40, HK20, YT40, YT20, HK10T, YT10T, HK5T, YT5T)
  const cuft_per_box = numVal(ws.getCell(142, 2));  // B142
  const pcs_per_box = numVal(ws.getCell(143, 2));   // B143

  const truck_10t_cuft = numVal(ws.getCell(144, 2));
  const truck_5t_cuft = numVal(ws.getCell(145, 2));
  const container_40_cuft = numVal(ws.getCell(146, 2));
  const container_20_cuft = numVal(ws.getCell(147, 2));

  const hk_40_cost = numVal(ws.getCell(148, 2));
  const hk_20_cost = numVal(ws.getCell(149, 2));
  const yt_40_cost = numVal(ws.getCell(150, 2));
  const yt_20_cost = numVal(ws.getCell(151, 2));
  const hk_10t_cost = numVal(ws.getCell(152, 2));
  const yt_10t_cost = numVal(ws.getCell(153, 2));
  const hk_5t_cost = numVal(ws.getCell(154, 2));
  const yt_5t_cost = numVal(ws.getCell(155, 2));
  // transport_pct and handling_pct are calculated from the totals, not stored directly
  const transport_pct = null;
  const handling_pct = null;

  return {
    cuft_per_box, pcs_per_box: pcs_per_box ? Math.round(pcs_per_box) : null,
    truck_10t_cuft, truck_5t_cuft, container_40_cuft, container_20_cuft,
    hk_40_cost, hk_20_cost, yt_40_cost, yt_20_cost,
    hk_10t_cost, yt_10t_cost, hk_5t_cost, yt_5t_cost,
    transport_pct, handling_pct,
  };
}

// ─── Electronics Parser ──────────────────────────────────────────────────────

function parseElectronics(workbook, mainWs) {
  const electronicItems = [];

  // Try SPIN-format dedicated "电子" sheet first
  const elecWs = workbook.getWorksheet('电子') || workbook.worksheets.find(s => /^电子$/.test((s.name || '').trim()));
  if (elecWs) {
    // Find header row (contains "零件名称")
    let dataStartRow = 7;
    for (let r = 1; r <= Math.min(15, elecWs.rowCount); r++) {
      if (/零件名称/.test(strVal(elecWs.getCell(r, 1)) || '')) {
        dataStartRow = r + 1;
        break;
      }
    }
    for (let r = dataStartRow; r <= elecWs.rowCount; r++) {
      const part_name = strVal(elecWs.getCell(r, 1));
      if (!part_name) continue;
      // Stop at footer/summary rows
      if (/报价人|审核|小计|合计|总计|此报价/.test(part_name)) continue;
      // Stop if no numeric quantity and no USD price (non-data row)
      const quantity = numVal(elecWs.getCell(r, 3));
      if (quantity === null) continue;
      const spec     = strVal(elecWs.getCell(r, 2));
      const remark   = strVal(elecWs.getCell(r, 6));
      // Col H = 报客 USD unit price (already converted)
      const unit_price_usd = numVal(elecWs.getCell(r, 8)) || 0;
      const total_usd = Math.round(unit_price_usd * quantity * 10000) / 10000;
      electronicItems.push({ part_name, spec, quantity, unit_price_usd, total_usd, remark, sort_order: electronicItems.length });
    }
    return { electronicItems, electronicSummary: null };
  }

  // Fallback: read from main sheet rows where col A = "电子"
  if (mainWs) {
    for (let r = 1; r <= mainWs.rowCount; r++) {
      const row = mainWs.getRow(r);
      const colA = strVal(row.getCell(1));
      if (colA !== '电子') continue;
      const part_name = strVal(row.getCell(2));
      if (!part_name) continue;
      const quantity = numVal(row.getCell(3)) ?? 1;
      const unit_price_usd = Math.round((numVal(row.getCell(5)) || numVal(row.getCell(4)) || 0) * 1.08 * 100) / 100;
      const total_usd = Math.round(unit_price_usd * quantity * 10000) / 10000;
      electronicItems.push({ part_name, spec: null, quantity, unit_price_usd, total_usd, remark: null, sort_order: electronicItems.length });
    }
  }
  return { electronicItems, electronicSummary: null };
}

// ─── Painting Parser ─────────────────────────────────────────────────────────

function parsePainting(ws) {
  // Dynamically find 喷油人工 and 油漆 rows by scanning col B
  let laborRow = 0, paintRow = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    const b = strVal(ws.getCell(r, 2)) || '';
    const a = strVal(ws.getCell(r, 1)) || '';
    if (!laborRow && /喷油人工/.test(b + a)) laborRow = r;
    if (!paintRow  && /^油漆$/.test(b + a)) paintRow = r;
    if (laborRow && paintRow) break;
  }
  // If not found, return null values (no painting data)
  if (!laborRow && !paintRow) return {
    labor_cost_hkd: null, paint_cost_hkd: null,
    clamp_count: null, print_count: null, wipe_count: null, edge_count: null, spray_count: null,
    total_operations: null, quoted_price_hkd: null,
  };
  if (!paintRow) paintRow = laborRow + 1;

  const { col: priceCol } = detectPriceCol(ws);
  const labor_cost_hkd = laborRow ? (numVal(ws.getCell(laborRow, priceCol)) || numVal(ws.getCell(laborRow, 4)) || numVal(ws.getCell(laborRow, 3))) : null;
  const paint_cost_hkd = paintRow ? (numVal(ws.getCell(paintRow, priceCol)) || numVal(ws.getCell(paintRow, 4)) || numVal(ws.getCell(paintRow, 3))) : null;

  // Parse operation counts — try two strategies:
  // 1. Embedded in col B description: "喷油人工 (16夹23散39边)"
  // 2. Separate rows near laborRow with keyword in col B and count in col C or priceCol
  const paintDesc = strVal(ws.getCell(laborRow, 2)) || '';

  // Build a map of keyword -> count from nearby rows (scan ±15 rows around laborRow)
  const opRowMap = {}; // keyword -> numeric count
  const scanStart = Math.max(1, laborRow - 5);
  const scanEnd   = Math.min(ws.rowCount, laborRow + 15);
  for (let r = scanStart; r <= scanEnd; r++) {
    const label = (strVal(ws.getCell(r, 2)) || '') + (strVal(ws.getCell(r, 1)) || '');
    // Look for op-specific rows like "夹", "印", "抹油", "边", "散枪"
    const opMatch = label.match(/^(夹|散枪|散|印|抹油|抹|边)[次数]?$/);
    if (opMatch) {
      // Count is usually in col C (3) or col D (4) or priceCol
      const cnt = numVal(ws.getCell(r, 3)) ?? numVal(ws.getCell(r, 4)) ?? numVal(ws.getCell(r, priceCol));
      if (cnt != null) opRowMap[opMatch[1]] = cnt;
    }
  }

  function extractOp(suffixes) {
    // First check separate row map
    for (const s of suffixes) {
      if (opRowMap[s] != null) return opRowMap[s];
    }
    // Fall back to embedded description
    for (const s of suffixes) {
      const m = paintDesc.match(new RegExp('(\\d+)' + s));
      if (m) return parseInt(m[1]);
    }
    return null;
  }
  const clamp_count = extractOp(['夹']);
  const spray_count = extractOp(['散枪', '散']);
  const edge_count  = extractOp(['边']);
  const print_count = extractOp(['印']);
  const wipe_count  = extractOp(['抹油', '抹']);

  const opsSum = (clamp_count || 0) + (spray_count || 0) + (edge_count || 0) + (print_count || 0) + (wipe_count || 0);
  // If there's a painting quote but no operation counts found, default total to 1
  const total_operations = opsSum > 0 ? opsSum : ((labor_cost_hkd || paint_cost_hkd) ? 1 : null);

  return {
    labor_cost_hkd, paint_cost_hkd,
    clamp_count, print_count, wipe_count, edge_count, spray_count,
    total_operations,
    quoted_price_hkd: Math.round(((labor_cost_hkd || 0) + (paint_cost_hkd || 0)) * 1.08 * 100) / 100,
  };
}

// ─── Hardware Sheet Parser (五金 sheet or main sheet section → BodyAccessory) ──

// Known non-hardware item name patterns — stop collecting when encountered
const NON_HW_PATTERN = /搪胶|车缝|吊咭|留言纸|镭射|PE袋|胶针|扎带|平咭|外箱|印尼运费|包装辅料|生产夹具|拆货|围膜|合计|总计/;

function parseSpinHardwareFromMain(mainWs) {
  if (!mainWs) return [];
  const items = [];
  // First pass: find the header row and column for '五金名称'
  let headerRow = -1, nameCol = -1, priceCol = -1, qtyCol = -1;
  for (let r = 1; r <= mainWs.rowCount; r++) {
    for (let c = 1; c <= 30; c++) {
      const v = strVal(mainWs.getCell(r, c));
      if (v && v.includes('五金名称')) {
        headerRow = r;
        nameCol = c;
        // Look for 单价 and 用量 headers in the same row (nearby columns)
        for (let cc = c + 1; cc <= c + 5; cc++) {
          const hdr = strVal(mainWs.getCell(r, cc)) || '';
          if (/单价/.test(hdr)) priceCol = cc;
          if (/用量/.test(hdr)) qtyCol = cc;
        }
        // Fallback: assume next columns are 单价, 用量, 总价
        if (priceCol === -1) priceCol = c + 1;
        if (qtyCol === -1) qtyCol = c + 2;
        break;
      }
    }
    if (headerRow !== -1) break;
  }
  if (headerRow === -1 || nameCol === -1) return [];

  // Second pass: collect rows below header until empty name or 小计/合计
  for (let r = headerRow + 1; r <= mainWs.rowCount; r++) {
    const name = strVal(mainWs.getCell(r, nameCol));
    if (!name || /小计|合计|总计/.test(name)) break;
    const unitPrice = numVal(mainWs.getCell(r, priceCol)) || 0;
    const usageQty = numVal(mainWs.getCell(r, qtyCol)) || 1;
    if (!unitPrice) continue;
    items.push({ description: name, usage_qty: usageQty, unit_price: unitPrice, sort_order: items.length });
  }
  return items;
}

function parseHardwareSheet(workbook, mainWs) {
  // 1. Try dedicated 五金 sheet first
  const hwWs = workbook.getWorksheet('五金');
  if (hwWs && hwWs.rowCount > 0) {
    const items = [];
    hwWs.eachRow((row, rowNum) => {
      if (rowNum < 2) return;
      const name = strVal(row.getCell(1));
      if (!name || name === '名称' || name === '五金') return;
      items.push({
        description: name,
        usage_qty: numVal(row.getCell(2)) ?? 1,
        unit_price: numVal(row.getCell(3)) ?? 0,
        sort_order: items.length,
      });
    });
    if (items.length > 0) return items;
  }

  // 2. Fallback: scan the active (latest) sheet — rows where col A = "五金" or "利宝"
  if (!mainWs) return [];

  const { col: priceCol, moq: detectedMoq } = detectPriceCol(mainWs);

  const items = [];
  for (let r = 1; r <= mainWs.rowCount; r++) {
    const row = mainWs.getRow(r);
    const colA = strVal(row.getCell(1));
    if (colA !== '五金' && colA !== '利宝') continue;
    const name  = strVal(row.getCell(2));
    if (!name) continue;
    const usage_qty = numVal(row.getCell(3)) || 1;
    const amount_with_markup = Math.round((numVal(row.getCell(priceCol)) || 0) * 1.08 * 100) / 100;
    const unit_price = Math.round(amount_with_markup / usage_qty * 10000) / 10000;
    items.push({
      description: name,
      category: colA,  // '五金' or '利宝'
      usage_qty,
      moq: detectedMoq,
      unit_price,
      sort_order: items.length,
    });
  }
  return items;
}

// ─── SPIN Labor Parser (reads 人工 rows from main 报价明细 sheet) ──────────────

function parseSpinLaborFromMain(ws) {
  if (!ws) return [];
  // Row 15: English character names in cols 4–9 (Rocky, Skye, Marshall, Rex, Chase, Rubble)
  const chars = [];
  for (let c = 4; c <= 9; c++) {
    const name = strVal(ws.getCell(15, c));
    if (name) chars.push({ col: c, name });
  }
  if (!chars.length) return [];

  const LABOR_WHITELIST = /^(半成品人工|裁床人工|车缝人工|手工人工)/;
  const items = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const label = strVal(ws.getCell(r, 2));
    if (!label || !LABOR_WHITELIST.test(label)) continue;
    const laborRate = numVal(ws.getCell(r, 11)) || 0; // col 11 = labor rate (US$/hr)
    chars.forEach(({ col, name: charName }) => {
      const stdHour = numVal(ws.getCell(r, col));
      if (stdHour == null || stdHour <= 0) return;
      items.push({
        fabric_name: label,
        position: '__labor__',
        sub_product: charName,
        product_name: charName,
        product_eng: charName,
        usage_amount: stdHour,       // Standard Hour
        material_price_rmb: laborRate, // Labor rate (US$/hr)
        sort_order: items.length,
      });
    });
  }
  return items;
}

// ─── SPIN Other Cost Parser (车缝物料, PP胶料, 测试费 etc. from main sheet) ────

function parseSpinOtherFromMain(ws) {
  if (!ws) return [];
  const chars = [];
  for (let c = 4; c <= 9; c++) {
    const name = strVal(ws.getCell(15, c));
    if (name) chars.push({ col: c, name });
  }
  if (!chars.length) return [];

  const PACKAGING = /retail\s*box|master\s*car/i;
  const LABOR     = /^(半成品人工|裁床人工|车缝人工|手工人工)/;
  const SKIP      = /TOTAL|合计|利润|报客价|相差|汇率|纸箱|人工|料型|单价|模号|吊柜|运费|货号/;
  const items = [];

  for (let r = 16; r <= ws.rowCount; r++) {
    const colA = strVal(ws.getCell(r, 1));
    if (colA && PACKAGING.test(colA)) continue;  // packaging rows
    const label = strVal(ws.getCell(r, 2));
    if (!label || LABOR.test(label) || SKIP.test(label)) continue;
    // Must have at least one positive numeric value in cols 4-9
    const hasVal = chars.some(({ col }) => { const v = numVal(ws.getCell(r, col)); return v != null && v > 0; });
    if (!hasVal) continue;
    chars.forEach(({ col, name: charName }) => {
      const val = numVal(ws.getCell(r, col));
      if (val == null || val <= 0) return;
      items.push({
        fabric_name: label,
        position: '__other__',
        sub_product: charName,
        product_name: charName,
        product_eng: charName,
        usage_amount: 1,
        material_price_rmb: val,   // already USD — skips RMB conversion in UI
        sort_order: items.length,
      });
    });
  }
  return items;
}

// ─── SPIN Packaging Parser (Retail box / Master carton rows in summary sheet) ──

function findCartonPcsPerBox(mainWs) {
  // Find the outer carton (外箱) section: look for rows with both "箱价" and "数量"
  // that have "外箱" appearing in the rows above (within 10 rows)
  const candidates = [];
  for (let r = 1; r <= mainWs.rowCount; r++) {
    let hasBoxPrice = false, qtyCol = -1;
    for (let c = 1; c <= 30; c++) {
      const v = strVal(mainWs.getCell(r, c)) || '';
      if (/箱价/.test(v)) hasBoxPrice = true;
      if (/数量/.test(v) && !/实际/.test(v)) qtyCol = c;
    }
    if (hasBoxPrice && qtyCol !== -1) {
      for (let c = qtyCol + 1; c <= qtyCol + 3; c++) {
        const qty = numVal(mainWs.getCell(r, c));
        if (qty !== null && qty > 0) {
          // Check if "外箱" appears in nearby rows above
          let isOuter = false;
          for (let rr = Math.max(1, r - 10); rr <= r; rr++) {
            for (let cc = 1; cc <= 30; cc++) {
              if (/外箱/.test(strVal(mainWs.getCell(rr, cc)) || '')) { isOuter = true; break; }
            }
            if (isOuter) break;
          }
          candidates.push({ qty, isOuter });
          break;
        }
      }
    }
  }
  // Prefer the candidate associated with 外箱 section
  const outer = candidates.find(c => c.isOuter);
  if (outer) return outer.qty;
  // Fallback: return the largest qty found
  if (candidates.length) return Math.max(...candidates.map(c => c.qty));
  return null;
}

function parseSpinPackaging(mainWs, hkdUsd = 7.75) {
  if (!mainWs) return [];
  const items = [];
  const RETAIL = /retail\s*box/i;
  const CARTON = /master\s*car/i;

  const pcsPerBox = findCartonPcsPerBox(mainWs);

  for (let r = 1; r <= mainWs.rowCount; r++) {
    const colA = strVal(mainWs.getCell(r, 1));
    if (!colA) continue;

    const isRetail = RETAIL.test(colA);
    const isMaster = CARTON.test(colA);
    if (!isRetail && !isMaster) continue;

    const name = strVal(mainWs.getCell(r, 2));
    if (!name) continue;

    let qty, unitPrice;
    if (isMaster && /外箱/.test(name) && pcsPerBox) {
      // 外箱: qty = 1/pcsPerBox, unit price = col D (HKD) / hkdUsd * pcsPerBox
      qty = 1 / pcsPerBox;
      unitPrice = (numVal(mainWs.getCell(r, 4)) || 0) / hkdUsd * pcsPerBox;
    } else if (isMaster) {
      // Other master carton items: qty from col C (default 1), price from col D (HKD) / hkdUsd
      qty = numVal(mainWs.getCell(r, 3)) ?? 1;
      unitPrice = (numVal(mainWs.getCell(r, 4)) || 0) / hkdUsd;
    } else {
      // Retail box items: qty from col C (default 1), price from col D (HKD) → USD * 1.06
      qty = numVal(mainWs.getCell(r, 3)) ?? 1;
      unitPrice = (numVal(mainWs.getCell(r, 4)) || 0) / hkdUsd * 1.06;
    }

    items.push({
      name,
      eng_name: /[\u4e00-\u9fff]/.test(name) ? '' : name,
      quantity:  qty || 1,
      new_price: unitPrice,
      pkg_section: isRetail ? 'retail' : 'carton',
      sort_order: items.length,
    });
  }

  // Always add scotch tape & Tissue as fixed item in Master Carton
  if (!items.some(i => /scotch/i.test(i.name))) {
    items.push({
      name: 'scotch tape、Tissue',
      eng_name: 'scotch tape、Tissue',
      quantity: 1,
      new_price: 0.01,
      pkg_section: 'carton',
      sort_order: items.length,
    });
  }

  return items;
}

// ─── Packaging Items from Main Sheet (彩盒/吸塑/胶袋 rows) ──────────────────

const PKG_LABEL_PATTERN = /^(彩盒|吸塑|胶袋|杂项|纸箱)$/;

const ACCESSORIES_PATTERN   = /包装辅料/;
const PACKING_LABOUR_PATTERN = /拆货|包装人工/;

function parsePackagingFromMainSheet(mainWs, skipFixed = false) {
  if (!mainWs) return [];
  const items = [];
  let accessoriesTotal = 0;
  let packingLabourTotal = 0;

  const { col: priceCol, moq: detectedMoq } = detectPriceCol(mainWs);

  for (let r = 1; r <= mainWs.rowCount; r++) {
    const row = mainWs.getRow(r);
    const colA = strVal(row.getCell(1));
    const colB = strVal(row.getCell(2));

    // Collect 包装辅料 → Accessories
    if (colB && ACCESSORIES_PATTERN.test(colB)) {
      accessoriesTotal += numVal(row.getCell(priceCol)) || 0;
      continue;
    }

    // Collect 拆货 + 包装人工 → Packing Labour
    if (colB && PACKING_LABOUR_PATTERN.test(colB)) {
      packingLabourTotal += numVal(row.getCell(priceCol)) || 0;
      continue;
    }

    if (!colA || !PKG_LABEL_PATTERN.test(colA)) continue;
    if (colA === '纸箱') continue;  // 纸箱单独作为 carton_price，不进包装列表
    const rawName = colB;
    if (!rawName) continue;
    const splitM = rawName.match(/^(.+?)\s+([\d"'*].+)$/);
    const name   = splitM ? splitM[1].trim() : rawName;
    const spec   = splitM ? splitM[2].trim() : '';
    const usageQty = numVal(row.getCell(3)) ?? 1;
    const rawTotal = numVal(row.getCell(priceCol)) || 0;
    const totalWithMarkup = Math.round(rawTotal * 1.08 * 10000) / 10000;
    const unitPrice = usageQty > 0 ? Math.round(totalWithMarkup / usageQty * 10000) / 10000 : 0;
    items.push({
      pm_no:     '',
      name,
      remark:    spec,
      moq:       detectedMoq,
      quantity:  usageQty,
      new_price: unitPrice,
      sort_order: items.length,
    });
  }

  if (!skipFixed) {
    // Fixed row: Accessories (倒数第二)
    items.push({
      pm_no:     '',
      name:      'Accessories',
      remark:    '',
      moq:       detectedMoq,
      quantity:  1,
      new_price: 0.15,
      sort_order: items.length,
    });

    // Fixed row: Packing Labour (最后)
    items.push({
      pm_no:     '',
      name:      'Packing Labour',
      remark:    '',
      moq:       detectedMoq,
      quantity:  1,
      new_price: Math.round(packingLabourTotal * 1.08 * 10000) / 10000,
      sort_order: items.length,
    });
  }

  return items;
}

// ─── Main Parse Function ─────────────────────────────────────────────────────

async function parseWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetName = detectLatestSheet(workbook);
  const ws = workbook.getWorksheet(sheetName);

  if (!ws) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`);
  }

  const format = detectFormat(workbook);
  const header = parseHeader(ws, format, workbook);

  // Fall back to sheet name only if B1 is empty
  if (!header.product_no) {
    header.product_no = sheetName;
  }

  // Use sheet name date if it's newer than the date_code from cell A15/B15/C15
  // e.g. sheet "报价明细-260310" → "20260310", overrides stale cell value "20250207"
  const sheetDateMatch = sheetName.match(/(\d{6,8})/);
  if (sheetDateMatch) {
    const sheetDate = sheetDateMatch[1].length === 6 ? '20' + sheetDateMatch[1] : sheetDateMatch[1];
    const cellDateMatch = (header.date_code || '').match(/\d{6,8}/);
    const cellDate = cellDateMatch ? (cellDateMatch[0].length === 6 ? '20' + cellDateMatch[0] : cellDateMatch[0]) : '0';
    if (sheetDate > cellDate) {
      header.date_code = sheetDate;
    }
  }

  const moldStartRow = format === 'spin' ? 12 : format === 'plush' ? 17 : 18;
  let moldParts, rotocastItems, sewingDetails, bodyAccessories;
  try { moldParts = parseMoldParts(ws, moldStartRow); } catch(e) { throw new Error('parseMoldParts: ' + e.message); }
  try { rotocastItems = format === 'plush' ? parseRotocastItems(ws) : []; } catch(e) { throw new Error('parseRotocastItems: ' + e.message); }
  try { sewingDetails = (format === 'plush' || format === 'spin') ? parseSewingDetails(workbook) : []; } catch(e) { throw new Error('parseSewingDetails: ' + e.message); }
  // For SPIN: replace labor items with values from main sheet, and merge
  // in the "其他费用" rows (车缝物料 / PP胶料 / 测试费 etc.) that live in
  // the main sheet (not in 车缝明细 sheets).
  if (format === 'spin') {
    const mainLaborItems = parseSpinLaborFromMain(ws);
    if (mainLaborItems.length > 0) {
      sewingDetails = [
        ...sewingDetails.filter(d => !/人工/.test(d.fabric_name || '')),
        ...mainLaborItems,
      ];
    }
    const otherItems = parseSpinOtherFromMain(ws);
    if (otherItems.length > 0) {
      sewingDetails = [...sewingDetails, ...otherItems];
    }
  }
  if (format === 'spin') {
    bodyAccessories = parseSpinHardwareFromMain(ws);
  } else {
    try { bodyAccessories = parseHardwareSheet(workbook, ws); } catch(e) { throw new Error('parseHardwareSheet: ' + e.message); }
  }

  const packagingFromMain = format === 'spin' ? [] : parsePackagingFromMainSheet(ws);
  const hkdUsd = parseFloat(header.params && header.params.hkd_usd) || 7.75;
  const spinPackaging = format === 'spin' ? parseSpinPackaging(ws, hkdUsd) : [];
  const costItems = parseCostItems(ws, format);
  const summary = parseSummary(ws);
  const transport = parseTransport(ws);
  const { electronicItems, electronicSummary } = parseElectronics(workbook, ws);
  const paintingDetail = parsePainting(ws);

  return {
    format_type: format,
    sheetName,
    product: {
      product_no: header.product_no,
      date_code: header.date_code,
      ref_no: header.ref_no,
      item_desc: header.item_desc,
    },
    params: header.params,
    materialPrices: header.materialPrices,
    machinePrices: header.machinePrices,
    moldParts,
    rotocastItems,
    sewingDetails,
    bodyAccessories,
    hardwareItems: format === 'spin' ? bodyAccessories.map(b => ({
      name: b.description,
      quantity: b.usage_qty,
      new_price: b.unit_price,
      part_category: 'hardware',
      sort_order: b.sort_order,
    })) : costItems.hardwareItems,
    laborItems: costItems.laborItems,
    packagingItems: format === 'spin'
      ? spinPackaging
      : (packagingFromMain.length > 0 ? packagingFromMain : costItems.packagingItems),
    electronicItems,
    electronicSummary,
    paintingDetail,
    transportConfig: transport,
    productDimension: summary.dimensions,
    moldCost: summary.moldCost,
    pricing: summary.pricing,
  };
}

module.exports = { parseWorkbook, detectLatestSheet, detectFormat };
