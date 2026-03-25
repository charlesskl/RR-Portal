'use strict';

/**
 * 作业指导书 (Work Instructions) generator
 * Generates an ExcelJS Workbook with one worksheet per work instruction entry.
 * Each sheet = 工序{seq}-{name} (truncated to 31 chars for Excel limit)
 */

const ExcelJS = require('exceljs');
const {
  TITLE_FONT, SUBTITLE_FONT, HEADER_FONT, CELL_FONT, SMALL_FONT,
  THIN_BORDER, CENTER_ALIGN, LEFT_ALIGN, HEADER_FILL,
  applyBorders,
} = require('./common');

const TOTAL_COLS = 13;

// Column widths for 13 columns:
// 序号(3), 零件名称(12), 零件材料和规格(16), 用量(6), 作业内容(span to col8→merged later)(20),
// then image area cols 5-13 (right side merged as one image block)
// Actual layout: cols 1-4 = parts/steps, col 5-13 = image area
const COL_WIDTHS = [4, 13, 17, 6, 10, 10, 10, 10, 10, 10, 10, 10, 10];

// Sub-section header fill (light blue, same as HEADER_FILL but a bit different shade)
const TOOL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' },
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function setColWidths(ws) {
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

function styleCell(cell, value, font, alignment, border) {
  cell.value = value !== null && value !== undefined ? value : '';
  cell.font = font || CELL_FONT;
  cell.alignment = alignment || CENTER_ALIGN;
  if (border !== false) cell.border = THIN_BORDER;
}

/** Generate safe Excel sheet name: max 31 chars, no illegal chars */
function safeSheetName(seq, name) {
  const raw = `工序${seq}-${name}`;
  // Remove illegal Excel sheet name characters: \ / ? * [ ]
  const cleaned = raw.replace(/[\\\/\?\*\[\]]/g, '_');
  return cleaned.substring(0, 31);
}

// ─── Per-sheet builder ────────────────────────────────────────────────────────

async function buildWorkInstructionSheet(ws, instruction, product, factoryConfig) {
  setColWidths(ws);
  ws.views = [{ showGridLines: false }];

  const parts = Array.isArray(instruction.parts_used) ? instruction.parts_used : [];
  const steps = Array.isArray(instruction.steps) ? instruction.steps : [];
  const tools = Array.isArray(instruction.tools) ? instruction.tools : [];
  const cautions = Array.isArray(instruction.cautions) ? instruction.cautions : [];

  let r = 1;

  // ── Row 1: Company header + "作业指导书" ──
  // Cols 1-10: company name, cols 11-13: "作业指导书"
  ws.mergeCells(r, 1, r, 10);
  const companyCell = ws.getCell(r, 1);
  companyCell.value = factoryConfig.full_name || '';
  companyCell.font = TITLE_FONT;
  companyCell.alignment = CENTER_ALIGN;
  companyCell.border = THIN_BORDER;

  ws.mergeCells(r, 11, r, TOTAL_COLS);
  const docTitleCell = ws.getCell(r, 11);
  docTitleCell.value = '作业指导书';
  docTitleCell.font = SUBTITLE_FONT;
  docTitleCell.alignment = CENTER_ALIGN;
  docTitleCell.border = THIN_BORDER;
  ws.getRow(r).height = 30;
  r++;

  // ── Row 2: 产品编号 | 货名 | 客户 | 单工位操作时间 | 目标数 ──
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const infoCell = ws.getCell(r, 1);
  infoCell.value = [
    `产品编号: ${product.product_number || ''}`,
    `货名：${product.product_name || ''}`,
    `客户: ${product.client_name || ''}`,
    `单工位操作时间：${instruction.cycle_time || ''}`,
    `目标数：`,
  ].join('            ');
  infoCell.font = CELL_FONT;
  infoCell.alignment = LEFT_ALIGN;
  infoCell.border = THIN_BORDER;
  ws.getRow(r).height = 20;
  r++;

  // ── Row 3: 产品名称 | 工序编号 | 工序名称 | 工作时间 ──
  // Layout: [产品名称 label(1), value(2-4), 工序编号 label(5-6), value(7), 工序名称 label(8-9), value(10-11), 工作时间(12-13)]
  ws.mergeCells(r, 1, r, 1);
  styleCell(ws.getCell(r, 1), '产品名称', HEADER_FONT, CENTER_ALIGN);

  ws.mergeCells(r, 2, r, 4);
  styleCell(ws.getCell(r, 2), product.product_name || '', CELL_FONT, LEFT_ALIGN);

  ws.mergeCells(r, 5, r, 6);
  styleCell(ws.getCell(r, 5), '工序编号', HEADER_FONT, CENTER_ALIGN);

  styleCell(ws.getCell(r, 7), instruction.seq || '', CELL_FONT, CENTER_ALIGN);

  ws.mergeCells(r, 8, r, 9);
  styleCell(ws.getCell(r, 8), '工序名称', HEADER_FONT, CENTER_ALIGN);

  ws.mergeCells(r, 10, r, 11);
  styleCell(ws.getCell(r, 10), instruction.name || '', CELL_FONT, LEFT_ALIGN);

  ws.mergeCells(r, 12, r, TOTAL_COLS);
  styleCell(ws.getCell(r, 12), '工作时间', HEADER_FONT, CENTER_ALIGN);

  ws.getRow(r).height = 20;
  r++;

  // ── Row 4: Table column headers ──
  // Left side (cols 1-4): 序号, 零件名称, 零件材料和规格, 用量
  // Col 5 spans to TOTAL_COLS: 作业内容 (left) + 作业图示 (right)
  // We split col 5 into two sections: 作业内容 (cols 5-8) and 作业图示 (cols 9-13)
  styleCell(ws.getCell(r, 1), '序号', HEADER_FONT, CENTER_ALIGN);
  ws.getCell(r, 1).fill = TOOL_FILL;

  styleCell(ws.getCell(r, 2), '零件名称', HEADER_FONT, CENTER_ALIGN);
  ws.getCell(r, 2).fill = TOOL_FILL;

  styleCell(ws.getCell(r, 3), '零件材料和规格', HEADER_FONT, CENTER_ALIGN);
  ws.getCell(r, 3).fill = TOOL_FILL;

  styleCell(ws.getCell(r, 4), '用量', HEADER_FONT, CENTER_ALIGN);
  ws.getCell(r, 4).fill = TOOL_FILL;

  ws.mergeCells(r, 5, r, 8);
  const contentHeader = ws.getCell(r, 5);
  contentHeader.value = '作     业     内     容';
  contentHeader.font = HEADER_FONT;
  contentHeader.alignment = CENTER_ALIGN;
  contentHeader.border = THIN_BORDER;
  contentHeader.fill = TOOL_FILL;

  ws.mergeCells(r, 9, r, TOTAL_COLS);
  const imageHeader = ws.getCell(r, 9);
  imageHeader.value = '作  业  图  示';
  imageHeader.font = HEADER_FONT;
  imageHeader.alignment = CENTER_ALIGN;
  imageHeader.border = THIN_BORDER;
  imageHeader.fill = TOOL_FILL;

  ws.getRow(r).height = 22;
  r++;

  // ── Rows 5+: Parts list + Steps side by side ──
  // Determine total rows needed: max(parts.length, steps.length), minimum 8
  const dataRows = Math.max(parts.length, steps.length, 8);
  const imageStartRow = r; // remember for image area merge

  for (let i = 0; i < dataRows; i++) {
    const part = parts[i];
    const step = steps[i];

    // Sequence number (left col)
    const seqCell = ws.getCell(r, 1);
    seqCell.value = i + 1;
    seqCell.font = CELL_FONT;
    seqCell.alignment = CENTER_ALIGN;
    seqCell.border = THIN_BORDER;

    // Part name
    const partNameCell = ws.getCell(r, 2);
    partNameCell.value = part ? (part.name || '') : '';
    partNameCell.font = CELL_FONT;
    partNameCell.alignment = LEFT_ALIGN;
    partNameCell.border = THIN_BORDER;

    // Part material/spec
    const partMatCell = ws.getCell(r, 3);
    partMatCell.value = part ? (part.material || '') : '';
    partMatCell.font = CELL_FONT;
    partMatCell.alignment = LEFT_ALIGN;
    partMatCell.border = THIN_BORDER;

    // Part qty
    const partQtyCell = ws.getCell(r, 4);
    partQtyCell.value = part ? (part.qty != null ? part.qty : '') : '';
    partQtyCell.font = CELL_FONT;
    partQtyCell.alignment = CENTER_ALIGN;
    partQtyCell.border = THIN_BORDER;

    // Step content (cols 5-8 merged)
    ws.mergeCells(r, 5, r, 8);
    const stepCell = ws.getCell(r, 5);
    stepCell.value = step || '';
    stepCell.font = CELL_FONT;
    stepCell.alignment = LEFT_ALIGN;
    stepCell.border = THIN_BORDER;

    // Image area (cols 9-13): individual borders only, content empty
    for (let c = 9; c <= TOTAL_COLS; c++) {
      const imgCell = ws.getCell(r, c);
      imgCell.value = '';
      imgCell.border = THIN_BORDER;
    }

    ws.getRow(r).height = 22;
    r++;
  }

  // ── Tools + Cautions section ──
  // Two-column layout: 作业工具 (cols 1-4) | 注意事项 (cols 5-13)
  const sectionStartRow = r;

  // Section headers
  ws.mergeCells(r, 1, r, 4);
  const toolHeader = ws.getCell(r, 1);
  toolHeader.value = '   作   业   工    具';
  toolHeader.font = HEADER_FONT;
  toolHeader.alignment = CENTER_ALIGN;
  toolHeader.border = THIN_BORDER;
  toolHeader.fill = TOOL_FILL;

  ws.mergeCells(r, 5, r, TOTAL_COLS);
  const cautionHeader = ws.getCell(r, 5);
  cautionHeader.value = '注    意    事    项';
  cautionHeader.font = HEADER_FONT;
  cautionHeader.alignment = CENTER_ALIGN;
  cautionHeader.border = THIN_BORDER;
  cautionHeader.fill = TOOL_FILL;

  ws.getRow(r).height = 20;
  r++;

  // Tool + caution data rows (parallel, min 5 rows each)
  const subRows = Math.max(tools.length, cautions.length, 5);
  for (let i = 0; i < subRows; i++) {
    // Tool row: seq in col 1, tool name in cols 2-4
    const tSeqCell = ws.getCell(r, 1);
    tSeqCell.value = i + 1;
    tSeqCell.font = CELL_FONT;
    tSeqCell.alignment = CENTER_ALIGN;
    tSeqCell.border = THIN_BORDER;

    ws.mergeCells(r, 2, r, 4);
    const toolCell = ws.getCell(r, 2);
    toolCell.value = tools[i] || '';
    toolCell.font = CELL_FONT;
    toolCell.alignment = LEFT_ALIGN;
    toolCell.border = THIN_BORDER;

    // Caution row: cols 5-13 merged
    ws.mergeCells(r, 5, r, TOTAL_COLS);
    const cautionCell = ws.getCell(r, 5);
    cautionCell.value = cautions[i] || '';
    cautionCell.font = CELL_FONT;
    cautionCell.alignment = LEFT_ALIGN;
    cautionCell.border = THIN_BORDER;

    ws.getRow(r).height = 20;
    r++;
  }

  // ── Signature footer ──
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const sigCell = ws.getCell(r, 1);
  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  sigCell.value = `编制：${product.engineer || ''}                                 审核;                                               日期：${dateStr}`;
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

  const instructions = Array.isArray(product.work_instructions) ? product.work_instructions : [];

  if (instructions.length === 0) {
    // Add a placeholder sheet if no instructions defined
    const ws = wb.addWorksheet('作业指导书');
    ws.mergeCells(1, 1, 1, TOTAL_COLS);
    const cell = ws.getCell(1, 1);
    cell.value = '暂无作业指导书数据';
    cell.font = CELL_FONT;
    cell.alignment = CENTER_ALIGN;
  } else {
    for (const instruction of instructions) {
      const sheetName = safeSheetName(instruction.seq || '', instruction.name || '工序');
      const ws = wb.addWorksheet(sheetName);
      await buildWorkInstructionSheet(ws, instruction, product, factoryConfig);
    }
  }

  return wb;
}

module.exports = { generate };
