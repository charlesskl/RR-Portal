// src/app/orders/OrdersTable.tsx
// 订单总览主体（客户端）：正常单/回收站切换 + 即时筛选 + 表格 + 作废/恢复。
// 数据由 page.tsx SSR 一次性传入；筛选在浏览器端即时进行（filterOrders）。
"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { filterOrders, type OrderRow, type OrderFilter } from "@/lib/orderFilter";
import { STATUS_META, ACTIVE_STATUSES } from "@/lib/orderStatus";
import DatePicker from "./DatePicker";
import CompletePendingDialog from "./CompletePendingDialog";

const EMPTY: OrderFilter = { view: "normal", keyword: "", status: "", ma: "", risk: "",
  orderFrom: "", orderTo: "", deliveryFrom: "", deliveryTo: "" };

export default function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const router = useRouter();
  const [f, setF] = useState<OrderFilter>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState<{ id: number; externalOrderNo: string } | null>(null);
  const set = (patch: Partial<OrderFilter>) => setF((cur) => ({ ...cur, ...patch }));

  const normalCount = useMemo(() => orders.filter((o) => o.status !== "archived" && !o.pendingProduct).length, [orders]);
  const pendingCount = useMemo(() => orders.filter((o) => o.status !== "archived" && o.pendingProduct).length, [orders]);
  const recycleCount = useMemo(() => orders.filter((o) => o.status === "archived").length, [orders]);
  const stats = useMemo(() => buildStats(orders), [orders]);
  const rows = useMemo(() => filterOrders(orders, f), [orders, f]);

  async function archive(id: number, no: string) {
    if (!confirm(`确认作废订单「${no}」？作废后可在回收站恢复。`)) return;
    setBusy(true);
    const res = await apiFetch(`/api/orders/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh(); else alert("作废失败，请重试");
  }
  async function restore(id: number, no: string) {
    if (!confirm(`确认恢复订单「${no}」？将回到「已接单」状态。`)) return;
    setBusy(true);
    const res = await apiFetch(`/api/orders/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "received" }),
    });
    setBusy(false);
    if (res.ok) router.refresh(); else alert("恢复失败，请重试");
  }

  const tab = (v: OrderFilter["view"], label: string, cnt: number) => (
    <div onClick={() => set({ view: v })}
      className={`px-4 py-2 text-sm cursor-pointer border-b-2 ${
        f.view === v ? "text-mint-700 border-mint-400 font-semibold" : "text-text-secondary border-transparent"}`}>
      {label} <span className="text-xs text-text-tertiary">({cnt})</span>
    </div>
  );

  return (
    <div className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* 标题行 */}
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">📋 订单总览</h1>
        <div className="flex gap-2.5">
          <Link href="/orders/import" className="bg-[#fbbf24] hover:brightness-105 text-white px-4 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(251,191,36,0.30)]">📥 导入订单</Link>
          <Link href="/orders/new" className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)]">+ 新建订单</Link>
        </div>
      </div>

      {/* 领导看板 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <MetricCard label="未完工订单" value={stats.active} tone="mint" sub={`总数 ${stats.total} 张`} />
        <MetricCard label="未排期" value={stats.unscheduled} tone={stats.unscheduled > 0 ? "blue" : "muted"} sub="需要进入周排/月排" />
        <MetricCard label="交期风险" value={stats.risk} tone={stats.risk > 0 ? "red" : "muted"} sub={`已超 ${stats.overdue} · 预计超 ${stats.late}`} />
        <MetricCard label="急单" value={stats.urgent} tone={stats.urgent > 0 ? "rose" : "muted"} sub={`7天内交货 ${stats.dueSoon} 张`} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <QuickFilter active={f.risk === ""} label="全部风险" onClick={() => set({ risk: "" })} />
        <QuickFilter active={f.risk === "overdue"} label={`已超交期 ${stats.overdue}`} onClick={() => set({ risk: "overdue" })} tone="red" />
        <QuickFilter active={f.risk === "late"} label={`预计超期 ${stats.late}`} onClick={() => set({ risk: "late" })} tone="amber" />
        <QuickFilter active={f.risk === "unscheduled"} label={`未排期 ${stats.unscheduled}`} onClick={() => set({ risk: "unscheduled" })} tone="blue" />
        <QuickFilter active={f.risk === "urgent"} label={`急单 ${stats.urgent}`} onClick={() => set({ risk: "urgent" })} tone="rose" />
      </div>

      {/* 正常单 / 回收站 */}
      <div className="flex gap-1 border-b border-app-border-light mb-4">
        {tab("normal", "📋 正常单", normalCount)}
        {tab("pending", "🗂️ 待补产品", pendingCount)}
        {tab("recycle", "🗑 回收站", recycleCount)}
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-3 items-end bg-[#f7fbf9] border border-app-border-light rounded-card p-4 mb-4">
        <Fld label="🔍 关键词搜索">
          <input value={f.keyword} onChange={(e) => set({ keyword: e.target.value })}
            placeholder="外部订单号 / 款号"
            className="w-56 h-[34px] border border-app-border rounded-btn px-2 text-sm focus:outline-none focus:border-mint-400" />
        </Fld>
        {f.view === "normal" && (
          <Fld label="状态">
            <select value={f.status} onChange={(e) => set({ status: e.target.value })}
              className="h-[34px] border border-app-border rounded-btn px-2 text-sm bg-white">
              <option value="">全部状态</option>
              {ACTIVE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].text}</option>)}
            </select>
          </Fld>
        )}
        <Fld label="MA 标">
          <select value={f.ma} onChange={(e) => set({ ma: e.target.value as OrderFilter["ma"] })}
            className="h-[34px] border border-app-border rounded-btn px-2 text-sm bg-white">
            <option value="">全部</option>
            <option value="ma">仅 MA（非正式单）</option>
            <option value="formal">仅正式单</option>
          </select>
        </Fld>
        <Fld label="风险">
          <select value={f.risk} onChange={(e) => set({ risk: e.target.value as OrderFilter["risk"] })}
            className="h-[34px] border border-app-border rounded-btn px-2 text-sm bg-white">
            <option value="">全部</option>
            <option value="overdue">已超交期</option>
            <option value="late">预计超期</option>
            <option value="unscheduled">未排期</option>
            <option value="urgent">急单</option>
          </select>
        </Fld>
        <Fld label="下单日 范围">
          <div className="flex items-center gap-1.5">
            <DatePicker value={f.orderFrom ?? ""} onChange={(v) => set({ orderFrom: v })} placeholder="开始" />
            <span className="text-text-tertiary text-xs">~</span>
            <DatePicker value={f.orderTo ?? ""} onChange={(v) => set({ orderTo: v })} placeholder="结束" />
          </div>
        </Fld>
        <Fld label="交货日 范围">
          <div className="flex items-center gap-1.5">
            <DatePicker value={f.deliveryFrom ?? ""} onChange={(v) => set({ deliveryFrom: v })} placeholder="开始" />
            <span className="text-text-tertiary text-xs">~</span>
            <DatePicker value={f.deliveryTo ?? ""} onChange={(v) => set({ deliveryTo: v })} placeholder="结束" />
          </div>
        </Fld>
        <button onClick={() => set({ ...EMPTY, view: f.view })}
          className="h-[34px] bg-white border border-app-border text-text-secondary rounded-btn px-3.5 text-sm hover:border-text-tertiary">重置</button>
      </div>

      <p className="text-xs text-text-tertiary mb-2">共 {rows.length} 张{f.risk ? " · 已按风险筛选" : ""}</p>

      {/* 表格 */}
      <table className="w-full text-sm">
        <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
          <tr>
            <th className="px-3 py-3 text-left">外部订单号</th>
            <th className="px-3 py-3 text-left">款号</th>
            <th className="px-3 py-3 text-center">MA</th>
            <th className="px-3 py-3 text-left">下单日</th>
            <th className="px-3 py-3 text-left">交货日</th>
            <th className="px-3 py-3 text-right">整单总数</th>
            <th className="px-3 py-3 text-center">进度</th>
            <th className="px-3 py-3 text-left">预计出单日</th>
            <th className="px-3 py-3 text-center">状态</th>
            <th className="px-3 py-3 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="text-center text-text-tertiary py-8">
              {f.view === "recycle" ? "回收站是空的" : f.view === "pending" ? "没有待补产品的订单" : "没有符合条件的订单"}
            </td></tr>
          ) : rows.map((o, i) => {
            const st = STATUS_META[o.status] ?? STATUS_META.received;
            const rowClass = o.riskLevel === "overdue" ? "bg-[#fff1f2]" :
              o.riskLevel === "late" ? "bg-[#fff7ed]" :
              o.isUrgent ? "bg-[#fdf2f4]" : i % 2 ? "bg-[#fafdfb]" : "";
            return (
              <tr key={o.id} className={rowClass}>
                <td className="px-3 py-3 font-mono">
                  {o.externalOrderNo}
                  {o.isUrgent && <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#F4B7BE] text-[#C91D32] border border-[#E88EA0]">急</span>}
                </td>
                <td className="px-3 py-3 font-mono">{o.productNo}</td>
                <td className="px-3 py-3 text-center">
                  {o.isMA
                    ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#FFF8E1] text-[#8a6d1a] border border-[#f0e0a8]">MA</span>
                    : <span className="text-[#ccc]">—</span>}
                </td>
                <td className="px-3 py-3 text-text-secondary">{o.orderDate}</td>
                <td className="px-3 py-3 text-text-secondary">{o.deliveryDate ?? "—"}</td>
                <td className="px-3 py-3 text-right">{o.totalQty.toLocaleString("zh-CN")}</td>
                <td className="px-3 py-3"><ProgressCell order={o} /></td>
                <td className="px-3 py-3"><ExpectedCell order={o} /></td>
                <td className="px-3 py-3 text-center"><span className={`text-[11px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span></td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex gap-2.5">
                    <Link href={`/orders/${o.id}`} className="text-sky hover:underline">查看</Link>
                    {f.view === "recycle" ? (
                      <button disabled={busy} onClick={() => restore(o.id, o.externalOrderNo)} className="text-mint-400 font-semibold hover:underline disabled:opacity-50">恢复</button>
                    ) : f.view === "pending" ? (
                      <>
                        <button onClick={() => setCompleting({ id: o.id, externalOrderNo: o.externalOrderNo })} className="text-mint-700 font-semibold hover:underline">补全</button>
                        <button disabled={busy} onClick={() => archive(o.id, o.externalOrderNo)} className="text-rose hover:underline disabled:opacity-50">作废</button>
                      </>
                    ) : (
                      <>
                        <button disabled={busy} onClick={() => archive(o.id, o.externalOrderNo)} className="text-rose hover:underline disabled:opacity-50">作废</button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {completing && (
        <CompletePendingDialog
          order={completing}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="text-[11px] text-text-secondary font-semibold">{label}</label>{children}</div>;
}

function buildStats(orders: OrderRow[]) {
  const active = orders.filter((o) => o.status !== "archived" && o.status !== "completed" && !o.pendingProduct);
  const today = ymd(new Date());
  const soon = ymd(addDays(new Date(), 7));
  const overdue = active.filter((o) => o.riskLevel === "overdue").length;
  const late = active.filter((o) => o.riskLevel === "late").length;
  return {
    total: orders.filter((o) => o.status !== "archived").length,
    active: active.length,
    unscheduled: active.filter((o) => o.scheduled === false).length,
    overdue,
    late,
    risk: overdue + late,
    urgent: active.filter((o) => o.isUrgent).length,
    dueSoon: active.filter((o) => o.deliveryDate && o.deliveryDate >= today && o.deliveryDate <= soon).length,
  };
}

function MetricCard({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: "mint" | "blue" | "red" | "rose" | "muted" }) {
  const colors: Record<typeof tone, string> = {
    mint: "border-[#d1fae5] bg-[#ecfdf5] text-[#047857]",
    blue: "border-[#dbeafe] bg-[#eff6ff] text-[#2563eb]",
    red: "border-[#fecdd3] bg-[#fff1f2] text-[#c91d32]",
    rose: "border-[#f4b7be] bg-[#fdf2f4] text-[#c91d32]",
    muted: "border-app-border-light bg-[#fafdfb] text-text-secondary",
  };
  return (
    <div className={`rounded-[8px] border px-4 py-3 ${colors[tone]}`}>
      <div className="text-xs font-semibold opacity-80">{label}</div>
      <div className="mt-1 text-[28px] leading-none font-bold tabular-nums">{value.toLocaleString("zh-CN")}</div>
      <div className="mt-1 text-xs opacity-75">{sub}</div>
    </div>
  );
}

function QuickFilter({ active, label, onClick, tone = "mint" }: { active: boolean; label: string; onClick: () => void; tone?: "mint" | "red" | "amber" | "blue" | "rose" }) {
  const activeClass: Record<typeof tone, string> = {
    mint: "bg-mint-50 text-mint-700 border-mint-400",
    red: "bg-[#fff1f2] text-[#c91d32] border-[#f4b7be]",
    amber: "bg-[#fff8e1] text-[#8a6d1a] border-[#f0e0a8]",
    blue: "bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]",
    rose: "bg-[#fdf2f4] text-[#c91d32] border-[#e88ea0]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[32px] rounded-btn border px-3 text-sm font-medium ${active ? activeClass[tone] : "bg-white text-text-secondary border-app-border hover:border-mint-400"}`}
    >
      {label}
    </button>
  );
}

function ProgressCell({ order }: { order: OrderRow }) {
  const planned = order.plannedQty ?? 0;
  const recorded = order.recordedQty ?? 0;
  const demand = order.demandQty ?? order.totalQty;
  const pct = order.progressPct ?? 0;
  const done = order.status === "completed";
  const bar = done ? 100 : pct;
  return (
    <div className="min-w-[128px]">
      <div className="mb-1 flex items-center justify-between text-[11px] text-text-secondary">
        <span>{done ? "已完工" : `实绩 ${bar}%`}</span>
        <span>{recorded.toLocaleString("zh-CN")} / {demand.toLocaleString("zh-CN")}</span>
      </div>
      <div className="h-2 rounded-full bg-[#e5e7eb] overflow-hidden">
        <div className={`h-full rounded-full ${done ? "bg-[#57B894]" : bar >= 100 ? "bg-[#34d399]" : "bg-[#60a5fa]"}`} style={{ width: `${Math.min(100, bar)}%` }} />
      </div>
      {planned > 0 && !done && <div className="mt-1 text-[11px] text-text-tertiary">已排 {planned.toLocaleString("zh-CN")}</div>}
    </div>
  );
}

function ExpectedCell({ order }: { order: OrderRow }) {
  const risk = riskPill(order);
  const isScheduleDate = Boolean(order.scheduleFinishDate);
  return (
    <div className="min-w-[118px]">
      <div className="text-sm text-text">{order.expectedOutDate ?? (order.scheduled ? "待估算" : "未排期")}</div>
      {isScheduleDate && order.scheduleFinishDate && <div className="text-[11px] text-text-tertiary">排期完成 {order.scheduleFinishDate}</div>}
      {!isScheduleDate && order.firstPlanDate && <div className="text-[11px] text-text-tertiary">首排 {order.firstPlanDate}</div>}
      {!isScheduleDate && order.expectedOutDate && <div className="text-[11px] text-text-tertiary">按产能估算</div>}
      {risk}
    </div>
  );
}

function riskPill(order: OrderRow) {
  if (!order.riskLevel || order.riskLevel === "none") return null;
  const cls: Record<NonNullable<OrderRow["riskLevel"]>, string> = {
    none: "",
    missing_due: "bg-[#f3f4f6] text-[#64748b]",
    unscheduled: "bg-[#eff6ff] text-[#2563eb]",
    late: "bg-[#fff8e1] text-[#8a6d1a]",
    overdue: "bg-[#fff1f2] text-[#c91d32]",
  };
  return <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls[order.riskLevel]}`}>{order.riskText}</span>;
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
