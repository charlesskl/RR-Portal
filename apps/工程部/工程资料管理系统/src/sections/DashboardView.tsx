/**
 * 放产态势大盘（EPMS 首页）：全部项目的资料完成度一览，按 Stitch 设计稿风格。
 * 数据来自 /api/dashboard（实时扫描资料库）。
 */
import { useEffect, useState } from "react";
import { FolderKanban, Gauge, AlertTriangle, CheckCircle2, Clock3, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { Dashboard, DashboardProject, View } from "@/types";

const DOC_NAMES = ["作业指导书", "外购件清单", "排模表", "排模图", "生产注意事项"];
const DOC_SHORT = ["指导书", "外购单", "排模表", "排模图", "注意事项"];

function timeAgo(ts: number): string {
  if (!ts) return "-";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export default function DashboardView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.dashboard().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="p-8 text-center text-red-400">加载失败：{err}</div>;
  if (!data) return <div className="p-8 text-center text-slate-500">正在扫描资料库…</div>;

  const { stats } = data;
  const incomplete = data.projects.filter((p) => p.done < p.total);
  const recent = data.projects.slice(0, 8);

  return (
    <div className="p-5">
      {/* 顶部统计卡 */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: FolderKanban, label: "推进中产项目", value: stats.projects, sub: `${stats.complete} 个资料已齐`, color: "text-cyan-400" },
          { icon: Gauge, label: "工程资料受控齐备度", value: `${stats.readiness}%`, sub: "五类资料覆盖", color: "text-emerald-400" },
          { icon: AlertTriangle, label: "资料待补齐项目", value: stats.incomplete, sub: "点击进入补做", color: "text-amber-400" },
          { icon: Clock3, label: "最近更新", value: recent[0] ? timeAgo(recent[0].mtime) : "-", sub: recent[0]?.project || "", color: "text-sky-400" },
        ].map((c, i) => (
          <div key={i} className="rounded-lg border border-[#1e2d4a] bg-[#111c30] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              {c.label} <c.icon className={`h-4 w-4 ${c.color}`} />
            </div>
            <div className={`mt-1 text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        {/* 资料健康度矩阵 */}
        <div className="rounded-lg border border-[#1e2d4a] bg-[#111c30]">
          <div className="flex items-center justify-between border-b border-[#1e2d4a] px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-100">项目放产资料健康度矩阵</span>
            <span className="text-xs text-slate-500">● 齐 ◐ 缺 · 点击行进入项目</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#111c30]">
                <tr className="border-b border-[#26375a] text-left text-xs text-slate-400">
                  <th className="px-4 py-2">项目</th>
                  {DOC_SHORT.map((d) => <th key={d} className="py-2 text-center">{d}</th>)}
                  <th className="px-3 py-2 text-right">完成度</th>
                  <th className="px-3 py-2 text-right">更新</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <ProjectRow key={p.path} p={p} onNavigate={onNavigate} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右栏：待补清单 */}
        <div className="rounded-lg border border-[#1e2d4a] bg-[#111c30]">
          <div className="border-b border-[#1e2d4a] px-4 py-2.5 text-sm font-semibold text-amber-400">
            资料待补齐（{incomplete.length}）
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {incomplete.length === 0 && (
              <div className="flex items-center gap-2 p-4 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> 全部项目资料已齐
              </div>
            )}
            {incomplete.map((p) => {
              const missing = DOC_NAMES.filter((d) => !p.docs[d]);
              return (
                <button key={p.path}
                  onClick={() => onNavigate({ type: "project", client: p.client, year: p.year, project: p.project })}
                  className="w-full rounded px-2 py-2 text-left hover:bg-[#16233d]">
                  <div className="flex items-center justify-between text-sm text-slate-200">
                    <span className="truncate">{p.project}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {p.client} · 缺：{missing.join("、")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectRow({ p, onNavigate }: { p: DashboardProject; onNavigate: (v: View) => void }) {
  const pct = Math.round((p.done / p.total) * 100);
  return (
    <tr
      className="cursor-pointer border-b border-[#1a2947] hover:bg-[#16233d]"
      onClick={() => onNavigate({ type: "project", client: p.client, year: p.year, project: p.project })}
    >
      <td className="px-4 py-2">
        <div className="text-slate-200">{p.project}</div>
        <div className="text-xs text-slate-500">{p.client} / {p.year}</div>
      </td>
      {DOC_NAMES.map((d) => (
        <td key={d} className="py-2 text-center">
          {p.docs[d]
            ? <span className="text-emerald-400">●</span>
            : <span className="text-slate-600">○</span>}
        </td>
      ))}
      <td className="px-3 py-2 text-right">
        <span className={pct === 100 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400"}>
          {pct}%
        </span>
      </td>
      <td className="px-3 py-2 text-right text-xs text-slate-500">{timeAgo(p.mtime)}</td>
    </tr>
  );
}
