"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CATS = ["手喷", "移印", "自动喷", "UV"] as const;

type PreviewPart = {
  itemName: string; partName: string; craftDetail: string; category: string | null;
  dailyCapacity: number; stdMachineCount: number;
  laborPrice: number; unitCost: number; paintCost: number; quotedPrice: number; remark: string | null;
};
type PreviewProduct = {
  sheetName: string; productNo: string; suggestedItemName: string; isThreeLevel: boolean;
  duplicate: boolean; parts: PreviewPart[];
};
type Unrecognized = { sheetName: string; reason: string };
type PreviewResp = {
  products: PreviewProduct[]; unrecognized: Unrecognized[];
  normalCount: number; pendingCraftCount: number; duplicateCount: number;
};

const partKey = (pi: number, ti: number) => `${pi}-${ti}`;

// 导入按钮（自带弹窗开关）—— 放在产品核价表页头「+ 新建产品」旁，经典蓝主色
export function ImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-4 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(37,99,235,0.30)]">
        📥 导入核价表
      </button>
      {open && <ImportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [crafts, setCrafts] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Record<string, string>>({});
  // 取某部位当前子件名（用户改过用改后的，否则用自动猜的）
  const itemOf = (pi: number, ti: number, fallback: string) => items[partKey(pi, ti)] ?? fallback;

  async function doPreview() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr("请先选择 Excel 文件"); return; }
    setBusy(true); setErr("");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await apiFetch("/api/products/import/preview", { method: "POST", body: fd });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "解析失败"); return; }
      setPreview(await res.json());
    } catch {
      setErr("网络错误，请确认后端服务是否运行，然后重试");
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    if (!preview) return;
    for (let pi = 0; pi < preview.products.length; pi++) {
      const prod = preview.products[pi];
      if (prod.duplicate) continue;   // 重复货号直接跳过
      for (let ti = 0; ti < prod.parts.length; ti++) {
        const pt = prod.parts[ti];
        const resolved = pt.category ?? crafts[partKey(pi, ti)];
        if (!resolved) { setErr(`还有未指定大类的工序：${prod.productNo} / ${pt.partName}`); return; }
      }
    }
    // 先带上原始下标再过滤，避免 indexOf 在 preview 被复制/重建时返回 -1 导致工序类别静默丢失
    const products = preview.products
      .map((p, pi) => ({ p, pi }))
      .filter(({ p }) => !p.duplicate)
      .map(({ p, pi }) => ({
        productNo: p.productNo,
        parts: p.parts
          .map((pt, ti) => ({ ...pt, _cat: pt.category ?? crafts[partKey(pi, ti)], _item: itemOf(pi, ti, pt.itemName) }))
          .filter((pt) => pt._cat !== "__skip__")
          .map((pt) => ({
            itemName: pt._item, partName: pt.partName,
            craft: pt._cat, craftDetail: pt.craftDetail,
            dailyCapacity: pt.dailyCapacity, stdMachineCount: pt.stdMachineCount,
            laborPrice: pt.laborPrice, unitCost: pt.unitCost, paintCost: pt.paintCost, quotedPrice: pt.quotedPrice,
            remark: pt.remark,
          })),
      }))
      .filter((p) => p.parts.length > 0);

    setBusy(true); setErr("");
    try {
      const res = await apiFetch("/api/products/import/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products }),
      });
      if (!res.ok) { setErr("导入失败，请重试"); return; }
      const r = await res.json();
      alert(`导入完成：成功 ${r.created} 个，跳过 ${r.skipped} 个`);
      onClose();
      router.refresh();
    } catch {
      setErr("网络错误，请确认后端服务是否运行，然后重试");
    } finally {
      setBusy(false);
    }
  }

  const pending = preview
    ? preview.products.flatMap((p, pi) =>
        p.parts.map((pt, ti) => ({ pi, ti, p, pt })).filter((x) => x.pt.category === null))
    : [];

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 overflow-auto py-8">
      <div className="bg-white rounded-card border border-app-border w-[1000px] max-w-[95vw] p-6 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">📥 导入核价表 · 预览确认</h2>
          <button onClick={onClose} aria-label="关闭" className="text-text-secondary hover:text-text">✕</button>
        </div>

        {!preview ? (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">选择核价表 Excel（.xlsx）。导入前请把表头改成标准叫法（货号/货名/位置/工序/目标数/人数/工价/核价/油漆价/报价/备注）、取消合并并填满、删掉"相差/合计"行。</p>
            <input ref={fileRef} type="file" accept=".xlsx" className="block text-sm" />
            {err && <p className="text-sm text-rose">{err}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">取消</button>
              <button disabled={busy} onClick={doPreview} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold disabled:opacity-50">{busy ? "解析中…" : "解析预览"}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-[#f0fdf4] border border-[#d1fae5] rounded-btn px-4 py-3 text-sm">
              <span className="text-mint-700 font-semibold">✅ {preview.normalCount} 个产品识别正常，将直接导入（待审核）</span>
              <span className="text-text-tertiary">｜</span>
              <span className="text-rose font-semibold">⚠ 待判断工序 {preview.pendingCraftCount} · 重复 {preview.duplicateCount} · 未识别 {preview.unrecognized.length}</span>
            </div>

            {preview.products.filter((p) => !p.duplicate).length > 0 && (
              <div>
                <div className="text-sm font-semibold text-[#2563EB] mb-2 pb-1 border-b border-[#E0E0E0]">
                  ✎ 子件分组确认（货名作部位名，子件可改；同名归同一子件）
                </div>
                {preview.products.map((prod, pi) => prod.duplicate ? null : (
                  <div key={pi} className="mb-4">
                    <div className="text-xs text-text-secondary mb-1">
                      货号 <span className="font-mono font-semibold text-text">{prod.productNo}</span>
                      {prod.isThreeLevel && <span className="ml-2 text-text-tertiary">（三层表·子件来自表格，可不改）</span>}
                    </div>
                    <datalist id={`items-${pi}`}>
                      {Array.from(new Set(prod.parts.map((pt, ti) => itemOf(pi, ti, pt.itemName)).filter(Boolean)))
                        .map((nm) => <option key={nm} value={nm} />)}
                    </datalist>
                    <table className="w-full text-sm">
                      <thead className="bg-[#5B9BD5] text-white text-xs"><tr>
                        <th className="px-3 py-2 text-left w-[40%]">子件（可改）</th>
                        <th className="px-3 py-2 text-left">部位（货名原文）</th>
                        <th className="px-3 py-2 text-left w-[20%]">工序</th>
                      </tr></thead>
                      <tbody>
                        {prod.parts.map((pt, ti) => (
                          <tr key={partKey(pi, ti)} className="border-b border-[#E0E0E0]">
                            <td className="px-3 py-1.5">
                              <input list={`items-${pi}`}
                                value={itemOf(pi, ti, pt.itemName)}
                                onChange={(e) => setItems({ ...items, [partKey(pi, ti)]: e.target.value })}
                                className="border border-[#E0E0E0] rounded px-2 py-1 text-sm w-full focus:border-[#2563EB] outline-none" />
                            </td>
                            <td className="px-3 py-1.5 text-text">{pt.partName}</td>
                            <td className="px-3 py-1.5 text-text-secondary">{pt.craftDetail || "（空白）"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {pending.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-rose mb-2 pb-1 border-b border-[#f3d0d6]">⚠ 待人工判断的工序（{pending.length}）</div>
                <table className="w-full text-sm">
                  <thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr>
                    <th className="px-3 py-2 text-left">货号</th><th className="px-3 py-2 text-left">子件</th><th className="px-3 py-2 text-left">部位</th><th className="px-3 py-2 text-left">原工序</th><th className="px-3 py-2 text-left">归到大类</th>
                  </tr></thead>
                  <tbody>
                    {pending.map(({ pi, ti, p, pt }) => (
                      <tr key={partKey(pi, ti)}>
                        <td className="px-3 py-2 font-mono">{p.productNo}</td>
                        <td className="px-3 py-2">{pt.itemName || "（主体）"}</td>
                        <td className="px-3 py-2">{pt.partName}</td>
                        <td className="px-3 py-2"><span className="bg-[#F4B7BE] text-[#C91D32] font-semibold px-2 py-0.5 rounded">{pt.craftDetail || "（空白）"}</span></td>
                        <td className="px-3 py-2">
                          <select value={crafts[partKey(pi, ti)] ?? ""} onChange={(e) => setCrafts({ ...crafts, [partKey(pi, ti)]: e.target.value })}
                            className="border border-[#C91D32] rounded text-[#C91D32] text-xs px-2 py-1">
                            <option value="">请选大类…</option>
                            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                            <option value="__skip__">✗ 非喷油工序·不导入此行</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.products.some((p) => p.duplicate) && (
              <div>
                <div className="text-sm font-semibold text-rose mb-2 pb-1 border-b border-[#f3d0d6]">⚠ 重复货号（系统已存在，将跳过）</div>
                {preview.products.map((p, pi) => p.duplicate && (
                  <div key={pi} className="flex items-center gap-3 border border-app-border rounded-btn px-3 py-2 mb-2 bg-[#fafafa]">
                    <span className="bg-[#F4B7BE] text-[#C91D32] text-xs px-2 py-0.5 rounded-full">重复</span>
                    <span className="font-mono font-semibold">{p.productNo}</span>
                    <span className="text-text-tertiary text-xs">· 系统中已存在，本次跳过</span>
                  </div>
                ))}
              </div>
            )}

            {preview.unrecognized.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-text-secondary mb-2 pb-1 border-b border-[#e5e5e5]">⊘ 未识别的 sheet（已跳过）</div>
                {preview.unrecognized.map((u, i) => (
                  <div key={i} className="flex items-center gap-3 border border-app-border rounded-btn px-3 py-2 mb-2 bg-[#fafafa]">
                    <span className="bg-[#e5e5e5] text-[#777] text-xs px-2 py-0.5 rounded-full">跳过</span>
                    <span className="font-mono font-semibold text-text-secondary">{u.sheetName}</span>
                    <span className="text-text-tertiary text-xs">· {u.reason}</span>
                  </div>
                ))}
              </div>
            )}

            {err && <p className="text-sm text-rose">{err}</p>}
            <div className="flex justify-end items-center pt-2 border-t border-app-border">
              <div className="flex gap-3">
                <button onClick={() => setPreview(null)} className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">重选文件</button>
                <button disabled={busy} onClick={doCommit} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold disabled:opacity-50">{busy ? "导入中…" : "✓ 确认导入"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
