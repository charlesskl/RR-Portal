/**
 * Excel 导出 + 模板生成
 * 格式完全匹配 47716A 皮卡车拖车与越野车 走货明细.xlsx
 */
const ExcelJS = require('exceljs');

// ====== 第1行标题行（双语，与47716A完全一致）======
const HEADERS = [
  { col: 1,  text: '序号    serial number',                                      width: 8.3  },
  { col: 2,  text: '中国HSCODE（China）',                                         width: 12.9 },
  { col: 3,  text: '  印尼HS CODE (Indonesia)',                                   width: 12.9 },
  { col: 4,  text: '货号 Item No.',                                               width: 13.2 },
  { col: 5,  text: '产品中文名称 Chinese name of the product',                    width: 20.2 },
  { col: 6,  text: '产品英文名称 English name of the product',                    width: 33.8 },
  { col: 7,  text: '规格 specification',                                          width: 32.3 },
  { col: 8,  text: '规格（英文） Specification in English',                       width: 12.8 },
  { col: 9,  text: '单位 Unit',                                                   width: 12.8 },
  { col: 10, text: '需求数量 Quantity',                                           width: 12.8 },
  { col: 11, text: '供应商 Supplier',                                             width: 33   },
  { col: 12, text: '采购单日期 Date of purchase order',                           width: 12.8 },
  { col: 13, text: '采购单号 PO No.',                                             width: 12.8 },
  { col: 14, text: '采购单价 Purchase price',                                     width: 12.8 },
  { col: 15, text: '采购金额Purchase Amount',                                     width: 12.8 },
  { col: 16, text: '采购总额 Total Amount',                                       width: 12.8 },
  { col: 17, text: '单个毛重 Gross weight（KGM）',                                width: 11.8 },
  { col: 18, text: '毛重总重 Total Gross weight（KGM）',                          width: 14.6 },
  { col: 19, text: '单个净重 Net weight（KGM）',                                  width: 11.8 },
  { col: 20, text: '净重总重Total Net weight（KGM）',                             width: 11.8 },
  { col: 21, text: '卡板号 Pallet No.',                                           width: 11.8 },
  { col: 22, text: '箱号 Carton No.',                                             width: 19.2 },
  { col: 23, text: '箱数 Carton No.',                                             width: 8.7  },
  { col: 24, text: '每箱数量Qty/Per carton',                                      width: 21.8 },
  { col: 25, text: '长 Length',                                                   width: 11.8 },
  { col: 26, text: '宽 Width',                                                    width: 11.8 },
  { col: 27, text: '高 Height',                                                   width: 11.8 },
  { col: 28, text: '立方数/每箱CBM/Per carton',                                   width: 11.8 },
  { col: 29, text: '总立方数Total CBM',                                            width: 11.8 },
  { col: 30, text: '图片 Picture ',                                               width: 11.8 },
  { col: 31, text: '',                                                             width: 11.8 },
  { col: 32, text: '合同号码 Contract No.',                                       width: 11.8 },
  { col: 33, text: '合同日期 Date of contract',                                   width: 11.8 },
  { col: 34, text: '发票号 Invoice No.',                                          width: 11.8 },
  { col: 35, text: '发票日期 Date of Invoice',                                    width: 11.8 },
  { col: 36, text: '发票单价 Unit price on invoice',                              width: 11.8 },
  { col: 37, text: '金额 Invoice amount',                                         width: 16.4 },
  { col: 38, text: '发票合计金额Invoice total amount',                             width: 11.8 },
  { col: 39, text: '运费',                                                        width: 11.8 },
  { col: 40, text: '产品数量Product quantity',                                    width: 11.8 },
  { col: 41, text: '单位 Unit',                                                   width: 11.8 },
  { col: 42, text: '',                                                             width: 9.7  },
  { col: 43, text: '装箱数',                                                      width: 25.8 },
];

// 从源数据映射到目标列
const DATA_COLS = [
  { col: 1,  key: 'seq'        },  // 序号
  { col: 4,  key: 'prodNo'     },  // 货号 Item No.
  { col: 5,  key: 'partName'   },  // 产品中文名称
  { col: 6,  key: 'partNameEn' },  // 产品英文名称
  { col: 7,  key: 'material'   },  // 规格（材料+颜色）
  { col: 9,  key: 'unit'       },  // 单位
  { col: 10, key: 'qty'        },  // 需求数量
  { col: 11, key: 'supplier'   },  // 供应商
  { col: 19, key: 'unitWt'     },  // 单个净重(KGM)
];

const BLUE_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE5F1' } };
const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

const BORDER = {
  top:    { style: 'thin', color: { argb: 'FF000000' } },
  left:   { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right:  { style: 'thin', color: { argb: 'FF000000' } },
};

function buildSheet(ws) {
  // 设置列宽
  HEADERS.forEach(({ col, width }) => {
    ws.getColumn(col).width = width;
  });

  // 第1行：标题行
  const hdrRow = ws.getRow(1);
  hdrRow.height = 62;
  HEADERS.forEach(({ col, text }) => {
    if (!text) return;
    const cell = hdrRow.getCell(col);
    cell.value     = text;
    cell.fill      = HEADER_FILL;
    cell.font      = { bold: true, size: 9, name: 'Arial' };
    cell.border    = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}

/**
 * 生成走货明细 Excel buffer（格式与47716A完全一致）
 */
async function generateExport(product, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '走货明细管理系统';
  wb.created = new Date();

  const ws = wb.addWorksheet('走货明细', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  buildSheet(ws);

  // 数据行（从第2行起）
  rows.forEach((row, idx) => {
    const exRow = ws.getRow(2 + idx);
    exRow.height = 62;
    const fill = row.type === 'mold' ? BLUE_FILL : YELLOW_FILL;

    // 先对所有43列应用颜色和边框
    for (let c = 1; c <= 43; c++) {
      const cell = exRow.getCell(c);
      cell.fill   = fill;
      cell.border = BORDER;
      cell.font   = { size: 9, name: 'Arial' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }

    // 再写入数据列的值
    DATA_COLS.forEach(({ col, key }) => {
      exRow.getCell(col).value = row[key] ?? '';
    });

  });

  // 排模表行：供应商(K列) 第一行下拉，其余引用
  let firstMoldExcelRow = 0;
  rows.forEach((row, idx) => {
    if (row.type !== 'mold') return;
    const excelRow = 2 + idx;
    if (!firstMoldExcelRow) {
      firstMoldExcelRow = excelRow;
      ws.getRow(excelRow).getCell(11).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"东莞兴信塑胶制品有限公司,东莞华登塑胶制品有限公司"'],
      };
    } else {
      ws.getRow(excelRow).getCell(11).value = { formula: `K${firstMoldExcelRow}` };
    }
  });

  // 所有行：单位AO列(col41) 每行独立下拉(PCS/套)
  rows.forEach((row, idx) => {
    const cell = ws.getRow(2 + idx).getCell(41);
    cell.value = 'PCS';
    cell.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"PCS,套"'],
    };
  });

  return wb.xlsx.writeBuffer();
}

/**
 * 下载空白模板（只含走货明细表头，格式与47716A一致）
 */
async function generateTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '走货明细管理系统';
  wb.created = new Date();

  const ws = wb.addWorksheet('走货明细', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  buildSheet(ws);

  return wb.xlsx.writeBuffer();
}

module.exports = { generateExport, generateTemplate };
