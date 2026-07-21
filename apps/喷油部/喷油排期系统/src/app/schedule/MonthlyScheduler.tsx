"use client";
import { apiFetch } from "@/lib/apiFetch";
import { Fragment, useMemo, useState } from "react";

type DraftRow = { orderId: number; externalOrderNo: string; productNo: string; sourcePartId: number; itemName: string; partName: string; planDate: string; plannedQty: number; orderDate: string; deliveryDate: string | null; lineId: number; lineName: string; stepNo: number; craft: string };
type Hint = { orderId: number; externalOrderNo: string; reason: string };
type Overload = { lineId: number; lineName: string; date: string; total: number };
type Result = { month: string; mode: string; draft: DraftRow[]; overdueOrders: Hint[]; overloadedDays: Overload[]; noDeliveryOrders: Hint[]; maOrders: Hint[]; skippedExisting: Hint[]; noLineOrders: Hint[]; noCapacityOrders: Hint[] };

const INPUT = "border border-app-border rounded-btn px-3 py-2 text-sm";
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function MonthlyScheduler() {
  const [month, setMonth] = useState(currentMonth());
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function generate(mode: "incremental" | "rebuild") {
    setErr(""); setLoading(true); setResult(null);
    const res = await apiFetch("/api/schedule/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, mode, today: todayStr() }) });
    setLoading(false);
    if (res.ok) setResult(await res.json());
    else setErr((await res.json()).error || "生成失败");
  }
  async function save() {
    if (!result) { setErr("请先生成草稿"); return; }
    setErr(""); setLoading(true);
    const res = await apiFetch("/api/schedule/auto/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: result.month, mode: result.mode, draft: result.draft }) });
    setLoading(false);
    if (res.ok) { const r = await res.json(); alert(`已保存 ${r.created} 条计划${r.cleared ? `（清空旧 ${r.cleared} 条）` : ""}。可到仪表盘甘特图查看。`); setResult(null); }
    else setErr((await res.json()).error || "保存失败");
  }

  return (
    <div className="bg-white rounded-card border border-app-border p-6 space-y-4">
      <div className="flex gap-4 items-end flex-wrap">
        <div><label className="block text-xs text-text-secondary mb-1">排哪个月</label>
          <input className={INPUT} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <div className="text-xs text-text-secondary">缓冲 2 个工作日 · 按部位工艺自动分拉 · 每条拉各自日产能上限（炒货机不限）</div>
        <button className="ml-auto bg-[#34d399] hover:bg-[#059669] text-white px-5 py-2.5 rounded-[12px] text-sm font-bold disabled:opacity-60" disabled={loading} onClick={() => generate("incremental")}>⚡ 生成月排草稿</button>
        <button className="border border-app-border text-text-secondary px-4 py-2.5 rounded-[12px] text-sm font-semibold disabled:opacity-60" disabled={loading} onClick={() => { if (confirm("将清空本月未录实绩的计划并重新排，确定？")) generate("rebuild"); }}>🗑 清空本月重排</button>
      </div>
      {err && <p className="text-rose text-sm">{err}</p>}
      {loading && <p className="text-text-secondary text-sm">⏳ 生成中…</p>}

      {result && (
        <>
          <div className="space-y-2">
            <div className="bg-[#ecfdf5] border-l-[3px] border-[#34d399] text-[#065f46] rounded-[12px] px-4 py-2 text-sm">✅ {result.mode === "rebuild" ? "重排" : "生成"} {result.month} 草稿：共 {result.draft.length} 条计划行</div>
            {result.overdueOrders.length > 0 && <Banner color="red" icon="🔴">{result.overdueOrders.length} 张赶不上交期（已顺延飘红）：{result.overdueOrders.map((h) => h.externalOrderNo).join("、")}</Banner>}
            {result.overloadedDays.length > 0 && <Banner color="red" icon="🔴">{result.overloadedDays.length} 处拉别某天超产能上限（飘红）：{result.overloadedDays.map((d) => `${d.lineName} ${d.date}(${d.total.toLocaleString()})`).join("、")}</Banner>}
            {result.noLineOrders.length > 0 && <Banner color="warn" icon="⚠️">{result.noLineOrders.length} 张订单有部位找不到对应的拉、未排（请在产品里给部位设工序，或在基础数据库建对应工艺的拉）：{result.noLineOrders.map((h) => h.externalOrderNo).join("、")}</Banner>}
            {result.noCapacityOrders.length > 0 && <Banner color="warn" icon="⚠️">{result.noCapacityOrders.length} 张订单有子件日产能为 0，已停止整单自动排期，请先在产品资料补充日产能：{result.noCapacityOrders.map((h) => h.externalOrderNo).join("、")}</Banner>}
            {result.noDeliveryOrders.length > 0 && <Banner color="warn" icon="⚠️">{result.noDeliveryOrders.length} 张缺交货日、未排，请先补交货日：{result.noDeliveryOrders.map((h) => h.externalOrderNo).join("、")}</Banner>}
            {result.maOrders.length > 0 && <Banner color="info" icon="ℹ️">{result.maOrders.length} 张 MA 急单未自动排（请手工排）：{result.maOrders.map((h) => h.externalOrderNo).join("、")}</Banner>}
            {result.skippedExisting.length > 0 && <Banner color="info" icon="ℹ️">{result.skippedExisting.length} 张已有计划、跳过：{result.skippedExisting.map((h) => h.externalOrderNo).join("、")}</Banner>}
          </div>

          {result.draft.length > 0 && <Gantt result={result} />}
          {result.draft.length === 0 && <p className="text-center text-text-secondary py-6">没有可排的订单（可能都已排过、或缺交货日/为 MA 单，见上方提示）</p>}

          <div className="flex items-center gap-3 pt-2 border-t border-app-border">
            <span className="text-xs text-text-secondary">草稿尚未保存。保存后落入排期、订单转「已排期」，可到仪表盘甘特图查看。</span>
            <div className="ml-auto flex gap-2">
              <button className="border border-app-border text-text-secondary px-4 py-2 rounded-[12px] text-sm font-semibold" onClick={() => setResult(null)}>放弃</button>
              <button className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-5 py-2 rounded-[12px] text-sm font-bold disabled:opacity-60" disabled={loading || result.draft.length === 0} onClick={save}>✓ 保存为计划</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Banner({ color, icon, children }: { color: "red" | "warn" | "info"; icon: string; children: React.ReactNode }) {
  const map = { red: "bg-[#fef2f2] border-[#f87171] text-[#991b1b]", warn: "bg-[#fffbeb] border-[#fbbf24] text-[#92400e]", info: "bg-[#f1f5f9] border-[#cbd5e1] text-[#475569]" };
  return <div className={`${map[color]} border-l-[3px] rounded-[12px] px-4 py-2 text-sm flex gap-2`}><span>{icon}</span><span>{children}</span></div>;
}

// ───────────────── 甘特图（照 preview v2：左表冻结 + 右时间轴横滑 + 横条改每日数值）─────────────────
// 布局常量：格宽 50、左 7 列固定（订单号/款号/子件·部位/拉别/数量/下单日/交期）。拉别挂在部位级，放部位后。
const CELL_W = 50;
const LEFT_COLS = [130, 80, 220, 110, 80, 96, 110];
const LEFT_OFFSETS = LEFT_COLS.reduce<number[]>((acc, _w, i) => { acc.push(i === 0 ? 0 : acc[i - 1] + LEFT_COLS[i - 1]); return acc; }, []);
const LEFT_TOTAL = LEFT_COLS.reduce((s, w) => s + w, 0);
const HEADERS = ["订单号", "款号", "子件 / 部位", "拉别", "数量", "下单日", "交期"];
const CENTER = [false, false, false, true, true, true, true];
const WEEKNAME = ["日", "一", "二", "三", "四", "五", "六"];
const pad2 = (n: number) => String(n).padStart(2, "0");

// 数值压缩：<1 万原样，≥1 万用 k（格子只有 50px）
const fmtNum = (n: number) => (n >= 10000 ? Math.round(n / 1000) + "k" : n.toLocaleString());

// 聚合结构：订单 → 子件 → 部位 → 每日数量
type GPart = { key: string; partName: string; line: string; stepNo: number; craft: string; total: number; days: Record<string, number> };
type GItem = { itemName: string; lines: string[]; total: number; days: Record<string, number>; parts: GPart[] };
type GOrder = { orderId: number; no: string; pno: string; lines: string[]; orderDate: string; deliveryDate: string | null; overdue: boolean; total: number; partCount: number; days: Record<string, number>; items: GItem[] };

// 把 draft 重组成「订单→子件→部位」三级 + 整自然月时间轴
function buildGantt(result: Result) {
  const overdueIds = new Set(result.overdueOrders.map((h) => h.orderId));
  // order → itemName(子件) → partName+step+craft(部位/道次/工序) → 日期累加
  const oMap = new Map<number, { head: DraftRow; items: Map<string, Map<string, GPart>> }>();
  result.draft.forEach((r) => {
    let o = oMap.get(r.orderId);
    if (!o) { o = { head: r, items: new Map() }; oMap.set(r.orderId, o); }
    let im = o.items.get(r.itemName);
    if (!im) { im = new Map(); o.items.set(r.itemName, im); }
    const partKey = `${r.sourcePartId}:${r.partName}:${r.stepNo}:${r.craft}:${r.lineId}`;
    let p = im.get(partKey);
    if (!p) { p = { key: partKey, partName: r.partName, line: r.lineName || "", stepNo: r.stepNo, craft: r.craft, total: 0, days: {} }; im.set(partKey, p); }
    p.days[r.planDate] = (p.days[r.planDate] || 0) + r.plannedQty;
    p.total += r.plannedQty;
  });

  const orders: GOrder[] = [];
  oMap.forEach((o, orderId) => {
    const items: GItem[] = [];
    o.items.forEach((pm, itemName) => {
      const parts = Array.from(pm.values()).sort((a, b) => a.partName.localeCompare(b.partName, "zh-CN") || a.stepNo - b.stepNo || a.line.localeCompare(b.line, "zh-CN"));
      // 子件量 = 各部位数量之和（部位数量可不同，须累加，例如青蛙：
      // 青蛙23694 + 青蛙前30780 + 青蛙后30780 + 顶盖1 30780 = 116034）。
      const total = parts.reduce((s, pp) => s + pp.total, 0);
      // 子件每日产量 = 各部位同日产量之和
      const days: Record<string, number> = {};
      for (const pp of parts)
        for (const [k, q] of Object.entries(pp.days)) days[k] = (days[k] || 0) + q;
      // 子件涉及的拉别去重（各部位工艺可能不同 → 跨多条拉）
      const lines = Array.from(new Set(parts.map((pp) => pp.line).filter(Boolean)));
      items.push({ itemName, lines, total, days, parts });
    });
    // 订单 = 各不同子件相加（不同子件才是不同东西）
    const total = items.reduce((s, it) => s + it.total, 0);
    // 订单级每日合计 + 部位总数：此处一次性预聚合，避免渲染时每行×每天重复求和
    const oDays: Record<string, number> = {};
    let partCount = 0;
    items.forEach((it) => {
      partCount += it.parts.length;
      for (const [k, q] of Object.entries(it.days)) oDays[k] = (oDays[k] || 0) + q;
    });
    // 订单涉及的拉别去重（各子件各部位的拉合并）
    const oLines = Array.from(new Set(items.flatMap((it) => it.lines)));
    orders.push({
      orderId, no: o.head.externalOrderNo, pno: o.head.productNo, lines: oLines,
      orderDate: o.head.orderDate, deliveryDate: o.head.deliveryDate, overdue: overdueIds.has(orderId),
      total, partCount, days: oDays, items,
    });
  });
  orders.sort((a, b) => a.no.localeCompare(b.no));

  // 整自然月时间轴（跟仪表盘一样整月）
  const [y, m] = result.month.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const days: { key: string; d: number; m: number; we: boolean; wd: string }[] = [];
  for (let d = 1; d <= dim; d++) {
    const wd = new Date(y, m - 1, d).getDay();
    days.push({ key: `${y}-${pad2(m)}-${pad2(d)}`, d, m, we: wd === 0 || wd === 6, wd: WEEKNAME[wd] });
  }
  return { orders, days };
}

// 冻结列定位样式（宽/最小宽/sticky 左偏移）——表头 <th> 与单元格 <td> 共用
const frozenStyle = (i: number): React.CSSProperties => ({ width: LEFT_COLS[i], minWidth: LEFT_COLS[i], left: LEFT_OFFSETS[i] });

// 左侧固定列单元格
function frozenTd(i: number, children: React.ReactNode, extra?: React.CSSProperties) {
  return (
    <td key={i} className={`gv-frozen${CENTER[i] ? " gv-c" : ""}`} style={{ ...frozenStyle(i), ...extra }}>{children}</td>
  );
}

// 占位空列：子件/部位行只填名称列，其余左列留空
const emptyTds = (...idxs: number[]) => idxs.map((i) => frozenTd(i, ""));

// 在 Set 中切换某 key 的存在性，返回新 Set（不可变更新；订单/子件展开态共用）
function toggleInSet<T>(s: Set<T>, key: T): Set<T> { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; }

function Gantt({ result }: { result: Result }) {
  const [openO, setOpenO] = useState<Set<number>>(new Set());
  const [openI, setOpenI] = useState<Set<string>>(new Set());
  // result 只在重新生成草稿时变；展开/收起不应触发整棵数据树重建
  const { orders, days } = useMemo(() => buildGantt(result), [result]);
  const today = todayStr();
  const tableW = LEFT_TOTAL + days.length * CELL_W;
  const gridCols = `repeat(${days.length}, ${CELL_W}px)`;

  const toggleO = (id: number) => setOpenO((s) => toggleInSet(s, id));
  const toggleI = (k: string) => setOpenI((s) => toggleInSet(s, k));

  // 日格 className（周末底纹 / 今日高亮）——表头日期格与各行时间轴格共用
  const cellClass = (dd: { we: boolean; key: string }) => `gv-cell${dd.we ? " gv-we" : ""}${dd.key === today ? " gv-today" : ""}`;

  // 一行的时间轴格子：valueOf(日期key)=该天数值；kind 决定数值气泡配色
  const axisRow = (valueOf: (key: string) => number, kind: "order" | "item" | "part", overdue?: boolean) => (
    <td className="gv-axis">
      <div className="gv-grid" style={{ gridTemplateColumns: gridCols }}>
        {days.map((dd) => {
          const v = valueOf(dd.key);
          return (
            <div key={dd.key} className={cellClass(dd)}>
              {v ? <span className={`gv-num gv-${overdue ? "overdue" : kind}`}>{fmtNum(v)}</span> : ""}
            </div>
          );
        })}
      </div>
    </td>
  );

  return (
    <>
      <style>{GANTT_CSS}</style>

      {/* 图例 */}
      <div className="gv-legend">
        <span className="chip"><span className="sw" style={{ background: "#34d399", color: "#fff" }}>800</span>部位每天实排数（喷件数）</span>
        <span className="chip"><span className="sw" style={{ background: "#d1fae5", color: "#047857" }}>∑</span>子件每日（各部位合计·喷件数）</span>
        <span className="chip"><span className="sw" style={{ background: "#CBD5E1", color: "#475569" }}>∑</span>订单每日（各部位合计·喷件数）</span>
        <span className="chip"><span className="sw" style={{ background: "#C91D32", color: "#fff" }}>!</span>赶不上交期</span>
        <span style={{ marginLeft: "auto" }}>▶ 点订单号展开「子件 / 部位 · 每天产量」</span>
      </div>

      <div className="gv-wrap">
        <table className="gv-table" style={{ width: tableW }}>
          {/* 表头 */}
          <thead>
            <tr>
              {HEADERS.map((h, i) => (
                <th key={h} className={`gv-th gv-frozen${CENTER[i] ? " gv-c" : ""}`} style={frozenStyle(i)}>{h}</th>
              ))}
              <th className="gv-th gv-axis-head" style={{ width: days.length * CELL_W, minWidth: days.length * CELL_W, padding: 0 }}>
                <div className="gv-grid" style={{ gridTemplateColumns: gridCols }}>
                  {days.map((dd) => (
                    <div key={dd.key} className={cellClass(dd)} style={{ flexDirection: "column", height: "auto", padding: "4px 0" }}>
                      <span>{dd.m}/{dd.d}</span><span className="gv-wd">{dd.wd}</span>
                    </div>
                  ))}
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {/* 订单 / 子件 / 部位 */}
            {orders.map((o) => {
              const oOpen = openO.has(o.orderId);
              return (
                <Fragment key={o.orderId}>
                  {/* 订单行 */}
                  <tr className="gv-order" onClick={() => toggleO(o.orderId)}>
                    {frozenTd(0, <><span className={`gv-toggle${oOpen ? " on" : ""}`}>{oOpen ? "▼" : "▶"}</span><span className="gv-no">{o.no}</span></>)}
                    {frozenTd(1, o.pno)}
                    {frozenTd(2, <span className="gv-dim">（{o.items.length} 子件 / {o.partCount} 部位）</span>, { paddingLeft: 4 })}
                    {frozenTd(3, <span className="gv-line">{o.lines.join("、") || "-"}</span>)}
                    {frozenTd(4, <span className="gv-qty">{o.total.toLocaleString()}</span>)}
                    {frozenTd(5, <span className="gv-od">{o.orderDate || "-"}</span>)}
                    {frozenTd(6, <span className={`gv-due${o.overdue ? " red" : ""}`}>{o.overdue ? "⚠ " : ""}{o.deliveryDate || "-"}</span>)}
                    {axisRow((k) => o.days[k] || 0, "order", o.overdue)}
                  </tr>

                  {/* 子件行 */}
                  {oOpen && o.items.map((it) => {
                    const ikey = `${o.orderId}__${it.itemName}`;
                    const iOpen = openI.has(ikey);
                    return (
                      <Fragment key={ikey}>
                        <tr className="gv-item" onClick={(e) => { e.stopPropagation(); toggleI(ikey); }}>
                          {emptyTds(0, 1)}
                          {frozenTd(2, <><span className={`gv-toggle${iOpen ? " on" : ""}`}>{iOpen ? "▼" : "▶"}</span>{it.itemName}</>, { paddingLeft: 24 })}
                          {frozenTd(3, <span className="gv-line">{it.lines.join("、")}</span>)}
                          {frozenTd(4, <span className="gv-qty">{it.total.toLocaleString()}</span>)}
                          {emptyTds(5, 6)}
                          {axisRow((k) => it.days[k] || 0, "item")}
                        </tr>

                        {/* 部位行 */}
                        {iOpen && it.parts.map((p) => (
                          <tr className="gv-part" key={p.key}>
                            {emptyTds(0, 1)}
                            {frozenTd(2, <><span className="gv-part-tag">道{p.stepNo}</span><span className="gv-name">{p.partName}</span></>, { paddingLeft: 50 })}
                            {frozenTd(3, <span className="gv-line">{p.line || "-"}</span>)}
                            {frozenTd(4, <span className="gv-qty">{p.total.toLocaleString()}</span>)}
                            {emptyTds(5, 6)}
                            {axisRow((k) => p.days[k] || 0, "part")}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// 甘特相关 CSS（gv- 前缀作用域隔离；照 preview v2 / 仪表盘 GanttView 冻结表格样式）
const GANTT_CSS = `
  .gv-legend { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: 12px; color: #94a3b8; margin-bottom: 12px; }
  .gv-legend .chip { display: inline-flex; align-items: center; gap: 6px; }
  .gv-legend .sw { width: 22px; height: 12px; border-radius: 2px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; }
  .gv-wrap { background: #fff; border: 1px solid #E0E0E0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.06); overflow: auto; }
  .gv-table { border-collapse: separate; border-spacing: 0; font-size: 12px; table-layout: fixed; }
  .gv-table th, .gv-table td { white-space: nowrap; }
  .gv-th { background: #f0fdf4; color: #047857; font-weight: 700; padding: 8px; text-align: left; border-right: 1px solid #d1fae5; border-bottom: 1px solid #d1fae5; position: sticky; top: 0; z-index: 3; }
  .gv-th.gv-c { text-align: center; }
  .gv-th.gv-frozen { z-index: 7; }
  .gv-axis-head { background: #ecfdf5; }
  .gv-frozen { position: sticky; z-index: 6; padding: 6px 8px; border-bottom: 1px solid #E0E0E0; border-right: 1px solid #E0E0E0; vertical-align: middle; background: #fff; }
  .gv-frozen.gv-c { text-align: center; }
  .gv-axis { padding: 0; position: relative; border-bottom: 1px solid #E0E0E0; }
  .gv-grid { display: grid; }
  .gv-cell { height: 30px; display: flex; align-items: center; justify-content: center; font-size: 10.5px; border-left: 1px solid #f0f2f4; font-variant-numeric: tabular-nums; color: inherit; }
  .gv-cell.gv-we { background: rgba(4,120,87,0.05); }
  .gv-cell.gv-today { background: rgba(232,142,160,0.10); }
  .gv-wd { font-size: 8px; color: #9ccdb8; }
  .gv-num { display: inline-block; min-width: 30px; padding: 1px 4px; border-radius: 4px; font-size: 10px; font-weight: 600; text-align: center; }
  .gv-num.gv-order { background: #CBD5E1; color: #475569; }
  .gv-num.gv-item { background: #d1fae5; color: #047857; }
  .gv-num.gv-part { background: #34d399; color: #fff; }
  .gv-num.gv-overdue { background: #C91D32; color: #fff; }
  .gv-order .gv-frozen { background: #F4FBF8; font-weight: 500; }
  .gv-item .gv-frozen { background: #FCFEFD; }
  .gv-order, .gv-item { cursor: pointer; }
  .gv-part .gv-frozen { background: #fff; }
  .gv-line { display: inline-block; max-width: 100%; padding: 1px 7px; border-radius: 3px; background: #D1FAE5; color: #047857; font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
  .gv-no { color: #047857; font-weight: 600; }
  .gv-toggle { display: inline-block; width: 14px; text-align: center; color: #999; margin-right: 4px; font-size: 10px; user-select: none; }
  .gv-toggle.on { color: #047857; }
  .gv-due { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #DCFCE7; color: #14532D; font-size: 11px; }
  .gv-due.red { background: #FEE2E2; color: #991B1B; }
  .gv-od { color: #64748b; font-size: 11px; }
  .gv-part-tag { display: inline-block; padding: 1px 6px; font-size: 10px; background: #ECFDF5; color: #047857; border-radius: 2px; margin-right: 4px; }
  .gv-name { white-space: normal; line-height: 1.35; vertical-align: middle; }
  .gv-qty { font-variant-numeric: tabular-nums; color: #0f172a; font-weight: 600; }
  .gv-dim { color: #cbd5e1; }
`;
