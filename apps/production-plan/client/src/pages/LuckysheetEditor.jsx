import { useEffect, useRef } from 'react';
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

export default function LuckysheetEditor({
  data,
  onCellChange,
  onFormatChange,
  height = 600,
  containerId = 'luckysheet-container',
  newImportedIds,
}) {
  const rowMapRef = useRef([]); // row index → order id
  const initializedRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const luckysheet = getLuckysheet();
    if (!luckysheet) {
      console.error('Luckysheet 未加载，请检查 CDN 链接');
      return;
    }

    // 构建行号→订单id的映射
    rowMapRef.current = data.map(o => o.id);

    const celldata = ordersToCelldata(data, ORDER_COLUMNS, newImportedIds);
    const colWidths = {};
    ORDER_COLUMNS.forEach((c, i) => { colWidths[i] = c.width || 80; });

    const sheetConfig = {
      name: '生产计划',
      celldata,
      row: Math.max(data.length + 1, 50),
      column: ORDER_COLUMNS.length,
      config: {
        columnlen: colWidths,
        // 首行冻结 + 前5列冻结
        frozen: { type: 'rangeBoth', range: { row_focus: 0, column_focus: 4 } },
      },
      frozen: { type: 'rangeBoth', range: { row_focus: 0, column_focus: 4 } },
    };

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
      data: [sheetConfig],
      hook: {
        cellUpdated: (r, c, oldValue, newValue) => {
          if (r === 0) return; // 表头
          const orderId = rowMapRef.current[r - 1];
          if (!orderId) return;
          const field = ORDER_COLUMNS[c]?.data;
          if (!field || field === 'quantity_sum') return;
          const val = newValue && newValue.v != null ? newValue.v : null;
          if (onCellChange) onCellChange(orderId, field, val);
        },
        rangeUpdated: (sheetIndex, range) => {
          // 格式变更（颜色/字体等）- 读取当前单元格格式变化
          // 暂留空，依赖 cellUpdated 覆盖值和格式
        },
      },
    });

    initializedRef.current = true;

    return () => {
      const ls = getLuckysheet();
      if (ls && ls.destroy) {
        try { ls.destroy(); } catch {}
      }
      initializedRef.current = false;
    };
  }, [containerId]);

  // 数据变化时刷新
  useEffect(() => {
    if (!initializedRef.current) return;
    const luckysheet = getLuckysheet();
    if (!luckysheet) return;

    rowMapRef.current = data.map(o => o.id);
    const celldata = ordersToCelldata(data, ORDER_COLUMNS, newImportedIds);

    try {
      // 用 setSheetData 或直接 refresh - 这里用 create 重新初始化最安全
      const colWidths = {};
      ORDER_COLUMNS.forEach((c, i) => { colWidths[i] = c.width || 80; });
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
          config: { columnlen: colWidths, frozen: { type: 'rangeBoth', range: { row_focus: 0, column_focus: 4 } } },
          frozen: { type: 'rangeBoth', range: { row_focus: 0, column_focus: 4 } },
        }],
        hook: {
          cellUpdated: (r, c, oldValue, newValue) => {
            if (r === 0) return;
            const orderId = rowMapRef.current[r - 1];
            if (!orderId) return;
            const field = ORDER_COLUMNS[c]?.data;
            if (!field || field === 'quantity_sum') return;
            const val = newValue && newValue.v != null ? newValue.v : null;
            if (onCellChange) onCellChange(orderId, field, val);
          },
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
