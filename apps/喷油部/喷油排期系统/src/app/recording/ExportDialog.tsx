"use client";
import { apiFetch } from "@/lib/apiFetch";
// 导出日报表弹窗：选计划版/实际版 + 按拉别手填「表头人数说明」「杂工明细」，POST 拉取 xlsx 下载。
// 备注临时填、不持久化（每次打开都空）。生产人数合计/上班人数等数字字段留待第二批（人数捆）。
import { useState } from "react";

export default function ExportDialog({ date, lines }: { date: string; lines: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"plan" | "actual">("plan");
  // 备注按拉别 id 存（与后端按 lineId 匹配一致，避免显示名对不上丢备注）
  const [notes, setNotes] = useState<Record<number, { header: string; misc: string }>>({});
  const [busy, setBusy] = useState(false);

  async function doExport() {
    setBusy(true);
    try {
      const lineNotes = lines.map((l) => ({
        lineId: l.id, headerText: notes[l.id]?.header ?? "", miscText: notes[l.id]?.misc ?? "",
      }));
      const resp = await apiFetch("/api/recording/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, mode, lineNotes }),
      });
      if (!resp.ok) { alert(`导出失败（${resp.status}）`); return; }  // 防把错误响应当损坏 xlsx 下载
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `recording-${date}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="ml-2 rounded-btn bg-mint-400 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-mint-700">
        📥 导出 Excel
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setOpen(false)}>
          <div className="max-h-[80vh] w-[560px] overflow-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-[16px] font-bold text-text">导出日报表 · {date}</h3>
            <div className="mb-3 flex flex-col gap-1.5 text-[13px] text-text-secondary">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={mode === "plan"} onChange={() => setMode("plan")} />
                计划版（下班前发次日计划，不含生产数）
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={mode === "actual"} onChange={() => setMode("actual")} />
                实际版（次日早上发昨日实际，含生产数）
              </label>
            </div>
            {lines.length === 0 && (
              <p className="mb-3 text-[13px] text-text-tertiary">当天无排期行，导出将为空表。</p>
            )}
            {lines.map((l) => (
              <div key={l.id} className="mb-3 rounded-md border border-app-border p-3">
                <div className="mb-1.5 text-[13px] font-semibold text-mint-700">{l.label}</div>
                <input placeholder="表头人数说明（如：35人，借出B拉2人…实际29人）"
                  className="mb-1.5 w-full rounded-md border border-app-border px-2 py-1 text-[13px]"
                  value={notes[l.id]?.header ?? ""}
                  onChange={(e) => setNotes((p) => ({ ...p, [l.id]: { header: e.target.value, misc: p[l.id]?.misc ?? "" } }))} />
                <textarea placeholder="杂工明细（如：做板2人，调机师傅1人…）" rows={2}
                  className="w-full rounded-md border border-app-border px-2 py-1 text-[13px]"
                  value={notes[l.id]?.misc ?? ""}
                  onChange={(e) => setNotes((p) => ({ ...p, [l.id]: { header: p[l.id]?.header ?? "", misc: e.target.value } }))} />
              </div>
            ))}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setOpen(false)}
                className="rounded-btn border border-app-border px-4 py-1.5 text-[13px] text-text hover:bg-[#f3f4f6]">取消</button>
              <button disabled={busy} onClick={doExport}
                className="rounded-btn bg-mint-400 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-mint-700 disabled:opacity-40">
                {busy ? "生成中…" : "生成并下载"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
