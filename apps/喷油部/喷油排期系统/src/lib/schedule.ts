// 排期 / 产能换算纯函数（口径A：标准满产能）。详见 v1.0 总设计 §5.3。

/** 部位某天产量 = 投入资源数 × 单台(单人)日产能。机喷资源=机台数，人工喷资源=人数。 */
export function partDailyOutput(resourceCount: number, dailyCapacity: number): number {
  return Math.max(0, resourceCount) * Math.max(0, dailyCapacity);
}

/** 部位剩余天数 = ceil(余下数 / 日产量)；日产量<=0 返回 null（无法估算）。 */
export function partRemainingDays(remainingQty: number, dailyOutput: number): number | null {
  if (dailyOutput <= 0) return null;
  if (remainingQty <= 0) return 0;
  return Math.ceil(remainingQty / dailyOutput);
}

// ===== 排期录入用：部位级需求展开（不分颜色/规格，直接读订单部位数量）=====

type PartQtyLite = { sourcePartId: number | null; partName?: string; qty: number };
type LineLite = { sourceItemId: number | null; itemName?: string; partQtys: PartQtyLite[] };

/** 某子件总需求 = 该子件所有明细行各部位数量之和（不分颜色/规格）。 */
export function subItemTotalDemand(lines: LineLite[], sourceItemId: number): number {
  return lines
    .filter((l) => l.sourceItemId === sourceItemId)
    .reduce((s, l) => s + l.partQtys.reduce((a, q) => a + (q.qty || 0), 0), 0);
}

export type SchedulablePart = {
  sourceItemId: number;
  itemName: string;
  sourcePartId: number;
  partName: string;
  productionMode: string;
  dailyCapacity: number;
  stdMachineCount: number;
  totalDemand: number;
  craft: string;
  isTumbler: boolean;
  craftPasses: number;
};

type PartLite = { id: number; partName: string; productionMode: string; dailyCapacity: number; stdMachineCount: number; craft?: string; isTumbler?: boolean; craftPasses?: number };
type ItemLite = { id: number; itemName: string; parts: PartLite[] };
type OrderLite = { lines: LineLite[]; product: { items: ItemLite[] } };

/** 把订单展开成「可排部位清单」：每个订单部位一项，需求=该部位订单数量，产能属性来自产品库部位。 */
export function expandOrderParts(order: OrderLite): SchedulablePart[] {
  const out: SchedulablePart[] = [];
  for (const line of order.lines) {
    const item = order.product.items.find((it) => it.id === line.sourceItemId);
    if (!item) continue;
    for (const pq of line.partQtys) {
      const part = item.parts.find((p) => p.id === pq.sourcePartId);
      if (!part) continue;
      out.push({
        sourceItemId: item.id,
        itemName: item.itemName,
        sourcePartId: part.id,
        partName: part.partName,
        productionMode: part.productionMode,
        dailyCapacity: part.dailyCapacity,
        stdMachineCount: part.stdMachineCount,
        totalDemand: pq.qty || 0,
        craft: part.craft ?? "",
        isTumbler: !!part.isTumbler,
        craftPasses: part.craftPasses ?? 0,
      });
    }
  }
  return out;
}

// ===== 预计出单日 / 上车间日 / 每周排期日期 =====

/** 左补零至两位数（内部工具函数）。 */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Date → 'YYYY-MM-DD' 字符串（内部工具函数，不依赖时区 API）。 */
const toYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 纯函数加天数。
 * 调用方负责传入 today；函数内部禁止调用 Date.now() 或无参 new Date()，保证可测性。
 * 带参 new Date(date) 仅用于复制，符合约束。
 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

type PartLoad = { remainingQty: number; resourceCount: number; dailyCapacity: number };

/**
 * 订单剩余天数 = MAX(各部位 ceil(余下数 ÷ (投入资源×日产能)))。
 * 口径A（木桶取最慢）：任一部位无法估（日产 ≤ 0）→ 整单返回 null。
 * 空清单 → 0（无需生产）。
 */
export function orderRemainingDays(parts: PartLoad[]): number | null {
  let max = 0;
  for (const p of parts) {
    // 复用已有的 partDailyOutput / partRemainingDays 保持口径一致
    const days = partRemainingDays(p.remainingQty, partDailyOutput(p.resourceCount, p.dailyCapacity));
    if (days === null) return null;
    if (days > max) max = days;
  }
  return max;
}

/**
 * 上车间日 = 所有已排 planDate 中最早的一天（字典序 = 时间序，对 YYYY-MM-DD 有效）。
 * 无计划 → null。
 */
export function orderFirstPlanDate(planDates: string[]): string | null {
  if (planDates.length === 0) return null;
  return planDates.slice().sort()[0];
}

/**
 * 每周排期日期列表：给定本周一的 ISO 日期 + 填了排量的星期偏移数组
 * (0 = 周一 … 6 = 周日)，返回对应的 'YYYY-MM-DD' 日期列表。
 * 未填任何天（dayOffsets 为空）→ 空数组。
 */
export function weeklyPlanDates(weekMondayIso: string, dayOffsets: number[]): string[] {
  // 带参 new Date(isoString) 允许使用
  const base = new Date(weekMondayIso);
  return dayOffsets.map((off) => toYmd(addDays(base, off)));
}
