import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { DatePicker, ConfigProvider } from 'antd';
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

// 日期类字段（显示成 X月X日）
const DATE_FIELDS = new Set([
  'order_date', 'ship_date', 'start_date', 'complete_date', 'inspection_date',
  'plastic_due', 'material_due', 'carton_due', 'packaging_due',
]);

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

    columns.forEach((col, c) => {
      const val = order[col.data];
      const cellFmt = format[col.data] || {};
      const isSumCol = col.data === 'quantity_sum';
      const isDateCol = DATE_FIELDS.has(col.data);
      let displayVal, valueToStore, ct;
      if (isDateCol) {
        displayVal = formatDateShort(val);
        if (val == null || val === '') {
          valueToStore = '';
          ct = { t: 'g', fa: 'General' };
        } else {
          let serial = null;
          const s = String(val);
          const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (isoMatch) {
            const d = new Date(Date.UTC(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]));
            serial = (d.getTime() / 86400000) + 25569;
          } else {
            const num = Number(s);
            if (!isNaN(num) && num > 40000 && num < 60000) serial = num;
          }
          if (serial != null) {
            valueToStore = serial;
            // 用标准 yyyy-MM-dd 触发日期选择器，m 字段控制显示成 "5月8日"
            ct = { t: 'd', fa: 'yyyy-MM-dd' };
          } else {
            valueToStore = displayVal;
            ct = { t: 'g', fa: 'General' };
          }
        }
      } else {
        displayVal = val == null ? '' : String(val);
        valueToStore = val ?? '';
        ct = { t: col.type === 'numeric' ? 'n' : 's', fa: 'General' };
      }
      const cellValue = {
        v: valueToStore,
        m: displayVal,
        ct,
      };
      // row_color：导入时记录的行颜色（24 小时内有效）
      let showRowColor = false;
      if (order.row_color && order.created_at) {
        const created = new Date(order.created_at + 'Z');
        const hours = (Date.now() - created.getTime()) / 3600000;
        if (hours < 24) showRowColor = true;
      }
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
      if (cellFmt.ht != null) cellValue.ht = cellFmt.ht;
      if (cellFmt.vt != null) cellValue.vt = cellFmt.vt;
      if (cellFmt.fs) cellValue.fs = cellFmt.fs;
      if (cellFmt.bs) cellValue.bs = cellFmt.bs;

      if (cellValue.v === '' && !cellFmt.bg && !cellFmt.fc && !cellFmt.bl && !isNewImport && !isSumCol && !order.row_color) {
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

// 从 Luckysheet 单元格对象提取所有格式属性
function extractCellFormat(cell) {
  if (!cell) return null;
  const fmt = {};
  // 颜色 / 字体
  if (cell.bg) fmt.bg = cell.bg;
  if (cell.fc) fmt.fc = cell.fc;
  if (cell.bl) fmt.bl = cell.bl;
  if (cell.it) fmt.it = cell.it;
  if (cell.un) fmt.un = cell.un;
  if (cell.cl) fmt.cl = cell.cl;
  if (cell.ff) fmt.ff = cell.ff;
  if (cell.fs) fmt.fs = cell.fs;
  // 对齐 / 换行
  if (cell.ht != null) fmt.ht = cell.ht;
  if (cell.vt != null) fmt.vt = cell.vt;
  if (cell.tb != null) fmt.tb = cell.tb;
  if (cell.tr != null) fmt.tr = cell.tr;
  if (cell.rt != null) fmt.rt = cell.rt;
  // 合并单元格
  if (cell.mc) fmt.mc = cell.mc;
  // 单元格类型 / 格式（数字/日期/文本格式）
  if (cell.ct) fmt.ct = cell.ct;
  // 公式
  if (cell.f) fmt.f = cell.f;
  // 注释
  if (cell.ps) fmt.ps = cell.ps;
  // 缩进
  if (cell.qp != null) fmt.qp = cell.qp;
  return Object.keys(fmt).length > 0 ? fmt : null;
}

export default function LuckysheetEditor({
  data,
  onCellChange,
  onRefreshData,
  workshop,
  height = 600,
  containerId = 'luckysheet-container',
  newImportedIds,
}) {
  const rowMapRef = useRef([]);
  const initializedRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const syncTimerRef = useRef(null);
  const settingsTimerRef = useRef(null);
  const [sheetSettings, setSheetSettings] = useState(null);
  const settingsLoadedRef = useRef(false);
  const loadedIdsRef = useRef('');
  const [datePicker, setDatePicker] = useState(null); // {x, y, orderId, field, value}

  // 加载表格布局配置
  useEffect(() => {
    if (!workshop) return;
    axios.get('/api/orders/sheet-settings', { params: { workshop } })
      .then(res => { setSheetSettings(res.data || {}); settingsLoadedRef.current = true; })
      .catch(() => { setSheetSettings({}); settingsLoadedRef.current = true; });
  }, [workshop]);

  // 保存布局（列宽/行高/冻结）— 防抖
  const saveSheetSettings = () => {
    if (!workshop || !initializedRef.current) return;
    const ls = getLuckysheet();
    if (!ls || !ls.getAllSheets) return;
    let sheets;
    try { sheets = ls.getAllSheets(); } catch { return; }
    const sheet = sheets && sheets[0];
    if (!sheet) return;
    const cfg = sheet.config || {};
    const settings = {
      columnlen: cfg.columnlen || {},
      rowlen: cfg.rowlen || {},
      frozen: sheet.frozen || null,
      // 合并单元格（sheet 级别）
      merge: cfg.merge || {},
      // 边框信息
      borderInfo: cfg.borderInfo || [],
      // 隐藏行/列
      rowhidden: cfg.rowhidden || {},
      colhidden: cfg.colhidden || {},
      // 自动筛选
      autoFilter: sheet.luckysheet_autoFilter || null,
      // 条件格式
      luckysheet_conditionformat_save: sheet.luckysheet_conditionformat_save || [],
    };
    axios.put('/api/orders/sheet-settings', { workshop, settings }).catch(() => {});
  };
  const scheduleSaveSettings = () => {
    clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(saveSheetSettings, 1000);
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

  // 同步当前整张表的格式 + 值 + 蓝色自动完成
  const syncFormats = () => {
    if (!initializedRef.current) return;
    const ls = getLuckysheet();
    if (!ls || !ls.getAllSheets) return;
    let sheets;
    try { sheets = ls.getAllSheets(); } catch { return; }
    const sheet = sheets && sheets[0];
    if (!sheet || !sheet.data) return;

    let rowsCompleted = 0;
    for (let r = 1; r < sheet.data.length; r++) {
      const orderId = rowMapRef.current[r - 1];
      if (!orderId) continue;
      const order = dataRef.current.find(o => o.id === orderId);
      if (!order) continue;
      const rowCells = sheet.data[r];
      if (!rowCells) continue;
      const newFmt = {};
      let blueCount = 0;
      let nonEmptyCount = 0;
      for (let c = 0; c < ORDER_COLUMNS.length; c++) {
        const col = ORDER_COLUMNS[c];
        const cell = rowCells[c];
        const fmt = extractCellFormat(cell);
        if (fmt) newFmt[col.data] = fmt;

        // 安全模式：只把"非空显示"同步到数据库（不会用空值覆盖已有数据）
        if (col.data !== 'quantity_sum' && !DATE_FIELDS.has(col.data) && onCellChange) {
          const cellVal = cell ? cell.v : null;
          if (cellVal != null && String(cellVal).trim() !== '') {
            const dbVal = order[col.data];
            if (String(cellVal) !== String(dbVal ?? '')) {
              onCellChange(orderId, col.data, cellVal);
              order[col.data] = cellVal;
            }
          }
        }

        if (cell && cell.v != null && cell.v !== '') {
          nonEmptyCount++;
          if (fmt && isBlueFont(fmt.fc)) blueCount++;
        }
      }

      const newFmtStr = Object.keys(newFmt).length > 0 ? JSON.stringify(newFmt) : null;
      const oldFmtStr = order.cell_format || null;
      if (newFmtStr !== oldFmtStr && onCellChange) {
        onCellChange(orderId, 'cell_format', newFmtStr);
        order.cell_format = newFmtStr;
      }

      // 任意非空单元格字体蓝色 → 自动转完成
      if (order.status === 'active' && blueCount >= 1 && onCellChange) {
        onCellChange(orderId, 'status', 'completed');
        order.status = 'completed';
        rowsCompleted++;
      }
    }

    if (rowsCompleted > 0 && onRefreshData) onRefreshData();
  };

  const scheduleSyncFormats = () => {
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(syncFormats, 800);
  };

  // 定时轮询同步（每 2 秒检查一次格式变化 + 蓝色自动完成）
  useEffect(() => {
    const id = setInterval(() => {
      if (initializedRef.current) {
        syncFormats();
        saveSheetSettings();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [workshop]);

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
    loadedIdsRef.current = data.map(o => o.id).join(',');

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
      hook: {
        cellUpdated: (r, c, oldValue, newValue) => {
          if (r === 0) return;
          const orderId = rowMapRef.current[r - 1];
          if (!orderId) return;
          const field = ORDER_COLUMNS[c]?.data;
          if (!field || field === 'quantity_sum') return;
          let val;
          if (newValue == null) val = null;
          else if (typeof newValue === 'object') val = newValue.v ?? newValue.m ?? '';
          else val = newValue;
          if (onCellChange) onCellChange(orderId, field, val);
        },
        rangeUpdated: () => { scheduleSyncFormats(); scheduleSaveSettings(); },
        updated: () => { scheduleSyncFormats(); scheduleSaveSettings(); },
        cellEditBefore: function(range) {
          console.log('[cellEditBefore]', range);
          if (!range || !range[0]) return;
          const r = range[0].row?.[0];
          const c = range[0].column?.[0];
          if (r == null || r === 0 || c == null) return;
          const field = ORDER_COLUMNS[c]?.data;
          if (!field || !DATE_FIELDS.has(field)) return;
          const orderId = rowMapRef.current[r - 1];
          if (!orderId) return;
          const order = dataRef.current.find(o => o.id === orderId);
          const ls = getLuckysheet();
          try { ls.exitEditMode && ls.exitEditMode(); } catch {}
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

    return () => {
      initializedRef.current = false;
      clearTimeout(syncTimerRef.current);
      clearTimeout(settingsTimerRef.current);
      const ls = getLuckysheet();
      if (ls && ls.destroy) {
        try { ls.destroy(); } catch {}
      }
    };
  }, [containerId, sheetSettings, data.map(o => o.id).join(',')]);

  // data 变化时只更新 rowMapRef 用于编辑映射，不重建表格
  useEffect(() => {
    if (!initializedRef.current) return;
    rowMapRef.current = data.map(o => o.id);
  }, [data]);

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
      <div id={containerId} style={{ width: '100%', height, position: 'relative' }} />
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
              if (onCellChange) onCellChange(datePicker.orderId, datePicker.field, iso);
              const order = dataRef.current.find(o => o.id === datePicker.orderId);
              if (order) order[datePicker.field] = iso;
              // 直接更新 Luckysheet 单元格显示
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
