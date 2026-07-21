// 排期总览看板：把后端 /api/schedule/overview 的扁平计划行聚合成「日期 × 拉别」网格。
// 纯函数（无 DOM/请求依赖），供 ScheduleOverview 组件与单测共用。口径见 spec 2026-06-24 §6。

/** 后端 OverviewPlan（camelCase 序列化）：一条计划明细行。 */
export type OverviewPlan = {
  id: number;
  lineId: number;
  date: string; // YYYY-MM-DD
  orderId: number;
  productNo: string;
  itemName: string;
  partName: string;
  stepNo: number;
  craft: string;
  plannedQty: number;
  machineNos: string[];
  workerCount: number;
};

/** 后端 OverviewLine：一条拉别（当列）。dailyLimit=每天产能上限件数，0=不卡。 */
export type OverviewLine = { lineId: number; name: string; craftType: string; dailyLimit: number };

/** 工序配色档：喷油类=绿 / 移印=蓝 / UV=紫（业务方 2026-06-30 确认：手喷与自动喷都算喷油类）。 */
export type CraftColor = "spray" | "print" | "uv" | "other";
export function craftColor(craft: string): CraftColor {
  const c = (craft ?? "").trim();
  const upper = c.toUpperCase();
  if (c === "手喷" || c === "自动喷" || c === "喷油" || c.includes("喷油")) return "spray";
  if (c === "移印") return "print";
  if (upper === "UV") return "uv";
  return "other";
}

/** 产能占用档：<90% 未满 / 90~100% 快满 / >100% 超载。上限=0 视为不卡 → null（不判色）。 */
export type LoadLevel = "ok" | "busy" | "over" | null;
export function loadLevel(total: number, dailyLimit: number): LoadLevel {
  if (dailyLimit <= 0) return null;
  const pct = (total / dailyLimit) * 100;
  if (pct > 100) return "over";
  if (pct >= 90) return "busy";
  return "ok";
}

/** 格子里一条「部位 + 数量 + 第几道」。 */
export type CellItem = {
  partName: string; qty: number; stepNo: number; craft: string; color: CraftColor;
  id: number; orderId: number; productNo: string; machineNos: string[]; workerCount: number;
};

/** 一个格子（某天 × 某拉）。count=条数（mockup「N款」）；occupancyPct/level 靠该拉日上限算。 */
export type Cell = {
  lineId: number; date: string; items: CellItem[];
  total: number; count: number; occupancyPct: number | null; level: LoadLevel;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 生成 [from, to] 闭区间的每一天（YYYY-MM-DD）。to < from 返回空数组。 */
export function dateRange(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const out: string[] = [];
  while (cur <= end) {
    out.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** 格子键：日期 + 拉别 id。 */
export const cellKey = (date: string, lineId: number) => `${date}__${lineId}`;

/**
 * 把计划行聚合成网格：key=cellKey(date,lineId) → Cell。
 * 只对「有计划」的格子建 Cell；空格由组件按 dates×lines 遍历时判空。
 * 每格 items 按数量降序（大的排前，mockup 效果）；occupancy/level 用该拉日上限算。
 */
export function buildOverviewGrid(plans: OverviewPlan[], lines: OverviewLine[]): Record<string, Cell> {
  const limitOf = new Map(lines.map((l) => [l.lineId, l.dailyLimit]));
  const craftOf = new Map(lines.map((l) => [l.lineId, l.craftType]));
  const grid: Record<string, Cell> = {};
  for (const p of plans) {
    const key = cellKey(p.date, p.lineId);
    let cell = grid[key];
    if (!cell) {
      cell = { lineId: p.lineId, date: p.date, items: [], total: 0, count: 0, occupancyPct: null, level: null };
      grid[key] = cell;
    }
    const craft = (p.craft ?? "").trim() || craftOf.get(p.lineId) || "";
    cell.items.push({
      partName: p.partName, qty: p.plannedQty, stepNo: p.stepNo, craft, color: craftColor(craft),
      id: p.id, orderId: p.orderId, productNo: p.productNo, machineNos: p.machineNos, workerCount: p.workerCount,
    });
    cell.total += p.plannedQty;
    cell.count += 1;
  }
  for (const cell of Object.values(grid)) {
    cell.items.sort((a, b) => b.qty - a.qty);
    const limit = limitOf.get(cell.lineId) ?? 0;
    cell.occupancyPct = limit > 0 ? Math.round((cell.total / limit) * 100) : null;
    cell.level = loadLevel(cell.total, limit);
  }
  return grid;
}
