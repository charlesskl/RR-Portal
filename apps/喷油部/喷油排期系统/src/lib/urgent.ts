// 急单核心纯函数（口径见 spec 2026-06-16-urgent-order-design §4、§6）。
// 不碰日期/不查库，只做可测的纯计算；真实日期由后端算好后喂进来。

/**
 * 急单要占的生产天数 = ceil(数量 ÷ (投入台/人数 × 单台日产能))。
 * 产能为 0（缺录入）或数量为 0 → 0，表示无法/无需估算，交人工。
 */
export function urgentDays(qty: number, machineCount: number, dailyCapacity: number): number {
  const perDay = Math.max(0, machineCount) * Math.max(0, dailyCapacity);
  if (perDay <= 0 || qty <= 0) return 0;
  return Math.ceil(qty / perDay);
}

/**
 * 能缓几天 = 顺延后预计完成日仍不超交货日的最大天数。
 * 入参 bufferToDeadline = 当前预计完成日距交货日的缓冲天数（可为负）。
 * 负数（已超期）按 0 处理：超期单不适合停。
 */
export function slackDays(bufferToDeadline: number): number {
  return Math.max(0, bufferToDeadline);
}

/** 候选最小约定：只要求带 slack（能缓几天）；其余字段（单号/交货日等）原样保留。 */
export type Cand = { slack: number };

/**
 * 按「能缓得多的优先」预勾候选，累加凑够急单所需天数 need。
 * - 只考虑 slack > 0 的候选（不适合停的不预勾）。
 * - enough：凑够了没（got >= need）；凑不够时 picked 含全部可用候选，交人工。
 * 泛型保留传入对象的所有字段，方便上层带 id/单号/交货日。
 */
export function pickCandidates<T extends Cand>(
  cands: T[],
  need: number,
): { picked: T[]; enough: boolean; got: number } {
  const sorted = [...cands].filter((c) => c.slack > 0).sort((a, b) => b.slack - a.slack);
  const picked: T[] = [];
  let got = 0;
  for (const c of sorted) {
    if (got >= need) break;
    picked.push(c);
    got += c.slack;
  }
  return { picked, enough: got >= need, got };
}
