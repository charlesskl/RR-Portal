import { useCallback, useSyncExternalStore } from "react";

// 全站表格密度三档:紧凑 32px / 标准 40px / 宽松 48px 行高。
// localStorage `web2.tableDensity` 持久化,刷新/重开后保持。
// 模块级共享存储(useSyncExternalStore):同屏多个表格(keep-alive 常驻页/查询页签)
// 与 DensitySwitch 各自调 hook 也实时联动,不会出现切换后只有一边变。
export type TableDensity = "compact" | "standard" | "relaxed";

export const TABLE_DENSITY_KEY = "web2.tableDensity";

export const TABLE_DENSITIES: {
  key: TableDensity;
  label: string;
  rowH: number;
  text: string;
}[] = [
  { key: "compact", label: "紧凑", rowH: 32, text: "text-[13px]" },
  { key: "standard", label: "标准", rowH: 40, text: "text-sm" },
  { key: "relaxed", label: "宽松", rowH: 48, text: "text-[15px]" },
];

function readStored(): TableDensity {
  try {
    const v = localStorage.getItem(TABLE_DENSITY_KEY);
    if (v === "compact" || v === "standard" || v === "relaxed") return v;
  } catch {
    // localStorage 不可用(隐私模式等)时回落标准档
  }
  return "standard";
}

let current: TableDensity = readStored();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  // 挂载时回读 localStorage:模块级缓存在刷新/重挂(测试重开、路由重进)后可能落后于持久化值
  const stored = readStored();
  if (stored !== current) {
    current = stored;
    listeners.forEach((f) => f());
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getSnapshot = (): TableDensity => current;

export function useTableDensity(): {
  density: TableDensity;
  setDensity: (d: TableDensity) => void;
} {
  const density = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setDensity = useCallback((d: TableDensity) => {
    current = d;
    try {
      localStorage.setItem(TABLE_DENSITY_KEY, d);
    } catch {
      // 持久化失败不影响当次切换
    }
    listeners.forEach((fn) => fn());
  }, []);

  return { density, setDensity };
}
