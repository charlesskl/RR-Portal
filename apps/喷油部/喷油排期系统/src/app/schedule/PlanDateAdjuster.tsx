"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { invalidateClientCache } from "@/lib/clientCache";

type Plan = { id: number; planDate: string; partName: string; craft: string; stepNo: number; plannedQty: number; status: string; goodQty: number | null; inboundQty: number | null; reportedQty: number | null };
const dateOf = (value: string) => value.slice(0, 10);
const locked = (plan: Plan) => plan.status === "recorded" || plan.goodQty != null || plan.inboundQty != null || plan.reportedQty != null;
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
      const res = await fetch(`/api/plans?orderId=${orderId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("读取排期失败");
      const rows: Plan[] = await res.json();
      setPlans(rows); setDates(Object.fromEntries(rows.map(p => [p.id, dateOf(p.planDate)]))); setSelected([]); setOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "读取失败"); }
    finally { setBusy(false); }
  }
  function shift() {
    if (!Number.isInteger(days) || Math.abs(days) > 3650 || days === 0) { setError("请输入非零整数天数，范围为 -3650 至 3650"); return; }
    if (!selected.length) { setError("请先勾选要调整的计划"); return; }
    setError("");
    setDates(current => {
      const next = { ...current };
      for (const plan of plans.filter(p => selected.includes(p.id) && !locked(p) && (!from || dateOf(p.planDate) >= from))) {
        const d = new Date(`${current[plan.id]}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); next[plan.id] = d.toISOString().slice(0, 10);
      }
      return next;
    });
  }
  const changes = plans.filter(p => !locked(p) && dates[p.id] !== dateOf(p.planDate)).map(p => ({ id: p.id, originalDate: dateOf(p.planDate), newDate: dates[p.id] }));
  async function save() {
    if (!changes.length) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/plans/reschedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes, reason }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "调整失败");
      invalidateClientCache("/api/orders"); invalidateClientCache("/api/schedule");
      setOpen(false); onSaved(); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "调整失败"); }
    finally { setBusy(false); }
  }
  return <div className="bg-white border border-app-border rounded-card p-4 mb-4">
    <button disabled={busy} onClick={() => open ? setOpen(false) : load()} className="text-sky text-sm font-semibold">{open ? "收起日期调整" : "调整排期日期"}</button>
    {error && <p className="text-rose text-sm mt-2">{error}</p>}
    {open && <>
      <p className="text-xs text-text-secondary my-3">可直接修改单条日期，或勾选后批量提前、顺延。已录实绩的日期保持不变。</p>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <button disabled={busy} onClick={() => setSelected(plans.filter(p => !locked(p)).map(p => p.id))}>全选未录实绩</button>
        <label>从 <input disabled={busy} className={input} type="date" value={from} onChange={e => setFrom(e.target.value)} /> 起</label>
        <label>调整天数 <input disabled={busy} className={input + " w-24"} type="number" value={days} onChange={e => setDays(Number(e.target.value))} /></label>
        <button disabled={busy} className={input} onClick={shift}>应用到勾选计划</button><span className="text-xs text-text-secondary">正数顺延，负数提前</span>
      </div>
      <div className="max-h-96 overflow-auto"><table className="w-full text-sm"><thead><tr><th>选择</th><th>部位</th><th>工序</th><th>计划数</th><th>原日期</th><th>新日期</th></tr></thead><tbody>{plans.map(p => <tr key={p.id} className="border-t border-app-border-light text-center">
        <td><input type="checkbox" disabled={busy || locked(p)} checked={selected.includes(p.id)} onChange={e => setSelected(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} /></td>
        <td className="py-2">{p.partName}</td><td>{p.stepNo} · {p.craft}</td><td>{p.plannedQty.toLocaleString("zh-CN")}</td><td>{dateOf(p.planDate)}</td>
        <td>{locked(p) ? "已录实绩，保持原日期" : <input disabled={busy} className={input} type="date" value={dates[p.id] ?? ""} onChange={e => setDates(current => ({ ...current, [p.id]: e.target.value }))} />}</td>
      </tr>)}</tbody></table></div>
      <div className="flex gap-3 mt-4"><input disabled={busy} className={input + " flex-1"} placeholder="调整原因（可选，如停机、缺料）" value={reason} onChange={e => setReason(e.target.value)} /><button disabled={busy || !changes.length || changes.some(c => !c.newDate)} className="bg-mint-400 text-white rounded-btn px-4 py-2 text-sm disabled:opacity-50" onClick={save}>{busy ? "保存中…" : `保存 ${changes.length} 条日期调整`}</button></div>
    </>}
  </div>;
}
