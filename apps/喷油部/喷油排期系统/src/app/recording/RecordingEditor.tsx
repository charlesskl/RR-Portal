"use client";
import { apiFetch } from "@/lib/apiFetch";
// 实绩录入客户端组件（两级展开版）：订单可折叠；展开后每个部位行直接内联 4 个输入框
// （实际生产数/不良/工时/人数），保存按钮在订单头，一次保存整单。薄荷绿主题。
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ExportDialog from "./ExportDialog";

type Row = {
  id: number; orderId: number; orderNo: string; productNo: string;
  deliveryDate: string | null; lineId: number; lineName: string; itemName: string; partName: string;
  machineNos: string[]; plannedQty: number; workerCount: number;
  goodQty: number | null; reportedQty: number | null; workHours: number;
  productionValue: number; unitPrice: number; status: string;
  totalDemand: number; recordedTotal: number;
};
type Edit = { good: string; reported: string; hours: string; worker: string };

// 部位行 6 列网格：部位名 | 入库数 | 员工报数 | 工时 | 人数 | 累计
const GRID = "grid grid-cols-[minmax(150px,1fr)_120px_120px_84px_84px_140px] items-center gap-2";

export default function RecordingEditor({ date, rows, overdueCount, completedOrderIds, filterLines }:
  { date: string; rows: Row[]; overdueCount: number; completedOrderIds: number[]; filterLines: { id: number; label: string }[] }) {
  const router = useRouter();
  const [view, setView] = useState<"all" | "todo" | "done">("all");
  const [lineFilter, setLineFilter] = useState<number | "all">("all");
  const [openOrders, setOpenOrders] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [savingOrder, setSavingOrder] = useState<number | null>(null);

  const doneSet = useMemo(() => new Set(completedOrderIds), [completedOrderIds]);
  // 拉别筛选侧栏：用后端已按 A/B/C/UV 排好序的 filterLines，只保留当天有行的拉
  const lines = useMemo(
    () => filterLines.filter((l) => rows.some((r) => r.lineId === l.id)),
    [filterLines, rows]
  );
  // 进度统计（全天，不随筛选变）
  const recorded = rows.filter((r) => r.goodQty != null).length;
  const todo = rows.length - recorded;
  const totalValue = rows.reduce((s, r) => s + (r.goodQty != null ? r.productionValue : 0), 0);

  // 筛选后按订单分组
  const groups = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (lineFilter !== "all" && r.lineId !== lineFilter) return false;
      if (view === "todo" && r.goodQty != null) return false;
      if (view === "done" && r.goodQty == null) return false;
      return true;
    });
    const m = new Map<number, { head: Row; rows: Row[] }>();
    filtered.forEach((r) => {
      if (!m.has(r.orderId)) m.set(r.orderId, { head: r, rows: [] });
      m.get(r.orderId)!.rows.push(r);
    });
    return Array.from(m.values());
  }, [rows, lineFilter, view]);

  const toggleOrder = (id: number) =>
    setOpenOrders((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const goodOf = (r: Row) => edits[r.id]?.good ?? (r.goodQty?.toString() ?? "");
  const isInvalid = (v: string) => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0);

  function setEdit(r: Row, patch: Partial<Edit>) {
    setEdits((prev) => ({
      ...prev,
      [r.id]: {
        good: prev[r.id]?.good ?? (r.goodQty?.toString() ?? ""),
        reported: prev[r.id]?.reported ?? (r.reportedQty?.toString() ?? ""),
        hours: prev[r.id]?.hours ?? r.workHours.toString(),
        worker: prev[r.id]?.worker ?? r.workerCount.toString(),
        ...patch,
      },
    }));
  }

  // 保存整单：提交本次填过且合法的部位行
  async function saveOrder(orderId: number, orderRows: Row[]) {
    const targets = orderRows.filter((r) => {
      const e = edits[r.id];
      return e && e.good !== "" && !isInvalid(e.good);
    });
    if (targets.length === 0) return;
    setSavingOrder(orderId);
    await Promise.all(targets.map((r) => {
      const e = edits[r.id];
      return apiFetch(`/api/plans/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goodQty: Number(e.good),
          reportedQty: e.reported === "" ? null : Number(e.reported),
          workHours: Number(e.hours) || 11,
          workerCount: Number(e.worker) || 1,
        }),
      });
    }));
    setSavingOrder(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      {/* 顶部条 */}
      <div className="mb-4 flex items-center justify-between rounded-card border border-app-border bg-white px-5 py-3">
        <h3 className="m-0 text-[17px] font-bold text-text">📋 实绩录入 · 今日待录</h3>
        <div className="flex items-center gap-2">
          <DateNav date={date} dir={-1} label="◀ 昨日" />
          <span className="rounded-btn bg-mint-50 px-3 py-1 text-[13px] font-semibold text-mint-700">📅 {date}</span>
          <DateNav date={date} dir={1} label="明日 ▶" />
          <ExportDialog date={date} lines={
            Array.from(new Map(rows.map((r) => [r.lineId, r.lineName])).entries())
              .map(([id, label]) => ({ id, label }))
          } />
        </div>
      </div>

      {/* 彩色进度卡 */}
      <div className="mb-3 flex gap-4 rounded-card border border-app-border bg-white px-5 py-3">
        <ProgCard tone="mint" num={recorded} label="已录入条数" />
        <ProgCard tone="gold" num={todo} label="待录入条数" />
        <ProgCard tone="sky" num={`¥${totalValue.toLocaleString()}`} label="今日合计产值" />
      </div>
      {overdueCount > 0 && (
        <p className="mb-3 rounded-md border-l-[3px] border-rose bg-rose-bg px-3 py-2 text-[13px] font-medium text-rose-dark">
          ⚠️ 历史欠录 {overdueCount} 条（切到对应日期补录）
        </p>
      )}

      {/* 两栏：左筛选 + 右列表 */}
      <div className="grid grid-cols-[200px_1fr] gap-4">
        {/* 左筛选栏 */}
        <aside className="h-fit rounded-card border border-app-border bg-white p-4">
          <FilterGroup title="视图">
            <FilterItem active={view === "all"} onClick={() => setView("all")} label="📋 全部" count={rows.length} />
            <FilterItem active={view === "todo"} onClick={() => setView("todo")} label="🕒 待录" count={todo} />
            <FilterItem active={view === "done"} onClick={() => setView("done")} label="✅ 已录" count={recorded} />
          </FilterGroup>
          <FilterGroup title="拉别">
            <FilterItem active={lineFilter === "all"} onClick={() => setLineFilter("all")} label="全部" count={rows.length} />
            {lines.map((l) => (
              <FilterItem key={l.id} active={lineFilter === l.id} onClick={() => setLineFilter(l.id)}
                label={l.label} count={rows.filter((r) => r.lineId === l.id).length} />
            ))}
          </FilterGroup>
        </aside>

        {/* 右订单列表 */}
        <div className="flex flex-col gap-2.5">
          {groups.length === 0 && (
            <p className="rounded-card border border-app-border bg-white px-4 py-6 text-center text-[13px] text-text-tertiary">
              当天没有符合条件的待录单。
            </p>
          )}
          {groups.map((g) => {
            const open = openOrders.has(g.head.orderId);
            const orderTodo = g.rows.filter((r) => r.goodQty == null).length;
            const isDone = doneSet.has(g.head.orderId);
            // 本单是否有可保存内容（填过且合法）
            const dirty = g.rows.some((r) => { const e = edits[r.id]; return e && e.good !== "" && !isInvalid(e.good); });
            return (
              <div key={g.head.orderId} className="overflow-hidden rounded-card border border-app-border bg-white">
                {/* 订单头：左侧可折叠，右侧保存按钮 + 状态 */}
                <div className={`flex items-center gap-3 px-4 py-3 ${open ? "border-b border-app-border bg-mint-50" : "bg-white"}`}>
                  <div className="flex cursor-pointer items-center gap-3" onClick={() => toggleOrder(g.head.orderId)}>
                    <span className="w-5 text-center font-bold text-mint-700">{open ? "▼" : "▶"}</span>
                    <span className="font-bold text-text">{g.head.orderNo}</span>
                    <span className="text-[13px] text-text-secondary">{g.head.productNo}</span>
                    <span className="text-[12px] text-text-tertiary">{g.head.lineName}</span>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button disabled={!dirty || savingOrder === g.head.orderId}
                      onClick={() => saveOrder(g.head.orderId, g.rows)}
                      className="rounded-btn bg-mint-400 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-mint-700 disabled:opacity-40">
                      💾 保存本单
                    </button>
                    {isDone && <span className="rounded-md bg-mint-400 px-2 py-1 text-[12px] font-medium text-white">🟢 已完工</span>}
                    {orderTodo > 0
                      ? <span className="rounded-md border border-app-border bg-white px-2.5 py-1 text-[12px] text-text-secondary">待录 <strong className="text-rose-dark">{orderTodo}</strong> 条</span>
                      : <span className="rounded-md border border-app-border bg-white px-2.5 py-1 text-[12px] text-text-secondary">全录完</span>}
                    {g.head.deliveryDate && <span className="rounded-md border border-app-border bg-white px-2.5 py-1 text-[12px] text-text-secondary">合同日 {g.head.deliveryDate}</span>}
                  </div>
                </div>

                {/* 部位行（订单展开时显示，内联输入框） */}
                {open && (
                  <div className="px-4 py-2">
                    {/* 小表头 */}
                    <div className={`${GRID} px-2 pb-1 text-[11px] uppercase tracking-wide text-text-tertiary`}>
                      <span>部位</span><span>员工报数</span><span>入库数 *</span><span>工时</span><span>人数</span><span>累计 / 状态</span>
                    </div>
                    {g.rows.map((r, i) => {
                      const e = edits[r.id];
                      const gv = goodOf(r);
                      const invalid = isInvalid(gv);
                      const partDone = r.totalDemand > 0 && r.recordedTotal >= r.totalDemand;
                      return (
                        <div key={r.id} className={`${GRID} rounded-md px-2 py-1.5 ${i % 2 ? "bg-[#F9F9F9]" : ""}`}>
                          <span className="flex items-center gap-2 text-[14px] font-semibold text-text">
                            📦 {r.itemName}{r.partName}
                            {r.machineNos.length > 0 && <span className="text-[11px] font-normal text-text-tertiary">{r.machineNos.join("、")}</span>}
                          </span>
                          <input value={e?.reported ?? (r.reportedQty?.toString() ?? "")} onChange={(ev) => setEdit(r, { reported: ev.target.value })}
                            className="rounded-md border-[1.5px] border-sky-light bg-white px-2 py-1.5 text-[14px]" />
                          <input value={gv} onChange={(ev) => setEdit(r, { good: ev.target.value })}
                            className="rounded-md border-[1.5px] px-2 py-1.5 text-[14px] font-medium"
                            style={invalid ? { background: "#F4B7BE", color: "#C91D32", borderColor: "#C91D32" }
                                           : { background: "white", borderColor: "#E1ECF7", color: "#333" }} />
                          <input value={e?.hours ?? r.workHours.toString()} onChange={(ev) => setEdit(r, { hours: ev.target.value })}
                            className="rounded-md border-[1.5px] border-sky-light bg-white px-2 py-1.5 text-[14px]" />
                          <input value={e?.worker ?? r.workerCount.toString()} onChange={(ev) => setEdit(r, { worker: ev.target.value })}
                            className="rounded-md border-[1.5px] border-sky-light bg-white px-2 py-1.5 text-[14px]" />
                          <span className="flex items-center gap-2 text-[11px]">
                            <span className={`rounded px-2 py-0.5 ${partDone ? "bg-mint-100 text-mint-700" : "bg-white text-text-secondary"}`}>
                              累计 <strong>{r.recordedTotal}</strong> / 本次 {r.plannedQty} / 订单 {r.totalDemand}{partDone ? " ✅" : ""}
                            </span>
                            {r.goodQty != null
                              ? <span className="rounded bg-mint-100 px-1.5 py-0.5 text-mint-700">¥{r.productionValue.toLocaleString()}</span>
                              : <span className="rounded bg-gold-bg px-1.5 py-0.5 text-[#92400E]">待录</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DateNav({ date, dir, label }: { date: string; dir: number; label: string }) {
  const d = new Date(date);
  d.setDate(d.getDate() + dir);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (
    <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/recording?date=${ymd}`}
       className="rounded-btn border border-app-border bg-white px-3 py-1.5 text-[13px] text-text hover:bg-[#f3f4f6]">
      {label}
    </a>
  );
}

function ProgCard({ tone, num, label }: { tone: "mint" | "gold" | "sky"; num: number | string; label: string }) {
  const toneCls = {
    mint: { box: "bg-mint-50", num: "text-mint-700" },
    gold: { box: "bg-gold-bg", num: "text-[#92400E]" },
    sky: { box: "bg-sky-bg", num: "text-sky" },
  }[tone];
  return (
    <div className={`flex-1 rounded-[10px] p-3 text-center ${toneCls.box}`}>
      <div className={`text-[28px] font-bold ${toneCls.num}`}>{num}</div>
      <div className="mt-0.5 text-[12px] text-text-tertiary">{label}</div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <h4 className="mb-2 text-[12px] uppercase tracking-wide text-text-tertiary">{title}</h4>
      {children}
    </div>
  );
}

function FilterItem({ active, onClick, label, count }:
  { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <div onClick={onClick}
      className={`flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[13px] ${
        active ? "bg-mint-400 text-white" : "text-text-secondary hover:bg-mint-50 hover:text-mint-700"
      }`}>
      <span>{label}</span>
      <span className={`rounded px-1.5 text-[11px] ${active ? "bg-white/30" : "bg-black/5"}`}>{count}</span>
    </div>
  );
}
