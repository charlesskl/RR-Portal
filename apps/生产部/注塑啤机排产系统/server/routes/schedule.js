const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ORDERS_FILE   = path.join(__dirname, '..', 'data', 'orders.json');
const MOLDS_FILE    = path.join(__dirname, '..', 'data', 'molds.json');
const SCHEDULES_FILE = path.join(__dirname, '..', 'data', 'schedules.json');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ===================== AI排机核心算法 =====================
function generateSchedule(orders, molds) {
  const moldMap = {};
  molds.forEach(m => { moldMap[m.模具编号] = m; });

  const items = [];
  orders.forEach(order => {
    const mold = moldMap[order.模具编号];
    if (!mold) {
      // 排模表中找不到此模具
      items.push({
        机台: '未知机台',
        产品货号: order.款号 || '',
        模号名称: `${order.模具编号 || ''} ${order.工模名称 || ''}`.trim(),
        模具编号: order.模具编号 || '',
        颜色: order.颜色 || '',
        色粉编号: '',
        料型: order.材料 || '',
        啤重G: 0,
        用料KG: 0,
        水口百分比: 0,
        比率: 0,
        啤数: Number(order.啤数) || 0,
        周期: 0,
        模穴: 0,
        生产小时: 0,
        累计数: 0,
        欠数: Number(order.啤数) || 0,
        下单单号: order.款号 || '',
        '24H目标': 0,
        '11H目标': 0,
        天数: 0,
        备注: '排模表无此模具',
        机械手: '',
        夹具: '',
        转膜时间: '',
        调机人员: '',
        orderId: order.id,
      });
      return;
    }

    const 模穴 = Number(mold.模穴) || 1;
    const 周期 = Number(mold.周期) || 30;
    const 啤数 = Number(order.啤数) || 0;
    const 生产小时 = 啤数 / 模穴 * 周期 / 3600;
    const target24 = Math.floor(24 * 3600 / 周期 * 模穴);
    const target11 = Math.floor(11 * 3600 / 周期 * 模穴);
    const 天数 = parseFloat((生产小时 / 24).toFixed(2));
    const 啤重G = mold.啤重G || (mold.单件重量 * 模穴) || 0;
    const 用料KG = 啤重G && 啤数 ? parseFloat((啤数 * 啤重G / 1000000).toFixed(1)) : 0;

    items.push({
      机台: mold.机台型号 || '',
      产品货号: order.款号 || '',
      模号名称: `${order.模具编号 || ''} ${order.工模名称 || mold.工模名称 || ''}`.trim(),
      模具编号: order.模具编号 || '',
      颜色: order.颜色 || '',
      色粉编号: mold.色粉编号 || '',
      料型: order.材料 || mold.料型 || '',
      啤重G,
      用料KG,
      水口百分比: mold.水口比率 ? parseFloat((mold.水口比率 * 100).toFixed(2)) : 0,
      比率: mold.混水口比率 ? parseFloat((mold.混水口比率 * 100).toFixed(2)) : 0,
      啤数,
      周期,
      模穴,
      生产小时: parseFloat(生产小时.toFixed(2)),
      累计数: 0,
      欠数: 啤数,
      下单单号: order.款号 || '',
      '24H目标': target24,
      '11H目标': target11,
      天数,
      备注: '',
      机械手: '',
      夹具: '',
      转膜时间: '',
      调机人员: '',
      orderId: order.id,
    });
  });

  // 按机台分组，每组内按生产时间从长到短排序
  const groups = {};
  items.forEach(item => {
    const key = item.机台;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  const sorted = [];
  Object.keys(groups).sort().forEach(machine => {
    const group = groups[machine].sort((a, b) => b.生产小时 - a.生产小时);
    sorted.push(...group);
  });

  return sorted;
}

// 获取所有排机表
router.get('/', (req, res) => {
  res.json(readJSON(SCHEDULES_FILE));
});

// 生成排机表
router.post('/generate', (req, res) => {
  const { date, orderIds } = req.body;
  if (!date) return res.status(400).json({ message: '请提供排机日期' });

  const allOrders = readJSON(ORDERS_FILE);
  const molds = readJSON(MOLDS_FILE);

  // 如果指定了订单ID则只处理指定的，否则处理所有
  const orders = orderIds && orderIds.length > 0
    ? allOrders.filter(o => orderIds.includes(o.id))
    : allOrders;

  if (orders.length === 0) return res.status(400).json({ message: '没有订单数据，请先导入订单' });

  const items = generateSchedule(orders, molds);

  const schedules = readJSON(SCHEDULES_FILE);
  const schedule = {
    id: Date.now().toString(),
    date,
    items,
    createdAt: new Date().toISOString(),
  };
  schedules.unshift(schedule);
  writeJSON(SCHEDULES_FILE, schedules);

  res.json(schedule);
});

// 获取单个排机表
router.get('/:id', (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE);
  const s = schedules.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ message: '排机表不存在' });
  res.json(s);
});

// 更新排机表中某行数据（人工编辑）
router.put('/:id/item/:itemIdx', (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE);
  const s = schedules.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ message: '排机表不存在' });
  const idx = parseInt(req.params.itemIdx);
  if (isNaN(idx) || idx < 0 || idx >= s.items.length) return res.status(400).json({ message: '行索引无效' });
  s.items[idx] = { ...s.items[idx], ...req.body };
  writeJSON(SCHEDULES_FILE, schedules);
  res.json(s.items[idx]);
});

// 删除排机表
router.delete('/:id', (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE);
  writeJSON(SCHEDULES_FILE, schedules.filter(s => s.id !== req.params.id));
  res.json({ message: '已删除' });
});

// 导出 Excel（兴信B注塑部每日排单表格式）
router.get('/:id/export', async (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE);
  const schedule = schedules.find(s => s.id === req.params.id);
  if (!schedule) return res.status(404).json({ message: '排机表不存在' });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`排机表_${schedule.date}`);

  // 列宽设置（A列留空，数据从B列开始）
  const colWidths = [3, 8, 14, 30, 12, 10, 14, 8, 8, 10, 8, 8, 8, 10, 10, 10, 14, 10, 10, 7, 16, 8, 8, 10, 12];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // 第1行：公司标题（合并 A1:W1）
  ws.mergeCells(1, 1, 1, 25);
  const titleCell = ws.getCell('A1');
  titleCell.value = '兴信B注塑部每日排单表';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAE8FC' } };
  ws.getRow(1).height = 28;

  // 第2行：班次 + 日期
  ws.getRow(2).getCell(2).value = schedule.班次 || '夜 班';
  ws.getRow(2).getCell(2).font = { bold: true };
  ws.getRow(2).getCell(4).value = schedule.date;
  ws.getRow(2).height = 20;

  // 第3行：表头
  const headerRow = ws.addRow(['', '机台', '产品货号', '模号名称', '颜色', '色粉编号', '料型',
    '啤重G', '用料KG', '水口百分比%', '比率%', '周期(s)', '模穴', '累计数', '需啤数', '欠数', '下单单号',
    '24H目标', '11H目标', '天数', '备注', '机械手', '夹具', '转膜时间', '调机人员']);
  headerRow.eachCell((cell, col) => {
    if (col === 1) return;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1677FF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  headerRow.height = 30;

  // 数据行
  schedule.items.forEach((item, i) => {
    const dataRow = ws.addRow([
      '',
      item.机台,
      item.产品货号,
      item.模号名称,
      item.颜色,
      item.色粉编号 || '',
      item.料型 || '',
      item.啤重G || '',
      item.用料KG || '',
      item.水口百分比 || '',
      item.比率 || '',
      item.周期 || '',
      item.模穴 || '',
      item.累计数 ?? 0,
      item.啤数,
      item.欠数,
      item.下单单号 || item.产品货号 || '',
      item['24H目标'],
      item['11H目标'],
      item.天数,
      item.备注 || '',
      item.机械手 || '',
      item.夹具 || '',
      item.转膜时间 || '',
      item.调机人员 || '',
    ]);
    dataRow.eachCell((cell, col) => {
      if (col === 1) return;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      if (i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5FF' } };
      }
    });
    dataRow.height = 18;
  });

  const filename = `排机表_${schedule.date}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
