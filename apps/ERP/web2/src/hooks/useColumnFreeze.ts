import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

// 表格冻结列(类 Excel 冻结窗格):冻结前 N 列,横向滚动时冻结列固定在左侧不动。
// 原理:冻结列的 th/td 设 position:sticky;left=左侧各列累计宽(运行时按表头 offsetWidth 测量,
// 自动布局表格列宽随内容变,故用 ResizeObserver 监听表格尺寸变化重测)。
// 用法:
//   const tableRef = useRef<HTMLTableElement>(null);
//   const fz = useColumnFreeze(tableRef, [rows.length], "web2.freeze./scheduling");
//   <table ref={tableRef}>…<th style={fz.head(i)}>…<td style={fz.cell(i)}>
//   冻结钉按钮调 fz.toggle(i);fz.frozen(i)/fz.boundary(i) 辅助加背景色与分隔线
//   (冻结格必须不透明背景,否则下方滚过的内容会透出)。
export interface ColumnFreeze {
  count: number; // 冻结列数(0=不冻结)
  frozen: (i: number) => boolean; // 第 i 列是否已冻结
  boundary: (i: number) => boolean; // 是否最后一个冻结列(画右分隔线)
  toggle: (i: number) => void; // 冻结到第 i 列(含);再点当前边界列=取消冻结
  head: (i: number) => CSSProperties; // 冻结列表头格样式(含 top:0,z 高于 sticky 表头)
  cell: (i: number) => CSSProperties; // 冻结列数据格样式
}

export function useColumnFreeze(
  tableRef: RefObject<HTMLTableElement | null>,
  deps: readonly unknown[] = [],
  storageKey?: string,
): ColumnFreeze {
  const [count, setCount] = useState(() =>
    storageKey ? Number(localStorage.getItem(storageKey) ?? 0) || 0 : 0,
  );
  const [lefts, setLefts] = useState<readonly number[]>([]);

  // 测量表头各列 offsetWidth,累计得每列 left;内容不变时保持原数组引用(防 ResizeObserver 死循环)
  const measure = useCallback(() => {
    setLefts((prev) => {
      const t = tableRef.current;
      if (!t || count === 0) return prev.length === 0 ? prev : [];
      const cells = t.tHead?.rows?.[0]?.cells;
      if (!cells || cells.length === 0) return prev;
      const next: number[] = [];
      let acc = 0;
      for (let i = 0; i < Math.min(count, cells.length); i++) {
        next.push(acc);
        acc += cells[i].offsetWidth;
      }
      return prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next;
    });
  }, [count, tableRef]);

  useLayoutEffect(() => {
    measure();
    const t = tableRef.current;
    if (!t || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  const toggle = useCallback(
    (i: number) => {
      setCount((c) => {
        const next = c === i + 1 ? 0 : i + 1;
        if (storageKey) localStorage.setItem(storageKey, String(next));
        return next;
      });
    },
    [storageKey],
  );

  const frozen = useCallback((i: number) => i < count, [count]);
  const boundary = useCallback((i: number) => count > 0 && i === count - 1, [count]);
  const head = useCallback(
    (i: number): CSSProperties =>
      i < count ? { position: "sticky", top: 0, left: lefts[i] ?? 0, zIndex: 30 } : {},
    [count, lefts],
  );
  const cell = useCallback(
    (i: number): CSSProperties =>
      i < count ? { position: "sticky", left: lefts[i] ?? 0, zIndex: 20 } : {},
    [count, lefts],
  );

  return { count, frozen, boundary, toggle, head, cell };
}
