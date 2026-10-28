"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUS_META } from "@/lib/orderStatus";
import { invalidateClientCache } from "@/lib/clientCache";
import { apiFetch } from "@/lib/apiFetch";

type PartQtyDto = { id: number; partName: string; sourcePartId: number | null; qty: number; partOrder: number };
type ProductPartDto = { id: number; partName: string; craft: string; partGroupId: number; unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number; dailyCapacity: number };
type OrderProductDto = { id: number; productNo: string; parts: ProductPartDto[] };
type ProductionLineDto = { id: number; name: string; craftType: string; isActive: boolean };
type ProcessRow = { partQtyId: number; startDate: string; lineId: number | ""; laborPrice: number; dailyTarget: number };
type ActualsDay = { date: string; productionQty: number; inboundQty: number };
type ActualsSummary = { orderId: number; productionQty: number; inboundQty: number; days: ActualsDay[] };
type ScheduleBalance = { partName: string; stepNo: number; craft: string; demandQty: number; recordedQty: number; pendingQty: number; supplementQty: number; reduceQty: number; overproducedQty: number };
export type OrderDetailDto = {
  id: number; externalOrderNo: string; productId: number | null; orderDate: string; deliveryDate: string | null;
  status: string; isMA: boolean; isUrgent: boolean; remark: string | null; createdBy: string;
  product: OrderProductDto | null; partQtys: PartQtyDto[]; qtyEditable: boolean;
  products?: OrderProductDto[];
  scheduleBalances?: ScheduleBalance[];
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (value: string | null) => { if (!value) return ""; const d = new Date(value); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export default function OrderDetailEditor({ order: initialOrder, lines, isAdmin, canEdit, canAdjustDates = false }: { order: OrderDetailDto; lines: ProductionLineDto[]; isAdmin: boolean; canEdit: boolean; canAdjustDates?: boolean }) {
  const [order, setOrder] = useState(initialOrder);
  const router = useRouter();
  const products = order.products?.length ? order.products : (order.product ? [order.product] : []);
  const product = order.product!;
  const defaultsFor = (partQtyId: number, craft: string) => {
    const orderedPart = order.partQtys.find(part => part.id === partQtyId);
    const partProduct = products.find(item => item.parts.some(part => part.id === orderedPart?.sourcePartId)) ?? product;
    const anchor = partProduct.parts.find(part => part.id === orderedPart?.sourcePartId);
    if (!anchor) return { laborPrice: 0, dailyTarget: 0 };
    const samePart = partProduct.parts.find(part =>
      part.partName.trim() === anchor.partName.trim() && part.craft.trim() === craft);
    const rule = samePart ?? (anchor.craft.trim() === craft || !anchor.craft.trim() ? anchor : undefined);
    return { laborPrice: rule?.laborPrice ?? 0, dailyTarget: rule?.dailyCapacity ?? 0 };
  };
  const [orderDate, setOrderDate] = useState(ymd(order.orderDate));
  const [deliveryDate, setDeliveryDate] = useState(ymd(order.deliveryDate));
  const [remark, setRemark] = useState(order.remark ?? "");
  const [isMA, setIsMA] = useState(order.isMA);
  const [isUrgent, setIsUrgent] = useState(order.isUrgent);
  const [qtys, setQtys] = useState<Record<number, number>>(() => Object.fromEntries(order.partQtys.map(q => [q.id, q.qty])));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [autoAdjustSchedule, setAutoAdjustSchedule] = useState(true);
  useEffect(() => {
    setOrder(initialOrder);
    setQtys(Object.fromEntries(initialOrder.partQtys.map(part => [part.id, part.qty])));
  }, [initialOrder]);
  const [processRows, setProcessRows] = useState<ProcessRow[]>(() => order.partQtys
    .map(part => ({ partQtyId: part.id, startDate: "", lineId: lines[0]?.id ?? "", ...defaultsFor(part.id, lines[0]?.craftType ?? "") })));
  const [scheduling, setScheduling] = useState(false);
  const [actualsSummary, setActualsSummary] = useState<ActualsSummary | null>(null);
  const [revokeScope, setRevokeScope] = useState<"day" | "all">("day");
  const [revokeDate, setRevokeDate] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [unscheduling, setUnscheduling] = useState(false);
  const busy = loading || scheduling || revoking || unscheduling;
  const canUnschedule = order.status === "scheduled" || order.status === "in_production";

  function validQuantities() {
    const values = order.partQtys.map(part => qtys[part.id] ?? part.qty);
    if (values.some(qty => !Number.isInteger(qty) || qty < 0 || qty > 2147483647)) {
      setError("部位数量必须是 0 至 2,147,483,647 之间的整数"); return false;
    }
    if (values.every(qty => qty === 0)) { setError("订单至少需要一个数量大于 0 的部位"); return false; }
    return true;
  }
  async function save() {
    if (!canEdit || busy || (order.qtyEditable && !validQuantities())) return;
    setLoading(true); setError(""); setSuccess("");
    let committed = false;
    try {
      const changed = order.partQtys.filter(part => (qtys[part.id] ?? part.qty) !== part.qty);
      const partQtys = order.qtyEditable && changed.length ? changed.map(part => ({ id: part.id, qty: qtys[part.id] })) : undefined;
      const res = await apiFetch(`/api/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderDate: orderDate || undefined, deliveryDate, remark, isMA, isUrgent, partQtys, autoAdjustSchedule: autoAdjustSchedule && order.qtyEditable }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || "保存失败"); }
      committed = true;
      const result = await res.json().catch(() => ({}));
      for (const prefix of ["/api/orders", "/api/schedule", "/api/recording", "/api/dashboard"]) invalidateClientCache(prefix);
      const detail = await apiFetch(`/api/orders/${order.id}`, { cache: "no-store" });
      if (!detail.ok) throw new Error("详情刷新失败");
      const saved = await detail.json() as OrderDetailDto;
      const validProduct = (item: OrderProductDto | null) => !!item && Number.isInteger(item.id) && typeof item.productNo === "string"
        && Array.isArray(item.parts) && item.parts.every(part => part && Number.isInteger(part.id)
          && typeof part.partName === "string" && typeof part.craft === "string"
          && [part.unitCost, part.laborPrice, part.paintCost, part.quotedPrice, part.dailyCapacity].every(Number.isFinite));
      if (saved.id !== order.id || !validProduct(saved.product)
        || !Array.isArray(saved.partQtys) || saved.partQtys.length === 0
        || saved.partQtys.some(part => !Number.isInteger(part.id) || typeof part.partName !== "string" || !Number.isInteger(part.qty) || part.qty < 0 || part.qty > 2147483647)
        || typeof saved.externalOrderNo !== "string" || typeof saved.status !== "string"
        || typeof saved.qtyEditable !== "boolean" || typeof saved.isMA !== "boolean" || typeof saved.isUrgent !== "boolean"
        || (saved.remark !== null && typeof saved.remark !== "string")
        || typeof saved.orderDate !== "string" || !Number.isFinite(Date.parse(saved.orderDate))
        || (saved.deliveryDate !== null && (typeof saved.deliveryDate !== "string" || !Number.isFinite(Date.parse(saved.deliveryDate))))
        || (saved.products !== undefined && (!Array.isArray(saved.products) || saved.products.some(item => !validProduct(item))))
        || (saved.scheduleBalances !== undefined && (!Array.isArray(saved.scheduleBalances) || saved.scheduleBalances.some(row =>
          typeof row.partName !== "string" || typeof row.craft !== "string" || ![row.stepNo, row.demandQty, row.recordedQty, row.pendingQty, row.supplementQty, row.reduceQty, row.overproducedQty].every(Number.isFinite))))) {
        throw new Error("订单详情格式无效");
      }
      // 完整验证并构造回读状态后再更新，异常响应仍保留当前页面和输入。
      const savedQtys = Object.fromEntries(saved.partQtys.map(part => [part.id, part.qty]));
      setOrder(saved); setQtys(savedQtys);
      setOrderDate(ymd(saved.orderDate)); setDeliveryDate(ymd(saved.deliveryDate));
      setRemark(saved.remark ?? ""); setIsMA(saved.isMA); setIsUrgent(saved.isUrgent);
      const adjustment = result.scheduleAdjustment;
      const adjustmentText = adjustment && Number.isFinite(adjustment.addedQty) && Number.isFinite(adjustment.reducedQty)
        ? `已自动补排 ${adjustment.addedQty.toLocaleString("zh-CN")} 件、减排 ${adjustment.reducedQty.toLocaleString("zh-CN")} 件（按工序合计）。`
        : "";
      const materialText = adjustment?.materialReflow ? "已按登记的来料情况重排，未到料数量保持待料。" : "";
      const warnings = Array.isArray(adjustment?.warnings) ? adjustment.warnings.filter((item: unknown) => typeof item === "string").join("；") : "";
      setSuccess(`已保存，订单统计和状态已更新。${adjustmentText}${materialText}历史实绩和库存已保留。${warnings ? `未自动处理：${warnings}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "请检查网络后重试";
      setError(committed ? `订单已保存，但页面更新失败，请刷新页面查看（${message}）` : message);
    } finally { setLoading(false); }
  }
  async function unschedule() {
    if (busy || !confirm(`确认撤销订单 ${order.externalOrderNo} 的全部排期？`)) return;
    setUnscheduling(true); setError("");
    try {
      const res = await apiFetch(`/api/schedule/orders/${order.id}/unschedule`, { method: "POST" });
      if (res.ok) router.refresh(); else { const body = await res.json().catch(() => ({})); setError(body.error || "撤销排期失败"); }
    } catch { setError("撤销排期失败，请检查网络后重试"); }
    finally { setUnscheduling(false); }
  }
  async function openRevokeActuals() {
    if (busy) return;
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
    if (busy || !actualsSummary || (revokeScope === "day" && !revokeDate)) return;
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
    if (!canEdit || busy || !validQuantities()) return;
    setScheduling(true); setError("");
    const activeParts = order.partQtys.filter(part => (qtys[part.id] ?? part.qty) > 0);
    const activeIds = new Set(activeParts.map(part => part.id));
    const rows = processRows.filter(row => activeIds.has(row.partQtyId));
    if (rows.some(row => !row.startDate || !row.lineId || row.dailyTarget <= 0)) {
      setError("每一行都必须完整填写开始日期、拉别和每日目标数"); setScheduling(false); return;
    }
    if (activeParts.some(part => !rows.some(row => row.partQtyId === part.id))) {
      setError("每个有数量的部位至少需要填写一道工序"); setScheduling(false); return;
    }
    const partQtys = order.partQtys.map(part => ({ id: part.id, qty: qtys[part.id] ?? part.qty }));
    const res = await apiFetch(`/api/orders/${order.id}/process-schedule`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, partQtys }),
    });
    if (res.ok) { router.refresh(); router.push(`/schedule?orderId=${order.id}&orderNo=${encodeURIComponent(order.externalOrderNo)}`); }
    else { const body = await res.json().catch(() => ({})); setError(body.error || "生成生产计划失败"); }
    setScheduling(false);
  }
  const updateProcessRow = (index: number, patch: Partial<ProcessRow>) => setProcessRows(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const addProcessRow = (partQtyId: number) => setProcessRows(rows => {
    const lastSamePartIndex = rows.reduce((last, row, index) => row.partQtyId === partQtyId ? index : last, -1);
    const next = [...rows];
    next.splice(lastSamePartIndex + 1, 0, {
      partQtyId, startDate: "", lineId: lines[0]?.id ?? "", ...defaultsFor(partQtyId, lines[0]?.craftType ?? ""),
    });
    return next;
  });

  const demandByPart = new Map<string, number>();
  for (const part of order.partQtys) {
    const qty = qtys[part.id] ?? part.qty;
    demandByPart.set(part.partName, (demandByPart.get(part.partName) ?? 0) + (Number.isFinite(qty) ? qty : 0));
  }
  return <div className="max-w-6xl">
    <div className="flex justify-between items-center mb-6">
      <h1 className="text-2xl font-bold text-text border-l-4 border-mint-400 pl-3">📋 订单 {order.externalOrderNo}</h1>
      <div className="flex items-center gap-3">{isAdmin && <button disabled={busy} onClick={openRevokeActuals} className="text-amber-700 border border-amber-400 rounded-btn px-3 py-1 text-sm">撤销实绩</button>}{canUnschedule && canAdjustDates && <Link href={`/schedule?orderId=${order.id}&orderNo=${encodeURIComponent(order.externalOrderNo)}`} className="text-sky border border-sky/40 rounded-btn px-3 py-1 text-sm">调整排期日期</Link>}{canUnschedule && <button disabled={busy} onClick={unschedule} className="text-rose border border-rose/40 rounded-btn px-3 py-1 text-sm">撤销排期</button>}<span className={`px-3 py-1 rounded-full text-sm ${STATUS_META[order.status]?.cls ?? "bg-gray-100"}`}>{STATUS_META[order.status]?.text ?? order.status}</span></div>
    </div>
    <fieldset disabled={busy || !canEdit} className="bg-white p-5 rounded-card border border-app-border mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
      <Field label="款号（不可修改）"><div className="font-mono py-2">{products.map(item => item.productNo).join("、") || product.productNo}</div></Field>
      <Field label="下单日期"><input className={input} type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} /></Field>
      <Field label="交货日期"><input className={input} type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} /></Field>
      <div className="md:col-span-2"><Field label="备注"><input className={input} value={remark} onChange={e => setRemark(e.target.value)} /></Field></div>
      <div className="flex flex-col justify-end gap-2"><label><input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} /> 急单</label><label><input type="checkbox" checked={isMA} onChange={e => setIsMA(e.target.checked)} /> MA 单</label></div>
    </fieldset>
    <p className="text-xs text-text-secondary mb-2">{order.qtyEditable && canEdit
      ? "各部位数量可单独修改，其他部位不变。保存后更新统计和状态；勾选自动调整时同步补排或减排，历史实绩和库存保留。"
      : "当前订单或账号不允许修改部位数量。"}</p>
    <div className="bg-white rounded-card border border-app-border overflow-hidden mb-3"><table className="w-full text-sm"><thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr><th className="px-4 py-2 text-left">部位</th><th className="px-4 py-2 text-right">数量</th></tr></thead><tbody>{order.partQtys.map((q, index) => <tr key={q.id} className={index % 2 ? "bg-[#fafdfb]" : ""}><td className="px-4 py-2">{q.partName}</td><td className="px-4 py-2 text-right">{order.qtyEditable && canEdit ? <input aria-label={`${q.partName} 数量`} disabled={busy} type="number" min="0" max="2147483647" step="1" className="w-32 border border-app-border rounded-btn px-2 py-1 text-right" value={Number.isNaN(qtys[q.id]) ? "" : (qtys[q.id] ?? q.qty)} onChange={e => { setQtys(current => ({ ...current, [q.id]: e.target.value === "" ? NaN : e.target.valueAsNumber })); setSuccess(""); }} /> : (qtys[q.id] ?? q.qty).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
    <div className="text-right text-sm mb-4">订单总数 <b className="text-mint-700">{Math.max(0, ...Array.from(demandByPart.values())).toLocaleString("zh-CN")}</b></div>
    {canEdit && order.qtyEditable && <label className="flex items-center gap-2 text-sm text-text mb-3">
      <input type="checkbox" checked={autoAdjustSchedule} disabled={busy} onChange={event => setAutoAdjustSchedule(event.target.checked)} />
      保存时自动补排/减排（沿用原工序和拉别，仅调整未报工计划）
    </label>}
    <ScheduleBalanceTable balances={order.scheduleBalances ?? []} />
    {canEdit && (order.status === "draft" || order.status === "received") && <div className="bg-white rounded-card border border-app-border p-5 mb-4">
      <div className="mb-4"><h2 className="font-semibold text-text">工序排期</h2><p className="text-xs text-text-secondary mt-1">按部位分别填写；各工序独立计算并可同时进行。人工和每日目标数自动带入核价表中同部位、同工序的上次保存值，可手动修改。保存后同时更新部位级核价表和生产计划。</p></div>
      <fieldset disabled={busy}><table className="w-full text-sm"><thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr><th className="px-3 py-2 text-left">部位</th><th className="px-3 py-2 text-center">开始日期</th><th className="px-3 py-2 text-center">拉别</th><th className="px-3 py-2 text-center">人工</th><th className="px-3 py-2 text-center">每日目标数</th><th className="px-3 py-2 text-center">预计生产天数</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{processRows.map((row, index) => {
        const part = order.partQtys.find(item => item.id === row.partQtyId);
        if (!part || (qtys[part.id] ?? part.qty) <= 0) return null;
        const partRowCount = processRows.filter(item => item.partQtyId === row.partQtyId).length;
        return <tr key={`${row.partQtyId}-${index}`}>
        <td className="px-3 py-2 font-medium">{part.partName}</td>
        <td className="px-2 py-2 text-center"><input className={`${input} !w-52`} type="date" value={row.startDate} onChange={e => updateProcessRow(index, { startDate: e.target.value })} /></td>
        <td className="px-2 py-2 text-center"><select className={input} value={row.lineId} onChange={e => { const line = lines.find(item => item.id === Number(e.target.value)); const previousCraft = lines.find(item => item.id === row.lineId)?.craftType; updateProcessRow(index, { lineId: line?.id ?? "", ...(previousCraft === line?.craftType ? {} : defaultsFor(row.partQtyId, line?.craftType ?? "")) }); }}><option value="">请选择拉别</option>{lines.map(line => <option key={line.id} value={line.id}>{line.name}</option>)}</select></td>
        <td className="px-2 py-2 text-center"><input className={`${input} !w-40 text-right`} type="number" min="0" step="0.001" value={row.laborPrice} onChange={e => updateProcessRow(index, { laborPrice: Math.max(0, Number(e.target.value) || 0) })} /></td>
        <td className="px-2 py-2 text-center"><input className={`${input} !w-40 text-right`} type="number" min="1" step="1" value={row.dailyTarget || ""} onChange={e => updateProcessRow(index, { dailyTarget: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></td>
        <td className="px-3 py-2 text-center tabular-nums">{row.dailyTarget > 0 ? `${Math.ceil((qtys[part.id] ?? part.qty) / row.dailyTarget)}天` : "—"}</td>
        <td className="px-2 py-2 text-right whitespace-nowrap"><button type="button" className="text-mint-700 mr-3" onClick={() => addProcessRow(row.partQtyId)}>＋工序</button><button type="button" className="text-rose disabled:opacity-40" disabled={partRowCount === 1} onClick={() => setProcessRows(rows => rows.filter((_, i) => i !== index))}>删除</button></td>
      </tr>; })}</tbody></table></fieldset>
      <div className="flex justify-end mt-4"><button type="button" disabled={busy} onClick={createProcessSchedule} className="bg-mint-400 hover:bg-mint-700 text-white px-5 py-2 rounded-btn text-sm disabled:opacity-60">{scheduling ? "生成中…" : "保存并生成生产计划"}</button></div>
    </div>}
    {success && <p role="status" className="text-mint-700 text-sm mb-2">{success}</p>}
    {error && <p role="alert" aria-label="保存错误" className="text-rose text-sm text-right mb-2">{error}</p>}
    <div className="flex justify-between"><Link href="/orders" className="text-sky text-sm hover:underline">← 返回订单列表</Link><button disabled={busy || !canEdit} onClick={save} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm disabled:opacity-60">{loading ? "保存中..." : "保存"}</button></div>
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

function ScheduleBalanceTable({ balances }: { balances: ScheduleBalance[] }) {
  const actionable = balances.filter(row => row.supplementQty > 0 || row.reduceQty > 0 || row.overproducedQty > 0);
  return <section aria-label="排期调整提示" className="mb-5 rounded-card border border-app-border bg-white p-4">
    <h2 className="text-sm font-semibold text-text mb-2">排期调整提示（按已保存数量）</h2>
    <p className="text-xs text-text-secondary mb-3">按每道工序分别比较需求、已生产和未报工计划，不跨工序相加。勾选自动调整后，保存时按原日产量、工作日和可用产能补排，从末尾缩减未报工计划；缺少配置的部分仍列在下方。已超产数量保留原实绩及库存。</p>
    {actionable.length === 0 ? <p className="text-sm text-mint-700">当前无需补排或减排。</p> : <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
      <thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr>{["部位", "工序", "需求", "已生产", "未报工计划", "需补排", "需减排", "已超产"].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead>
      <tbody>{actionable.map(row => <tr key={`${row.partName}-${row.stepNo}`} className="border-b border-app-border-light">
        <td className="px-3 py-2">{row.partName}</td><td className="px-3 py-2">{row.stepNo > 0 ? `第${row.stepNo}道 ${row.craft}` : "未排期"}</td>
        {[row.demandQty, row.recordedQty, row.pendingQty, row.supplementQty, row.reduceQty, row.overproducedQty].map((qty, index) => <td key={index} className={`px-3 py-2 tabular-nums ${index >= 3 && qty > 0 ? "text-amber-700 font-semibold" : ""}`}>{qty.toLocaleString("zh-CN")}</td>)}
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
