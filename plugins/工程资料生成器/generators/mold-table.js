const ExcelJS = require('exceljs');
const {
  TITLE_FONT, SUBTITLE_FONT, HEADER_FONT, CELL_FONT,
  THIN_BORDER, CENTER_ALIGN, LEFT_ALIGN, HEADER_FILL,
  addSignatureFooter, applyBorders, setHeaderRow,
} = require('./common');

const COLUMNS = [
  '工模编号', '模具名称', '零件编号', '物料名称', '用料名称',
  '海关备案料件名称', '颜色', '色粉编号', '加工内容（喷/印）',
  '水口比率(%)', '混水口比例(%)', '整啤毛重(g)', '整啤净重(g)',
  '单净重(g)', '整啤模腔数', '出模数', '套数', '用量',
  '订单需求数', '搭配', '机型(A)', '日产能(啤)', '模架尺寸宽X高X厚', '备注',
];

// Column widths indexed by position (0-based)
const COL_WIDTHS = {
  0: 14,   // 工模编号
  1: 12,   // 模具名称
  2: 12,   // 零件编号
  3: 12,   // 物料名称
  4: 16,   // 用料名称
  5: 16,   // 海关备案料件名称
  6: 14,   // 颜色
  7: 10,   // 色粉编号
  8: 12,   // 加工内容
  9: 10,   // 水口比率
  10: 10,  // 混水口比例
  11: 10,  // 整啤毛重
  12: 10,  // 整啤净重
  13: 10,  // 单净重
  14: 10,  // 整啤模腔数
  15: 8,   // 出模数
  16: 8,   // 套数
  17: 8,   // 用量
  18: 10,  // 订单需求数
  19: 8,   // 搭配
  20: 10,  // 机型
  21: 10,  // 日产能
  22: 16,  // 模架尺寸
  23: 16,  // 备注
};

/**
 * Generate 排模表 Excel workbook.
 * @param {object} product  - product data object
 * @param {object} factoryConfig - factory/company config
 * @returns {ExcelJS.Workbook}
 */
async function generate(product, factoryConfig) {
  const workbook = new ExcelJS.Workbook();

  // Group parts by the `group` field
  const groups = {};
  for (const part of (product.parts || [])) {
    const g = part.group || '默认';
    if (!groups[g]) groups[g] = [];
    groups[g].push(part);
  }

  // If no parts at all, create one empty sheet
  if (Object.keys(groups).length === 0) {
    groups['Sheet1'] = [];
  }

  for (const [groupName, parts] of Object.entries(groups)) {
    const ws = workbook.addWorksheet(groupName);
    const totalCols = COLUMNS.length;

    // Set column widths
    ws.columns = COLUMNS.map((_, i) => ({ width: COL_WIDTHS[i] || 10 }));

    // ----------------------------------------------------------------
    // Row 1: Company name (merged) + "Total Order Quantities" on right
    // ----------------------------------------------------------------
    let rowNum = 1;
    ws.mergeCells(rowNum, 1, rowNum, totalCols - 1);
    const companyCell = ws.getCell(rowNum, 1);
    companyCell.value = factoryConfig.full_name || factoryConfig.name || '';
    companyCell.font = TITLE_FONT;
    companyCell.alignment = CENTER_ALIGN;
    ws.getRow(rowNum).height = 30;

    // "Total Order Quantities (pcs): xxx" at last column
    const oqCell = ws.getCell(rowNum, totalCols);
    oqCell.value = `Total Order Quantities (pcs): ${
      product.order_qty != null
        ? Number(product.order_qty).toLocaleString()
        : ''
    }`;
    oqCell.font = { name: '宋体', size: 9, bold: true };
    oqCell.alignment = LEFT_ALIGN;

    rowNum++;

    // ----------------------------------------------------------------
    // Row 2: Document title with doc number and version
    // ----------------------------------------------------------------
    ws.mergeCells(rowNum, 1, rowNum, totalCols);
    const titleCell = ws.getCell(rowNum, 1);
    titleCell.value =
      '排  模  表         文件编号：HSQR0064        版本号:A/0';
    titleCell.font = SUBTITLE_FONT;
    titleCell.alignment = CENTER_ALIGN;
    ws.getRow(rowNum).height = 25;

    rowNum++;

    // ----------------------------------------------------------------
    // Row 3: Info row (client, product no, product name, 编制/审核/批准/日期)
    // ----------------------------------------------------------------
    ws.mergeCells(rowNum, 1, rowNum, totalCols);
    const infoCell = ws.getCell(rowNum, 1);
    infoCell.value =
      `客户名称：${product.client_name || ''}    ` +
      `产品编号：${product.product_number || ''}    ` +
      `产品名称：${product.product_name || ''}    ` +
      `编制：    审核：    批准：    日期：`;
    infoCell.font = CELL_FONT;
    infoCell.alignment = LEFT_ALIGN;
    ws.getRow(rowNum).height = 18;

    rowNum++;

    // ----------------------------------------------------------------
    // Row 4: Column headers
    // ----------------------------------------------------------------
    setHeaderRow(ws, rowNum, COLUMNS);
    ws.getRow(rowNum).height = 30;
    const headerRowNum = rowNum;
    rowNum++;

    // ----------------------------------------------------------------
    // Data rows
    // ----------------------------------------------------------------
    const dataStartRow = rowNum;
    let lastMoldId = null;

    for (const part of parts) {
      const showMold = part.mold_id !== lastMoldId;

      // Build notes: combine notes and mold_count if both present
      const noteParts = [part.notes, part.mold_count].filter(
        (v) => v != null && v !== ''
      );
      const noteValue = noteParts.join('\n') || '';

      const values = [
        showMold ? (part.mold_id || '') : '',       // 工模编号
        showMold ? (part.mold_name || '') : '',      // 模具名称
        part.part_number || '',                      // 零件编号
        part.part_name || '',                        // 物料名称
        part.material || '',                         // 用料名称
        part.customs_name || '',                     // 海关备案料件名称
        part.color || '',                            // 颜色
        part.pigment_no || '',                       // 色粉编号
        part.process || '',                          // 加工内容
        part.runner_ratio != null ? part.runner_ratio : '',   // 水口比率
        part.mixed_ratio != null ? part.mixed_ratio : '',     // 混水口比例
        part.gross_weight_g != null ? part.gross_weight_g : '',  // 整啤毛重
        part.net_weight_g != null ? part.net_weight_g : '',      // 整啤净重
        part.single_net_weight_g != null ? part.single_net_weight_g : '', // 单净重
        part.cavities != null ? part.cavities : '',              // 整啤模腔数
        part.output_per_shot != null ? part.output_per_shot : '', // 出模数
        part.sets != null ? part.sets : '',                       // 套数
        part.usage_ratio || '',                      // 用量
        part.order_qty != null ? part.order_qty : '', // 订单需求数
        '',                                           // 搭配 (empty)
        part.machine_type || '',                      // 机型
        '',                                           // 日产能 (empty)
        part.mold_size || '',                         // 模架尺寸
        noteValue,                                    // 备注
      ];

      const r = ws.getRow(rowNum);
      r.height = 18;
      values.forEach((v, i) => {
        const cell = ws.getCell(rowNum, i + 1);
        cell.value = v;
        cell.font = CELL_FONT;
        cell.alignment = CENTER_ALIGN;
        cell.border = THIN_BORDER;
      });

      lastMoldId = part.mold_id;
      rowNum++;
    }

    // If no data rows, still apply borders to header row only
    if (parts.length === 0) {
      applyBorders(ws, headerRowNum, headerRowNum, 1, totalCols);
    } else {
      applyBorders(ws, headerRowNum, rowNum - 1, 1, totalCols);
    }

    // ----------------------------------------------------------------
    // Signature footer
    // ----------------------------------------------------------------
    rowNum++; // blank separator
    addSignatureFooter(ws, rowNum, totalCols);
  }

  return workbook;
}

module.exports = { generate };
