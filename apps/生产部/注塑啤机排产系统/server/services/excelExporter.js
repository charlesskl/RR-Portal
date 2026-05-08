const ExcelJS = require('exceljs');
const db = require('../db/connection');

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 格式化日期为中文: "2026年3月10日星期二"
 */
function formatDateChinese(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAYS[d.getDay()];
  return `${y}年${m}月${day}日${weekday}`;
}

/**
 * 格式化班次: "白 班" / "夜 班"
 */
function formatShift(shift) {
  if (!shift) return '白 班';
  if (shift.includes('白')) return '白 班';
  if (shift.includes('夜')) return '夜 班';
  return shift;
}

/**
 * 导出排机单为Excel（严格对齐实际排单表格式）
 */
async function exportScheduleExcel(scheduleId) {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) throw new Error('排机单不存在');

  const items = db.prepare(`
    SELECT si.*, m.arm_type, m.tonnage, m.brand
    FROM schedule_items si
    LEFT JOIN machines m ON si.machine_no = m.machine_no
    WHERE si.schedule_id = ?
    ORDER BY CAST(REPLACE(REPLACE(REPLACE(si.machine_no, '#', ''), 'C-', ''), 'A-', '') AS INTEGER), si.sort_order, si.id
  `).all(scheduleId);

  // 查询所有机台信息用于显示
  const machineMap = {};
  db.prepare('SELECT * FROM machines').all().forEach(m => {
    machineMap[m.machine_no] = m;
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('排机单', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // ========== 列定义（A~X共24列） ==========
  //               A机台  B货号  C模号   D颜色  E色粉  F料型   G啤重 H用料  I水口  J比率 K累计  L需啤  M欠数  N单号   O-24H  P-11H Q天数 R备注  S机械手 T夹具 U转膜  V调机  W分类  X吨位
  //               A机台  B货号  C模号   D颜色  E色粉  F料型   G啤重 H用料  I水口  J比率 K累计  L需啤  M欠数  N下单号 O单号  P-24H  Q-11H R天数  S备注  T机械手 U夹具 V转膜  W调机  X分类  Y吨位
  const colWidths = [6,    13,    26,     12,    10,    16,     8,    9,     9,     8,    10,    10,    10,    12,     10,    10,    10,    7,     18,    9,     8,    10,    10,    8,     6];
  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const headers = [
    '机台', '产品货号', '模号名称', '颜色', '色粉编号', '料型',
    '啤重G', '用料KG', '水口百分比%', '比率%', '累计数', '需啤数', '欠数',
    '下单单号', '单号', '24H目标数', '11H目标数', '天数',
    '备注', '机械手', '夹具', '转膜时间', '调机人员', '分类', '吨位',
  ];

  // ========== Row 1: 标题 ==========
  ws.mergeCells('A1:Y1');
  const titleCell = ws.getCell('A1');
  const wsName = schedule.workshop === 'A' ? '兴信A' : schedule.workshop === 'C' ? '华登' : '兴信B';
  titleCell.value = `${wsName}注塑部每日排单表`;
  titleCell.font = { size: 22, bold: true, name: '宋体' };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 42;

  // ========== Row 2: 班次 + 日期 ==========
  ws.mergeCells('A2:C2');
  const shiftCell = ws.getCell('A2');
  shiftCell.value = formatShift(schedule.shift);
  shiftCell.font = { size: 16, bold: true, name: '宋体' };
  shiftCell.alignment = { horizontal: 'left', vertical: 'middle' };

  ws.mergeCells('D2:H2');
  const dateCell = ws.getCell('D2');
  dateCell.value = formatDateChinese(schedule.schedule_date);
  dateCell.font = { size: 16, bold: true, name: '宋体' };
  dateCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(2).height = 30;

  // ========== Row 3: 表头 ==========
  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { size: 10, bold: true, name: '宋体' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = fullBorder();
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  });
  headerRow.height = 26;

  // ========== Row 4+: 数据行 ==========
  // 其他机台排到制表人行之后
  const regularItems = items.filter(it => it.machine_no !== '其他机台');
  const otherItems = items.filter(it => it.machine_no === '其他机台');
  const allItems = [...regularItems, null, ...otherItems]; // null 作为分隔符

  let rowNum = 4;
  const machineGroups = {}; // { machineNo: [{start, end}] } 按连续段分组
  let prevMachineNo = null;
  let footerRowNum = null; // 制表人行行号
  let summaryRowNum = null; // 汇总行行号

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];

    // null 分隔符：先写汇总行 + 制表人行，再继续写其他机台
    if (item === null) {
      summaryRowNum = rowNum;
      const summaryRow = ws.getRow(rowNum);
      ws.mergeCells(`A${rowNum}:F${rowNum}`);
      summaryRow.getCell(1).value = `合计: ${regularItems.length} 条排机记录`;
      summaryRow.getCell(1).font = { size: 10, bold: true, name: '宋体' };
      summaryRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      summaryRow.getCell(1).border = fullBorder();
      for (let c = 7; c <= 25; c++) summaryRow.getCell(c).border = fullBorder();
      summaryRow.height = 22;
      rowNum++;

      footerRowNum = rowNum;
      const footerRow = ws.getRow(rowNum);
      ws.mergeCells(`A${rowNum}:E${rowNum}`);
      footerRow.getCell(1).value = '制表人：';
      footerRow.getCell(1).font = { size: 11, name: '宋体' };
      footerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      ws.mergeCells(`L${rowNum}:P${rowNum}`);
      footerRow.getCell(12).value = '审核：';
      footerRow.getCell(12).font = { size: 11, name: '宋体' };
      footerRow.getCell(12).alignment = { horizontal: 'left', vertical: 'middle' };
      footerRow.height = 28;
      rowNum++;

      prevMachineNo = null; // 重置，让其他机台重新开始分组
      continue;
    }

    {
    const row = ws.getRow(rowNum);
    const machine = machineMap[item.machine_no] || {};

    // 记录机台连续行段
    if (item.machine_no !== prevMachineNo) {
      if (!machineGroups[item.machine_no]) machineGroups[item.machine_no] = [];
      machineGroups[item.machine_no].push({ start: rowNum, end: rowNum });
    } else {
      const groups = machineGroups[item.machine_no];
      groups[groups.length - 1].end = rowNum;
    }
    prevMachineNo = item.machine_no;

    // 分类: 五轴/三轴 简写
    let armLabel = '';
    if (machine.arm_type) {
      if (machine.arm_type.includes('五轴')) armLabel = '五轴';
      else if (machine.arm_type.includes('三轴')) armLabel = '三轴';
      else armLabel = machine.arm_type;
    }

    const values = [
      item.machine_no,                    // A 机台
      item.product_code || '',            // B 货号
      item.mold_name || '',               // C 模号名称
      item.color || '',                   // D 颜色
      item.color_powder_no || '',         // E 色粉编号
      item.material_type || '',           // F 料型
      item.shot_weight || 0,              // G 啤重G
      item.material_kg || 0,              // H 用料KG
      item.sprue_pct || 0,               // I 水口百分比%
      item.ratio_pct || 0,               // J 比率%
      item.accumulated || 0,             // K 累计数
      item.quantity_needed || 0,          // L 需啤数
      Math.max(0, (item.quantity_needed||0) - (item.accumulated||0)),  // M 欠数
      item.order_no || '',               // N 下单单号
      item.serial_no || '',              // O 单号
      item.target_24h || 0,              // P 24H目标
      item.target_24h ? Math.round((item.target_24h)/24*11) : 0,     // Q 11H
      item.target_24h ? Math.round(Math.max(0,(item.quantity_needed||0)-(item.accumulated||0))/(item.target_24h)*100)/100 : '', // R 天数
      item.notes || '',                  // S 备注
      item.robot_arm || '',              // T 机械手
      item.clamp || '',                  // U 夹具
      item.mold_change_time || '',       // V 转膜时间
      item.adjuster || '',               // W 调机人员
      armLabel,                          // X 分类
      machine.tonnage || '',             // Y 吨位
    ];

    values.forEach((v, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = v;
      cell.font = { size: 10, name: '宋体' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = fullBorder();
    });

    // 模号名称列左对齐（内容较长）
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    // 料型列左对齐
    row.getCell(6).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

    // 累计数列 - 有值时橙色背景高亮
    const accumulatedVal = item.accumulated || 0;
    if (accumulatedVal > 0) {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
    }

    // 备注列红色粗体（S列=19）
    if (item.notes) {
      const notesCell = row.getCell(19);
      notesCell.font = { size: 10, bold: true, color: { argb: 'FFFF0000' }, name: '宋体' };
    }

    // 交替行底色（不覆盖已有填充色的单元格）
    if (rowNum % 2 === 1) {
      for (let c = 1; c <= 25; c++) {
        const cell = row.getCell(c);
        if (!cell.fill || !cell.fill.fgColor || cell.fill.fgColor.argb === 'FF000000') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
      }
    }

    row.height = 22;
    rowNum++;
    } // end item block
  }

  // 若没有其他机台（null 分隔符未出现），在最后补汇总行和制表人行
  if (footerRowNum === null) {
    const summaryRow = ws.getRow(rowNum);
    ws.mergeCells(`A${rowNum}:F${rowNum}`);
    summaryRow.getCell(1).value = `合计: ${regularItems.length} 条排机记录`;
    summaryRow.getCell(1).font = { size: 10, bold: true, name: '宋体' };
    summaryRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    summaryRow.getCell(1).border = fullBorder();
    for (let c = 7; c <= 25; c++) summaryRow.getCell(c).border = fullBorder();
    summaryRow.height = 22;
    rowNum++;

    const footerRow = ws.getRow(rowNum);
    ws.mergeCells(`A${rowNum}:E${rowNum}`);
    footerRow.getCell(1).value = '制表人：';
    footerRow.getCell(1).font = { size: 11, name: '宋体' };
    footerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    ws.mergeCells(`L${rowNum}:P${rowNum}`);
    footerRow.getCell(12).value = '审核：';
    footerRow.getCell(12).font = { size: 11, name: '宋体' };
    footerRow.getCell(12).alignment = { horizontal: 'left', vertical: 'middle' };
    footerRow.height = 28;
    rowNum++;
  }

  // ========== 合并同机台单元格（A列纵向，按连续段合并） ==========
  for (const machineNo in machineGroups) {
    for (const { start, end } of machineGroups[machineNo]) {
      if (end > start) {
        ws.mergeCells(`A${start}:A${end}`);
        ws.mergeCells(`X${start}:X${end}`);
        ws.mergeCells(`Y${start}:Y${end}`);
      }
      // 机台号加粗
      const cell = ws.getCell(`A${start}`);
      cell.font = { size: 11, bold: true, name: '宋体' };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = fullBorder();

      // 分类列居中
      const armCell = ws.getCell(`X${start}`);
      armCell.alignment = { horizontal: 'center', vertical: 'middle' };
      armCell.border = fullBorder();

      // 吨位列居中
      const tonCell = ws.getCell(`Y${start}`);
      tonCell.alignment = { horizontal: 'center', vertical: 'middle' };
      tonCell.border = fullBorder();
    }
  }

  // ========== 冻结前3行+前1列 ==========
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3, activeCell: 'B4' }];

  // ========== Sheet 2: 上一班次排单（历史记录） ==========
  const prevSchedule = findPreviousSchedule(schedule);
  if (prevSchedule) {
    const prevItems = db.prepare(`
      SELECT si.*, m.arm_type, m.tonnage, m.brand
      FROM schedule_items si
      LEFT JOIN machines m ON si.machine_no = m.machine_no
      WHERE si.schedule_id = ?
      ORDER BY CAST(REPLACE(REPLACE(REPLACE(si.machine_no, '#', ''), 'C-', ''), 'A-', '') AS INTEGER), si.sort_order, si.id
    `).all(prevSchedule.id);

    if (prevItems.length > 0) {
      const prevSheetName = `${prevSchedule.schedule_date} ${prevSchedule.shift}`;
      const ws2 = wb.addWorksheet(prevSheetName, {
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      writeScheduleSheet(ws2, prevSchedule, prevItems, machineMap, wsName);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `${wsName}注塑部排机单_${schedule.schedule_date}_${schedule.shift}.xlsx`,
  };
}

/**
 * 查找上一班次的排机单
 */
function findPreviousSchedule(schedule) {
  // 找同车间、当前排单之前的最近一个排单
  return db.prepare(`
    SELECT * FROM schedules
    WHERE workshop = ? AND id < ?
    ORDER BY schedule_date DESC, shift DESC, id DESC
    LIMIT 1
  `).get(schedule.workshop || 'B', schedule.id);
}

/**
 * 将排机数据写入一个worksheet
 */
function writeScheduleSheet(ws, schedule, items, machineMap, wsName) {
  const colWidths = [6, 13, 26, 12, 10, 16, 8, 9, 9, 8, 10, 10, 10, 12, 10, 10, 10, 7, 18, 9, 8, 10, 10, 8, 6];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const headers = [
    '机台', '产品货号', '模号名称', '颜色', '色粉编号', '料型',
    '啤重G', '用料KG', '水口百分比%', '比率%', '累计数', '需啤数', '欠数',
    '下单单号', '单号', '24H目标数', '11H目标数', '天数',
    '备注', '机械手', '夹具', '转膜时间', '调机人员', '分类', '吨位',
  ];

  // Row 1: 标题
  ws.mergeCells('A1:Y1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${wsName}注塑部每日排单表`;
  titleCell.font = { size: 22, bold: true, name: '宋体' };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 42;

  // Row 2: 班次 + 日期
  ws.mergeCells('A2:C2');
  ws.getCell('A2').value = formatShift(schedule.shift);
  ws.getCell('A2').font = { size: 16, bold: true, name: '宋体' };
  ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
  ws.mergeCells('D2:H2');
  ws.getCell('D2').value = formatDateChinese(schedule.schedule_date);
  ws.getCell('D2').font = { size: 16, bold: true, name: '宋体' };
  ws.getCell('D2').alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(2).height = 30;

  // Row 3: 表头
  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { size: 10, bold: true, name: '宋体' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = fullBorder();
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  });
  headerRow.height = 26;

  // 数据行
  let rowNum = 4;
  const machineGroups = {};
  let prevMachineNo = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = ws.getRow(rowNum);
    const machine = machineMap[item.machine_no] || {};

    if (item.machine_no !== prevMachineNo) {
      if (!machineGroups[item.machine_no]) machineGroups[item.machine_no] = [];
      machineGroups[item.machine_no].push({ start: rowNum, end: rowNum });
    } else {
      const groups = machineGroups[item.machine_no];
      groups[groups.length - 1].end = rowNum;
    }
    prevMachineNo = item.machine_no;

    let armLabel = '';
    if (machine.arm_type) {
      if (machine.arm_type.includes('五轴')) armLabel = '五轴';
      else if (machine.arm_type.includes('三轴')) armLabel = '三轴';
      else armLabel = machine.arm_type;
    }

    const values = [
      item.machine_no, item.product_code || '', item.mold_name || '',
      item.color || '', item.color_powder_no || '', item.material_type || '',
      item.shot_weight || 0, item.material_kg || 0, item.sprue_pct || 0, item.ratio_pct || 0,
      item.accumulated || 0, item.quantity_needed || 0,
      Math.max(0, (item.quantity_needed||0) - (item.accumulated||0)),
      item.order_no || '', item.serial_no || '',
      item.target_24h || 0,
      item.target_24h ? Math.round((item.target_24h)/24*11) : 0,
      item.target_24h ? Math.round(Math.max(0,(item.quantity_needed||0)-(item.accumulated||0))/(item.target_24h)*100)/100 : '',
      item.notes || '', item.robot_arm || '', item.clamp || '',
      item.mold_change_time || '', item.adjuster || '', armLabel, machine.tonnage || '',
    ];

    values.forEach((v, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = v;
      cell.font = { size: 10, name: '宋体' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = fullBorder();
    });

    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.getCell(6).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

    if ((item.accumulated || 0) > 0) {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
    }
    if (item.notes) {
      row.getCell(19).font = { size: 10, bold: true, color: { argb: 'FFFF0000' }, name: '宋体' };
    }

    if (rowNum % 2 === 1) {
      for (let c = 1; c <= 25; c++) {
        const cell = row.getCell(c);
        if (!cell.fill || !cell.fill.fgColor || cell.fill.fgColor.argb === 'FF000000') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
      }
    }
    row.height = 22;
    rowNum++;
  }

  // 汇总行
  const summaryRow = ws.getRow(rowNum);
  ws.mergeCells(`A${rowNum}:F${rowNum}`);
  summaryRow.getCell(1).value = `合计: ${items.length} 条排机记录`;
  summaryRow.getCell(1).font = { size: 10, bold: true, name: '宋体' };
  summaryRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  summaryRow.getCell(1).border = fullBorder();
  for (let c = 7; c <= 25; c++) summaryRow.getCell(c).border = fullBorder();
  summaryRow.height = 22;
  rowNum++;

  // 制表人/审核
  const footerRow = ws.getRow(rowNum);
  ws.mergeCells(`A${rowNum}:E${rowNum}`);
  footerRow.getCell(1).value = '制表人：';
  footerRow.getCell(1).font = { size: 11, name: '宋体' };
  footerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  ws.mergeCells(`L${rowNum}:P${rowNum}`);
  footerRow.getCell(12).value = '审核：';
  footerRow.getCell(12).font = { size: 11, name: '宋体' };
  footerRow.getCell(12).alignment = { horizontal: 'left', vertical: 'middle' };
  footerRow.height = 28;

  // 合并同机台单元格
  for (const machineNo in machineGroups) {
    for (const { start, end } of machineGroups[machineNo]) {
      if (end > start) {
        ws.mergeCells(`A${start}:A${end}`);
        ws.mergeCells(`X${start}:X${end}`);
        ws.mergeCells(`Y${start}:Y${end}`);
      }
      ws.getCell(`A${start}`).font = { size: 11, bold: true, name: '宋体' };
      ws.getCell(`A${start}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`A${start}`).border = fullBorder();
      ws.getCell(`X${start}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`X${start}`).border = fullBorder();
      ws.getCell(`Y${start}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`Y${start}`).border = fullBorder();
    }
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3, activeCell: 'B4' }];
}

function fullBorder() {
  const thin = { style: 'thin', color: { argb: 'FF999999' } };
  return { top: thin, left: thin, bottom: thin, right: thin };
}

module.exports = { exportScheduleExcel };
