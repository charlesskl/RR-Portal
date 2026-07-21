// 甘特图相关的纯工具函数与数据结构定义。
// 注：原 buildGanttData（聚合甘特数据）已迁移到 .NET 后端 GET /api/schedule，
// 这里只保留前端仍复用的纯函数（ymd/safeArr/safeLen）与类型定义（GanttOrder 等）。

// ─── 内部工具 ───────────────────────────────────────────────

/** 左补零至两位。 */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Date → 'YYYY-MM-DD' 字符串（不依赖时区 API，与 schedule.ts 同款）。 */
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 安全解析 JSON 字符串为字符串数组，失败返回空数组。 */
export function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 从 machineNos JSON 字符串推算投入机台数。
 * 空数组或解析失败时返回 1（至少 1 台，避免除以 0）。
 */
export function safeLen(s: string): number {
  const a = safeArr(s);
  return a.length > 0 ? a.length : 1;
}

// ─── 甘特图数据结构定义（前端按此类型消费 .NET /api/schedule 返回）────

export type GanttPlan = {
  planDate: string;
  itemName: string;
  partName: string;
  sourcePartId: number | null;
  plannedQty: number;
  goodQty: number | null;
  reportedQty: number | null;
  machineNos: string[];
  workerCount: number;
};

/** 部位需求信息（供前端「数量」列查用，来自 .NET 展开结果）。 */
export type DemandPart = {
  sourceItemId: number;
  itemName: string;
  sourcePartId: number;
  partName: string;
  totalDemand: number;
};

export type GanttOrder = {
  id: number;
  externalOrderNo: string;
  productNo: string;
  status: string;
  deliveryDate: string | null;
  scheduled: boolean;
  firstPlanDate: string | null;
  expectedOutDate: string | null;
  plans: GanttPlan[];
  /** 各部位需求量：含 itemName/sourcePartId/partName/totalDemand（每部位一条）。
   *  前端三层「数量」列：部位=该部位 totalDemand，子件=该子件各部位之和，
   *  订单=全部部位之和（部位数量可不同，一律累加，不去重）。 */
  demandParts: DemandPart[];
};
