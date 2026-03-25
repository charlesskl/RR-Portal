const ExcelJS = require('exceljs');
const path = require('path');

// ---------------------------------------------------------------------------
// Standard styles
// ---------------------------------------------------------------------------
const TITLE_FONT = { name: '宋体', size: 16, bold: true };
const SUBTITLE_FONT = { name: '宋体', size: 12, bold: true };
const HEADER_FONT = { name: '宋体', size: 10, bold: true };
const CELL_FONT = { name: '宋体', size: 9 };
const SMALL_FONT = { name: '宋体', size: 8 };

const THIN_BORDER = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
};

const CENTER_ALIGN = { horizontal: 'center', vertical: 'middle', wrapText: true };
const LEFT_ALIGN = { horizontal: 'left', vertical: 'middle', wrapText: true };

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' }, // Light blue header background
};

// ---------------------------------------------------------------------------
// Helper: add company header
// ---------------------------------------------------------------------------
// Adds logo + company name + document title at the top of a worksheet
// Returns the next available row number
async function addCompanyHeader(worksheet, factoryConfig, docTitle, options = {}) {
  const { docNumber, versionNumber, totalColumns = 13, startRow = 1 } = options;
  let row = startRow;

  // Row 1: Company name (merged across all columns)
  worksheet.mergeCells(row, 1, row, totalColumns);
  const titleCell = worksheet.getCell(row, 1);
  titleCell.value = factoryConfig.full_name;
  titleCell.font = TITLE_FONT;
  titleCell.alignment = CENTER_ALIGN;
  worksheet.getRow(row).height = 30;

  // Try to add logo
  try {
    const logoPath = path.join(__dirname, '..', 'assets', factoryConfig.logo);
    const fs = require('fs');
    if (fs.existsSync(logoPath)) {
      const imageId = worksheet.workbook.addImage({
        filename: logoPath,
        extension: 'png',
      });
      worksheet.addImage(imageId, {
        tl: { col: 0, row: row - 1 },
        ext: { width: 80, height: 30 },
      });
    }
  } catch (e) {
    // Logo not critical, continue without it
  }

  row++;

  // Row 2: blank
  row++;

  // Row 3: Document title (merged)
  worksheet.mergeCells(row, 1, row, totalColumns);
  const docTitleCell = worksheet.getCell(row, 1);
  docTitleCell.value = docTitle;
  docTitleCell.font = SUBTITLE_FONT;
  docTitleCell.alignment = CENTER_ALIGN;
  worksheet.getRow(row).height = 25;

  // Add doc number and version if provided
  if (docNumber) {
    // Append to title: "文件编号：xxx  版本号:A/0"
    const fullTitle = `${docTitle}         文件编号：${docNumber}        版本号:${versionNumber || 'A/0'}`;
    docTitleCell.value = fullTitle;
  }

  row++;

  return row; // Next available row
}

// ---------------------------------------------------------------------------
// Helper: add info row
// ---------------------------------------------------------------------------
// Adds a row like "客户名称：xxx    产品编号：xxx    产品名称：xxx    编制：    审核：    批准：    日期："
function addInfoRow(worksheet, row, product, totalColumns) {
  worksheet.mergeCells(row, 1, row, totalColumns);
  const cell = worksheet.getCell(row, 1);
  cell.value = `客户名称：${product.client_name || ''}    产品编号：${product.product_number || ''}    产品名称：${product.product_name || ''}    编制：    审核：    批准：    日期：`;
  cell.font = CELL_FONT;
  cell.alignment = LEFT_ALIGN;
  return row + 1;
}

// ---------------------------------------------------------------------------
// Helper: add signature footer
// ---------------------------------------------------------------------------
// Adds the standard signature block: 编制/审核/批准/日期
function addSignatureFooter(worksheet, startRow, totalColumns) {
  let row = startRow;

  // Blank row
  row++;

  // Signature row
  const sigLabels = ['工程编制：', '', '工程审核：', '', '工程总管/经理批准：', '', 'QA验证：'];
  const nameLabels = ['Name 姓名:', '', 'Name 姓名:', '', 'Name 姓名:', '', 'Name 姓名:'];
  const dateLabels = ['Date 日期:', '', 'Date 日期:', '', 'Date 日期:', '', 'Date 日期:'];

  // Calculate column span per section
  const sectionWidth = Math.floor(totalColumns / 4);

  // Signature titles
  for (let i = 0; i < 4; i++) {
    const startCol = i * sectionWidth + 1;
    const endCol = Math.min((i + 1) * sectionWidth, totalColumns);
    worksheet.mergeCells(row, startCol, row, endCol);
    const cell = worksheet.getCell(row, startCol);
    cell.value = sigLabels[i * 2] || '';
    cell.font = CELL_FONT;
  }
  row++;

  // Name row
  for (let i = 0; i < 4; i++) {
    const startCol = i * sectionWidth + 1;
    const endCol = Math.min((i + 1) * sectionWidth, totalColumns);
    worksheet.mergeCells(row, startCol, row, endCol);
    const cell = worksheet.getCell(row, startCol);
    cell.value = nameLabels[i * 2] || '';
    cell.font = SMALL_FONT;
  }
  row++;

  // Date row
  for (let i = 0; i < 4; i++) {
    const startCol = i * sectionWidth + 1;
    const endCol = Math.min((i + 1) * sectionWidth, totalColumns);
    worksheet.mergeCells(row, startCol, row, endCol);
    const cell = worksheet.getCell(row, startCol);
    cell.value = dateLabels[i * 2] || '';
    cell.font = SMALL_FONT;
  }
  row++;

  return row;
}

// ---------------------------------------------------------------------------
// Helper: apply borders to a range
// ---------------------------------------------------------------------------
function applyBorders(worksheet, startRow, endRow, startCol, endCol) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = worksheet.getCell(r, c);
      cell.border = THIN_BORDER;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: merge and set value with center alignment
// ---------------------------------------------------------------------------
function mergeCenter(worksheet, startRow, startCol, endRow, endCol, value, font) {
  worksheet.mergeCells(startRow, startCol, endRow, endCol);
  const cell = worksheet.getCell(startRow, startCol);
  cell.value = value;
  cell.font = font || CELL_FONT;
  cell.alignment = CENTER_ALIGN;
  return cell;
}

// ---------------------------------------------------------------------------
// Helper: set header row with styles
// ---------------------------------------------------------------------------
function setHeaderRow(worksheet, row, headers, startCol = 1) {
  headers.forEach((h, i) => {
    const cell = worksheet.getCell(row, startCol + i);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.alignment = CENTER_ALIGN;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  TITLE_FONT, SUBTITLE_FONT, HEADER_FONT, CELL_FONT, SMALL_FONT,
  THIN_BORDER, CENTER_ALIGN, LEFT_ALIGN, HEADER_FILL,
  addCompanyHeader, addInfoRow, addSignatureFooter,
  applyBorders, mergeCenter, setHeaderRow,
};
