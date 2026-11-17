import { changed, normalizeDate, type Draft, type WorkbenchAllocationSource, type WorkbenchBalance, type WorkbenchRow } from "./planWorkbench";
import { isPlanDate } from "./planDateAdjustment";

export const balanceKey = (row: { orderId?: number; partName: string; stepNo: number }) => JSON.stringify([row.orderId, row.partName, row.stepNo]);
export type LiveBalance = { balance?: WorkbenchBalance; issue?: string };

/** 根据加载时的全日期快照计算草稿；不改写基线，也不触发网络或保存。 */
export function livePlanBalances(rows: WorkbenchRow[], drafts: Record<number, Draft>, sources: WorkbenchAllocationSource[] | undefined, autoDeduct: boolean) {
  const results = new Map<string, LiveBalance>();
  const groups = new Map<string, WorkbenchRow[]>();
  const dirtyIds = new Set(rows.filter(r => r.id < 0 || changed(r, drafts[r.id])).map(r => r.id));
  const sourceGroups = new Map<string, WorkbenchAllocationSource[]>();
  if (autoDeduct) for (const source of sources ?? []) {
    if (source.id <= 0 || !source.canDeduct || dirtyIds.has(source.id)) continue;
    const key = balanceKey(source); const group = sourceGroups.get(key) ?? [];
    group.push(source); sourceGroups.set(key, group);
  }
  for (const row of rows) {
    const key = balanceKey(row); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  for (const [key, group] of Array.from(groups.entries())) {
    const baseline = group.find(r => r.balance)?.balance;
    if (!baseline) { results.set(key, { issue: "统计未加载，请重新加载" }); continue; }
    const edits = group.filter(r => dirtyIds.has(r.id) && !r.lockedReason);
    let issue: string | undefined;
    const targets = edits.map(row => {
      const draft = drafts[row.id]; const text = draft?.plannedQty?.trim() ?? "";
      const qty = Number(text.replace(/,/g, ""));
      if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text) || !Number.isSafeInteger(qty) || qty <= 0 || qty > 2147483647)
        issue = "计划数输入中或无效，暂不计算本组统计";
      const date = normalizeDate(draft?.planDate ?? row.values.planDate);
      if (autoDeduct && !isPlanDate(date)) issue = "日期输入中或无效，暂不计算自动扣减";
      return { row, qty, date, delta: qty - row.values.plannedQty };
    });
    if (issue) { results.set(key, { issue }); continue; }
    const netExisting = targets.filter(t => t.row.id > 0).reduce((sum, t) => sum + t.delta, 0);
    const newQty = targets.filter(t => t.row.id < 0).reduce((sum, t) => sum + t.qty, 0);
    let planned = baseline.unreportedPlanned + netExisting + newQty;
    if (planned < 0) { results.set(key, { issue: "统计基线与计划不一致，请重新加载" }); continue; }
    let required = autoDeduct ? Math.max(0, netExisting) + Math.max(0, newQty + Math.min(0, netExisting) - Math.max(0, baseline.demand - baseline.produced - baseline.unreportedPlanned)) : 0;
    if (required > 0) {
      const donors = (sourceGroups.get(key) ?? []).map(s => ({ ...s }))
        .sort((a, b) => a.planDate.localeCompare(b.planDate) || a.id - b.id);
      let deducted = 0;
      for (const target of targets.filter(t => t.delta > 0).sort((a, b) => a.date.localeCompare(b.date) || a.row.id - b.row.id)) {
        let need = Math.min(required, target.delta);
        if (!need) continue;
        if (!sources) { issue = "自动扣减资料未加载，当前数量未计自动扣减，请重新加载"; break; }
        const available = donors.filter(s => s.planDate > target.date).reduce((sum, s) => sum + s.plannedQty, 0);
        if (available < need) { issue = `后续可扣减 ${available.toLocaleString()} 件，需要 ${need.toLocaleString()} 件；当前数量未计自动扣减`; break; }
        for (const donor of donors) {
          if (!need) break;
          if (donor.planDate <= target.date) continue;
          const take = Math.min(need, donor.plannedQty);
          donor.plannedQty -= take; need -= take; required -= take; deducted += take;
        }
      }
      // 服务端对不足的批次整批拒绝；本组不展示部分扣减成功的假象。
      if (!issue) planned -= deducted;
    }
    results.set(key, { balance: { ...baseline, unreportedPlanned: planned,
      remainingToSchedule: Math.max(0, baseline.demand - baseline.produced - planned) }, issue });
  }
  return results;
}
