"use client";
import { apiFetch } from "@/lib/apiFetch";
// 排期总览看板（拉别 × 日期·只读）—— 照 mockup supervisor-grid-v4.html / spec 2026-06-24 §6。
// 日期竖排、拉别横排；每格顶部小计（件数·产能占用%·红黄绿），下面铺「部位+数量+第几道」，按工序上色。
// 数据来自 GET /api/schedule/overview；网格聚合/占用/配色由 @/lib/scheduleOverview 纯函数算。
// 第一期只读；「点格子跳周排」联动留下一步。
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildOverviewGrid, cellKey, dateRange, type CellItem, type OverviewLine, type OverviewPlan } from "@/lib/scheduleOverview";

type Resp = { lines: OverviewLine[]; plans: OverviewPlan[] };
type View = "week" | "twoweek" | "month" | "custom";
type DetailState = { date: string; line: OverviewLine; item: CellItem };
type AdjustTarget = { planId: number; date: string; lineId: number };
type OverviewProps = {
  pendingOrderCount?: number;
  pendingUrgentCount?: number;
  onCreatePlan?: () => void;
  onPlanUrgent?: () => void;
  onAdjustPlan?: (target: AdjustTarget) => void;
};

const WEEKNAME = ["日", "一", "二", "三", "四", "五", "六"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

const MINI_BG = { ok: "sc-bg-ok", busy: "sc-bg-busy", over: "sc-bg-over" } as const;
const MINI_TX = { ok: "sc-ut-ok", busy: "sc-ut-busy", over: "sc-ut-over" } as const;

export default function ScheduleOverview({ pendingOrderCount = 0, pendingUrgentCount = 0, onCreatePlan, onPlanUrgent, onAdjustPlan }: OverviewProps) {
  const [view, setView] = useState<View>("week");
  const [from, setFrom] = useState<string>(() => ymd(new Date()));
  const [to, setTo] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return ymd(d);
  });
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<DetailState | null>(null);

  const load = useCallback(async () => {
    if (!from || !to) { setErr("请选择起止日期"); setData(null); return; }
    if (parseYmd(to) < parseYmd(from)) { setErr("结束日期不能早于起始日期"); setData(null); return; }
    setLoading(true); setErr("");
    try {
      const r = await apiFetch(`/api/schedule/overview?from=${from}&to=${to}`);
      if (!r.ok) { setErr(`加载失败（${r.status}）`); setData(null); return; }
      setData(await r.json());
    } catch { setErr("加载失败"); setData(null); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const dates = useMemo(() => {
    if (!from || !to || parseYmd(to) < parseYmd(from)) return [];
    return dateRange(from, to);
  }, [from, to]);
  const grid = useMemo(() => (data ? buildOverviewGrid(data.plans, data.lines) : {}), [data]);
  const lines = data?.lines ?? [];

  const applyPreset = (v: Exclude<View, "custom">) => {
    setView(v);
    const today = new Date();
    if (v === "month") {
      const y = today.getFullYear(), m = today.getMonth();
      setFrom(ymd(new Date(y, m, 1)));
      setTo(ymd(new Date(y, m + 1, 0)));
      return;
    }
    const end = new Date(today);
    end.setDate(end.getDate() + (v === "week" ? 6 : 13));
    setFrom(ymd(today));
    setTo(ymd(end));
  };
  const backToday = () => applyPreset("week");

  return (
    <div className="sc">
      <style>{CSS}</style>

      {(pendingOrderCount > 0 || pendingUrgentCount > 0) && (
        <div className="sc-alerts">
          {pendingOrderCount > 0 && (
            <button type="button" className="sc-alert normal" onClick={onCreatePlan}>
              <span>待排订单</span><b>{pendingOrderCount}</b>
            </button>
          )}
          {pendingUrgentCount > 0 && (
            <button type="button" className="sc-alert urgent" onClick={onPlanUrgent}>
              <span>待排急单</span><b>{pendingUrgentCount}</b>
            </button>
          )}
        </div>
      )}

      <p className="sc-sub">日期竖排、拉别横排。每格顶部<b>小计（件数·产能占用）</b>，下面把<b>部位 + 数量 + 第几道</b>铺开（绿喷油 / 蓝移印 / 紫 UV）。只读，看到要改去「周排」。</p>

      {/* 工具栏：视图切换 + 前后翻 */}
      <div className="sc-toolbar">
        <div className="sc-seg">
          <button className={view === "week" ? "on" : ""} onClick={() => applyPreset("week")}>周</button>
          <button className={view === "twoweek" ? "on" : ""} onClick={() => applyPreset("twoweek")}>两周</button>
          <button className={view === "month" ? "on" : ""} onClick={() => applyPreset("month")}>本月</button>
        </div>
        <div className="sc-datepick">
          <input type="date" value={from} onChange={(e) => { setView("custom"); setFrom(e.target.value); }} aria-label="起始日期" />
          <span>～</span>
          <input type="date" value={to} onChange={(e) => { setView("custom"); setTo(e.target.value); }} aria-label="结束日期" />
        </div>
        <button className="sc-today" onClick={backToday}>回今天</button>
        {loading && <span className="sc-loading">⏳ 加载中…</span>}
        {err && <span className="sc-err">{err}</span>}
      </div>

      {/* 图例 */}
      <div className="sc-legend">
        <span className="chip"><i className="sw sc-spray" />喷油（手喷/自动喷）</span>
        <span className="chip"><i className="sw sc-print" />移印</span>
        <span className="chip"><i className="sw sc-uv" />UV</span>
        <span className="chip"><i className="sw dot sc-bg-ok" />未满</span>
        <span className="chip"><i className="sw dot sc-bg-busy" />快满(≥90%)</span>
        <span className="chip"><i className="sw dot sc-bg-over" />超载(&gt;100%)</span>
      </div>

      <div className="sc-wrap">
        <table className="sc-table">
          <colgroup>
            <col style={{ width: 70 }} />
            {lines.map((l) => <col key={l.lineId} />)}
          </colgroup>
          <thead>
            <tr>
              <th>日期</th>
              {lines.map((l) => (
                <th key={l.lineId}>{l.name}<small>{l.craftType}{l.dailyLimit > 0 ? ` · 上限${(l.dailyLimit / 10000)}万` : " · 不卡"}</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const d = parseYmd(date);
              const we = d.getDay() === 0 || d.getDay() === 6;
              return (
                <tr key={date}>
                  <td className={`sc-daycol${we ? " we" : ""}`}>周{WEEKNAME[d.getDay()]}<small>{d.getMonth() + 1}-{pad2(d.getDate())}</small></td>
                  {lines.map((l) => {
                    const cell = grid[cellKey(date, l.lineId)];
                    if (!cell) return <td key={l.lineId} className="sc-cell"><div className="sc-blank">空</div></td>;
                    const lvl = cell.level;
                    return (
                      <td key={l.lineId} className="sc-cell">
                        <div className={`sc-mini${lvl ? " " + MINI_BG[lvl] : ""}`}>
                          <span>{cell.count}款</span>
                          <span className={lvl ? MINI_TX[lvl] : ""}>
                            {cell.total.toLocaleString()}{cell.occupancyPct != null ? ` · ${cell.occupancyPct}%` : ""}{lvl === "over" ? " ⚠" : ""}
                          </span>
                        </div>
                        <ul className="sc-items">
                          {cell.items.map((it, i) => (
                            <li key={i}>
                              <button
                                type="button"
                                className={`sc-plan sc-${it.color}`}
                                aria-label={`查看 ${it.partName} 计划详情`}
                                onClick={() => setDetail({ date, line: l, item: it })}
                              >
                                <span className="nm">{it.partName}</span>
                                <span className="qd">{it.qty.toLocaleString()}<span className="dao">道{it.stepNo}</span></span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length === 0 && !loading && <p className="sc-empty">没有启用的拉别，请先到基础数据库维护拉别。</p>}
      </div>

      {detail && (
        <div className="sc-modal" onClick={() => setDetail(null)}>
          <div className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-detail-title" onClick={(e) => e.stopPropagation()}>
            <div className="sc-dialog-hd">
              <div>
                <p className="sc-dialog-eyebrow">排期总览 · 计划详情</p>
                <h3 id="sc-detail-title">{detail.item.partName}</h3>
              </div>
              <button type="button" className="sc-close" aria-label="关闭" onClick={() => setDetail(null)}>×</button>
            </div>
            <div className="sc-detail-top">
              <span>{detail.date} · 周{WEEKNAME[parseYmd(detail.date).getDay()]}</span>
              <span>{detail.line.name}</span>
              <span>{detail.item.craft} · 道{detail.item.stepNo}</span>
            </div>
            <dl className="sc-detail-grid">
              <div><dt>货号</dt><dd>{detail.item.productNo || "-"}</dd></div>
              <div><dt>部位</dt><dd>{detail.item.partName || "-"}</dd></div>
              <div><dt>计划生产数</dt><dd>{detail.item.qty.toLocaleString()}</dd></div>
              <div><dt>机台号</dt><dd>{detail.item.machineNos.join("、") || "-"}</dd></div>
              <div><dt>人数</dt><dd>{detail.item.workerCount || "-"}</dd></div>
              <div><dt>拉别产能上限</dt><dd>{detail.line.dailyLimit > 0 ? `${(detail.line.dailyLimit / 10000)}万` : "不卡"}</dd></div>
            </dl>
            <div className="sc-dialog-ft">
              {onAdjustPlan && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onAdjustPlan({ planId: detail.item.id, date: detail.date, lineId: detail.line.lineId });
                    setDetail(null);
                  }}
                >
                  去周排调整
                </button>
              )}
              <button type="button" onClick={() => setDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 看板样式（sc- 前缀作用域隔离；照 mockup supervisor-grid-v4 + 项目薄荷绿系）
const CSS = `
  .sc { color:#374151; font-size:13px; }
  .sc-alerts { display:flex; gap:10px; flex-wrap:wrap; margin:0 0 12px; }
  .sc-alert { border:1px solid transparent; border-radius:10px; padding:8px 12px; display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; }
  .sc-alert b { min-width:22px; height:22px; padding:0 7px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-variant-numeric:tabular-nums; }
  .sc-alert.normal { background:#ecfdf5; border-color:#d1fae5; color:#047857; }
  .sc-alert.normal b { background:#34d399; }
  .sc-alert.urgent { background:#fdf2f4; border-color:#f4b7be; color:#c91d32; }
  .sc-alert.urgent b { background:#e88ea0; }
  .sc-alert:hover { filter:brightness(.98); box-shadow:0 1px 4px rgba(15,23,42,.08); }
  .sc-sub { color:#94a3b8; font-size:12.5px; margin:0 0 14px; line-height:1.7; }
  .sc-sub b { color:#475569; }
  .sc-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
  .sc-seg { display:inline-flex; border:1px solid #E0E0E0; border-radius:10px; overflow:hidden; }
  .sc-seg button { border:none; background:#fff; padding:7px 16px; font-size:13px; color:#6b7280; cursor:pointer; }
  .sc-seg button.on { background:#ecfdf5; color:#047857; font-weight:600; }
  .sc-datepick { display:inline-flex; align-items:center; gap:7px; color:#64748b; font-size:13px; }
  .sc-datepick input { width:138px; height:32px; border:1px solid #E0E0E0; background:#fff; border-radius:8px; padding:0 8px; color:#374151; font:inherit; font-variant-numeric:tabular-nums; }
  .sc-datepick input:focus { outline:none; border-color:#34d399; box-shadow:0 0 0 2px rgba(52,211,153,.16); }
  .sc-today { border:1px solid #E0E0E0; background:#fff; border-radius:8px; padding:6px 12px; font-size:12px; color:#6b7280; cursor:pointer; }
  .sc-loading { color:#94a3b8; font-size:12px; }
  .sc-err { color:#C91D32; font-size:12px; }
  .sc-legend { display:flex; gap:14px; flex-wrap:wrap; align-items:center; font-size:12px; color:#94a3b8; margin-bottom:12px; }
  .sc-legend .chip { display:inline-flex; align-items:center; gap:6px; }
  .sc-legend .sw { width:14px; height:12px; border-radius:3px; display:inline-block; }
  .sc-legend .sw.dot { border-radius:3px; }
  .sc-legend .sc-spray { background:#34d399; } .sc-legend .sc-print { background:#60a5fa; } .sc-legend .sc-uv { background:#a78bfa; }

  .sc-wrap { border:1px solid #E0E0E0; border-radius:12px; overflow:auto; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  table.sc-table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; min-width:640px; }
  .sc-table th, .sc-table td { border-right:1px solid #f1f5f9; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  .sc-table th { background:#f0fdf4; color:#047857; font-size:13px; font-weight:600; padding:10px 8px; text-align:center; position:sticky; top:0; z-index:2; }
  .sc-table th small { display:block; color:#9ca3af; font-weight:400; font-size:11px; margin-top:2px; }
  td.sc-daycol { width:70px; background:#fafdfb; text-align:center; font-weight:700; color:#374151; font-size:14px; vertical-align:middle; }
  td.sc-daycol.we { background:#f0f7f4; color:#64748b; }
  td.sc-daycol small { display:block; color:#9ca3af; font-weight:400; font-size:11px; margin-top:3px; }

  .sc-cell { padding:0; }
  .sc-mini { padding:6px 9px; font-size:11px; font-weight:700; border-bottom:1px solid #eef0f2; display:flex; justify-content:space-between; gap:6px; color:#64748b; }
  .sc-mini.sc-bg-ok { background:#f0fdf4; } .sc-mini.sc-bg-busy { background:#fffbeb; } .sc-mini.sc-bg-over { background:#fef2f2; }
  .sc-ut-ok { color:#047857; } .sc-ut-busy { color:#b45309; } .sc-ut-over { color:#b91c1c; }
  ul.sc-items { list-style:none; margin:0; padding:5px 6px; max-height:170px; overflow-y:auto; }
  ul.sc-items li { margin-bottom:2px; }
  .sc-plan { width:100%; border:1px solid transparent; display:flex; justify-content:space-between; gap:6px; padding:3px 6px; border-radius:5px; font:inherit; font-size:12px; cursor:pointer; text-align:left; transition:border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
  .sc-plan:hover { border-color:#bbf7d0; box-shadow:0 1px 4px rgba(4,120,87,.12); transform:translateY(-1px); }
  .sc-plan:focus-visible { outline:2px solid #34d399; outline-offset:1px; }
  .sc-plan .nm { color:#374151; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sc-plan .qd { white-space:nowrap; color:#111827; font-weight:600; font-variant-numeric:tabular-nums; }
  .sc-plan .dao { font-size:9px; padding:0 4px; border-radius:5px; color:#fff; margin-left:3px; }
  .sc-spray { background:#ecfdf5; } .sc-spray .dao { background:#34d399; }
  .sc-print { background:#eff6ff; } .sc-print .dao { background:#60a5fa; }
  .sc-uv { background:#f5f3ff; } .sc-uv .dao { background:#a78bfa; }
  .sc-other { background:#f8fafc; } .sc-other .dao { background:#94a3b8; }
  .sc-blank { color:#d1d5db; text-align:center; padding:18px 0; font-size:12px; }
  .sc-empty { padding:24px; text-align:center; color:#94a3b8; font-size:13px; }
  .sc-modal { position:fixed; inset:0; background:rgba(15,23,42,.28); z-index:50; display:flex; align-items:center; justify-content:center; padding:18px; }
  .sc-dialog { width:min(520px, 100%); background:#fff; border:1px solid #d1fae5; border-radius:12px; box-shadow:0 18px 45px rgba(15,23,42,.18); overflow:hidden; }
  .sc-dialog-hd { background:#f0fdf4; border-bottom:1px solid #dcfce7; padding:16px 18px; display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
  .sc-dialog-eyebrow { margin:0 0 5px; color:#059669; font-size:12px; font-weight:600; }
  .sc-dialog h3 { margin:0; color:#111827; font-size:18px; line-height:1.35; }
  .sc-close { border:none; background:#fff; color:#64748b; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:20px; line-height:28px; box-shadow:0 1px 2px rgba(15,23,42,.08); }
  .sc-close:hover { color:#047857; background:#ecfdf5; }
  .sc-detail-top { display:flex; flex-wrap:wrap; gap:8px; padding:12px 18px 0; }
  .sc-detail-top span { background:#ecfdf5; color:#047857; border:1px solid #d1fae5; border-radius:999px; padding:4px 9px; font-size:12px; font-weight:600; }
  .sc-detail-grid { margin:14px 18px 18px; display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .sc-detail-grid div { border:1px solid #eef2f7; background:#fbfefc; border-radius:8px; padding:10px 12px; min-width:0; }
  .sc-detail-grid dt { color:#94a3b8; font-size:12px; margin-bottom:5px; }
  .sc-detail-grid dd { margin:0; color:#111827; font-weight:700; font-size:14px; word-break:break-all; }
  .sc-dialog-ft { border-top:1px solid #eef2f7; padding:12px 18px; display:flex; gap:10px; justify-content:flex-end; background:#fff; }
  .sc-dialog-ft button { border:1px solid #d1fae5; background:#ecfdf5; color:#047857; border-radius:8px; padding:7px 16px; font-weight:600; cursor:pointer; }
  .sc-dialog-ft button:hover { background:#d1fae5; }
  .sc-dialog-ft button.primary { border-color:#34d399; background:#34d399; color:#fff; }
  .sc-dialog-ft button.primary:hover { background:#10b981; }
  @media (max-width: 560px) {
    .sc-detail-grid { grid-template-columns:1fr; }
    .sc-dialog { max-height:calc(100vh - 32px); overflow:auto; }
  }
`;
