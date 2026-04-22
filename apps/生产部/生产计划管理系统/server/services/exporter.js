const ExcelJS = require('exceljs');
const db = require('../db/connection');

const COLUMNS = [
  { key: 'supervisor',     header: '主管',       width: 8 },
  { key: 'line_name',      header: '拉名',       width: 8 },
  { key: 'worker_count',   header: '人数',       width: 6 },
  { key: 'factory_area',   header: '厂区',       width: 10 },
  { key: 'client',         header: '客名',       width: 10 },
  { key: 'order_date',     header: '来单日期',   width: 10 },
  { key: 'third_party',    header: '第三方客户名称', width: 20 },
  { key: 'country',        header: '国家',       width: 8 },
  { key: 'contract',       header: '合同',       width: 16 },
  { key: 'item_no',        header: '货号',       width: 16 },
  { key: 'product_name',   header: '产品名称',   width: 16 },
  { key: 'version',        header: '版本',       width: 8 },
  { key: 'quantity',       header: '数量',       width: 8 },
  { key: 'work_type',      header: '做工名称',   width: 8 },
  { key: 'production_count', header: '生产数',   width: 8 },
  { key: 'production_progress', header: '生产进度', width: 8 },
  { key: 'special_notes',  header: '特别备注',   width: 16 },
  { key: 'plastic_due',    header: '胶件复期',   width: 10 },
  { key: 'material_due',   header: '来料复期',   width: 10 },
  { key: 'carton_due',     header: '纸箱复期',   width: 10 },
  { key: 'packaging_due',  header: '包材复期',   width: 10 },
  { key: 'sticker',        header: '客贴纸',     width: 8 },
  { key: 'start_date',     header: '上拉日期',   width: 10 },
  { key: 'complete_date',  header: '完成日期',   width: 10 },
  { key: 'ship_date',      header: '走货期',     width: 10 },
  { key: 'inspection_date', header: '行Q期',     width: 8 },
  { key: 'month',          header: '月份',       width: 6 },
];

const HEADER_STYLE = {
  font: { bold: true, size: 10 },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  border: {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
};

const CELL_BORDER = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
};

function addOrderSheet(wb, sheetName, orders) {
  const ws = wb.addWorksheet(sheetName);
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = ws.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell(cell => {
    cell.font = HEADER_STYLE.font;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
    cell.fill = HEADER_STYLE.fill;
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const order of orders) {
    const row = ws.addRow(order);
    row.eachCell(cell => {
      cell.font = { size: 9 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = CELL_BORDER;
    });
  }
}

function addSummarySheet(wb, workshop) {
  const ws = wb.addWorksheet('产值明细汇总');
  const summaryRows = db.prepare('SELECT * FROM summary WHERE workshop = ?').all(workshop);
  const clients = [...new Set(summaryRows.map(r => r.client).filter(Boolean))];
  const headers = ['拉名', '人数', ...clients, '小计', '月份', '备注'];

  const workshopName = { A: '兴信A', B: '兴信B', C: '华登' }[workshop] || workshop;
  ws.mergeCells(1, 1, 1, headers.length);
  const titleCell = ws.getCell('A1');
  titleCell.value = workshopName + '成品产值预算';
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'center' };

  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.font = HEADER_STYLE.font;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  });

  const lineNames = [...new Set(summaryRows.map(r => r.line_name).filter(Boolean))];
  for (const lineName of lineNames) {
    const lineData = summaryRows.find(r => r.line_name === lineName) || {};
    const rowValues = [lineName, lineData.worker_count || ''];
    let subtotal = 0;
    for (const client of clients) {
      const val = summaryRows.find(r => r.line_name === lineName && r.client === client)?.value || 0;
      rowValues.push(val);
      subtotal += val;
    }
    rowValues.push(subtotal, lineData.month || '', lineData.remark || '');
    const row = ws.addRow(rowValues);
    row.eachCell(cell => { cell.border = CELL_BORDER; });
  }
}

async function exportWorkbook(workshop) {
  const wb = new ExcelJS.Workbook();

  addSummarySheet(wb, workshop);

  const activeOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'active');
  const supervisorName = activeOrders[0]?.supervisor || '排期表';
  addOrderSheet(wb, supervisorName, activeOrders);

  const completedOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'completed');
  addOrderSheet(wb, '完成订单', completedOrders);

  const cancelledOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'cancelled');
  addOrderSheet(wb, '取消单', cancelledOrders);

  wb.addWorksheet('Sheet9');

  addOrderSheet(wb, '完成成品数', []);

  const outsourceOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'outsource');
  addOrderSheet(wb, '外发货号', outsourceOrders);

  addOrderSheet(wb, '取消订单', cancelledOrders);

  return wb;
}

module.exports = { exportWorkbook };
