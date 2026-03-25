'use strict';

/**
 * 外购清单 (Purchase List) generator
 * Generates an ExcelJS Workbook with a single sheet "外购件"
 */

const ExcelJS = require('exceljs');
const {
  TITLE_FONT, SUBTITLE_FONT, HEADER_FONT, CELL_FONT, SMALL_FONT,
  THIN_BORDER, CENTER_ALIGN, LEFT_ALIGN, HEADER_FILL,
  addCompanyHeader, addSignatureFooter,
  applyBorders, mergeCenter,
} = require('./common');

const TOTAL_COLS = 15;

// Column widths: 序号(3), 类别(8), 物料名称(18), 物料编号(10), 规格(14),
//               材料(12), 海关备案(14), 颜色(6), 用量(6),
//               订单需求数(8), 单重g(7), 供应商(10), 表面处理(8), 用途(8), 备注(10)
const COL_WIDTHS = [4, 8, 20, 11, 15, 13, 15, 6, 6, 9, 7, 11, 8, 8, 10];

// Category separator fill (very light grey)
const SEP_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF2F2F2' },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function setColWidths(ws) {
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

function cellStyle(cell, value, font, alignment, fill) {
  cell.value = value !== null && value !== undefined ? value : '';
  cell.font = font || CELL_FONT;
  cell.alignment = alignment || CENTER_ALIGN;
  cell.border = THIN_BORDER;
  if (fill) cell.fill = fill;
}

function dataCell(ws, r, c, value, font, alignment) {
  const cell = ws.getCell(r, c);
  cellStyle(cell, value, font, alignment);
  return cell;
}

function mergedCell(ws, r, c1, c2, value, font, alignment, fill) {
  if (c1 !== c2) ws.mergeCells(r, c1, r, c2);
  const cell = ws.getCell(r, c1);
  cellStyle(cell, value, font, alignment, fill);
  return cell;
}

/** Write a blank separator row between category groups */
function addSeparatorRow(ws, r) {
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const cell = ws.getCell(r, 1);
  cell.value = '';
  cell.fill = SEP_FILL;
  ws.getRow(r).height = 6;
  return r + 1;
}

// ─── Main sheet builder ──────────────────────────────────────────────────────

async function buildPurchaseSheet(ws, product, factoryConfig) {
  setColWidths(ws);
  ws.views = [{ showGridLines: false }];

  const orderQty = product.order_qty || 0;
  let r = 1;

  // ── Row 1: Company name (left) + Total Order Quantities (right) ──
  // Company name spans cols 1-14
  ws.mergeCells(r, 1, r, 14);
  const companyCell = ws.getCell(r, 1);
  companyCell.value = factoryConfig.full_name;
  companyCell.font = TITLE_FONT;
  companyCell.alignment = LEFT_ALIGN;
  ws.getRow(r).height = 28;

  // Total Order Quantities in col 15 (label) and overflow
  // We use cols 14-15 for the right block
  // Redo: company in 1-13, total qty label in 14, total qty value in 15
  // Reset and redo properly
  try { ws.unMergeCells(r, 1, r, 14); } catch(_) {}

  ws.mergeCells(r, 1, r, 13);
  const cn = ws.getCell(r, 1);
  cn.value = factoryConfig.full_name;
  cn.font = TITLE_FONT;
  cn.alignment = LEFT_ALIGN;

  // "Total Order Quantities (pcs):" label in col 14
  const tqLabel = ws.getCell(r, 14);
  tqLabel.value = 'Total Order Quantities (pcs):';
  tqLabel.font = { ...CELL_FONT, bold: true };
  tqLabel.alignment = LEFT_ALIGN;

  // value in col 15
  const tqVal = ws.getCell(r, 15);
  tqVal.value = orderQty;
  tqVal.font = { ...CELL_FONT, bold: true };
  tqVal.alignment = CENTER_ALIGN;

  r++;

  // ── Row 2: Document title ──
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const titleCell = ws.getCell(r, 1);
  titleCell.value = `外 购 件 清 单               文件编号：HSQR0063  版本号:A/0`;
  titleCell.font = SUBTITLE_FONT;
  titleCell.alignment = CENTER_ALIGN;
  ws.getRow(r).height = 22;
  r++;

  // ── Row 3: Info row ──
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const infoCell = ws.getCell(r, 1);
  infoCell.value = `客户名称: ${product.client_name || ''}                       产品编号: ${product.product_number || ''}                        产品名称:${product.product_name || ''}           编制:                                审核：                批准:                            日期：`;
  infoCell.font = CELL_FONT;
  infoCell.alignment = LEFT_ALIGN;
  infoCell.border = THIN_BORDER;
  ws.getRow(r).height = 18;
  r++;

  // ── Header row ──
  const HEADERS = [
    '序号', '类别', '物料名称', '物料编号', '规格', '材料',
    '海关备案料件名称', '颜色', '用量', '订单需求数',
    '单重 g', '供应商', '表面处理', '用途', '备注',
  ];
  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.alignment = CENTER_ALIGN;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
  ws.getRow(r).height = 20;
  r++;

  // ── Data rows ──
  const purchases = Array.isArray(product.purchases) ? product.purchases : [];

  // Group by category, preserving order
  const categoryOrder = [];
  const grouped = {};
  purchases.forEach(item => {
    const cat = item.category || '';
    if (!grouped[cat]) {
      grouped[cat] = [];
      categoryOrder.push(cat);
    }
    grouped[cat].push(item);
  });

  let firstGroup = true;
  categoryOrder.forEach(cat => {
    // Separator between groups (not before the first)
    if (!firstGroup) {
      r = addSeparatorRow(ws, r);
    }
    firstGroup = false;

    const items = grouped[cat];
    items.forEach((item, idx) => {
      const seqNum = idx + 1; // 序号 resets per category

      dataCell(ws, r, 1,  seqNum);
      dataCell(ws, r, 2,  item.category         || '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 3,  item.name             || '', CELL_FONT, LEFT_ALIGN);
      dataCell(ws, r, 4,  item.part_number      || '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 5,  item.spec             || '', CELL_FONT, LEFT_ALIGN);
      dataCell(ws, r, 6,  item.material         || '', CELL_FONT, LEFT_ALIGN);
      dataCell(ws, r, 7,  item.customs_name     || '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 8,  item.color            || '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 9,  item.usage_ratio      != null ? item.usage_ratio : '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 10, item.order_qty        != null ? item.order_qty   : '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 11, item.unit_weight_g    != null ? item.unit_weight_g : '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 12, item.supplier         || '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 13, item.surface_treatment|| '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 14, item.purpose          || '', CELL_FONT, CENTER_ALIGN);
      dataCell(ws, r, 15, item.notes            || '', CELL_FONT, LEFT_ALIGN);

      ws.getRow(r).height = 18;
      r++;
    });
  });

  // ── Blank rows if table is short (minimum 2 blank rows) ──
  for (let i = 0; i < 2; i++) {
    for (let c = 1; c <= TOTAL_COLS; c++) {
      const cell = ws.getCell(r, c);
      cell.value = '';
      cell.border = THIN_BORDER;
    }
    ws.getRow(r).height = 16;
    r++;
  }

  // ── Footer note ──
  r++;
  ws.mergeCells(r, 1, r, TOTAL_COLS);
  const noteCell = ws.getCell(r, 1);
  noteCell.value = '所有物料均要符合ROHS/NP和客PO及客相关测试要求';
  noteCell.font = { ...CELL_FONT, italic: true };
  noteCell.alignment = LEFT_ALIGN;
  ws.getRow(r).height = 16;
  r++;

  // ── Signature footer ──
  addSignatureFooter(ws, r, TOTAL_COLS);
}

// ─── Main export ─────────────────────────────────────────────────────────────

async function generate(product, factoryConfig) {
  const wb = new ExcelJS.Workbook();
  wb.creator = factoryConfig.full_name || 'RR Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('外购件');
  await buildPurchaseSheet(ws, product, factoryConfig);

  return wb;
}

module.exports = { generate };
