// Build formatted Excel that mirrors the master 「外发模具计划」 layout:
//   Row 1: merged title 外发模具计划
//   Row 2: 23-column header (with 2-line headers like 订单数量\nPCS / 订单数量\n啤)
//   Row 3+: data rows. Consecutive same values in 车间 / 货号 / 供应商 / 跟进PMC /
//           下单日期 columns are merged vertically to mimic the original.
const ExcelJS = require('exceljs');

const COLUMNS = [
  { key: 'seq',                 header: '序号',          width: 6  },
  { key: 'workshop',            header: '车间',          width: 9,  mergeable: true },
  { key: 'item_code',           header: '货号',          width: 10, mergeable: true },
  { key: 'mold',                header: '模具',          width: 32 },
  { key: 'order_qty_pcs',       header: '订单数量\nPCS', width: 11, num: 0 },
  { key: 'order_qty_shots',     header: '订单数量\n啤',  width: 11, num: 0 },
  { key: 'quoted_capacity',     header: '报价日产能',    width: 10, num: 0 },
  { key: 'actual_capacity',     header: '实际\n产能',    width: 9,  num: 0 },
  { key: 'estimated_days',      header: '预计天数',      width: 9,  num: 2 },
  { key: 'quote_price_usd',     header: '核价$',         width: 9,  num: 4 },
  { key: 'supplier_price_rmb',  header: '供应商外发价￥', width: 11, num: 4 },
  { key: 'supplier_price_usd',  header: '供应商外发价$', width: 11, num: 4 },
  { key: 'supplier',            header: '供应商',        width: 12, mergeable: true },
  { key: 'pmc_follow',          header: '跟进PMC',       width: 10, mergeable: true },
  { key: 'order_date',          header: '下单日期',      width: 12, mergeable: true },
  { key: 'production_start',    header: '上机时间',      width: 12 },
  { key: 'estimated_delivery',  header: '预计交货期',    width: 12 },
  { key: 'remark',              header: '备注',          width: 18 },
  { key: 'in_house_output',     header: '本厂产值',      width: 11, num: 2 },
  { key: 'outsource_output',    header: '外发产值',      width: 11, num: 2 },
  { key: 'supplier_tax_output', header: '供应商扣税产值', width: 13, num: 2 },
  { key: 'net_outsource_output',header: '扣税后外发产值', width: 13, num: 2 },
  { key: 'status',              header: '状态',          width: 8  },
];

function thinBorder() {
  return {
    top:    { style: 'thin', color: { argb: 'FF666666' } },
    bottom: { style: 'thin', color: { argb: 'FF666666' } },
    left:   { style: 'thin', color: { argb: 'FF666666' } },
    right:  { style: 'thin', color: { argb: 'FF666666' } },
  };
}

function statusLabel(s) {
  return ({ open: '进行中', done: '已完成', cancelled: '已取消' })[s] || s || '';
}

async function buildOrdersWorkbook(orders, { sheet_name = '外发明细', title = '外发模具计划' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '啤机外发系统';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet_name, {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { defaultRowHeight: 18 },
  });

  // Column widths
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  // ── Row 1: merged title
  const lastCol = COLUMNS.length;
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, name: '微软雅黑' };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 28;

  // ── Row 2: headers
  const headerRow = ws.getRow(2);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, name: '微软雅黑' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });
  headerRow.height = 32;

  // ── Data rows
  orders.forEach((o, idx) => {
    const r = ws.getRow(3 + idx);
    r.height = 20;
    const obj = {
      seq: idx + 1,
      workshop: o.workshop || '',
      item_code: o.item_code || '',
      mold: o.mold || '',
      order_qty_pcs: o.order_qty_pcs ?? '',
      order_qty_shots: o.order_qty_shots ?? '',
      quoted_capacity: o.quoted_capacity ?? '',
      actual_capacity: o.actual_capacity ?? '',
      estimated_days: o.estimated_days ?? '',
      quote_price_usd: o.quote_price_usd ?? '',
      supplier_price_rmb: o.supplier_price_rmb ?? '',
      supplier_price_usd: o.supplier_price_usd ?? '',
      supplier: o.supplier || '',
      pmc_follow: o.pmc_follow || '',
      order_date: o.order_date || '',
      production_start: o.production_start || '',
      estimated_delivery: o.estimated_delivery || '',
      remark: o.remark || '',
      in_house_output: o.in_house_output ?? '',
      outsource_output: o.outsource_output ?? '',
      supplier_tax_output: o.supplier_tax_output ?? '',
      net_outsource_output: o.net_outsource_output ?? '',
      status: statusLabel(o.status),
    };
    COLUMNS.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = obj[c.key];
      cell.border = thinBorder();
      cell.font = { size: 10, name: '微软雅黑' };
      cell.alignment = {
        vertical: 'middle',
        horizontal: c.num !== undefined ? 'right' : 'center',
        wrapText: true,
      };
      if (c.num !== undefined && typeof cell.value === 'number') {
        cell.numFmt = c.num === 0 ? '#,##0' : `#,##0.${'0'.repeat(c.num)}`;
      }
      // Highlight 备注 with status hints (yellow if 已啤完/更新…)
      if (c.key === 'remark' && /已啤完|更新|加工/.test(String(obj.remark))) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      }
    });
  });

  // ── Merge consecutive same values in mergeable columns
  const mergeCols = COLUMNS
    .map((c, i) => ({ ...c, idx: i + 1 }))
    .filter((c) => c.mergeable);

  for (const c of mergeCols) {
    let runStart = 3;
    let runValue = ws.getRow(3).getCell(c.idx).value;
    for (let row = 4; row <= 2 + orders.length; row++) {
      const v = ws.getRow(row).getCell(c.idx).value;
      const eq = (a, b) => (a == null || a === '') ? (b == null || b === '') : a === b;
      if (eq(v, runValue)) continue;
      // close previous run if length > 1 and value non-empty
      if (row - 1 > runStart && runValue != null && runValue !== '') {
        ws.mergeCells(runStart, c.idx, row - 1, c.idx);
      }
      runStart = row;
      runValue = v;
    }
    // close final run
    const lastRow = 2 + orders.length;
    if (lastRow > runStart && runValue != null && runValue !== '') {
      ws.mergeCells(runStart, c.idx, lastRow, c.idx);
    }
  }

  return wb;
}

module.exports = { buildOrdersWorkbook };
