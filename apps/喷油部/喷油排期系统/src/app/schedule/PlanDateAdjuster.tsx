"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { invalidateClientCache } from "@/lib/clientCache";
import { apiFetch } from "@/lib/apiFetch";
import { isPlanDate, shiftPlanDate } from "@/lib/planDateAdjustment";

type Plan = { id: number; planDate: string; partName: string; craft: string; stepNo: number; plannedQty: number; status: string; goodQty: number | null; inboundQty: number | null; reportedQty: number | null; canReschedule: boolean };
const dateOf = (value: string) => value.slice(0, 10);
const locked = (plan: Plan) => !plan.canReschedule;
const input = "border border-app-border rounded-btn px-3 py-2 text-sm";
export default function PlanDateAdjuster({ orderId, onSaved }: { orderId: number; onSaved: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dates, setDates] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [from, setFrom] = useState("");
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const res = await apiFetch(`/api/plans?orderId=${orderId}`, { cache: "no-store" });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || "读取排期失败，请重试"); }
      const rows: Plan[] = await res.json();
      setPlans(rows); setDates(Object.fromEntries(rows.map(p => [p.id, dateOf(p.planDate)]))); setSelected([]); setOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "读取失败"); }
    finally { setBusy(false); }
  }
  function shift() {
    if (!Number.isInteger(days) || Math.abs(days) > 3650 || days === 0) { setError("请输入非零整数天数，范围为 -3650 至 3650"); return; }
    if (!selected.length) { setError("请先勾选要调整的计划"); return; }
    const eligible = plans.filter(p => selected.includes(p.id) && !locked(p) && (!from || dateOf(p.planDate) >= from));
    if (!eligible.length) { setError("所选计划均早于起始日期，请调整筛选条件"); return; }
    try {
      const next = { ...dates };
      for (const plan of eligible) next[plan.id] = shiftPlanDate(dates[plan.id], days);
      setDates(next); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "日期调整失败，请检查日期"); }
  }
  const changes = plans.filter(p => !locked(p) && dates[p.id] !== dateOf(p.planDate)).map(p => ({ id: p.id, originalDate: dateOf(p.planDate), newDate: dates[p.id] }));
  async function save() {
    if (!changes.length) return;
    if (changes.some(change => !isPlanDate(change.newDate))) { setError("请为所有调整填写有效日期"); return; }
    setBusy(true); setError("");
    try {
      const res = await apiFetch("/api/plans/reschedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes, reason }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "调整失败");
      invalidateClientCache("/api/orders"); invalidateClientCache("/api/schedule");
      setOpen(false); onSaved(); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "调整失败"); }
    finally { setBusy(false); }
  }
  return <div className="bg-white border border-app-border rounded-card p-4 mb-4">
    <button disabled={busy} onClick={() => open ? setOpen(false) : load()} className="text-sky text-sm font-semibold">{open ? "收起日期调整" : "调整排期日期"}</button>
    {error && <p role="alert" className="text-rose-dark text-sm mt-2">{error}</p>}
    {open && <>
      <p className="text-xs text-text-secondary my-3">可直接修改单条日期，或勾选后批量提前、顺延。已录实绩及完工、作废订单的日期保持不变。</p>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <button disabled={busy} onClick={() => setSelected(plans.filter(p => !locked(p)).map(p => p.id))}>全选可调整计划</button>
        <label>从 <input disabled={busy} className={input} type="date" value={from} onChange={e => setFrom(e.target.value)} /> 起</label>
        <label>调整天数 <input disabled={busy} className={input + " w-24"} type="number" value={days} onChange={e => setDays(Number(e.target.value))} /></label>
        <button disabled={busy} className={input} onClick={shift}>应用到勾选计划</button><span className="text-xs text-text-secondary">正数顺延，负数提前</span>
      </div>
      <div className="max-h-96 overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr><th>选择</th><th>部位</th><th>工序</th><th>计划数</th><th>原日期</th><th>新日期</th></tr></thead><tbody>{plans.map(p => <tr key={p.id} className="border-t border-app-border-light text-center">
        <td><input aria-label={`选择 ${p.partName} 第${p.stepNo}道计划`} type="checkbox" disabled={busy || locked(p)} checked={selected.includes(p.id)} onChange={e => setSelected(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} /></td>
        <td className="py-2">{p.partName}</td><td>{p.stepNo} · {p.craft}</td><td>{p.plannedQty.toLocaleString("zh-CN")}</td><td>{dateOf(p.planDate)}</td>
        <td>{locked(p) ? "不可调整，保持原日期" : <input aria-label={`${p.partName} 第${p.stepNo}道新日期`} disabled={busy} className={input} type="date" value={dates[p.id] ?? ""} onChange={e => setDates(current => ({ ...current, [p.id]: e.target.value }))} />}</td>
      </tr>)}</tbody></table></div>
      {!plans.length && <p className="text-sm text-text-secondary py-4">该订单暂无可调整的排期。</p>}
      <div className="flex flex-wrap gap-3 mt-4"><input aria-label="批量调整原因" disabled={busy} className={input + " flex-1 min-w-0"} placeholder="调整原因（可选，如停机、缺料）" value={reason} onChange={e => setReason(e.target.value)} /><button disabled={busy || !changes.length || changes.some(c => !isPlanDate(c.newDate))} className="bg-mint-700 text-white rounded-btn px-4 py-2 text-sm disabled:opacity-50" onClick={save}>{busy ? "保存中…" : `保存 ${changes.length} 条日期调整`}</button></div>
    </>}
  </div>;
}
