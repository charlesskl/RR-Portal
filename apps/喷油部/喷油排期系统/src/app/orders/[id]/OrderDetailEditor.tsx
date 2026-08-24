"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUS_META } from "@/lib/orderStatus";
import { apiFetch } from "@/lib/apiFetch";

type PartQtyDto = { id: number; partName: string; sourcePartId: number | null; qty: number; partOrder: number };
type ProductPartDto = { id: number; partName: string; unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number };
type OrderProductDto = { id: number; productNo: string; parts: ProductPartDto[] };
type ProcessRow = { partQtyId: number; startDate: string; craft: string; dailyTarget: number };
type ActualsDay = { date: string; productionQty: number; inboundQty: number };
type ActualsSummary = { orderId: number; productionQty: number; inboundQty: number; days: ActualsDay[] };
export type OrderDetailDto = {
  id: number; externalOrderNo: string; productId: number | null; orderDate: string; deliveryDate: string | null;
  status: string; isMA: boolean; isUrgent: boolean; remark: string | null; createdBy: string;
  product: OrderProductDto | null; partQtys: PartQtyDto[]; qtyEditable: boolean;
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (value: string | null) => { if (!value) return ""; const d = new Date(value); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export default function OrderDetailEditor({ order, isAdmin }: { order: OrderDetailDto; isAdmin: boolean }) {
  const router = useRouter();
  const product = order.product!;
  const [orderDate, setOrderDate] = useState(ymd(order.orderDate));
  const [deliveryDate, setDeliveryDate] = useState(ymd(order.deliveryDate));
  const [remark, setRemark] = useState(order.remark ?? "");
  const [isMA, setIsMA] = useState(order.isMA);
  const [isUrgent, setIsUrgent] = useState(order.isUrgent);
  const [qtys, setQtys] = useState<Record<number, number>>(() => Object.fromEntries(order.partQtys.map(q => [q.id, q.qty])));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [processRows, setProcessRows] = useState<ProcessRow[]>(() => order.partQtys
    .filter(part => part.qty > 0)
    .map(part => ({ partQtyId: part.id, startDate: "", craft: "手喷", dailyTarget: 0 })));
  const [scheduling, setScheduling] = useState(false);
  const [actualsSummary, setActualsSummary] = useState<ActualsSummary | null>(null);
  const [revokeScope, setRevokeScope] = useState<"day" | "all">("day");
  const [revokeDate, setRevokeDate] = useState("");
  const [revoking, setRevoking] = useState(false);
  const canUnschedule = order.status === "scheduled" || order.status === "in_production";

  async function save() {
    setLoading(true); setError("");
    const partQtys = order.qtyEditable ? order.partQtys.map(q => ({ id: q.id, qty: qtys[q.id] ?? q.qty })) : undefined;
    const res = await apiFetch(`/api/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderDate: orderDate || undefined, deliveryDate: deliveryDate || null, remark, isMA, isUrgent, partQtys }) });
    if (res.ok) router.refresh(); else { const body = await res.json().catch(() => ({})); setError(body.error || "保存失败"); }
    setLoading(false);
  }
  async function unschedule() {
    if (!confirm(`确认撤销订单 ${order.externalOrderNo} 的全部排期？`)) return;
    const res = await apiFetch(`/api/schedule/orders/${order.id}/unschedule`, { method: "POST" });
    if (res.ok) router.refresh(); else { const body = await res.json().catch(() => ({})); setError(body.error || "撤销排期失败"); }
  }
  async function openRevokeActuals() {
    setError("");
    const res = await apiFetch(`/api/orders/${order.id}/actuals-summary`, { cache: "no-store" });
    if (!res.ok) { const body = await res.json().catch(() => ({})); setError(body.error || "读取实绩失败"); return; }
    const summary = await res.json() as ActualsSummary;
    if (summary.days.length === 0) { setError("该订单没有可撤销的实绩"); return; }
    setActualsSummary(summary);
    setRevokeScope("day");
    setRevokeDate(summary.days[0].date);
  }
  async function revokeActuals() {
    if (!actualsSummary || (revokeScope === "day" && !revokeDate)) return;
    setRevoking(true); setError("");
    const res = await apiFetch(`/api/orders/${order.id}/revoke-actuals`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: revokeScope, date: revokeScope === "day" ? revokeDate : null }),
    });
    if (res.ok) { setActualsSummary(null); router.refresh(); }
    else { const body = await res.json().catch(() => ({})); setError(body.error || "撤销实绩失败"); }
    setRevoking(false);
  }
  async function createProcessSchedule() {
    setScheduling(true); setError("");
    const activeParts = order.partQtys.filter(part => (qtys[part.id] ?? part.qty) > 0);
    if (processRows.some(row => !row.startDate || !row.craft || row.dailyTarget <= 0)) {
      setError("每一行工序都必须完整填写开始日期、工序和每日目标数"); setScheduling(false); return;
    }
    if (activeParts.some(part => !processRows.some(row => row.partQtyId === part.id))) {
      setError("每个有数量的部位至少需要填写一道工序"); setScheduling(false); return;
    }
    const rows = processRows;
    const partQtys = order.partQtys.map(part => ({ id: part.id, qty: qtys[part.id] ?? part.qty }));
    const res = await apiFetch(`/api/orders/${order.id}/process-schedule`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, partQtys }),
    });
    if (res.ok) { router.refresh(); router.push(`/schedule?orderId=${order.id}&orderNo=${encodeURIComponent(order.externalOrderNo)}`); }
    else { const body = await res.json().catch(() => ({})); setError(body.error || "生成生产计划失败"); }
    setScheduling(false);
  }
  const updateProcessRow = (index: number, patch: Partial<ProcessRow>) => setProcessRows(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const addProcessRow = (partQtyId: number) => setProcessRows(rows => [...rows, { partQtyId, startDate: "", craft: "手喷", dailyTarget: 0 }]);

  return <div className="max-w-6xl">
    <div className="flex justify-between items-center mb-6">
      <h1 className="text-2xl font-bold text-text border-l-4 border-mint-400 pl-3">📋 订单 {order.externalOrderNo}</h1>
      <div className="flex items-center gap-3">{isAdmin && <button onClick={openRevokeActuals} className="text-amber-700 border border-amber-400 rounded-btn px-3 py-1 text-sm">撤销实绩</button>}{canUnschedule && <button onClick={unschedule} className="text-rose border border-rose/40 rounded-btn px-3 py-1 text-sm">撤销排期</button>}<span className={`px-3 py-1 rounded-full text-sm ${STATUS_META[order.status]?.cls ?? "bg-gray-100"}`}>{STATUS_META[order.status]?.text ?? order.status}</span></div>
    </div>
    <div className="bg-white p-5 rounded-card border border-app-border mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
      <Field label="款号（不可修改）"><div className="font-mono py-2">{product.productNo}</div></Field>
      <Field label="下单日期"><input className={input} type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} /></Field>
      <Field label="交货日期"><input className={input} type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} /></Field>
      <div className="md:col-span-2"><Field label="备注"><input className={input} value={remark} onChange={e => setRemark(e.target.value)} /></Field></div>
      <div className="flex flex-col justify-end gap-2"><label><input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} /> 急单</label><label><input type="checkbox" checked={isMA} onChange={e => setIsMA(e.target.checked)} /> MA 单</label></div>
    </div>
    {!order.qtyEditable && <p className="text-xs text-text-secondary mb-2">订单已有排期或已进入生产，数量已锁定。</p>}
    <div className="bg-white rounded-card border border-app-border overflow-hidden mb-3"><table className="w-full text-sm"><thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr><th className="px-4 py-2 text-left">部位</th><th className="px-4 py-2 text-right">数量</th></tr></thead><tbody>{order.partQtys.map((q, index) => <tr key={q.id} className={index % 2 ? "bg-[#fafdfb]" : ""}><td className="px-4 py-2">{q.partName}</td><td className="px-4 py-2 text-right">{order.qtyEditable ? <input type="number" min="0" className="w-32 border border-app-border rounded-btn px-2 py-1 text-right" value={qtys[q.id] ?? q.qty} onChange={e => setQtys(current => ({ ...current, [q.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} /> : (qtys[q.id] ?? q.qty).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
    <div className="text-right text-sm mb-4">订单总数 <b className="text-mint-700">{Math.max(0, ...order.partQtys.map(q => qtys[q.id] ?? q.qty)).toLocaleString("zh-CN")}</b></div>
    {(order.status === "draft" || order.status === "received") && <div className="bg-white rounded-card border border-app-border p-5 mb-4">
      <div className="mb-4"><h2 className="font-semibold text-text">工序排期</h2><p className="text-xs text-text-secondary mt-1">按部位分别填写；各工序独立计算并可同时进行。保存后同时更新部位级核价表和生产计划。</p></div>
      <table className="w-full text-sm"><thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr><th className="px-3 py-2 text-left">部位</th><th className="px-3 py-2 text-left">开始日期</th><th className="px-3 py-2 text-left">工序/拉别</th><th className="px-3 py-2 text-right">每日目标数</th><th className="px-3 py-2 text-center">预计生产天数</th><th className="px-3 py-2"></th></tr></thead><tbody>{processRows.map((row, index) => {
        const part = order.partQtys.find(item => item.id === row.partQtyId)!;
        const partRowCount = processRows.filter(item => item.partQtyId === row.partQtyId).length;
        return <tr key={`${row.partQtyId}-${index}`}>
        <td className="px-3 py-2 font-medium">{part.partName}</td>
        <td className="px-2 py-2"><input className={input} type="date" value={row.startDate} onChange={e => updateProcessRow(index, { startDate: e.target.value })} /></td>
        <td className="px-2 py-2"><select className={input} value={row.craft} onChange={e => updateProcessRow(index, { craft: e.target.value })}><option>手喷</option><option>自动喷</option><option>移印</option><option>UV</option></select></td>
        <td className="px-2 py-2"><input className={`${input} text-right`} type="number" min="1" step="1" value={row.dailyTarget || ""} onChange={e => updateProcessRow(index, { dailyTarget: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></td>
        <td className="px-3 py-2 text-center tabular-nums">{row.dailyTarget > 0 ? `${Math.ceil((qtys[part.id] ?? part.qty) / row.dailyTarget)}天` : "—"}</td>
        <td className="px-2 py-2 text-right whitespace-nowrap"><button type="button" className="text-mint-700 mr-3" onClick={() => addProcessRow(row.partQtyId)}>＋工序</button><button type="button" className="text-rose disabled:opacity-40" disabled={partRowCount === 1} onClick={() => setProcessRows(rows => rows.filter((_, i) => i !== index))}>删除</button></td>
      </tr>; })}</tbody></table>
      <div className="flex justify-end mt-4"><button type="button" disabled={scheduling} onClick={createProcessSchedule} className="bg-mint-400 hover:bg-mint-700 text-white px-5 py-2 rounded-btn text-sm disabled:opacity-60">{scheduling ? "生成中…" : "保存并生成生产计划"}</button></div>
    </div>}
    {error && <p className="text-rose text-sm text-right mb-2">{error}</p>}
    <div className="flex justify-between"><Link href="/orders" className="text-sky text-sm hover:underline">← 返回订单列表</Link><button disabled={loading} onClick={save} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm disabled:opacity-60">{loading ? "保存中..." : "保存"}</button></div>
    {actualsSummary && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => !revoking && setActualsSummary(null)}>
      <div className="w-full max-w-lg rounded-card bg-white border border-rose/30 shadow-xl p-5" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="撤销实绩预警">
        <h2 className="text-lg font-bold text-rose mb-3">⚠ 撤销实绩预警</h2>
        <p className="text-sm text-text leading-6">订单 <b>{order.externalOrderNo}</b> 已录入实绩：生产数 <b>{actualsSummary.productionQty.toLocaleString("zh-CN")}</b>，实际入库数 <b>{actualsSummary.inboundQty.toLocaleString("zh-CN")}</b>。撤销后将同步删除相应库存，是否确认？</p>
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={revokeScope === "day"} onChange={() => setRevokeScope("day")} />撤销当天实绩</label>
          {revokeScope === "day" && <select className={input} value={revokeDate} onChange={e => setRevokeDate(e.target.value)}>{actualsSummary.days.map(day => <option key={day.date} value={day.date}>{day.date}（生产 {day.productionQty.toLocaleString("zh-CN")}，入库 {day.inboundQty.toLocaleString("zh-CN")}）</option>)}</select>}
          <label className="flex items-center gap-2"><input type="radio" checked={revokeScope === "all"} onChange={() => setRevokeScope("all")} />撤销全部实绩</label>
        </div>
        <div className="mt-5 flex justify-end gap-3"><button disabled={revoking} onClick={() => setActualsSummary(null)} className="border border-app-border rounded-btn px-4 py-2 text-sm">取消</button><button disabled={revoking} onClick={revokeActuals} className="bg-rose text-white rounded-btn px-4 py-2 text-sm disabled:opacity-60">{revoking ? "撤销中…" : "确认撤销实绩并删除库存"}</button></div>
      </div>
    </div>}
  </div>;
}
const input = "w-full border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><div className="text-xs text-text-secondary mb-1">{label}</div>{children}</div>; }
