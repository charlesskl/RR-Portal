/**
 * 放产态势大盘（EPMS 首页）— 按 Stitch 设计稿逐块移植，数据全部真实。
 * 数据：/api/dashboard（实时扫描资料库）。
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Dashboard, DashboardProject, View } from "@/types";

const DOC_NAMES = ["作业指导书", "外购件清单", "排模表", "排模图", "生产注意事项"];

function timeAgo(ts: number): string {
  if (!ts) return "-";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/** 按资料完成度分四个阶段门 */
function stageOf(p: DashboardProject): number {
  const pct = p.done / p.total;
  if (pct >= 1) return 3;
  if (pct >= 0.6) return 2;
  if (pct > 0) return 1;
  return 0;
}
const STAGES = [
  { name: "01. 待启动 · 资料未做", dot: "bg-error" },
  { name: "02. 资料编制中", dot: "bg-tertiary" },
  { name: "03. 收尾补齐中", dot: "bg-secondary" },
  { name: "04. 已齐套放行", dot: "bg-surface-variant" },
];

export default function DashboardView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.dashboard().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="p-8 text-center text-error">加载失败:{err}</div>;
  if (!data) return <div className="p-8 text-center text-on-surface-variant font-body-md">正在扫描资料库…</div>;

  const { stats } = data;
  const weekAgo = Date.now() - 7 * 86400_000;
  const activeWeek = data.projects.filter((p) => p.mtime > weekAgo);
  const incomplete = data.projects.filter((p) => p.done < p.total);
  const worst = incomplete.slice().sort((a, b) => a.done - b.done).slice(0, 3).map((p) => p.project);
  const clients = new Set(data.projects.map((p) => p.client)).size;
  const byStage = STAGES.map((_, i) => data.projects.filter((p) => stageOf(p) === i));

  const go = (p: DashboardProject) =>
    onNavigate({ type: "project", client: p.client, year: p.year, project: p.project });

  return (
    <div className="flex flex-col w-full py-space-lg pb-margin-desktop space-y-space-xl">
      {/* ── Top Operational Context Ribbon ── */}
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-space-md bg-surface-container-low p-space-md rounded shadow-sm">
        <div className="flex items-center gap-space-lg">
          <div className="flex items-center gap-space-xs font-label-md text-label-md text-secondary">
            <span className="w-2 h-2 rounded-full bg-secondary animate-ping"></span>
            <span>REALTIME RADAR ACTIVE</span>
          </div>
          <div className="h-4 w-[1px] bg-surface-container-highest"></div>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            资料库实时扫描: <span className="text-on-surface font-label-md">{stats.projects} 个项目 / {clients} 个客户</span>
          </span>
          <div className="hidden lg:flex items-center gap-space-xs text-on-surface-variant font-body-sm text-body-sm">
            <span className="material-symbols-outlined text-[15px] text-tertiary">security</span>
            <span>受控放产防呆机制: <strong className="text-secondary font-medium">制单台编辑锁已使能</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-space-sm">
          <button
            onClick={() => onNavigate({ type: "clients" })}
            className="px-space-md py-[4px] bg-secondary text-on-secondary text-label-md font-label-md rounded font-semibold hover:bg-secondary-fixed transition-colors flex items-center gap-space-xs"
          >
            <span className="material-symbols-outlined text-[15px]">dataset</span>
            <span>进入资料库做资料</span>
          </button>
        </div>
      </div>

      {/* ── KPI Precision Grid (5-column) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md">
        <Kpi label="推进中放产项目" icon="rocket_launch" iconCls="text-secondary"
          value={<>{stats.projects}<span className="font-body-sm text-body-sm text-on-surface-variant font-normal ml-space-xs">个项目</span></>}
          badge={<span className="font-label-sm text-label-sm text-secondary bg-surface-container px-space-xs py-[2px] rounded font-semibold">{clients} 客户</span>}
          foot={<><span>客户覆盖</span><span className="text-on-surface font-label-md text-label-md">{clients} 客户 / 全部年度</span></>} />
        <Kpi label="资料待补齐项目" icon="flag" iconCls="text-tertiary"
          value={<>{stats.incomplete}<span className="font-body-sm text-body-sm text-on-surface-variant font-normal ml-space-xs">个项目</span></>}
          badge={<span className="font-label-sm text-label-sm text-tertiary bg-tertiary-container px-space-xs py-[2px] rounded">ACTION</span>}
          foot={<><span>焦灼项目:</span><span className="text-tertiary-fixed-dim font-label-sm text-label-sm truncate">{worst.join(", ") || "无"}</span></>} />
        <Kpi label="资料已齐套放行" icon="rate_review" iconCls="text-secondary"
          value={<>{stats.complete}<span className="font-body-sm text-body-sm text-on-surface-variant font-normal ml-space-xs">个项目</span></>}
          badge={<span className="font-label-sm text-label-sm text-secondary bg-surface-container px-space-xs py-[2px] rounded font-semibold">五类齐全</span>}
          foot={<><span>齐套率:</span><span className="text-secondary font-label-md text-label-md">{stats.projects ? Math.round((stats.complete / stats.projects) * 100) : 0}%</span></>} />
        {/* Card 4: 完整度 + 进度条 */}
        <div className="bg-surface-container-low p-space-md rounded shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
            <span>工程资料受控完整度</span>
            <span className="material-symbols-outlined text-secondary text-[16px]">verified_user</span>
          </div>
          <div className="mt-space-md flex items-baseline justify-between">
            <span className="font-headline-xl text-headline-xl text-on-surface font-bold">{stats.readiness}%</span>
            <span className="font-label-sm text-label-sm text-secondary bg-surface-container px-space-xs py-[2px] rounded">五类资料</span>
          </div>
          <div className="mt-space-sm pt-space-xs">
            <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
              <div className="bg-secondary h-full rounded-full" style={{ width: `${stats.readiness}%` }}></div>
            </div>
            <div className="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant mt-1">
              <span>已建资料份数</span>
              <span className="text-secondary font-label-sm text-label-sm">{data.projects.reduce((s, p) => s + p.done, 0)} / {data.projects.reduce((s, p) => s + p.total, 0)}</span>
            </div>
          </div>
        </div>
        <Kpi label="7 天内有更新" icon="difference" iconCls="text-secondary-fixed-dim"
          value={<>{activeWeek.length}<span className="font-body-sm text-body-sm text-on-surface-variant font-normal ml-space-xs">个项目</span></>}
          badge={<span className="font-label-sm text-label-sm text-secondary bg-surface-container px-space-xs py-[2px] rounded">活跃</span>}
          foot={<><span>最近更新:</span><span className="text-secondary font-label-md text-label-md">{data.projects[0] ? timeAgo(data.projects[0].mtime) : "-"}</span></>} />
      </div>

      {/* ── Stage-Gate Kanban ── */}
      <div className="bg-surface-container-low p-space-md rounded shadow-sm flex flex-col space-y-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm bg-surface-container-lowest p-space-sm rounded">
          <div className="flex items-center gap-space-md">
            <div className="p-space-xs bg-surface-container-high rounded text-secondary flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">alt_route</span>
            </div>
            <div>
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">放产资料推进全流程管道</span>
              <span className="ml-space-sm font-label-sm text-label-sm text-on-surface-variant">STAGE-GATE FLOW KANBAN · 按资料完成度分级</span>
            </div>
          </div>
          <div className="flex items-center gap-space-lg">
            <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
              {STAGES.map((s) => (
                <span key={s.name} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`}></span> {s.name.slice(4)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md items-start">
          {STAGES.map((s, i) => (
            <div key={s.name} className="bg-surface-container rounded p-space-sm flex flex-col space-y-space-sm">
              <div className="flex items-center justify-between px-space-xs py-space-xs bg-surface-container-high rounded">
                <span className="font-label-md text-label-md font-bold text-on-surface">{s.name}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-lowest px-space-xs py-[1px] rounded font-semibold">{byStage[i].length} 个项目</span>
              </div>
              {byStage[i].length === 0 && (
                <div className="p-space-md text-center font-label-sm text-label-sm text-on-surface-variant">空</div>
              )}
              {byStage[i].slice(0, 5).map((p) => {
                const pct = Math.round((p.done / p.total) * 100);
                return (
                  <div key={p.path} onClick={() => go(p)}
                    className="bg-surface-container-low p-space-md rounded hover:bg-surface-container-highest transition-colors space-y-space-xs cursor-pointer">
                    <div className="flex items-start justify-between">
                      <span className="font-label-md text-label-md text-on-surface font-semibold">{p.project}</span>
                      <span className="font-label-sm text-label-sm text-secondary px-space-xs py-[1px] bg-surface-container rounded font-bold">{p.year}</span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-1">{p.client}</p>
                    <div className="pt-space-xs flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
                      <span>更新: {timeAgo(p.mtime)}</span>
                      <span>资料: <strong className="text-on-surface">{pct}%</strong></span>
                    </div>
                    <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct === 100 ? "bg-secondary" : "bg-primary"}`} style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                );
              })}
              {byStage[i].length > 5 && (
                <div className="text-center font-label-sm text-label-sm text-on-surface-variant py-space-xs">还有 {byStage[i].length - 5} 个…</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 健康度矩阵 + 右栏 ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-space-md items-start">
        <div className="xl:col-span-2 bg-surface-container-low p-space-md rounded shadow-sm flex flex-col space-y-space-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">项目放产资料健康度与风险矩阵</h3>
              <span className="font-label-sm text-label-sm text-on-surface-variant">RELEASE PACKAGE READINESS &amp; AUDIT MATRIX</span>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant">全部项目 ({data.projects.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-body-sm text-body-sm">
              <thead>
                <tr className="bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md uppercase border-none">
                  <th className="py-space-sm px-space-md">项目 / 客户</th>
                  {DOC_NAMES.map((d) => <th key={d} className="py-space-sm px-space-xs text-center">{d}</th>)}
                  <th className="py-space-sm px-space-sm text-center">完成度</th>
                  <th className="py-space-sm px-space-md text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y-0">
                {data.projects.slice(0, 15).map((p) => {
                  const pct = Math.round((p.done / p.total) * 100);
                  return (
                    <tr key={p.path} onClick={() => go(p)}
                      className="bg-surface-container/50 hover:bg-surface-container-high/80 transition-colors cursor-pointer">
                      <td className="py-space-sm px-space-md">
                        <div className="flex flex-col">
                          <span className="font-label-md text-label-md text-on-surface font-bold">{p.project}</span>
                          <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-tertiary">
                            <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                            <span>{p.client} / {p.year}</span>
                          </div>
                        </div>
                      </td>
                      {DOC_NAMES.map((d) => (
                        <td key={d} className="py-space-sm px-space-xs text-center">
                          {p.docs[d]
                            ? <span className="material-symbols-outlined text-secondary text-[16px]">check_circle</span>
                            : <span className="material-symbols-outlined text-error text-[16px]">radio_button_unchecked</span>}
                        </td>
                      ))}
                      <td className="py-space-sm px-space-sm text-center">
                        <span className={`font-label-md text-label-md font-bold ${pct === 100 ? "text-secondary" : pct >= 60 ? "text-tertiary" : "text-error"}`}>{pct}%</span>
                      </td>
                      <td className="py-space-sm px-space-md text-right">
                        <span className="font-label-sm text-label-sm text-secondary hover:text-secondary-fixed">进入项目</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右栏：待补齐告警 */}
        <div className="bg-surface-container-low p-space-md rounded shadow-sm flex flex-col space-y-space-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-error text-[18px]">notification_important</span>
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">资料待补齐告警 ({incomplete.length})</span>
            </div>
          </div>
          <div className="space-y-space-sm max-h-[420px] overflow-y-auto">
            {incomplete.length === 0 && (
              <div className="p-space-md text-center font-body-sm text-body-sm text-secondary">全部项目资料已齐套 ✅</div>
            )}
            {incomplete.slice(0, 10).map((p) => {
              const missing = DOC_NAMES.filter((d) => !p.docs[d]);
              return (
                <div key={p.path} onClick={() => go(p)}
                  className="bg-surface-container rounded p-space-md hover:bg-surface-container-high transition-colors cursor-pointer space-y-space-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-label-md text-label-md text-on-surface font-semibold">{p.project}</span>
                    <span className="font-label-sm text-label-sm text-error bg-error-container/30 px-space-xs py-[1px] rounded">缺 {missing.length} 项</span>
                  </div>
                  <div className="font-label-sm text-label-sm text-on-surface-variant truncate">
                    {p.client} · 缺:{missing.join("、")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, icon, iconCls, value, badge, foot }: {
  label: string; icon: string; iconCls: string;
  value: React.ReactNode; badge: React.ReactNode; foot: React.ReactNode;
}) {
  return (
    <div className="bg-surface-container-low p-space-md rounded shadow-sm flex flex-col justify-between relative overflow-hidden group">
      <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-secondary/5 rounded-full blur-xl group-hover:bg-secondary/10 transition-all pointer-events-none"></div>
      <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
        <span>{label}</span>
        <span className={`material-symbols-outlined ${iconCls} text-[16px]`}>{icon}</span>
      </div>
      <div className="mt-space-md flex items-baseline justify-between">
        <span className="font-headline-xl text-headline-xl text-on-surface font-bold">{value}</span>
        {badge}
      </div>
      <div className="mt-space-sm pt-space-xs flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
        {foot}
      </div>
    </div>
  );
}
