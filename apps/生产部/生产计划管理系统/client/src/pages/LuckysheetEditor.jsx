import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
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
      const cellValue = {
        v: val ?? '',
        m: val == null ? '' : String(val),
        ct: { t: col.type === 'numeric' ? 'n' : 's' },
      };
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

      if (cellValue.v === '' && !cellFmt.bg && !cellFmt.fc && !cellFmt.bl && !isNewImport && !isSumCol) {
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
function extractCellFormat(cell) {
  if (!cell) return null;
  const fmt = {};
  if (cell.bg) fmt.bg = cell.bg;
  if (cell.fc) fmt.fc = cell.fc;
  if (cell.bl) fmt.bl = cell.bl;
  if (cell.it) fmt.it = cell.it;
  if (cell.un) fmt.un = cell.un;
  if (cell.ht != null) fmt.ht = cell.ht;
  if (cell.vt != null) fmt.vt = cell.vt;
  if (cell.fs) fmt.fs = cell.fs;
  if (cell.ff) fmt.ff = cell.ff;
  if (cell.cl) fmt.cl = cell.cl;
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

  // 同步当前整张表的单元格格式到后端
  // 收集所有变化后用一次 batch-update POST 提交，避免 N 个 PUT 撞 nginx 限流
  // 失败静默（轮询会重试），不弹「保存失败」toast（toast 仅用于用户主动编辑）
  const syncFormats = () => {
    if (!initializedRef.current) return;
    const ls = getLuckysheet();
    if (!ls || !ls.getAllSheets) return;
    let sheets;
    try { sheets = ls.getAllSheets(); } catch { return; }
    const sheet = sheets && sheets[0];
    if (!sheet || !sheet.data) return;

    const updates = [];
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
        const cell = rowCells[c];
        const fmt = extractCellFormat(cell);
        if (fmt) newFmt[ORDER_COLUMNS[c].data] = fmt;
        if (cell && cell.v != null && cell.v !== '') {
          nonEmptyCount++;
          if (fmt && isBlueFont(fmt.fc)) blueCount++;
        }
      }

      const newFmtStr = Object.keys(newFmt).length > 0 ? JSON.stringify(newFmt) : null;
      const oldFmtStr = order.cell_format || null;
      const fields = {};
      if (newFmtStr !== oldFmtStr) {
        fields.cell_format = newFmtStr;
        order.cell_format = newFmtStr;
      }
      // 任意非空单元格字体蓝色 → 自动转完成
      if (order.status === 'active' && blueCount >= 1) {
        fields.status = 'completed';
        order.status = 'completed';
        rowsCompleted++;
      }
      if (Object.keys(fields).length > 0) {
        updates.push({ id: orderId, fields });
      }
    }

    if (updates.length > 0) {
      axios.post('/api/orders/batch-update', { updates }).catch(() => {});
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
      config: { columnlen: colWidths, rowlen: rowLen },
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
  }, [containerId, sheetSettings]);

  // 数据变化时刷新（仅当订单集合/顺序变化时才重建，避免用户编辑被覆盖）
  useEffect(() => {
    if (!initializedRef.current) return;
    const luckysheet = getLuckysheet();
    if (!luckysheet) return;

    const newIds = data.map(o => o.id).join(',');
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
          config: { columnlen: colWidths, rowlen: rowLen },
          ...(savedFrozen ? { frozen: savedFrozen } : {}),
        }],
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
          rangeUpdated: () => { scheduleSyncFormats(); },
          updated: () => { scheduleSyncFormats(); },
        },
      });
    } catch (e) {
      console.error('Luckysheet 更新失败', e);
    }
  }, [data, newImportedIds]);

  return (
    <div
      id={containerId}
      style={{ width: '100%', height, position: 'relative' }}
    />
  );
}
