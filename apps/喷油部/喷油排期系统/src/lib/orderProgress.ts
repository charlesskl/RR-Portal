import type { GanttOrder } from "@/lib/scheduleData";

const partKey = (itemName: string, partName: string) => `${itemName}\u0000${partName}`;

function demandByPart(g: GanttOrder): Map<string, number> {
  const demand = new Map<string, number>();
  for (const part of g.demandParts) {
    const key = partKey(part.itemName, part.partName);
    demand.set(key, (demand.get(key) ?? 0) + part.totalDemand);
  }
  return demand;
}

/**
 * Actual order progress, capped separately for every child part.
 * Over-reporting one child part must never compensate for a missing child part.
 */
export function recordedOrderProgress(g: GanttOrder): {
  demandQty: number;
  recordedQty: number;
  progressPct: number;
} {
  const demand = demandByPart(g);
  const recorded = new Map<string, number>();
  for (const plan of g.plans) {
    const key = partKey(plan.itemName, plan.partName);
    recorded.set(key, (recorded.get(key) ?? 0) + (plan.goodQty ?? 0));
  }

  const demandQty = Array.from(demand.values()).reduce((sum, qty) => sum + qty, 0);
  const recordedQty = Array.from(demand.entries()).reduce(
    (sum, [key, qty]) => sum + Math.min(qty, recorded.get(key) ?? 0),
    0,
  );
  const progressPct = demandQty > 0 ? Math.min(100, Math.round((recordedQty / demandQty) * 100)) : 0;
  return { demandQty, recordedQty, progressPct };
}

/** Each required child part must have enough scheduled quantity. */
export function orderScheduleCoverage(g: GanttOrder): { covered: boolean; finishDate: string | null } {
  const demand = demandByPart(g);
  if (demand.size === 0 || g.plans.length === 0) return { covered: false, finishDate: null };

  let finishDate: string | null = null;
  for (const [key, required] of Array.from(demand.entries())) {
    let planned = 0;
    let partFinish: string | null = null;
    const plans = g.plans
      .filter((plan) => partKey(plan.itemName, plan.partName) === key)
      .sort((a, b) => a.planDate.localeCompare(b.planDate));
    for (const plan of plans) {
      planned += plan.plannedQty;
      if (planned >= required) {
        partFinish = plan.planDate;
        break;
      }
    }
    if (!partFinish) return { covered: false, finishDate: null };
    if (!finishDate || partFinish > finishDate) finishDate = partFinish;
  }
  return { covered: true, finishDate };
}
