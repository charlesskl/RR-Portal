const ExcelJS = require('exceljs');

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

// ─── Sheet Detection ──────────────────────────────────────────────────────────

function detectFormat(workbook) {
  const sheetNames = workbook.worksheets.map(ws => ws.name);
  const hasPlushIndicator = sheetNames.some(n =>
    n.includes('车缝明细') || n.includes('搪胶')
  );
  return hasPlushIndicator ? 'plush' : 'injection';
}

function detectLatestSheet(workbook) {
  const sheets = workbook.worksheets.map(ws => ws.name);

  // Extract trailing date/number from any sheet name for sorting
  function parseSheetDate(name) {
    const m = name.match(/(\d{6})$/);   // YYMMDD at end
    if (m) return parseInt(m[1], 10);
    const m2 = name.match(/(\d{4})$/);  // MMDD or sequence at end
    if (m2) return parseInt(m2[1], 10);
    const vm = name.match(/V(\d+)$/i);  // V2, V3 style
    if (vm) return parseInt(vm[1], 10);
    return 0;
  }

  // Prefer "报价明细" sheets (injection format)
  const mingxiCandidates = sheets.filter(n => n.includes('报价明细'));
  if (mingxiCandidates.length > 0) {
    mingxiCandidates.sort((a, b) => parseSheetDate(b) - parseSheetDate(a));
    return mingxiCandidates[0];
  }

  // Fallback: any sheet containing "报价" — pick latest by date suffix
  const quoteCandidates = sheets.filter(n => n.includes('报价'));
  if (quoteCandidates.length > 0) {
    quoteCandidates.sort((a, b) => parseSheetDate(b) - parseSheetDate(a));
    return quoteCandidates[0];
  }

  // Last resort: first sheet
  return sheets[0];
}

// ─── Header Parser (R1–R16) ───────────────────────────────────────────────────

function parseHeader(ws, format) {
  // R1: product_no
  // Injection: A1="产品编号：", B1=value
  // Plush:     B1="产品编号：", C1=value
  // Try B1 first; if it looks like a label, use C1
  let product_no = strVal(ws.getCell('B1'));
  if (!product_no || (typeof product_no === 'string' && product_no.includes('编号'))) {
    product_no = strVal(ws.getCell('C1'));
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
  };
}

// ─── Mold Parts Parser (R17+) ────────────────────────────────────────────────

function parseMoldParts(ws, startRow = 18) {
  const moldParts = [];

  // startRow: 18 for injection (header R17), 17 for plush (header R16)
  let row = startRow;
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
  // R20: header (模号 | 名称 | 出数 | 用量pcs | 单价HK | 合计 | 备注)
  // R21+: data until 合计 row
  let row = 21;
  let sortOrder = 0;

  while (row <= 40) {
    const colF = strVal(ws.getCell(row, 6));  // col F = 合计 label in template
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
  const sewingSheet = wsNames.find(n => n.includes('车缝明细'));
  if (!sewingSheet) return [];

  const ws = workbook.getWorksheet(sewingSheet);
  const items = [];
  let currentProductName = null;
  let lastFabricName = null;
  let sortOrder = 0;

  for (let row = 4; row <= 100; row++) {
    const colI = strVal(ws.getCell(row, 9));
    if (colI && colI.includes('合计')) break;

    const colB = strVal(ws.getCell(row, 2));
    const colC = strVal(ws.getCell(row, 3));
    const colD = strVal(ws.getCell(row, 4));

    // Product name row: B has value but C and D are empty
    if (colB && !colC && !colD) {
      currentProductName = colB;
      continue;
    }

    if (!colC && !colD) continue;

    // Inherit fabric_name from previous row if merged cell left it empty
    if (colC) lastFabricName = colC;
    const fabricName = colC || lastFabricName;

    // Mark labor rows with special position value
    const position = fabricName === '人工' ? '__labor__' : colD;

    items.push({
      product_name: currentProductName,
      fabric_name: fabricName,
      position,
      cut_pieces: numVal(ws.getCell(row, 5)) ? Math.round(numVal(ws.getCell(row, 5))) : null,
      usage_amount: numVal(ws.getCell(row, 6)),
      material_price_rmb: Math.round((numVal(ws.getCell(row, 7)) || 0) * 1.08 * 100) / 100,
      price_rmb: numVal(ws.getCell(row, 8)),
      markup_point: numVal(ws.getCell(row, 9)) || 1.15,
      total_price_rmb: numVal(ws.getCell(row, 10)),
      sort_order: sortOrder++,
    });
  }
  return items;
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
  if (format === 'plush') {
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

  // Dimensions at R108-R110, columns H(8)/J(10)/L(12)
  // R107: headers (L, W, H)
  // R108: product dimensions in inches
  // R109: carton dimensions in inches; I109 = paper type (e.g. "A=B")
  // R110: CU.FT, carton price, pcs per carton
  const product_l = numVal(ws.getCell(108, 8));    // H108
  const product_w = numVal(ws.getCell(108, 10));   // J108
  const product_h = numVal(ws.getCell(108, 12));   // L108
  const carton_l = numVal(ws.getCell(109, 9));     // I109 = L (A+B)
  const carton_w = numVal(ws.getCell(109, 11));    // K109 = W
  const carton_h = numVal(ws.getCell(109, 13));    // M109 = H
  const carton_paper = strVal(ws.getCell(109, 8)); // H109 = 纸板
  const carton_cuft = numVal(ws.getCell(110, 8));  // H110
  const pcs_per_carton = numVal(ws.getCell(110, 12)); // L110

  // Carton price + case pack: scan main sheet for col A="纸箱", col B contains "纸箱"
  let carton_price = numVal(ws.getCell(110, 10)) || 0; // J110 fallback
  let case_pack = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const colA = strVal(row.getCell(1));
    const colB = strVal(row.getCell(2));
    if (colB && /纸箱/.test(colB) && colA === '纸箱') {
      const rawPrice = numVal(row.getCell(5)) || 0;
      carton_price = Math.round(rawPrice * 1.08 * 100) / 100;
      case_pack = strVal(row.getCell(3)) || null; // keep raw text e.g. "1/2"
      break;
    }
  }

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
  // Read from main sheet: rows where col A = "电子"
  // Columns: A=label, B=part_name, C=quantity, D=old_price, E=new_price
  const electronicItems = [];
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
  // R46: 喷油人工, R47: 油漆 — labor costs
  const labor_cost_hkd = numVal(ws.getCell('E46')) || numVal(ws.getCell('D46')) || numVal(ws.getCell('C46'));
  const paint_cost_hkd = numVal(ws.getCell('E47')) || numVal(ws.getCell('D47')) || numVal(ws.getCell('C47'));

  // Parse operation counts from R46 col B description, e.g. "喷油人工 (16夹23散39边02珠)"
  // Suffixes: 夹=clamp, 散枪/散=spray, 边=edge, 印=print, 抹=wipe
  const paintDesc = strVal(ws.getCell('B46')) || '';
  function extractOp(suffixes) {
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
  const wipe_count  = extractOp(['抹']);

  const total_operations = (clamp_count || 0) + (spray_count || 0) + (edge_count || 0)
    + (print_count || 0) + (wipe_count || 0) || null;

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

  const items = [];
  for (let r = 1; r <= mainWs.rowCount; r++) {
    const row = mainWs.getRow(r);
    const colA = strVal(row.getCell(1));
    if (colA !== '五金' && colA !== '利宝') continue;
    const name  = strVal(row.getCell(2));
    if (!name) continue;
    items.push({
      description: name,
      category: colA,  // '五金' or '利宝'
      usage_qty: numVal(row.getCell(3)) ?? 1,
      unit_price: Math.round((numVal(row.getCell(5)) || 0) * 1.08 * 100) / 100,
      sort_order: items.length,
    });
  }
  return items;
}

// ─── Packaging Items from Main Sheet (彩盒/吸塑/胶袋 rows) ──────────────────

const PKG_LABEL_PATTERN = /^(彩盒|吸塑|胶袋|杂项|纸箱)$/;

const ACCESSORIES_PATTERN   = /包装辅料/;
const PACKING_LABOUR_PATTERN = /拆货|包装人工/;

function parsePackagingFromMainSheet(mainWs) {
  if (!mainWs) return [];
  const items = [];
  let accessoriesTotal = 0;
  let packingLabourTotal = 0;

  for (let r = 1; r <= mainWs.rowCount; r++) {
    const row = mainWs.getRow(r);
    const colA = strVal(row.getCell(1));
    const colB = strVal(row.getCell(2));

    // Collect 包装辅料 → Accessories
    if (colB && ACCESSORIES_PATTERN.test(colB)) {
      accessoriesTotal += numVal(row.getCell(5)) || 0;
      continue;
    }

    // Collect 拆货 + 包装人工 → Packing Labour
    if (colB && PACKING_LABOUR_PATTERN.test(colB)) {
      packingLabourTotal += numVal(row.getCell(5)) || 0;
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
    const rawTotal = numVal(row.getCell(5)) || 0;
    const totalWithMarkup = Math.round(rawTotal * 1.08 * 10000) / 10000;
    const unitPrice = usageQty > 0 ? Math.round(totalWithMarkup / usageQty * 10000) / 10000 : 0;
    items.push({
      pm_no:     '',
      name,
      remark:    spec,
      moq:       2500,
      quantity:  usageQty,
      new_price: unitPrice,
      sort_order: items.length,
    });
  }

  // Fixed row: Accessories (倒数第二)
  items.push({
    pm_no:     '',
    name:      'Accessories',
    remark:    '',
    moq:       null,
    quantity:  1,
    new_price: 0.15,
    sort_order: items.length,
  });

  // Fixed row: Packing Labour (最后)
  items.push({
    pm_no:     '',
    name:      'Packing Labour',
    remark:    '',
    moq:       null,
    quantity:  1,
    new_price: Math.round(packingLabourTotal * 1.08 * 10000) / 10000,
    sort_order: items.length,
  });

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
  const header = parseHeader(ws, format);

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

  const moldStartRow = format === 'plush' ? 17 : 18;
  const moldParts = parseMoldParts(ws, moldStartRow);

  // Plush-specific parsing
  const rotocastItems = format === 'plush' ? parseRotocastItems(ws) : [];
  const sewingDetails = format === 'plush' ? parseSewingDetails(workbook) : [];
  const bodyAccessories = parseHardwareSheet(workbook, ws);

  const packagingFromMain = parsePackagingFromMainSheet(ws);
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
    },
    params: header.params,
    materialPrices: header.materialPrices,
    machinePrices: header.machinePrices,
    moldParts,
    rotocastItems,
    sewingDetails,
    bodyAccessories,
    hardwareItems: costItems.hardwareItems,
    laborItems: costItems.laborItems,
    packagingItems: packagingFromMain.length > 0 ? packagingFromMain : costItems.packagingItems,
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
