'use strict';

/**
 * 生产注意事项 (Production Notes) generator
 * 文件编号：HSQR0076
 * Generates an ExcelJS Workbook with a single sheet "重点工位生产注意事项"
 */

const ExcelJS = require('exceljs');
const {
  TITLE_FONT, SUBTITLE_FONT, HEADER_FONT, CELL_FONT, SMALL_FONT,
  THIN_BORDER, CENTER_ALIGN, LEFT_ALIGN, HEADER_FILL,
  applyBorders,
} = require('./common');

const TOTAL_COLS = 8;

// Column widths (8 cols): 序号/label(6), content spread across remaining cols
const COL_WIDTHS = [6, 14, 14, 14, 14, 14, 14, 14];

// Section title fill (light yellow)
const SECTION_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF2CC' },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function setColWidths(ws) {
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

/** Merge all columns in a row and apply styling */
function fullRow(ws, r, value, font, alignment, fill, height) {
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const cell = ws.getCell(r, 1);
  cell.value = value !== undefined && value !== null ? value : '';
  cell.font = font || CELL_FONT;
  cell.alignment = alignment || LEFT_ALIGN;
  cell.border = THIN_BORDER;
  if (fill) cell.fill = fill;
  if (height) ws.getRow(r).height = height;
  return r + 1;
}

/**
 * Write a section:
 *   - Bold title row (full width, yellow fill)
 *   - Content lines (one per \n-split line)
 *   - IMAGE_ROWS empty rows after content (for manually added images)
 */
function addSection(ws, startRow, titleText, contentText, imageRows) {
  let r = startRow;
  const IMAGE_ROWS = imageRows !== undefined ? imageRows : 4;

  // Section title
  r = fullRow(ws, r, titleText, HEADER_FONT, LEFT_ALIGN, SECTION_FILL, 20);

  // Content lines
  const lines = contentText
    ? contentText.split('\n').filter(l => l !== undefined)
    : [];

  if (lines.length === 0) {
    // At least one blank content row
    r = fullRow(ws, r, '', CELL_FONT, LEFT_ALIGN, null, 18);
  } else {
    lines.forEach(line => {
      r = fullRow(ws, r, line, CELL_FONT, LEFT_ALIGN, null, 18);
    });
  }

  // Empty rows for images (no border fill, just height)
  for (let i = 0; i < IMAGE_ROWS; i++) {
    ws.mergeCells(r, 1, r, TOTAL_COLS);
    const cell = ws.getCell(r, 1);
    cell.value = '';
    cell.border = THIN_BORDER;
    ws.getRow(r).height = 40;
    r++;
  }

  return r;
}

// ─── Main sheet builder ───────────────────────────────────────────────────────

async function buildProductionNotesSheet(ws, product, factoryConfig) {
  setColWidths(ws);
  ws.views = [{ showGridLines: false }];

  const notes = product.production_notes || {};
  let r = 1;

  // ── Row 1: Company header ──
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const companyCell = ws.getCell(r, 1);
  companyCell.value = factoryConfig.full_name || '';
  companyCell.font = TITLE_FONT;
  companyCell.alignment = CENTER_ALIGN;
  companyCell.border = THIN_BORDER;
  ws.getRow(r).height = 32;
  r++;

  // ── Row 2: Document title + 文件编号 ──
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const titleCell = ws.getCell(r, 1);
  titleCell.value = '重点工位生产注意事项                   文件编号：HSQR0076';
  titleCell.font = SUBTITLE_FONT;
  titleCell.alignment = CENTER_ALIGN;
  titleCell.border = THIN_BORDER;
  ws.getRow(r).height = 26;
  r++;

  // ── Row 3: 产品编号 | 产品名称 | 年龄分组 | 版本号 ──
  // Split across 8 columns: [产品编号：, val, 产品名称：, val, 年龄分组：, val, 版本号：, val]
  const infoLabels = [
    `产品编号：${product.product_number || ''}`,
    `产品名称：${product.product_name || ''}`,
    `年龄分组：${product.age_group || ''}`,
    `版本号：${notes.version || 'A0'}`,
  ];
  // Merge 2 cols per label (8 cols / 4 items = 2 cols each)
  for (let i = 0; i < 4; i++) {
    const c1 = i * 2 + 1;
    const c2 = c1 + 1;
    ws.mergeCells(r, c1, r, c2);
    const cell = ws.getCell(r, c1);
    cell.value = infoLabels[i];
    cell.font = CELL_FONT;
    cell.alignment = LEFT_ALIGN;
    cell.border = THIN_BORDER;
  }
  ws.getRow(r).height = 20;
  r++;

  // ── Row 4: 发放部门 label ──
  r = fullRow(ws, r, '发放部门：', CELL_FONT, LEFT_ALIGN, null, 18);

  // ── Row 5: 发放部门 checkboxes ──
  r = fullRow(
    ws, r,
    '        □经理室   □计划部  □啤机部   □喷油部    □装配部    □QC部',
    CELL_FONT, LEFT_ALIGN, null, 20
  );

  // ── Section 一: 产品介绍 ──
  r = addSection(ws, r, '一、产品介绍', notes.product_intro || '', 6);

  // ── Section 二: 功能玩法以及描述 ──
  r = addSection(ws, r, '二、功能玩法以及描述', notes.function_desc || '', 4);

  // ── Section 三: 测试要求 ──
  r = addSection(ws, r, '三、测试要求', notes.test_requirements || '', 2);

  // ── Section 四: 啤塑 ──
  r = addSection(ws, r, '四、啤塑', notes.injection_notes || '', 5);

  // ── Section 五: 装配/贴水纸 ──
  r = addSection(ws, r, '五、装配/贴水纸', notes.assembly_notes || '', 8);

  // ── Section 六: 包装 ──
  r = addSection(ws, r, '六、包装', notes.packaging_notes || '', 5);

  // ── Signature footer ──
  r++;
  // Single merged row with signature labels
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const sigCell = ws.getCell(r, 1);
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  sigCell.value = `编制：${product.engineer || ''}                审核：                批准：                日期：${dateStr}`;
  sigCell.font = CELL_FONT;
  sigCell.alignment = LEFT_ALIGN;
  sigCell.border = THIN_BORDER;
  ws.getRow(r).height = 22;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function generate(product, factoryConfig) {
  const wb = new ExcelJS.Workbook();
  wb.creator = factoryConfig.full_name || 'RR Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('重点工位生产注意事项');
  await buildProductionNotesSheet(ws, product, factoryConfig);

  return wb;
}

module.exports = { generate };
