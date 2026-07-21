"use client";
import { apiFetch } from "@/lib/apiFetch";
// 排急单：选一张待排急单 → 按部位铺成可编辑行（日期/拉别/计划数/人数/机台，部位只显示）→
// 「确认排入」调 preview 检测产能：不超→直接 commit；超了→弹「暂停候选」(丙：预勾凑够+可改)→
// 确认停单→commit（写急单计划行 + 被停单整单顺延），回显顺延提示。
import { useMemo, useState } from "react";
import { lineLabel } from "@/lib/line";
import { pickCandidates } from "@/lib/urgent";

type Machine = { id: number; machineNo: string; isUV: boolean };
type Line = { id: number; name: string; workshop: string; leaderName: string | null; machines: Machine[] };
type Part = { sourceItemId: number; itemName: string; sourcePartId: number; partName: string; productionMode: string; dailyCapacity: number; stdMachineCount: number; totalDemand: number };
type UrgentOrder = { id: number; externalOrderNo: string; productNo: string; deliveryDate: string | null; scheduled: boolean; parts: Part[] };

type Row = {
  sourcePartId: number; itemName: string; partName: string;
  planDate: string; lineId: number | ""; plannedQty: number | ""; workerCount: number | ""; machineNos: string[];
};

type Candidate = { orderId: number; externalOrderNo: string; lineId: number; lineName: string; deliveryDate: string | null; currentFinish: string; slack: number; fitToStop: boolean; reason: string };
type Overload = { lineId: number; lineName: string; date: string; already: number; incoming: number; limit: number };
type PreviewResult = { need: number; canDirect: boolean; overloads: Overload[]; candidates: Candidate[]; candidateSlackTotal: number; candidateEnough: boolean; hint: string | null };
type Postponed = { orderId: number; externalOrderNo: string; days: number; newFinish: string };

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// 把一张急单按部位铺成可填行（一部位一行，日期默认今天，数量默认部位需求，可人工改）
function rowsForOrder(o: UrgentOrder | null): Row[] {
  if (!o) return [];
  return o.parts.map((p) => ({
    sourcePartId: p.sourcePartId, itemName: p.itemName, partName: p.partName,
    planDate: todayYmd(), lineId: "", plannedQty: p.totalDemand, workerCount: 1, machineNos: [],
  }));
}

export default function UrgentScheduler({ orders, lines }: { orders: UrgentOrder[]; lines: Line[] }) {
  const [orderId, setOrderId] = useState<number | "">(orders[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>(() => rowsForOrder(orders[0] ?? null));
  const [activeMachineRow, setActiveMachineRow] = useState<number | null>(null);
  const [phase, setPhase] = useState<"edit" | "candidates" | "done">("edit");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [postponed, setPostponed] = useState<Postponed[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const order = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);

  // 选单 → 按部位铺行（一部位一行，日期默认今天）
  function pickOrder(id: number | "") {
    setOrderId(id);
    setPhase("edit"); setPreview(null); setChecked(new Set()); setPostponed([]); setError("");
    const o = orders.find((x) => x.id === id) ?? null;
    setRows(rowsForOrder(o));
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const toggleMachine = (i: number, no: string) => {
    const cur = rows[i]?.machineNos ?? [];
    setRow(i, { machineNos: cur.includes(no) ? cur.filter((x) => x !== no) : [...cur, no] });
  };

  const activeLineMachines = activeMachineRow == null ? [] : (lines.find((l) => l.id === rows[activeMachineRow]?.lineId)?.machines ?? []);

  // 组装 preview/commit 入参
  function buildRows() {
    return rows.map((r) => ({
      lineId: Number(r.lineId), planDate: r.planDate, plannedQty: Number(r.plannedQty) || 0,
      sourcePartId: r.sourcePartId, itemName: r.itemName, partName: r.partName,
      workerCount: Number(r.workerCount) || 1, machineNos: JSON.stringify(r.machineNos),
    }));
  }

  function validate(): string {
    if (!order) return "请先选一张待排急单";
    if (rows.length === 0) return "该急单无可排部位";
    for (const r of rows) {
      if (!r.lineId) return `「${r.itemName} · ${r.partName}」未选拉别`;
      if (!r.planDate) return `「${r.itemName} · ${r.partName}」未填日期`;
      if (!r.plannedQty || Number(r.plannedQty) <= 0) return `「${r.itemName} · ${r.partName}」计划数需 > 0`;
    }
    return "";
  }

  // 确认排入 → preview
  async function onSubmit() {
    const v = validate(); if (v) { setError(v); return; }
    setError(""); setBusy(true);
    try {
      const res = await apiFetch("/api/schedule/urgent/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urgentOrderId: Number(orderId), rows: buildRows() }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "检测失败"); return; }
      const pv: PreviewResult = await res.json();
      setPreview(pv);
      if (pv.canDirect) {
        await doCommit([]); // 不超载，直接排入，无需停单
      } else {
        // 丙：只预勾本次顺延后仍不超期的候选，再按能缓多的优先凑够 need。
        const pre = pickCandidates(pv.candidates.filter((c) => c.fitToStop), pv.need).picked.map((c) => c.orderId);
        setChecked(new Set(pre));
        setPhase("candidates");
      }
    } catch { setError("网络错误，请重试"); }
    finally { setBusy(false); }
  }

  // commit
  async function doCommit(pausedOrderIds: number[]) {
    setBusy(true); setError("");
    try {
      const res = await apiFetch("/api/schedule/urgent/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urgentOrderId: Number(orderId), rows: buildRows(), pausedOrderIds }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "排入失败"); return; }
      const r: { createdRows: number; postponed: Postponed[] } = await res.json();
      setPostponed(r.postponed || []);
      setPhase("done");
    } catch { setError("网络错误，请重试"); }
    finally { setBusy(false); }
  }

  const need = preview?.need ?? 0;
  const fitCandidates = (preview?.candidates ?? []).filter((c) => c.fitToStop);
  const got = fitCandidates.filter((c) => checked.has(c.orderId)).reduce((s, c) => s + c.slack, 0);
  const enough = got >= need;

  return (
    <div className="max-w-[1100px]">
      {/* 选单 */}
      <div className="bg-white border border-app-border rounded-[10px] px-5 py-[18px] mb-4 flex flex-wrap items-end gap-5">
        <div>
          <label className="block text-xs text-text-secondary mb-1">待排急单</label>
          <select className="border border-app-border rounded-btn px-3 py-2 text-sm w-[280px]" value={orderId} onChange={(e) => pickOrder(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— 选择急单 —</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.externalOrderNo}（{o.productNo}）{o.scheduled ? " · 已部分排" : ""}</option>)}
          </select>
        </div>
        {order && <div className="text-sm text-text-secondary">交货日：{order.deliveryDate ?? "—"}</div>}
        {orders.length === 0 && <div className="text-sm text-text-secondary">暂无待排急单</div>}
      </div>

      {error && <p className="text-rose text-sm mb-3">{error}</p>}

      {/* 机台指派绿区（照周排） */}
      {activeMachineRow != null && phase === "edit" && (
        <div className="bg-white border-2 border-[#047857] rounded-[10px] px-4 py-3 mb-4">
          <p className="text-xs text-[#047857] font-medium mb-2">
            为「{rows[activeMachineRow]?.itemName} · {rows[activeMachineRow]?.partName}」指派机台（绿色=已选，再点取消）
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {activeLineMachines.length === 0 && <span className="text-xs text-text-secondary">先选拉别，或该拉暂无机台</span>}
            {activeLineMachines.map((m) => {
              const sel = (rows[activeMachineRow]?.machineNos ?? []).includes(m.machineNo);
              return (
                <button key={m.id} type="button" onClick={() => toggleMachine(activeMachineRow, m.machineNo)}
                  className={`rounded-[20px] px-3 py-1 text-[13px] border ${sel ? "bg-[#34d399] text-white border-[#34d399]" : "bg-white text-[#333333] border-app-border hover:border-[#047857]"}`}>
                  {m.machineNo}{m.isUV ? " UV" : ""}
                </button>
              );
            })}
            <button type="button" className="ml-auto text-[13px] text-[#047857] font-medium" onClick={() => setActiveMachineRow(null)}>✓ 完成</button>
          </div>
        </div>
      )}

      {/* 排急单表 */}
      {phase === "edit" && order && (
        <div className="bg-white border border-app-border rounded-[10px] mb-4 overflow-hidden">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#f0fdf4] text-[#047857]">
                <th className="px-3 py-2 text-left font-bold">日期</th>
                <th className="px-3 py-2 text-left font-bold">拉别</th>
                <th className="px-3 py-2 text-left font-bold">部位</th>
                <th className="px-3 py-2 text-left font-bold">计划生产数</th>
                <th className="px-3 py-2 text-left font-bold">人数</th>
                <th className="px-3 py-2 text-left font-bold">机台号</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.sourcePartId} className={i % 2 ? "bg-[#F9F9F9]" : "bg-white"}>
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
                    <input type="number" min={1} className="w-[90px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                      value={r.plannedQty} onChange={(e) => setRow(i, { plannedQty: e.target.value === "" ? "" : Number(e.target.value) })} />
                  </td>
                  <td className="px-3 py-2 border-b border-app-border">
                    <input type="number" min={1} className="w-[60px] border border-app-border rounded-btn px-2 py-1 text-[13px] text-right"
                      value={r.workerCount} onChange={(e) => setRow(i, { workerCount: e.target.value === "" ? "" : Number(e.target.value) })} />
                  </td>
                  <td className="px-3 py-2 border-b border-app-border">
                    <input type="text" readOnly value={r.machineNos.join("、")} placeholder="点击指派"
                      onClick={() => setActiveMachineRow(i)}
                      className={`w-[130px] rounded-btn px-2 py-1 text-[13px] cursor-pointer bg-white ${activeMachineRow === i ? "border-2 border-[#047857]" : "border border-app-border hover:border-[#047857]"}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-3 items-center px-4 py-3">
            <span className="mr-auto text-xs text-text-secondary">填好日期/拉别/数量/人数/机台，点「确认排入」系统会检测产能。</span>
            <button type="button" disabled={busy} onClick={onSubmit}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#CCCCCC] text-white font-bold rounded-[8px] px-6 py-2 text-sm">
              {busy ? "检测中…" : "✓ 确认排入"}
            </button>
          </div>
        </div>
      )}

      {/* 暂停候选弹窗（丙：预勾 + 可改 + 实时凑数） */}
      {phase === "candidates" && preview && (
        <div className="bg-white border-2 border-[#E88EA0] rounded-[10px] mb-4 overflow-hidden">
          <div className="px-4 py-3 bg-[#fdf2f4] border-b border-[#f4d4da]">
            <p className="text-sm font-bold text-[#333333]">产能不够，急单需占 <span className="text-[#C91D32]">{need}</span> 天。系统荐停下列单（交期有余地的优先），人拍板：</p>
            <p className="text-xs text-text-secondary mt-1">超载：{preview.overloads.map((o) => `${o.lineName} ${o.date}（已排${o.already}+急单${o.incoming}>上限${o.limit}）`).join("；")}</p>
            {preview.hint && <p className="mt-2 rounded-[8px] border border-[#f4b7be] bg-white px-3 py-2 text-xs text-[#C91D32]">{preview.hint}</p>}
            {fitCandidates.length > 0 && (
              <p className="text-xs text-text-secondary mt-2">
                可安全顺延候选 {fitCandidates.length} 张，合计可缓 {preview.candidateSlackTotal} 天；系统已预勾能覆盖本次顺延的候选。
              </p>
            )}
          </div>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#fdf2f4] text-[#333333]">
                <th className="px-3 py-2 text-left font-bold">停</th>
                <th className="px-3 py-2 text-left font-bold">订单</th>
                <th className="px-3 py-2 text-left font-bold">拉别</th>
                <th className="px-3 py-2 text-left font-bold">交货日</th>
                <th className="px-3 py-2 text-left font-bold">当前预计完成</th>
                <th className="px-3 py-2 text-left font-bold">能缓</th>
                <th className="px-3 py-2 text-left font-bold">判断</th>
              </tr>
            </thead>
            <tbody>
              {preview.candidates.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-text-secondary border-b border-app-border">
                    暂无可暂停候选，请返回调整日期、拉别或数量。
                  </td>
                </tr>
              )}
              {preview.candidates.map((c, i) => (
                <tr key={c.orderId} className={c.fitToStop ? (i % 2 ? "bg-[#F9F9F9]" : "bg-white") : "bg-[#F4B7BE]/40"}>
                  <td className="px-3 py-2 border-b border-app-border">
                    <input type="checkbox" checked={checked.has(c.orderId)} disabled={!c.fitToStop}
                      onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.orderId); else n.delete(c.orderId); return n; })} />
                  </td>
                  <td className="px-3 py-2 border-b border-app-border">{c.externalOrderNo}</td>
                  <td className="px-3 py-2 border-b border-app-border">{c.lineName}</td>
                  <td className="px-3 py-2 border-b border-app-border">{c.deliveryDate ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-app-border">{c.currentFinish}</td>
                  <td className="px-3 py-2 border-b border-app-border">{c.slack} 天</td>
                  <td className="px-3 py-2 border-b border-app-border">
                    <span className={c.fitToStop ? "text-[#047857]" : "text-[#C91D32]"}>{c.reason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-3 items-center px-4 py-3">
            <span className="mr-auto text-sm">已凑 <span className={enough ? "text-[#57B894] font-bold" : "text-[#C91D32] font-bold"}>{got}</span> / 共需 {need} 天{enough ? "（已够）" : "（还差 " + (need - got) + " 天）"}</span>
            <button type="button" onClick={() => { setPhase("edit"); setPreview(null); }} className="px-4 py-2 border border-app-border rounded-btn text-sm">返回改排期</button>
            <button type="button" disabled={busy || !enough} onClick={() => doCommit(Array.from(checked))}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#CCCCCC] text-white font-bold rounded-[8px] px-6 py-2 text-sm">
              {busy ? "提交中…" : "✓ 确认停单并排入急单"}
            </button>
          </div>
        </div>
      )}

      {/* 完成：顺延提示 */}
      {phase === "done" && (
        <div className="bg-white border-2 border-[#57B894] rounded-[10px] px-5 py-4 mb-4">
          <p className="text-sm font-bold text-[#047857] mb-2">✅ 急单已排入</p>
          {postponed.length === 0 ? (
            <p className="text-sm text-text-secondary">产能足够，无需暂停其他订单。</p>
          ) : (
            <ul className="text-sm text-[#333333] space-y-1">
              {postponed.map((p) => (
                <li key={p.orderId}>· 订单 <b>{p.externalOrderNo}</b> 顺延 {p.days} 天，预计 <b>{p.newFinish}</b> 完成</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => pickOrder("")} className="mt-3 text-[13px] text-[#2563EB] font-medium">继续排下一张急单</button>
        </div>
      )}
    </div>
  );
}
