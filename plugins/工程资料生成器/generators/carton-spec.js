'use strict';

/**
 * 外箱资料 (Carton Specification) generator
 * Generates an ExcelJS Workbook with two sheets:
 *   Sheet 1: "数据表"  — structured carton data
 *   Sheet 2: "相片"    — placeholder photo page
 */

const ExcelJS = require('exceljs');
const {
  TITLE_FONT, SUBTITLE_FONT, HEADER_FONT, CELL_FONT, SMALL_FONT,
  THIN_BORDER, CENTER_ALIGN, LEFT_ALIGN, HEADER_FILL,
  addCompanyHeader, addSignatureFooter,
  applyBorders, mergeCenter, setHeaderRow,
} = require('./common');

const TOTAL_COLS = 13;

// Column widths for data sheet
const COL_WIDTHS = [2, 14, 10, 10, 10, 14, 14, 14, 8, 8, 8, 8, 8];

// Section header fill (light yellow)
const SECTION_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF2CC' },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function setColWidths(ws, widths) {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

/** Write a single merged label cell */
function label(ws, r, c, ec, text, font, fill) {
  if (c !== ec) ws.mergeCells(r, c, r, ec);
  const cell = ws.getCell(r, c);
  cell.value = text;
  cell.font = font || CELL_FONT;
  cell.alignment = LEFT_ALIGN;
  cell.border = THIN_BORDER;
  if (fill) cell.fill = fill;
  return cell;
}

/** Write a value cell */
function val(ws, r, c, ec, text, font) {
  if (c !== ec) ws.mergeCells(r, c, r, ec);
  const cell = ws.getCell(r, c);
  cell.value = text !== null && text !== undefined ? text : '';
  cell.font = font || CELL_FONT;
  cell.alignment = CENTER_ALIGN;
  cell.border = THIN_BORDER;
  return cell;
}

/** Blank merged spacer row */
function spacer(ws, r) {
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  ws.getRow(r).height = 6;
}

// ─── section builders ────────────────────────────────────────────────────────

/**
 * Info section:  2-column layout
 *   Left  col: 客户名称 | 产品编号 | 产品名称
 *   Right col: 装箱方式 | 内箱材质 | 外箱材质
 * Returns next row number.
 */
function addInfoSection(ws, startRow, product, dims) {
  let r = startRow;
  const lEnd = 6;   // left label/value boundary
  const rStart = 8; // right label start
  const rEnd = TOTAL_COLS;

  const rows = [
    ['客户名称：', product.client_name || '', '装箱方式：', (dims && dims.packing_method) || ''],
    ['产品编号：', product.product_number || '', '内箱材质：', (dims && dims.inner_box_material) || ''],
    ['产品名称：', product.product_name || '',  '外箱材质：', (dims && dims.outer_box_material) || ''],
  ];

  rows.forEach(([lLabel, lVal, rLabel, rVal]) => {
    // left label col 2-3
    ws.mergeCells(r, 2, r, 3);
    const lc = ws.getCell(r, 2);
    lc.value = lLabel;
    lc.font = CELL_FONT;
    lc.alignment = LEFT_ALIGN;
    lc.border = THIN_BORDER;

    // left value col 4-6
    ws.mergeCells(r, 4, r, lEnd);
    const lv = ws.getCell(r, 4);
    lv.value = lVal;
    lv.font = CELL_FONT;
    lv.alignment = LEFT_ALIGN;
    lv.border = THIN_BORDER;

    // right label col 8-9
    ws.mergeCells(r, rStart, r, rStart + 1);
    const rc = ws.getCell(r, rStart);
    rc.value = rLabel;
    rc.font = CELL_FONT;
    rc.alignment = LEFT_ALIGN;
    rc.border = THIN_BORDER;

    // right value col 10-13
    ws.mergeCells(r, rStart + 2, r, rEnd);
    const rv = ws.getCell(r, rStart + 2);
    rv.value = rVal;
    rv.font = CELL_FONT;
    rv.alignment = LEFT_ALIGN;
    rv.border = THIN_BORDER;

    ws.getRow(r).height = 18;
    r++;
  });

  return r;
}

/**
 * Generic dimension table:  section title + header row + data row
 * headers: array of { text, colSpan? }   (colSpan defaults to 1)
 * dataFn: (ws, r) => fills row r with data cells
 * Returns next row number.
 */
function addDimTable(ws, startRow, sectionTitle, headers, dataFn) {
  let r = startRow;

  spacer(ws, r++);

  // Section title row
  ws.mergeCells(r, 2, r, TOTAL_COLS);
  const sc = ws.getCell(r, 2);
  sc.value = sectionTitle;
  sc.font = { ...HEADER_FONT, bold: true };
  sc.alignment = LEFT_ALIGN;
  sc.fill = SECTION_FILL;
  sc.border = THIN_BORDER;
  ws.getRow(r).height = 18;
  r++;

  // Header row — build column positions from headers array
  let col = 2;
  headers.forEach(h => {
    const span = h.colSpan || 1;
    const endCol = col + span - 1;
    if (col !== endCol) ws.mergeCells(r, col, r, endCol);
    const cell = ws.getCell(r, col);
    cell.value = h.text;
    cell.font = HEADER_FONT;
    cell.alignment = CENTER_ALIGN;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    col = endCol + 1;
  });
  ws.getRow(r).height = 30;
  r++;

  // Data row
  dataFn(ws, r);
  ws.getRow(r).height = 18;
  r++;

  return r;
}

/** Fill a dimension data row for product/package/display dims */
function fillSimpleRow(ws, r, stage, values) {
  // col 2 = stage
  val(ws, r, 2, 2, stage);
  values.forEach((v, i) => {
    val(ws, r, 3 + i, 3 + i, v !== null && v !== undefined ? v : '');
  });
}

/** Inner/outer carton sub-table (訂箱 + 量箱 rows) */
function addCartonTable(ws, startRow, sectionTitle, orderRow, measureRow) {
  let r = startRow;

  spacer(ws, r++);

  // Section title
  ws.mergeCells(r, 2, r, TOTAL_COLS);
  const sc = ws.getCell(r, 2);
  sc.value = sectionTitle;
  sc.font = { ...HEADER_FONT, bold: true };
  sc.alignment = LEFT_ALIGN;
  sc.fill = SECTION_FILL;
  sc.border = THIN_BORDER;
  ws.getRow(r).height = 18;
  r++;

  // Header
  const headers = [
    { text: '阶段',                                          colSpan: 1 },
    { text: 'Inner Carton Width\n内箱 长  (cm)',             colSpan: 1 },
    { text: 'Inner Carton Depth\n内箱 宽  (cm)',             colSpan: 1 },
    { text: 'Inner Carton Height\n内箱 高  (cm)',            colSpan: 1 },
    { text: 'Inner Carton N.W.\n内箱 净重  (kg)',            colSpan: 1 },
    { text: 'Inner Carton G.W.\n内箱 毛重  (kg)',            colSpan: 1 },
    { text: '备注/说明',                                     colSpan: 3 },
  ];
  // Override column text for outer carton
  if (sectionTitle === '外箱资料') {
    headers[1].text = 'Outer Carton Width\n外箱 长  (cm)';
    headers[2].text = 'Outer Carton Depth\n外箱 宽  (cm)';
    headers[3].text = 'Outer Carton Height\n外箱 高  (cm)';
    headers[4].text = 'Outer Carton N.W.\n外箱 净重  (kg)';
    headers[5].text = 'Outer Carton G.W.\n外箱 毛重  (kg)';
  }

  let col = 2;
  headers.forEach(h => {
    const endCol = col + (h.colSpan || 1) - 1;
    if (col !== endCol) ws.mergeCells(r, col, r, endCol);
    const cell = ws.getCell(r, col);
    cell.value = h.text;
    cell.font = HEADER_FONT;
    cell.alignment = CENTER_ALIGN;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    col = endCol + 1;
  });
  ws.getRow(r).height = 30;
  r++;

  // 订箱尺寸 row
  function fillCartonRow(ws, r, rowLabel, d, note) {
    val(ws, r, 2, 2, rowLabel);
    val(ws, r, 3, 3, d && d.width  != null ? d.width  : '');
    val(ws, r, 4, 4, d && d.depth  != null ? d.depth  : '');
    val(ws, r, 5, 5, d && d.height != null ? d.height : '');
    val(ws, r, 6, 6, d && d.nw_kg  != null ? d.nw_kg  : '');
    val(ws, r, 7, 7, d && d.gw_kg  != null ? d.gw_kg  : '');
    // note spans cols 8-10
    ws.mergeCells(r, 8, r, 10);
    const nc = ws.getCell(r, 8);
    nc.value = note || '';
    nc.font = CELL_FONT;
    nc.alignment = LEFT_ALIGN;
    nc.border = THIN_BORDER;
    ws.getRow(r).height = 18;
  }

  fillCartonRow(ws, r, '订箱尺寸：', orderRow,   '用于采购订箱');
  r++;
  fillCartonRow(ws, r, '量箱尺寸',   measureRow, '用于装柜');
  r++;

  return r;
}

// ─── Sheet 1: 数据表 ─────────────────────────────────────────────────────────

async function buildDataSheet(ws, product, factoryConfig) {
  setColWidths(ws, COL_WIDTHS);
  ws.views = [{ showGridLines: false }];

  const dims = product.dimensions || {};

  // Company header (returns next row = 4)
  let r = await addCompanyHeader(ws, factoryConfig, '外箱放产资料', { totalColumns: TOTAL_COLS });

  // Info section
  r = addInfoSection(ws, r, product, dims);

  // 产品资料
  r = addDimTable(
    ws, r, '产品资料',
    [
      { text: '阶段',                                colSpan: 1 },
      { text: 'Prod Width (cm)\n产品光身  长',       colSpan: 1 },
      { text: 'Prod Depth (cm)\n产品光身  宽',       colSpan: 1 },
      { text: 'Prod Height (cm)\n产品光身  高',      colSpan: 1 },
      { text: 'Prod Weight (kg)\n产品光身  重量',    colSpan: 2 },
    ],
    (ws, r) => {
      const p = dims.product || {};
      val(ws, r, 2, 2, p.stage || '');
      val(ws, r, 3, 3, p.width  != null ? p.width  : '');
      val(ws, r, 4, 4, p.depth  != null ? p.depth  : '');
      val(ws, r, 5, 5, p.height != null ? p.height : '');
      val(ws, r, 6, 7, p.weight_kg != null ? p.weight_kg : '');
    },
  );

  // 包装资料
  r = addDimTable(
    ws, r, '包装资料',
    [
      { text: '阶段',                                          colSpan: 1 },
      { text: 'Pkg Width\n包装  长  (cm)',                     colSpan: 1 },
      { text: 'Pkg Depth\n包装  宽  (cm)',                     colSpan: 1 },
      { text: 'Pkg Height (cm)\n包装  总高 (含J钩）',          colSpan: 1 },
      { text: 'Pkg Height w/o Tag\n包装  高 (不含J钩）(cm)',   colSpan: 1 },
      { text: 'Pkg G.W. (kg)\n包装  重量 (含产品）',           colSpan: 2 },
    ],
    (ws, r) => {
      const p = dims.package || {};
      val(ws, r, 2, 2, p.stage || '');
      val(ws, r, 3, 3, p.width            != null ? p.width            : '');
      val(ws, r, 4, 4, p.depth            != null ? p.depth            : '');
      val(ws, r, 5, 5, p.height_with_hook != null ? p.height_with_hook : '');
      val(ws, r, 6, 6, p.height_no_hook   != null ? p.height_no_hook   : '');
      val(ws, r, 7, 8, p.gross_weight_kg  != null ? p.gross_weight_kg  : '');
    },
  );

  // PDQ展示盒资料 (always show)
  r = addDimTable(
    ws, r, 'PDQ 、展示盒、展示架、卡板装箱 资料',
    [
      { text: '阶段',                             colSpan: 1 },
      { text: 'Store Width\n长  (cm)',             colSpan: 1 },
      { text: 'Store Depth\n宽  (cm)',             colSpan: 1 },
      { text: 'Store Closed Height\n组装后的  高  (cm)', colSpan: 1 },
      { text: 'Store Open Height\n打开的  高  (cm)',     colSpan: 1 },
      { text: 'Store Total Weight\n总重量  (kg)',  colSpan: 2 },
    ],
    (ws, r) => {
      const d = dims.display || {};
      val(ws, r, 2, 2, d.stage  || '');
      val(ws, r, 3, 3, d.width  != null ? d.width  : '');
      val(ws, r, 4, 4, d.depth  != null ? d.depth  : '');
      val(ws, r, 5, 5, d.closed_height != null ? d.closed_height : '');
      val(ws, r, 6, 6, d.open_height   != null ? d.open_height   : '');
      val(ws, r, 7, 8, d.total_weight  != null ? d.total_weight  : '');
    },
  );

  // 内箱资料
  r = addCartonTable(ws, r, ' 内箱资料', dims.inner_carton_order, dims.inner_carton_measure);

  // 外箱资料
  r = addCartonTable(ws, r, '外箱资料', dims.outer_carton_order, dims.outer_carton_measure);

  // Signature footer
  addSignatureFooter(ws, r, TOTAL_COLS);
}

// ─── Sheet 2: 相片 ───────────────────────────────────────────────────────────

function buildPhotoSheet(ws, factoryConfig) {
  ws.views = [{ showGridLines: false }];

  // 11 columns for photo page
  const photoCols = 11;
  for (let i = 1; i <= photoCols; i++) {
    ws.getColumn(i).width = 12;
  }

  let r = 1;

  // Company name
  ws.mergeCells(r, 1, r, photoCols);
  const c1 = ws.getCell(r, 1);
  c1.value = factoryConfig.full_name;
  c1.font = TITLE_FONT;
  c1.alignment = CENTER_ALIGN;
  ws.getRow(r).height = 30;
  r++;

  // Doc title
  ws.mergeCells(r, 1, r, photoCols);
  const c2 = ws.getCell(r, 1);
  c2.value = '外箱放产资料';
  c2.font = SUBTITLE_FONT;
  c2.alignment = CENTER_ALIGN;
  ws.getRow(r).height = 22;
  r++;

  // Photo sections layout:
  // Row 1 (2-up): 量箱完整示图 | 量箱尺寸放大图
  // Row 2 (2-up): 毛重磅称示图 | 净重磅称示图
  // Row 3 (1-up): 产品包装示图
  const photoSections = [
    [
      { label: '量箱完整示图', cols: [1, 5] },
      { label: '量箱尺寸放大图', cols: [7, 11] },
    ],
    [
      { label: '毛重磅称示图', cols: [1, 5] },
      { label: '净重磅称示图', cols: [7, 11] },
    ],
    [
      { label: '产品包装示图', cols: [1, 11] },
    ],
  ];

  photoSections.forEach(rowSections => {
    // Label row
    rowSections.forEach(sec => {
      ws.mergeCells(r, sec.cols[0], r, sec.cols[1]);
      const lc = ws.getCell(r, sec.cols[0]);
      lc.value = sec.label;
      lc.font = HEADER_FONT;
      lc.alignment = LEFT_ALIGN;
      lc.border = THIN_BORDER;
    });
    ws.getRow(r).height = 18;
    r++;

    // Photo placeholder rows (20 rows tall)
    const photoStartRow = r;
    for (let pr = 0; pr < 20; pr++) {
      ws.getRow(r).height = 14;
      r++;
    }
    // Draw border around each photo area
    rowSections.forEach(sec => {
      applyBorders(ws, photoStartRow, r - 1, sec.cols[0], sec.cols[1]);
    });

    // Small spacer
    ws.getRow(r).height = 6;
    r++;
  });
}

// ─── Main export ─────────────────────────────────────────────────────────────

async function generate(product, factoryConfig) {
  const wb = new ExcelJS.Workbook();
  wb.creator = factoryConfig.full_name || 'RR Portal';
  wb.created = new Date();

  const ws1 = wb.addWorksheet('数据表');
  await buildDataSheet(ws1, product, factoryConfig);

  const ws2 = wb.addWorksheet('相片');
  buildPhotoSheet(ws2, factoryConfig);

  return wb;
}

module.exports = { generate };
