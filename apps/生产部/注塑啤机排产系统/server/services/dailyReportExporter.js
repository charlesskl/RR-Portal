const ExcelJS = require('exceljs');
const db = require('../db/connection');

// 列宽（参考样表 5 月 5 日 sheet）
const COL_WIDTHS = [
  4.8, 6.5, 6.2, 10.2, 29.9, 6.2, 5, 5, 5.5, 5.7,
  5.7, 5.6, 5.9, 5.3, 5.3, 5.5, 5.5, 6.6, 3.2, 4.9,
  6.2, 6.2, 5.6, 5.7, 4.9, 5.2, 6.6, 6.7, 4.2, 15,
];

// 表头（30 列，跟样表一致）
const HEADERS = [
  '机号', '机安数', '啤工姓名', '货号', '产品名称',
  '需啤数量', '颜色', '用料', '报价目标数（24H）', '计划目标数（12H)',
  '计划目标数（11H)', '工价', '实际啤货时间目标数', '实际啤数', '合格数量',
  '超欠目标数(+为超-为欠)', '核价工价', '产值', '应啤时间', '实际啤货时间',
  '啤货工资', '计时工资(按9.89元/h)', '白天正班工资', ' 加班工资(12小时外)', '鼓励奖',
  '夜宵费', '加班工资', '合计工资', '停机原因及时间', '啤办',
];

// 从机台型号提取吨位简写：博创150T → 14A，博创260T → 26A 等
function machineTypeShort(machineNo) {
  const m = db.prepare('SELECT tonnage FROM machines WHERE machine_no = ?').get(machineNo);
  if (!m || !m.tonnage) return '';
  const t = Math.floor(m.tonnage / 10);
  return `${t}A`;
}

// 把一份排单的 items 写到 sheet（从指定行开始），返回写入后的下一行号
function writeShiftBlock(sheet, schedule, items, startRow) {
  const dateObj = new Date(schedule.schedule_date);
  const weekDays = ['日','一','二','三','四','五','六'];
  const wd = weekDays[dateObj.getDay()];
  const titleStr = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日星期${wd}`;

  // 标题行
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = titleStr;
  sheet.mergeCells(startRow, 1, startRow, 2);
  titleRow.getCell(3).value = 'B车间';
  titleRow.getCell(4).value = `班别：${schedule.shift === '夜班' ? '夜' : '白'}`;
  titleRow.getCell(5).value = schedule.notes ? '' : ''; // 主管姓名留空（paiji 没存）
  titleRow.font = { bold: true, size: 12 };

  // 表头行
  const headerRow = sheet.getRow(startRow + 1);
  HEADERS.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.font = { bold: true, size: 10 };
    c.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
  });
  headerRow.height = 36;

  // 数据行（按 sort_order）
  let row = startRow + 2;
  items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  for (const it of items) {
    const r = sheet.getRow(row);
    const accumulated = it.accumulated || 0;
    const qualified  = accumulated; // 合格数等于实际啤数（paiji 没单独字段）
    const target24h  = it.target_24h || 0;
    const target12h  = target24h ? Math.round(target24h / 2) : 0;
    const target11h  = it.target_11h || (target24h ? Math.round(target24h / 24 * 11) : 0);
    const overUnder  = accumulated - target11h; // 超欠 = 实际 - 11H 目标
    // 货号/模号分离：mold_name 是 "MOLD-CODE 中文名" 拼接
    const moldName   = it.mold_name || '';

    r.getCell(1).value  = it.machine_no || '';
    r.getCell(2).value  = machineTypeShort(it.machine_no);
    r.getCell(3).value  = it.worker_name || '';
    r.getCell(4).value  = it.product_code || '';
    r.getCell(5).value  = moldName;
    r.getCell(6).value  = it.quantity_needed || 0;
    r.getCell(7).value  = it.color || '';
    r.getCell(8).value  = it.material_type || '';
    r.getCell(9).value  = target24h || '';
    r.getCell(10).value = target12h || '';
    r.getCell(11).value = target11h || '';
    r.getCell(12).value = it.piece_rate ?? '';             // L 工价
    r.getCell(13).value = target11h || '';                 // M 实际啤货时间目标数（同 11H）
    r.getCell(14).value = accumulated;
    r.getCell(15).value = qualified;
    r.getCell(16).value = overUnder;
    r.getCell(17).value = it.approved_piece_rate ?? '';    // Q 核价工价
    r.getCell(18).value = it.output_value ?? '';           // R 产值
    r.getCell(19).value = 12;                              // S 应啤时间
    r.getCell(20).value = it.actual_hours ?? '';           // T 实际啤货时间
    r.getCell(21).value = it.piece_wage ?? '';             // U 啤货工资
    r.getCell(22).value = it.hour_wage ?? '';              // V 计时工资
    r.getCell(23).value = it.day_regular_wage ?? '';       // W 白天正班工资
    r.getCell(24).value = it.ot_wage_12h ?? '';            // X 加班工资(12h外)
    r.getCell(25).value = it.encouragement ?? '';          // Y 鼓励奖
    r.getCell(26).value = it.supper_fee ?? '';             // Z 夜宵费
    r.getCell(27).value = it.overtime_wage ?? '';          // AA 加班工资
    r.getCell(28).value = it.total_wage ?? '';             // AB 合计工资
    r.getCell(29).value = it.downtime_reason || '';        // AC 停机原因
    r.getCell(30).value = it.pi_ban || '';                 // AD 啤办

    // 全行边框 + 居中
    for (let i = 1; i <= 30; i++) {
      const c = r.getCell(i);
      c.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.font = { size: 10 };
    }
    row++;
  }
  return row;
}

/**
 * 生成一天的日报表（同日的白班 + 夜班合并到 1 个 sheet）
 * 找当日的所有排单（按 workshop 过滤），按 shift 顺序：夜班 → 白班
 */
async function buildDailyReport({ date, workshop }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'paiji';
  wb.created = new Date();

  const schedules = db.prepare(`
    SELECT * FROM schedules
    WHERE schedule_date = ? AND workshop = ?
    ORDER BY CASE shift WHEN '夜班' THEN 0 ELSE 1 END, id
  `).all(date, workshop);

  if (schedules.length === 0) throw new Error(`${date} ${workshop} 车间没有排单`);

  const dateObj = new Date(date);
  const sheetName = String(dateObj.getDate());
  const sheet = wb.addWorksheet(sheetName);
  // 列宽
  sheet.columns = COL_WIDTHS.map(w => ({ width: w }));

  let row = 1;
  for (const s of schedules) {
    const items = db.prepare(`
      SELECT * FROM schedule_items WHERE schedule_id = ?
      ORDER BY
        CASE WHEN machine_no IN ('吹气机台', '其他机台') THEN 999999
             ELSE CAST(REPLACE(REPLACE(REPLACE(machine_no, 'A-', ''), 'C-', ''), '#', '') AS INTEGER)
        END,
        machine_no, sort_order, id
    `).all(s.id);
    row = writeShiftBlock(sheet, s, items, row);
    row += 2; // 班次间空 2 行
  }

  return wb;
}

module.exports = { buildDailyReport };
