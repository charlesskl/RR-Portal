import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import { DatePicker, ConfigProvider, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
dayjs.locale('zh-cn');
import { ORDER_COLUMNS } from '../constants/columns';

// Luckysheet 从 window.luckysheet（CDN 加载）获取
const getLuckysheet = () => window.luckysheet;

/**
 * 将订单行数组转成 Luckysheet 的 celldata 格式
 * celldata: [{r, c, v: {v, ct: {t: 's'|'n'}, bg, fc, bl, ...}}]
 */
// 数字类字段（底部汇总行要求和的字段）
const NUMERIC_SUM_FIELDS = new Set([
  'quantity', 'quantity_sum', 'production_count', 'daily_target',
  'unit_price', 'process_value', 'output_value',
]);

// 真正的日期字段（显示成 X月X日 + 单击弹 DatePicker + parseToISO 入库）
// 注意：4 个「复期」字段（胶件/来料/纸箱/包材）已移出 —— 用户要手填"无"/"一"/"5/22出"等文字，
// 不该弹日期选择器、不该被 parseToISO 转换。它们当作普通文本格子。
const DATE_FIELDS = new Set([
  'order_date', 'ship_date', 'start_date', 'complete_date', 'inspection_date',
]);

// 「复期」字段：永远当文本存。用户输入"6/27"被 Luckysheet 自动识别成日期 → 序列号 46197 → 乱码
// 这些列强制 ct={t:'s', fa:'@'} 防止自动转换，序列号也转回 "M月D日" 显示
const DUE_FIELDS = new Set([
  'plastic_due', 'material_due', 'carton_due', 'packaging_due',
]);

// 把 Excel 序列号转回 "M月D日"（不能解析就原样返回）
function normalizeDueText(val) {
  if (val == null || val === '') return '';
  const s = String(val).trim();
  // 纯数字且在 Excel 日期序列号范围 → 转日期文本
  const num = Number(s);
  if (!isNaN(num) && num > 40000 && num < 60000 && /^\d+(\.\d+)?$/.test(s)) {
    const d = new Date((num - 25569) * 86400000);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  }
  return s;
}

// 把 ISO 日期 "2026-05-08" 或 Excel 序列号 46153 格式化成 "5月8日"
function formatDateShort(val) {
  if (val == null || val === '') return '';
  const s = String(val);
  // ISO 格式
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
  // Excel 序列号（40000~60000 之间）
  const num = Number(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = new Date((num - 25569) * 86400000);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  }
  return s;
}

// 用户可能用多种格式输入日期，统一解析成 ISO "YYYY-MM-DD"
// 支持：YYYY-MM-DD、YYYY/MM/DD、X月X日、M/D、M-D、Excel 序列号
// 解析失败返回 null（保留原值不动）
function parseToISO(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  // ISO YYYY-MM-DD 或 YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  // 中文 X月X日（缺省当前年）
  m = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (m) {
    const y = new Date().getFullYear();
    return `${y}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  }
  // M/D 或 M-D（缺省当前年）
  m = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const y = new Date().getFullYear();
    return `${y}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  }
  // M/D/YY 或 M/D/YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  }
  // Excel 序列号
  const num = Number(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = new Date((num - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  return null;
}

function ordersToCelldata(orders, columns, newImportedIds) {
  const celldata = [];
  // 表头行
  columns.forEach((col, c) => {
    celldata.push({
      r: 0, c,
      v: { v: col.title, ct: { t: 's' }, bg: '#FFFFF0', bl: 1, ht: 0, vt: 0, bs: '1', fs: 11 },
    });
  });
  // 数据行
  orders.forEach((order, i) => {
    const r = i + 1;
    const format = order.cell_format ? (() => {
      try { return JSON.parse(order.cell_format); } catch { return {}; }
    })() : {};
    const isNewImport = newImportedIds && newImportedIds.has(order.id);

    // row_color：导入时记录的行颜色（24 小时内有效）
    let showRowColor = false;
    if (order.row_color && order.created_at) {
      const created = new Date(order.created_at + 'Z');
      const hours = (Date.now() - created.getTime()) / 3600000;
      if (hours < 24) showRowColor = true;
    }

    columns.forEach((col, c) => {
      const val = order[col.data];
      const cellFmt = format[col.data] || {};
      const isSumCol = col.data === 'quantity_sum';
      const isDateCol = DATE_FIELDS.has(col.data);
      const isDueCol = DUE_FIELDS.has(col.data);

      let displayVal, valueToStore, ct;
      if (isDateCol) {
        // 重要：日期单元格 ct.t 必须是 'g'（一般类型），不能用 'd'。
        //   - 用 'd' + fa='yyyy-MM-dd' → Luckysheet 把 m 覆盖成 yyyy-MM-dd
        //   - 用 'd' + fa='m"月"d"日"' → Luckysheet 不认这个 Excel 自定义格式串，渲染出乱码
        //   - 用户也无法手输「5月22日」（会被 Luckysheet 强行转换成 5/22）
        // 解法：把单元格当纯文本（t:'g'），用 m 字段显示「5月22日」。
        displayVal = formatDateShort(val);
        valueToStore = displayVal;
        ct = { t: 'g', fa: 'General' };
      } else if (isDueCol) {
        // 复期列：强制文本，避免 Luckysheet 把"6/27"等当日期存成序列号 46197 乱码
        // 也把 DB 里已经被存成序列号的值转回 "M月D日" 显示
        displayVal = normalizeDueText(val);
        valueToStore = displayVal;
        ct = { t: 's', fa: '@' };   // Excel 文本格式：@ 强制文本
      } else {
        displayVal = val == null ? '' : String(val);
        valueToStore = val ?? '';
        ct = { t: col.type === 'numeric' ? 'n' : 's' };
      }

      const cellValue = {
        v: valueToStore,
        m: displayVal,
        ct,
      };

      if (showRowColor) {
        if (order.row_color === 'blue') cellValue.bg = '#E3F2FD';
        else if (order.row_color === 'yellow') cellValue.bg = '#FFF9C4';
      }
      if (isNewImport) cellValue.bg = '#FFFDE7';
      if (isSumCol) { cellValue.bg = '#E6F4FF'; cellValue.bl = 1; }
      if (cellFmt.bg) cellValue.bg = cellFmt.bg;
      if (cellFmt.fc) cellValue.fc = cellFmt.fc;
      if (cellFmt.bl) cellValue.bl = cellFmt.bl;
      if (cellFmt.it) cellValue.it = cellFmt.it;
      if (cellFmt.un) cellValue.un = cellFmt.un;
      if (cellFmt.cl) cellValue.cl = cellFmt.cl;
      if (cellFmt.ff) cellValue.ff = cellFmt.ff;
      if (cellFmt.ht != null) cellValue.ht = cellFmt.ht;
      if (cellFmt.vt != null) cellValue.vt = cellFmt.vt;
      if (cellFmt.fs) cellValue.fs = cellFmt.fs;
      if (cellFmt.tb != null) cellValue.tb = cellFmt.tb;
      if (cellFmt.tr != null) cellValue.tr = cellFmt.tr;
      if (cellFmt.rt != null) cellValue.rt = cellFmt.rt;
      if (cellFmt.ps) cellValue.ps = cellFmt.ps;
      if (cellFmt.qp != null) cellValue.qp = cellFmt.qp;
      if (cellFmt.bs) cellValue.bs = cellFmt.bs;
      // 公式恢复（解决 #5）：extractCellFormat 已经把 cell.f 存进 cell_format，
      // 重建时必须写回，否则刷新后公式丢失
      if (cellFmt.f) cellValue.f = cellFmt.f;
      // 注：天数列的自动公式 =M/AB 在 Luckysheet.create() 之后用 setCellValue 批量套，
      // 不在 celldata 里设 cellValue.f —— 因为 Luckysheet 只对 setCellValue 传入的公式做计算

      if (cellValue.v === '' && Object.keys(cellFmt).length === 0 && !isNewImport && !isSumCol && !showRowColor) {
        return;
      }
      celldata.push({ r, c, v: cellValue });
    });
  });

  // 底部汇总行
  const totalRow = orders.length + 1;
  columns.forEach((col, c) => {
    let cellV;
    if (c === 0) {
      cellV = { v: '合计', ct: { t: 's' }, bg: '#FFE7BA', bl: 1, ht: 0, fs: 11 };
    } else if (NUMERIC_SUM_FIELDS.has(col.data)) {
      const sum = orders.reduce((s, o) => s + (Number(o[col.data]) || 0), 0);
      cellV = { v: sum, m: String(sum), ct: { t: 'n' }, bg: '#FFE7BA', bl: 1, fs: 11 };
    } else {
      cellV = { v: '', ct: { t: 's' }, bg: '#FFE7BA' };
    }
    celldata.push({ r: totalRow, c, v: cellV });
  });

  return celldata;
}

// 从 Luckysheet 单元格对象提取格式
// 这几个 bg 是渲染时自动加的（24h 蓝/黄 高亮、新导入米黄、合计列浅蓝、做工列绿/橙等）
// 不是用户主动设置，不该被保存进 cell_format（否则 24h 后还在、永久污染）
const AUTO_BG_SET = new Set(['#E3F2FD', '#FFF9C4', '#FFFDE7', '#E6F4FF', '#D9F7BE', '#FFE7BA', '#FFE1E1', '#FFEFD6', '#FFF7CC', '#DFF5E1', '#F0F0F0']);

function extractCellFormat(cell) {
  if (!cell) return null;
  const fmt = {};
  if (cell.bg && !AUTO_BG_SET.has(cell.bg)) fmt.bg = cell.bg;
  if (cell.fc) fmt.fc = cell.fc;
  if (cell.bl) fmt.bl = cell.bl;
  if (cell.it) fmt.it = cell.it;
  if (cell.un) fmt.un = cell.un;
  if (cell.cl) fmt.cl = cell.cl;
  if (cell.ff) fmt.ff = cell.ff;
  if (cell.fs) fmt.fs = cell.fs;
  if (cell.ht != null) fmt.ht = cell.ht;
  if (cell.vt != null) fmt.vt = cell.vt;
  if (cell.tb != null) fmt.tb = cell.tb;
  if (cell.tr != null) fmt.tr = cell.tr;
  if (cell.rt != null) fmt.rt = cell.rt;
  // 合并单元格由 sheet-settings.merge 统一持久化，不重复写入每个订单的 cell_format。
  // cell.ct（基本类型 s/n/g）渲染时自动赋值，不是用户意图，存了反而让 payload 巨大
  // 自定义格式（如 fa='m"月"d"日"' 之类）我们也不靠 cell_format 存
  if (cell.f) fmt.f = cell.f;
  if (cell.ps) fmt.ps = cell.ps;
  if (cell.qp != null) fmt.qp = cell.qp;
  return Object.keys(fmt).length > 0 ? fmt : null;
}

function getCellFormula(cell) {
  if (!cell || typeof cell !== 'object') return null;
  if (typeof cell.f === 'string' && cell.f.trim().startsWith('=')) return cell.f.trim();
  for (const key of ['v', 'm']) {
    const val = cell[key];
    if (typeof val === 'string' && val.trim().startsWith('=')) return val.trim();
  }
  return null;
}

function getFormulaComputedValue(cell) {
  if (!cell || typeof cell !== 'object') return undefined;
  for (const key of ['v', 'm']) {
    const val = cell[key];
    if (val == null || val === '') continue;
    if (typeof val === 'string' && val.trim().startsWith('=')) continue;
    return val;
  }
  return undefined;
}

function writeFieldValue(fields, colData, col, value) {
  if (value === undefined) return false;
  if (DATE_FIELDS.has(colData)) {
    const iso = parseToISO(value);
    if (!iso && value != null && value !== '') return false;
    fields[colData] = iso;
    return true;
  }
  if (DUE_FIELDS.has(colData)) {
    fields[colData] = value == null || value === '' ? null : normalizeDueText(value);
    return true;
  }
  if (col?.type === 'numeric' || NUMERIC_SUM_FIELDS.has(colData)) {
    if (value == null || value === '') { fields[colData] = null; return true; }
    const n = Number(value);
    if (Number.isNaN(n)) return false;
    fields[colData] = n;
    return true;
  }
  fields[colData] = value == null || value === '' ? null : value;
  return true;
}

function LuckysheetEditor({
  data,
  onRefreshData,
  workshop,
  height = 600,
  containerId = 'luckysheet-container',
  newImportedIds,
  refreshKey = 0,
}, ref) {
  const rowMapRef = useRef([]);
  const initializedRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [sheetSettings, setSheetSettings] = useState(null);
  const settingsLoadedRef = useRef(false);
  const loadedIdsRef = useRef('');
  const [datePicker, setDatePicker] = useState(null); // {x, y, orderId, field, value}

  // 实时记录用户在 Luckysheet 里改动的 cell（值/格式），保存时直接读这个，
  // 不再在保存时去读 Luckysheet 内部 data（避免 flush 时序问题）
  // 结构: { [orderId]: { fields: { col_data_key: 新值 }, fmt: { col_data_key: 格式对象 } } }
  const pendingChangesRef = useRef({});
  // 初始化期间禁止钩子（避免 luckysheet.create() 加载数据时误记一堆变化）
  const suppressHookRef = useRef(true);
  const layoutSaveTimerRef = useRef(null);
  const lastLayoutJsonRef = useRef('');

  // 加载表格布局配置
  useEffect(() => {
    if (!workshop) return;
    axios.get('/api/orders/sheet-settings', { params: { workshop } })
      .then(res => {
        const settings = res.data || {};
        setSheetSettings(settings);
        lastLayoutJsonRef.current = JSON.stringify(settings);
        settingsLoadedRef.current = true;
      })
      .catch(() => { setSheetSettings({}); settingsLoadedRef.current = true; });
  }, [workshop]);

  const buildSheetSettings = (sheet) => {
    const cfg = (sheet && sheet.config) || {};
    return {
      columnlen: cfg.columnlen || {},
      rowlen: cfg.rowlen || {},
      frozen: (sheet && sheet.frozen) || null,
      merge: cfg.merge || {},
      borderInfo: cfg.borderInfo || [],
      rowhidden: cfg.rowhidden || {},
      colhidden: cfg.colhidden || {},
    };
  };

  const readCurrentSheetSettings = () => {
    const ls = getLuckysheet();
    if (!ls || !ls.getAllSheets) return null;
    const sheets = ls.getAllSheets();
    const sheet = sheets && sheets[0];
    if (!sheet) return null;
    return buildSheetSettings(sheet);
  };

  const saveSheetLayoutSilently = async () => {
    if (!workshop || !initializedRef.current) return;
    const settings = readCurrentSheetSettings();
    if (!settings) return;
    const json = JSON.stringify(settings);
    if (json === lastLayoutJsonRef.current) return;
    lastLayoutJsonRef.current = json;
    try {
      await axios.put('/api/orders/sheet-settings', { workshop, settings });
      console.log('[layout] 已自动保存列宽/行高');
    } catch (e) {
      console.warn('[layout] 自动保存失败:', e?.message);
    }
  };

  // 判断是否为蓝色字体：R<100, G<150, B>150
  const isBlueFont = (fc) => {
    if (!fc) return false;
    const hex = fc.replace(/^#/, '').toUpperCase();
    if (hex.length !== 6) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return r < 100 && g < 150 && b > 150;
  };

  // 钩子调用：用户改了 (r,c) 这个格子（值或格式），实时记到 pendingChangesRef
  // 整体 try/catch 包住 —— 任何 Luckysheet 异常都不能炸到 console
  const recordCellChange = (r, c) => {
    try {
      if (suppressHookRef.current) { console.log('[钩子] (r,c)=(' + r + ',' + c + ') 被 suppress 跳过'); return; }
      if (r == null || r === 0) { console.log('[钩子] (r,c)=(' + r + ',' + c + ') 表头跳过'); return; }       // 跳过表头
      const orderId = rowMapRef.current[r - 1];
      if (!orderId) { console.log('[钩子] (r,c)=(' + r + ',' + c + ') 找不到 orderId'); return; }
      const colData = ORDER_COLUMNS[c]?.data;
      if (!colData || colData === 'quantity_sum') { console.log('[钩子] (r,c)=(' + r + ',' + c + ') 列', colData, '跳过'); return; }
      // days 列由 quantity/daily_target 改动时显式 push，不经钩子（避免 Luckysheet 异步 cellUpdated 把自动算的天数批量入 pending）
      if (colData === 'days') { console.log('[钩子] (r,c)=(' + r + ',' + c + ') days 列跳过（由按需 handler 处理）'); return; }
      const ls = getLuckysheet();
      if (!ls || !ls.getAllSheets) { console.log('[钩子] (r,c)=(' + r + ',' + c + ') ls 不可用'); return; }
      let cell;
      try {
        const sheets = ls.getAllSheets();
        const sheet = sheets && sheets[0];
        cell = sheet?.data?.[r]?.[c];
      } catch { return; }
      if (!pendingChangesRef.current[orderId]) pendingChangesRef.current[orderId] = { fields: {}, fmt: {} };
      const entry = pendingChangesRef.current[orderId];
      const cellObj = cell && typeof cell === 'object' ? cell : { v: cell };
      const formula = getCellFormula(cellObj);
      let v = cellObj.v ?? null;
      if (v === '') v = null;

      if (formula) {
        const result = getFormulaComputedValue(cellObj);
        writeFieldValue(entry.fields, colData, ORDER_COLUMNS[c], result);
        entry.fmt[colData] = { ...(extractCellFormat(cellObj) || {}), f: formula };
        console.log('[钩子] 公式单元格 orderId=' + orderId + ' col=' + colData + ' formula=' + formula + ' result=', result);
      } else if (DATE_FIELDS.has(colData)) {
        if (v == null) entry.fields[colData] = null;
        else {
          const iso = parseToISO(v);
          if (iso) entry.fields[colData] = iso;
        }
      } else if (DUE_FIELDS.has(colData)) {
        // 复期列：把 Luckysheet 误转成序列号的值转回"M月D日"文本再存
        entry.fields[colData] = v == null ? null : normalizeDueText(v);
        // 同时把单元格显示也修正（避免视觉上还是 46197）
        try {
          const text = entry.fields[colData] || '';
          if (cell && cell.v !== text) {
            ls.setCellValue(r, c, { v: text, m: text, ct: { t: 's', fa: '@' } });
          }
        } catch {}
      } else {
        entry.fields[colData] = v;
      }
      if (!formula) {
        const fmt = extractCellFormat(cellObj);
        if (fmt) entry.fmt[colData] = fmt;
        else entry.fmt[colData] = null;
        console.log('[钩子] (r,c)=(' + r + ',' + c + ') orderId=' + orderId + ' col=' + colData + ' v=', v, 'fmt=', fmt);
      }

      // 用户改了 数量 或 每天目标 → 直接 JS 算天数写回（不靠 Luckysheet 的公式引擎，不稳）
      if (colData === 'quantity' || colData === 'daily_target') {
        setTimeout(() => {
          try {
            const daysColIdx = ORDER_COLUMNS.findIndex(col => col.data === 'days');
            const qtyColIdx = ORDER_COLUMNS.findIndex(col => col.data === 'quantity');
            const targetColIdx = ORDER_COLUMNS.findIndex(col => col.data === 'daily_target');
            const ls2 = getLuckysheet();
            if (!ls2?.setCellValue || daysColIdx < 0) return;
            const sheet2 = ls2.getAllSheets()[0];
            const M = sheet2.data[r]?.[qtyColIdx]?.v;
            const AB = sheet2.data[r]?.[targetColIdx]?.v;
            const Mn = Number(M), ABn = Number(AB);
            let days = '';
            if (!isNaN(Mn) && !isNaN(ABn) && ABn !== 0 && M !== '' && M != null && AB !== '' && AB != null) {
              days = Math.round((Mn / ABn) * 10000) / 10000;
            }
            // 关键：必须同时设 v 和 m —— Luckysheet 渲染读 m，不读 v
            // 暂时 suppress 钩子，避免 days 被记成"用户改了" → 保存条数虚高
            suppressHookRef.current = true;
            ls2.setCellValue(r, daysColIdx, { v: days === '' ? '' : days, m: days === '' ? '' : String(days), ct: { t: 'n' } });
            // 还得自己把 days 入 pending（不然 DB 不会更新这条）
            if (!pendingChangesRef.current[orderId]) pendingChangesRef.current[orderId] = { fields: {}, fmt: {} };
            pendingChangesRef.current[orderId].fields.days = days === '' ? null : days;
            // 100ms 后解锁，盖过 setCellValue 触发的 cellUpdated 异步触发
            setTimeout(() => { suppressHookRef.current = false; }, 100);
          } catch {}
        }, 50);
      }
    } catch (e) {
      console.warn('[recordCellChange] 忽略 Luckysheet 内部异常:', e?.message);
    }
  };

  // 手动保存：用户点「保存」按钮才触发。一次过把整张表的:
  //   - 单元格值（与 DB 不一致的字段）
  //   - 单元格格式（cell_format JSON）
  //   - 蓝色字体 → 自动转完成
  //   - DatePicker 选的日期（通过 _pendingFields 暂存）
  // 写到 batch-update；列宽/行高/冻结/合并/边框写到 sheet-settings。
  // 没有任何 polling/auto-save，避免 nginx 限流 + toast 风暴。
  const saveAll = async () => {
    if (!initializedRef.current) {
      message.warning('表格未初始化');
      return { saved: 0 };
    }
    const ls = getLuckysheet();
    if (!ls || !ls.getAllSheets) {
      message.error('Luckysheet 未加载');
      return null;
    }
    // 关键：用户可能在编辑某个格子（双击进入编辑态，输了字没按 Enter）就点保存。
    // 这时 Luckysheet 内部 data 还是旧值，钩子也没触发。需要强制 commit：
    //   1) 检测编辑态：#luckysheet-input-box 可见即编辑中
    //   2) 调 ls.exitEditMode() 让 Luckysheet 提交（注意：只在确实编辑中时调，
    //      不在编辑态调会触发 'Cannot read properties of undefined config' 错误）
    //   3) 兼容性 fallback: 派 Enter keydown + blur active element
    try {
      const editBox = document.querySelector('#luckysheet-input-box');
      const editing = editBox && editBox.style.display && editBox.style.display !== 'none';
      if (editing) {
        // 抓编辑框里的当前文本（用户输了但没按 Enter 的）
        const inner = editBox.querySelector('#luckysheet-rich-text-editor') ||
                      editBox.querySelector('.luckysheet-input-box-inner') ||
                      editBox;
        const text = (inner.innerText || inner.textContent || '').trim();
        const range = ls.getRange && ls.getRange();
        console.log('[saveAll] 检测到编辑态，文本="' + text + '" range=', JSON.stringify(range));
        if (range && range[0] && text !== '') {
          const r = range[0].row[0];
          const c = range[0].column[0];
          // 强制 commit：用 setCellValue 把编辑中的文本写回 cell，钩子会触发
          try {
            if (text.trim().startsWith('=')) {
              ls.setCellValue(r, c, { f: text.trim(), v: '', m: '', ct: { t: 'n' } });
            } else {
              ls.setCellValue(r, c, text);
            }
            console.log('[saveAll] 强制 commit setCellValue(' + r + ',' + c + ',"' + text + '")');
          } catch (e) { console.warn('[saveAll] commit 失败:', e?.message); }
        }
        // 同时调 exitEditMode 退出编辑 UI（在编辑态调是安全的）
        try { ls.exitEditMode && ls.exitEditMode(); } catch {}
        // 派 Enter 给 active element 兜底
        const ae = document.activeElement;
        if (ae && ae !== document.body) {
          ae.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          ae.blur && ae.blur();
        }
      } else {
        if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
          document.activeElement.blur();
        }
      }
    } catch (e) { console.warn('[saveAll] commit 阶段异常:', e?.message); }
    // 等 300ms 让 commit + 钩子触发完成
    await new Promise(resolve => setTimeout(resolve, 300));

    const updates = [];
    let rowsCompleted = 0;
    const pending = pendingChangesRef.current;
    let hookHits = 0;

    // 1. 处理钩子记录的变化（值 + 格式）
    // 用 Map 合并：钩子记录 + 兜底扫描 都进同一个 orderId 桶
    const updateMap = new Map();   // orderId → { fields, fmt }
    const getBucket = (orderId) => {
      if (!updateMap.has(orderId)) updateMap.set(orderId, { fields: {}, fmt: {} });
      return updateMap.get(orderId);
    };

    // 1. 主路径：钩子记录的变化
    for (const orderIdStr of Object.keys(pending)) {
      const orderId = Number(orderIdStr);
      const entry = pending[orderIdStr];
      const b = getBucket(orderId);
      Object.assign(b.fields, entry.fields);
      Object.assign(b.fmt, entry.fmt);
      hookHits++;
    }

    // 2. 取 sheet 用于读列宽/行高（不再做兜底扫描 —— 浏览器实测发现扫描产生 1000+ 幻影变化，
    //    根因：number/string 类型差异 + 24h 蓝色高亮 bg 被误判成用户格式）
    //    钩子已经够用了。万一用户某个操作钩子真没触发，那就单元格变化没保存 —— 报上来再针对修。
    let sheets;
    try { sheets = ls.getAllSheets(); } catch { sheets = []; }
    const sheet = sheets && sheets[0];

    // Formula fallback: Luckysheet may not fire cellUpdated when the user saves
    // while still editing a formula. Scan visible sheet data and persist formulas
    // into cell_format, together with the current calculated value.
    try {
      const sheetData = (sheet && sheet.data) || [];
      for (let rowIdx = 1; rowIdx < sheetData.length; rowIdx++) {
        const orderId = rowMapRef.current[rowIdx - 1];
        if (!orderId) continue;
        const row = sheetData[rowIdx] || [];
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cell = row[colIdx];
          const col = ORDER_COLUMNS[colIdx];
          const colData = col && col.data;
          if (!cell || !colData || colData === 'quantity_sum') continue;

          const cellObj = typeof cell === 'object' ? cell : { v: cell };
          const formula = cellObj.f
            || (typeof cellObj.v === 'string' && cellObj.v.trim().startsWith('=') ? cellObj.v.trim() : null)
            || (typeof cellObj.m === 'string' && cellObj.m.trim().startsWith('=') ? cellObj.m.trim() : null);
          if (!formula) continue;

          const bucket = getBucket(orderId);
          const result = getFormulaComputedValue(cellObj);
          writeFieldValue(bucket.fields, colData, col, result);
          bucket.fmt[colData] = { ...(bucket.fmt[colData] || {}), ...(extractCellFormat(cellObj) || {}), f: formula };
        }
      }
    } catch (e) {
      console.warn('[saveAll] formula scan failed:', e?.message);
    }

    // 3. 把 updateMap 转成 updates，处理格式合并 + 蓝字检测 + DatePicker
    for (const [orderId, b] of updateMap.entries()) {
      const order = dataRef.current.find(o => o.id === orderId);
      if (!order) continue;
      const fields = { ...b.fields };
      // 合并 cell_format —— 顺带清理 DB 里早期遗留的污染（自动 bg / 默认 ct）
      if (Object.keys(b.fmt).length > 0) {
        let existing = {};
        try { if (order.cell_format) existing = JSON.parse(order.cell_format); } catch {}
        // 清理老污染
        const cleaned = {};
        for (const [col, f] of Object.entries(existing)) {
          if (!f || typeof f !== 'object') continue;
          const c = { ...f };
          if (c.bg && AUTO_BG_SET.has(c.bg)) delete c.bg;
          delete c.ct;   // ct 是渲染时自动赋值，不该入 cell_format
          if (Object.keys(c).length > 0) cleaned[col] = c;
        }
        const merged = { ...cleaned };
        for (const [col, f] of Object.entries(b.fmt)) {
          if (f == null) delete merged[col];
          else merged[col] = f;
        }
        // 也把新进的 fmt 清掉 ct（防止万一）
        for (const col of Object.keys(merged)) {
          if (merged[col] && merged[col].ct) {
            merged[col] = { ...merged[col] };
            delete merged[col].ct;
          }
        }
        const newFmtStr = Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
        if (newFmtStr !== (order.cell_format || null)) fields.cell_format = newFmtStr;
      }
      // 蓝字 → 完成
      if (order.status === 'active') {
        for (const f of Object.values(b.fmt)) {
          if (f && isBlueFont(f.fc)) { fields.status = 'completed'; rowsCompleted++; break; }
        }
      }
      // DatePicker
      if (order._pendingFields) {
        Object.assign(fields, order._pendingFields);
        delete order._pendingFields;
      }
      if (Object.keys(fields).length > 0) updates.push({ id: orderId, fields });
    }

    // 4. DatePicker 改了但既不在 pending 也不在 scan 命中的订单（纯日期改动）
    for (const order of dataRef.current) {
      if (!order._pendingFields) continue;
      if (updateMap.has(order.id)) continue;
      const fields = { ...order._pendingFields };
      delete order._pendingFields;
      if (Object.keys(fields).length > 0) updates.push({ id: order.id, fields });
    }

    // 5. 列宽/行高/冻结/合并/边框（不是 cell 级变化）
    const settings = buildSheetSettings(sheet);

    // 诊断：把要发送的 payload 完整打出来
    console.log('[saveAll] 待发送 updates =', updates.length, 'sheet-settings 字段数 =',
      Object.keys(settings.columnlen).length + '列宽');
    if (updates.length > 0) {
      console.log('[saveAll] batch-update payload 前 3 条:', JSON.stringify(updates.slice(0, 3), null, 2));
    }

    try {
      const calls = [axios.put('/api/orders/sheet-settings', { workshop, settings })];
      if (updates.length > 0) {
        calls.push(axios.post('/api/orders/batch-update', { updates }));
      }
      const results = await Promise.all(calls);
      lastLayoutJsonRef.current = JSON.stringify(settings);
      console.log('[saveAll] 后端返回:', results.map(r => r?.data));
      // 更新 dataRef，下次保存比较时不会重复 push
      for (const u of updates) {
        const o = dataRef.current.find(x => x.id === u.id);
        if (o) Object.assign(o, u.fields);
      }
      // 清空 pending（已经入库了，下一轮重新记）
      pendingChangesRef.current = {};

      console.log('[saveAll-钩子版]',
        '钩子命中 =', hookHits,
        '| 实际入库订单数 =', updates.length,
        '| 自动转完成 =', rowsCompleted,
        '| 样例:', updates.slice(0, 3));

      if (updates.length === 0) {
        message.info('无单元格改动；列宽/行高等布局已保存', 3);
      } else {
        message.success(`已保存 ${updates.length} 条订单${rowsCompleted > 0 ? '，其中 ' + rowsCompleted + ' 条转完成' : ''}`);
      }
      if (rowsCompleted > 0 && onRefreshData) onRefreshData();
      return { saved: updates.length };
    } catch (e) {
      console.error('[saveAll] 失败:', e, e.response?.data);
      message.error('保存失败：' + (e.response?.data?.message || e.message));
      return null;
    }
  };

  const hasPendingChanges = () => {
    const editBox = document.querySelector('#luckysheet-input-box');
    const editing = editBox && editBox.style.display && editBox.style.display !== 'none';
    return Boolean(editing)
      || Object.keys(pendingChangesRef.current).length > 0
      || dataRef.current.some(order => order && order._pendingFields && Object.keys(order._pendingFields).length > 0);
  };

  // 暴露保存与脏状态给父组件，避免筛选或外部刷新静默丢失编辑
  useImperativeHandle(ref, () => ({ saveAll, hasPendingChanges }), [workshop, data]);

  useEffect(() => {
    // 等待 sheetSettings 加载完成后才初始化
    if (!settingsLoadedRef.current) return;
    const luckysheet = getLuckysheet();
    if (!luckysheet) {
      console.error('Luckysheet 未加载，请检查 CDN 链接');
      return;
    }

    // 构建行号→订单id的映射
    rowMapRef.current = data.map(o => o.id);
    loadedIdsRef.current = data.map(o => o.id).join(',') + '|' + refreshKey;

    const celldata = ordersToCelldata(data, ORDER_COLUMNS, newImportedIds);
    const defaultColWidths = {};
    ORDER_COLUMNS.forEach((c, i) => { defaultColWidths[i] = c.width || 80; });
    // 保存的设置优先
    const savedColWidths = (sheetSettings && sheetSettings.columnlen) || {};
    const colWidths = { ...defaultColWidths, ...savedColWidths };
    const rowLen = (sheetSettings && sheetSettings.rowlen) || {};
    const savedFrozen = sheetSettings && sheetSettings.frozen;

    const sheetConfig = {
      name: '生产计划',
      celldata,
      row: Math.max(data.length + 1, 50),
      column: ORDER_COLUMNS.length,
      config: {
        columnlen: colWidths,
        rowlen: rowLen,
        merge: (sheetSettings && sheetSettings.merge) || {},
        borderInfo: (sheetSettings && sheetSettings.borderInfo) || [],
        rowhidden: (sheetSettings && sheetSettings.rowhidden) || {},
        colhidden: (sheetSettings && sheetSettings.colhidden) || {},
      },
      ...(savedFrozen ? { frozen: savedFrozen } : {}),
    };

    luckysheet.create({
      container: containerId,
      title: '生产计划',
      lang: 'zh',
      allowCopy: true,
      allowEdit: true,
      allowUpdate: true,
      showtoolbar: true,
      showinfobar: false,
      showsheetbar: false,
      showstatisticBar: true,
      sheetFormulaBar: true,
      enableAddRow: false,
      enableAddBackTop: false,
      showConfigWindowResize: false,
      enableShortcutKey: true,
      data: [sheetConfig],
      // 钩子：
      //   - cellEditBefore：日期字段弹 DatePicker
      //   - cellUpdated / rangeUpdated / updated：实时记录变化到 pendingChangesRef
      //     这样保存时不用再去读 Luckysheet 内部 data（避免 flush 时序问题）
      hook: {
        cellUpdated: function(r, c) { console.log('[Luckysheet] cellUpdated 触发 (r,c)=(' + r + ',' + c + ')'); recordCellChange(r, c); },
        rangeUpdated: function(operate) {
          console.log('[Luckysheet] rangeUpdated 触发, operate=', operate);
          if (!operate || !operate.range) return;
          for (const range of operate.range) {
            if (!range.row || !range.column) continue;
            for (let r = range.row[0]; r <= range.row[1]; r++) {
              for (let c = range.column[0]; c <= range.column[1]; c++) {
                recordCellChange(r, c);
              }
            }
          }
        },
        updated: function(operate) {
          console.log('[Luckysheet] updated 触发, operate=', operate);
          if (!operate) return;
          const ranges = operate.range || (Array.isArray(operate) ? operate : null);
          if (!ranges) return;
          for (const range of ranges) {
            if (!range || !range.row || !range.column) continue;
            for (let r = range.row[0]; r <= range.row[1]; r++) {
              for (let c = range.column[0]; c <= range.column[1]; c++) {
                recordCellChange(r, c);
              }
            }
          }
        },
        cellEditBefore: function(range) {
          if (!range || !range[0]) return;
          const r = range[0].row?.[0];
          const c = range[0].column?.[0];
          if (r == null || r === 0 || c == null) return;
          const field = ORDER_COLUMNS[c]?.data;
          if (!field || !DATE_FIELDS.has(field)) return;
          const orderId = rowMapRef.current[r - 1];
          if (!orderId) return;
          const order = dataRef.current.find(o => o.id === orderId);
          // 不调 ls.exitEditMode()：它在没编辑态时会抛 "Cannot read properties of undefined (reading 'config')"。
          // 我们 return false 已经够阻止 Luckysheet 进入编辑态了。
          setTimeout(() => {
            const selBox = document.querySelector('#luckysheet-cell-selected') || document.querySelector('.luckysheet-cs-selection-box');
            const cellRect = selBox?.getBoundingClientRect();
            setDatePicker({
              x: cellRect ? cellRect.left : 300,
              y: cellRect ? cellRect.bottom + 2 : 300,
              orderId, field, value: order?.[field],
            });
          }, 50);
          return false;
        },
      },
    });

    initializedRef.current = true;

    applySavedFormulasBatch();
    applyDaysFormulaBatch();

    const handleLayoutMouseUp = () => {
      if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = setTimeout(() => { saveSheetLayoutSilently(); }, 700);
    };
    document.addEventListener('mouseup', handleLayoutMouseUp, true);

    // Luckysheet 的键盘 Delete 在某些版本不生效 —— 自己监听，调 clearRange API
    // 注意：Luckysheet 选中格子时，焦点在隐藏 input 上（用于捕获键盘事件），所以不能光看 tagName
    // 判断"真的在编辑"的标准是：Luckysheet 的编辑输入框 #luckysheet-input-box 可见
    const handleKeyDelete = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target;
      const targetInfo = `tag=${target?.tagName} id=${target?.id} class=${typeof target?.className === 'string' ? target.className.slice(0,40) : ''}`;
      console.log('[KeyDelete] 触发 key=' + e.key + ' ' + targetInfo);
      // 用户正在编辑某格（编辑输入框 display: block）→ Delete 是删字符，不拦截
      const editBox = document.querySelector('#luckysheet-input-box');
      const editing = editBox && editBox.style.display && editBox.style.display !== 'none';
      if (editing) { console.log('[KeyDelete] 编辑态中，跳过'); return; }
      // 顶部搜索框等真正的输入框 → 不拦截
      if ((target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') &&
          target?.id !== '' && !target?.id?.startsWith('luckysheet')) {
        console.log('[KeyDelete] 真输入框，跳过');
        return;
      }
      const ls = getLuckysheet();
      if (!ls || !ls.clearRange || !ls.getRange) { console.log('[KeyDelete] ls 不可用'); return; }
      const range = ls.getRange();
      console.log('[KeyDelete] 当前选中:', JSON.stringify(range));
      if (!range || !range[0]) { console.log('[KeyDelete] 无选中范围'); return; }
      try {
        ls.clearRange();
        e.preventDefault();
        console.log('[KeyDelete] clearRange 调用成功');
      } catch (err) {
        console.warn('[KeyDelete] clearRange 失败:', err?.message);
      }
    };
    document.addEventListener('keydown', handleKeyDelete, true);

    return () => {
      initializedRef.current = false;
      suppressHookRef.current = true;
      pendingChangesRef.current = {};
      if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
      document.removeEventListener('mouseup', handleLayoutMouseUp, true);
      document.removeEventListener('keydown', handleKeyDelete, true);
      const ls = getLuckysheet();
      if (ls && ls.destroy) {
        try { ls.destroy(); } catch {}
      }
    };
  }, [containerId, sheetSettings, refreshKey]);

  // 数据变化时刷新（仅当订单集合/顺序变化时才重建，避免用户编辑被覆盖）
  useEffect(() => {
    if (!initializedRef.current) return;
    const luckysheet = getLuckysheet();
    if (!luckysheet) return;

    const newIds = data.map(o => o.id).join(',') + '|' + refreshKey;
    if (newIds === loadedIdsRef.current) {
      // 订单集合没变，不重建，避免覆盖用户编辑
      return;
    }
    loadedIdsRef.current = newIds;
    rowMapRef.current = data.map(o => o.id);
    const celldata = ordersToCelldata(data, ORDER_COLUMNS, newImportedIds);

    try {
      const defaultColWidths = {};
      ORDER_COLUMNS.forEach((c, i) => { defaultColWidths[i] = c.width || 80; });
      const savedColWidths = (sheetSettings && sheetSettings.columnlen) || {};
      const colWidths = { ...defaultColWidths, ...savedColWidths };
      const rowLen = (sheetSettings && sheetSettings.rowlen) || {};
      const savedFrozen = sheetSettings && sheetSettings.frozen;
      luckysheet.destroy && luckysheet.destroy();
      luckysheet.create({
        container: containerId,
        title: '生产计划',
        lang: 'zh',
        allowCopy: true,
        showtoolbar: true,
        showinfobar: false,
        showsheetbar: false,
        showstatisticBar: true,
        sheetFormulaBar: true,
        enableAddRow: false,
        enableAddBackTop: false,
        showConfigWindowResize: false,
        data: [{
          name: '生产计划',
          celldata,
          row: Math.max(data.length + 1, 50),
          column: ORDER_COLUMNS.length,
          config: {
            columnlen: colWidths,
            rowlen: rowLen,
            merge: (sheetSettings && sheetSettings.merge) || {},
            borderInfo: (sheetSettings && sheetSettings.borderInfo) || [],
            rowhidden: (sheetSettings && sheetSettings.rowhidden) || {},
            colhidden: (sheetSettings && sheetSettings.colhidden) || {},
          },
          ...(savedFrozen ? { frozen: savedFrozen } : {}),
        }],
        // 实时记录改动到 pendingChangesRef，由「保存」按钮 saveAll 提交
        hook: {
          cellUpdated: function(r, c) { console.log('[Luckysheet] cellUpdated 触发 (r,c)=(' + r + ',' + c + ')'); recordCellChange(r, c); },
          rangeUpdated: function(operate) {
            if (!operate || !operate.range) return;
            for (const range of operate.range) {
              if (!range.row || !range.column) continue;
              for (let r = range.row[0]; r <= range.row[1]; r++) {
                for (let c = range.column[0]; c <= range.column[1]; c++) {
                  recordCellChange(r, c);
                }
              }
            }
          },
          updated: function(operate) {
            if (!operate) return;
            const ranges = operate.range || (Array.isArray(operate) ? operate : null);
            if (!ranges) return;
            for (const range of ranges) {
              if (!range || !range.row || !range.column) continue;
              for (let r = range.row[0]; r <= range.row[1]; r++) {
                for (let c = range.column[0]; c <= range.column[1]; c++) {
                  recordCellChange(r, c);
                }
              }
            }
          },
        },
      });
      // 重建后清空 pending 并解锁 hook（数据已重新加载，避免误记）
      pendingChangesRef.current = {};
      suppressHookRef.current = true;
      applySavedFormulasBatch();
      applyDaysFormulaBatch();   // 数据重建后也套天数公式
    } catch (e) {
      console.error('Luckysheet 更新失败', e);
    }
  }, [data, newImportedIds, refreshKey]);

  function applySavedFormulasBatch() {
    setTimeout(() => {
      try {
        const ls = getLuckysheet();
        if (!ls?.setCellValue) return;
        suppressHookRef.current = true;
        let applied = 0;
        for (let rowIdx = 0; rowIdx < dataRef.current.length; rowIdx++) {
          const order = dataRef.current[rowIdx];
          if (!order?.cell_format) continue;
          let format = {};
          try { format = JSON.parse(order.cell_format); } catch { format = {}; }
          for (const [field, fmt] of Object.entries(format)) {
            if (!fmt?.f) continue;
            const colIdx = ORDER_COLUMNS.findIndex(col => col.data === field);
            if (colIdx < 0) continue;
            const col = ORDER_COLUMNS[colIdx];
            const raw = order[field];
            const display = raw == null ? '' : String(raw);
            const ct = { t: col.type === 'numeric' || NUMERIC_SUM_FIELDS.has(field) ? 'n' : 'g' };
            ls.setCellValue(rowIdx + 1, colIdx, { v: raw ?? '', m: display, ct, f: fmt.f });
            applied++;
          }
        }
        console.log('[公式恢复] 已恢复 ' + applied + ' 个公式单元格');
      } catch (e) {
        console.warn('[公式恢复] 失败:', e?.message);
      }
    }, 300);
  }

  // 批量算天数（init + 数据重建时调）—— 直接 JS 算然后写回，不用 Luckysheet 的公式引擎
  function applyDaysFormulaBatch() {
    setTimeout(() => {
      try {
        const daysColIdx = ORDER_COLUMNS.findIndex(c => c.data === 'days');
        const qtyColIdx = ORDER_COLUMNS.findIndex(c => c.data === 'quantity');
        const targetColIdx = ORDER_COLUMNS.findIndex(c => c.data === 'daily_target');
        if (daysColIdx < 0 || qtyColIdx < 0 || targetColIdx < 0) return;
        const ls = getLuckysheet();
        if (!ls?.setCellValue) return;
        const sheet = ls.getAllSheets()[0];
        if (!sheet?.data) return;
        const t0 = performance.now();
        let applied = 0;
        for (let r = 1; r < sheet.data.length - 1; r++) {
          const M = sheet.data[r]?.[qtyColIdx]?.v;
          const AB = sheet.data[r]?.[targetColIdx]?.v;
          const Mn = Number(M), ABn = Number(AB);
          if (!isNaN(Mn) && !isNaN(ABn) && ABn !== 0 && M !== '' && M != null && AB !== '' && AB != null) {
            const days = Math.round((Mn / ABn) * 10000) / 10000;
            // 同时设 v + m
            ls.setCellValue(r, daysColIdx, { v: days, m: String(days), ct: { t: 'n' } });
            applied++;
          }
        }
        console.log('[天数自动算] 已算 ' + applied + ' 行，耗时 ' + Math.round(performance.now() - t0) + 'ms');
      } catch (e) { console.warn('[天数自动算] 失败:', e?.message); }
      suppressHookRef.current = false;
    }, 600);
  }

  // ISO 字符串或 Excel 序列号 → dayjs
  const toDayjs = (val) => {
    if (!val) return null;
    const s = String(val);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dayjs(s.substring(0, 10));
    const num = Number(s);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      return dayjs(new Date((num - 25569) * 86400000));
    }
    return null;
  };

  return (
    <>
      <div
        id={containerId}
        style={{ width: '100%', height, position: 'relative' }}
      />
      {datePicker && (
        <ConfigProvider locale={zhCN}>
          <div
            style={{
              position: 'fixed', left: datePicker.x, top: datePicker.y,
              zIndex: 10000, background: '#fff',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderRadius: 4,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <DatePicker
              open
              value={toDayjs(datePicker.value)}
              onChange={(d) => {
                const iso = d ? d.format('YYYY-MM-DD') : null;
                const display = d ? `${d.month() + 1}月${d.date()}日` : '';
                // 把日期变化写入 order._pendingFields，下次 saveAll 时一并提交
                // 不立即发送 axios 请求，与 saveAll 的 batch-update 架构保持一致
                const order = dataRef.current.find(o => o.id === datePicker.orderId);
                if (order) {
                  if (!order._pendingFields) order._pendingFields = {};
                  order._pendingFields[datePicker.field] = iso;
                  order[datePicker.field] = iso; // 同步 dataRef 以供下次 toDayjs 使用
                }
                // 直接更新 Luckysheet 单元格显示（不触发任何 axios 请求）
                const ls = getLuckysheet();
                const rowIdx = rowMapRef.current.indexOf(datePicker.orderId);
                const colIdx = ORDER_COLUMNS.findIndex(col => col.data === datePicker.field);
                if (ls && ls.setCellValue && rowIdx >= 0 && colIdx >= 0) {
                  try { ls.setCellValue(rowIdx + 1, colIdx, display); } catch {}
                }
                setDatePicker(null);
              }}
              onOpenChange={(open) => { if (!open) setDatePicker(null); }}
              format="YYYY-MM-DD"
              placeholder="选择日期"
              style={{ visibility: 'hidden', position: 'absolute' }}
              popupStyle={{ zIndex: 10001 }}
            />
          </div>
        </ConfigProvider>
      )}
    </>
  );
}

export default forwardRef(LuckysheetEditor);
