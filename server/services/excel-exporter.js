/**
 * Excel Export Service
 * Generates a styled .xlsx VQ summary workbook from versionData
 */
const ExcelJS = require('exceljs');
const { getDb } = require('./db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v, d = 4) {
  const num = parseFloat(v);
  return isNaN(num) ? null : parseFloat(num.toFixed(d));
}

function pct(v) {
  const num = parseFloat(v);
  return isNaN(num) ? '—' : (num * 100).toFixed(1) + '%';
}

// Style helpers
const STYLES = {
  title:   { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a3c6e' } }, alignment: { horizontal: 'center', vertical: 'middle' } },
  section: { font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2d6cb4' } }, alignment: { vertical: 'middle' } },
  header:  { font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4a7dbf' } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } },
  label:   { font: { size: 10 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFeef2fb' } }, alignment: { vertical: 'middle' } },
  total:   { font: { bold: true, size: 10 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFdce8f8' } }, alignment: { vertical: 'middle' } },
  grand:   { font: { bold: true, size: 11, color: { argb: 'FF003366' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef9e7' } }, alignment: { vertical: 'middle' } },
  num:     { alignment: { horizontal: 'right', vertical: 'middle' } },
  plain:   { font: { size: 10 }, alignment: { vertical: 'middle' } },
};

function applyStyle(row, style) {
  row.eachCell({ includeEmpty: true }, cell => {
    if (style.font) Object.assign(cell.font || (cell.font = {}), style.font);
    if (style.fill) cell.fill = style.fill;
    if (style.alignment) cell.alignment = style.alignment;
  });
}

function border(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFccddee' } },
    left: { style: 'thin', color: { argb: 'FFccddee' } },
    bottom: { style: 'thin', color: { argb: 'FFccddee' } },
    right: { style: 'thin', color: { argb: 'FFccddee' } },
  };
}

function borderRow(row) {
  row.eachCell({ includeEmpty: true }, cell => border(cell));
}

// ─── Load version data from DB ─────────────────────────────────────────────────

function loadVersionData(versionId) {
  const db = getDb();
  const version = db.prepare('SELECT * FROM QuoteVersion WHERE id = ?').get(versionId);
  if (!version) throw new Error(`Version ${versionId} not found`);
  const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(version.product_id);
  const params  = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(versionId) || {};
  return {
    version,
    product,
    params,
    mold_parts:        db.prepare('SELECT * FROM MoldPart WHERE version_id = ? ORDER BY sort_order').all(versionId),
    hardware_items:    db.prepare('SELECT * FROM HardwareItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    packaging_items:   db.prepare('SELECT * FROM PackagingItem WHERE version_id = ? ORDER BY sort_order').all(versionId),
    painting_detail:   db.prepare('SELECT * FROM PaintingDetail WHERE version_id = ?').get(versionId) || {},
    electronic_summary:db.prepare('SELECT * FROM ElectronicSummary WHERE version_id = ?').get(versionId) || {},
    transport_config:  db.prepare('SELECT * FROM TransportConfig WHERE version_id = ?').get(versionId) || {},
    mold_cost:         db.prepare('SELECT * FROM MoldCost WHERE version_id = ?').get(versionId) || {},
    product_dimension: db.prepare('SELECT * FROM ProductDimension WHERE version_id = ?').get(versionId) || {},
    material_prices:   db.prepare('SELECT * FROM MaterialPrice WHERE version_id = ? ORDER BY id').all(versionId),
    machine_prices:    db.prepare('SELECT * FROM MachinePrice WHERE version_id = ? ORDER BY id').all(versionId),
  };
}

// ─── Cost Calculations (mirrors frontend vq-summary logic) ────────────────────

function calcSummary(d) {
  const { params = {}, mold_parts = [], hardware_items = [], packaging_items = [],
          painting_detail: pd = {}, transport_config: tc = {},
          product_dimension: dim = {}, mold_cost: mc = {} } = d;

  const markupBody  = parseFloat(params.markup_body) || 0;
  const markupPkg   = parseFloat(params.markup_packaging) || 0;
  const markupPoint = parseFloat(params.markup_point) || 1;
  const paymentDiv  = parseFloat(params.payment_divisor) || 0.98;
  const surcharge   = parseFloat(params.surcharge_pct) || 0.004;
  const boxPrice    = parseFloat(params.box_price_hkd) || 0;
  const hkdUsd      = parseFloat(params.hkd_usd) || 0.1291;
  const rmb_hkd     = parseFloat(params.rmb_hkd) || 0.85;

  const rawSub  = mold_parts.reduce((s, p) => s + (parseFloat(p.material_cost_hkd) || 0), 0);
  const moldSub = mold_parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0), 0);
  const purSub  = hardware_items.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
  const decSub  = (parseFloat(pd.labor_cost_hkd) || 0) + (parseFloat(pd.paint_cost_hkd) || 0);

  const rawAmt  = rawSub  * (1 + markupBody);
  const moldAmt = moldSub * (1 + markupBody);
  const purAmt  = purSub  * (1 + markupBody);
  const decAmt  = decSub  * (1 + markupBody);
  const bodyCost = rawAmt + moldAmt + purAmt + decAmt;

  const pkgItems = packaging_items.reduce((s, i) => s + (parseFloat(i.new_price) || 0), 0);
  const packagingTotal = (pkgItems + boxPrice) * (1 + markupPkg);

  const cartonPrice   = parseFloat(dim.carton_price) || 0;
  const pcsPerCarton  = parseInt(dim.pcs_per_carton) || 1;
  const cartonPerPc   = pcsPerCarton > 0 ? cartonPrice / pcsPerCarton : 0;

  const subBeforeTransport = bodyCost + packagingTotal + cartonPerPc;

  const cuft      = parseFloat(tc.cuft_per_box) || 0;
  const pcsPerBox = parseFloat(tc.pcs_per_box) || 1;
  const yt40Cost  = parseFloat(tc.yt_40_cost) || 0;
  const yt40Cuft  = parseFloat(tc.container_40_cuft) || 0;

  function transportPerPc(containerCuft, shippingCost, moq) {
    if (!containerCuft || !cuft || !moq) return 0;
    const boxes = Math.ceil(moq / pcsPerBox);
    const cuftNeeded = boxes * cuft;
    return (shippingCost / containerCuft) * cuftNeeded / moq;
  }

  const moldAmortRmb = parseFloat(mc.amortization_rmb) || 0;
  const moldPerPc = rmb_hkd > 0 ? moldAmortRmb / rmb_hkd : 0;

  const moqs = [2500, 5000, 10000, 15000];
  const matrix = moqs.map(moq => {
    const trans = transportPerPc(yt40Cuft, yt40Cost, moq);
    const subTotal = subBeforeTransport + trans;
    const surchargeAmt = subTotal * surcharge;
    const afterSurcharge = subTotal + surchargeAmt;
    const withPoint = afterSurcharge * markupPoint;
    const totalHkd = withPoint / paymentDiv;
    const totalUsd = totalHkd * hkdUsd;
    return {
      moq, rawAmt, moldAmt, purAmt, decAmt, bodyCost, packagingTotal, cartonPerPc,
      transport: trans, subTotal, surchargeAmt, markupPointAmt: withPoint - afterSurcharge,
      withPoint, totalHkd, totalUsd,
      totalWithMoldHkd: totalHkd + moldPerPc,
      totalWithMoldUsd: (totalHkd + moldPerPc) * hkdUsd,
    };
  });

  return { matrix, bodyCost, packagingTotal, cartonPerPc, moldPerPc,
    rawAmt, moldAmt, purAmt, decAmt,
    params: { markupBody, markupPkg, markupPoint, paymentDiv, surcharge, hkdUsd, rmb_hkd, boxPrice } };
}

// ─── Sheet 1: VQ Summary ──────────────────────────────────────────────────────

function buildSummarySheet(wb, d, calc) {
  const ws = wb.addWorksheet('VQ Summary');
  const moqs = calc.matrix.map(r => r.moq);
  const cols = 1 + moqs.length; // label + N moq columns

  ws.columns = [
    { width: 28 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  // Title row
  ws.mergeCells(1, 1, 1, cols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Vendor Quotation — ${d.product?.item_no || ''} ${d.product?.item_desc || ''}`;
  Object.assign(titleCell, STYLES.title);
  ws.getRow(1).height = 28;

  // Info rows
  function infoRow(label, value) {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(2).font = { size: 10 };
    ws.mergeCells(r.number, 2, r.number, cols);
    borderRow(r);
    r.height = 16;
  }

  infoRow('品名 Item No.', d.product?.item_no || '');
  infoRow('描述 Description', d.product?.item_desc || '');
  infoRow('厂家 Vendor', d.product?.vendor || '');
  infoRow('版本 Version', d.version?.version_name || d.version?.source_sheet || '');
  infoRow('日期 Date', d.version?.quote_date || d.version?.date_code || '');

  ws.addRow([]); // spacer

  // MOQ header
  const hdrRow = ws.addRow(['项目', ...moqs.map(q => `${(q/1000).toFixed(1)}K pcs`)]);
  applyStyle(hdrRow, STYLES.header);
  borderRow(hdrRow);
  hdrRow.height = 20;

  // Cost rows helper
  function costRow(label, vals, style = STYLES.plain) {
    const r = ws.addRow([label, ...vals.map(v => n(v))]);
    applyStyle(r, style);
    r.eachCell((cell, col) => {
      if (col > 1) { cell.numFmt = '#,##0.0000'; cell.alignment = { horizontal: 'right', vertical: 'middle' }; }
      border(cell);
    });
    r.height = 16;
    return r;
  }

  const m = calc.matrix;
  costRow('A. Body Cost HKD',             m.map(r => r.bodyCost), STYLES.label);
  costRow('  A1. Raw Material',           m.map(r => r.rawAmt), STYLES.plain);
  costRow('  A2. Molding Labour',         m.map(r => r.moldAmt), STYLES.plain);
  costRow('  A3. Purchase Parts',         m.map(r => r.purAmt), STYLES.plain);
  costRow('  A4. Decoration',             m.map(r => r.decAmt), STYLES.plain);
  costRow('B. Packaging HKD',             m.map(r => r.packagingTotal), STYLES.label);
  costRow('D. Master Carton /pc HKD',     m.map(r => r.cartonPerPc), STYLES.label);
  costRow('E. Transport /pc HKD (YT40)',  m.map(r => r.transport), STYLES.label);
  costRow('小计 Sub Total HKD',           m.map(r => r.subTotal), STYLES.total);
  costRow(`附加税 (${(calc.params.surcharge*100).toFixed(2)}%)`, m.map(r => r.surchargeAmt), STYLES.plain);
  costRow(`码点 ×${calc.params.markupPoint.toFixed(4)}`,        m.map(r => r.markupPointAmt), STYLES.plain);
  costRow(`找数 ÷${calc.params.paymentDiv.toFixed(4)}`,         m.map(r => r.totalHkd - r.withPoint), STYLES.plain);
  costRow('合计 Total HKD',               m.map(r => r.totalHkd), STYLES.total);
  costRow('合计 Total USD',               m.map(r => r.totalUsd), STYLES.total);

  ws.addRow([]); // spacer

  costRow('模费摊销 /pc HKD',             m.map(() => calc.moldPerPc), STYLES.plain);
  costRow('含模费 Total HKD',             m.map(r => r.totalWithMoldHkd), STYLES.grand);
  costRow('含模费 Total USD',             m.map(r => r.totalWithMoldUsd), STYLES.grand);

  ws.addRow([]);

  // Parameters block
  const pRow = ws.addRow(['参数 Parameters']);
  applyStyle(pRow, STYLES.section);
  ws.mergeCells(pRow.number, 1, pRow.number, cols);
  pRow.height = 18;

  const { params: p } = calc;
  function paramRow(label, value) {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { size: 10 };
    r.getCell(2).font = { bold: true, size: 10 };
    r.getCell(2).alignment = { horizontal: 'right' };
    ws.mergeCells(r.number, 2, r.number, cols);
    borderRow(r);
    r.height = 15;
  }
  paramRow('HKD / USD',        p.hkdUsd);
  paramRow('RMB → HKD',        p.rmb_hkd);
  paramRow('Body Mark Up',     pct(p.markupBody));
  paramRow('Packaging Mark Up',pct(p.markupPkg));
  paramRow('Box Price HKD',    n(p.boxPrice, 4));
  paramRow('附加税率',          pct(p.surcharge));
  paramRow('码点',              `×${p.markupPoint.toFixed(4)}`);
  paramRow('找数',              `÷${p.paymentDiv.toFixed(4)}`);
}

// ─── Sheet 2: Body Cost Breakdown ─────────────────────────────────────────────

function buildBdSheet(wb, d) {
  const ws = wb.addWorksheet('Body Cost Breakdown');

  ws.columns = [
    { width: 8 }, { width: 22 }, { width: 8 }, { width: 10 },
    { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
  ];

  function secHeader(label) {
    const r = ws.addRow([label]);
    ws.mergeCells(r.number, 1, r.number, 9);
    applyStyle(r, STYLES.section);
    r.height = 18;
  }

  function colHeader(labels) {
    const r = ws.addRow(labels);
    applyStyle(r, STYLES.header);
    borderRow(r);
    r.height = 18;
  }

  // A. Raw Material
  secHeader('A. Raw Material Cost');
  colHeader(['模号', '名称/描述', '料型', '料重(g)', '料价HKD/g', '料金额HKD', '', '', '']);
  d.mold_parts.forEach(p => {
    const r = ws.addRow([p.part_no, p.description, p.material, n(p.weight_g, 4),
      n(p.unit_price_hkd_g, 6), n(p.material_cost_hkd, 4)]);
    applyStyle(r, STYLES.plain);
    [4,5,6].forEach(c => { r.getCell(c).numFmt = '#,##0.0000'; r.getCell(c).alignment = { horizontal: 'right' }; });
    borderRow(r);
    r.height = 15;
  });
  const rawSub = d.mold_parts.reduce((s, p) => s + (parseFloat(p.material_cost_hkd) || 0), 0);
  const rSumRow = ws.addRow(['', '合计', '', '', '', n(rawSub, 4)]);
  applyStyle(rSumRow, STYLES.total);
  rSumRow.getCell(6).numFmt = '#,##0.0000';
  rSumRow.getCell(6).alignment = { horizontal: 'right' };
  borderRow(rSumRow);

  ws.addRow([]);

  // B. Molding Labour
  secHeader('B. Molding Labour Cost');
  colHeader(['模号', '名称', '机型', '出模件数', '出模套数', '目标数', '啤工HKD', '', '']);
  d.mold_parts.forEach(p => {
    const r = ws.addRow([p.part_no, p.description, p.machine_type,
      p.cavity_count, p.sets_per_toy, p.target_qty, n(p.molding_labor, 4)]);
    applyStyle(r, STYLES.plain);
    r.getCell(7).numFmt = '#,##0.0000';
    r.getCell(7).alignment = { horizontal: 'right' };
    borderRow(r);
    r.height = 15;
  });
  const moldSub = d.mold_parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0), 0);
  const mSumRow = ws.addRow(['', '合计', '', '', '', '', n(moldSub, 4)]);
  applyStyle(mSumRow, STYLES.total);
  mSumRow.getCell(7).numFmt = '#,##0.0000';
  mSumRow.getCell(7).alignment = { horizontal: 'right' };
  borderRow(mSumRow);

  ws.addRow([]);

  // C. Purchase Parts
  secHeader('C. Purchase Parts Cost');
  colHeader(['名称', '用量', '开模报价', '样板报价', '差额', '含税', '', '', '']);
  d.hardware_items.forEach(h => {
    const r = ws.addRow([h.name, h.quantity, n(h.old_price, 4), n(h.new_price, 4),
      n(h.difference, 4), h.tax_type || '']);
    applyStyle(r, STYLES.plain);
    [3,4,5].forEach(c => { r.getCell(c).numFmt = '#,##0.0000'; r.getCell(c).alignment = { horizontal: 'right' }; });
    borderRow(r);
    r.height = 15;
  });

  ws.addRow([]);

  // D. Decoration
  secHeader('D. Decoration (喷油)');
  const pd = d.painting_detail || {};
  colHeader(['项目', '数值', '', '', '', '', '', '', '']);
  [
    ['夹 (Clamp)', pd.clamp_count], ['印 (Print)', pd.print_count],
    ['抹油 (Wipe)', pd.wipe_count], ['边 (Edge)', pd.edge_count],
    ['散枪 (Spray)', pd.spray_count], ['总次数', pd.total_operations],
    ['喷油人工 HKD', pd.labor_cost_hkd], ['油漆 HKD', pd.paint_cost_hkd],
    ['报价 HKD', pd.quoted_price_hkd],
  ].forEach(([lbl, val]) => {
    const r = ws.addRow([lbl, val != null ? n(val, 4) : '—']);
    applyStyle(r, STYLES.plain);
    borderRow(r);
    r.height = 15;
  });
}

// ─── Sheet 3: Packaging ───────────────────────────────────────────────────────

function buildPkgSheet(wb, d) {
  const ws = wb.addWorksheet('Packaging');
  ws.columns = [
    { width: 28 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 10 },
  ];

  const hdr = ws.addRow(['Packaging — B. 包装材料']);
  ws.mergeCells(1, 1, 1, 6);
  applyStyle(hdr, STYLES.title);
  hdr.height = 24;

  const colHdr = ws.addRow(['名称', '用量', '开模报价', '样板报价', '差额', '含税']);
  applyStyle(colHdr, STYLES.header);
  borderRow(colHdr);
  colHdr.height = 18;

  d.packaging_items.forEach(item => {
    const r = ws.addRow([item.name, item.quantity, n(item.old_price, 4),
      n(item.new_price, 4), n(item.difference, 4), item.tax_type || '']);
    applyStyle(r, STYLES.plain);
    [3,4,5].forEach(c => { r.getCell(c).numFmt = '#,##0.0000'; r.getCell(c).alignment = { horizontal: 'right' }; });
    borderRow(r);
    r.height = 15;
  });

  const boxPrice = parseFloat(d.params?.box_price_hkd) || 0;
  const boxRow = ws.addRow(['纸箱 (Box)', 1, '', n(boxPrice, 4), '']);
  applyStyle(boxRow, STYLES.label);
  boxRow.getCell(4).numFmt = '#,##0.0000';
  boxRow.getCell(4).alignment = { horizontal: 'right' };
  borderRow(boxRow);
}

// ─── Sheet 4: Mold Cost ───────────────────────────────────────────────────────

function buildMoldSheet(wb, d) {
  const ws = wb.addWorksheet('Mold Cost');
  ws.columns = [{ width: 28 }, { width: 16 }, { width: 16 }];

  const hdr = ws.addRow(['模费 Mold Cost']);
  ws.mergeCells(1, 1, 1, 3);
  applyStyle(hdr, STYLES.title);
  hdr.height = 24;

  const mc = d.mold_cost || {};
  [
    ['开模费 RMB',     mc.mold_cost_rmb],
    ['五金模费 RMB',   mc.hardware_mold_cost_rmb],
    ['喷油模费 RMB',   mc.paint_mold_cost_rmb],
    ['模费合计 RMB',   mc.total_mold_rmb],
    ['模费合计 USD',   mc.total_mold_usd],
    ['客户补贴 USD',   mc.customer_subsidy_usd],
    ['摊销数量',       mc.amortization_qty],
    ['摊销金额 RMB',   mc.amortization_rmb],
    ['摊销金额 USD',   mc.amortization_usd],
    ['客户报价 USD',   mc.customer_quote_usd],
  ].forEach(([label, val]) => {
    const r = ws.addRow([label, val != null ? n(val, 4) : '—']);
    const isTot = label.includes('合计') || label.includes('摊销金额');
    applyStyle(r, isTot ? STYLES.total : STYLES.plain);
    r.getCell(2).alignment = { horizontal: 'right' };
    if (typeof val === 'number') r.getCell(2).numFmt = '#,##0.0000';
    borderRow(r);
    r.height = 16;
  });
}

// ─── Main Export Function ─────────────────────────────────────────────────────

async function exportVersion(versionId) {
  const d = loadVersionData(versionId);
  const calc = calcSummary(d);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'RR-Portal Quotation System';
  wb.created = new Date();

  buildSummarySheet(wb, d, calc);
  buildBdSheet(wb, d);
  buildPkgSheet(wb, d);
  buildMoldSheet(wb, d);

  return wb.xlsx.writeBuffer();
}

module.exports = { exportVersion };
