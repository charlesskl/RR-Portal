"use client";
import { apiFetch } from "@/lib/apiFetch";
// 周排：手工排期主场。内部包含「已排调整」「新建计划」「排急单」三个入口。
// 已排调整沿用原周排；新建计划吸收原日排能力，但交互改为周排式表格；急单复用 UrgentScheduler。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lineLabel } from "@/lib/line";
import UrgentScheduler from "./UrgentScheduler";

type Machine = { id: number; machineNo: string; isUV: boolean };
type Line = { id: number; name: string; workshop: string; leaderName: string | null; craftType: string; machines: Machine[] };
type Part = { sourceItemId: number; itemName: string; sourcePartId: number; partName: string; productionMode: string; dailyCapacity: number; stdMachineCount: number; totalDemand: number; craft: string; isTumbler: boolean; craftPasses: number };
type OrderLite = { id: number; externalOrderNo: string; productNo: string; isMA: boolean; parts: Part[] };
type UrgentOrderLite = { id: number; externalOrderNo: string; productNo: string; deliveryDate: string | null; scheduled: boolean; parts: Part[] };
type WeeklyMode = "adjust" | "create" | "urgent";
type OrderFilter = "all" | "normal" | "ma";
type WeeklyTarget = { planId: number; date: string; lineId: number };

type Plan = { id: number; planDate: string; lineId: number; orderId: number; itemName: string; partName: string; sourcePartId: number | null; machineNos: string[]; plannedQty: number; workerCount: number; stepNo: number; craft: string; standardStepCount: number | null; standardCraft: string | null; craftAdjusted: boolean };
type Edit = { planDate: string; lineId: number; plannedQty: number | ""; workerCount: number | ""; stepNo: number | ""; craft: string; machineNos: string[] };
type NewRow = {
  rowKey: string;
  checked: boolean;
  sourcePartId: number;
  itemName: string;
  partName: string;
  stepNo: number;
  craft: string;
  planDate: string;
  lineId: number | "";
  plannedQty: number | "";
  workerCount: number | "";
  machineNos: string[];
};

const WEEKNAME = ["日", "一", "二", "三", "四", "五", "六"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayLabel = (key: string) => { const d = new Date(key + "T00:00:00"); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEKNAME[d.getDay()]}`; };
const defFrom = () => ymd(new Date());
const defTo = () => { const d = new Date(); d.setDate(d.getDate() + 6); return ymd(d); };
const fmt = (n: number) => n.toLocaleString("zh-CN");
const CRAFT_TYPES = ["手喷", "自动喷", "移印", "UV"];
const craftPriority = (craft: string) => craft === "自动喷" ? 0 : craft === "手喷" ? 1 : craft === "移印" ? 2 : craft === "UV" ? 3 : 99;
const partNameKey = (s: string) => s.trim().replace(/（/g, "(").replace(/）/g, ")").replace(/\s/g, "").toLowerCase();
function expandPasses(crafts: string[], craftPasses: number) {
  const ordered = Array.from(new Set(crafts.map((c) => c.trim()).filter(Boolean))).sort((a, b) => craftPriority(a) - craftPriority(b));
  if (ordered.length === 0) return [{ stepNo: 1, craft: "" }];
  const count = craftPasses > 0 ? Math.max(craftPasses, ordered.length) : 1;
  return Array.from({ length: count }, (_, i) => ({ stepNo: i + 1, craft: ordered[i % ordered.length] }));
}

export default function WeeklyScheduler({
  lines,
  orders,
  urgentOrders,
  mode,
  onModeChange,
  target,
}: {
  lines: Line[];
  orders: OrderLite[];
  urgentOrders: UrgentOrderLite[];
  mode: WeeklyMode;
  onModeChange: (mode: WeeklyMode) => void;
  target?: WeeklyTarget | null;
}) {
  const pendingUrgent = urgentOrders.filter((o) => !o.scheduled).length;
  const btn = (active: boolean) =>
    `px-4 py-2 rounded-btn text-sm ${active ? "bg-mint-50 text-mint-700 font-semibold" : "text-text-secondary hover:bg-slate-50"}`;

  return (
    <div className="max-w-[1180px]">
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" className={btn(mode === "adjust")} onClick={() => onModeChange("adjust")}>已排调整</button>
        <button type="button" className={btn(mode === "create")} onClick={() => onModeChange("create")}>新建计划</button>
        <button type="button" className={btn(mode === "urgent")} onClick={() => onModeChange("urgent")}>
          排急单{pendingUrgent > 0 ? `（${pendingUrgent}）` : ""}
        </button>
      </div>

      {mode === "adjust" && <AdjustPlansPanel lines={lines} target={target} />}
      {mode === "create" && <CreatePlansPanel lines={lines} orders={orders} />}
      {mode === "urgent" && <UrgentScheduler orders={urgentOrders} lines={lines} />}
    </div>
  );
}

function AdjustPlansPanel({ lines, target }: { lines: Line[]; target?: WeeklyTarget | null }) {
  const [lineId, setLineId] = useState<number | null>(lines[0]?.id ?? null);
  const [fromDate, setFromDate] = useState<string>(defFrom());
  const [toDate, setToDate] = useState<string>(defTo());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [activeMachineKey, setActiveMachineKey] = useState<number | null>(null);
  const [focusPlanId, setFocusPlanId] = useState<number | null>(target?.planId ?? null);
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const lineName = (id: number) => lines.find((l) => l.id === id)?.name ?? "";
  const lineCraft = useCallback((id: number) => lines.find((l) => l.id === id)?.craftType ?? "", [lines]);

  const loadPlans = useCallback(async () => {
    if (!lineId || !fromDate || !toDate) { setPlans([]); setEdits({}); setDeleted(new Set()); return; }
    setLoading(true);
    try {
      const raw: Plan[] = await apiFetch(`/api/plans?lineId=${lineId}&from=${fromDate}&to=${toDate}`).then((r) => r.json());
      const rows = raw.map((p) => ({ ...p, planDate: p.planDate.slice(0, 10) }));
      setPlans(rows);
      const init: Record<number, Edit> = {};
      rows.forEach((p) => { init[p.id] = { planDate: p.planDate, lineId: p.lineId, plannedQty: p.plannedQty, workerCount: p.workerCount, stepNo: p.stepNo || 1, craft: p.craft || lineCraft(p.lineId), machineNos: p.machineNos }; });
      setEdits(init); setDeleted(new Set()); setActiveMachineKey(null);
    } catch { setPlans([]); setEdits({}); }
    finally { setLoading(false); }
  }, [lineId, fromDate, toDate, lineCraft]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => {
    if (!target) return;
    setLineId(target.lineId);
    setFromDate(target.date);
    setToDate(target.date);
    setFocusPlanId(target.planId);
    setActiveMachineKey(null);
  }, [target]);
  useEffect(() => {
    if (!focusPlanId || loading) return;
    const row = focusRowRef.current;
    if (!row) return;
    const t = window.setTimeout(() => row.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(t);
  }, [focusPlanId, loading, plans]);

  const ed = (p: Plan): Edit => edits[p.id] ?? { planDate: p.planDate, lineId: p.lineId, plannedQty: p.plannedQty, workerCount: p.workerCount, stepNo: p.stepNo || 1, craft: p.craft || lineCraft(p.lineId), machineNos: p.machineNos };
  const setEd = (id: number, patch: Partial<Edit>) => setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const toggleMachine = (id: number, no: string) => {
    const cur = edits[id]?.machineNos ?? [];
    setEd(id, { machineNos: cur.includes(no) ? cur.filter((x) => x !== no) : [...cur, no] });
  };

  const activePlan = activeMachineKey == null ? null : plans.find((p) => p.id === activeMachineKey) ?? null;
  const activeLineMachines = activePlan ? (lines.find((l) => l.id === ed(activePlan).lineId)?.machines ?? []) : [];

  async function save() {
    setSaving(true);
    try {
      for (const id of Array.from(deleted)) await apiFetch(`/api/plans/${id}`, { method: "DELETE" });
      for (const p of plans) {
        if (deleted.has(p.id)) continue;
        const e = edits[p.id]; if (!e) continue;
        const body: Record<string, unknown> = {};
        if (e.planDate !== p.planDate) body.planDate = e.planDate;
        if (e.lineId !== p.lineId) body.lineId = e.lineId;
        if (e.plannedQty !== "" && e.plannedQty !== p.plannedQty) body.plannedQty = e.plannedQty;
        if (e.workerCount !== "" && e.workerCount !== p.workerCount) body.workerCount = e.workerCount;
        if (e.stepNo !== "" && e.stepNo !== p.stepNo) body.stepNo = e.stepNo;
        if (e.craft !== p.craft) body.craft = e.craft;
        if (e.machineNos.join() !== p.machineNos.join()) body.machineNos = e.machineNos;
        if (Object.keys(body).length > 0)
          await apiFetch(`/api/plans/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
      alert("已保存改动");
      await loadPlans();
    } catch { alert("保存失败，请重试"); }
    finally { setSaving(false); }
  }

  const visible = plans.filter((p) => !deleted.has(p.id));
  const dayKeys = Array.from(new Set(visible.map((p) => ed(p).planDate))).sort();

  return (
    <>
      <div className="bg-white border border-app-border rounded-[10px] px-5 py-[18px] mb-4 flex flex-wrap items-end gap-5">
        <div>
          <label className="block text-xs text-text-secondary mb-1">拉别</label>
          <select className="border border-app-border rounded-btn px-3 py-2 text-sm w-[200px]" value={lineId ?? ""} onChange={(e) => { setFocusPlanId(null); setLineId(Number(e.target.value)); }}>
            {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">起始日期</label>
          <input type="date" className="border border-app-border rounded-btn px-3 py-2 text-sm" value={fromDate} onChange={(e) => { setFocusPlanId(null); setFromDate(e.target.value); }} />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">结束日期</label>
          <input type="date" className="border border-app-border rounded-btn px-3 py-2 text-sm" value={toDate} onChange={(e) => { setFocusPlanId(null); setToDate(e.target.value); }} />
        </div>
        <div className="text-sm text-text-secondary">已选：{fromDate} ~ {toDate}　·　{lineId ? lineName(lineId) : "—"}</div>
      </div>

      {activePlan && (
        <div className="bg-white border-2 border-[#047857] rounded-[10px] px-4 py-3 mb-4">
          <p className="text-xs text-[#047857] font-medium mb-2">
            为「{activePlan.itemName} · {activePlan.partName}」指派机台（绿色=已选，再点取消）　·　拉别：{lineName(ed(activePlan).lineId)}
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {activeLineMachines.length === 0 && <span className="text-xs text-text-secondary">该拉别暂无已录入机台</span>}
            {activeLineMachines.map((m) => {
              const sel = (edits[activePlan.id]?.machineNos ?? []).includes(m.machineNo);
              return (
                <button key={m.id} type="button" onClick={() => toggleMachine(activePlan.id, m.machineNo)}
                  className={`rounded-[20px] px-3 py-1 text-[13px] border ${sel ? "bg-[#34d399] text-white border-[#34d399]" : "bg-white text-[#333333] border-app-border hover:border-[#047857]"}`}>
                  {m.machineNo}{m.isUV ? " UV" : ""}
                </button>
              );
            })}
            <button type="button" className="ml-auto text-[13px] text-[#047857] font-medium" onClick={() => setActiveMachineKey(null)}>✓ 完成</button>
          </div>
        </div>
      )}

      {loading && <p className="text-text-secondary text-sm">⏳ 加载中…</p>}
      {!loading && dayKeys.length === 0 && <p className="text-center text-text-secondary py-6">该拉别这段时间暂无已排计划，可到「新建计划」手工排入。</p>}

      {!loading && dayKeys.map((key) => {
        const rows = visible.filter((p) => ed(p).planDate === key);
        const total = rows.reduce((s, p) => s + (Number(ed(p).plannedQty) || 0), 0);
        return (
          <div key={key} className="bg-white border border-app-border rounded-[10px] mb-4 overflow-hidden">
            <div className="flex items-center px-4 py-3 bg-[#f0fdf4] border-b border-[#d1fae5]">
              <span className="font-bold text-[#047857] text-sm">{dayLabel(key)}</span>
              <span className="ml-auto text-xs text-text-secondary">当日计划总生产数：{total.toLocaleString()}</span>
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#f0fdf4] text-[#047857]">
                  <th className="px-3 py-2 text-left font-bold">日期</th>
                  <th className="px-3 py-2 text-left font-bold">拉别</th>
                  <th className="px-3 py-2 text-left font-bold">部位</th>
                  <th className="px-3 py-2 text-left font-bold">计划生产数</th>
                  <th className="px-3 py-2 text-left font-bold">人数</th>
                  <th className="px-3 py-2 text-left font-bold">道次</th>
                  <th className="px-3 py-2 text-left font-bold">工序</th>
                  <th className="px-3 py-2 text-left font-bold">机台号</th>
                  <th className="px-3 py-2 text-left font-bold">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const e = ed(p);
                  const focused = p.id === focusPlanId;
                  return (
                    <tr
                      key={p.id}
                      ref={focused ? focusRowRef : null}
                      className={focused ? "bg-[#ecfdf5] ring-2 ring-inset ring-[#34d399]" : i % 2 ? "bg-[#F9F9F9]" : "bg-white"}
                    >
                      <td className="px-3 py-2 border-b border-app-border">
                        <input type="date" className="border border-app-border rounded-btn px-2 py-1 text-[13px]" value={e.planDate} onChange={(ev) => setEd(p.id, { planDate: ev.target.value })} />
                      </td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <select className="border border-app-border rounded-btn px-2 py-1 text-[13px]" value={e.lineId}
                          onChange={(ev) => {
                            const nextLineId = Number(ev.target.value);
                            setEd(p.id, { lineId: nextLineId, craft: e.craft || lineCraft(nextLineId), machineNos: [] });
                          }}>
                          {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 border-b border-app-border text-[#333333]">{p.itemName} · {p.partName}</td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <input type="number" min={1} className="w-[90px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                          value={e.plannedQty} onChange={(ev) => setEd(p.id, { plannedQty: ev.target.value === "" ? "" : Number(ev.target.value) })} />
                      </td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <input type="number" min={1} className="w-[60px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                          value={e.workerCount} onChange={(ev) => setEd(p.id, { workerCount: ev.target.value === "" ? "" : Number(ev.target.value) })} />
                      </td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <input type="number" min={1} className="w-[60px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                          value={e.stepNo} onChange={(ev) => setEd(p.id, { stepNo: ev.target.value === "" ? "" : Number(ev.target.value) })} />
                      </td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <select className="border border-app-border rounded-btn px-2 py-1 text-[13px] w-[86px]" value={e.craft}
                          onChange={(ev) => setEd(p.id, { craft: ev.target.value })}>
                          <option value="">未设</option>
                          {CRAFT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {p.craftAdjusted && (
                          <div className="mt-1 text-[11px] leading-4 text-[#b45309]">
                            已手动调整{p.standardCraft ? ` · 标准${p.stepNo}道${p.standardCraft}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <input type="text" readOnly value={e.machineNos.join("、")} placeholder="点击指派"
                          onClick={() => setActiveMachineKey(p.id)}
                          className={`w-[130px] rounded-btn px-2 py-1 text-[13px] cursor-pointer bg-white ${activeMachineKey === p.id ? "border-2 border-[#047857]" : "border border-app-border hover:border-[#047857]"}`} />
                      </td>
                      <td className="px-3 py-2 border-b border-app-border">
                        <button type="button" className="text-rose text-[13px] hover:underline" onClick={() => setDeleted((s) => new Set(s).add(p.id))}>删除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {!loading && dayKeys.length > 0 && (
        <div className="flex justify-end gap-3 items-center mt-2">
          <span className="mr-auto text-xs text-text-secondary">改完点保存统一提交；未保存不生效。换拉/挪天保存后会移到对应拉别或日期。</span>
          <button type="button" disabled={saving} onClick={save}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#CCCCCC] text-white font-bold rounded-[8px] px-6 py-2 text-sm">
            {saving ? "保存中…" : "✓ 保存改动"}
          </button>
        </div>
      )}
    </>
  );
}

function rowsForOrder(o: OrderLite | null, lineId: number | ""): NewRow[] {
  if (!o) return [];
  const groups = new Map<string, Part[]>();
  for (const p of o.parts) {
    const key = `${p.sourceItemId}:${partNameKey(p.partName)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const rows: NewRow[] = [];
  for (const group of Array.from(groups.values())) {
    const representative = group[0];
    const demand = Math.max(...group.map((p) => p.totalDemand || 0));
    const crafts = group.map((p) => p.craft);
    const passes = Math.max(0, ...group.map((p) => p.craftPasses || 0));
    for (const pass of expandPasses(crafts, passes)) {
      rows.push({
        rowKey: `${representative.sourcePartId}:${pass.stepNo}:${pass.craft}`,
        checked: true,
        sourcePartId: representative.sourcePartId,
        itemName: representative.itemName,
        partName: representative.partName,
        stepNo: pass.stepNo,
        craft: pass.craft,
        planDate: ymd(new Date()),
        lineId,
        plannedQty: demand,
        workerCount: 1,
        machineNos: [],
      });
    }
  }
  return rows.sort((a, b) => a.partName.localeCompare(b.partName, "zh-CN") || a.stepNo - b.stepNo);
}

function CreatePlansPanel({ lines, orders }: { lines: Line[]; orders: OrderLite[] }) {
  const router = useRouter();
  const defaultLineId = lines[0]?.id ?? "";
  const [orderId, setOrderId] = useState<number | "">(orders[0]?.id ?? "");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [rows, setRows] = useState<NewRow[]>(() => rowsForOrder(orders[0] ?? null, defaultLineId));
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const order = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);
  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders
      .filter((o) => orderFilter === "all" || (orderFilter === "ma" ? o.isMA : !o.isMA))
      .filter((o) => {
        if (!q) return true;
        return `${o.externalOrderNo} ${o.productNo}`.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [orders, orderFilter, orderQuery]);
  const activeLineMachines = activeRow == null ? [] : (lines.find((l) => l.id === rows[activeRow]?.lineId)?.machines ?? []);

  function pickOrder(id: number | "") {
    setOrderId(id);
    setError("");
    setActiveRow(null);
    const o = orders.find((x) => x.id === id) ?? null;
    setRows(rowsForOrder(o, defaultLineId));
  }

  const setRow = (i: number, patch: Partial<NewRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const toggleMachine = (i: number, no: string) => {
    const cur = rows[i]?.machineNos ?? [];
    setRow(i, { machineNos: cur.includes(no) ? cur.filter((x) => x !== no) : [...cur, no] });
  };

  async function save() {
    if (!order) { setError("请先选择一张订单"); return; }
    const picked = rows.filter((r) => r.checked);
    if (picked.length === 0) { setError("请至少勾选一个部位"); return; }
    for (const r of picked) {
      if (!r.planDate) { setError(`「${r.itemName} · ${r.partName}」未填日期`); return; }
      if (!r.lineId) { setError(`「${r.itemName} · ${r.partName}」未选拉别`); return; }
      if (!r.plannedQty || Number(r.plannedQty) <= 0) { setError(`「${r.itemName} · ${r.partName}」计划数需 > 0`); return; }
      if (!r.stepNo || Number(r.stepNo) <= 0) { setError(`「${r.itemName} · ${r.partName}」道次需 > 0`); return; }
      if (!r.craft) { setError(`「${r.itemName} · ${r.partName}」未选工序`); return; }
    }

    setSaving(true);
    setError("");
    try {
      const plans = picked.map((r) => ({
        planDate: r.planDate,
        planType: "daily",
        lineId: Number(r.lineId),
        orderId: order.id,
        itemName: r.itemName,
        partName: r.partName,
        sourcePartId: r.sourcePartId,
        stepNo: r.stepNo,
        craft: r.craft,
        machineNos: r.machineNos,
        plannedQty: Number(r.plannedQty),
        workerCount: Number(r.workerCount) || 1,
      }));
      const res = await apiFetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plans }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || "保存失败");
        return;
      }
      alert("计划已保存，生成待录单");
      setOrderId("");
      setRows([]);
      setActiveRow(null);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  const checkedCount = rows.filter((r) => r.checked).length;
  const total = rows.filter((r) => r.checked).reduce((s, r) => s + (Number(r.plannedQty) || 0), 0);
  const orderFilterBtn = (value: OrderFilter, label: string) => (
    <button
      type="button"
      className={`rounded-btn px-3 py-1.5 text-xs ${orderFilter === value ? "bg-mint-50 text-mint-700 font-semibold" : "bg-white text-text-secondary border border-app-border"}`}
      onClick={() => setOrderFilter(value)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="bg-white border border-app-border rounded-[10px] px-5 py-[18px] mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">待排订单</label>
            <input
              className="border border-app-border rounded-btn px-3 py-2 text-sm w-[320px] focus:outline-none focus:border-mint-400"
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              placeholder="搜索订单号 / 货号"
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            {orderFilterBtn("all", "全部")}
            {orderFilterBtn("normal", "普通")}
            {orderFilterBtn("ma", "MA")}
          </div>
          {order && <div className="text-sm text-text-secondary pb-2">已选：{order.externalOrderNo} · {order.productNo}</div>}
          {orders.length === 0 && <div className="text-sm text-text-secondary pb-2">暂无可排订单</div>}
        </div>

        {orders.length > 0 && (
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
            {filteredOrders.map((o) => {
              const active = o.id === orderId;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pickOrder(o.id)}
                  className={`text-left border rounded-[8px] px-2.5 py-1.5 transition ${active ? "border-[#34d399] bg-[#ecfdf5] shadow-sm" : "border-app-border bg-white hover:border-[#047857] hover:bg-[#fbfefc]"}`}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold leading-5 text-[#333333]">{o.externalOrderNo}</span>
                    {o.isMA && <span className="shrink-0 rounded-full bg-[#eff6ff] px-1.5 py-0 text-[10px] font-semibold leading-4 text-[#2563EB]">MA</span>}
                  </div>
                  <div className="truncate text-xs leading-4 text-text-secondary">{o.productNo}</div>
                </button>
              );
            })}
          </div>
        )}

        {orders.length > 0 && filteredOrders.length === 0 && (
          <p className="mt-4 text-sm text-text-secondary">没有匹配的订单，换个订单号或货号试试。</p>
        )}
        {orders.length > 20 && filteredOrders.length === 20 && (
          <p className="mt-3 text-xs text-text-secondary">已显示前 20 条，输入订单号或货号可快速定位。</p>
        )}
        {order && <div className="mt-3 text-sm text-text-secondary">已铺开 {rows.length} 条计划行 · 已勾 {checkedCount} 项 · 合计 {fmt(total)}</div>}
      </div>

      {error && <p className="text-rose text-sm mb-3">{error}</p>}

      {activeRow != null && (
        <div className="bg-white border-2 border-[#047857] rounded-[10px] px-4 py-3 mb-4">
          <p className="text-xs text-[#047857] font-medium mb-2">
            为「{rows[activeRow]?.itemName} · {rows[activeRow]?.partName}」指派机台（绿色=已选，再点取消）
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {activeLineMachines.length === 0 && <span className="text-xs text-text-secondary">先选拉别，或该拉暂无机台</span>}
            {activeLineMachines.map((m) => {
              const sel = (rows[activeRow]?.machineNos ?? []).includes(m.machineNo);
              return (
                <button key={m.id} type="button" onClick={() => toggleMachine(activeRow, m.machineNo)}
                  className={`rounded-[20px] px-3 py-1 text-[13px] border ${sel ? "bg-[#34d399] text-white border-[#34d399]" : "bg-white text-[#333333] border-app-border hover:border-[#047857]"}`}>
                  {m.machineNo}{m.isUV ? " UV" : ""}
                </button>
              );
            })}
            <button type="button" className="ml-auto text-[13px] text-[#047857] font-medium" onClick={() => setActiveRow(null)}>✓ 完成</button>
          </div>
        </div>
      )}

      {order && (
        <div className="bg-white border border-app-border rounded-[10px] mb-4 overflow-hidden">
          <div className="flex items-center px-4 py-3 bg-[#f0fdf4] border-b border-[#d1fae5]">
            <span className="font-bold text-[#047857] text-sm">{order.externalOrderNo} · {order.productNo}</span>
            <span className="ml-auto text-xs text-text-secondary">按周排表格填写；只填同一天也就是原日排。</span>
          </div>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#f0fdf4] text-[#047857]">
                <th className="px-3 py-2 text-left font-bold">排</th>
                <th className="px-3 py-2 text-left font-bold">日期</th>
                <th className="px-3 py-2 text-left font-bold">拉别</th>
                <th className="px-3 py-2 text-left font-bold">部位</th>
                <th className="px-3 py-2 text-left font-bold">道次</th>
                <th className="px-3 py-2 text-left font-bold">工序</th>
                <th className="px-3 py-2 text-left font-bold">需求</th>
                <th className="px-3 py-2 text-left font-bold">计划生产数</th>
                <th className="px-3 py-2 text-left font-bold">人数</th>
                <th className="px-3 py-2 text-left font-bold">机台号</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pt = order.parts.find((p) => p.sourcePartId === r.sourcePartId);
                return (
                  <tr key={r.rowKey} className={i % 2 ? "bg-[#F9F9F9]" : "bg-white"}>
                    <td className="px-3 py-2 border-b border-app-border">
                      <input type="checkbox" checked={r.checked} onChange={(e) => setRow(i, { checked: e.target.checked })} />
                    </td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <input type="date" className="border border-app-border rounded-btn px-2 py-1 text-[13px]" value={r.planDate} onChange={(e) => setRow(i, { planDate: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <select className="border border-app-border rounded-btn px-2 py-1 text-[13px]" value={r.lineId}
                        onChange={(e) => setRow(i, { lineId: e.target.value ? Number(e.target.value) : "", machineNos: [] })}>
                        <option value="">— 选拉别 —</option>
                        {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 border-b border-app-border text-[#333333]">{r.itemName} · {r.partName}</td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <input type="number" min={1} className="w-[58px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                        value={r.stepNo} onChange={(e) => setRow(i, { stepNo: Number(e.target.value) || 1 })} />
                    </td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <select className="border border-app-border rounded-btn px-2 py-1 text-[13px] w-[86px]" value={r.craft}
                        onChange={(e) => setRow(i, { craft: e.target.value })}>
                        <option value="">未设</option>
                        {CRAFT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 border-b border-app-border text-text-secondary">{fmt(pt?.totalDemand ?? 0)}</td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <input type="number" min={1} className="w-[96px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                        value={r.plannedQty} onChange={(e) => setRow(i, { plannedQty: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <input type="number" min={1} className="w-[64px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                        value={r.workerCount} onChange={(e) => setRow(i, { workerCount: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-2 border-b border-app-border">
                      <input type="text" readOnly value={r.machineNos.join("、")} placeholder="点击指派"
                        onClick={() => setActiveRow(i)}
                        className={`w-[130px] rounded-btn px-2 py-1 text-[13px] cursor-pointer bg-white ${activeRow === i ? "border-2 border-[#047857]" : "border border-app-border hover:border-[#047857]"}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-end gap-3 items-center px-4 py-3">
            <span className="mr-auto text-xs text-text-secondary">保存后生成待录单；未勾选的部位不会排入。</span>
            <button type="button" disabled={saving || checkedCount === 0} onClick={save}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#CCCCCC] text-white font-bold rounded-[8px] px-6 py-2 text-sm">
              {saving ? "保存中…" : "✓ 保存新计划"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
