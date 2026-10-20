/**
 * monthly.js — 夹模具月结表 Excel 生成（对照样表 2026年8月份月结表.xlsx）
 * 分表：每个车间一个 sheet（夹模具区块）；总表 sheet「夹具月结总表」在最后。
 * 金额均为计算值写入（非公式），数字格式/边框/字号与样表一致。
 */
const ExcelJS = require('exceljs');

// 系统车间值 → 样表风格 sheet 名（样表用 华登/兴信A/兴信B，系统值为 华登车间/A车间/B车间）
// A车间→兴信A、B车间→兴信B 为推测映射，待用户确认
const WORKSHOP_SHEET_NAME = {
  '华登车间': '华登',
  '兴信车间': '兴信',
  'A车间': '兴信A',
  'B车间': '兴信B',
  '湖南': '湖南邵阳华登',
};
const sheetNameOf = ws => WORKSHOP_SHEET_NAME[ws] || ws || '未分车间';

const FONT = '宋体';
const BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
const FMT_DATE = 'm"月"d"日";@';
const FMT_AMT = '0_);[Red]\\(0\\)';
const FMT_AMT1 = '0.0_);[Red]\\(0.0\\)';
const FMT_SUM = '0.0_ ';

const CATS = ['设备', '原材料', '工具'];

function parseQty(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function parsePrice(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * rows: [{date, order_number, product_name, item_name, quantity, unit, price, completion_time, reason, workshop}]
 * month: 'YYYY-MM'；rate: 人民币→港币 除数（系统 exchange_rate_rmb_to_hkd，缺省 0.86）
 */
async function buildMonthlyWorkbook(rows, month, rate) {
  const [y, m] = month.split('-').map(Number);
  const wb = new ExcelJS.Workbook();

  // 按车间分组（保持出现顺序）
  const groups = new Map();
  for (const r of rows) {
    const ws = sheetNameOf(r.workshop);
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws).push(r);
  }

  const workshopTotals = []; // {sheet, total}
  for (const [sheetName, list] of groups) {
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { width: 8.875 }, { width: 23.0 }, { width: 28.0 }, { width: 6.875 },
      { width: 6.75 }, { width: 6.875 }, { width: 9.625 }, { width: 8.75 },
    ];
    // 标题行
    ws.mergeCells('A1:H1');
    const t = ws.getCell('A1');
    t.value = `${y}年${m}月份${sheetName}夹模具月结`;
    t.font = { name: FONT, size: 28, bold: true };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    t.border = BORDER; t.numFmt = FMT_DATE;
    ws.getRow(1).height = 35.25;
    for (let c = 1; c <= 8; c++) ws.getCell(1, c).border = BORDER;
    // 表头
    const heads = ['日期', '产品编号/名称', '物料名称', '数量', '单位', '单价¥', '金额¥', '备注'];
    const hr = ws.getRow(2);
    hr.height = 20;
    heads.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { name: FONT, size: 11, bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = BORDER;
      if (i === 0) c.numFmt = FMT_DATE;
      if (i === 6) c.numFmt = FMT_AMT;
    });
    // 明细
    let r = 3;
    let total = 0;
    for (const it of list) {
      const row = ws.getRow(r);
      row.height = 20;
      const qty = parseQty(it.quantity);
      const price = parsePrice(it.price);
      const amt = (qty || 0) * (price || 0);
      total += amt;
      const d = parseDate(it.completion_time) || parseDate(it.date);
      const prodLabel = [it.order_number, it.product_name].filter(s => s && String(s).trim()).join(' ') || '-';
      const vals = [d || it.completion_time || it.date || '-', prodLabel, it.item_name || '-',
        qty !== null ? qty : (it.quantity || '-'), it.unit || '-', price !== null ? price : (it.price || '-'),
        Math.round(amt * 100) / 100, it.reason || ''];
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        c.font = { name: FONT, size: 12 };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = BORDER;
        if (i === 0) c.numFmt = FMT_DATE;
        if (i === 6) c.numFmt = FMT_AMT;
      });
      r++;
    }
    // 合计行
    const sr = ws.getRow(r);
    sr.height = 20;
    const fCell = sr.getCell(6);
    fCell.value = '合计';
    fCell.font = { name: FONT, size: 11 };
    fCell.alignment = { horizontal: 'center', vertical: 'middle' };
    fCell.numFmt = FMT_AMT;
    const gCell = sr.getCell(7);
    gCell.value = Math.round(total * 100) / 100;
    gCell.font = { name: FONT, size: 12 };
    gCell.alignment = { horizontal: 'center', vertical: 'middle' };
    gCell.numFmt = FMT_AMT1;
    for (let c = 1; c <= 8; c++) { sr.getCell(c).border = BORDER; }
    // 签名行（照抄样表末行：A 列 17 个空格，C 列两个前导空格）
    const sg = ws.getRow(r + 1);
    sg.getCell(1).value = '                 ';
    sg.getCell(3).value = '  核对OK，请回签：';
    workshopTotals.push({ sheet: sheetName, total });
  }

  // ─── 总表 ───
  const t = wb.addWorksheet('夹具月结总表');
  t.getColumn('A').width = 24.875;
  t.getColumn('C').width = 8.75;
  t.getColumn('D').width = 20.0;
  t.getColumn('E').width = 16.75;
  t.getColumn('F').width = 14.625;
  t.mergeCells('A1:F1');
  const title = t.getCell('A1');
  title.value = `${y}年${m}月份夹模具月结总表`;
  title.font = { name: FONT, size: 28, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  t.getRow(1).height = 50.25;
  for (let c = 1; c <= 6; c++) t.getCell(1, c).border = BORDER;
  // 表头
  const hr = t.getRow(2);
  hr.height = 43.5;
  t.mergeCells('B2:C2');
  const th = { A: '车间', B: '类别', D: '金额¥', E: '金额HKS', F: '签名' };
  for (const [col, v] of Object.entries(th)) {
    const c = t.getCell(`${col}2`);
    c.value = v;
    c.font = { name: FONT, size: 16, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    if (col === 'D' || col === 'E') c.numFmt = FMT_AMT;
  }
  for (let c = 1; c <= 6; c++) t.getCell(2, c).border = BORDER;
  // 每个车间 3 行：设备/原材料/工具（本版金额整车间合并，不按类别拆）
  let rr = 3;
  const rmb = rate > 0 ? rate : 0.86; // 缺省 0.86（样表口径）
  let sumD = 0, sumE = 0;
  for (const g of workshopTotals) {
    const start = rr;
    CATS.forEach((cat, i) => {
      const row = t.getRow(rr);
      row.height = 24.95;
      const bc = row.getCell(2);
      bc.value = cat;
      bc.font = { name: FONT, size: 16 };
      bc.alignment = { horizontal: 'center', vertical: 'middle' };
      rr++;
    });
    t.mergeCells(`A${start}:A${start + 2}`);
    t.mergeCells(`D${start}:D${start + 2}`);
    t.mergeCells(`E${start}:E${start + 2}`);
    t.mergeCells(`F${start}:F${start + 2}`);
    const ac = t.getCell(`A${start}`);
    ac.value = g.sheet;
    ac.font = { name: FONT, size: 16 };
    ac.alignment = { horizontal: 'center', vertical: 'middle' };
    const eVal = g.total / rmb;
    const dc = t.getCell(`D${start}`);
    dc.value = Math.round(g.total * 100) / 100;
    dc.numFmt = FMT_SUM;
    dc.font = { name: FONT, size: 16 };
    dc.alignment = { horizontal: 'center', vertical: 'middle' };
    const ec = t.getCell(`E${start}`);
    ec.value = Math.round(eVal * 100) / 100;
    ec.numFmt = FMT_SUM;
    ec.font = { name: FONT, size: 16 };
    ec.alignment = { horizontal: 'center', vertical: 'middle' };
    sumD += g.total; sumE += eVal;
    for (let x = start; x < start + 3; x++) for (let c = 1; c <= 6; c++) t.getCell(x, c).border = BORDER;
  }
  // 合计行
  const tr = t.getRow(rr);
  tr.height = 24.95;
  const ta = tr.getCell(1); ta.value = '合计';
  const td = tr.getCell(4); td.value = Math.round(sumD * 100) / 100; td.numFmt = FMT_SUM;
  const te = tr.getCell(5); te.value = Math.round(sumE * 100) / 100; te.numFmt = FMT_SUM;
  [ta, td, te].forEach(c => {
    c.font = { name: FONT, size: 16, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  for (let c = 1; c <= 6; c++) tr.getCell(c).border = BORDER;

  return wb;
}

const monthlyFilename = month => {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月份夹模具月结表.xlsx`;
};

/** Content-Disposition（中文文件名，RFC 5987） */
function contentDisposition(filename) {
  return `attachment; filename="monthly.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = { buildMonthlyWorkbook, monthlyFilename, contentDisposition, sheetNameOf };
