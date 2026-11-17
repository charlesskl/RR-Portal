"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { filterProducts, PRODUCT_STATUS_META } from "@/lib/product";
import FactoryMovePanel from "./FactoryMovePanel";

// 列表行结构（与 page.tsx 取数后传入的字段一致）
export type ProductRow = {
  id: number;
  productNo: string;
  status: string;            // draft 待审核 / active 已生效 / archived 作废
  partCount: number;
  totalUnitCost: number;     // 核价合计
  totalPaintCost: number;    // 油漆合计
  totalQuotedPrice: number;
  lastUpdatedBy: string | null;
  updatedAt: string;
};

export function ProductsTable({ products, isAdmin, canMoveFactory = false, factoryId = "XINGXIN" }: { products: ProductRow[]; isAdmin: boolean; canMoveFactory?: boolean; factoryId?: string }) {
  const router = useRouter();
  const [kw, setKw] = useState("");
  const [view, setView] = useState<"normal" | "recycle">("normal");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [movedIds, setMovedIds] = useState<number[]>([]);
  const [moveNotice, setMoveNotice] = useState("");
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sprayplan:product-factory-move");
      if (!raw) return;
      sessionStorage.removeItem("sprayplan:product-factory-move");
      const saved = JSON.parse(raw);
      if (saved.factoryId === factoryId && Date.now() - saved.at < 60_000) setMoveNotice(saved.message);
    } catch { /* 提示缓存不可用不影响迁移结果。 */ }
  }, [factoryId]);
  function factoryMoved() {
    const targetName = factoryId === "HUADENG" ? "兴信" : "华登";
    const message = `已将 ${selected.length} 个产品核价表移至${targetName}，请切换到${targetName}厂区查看。`;
    setMoveNotice(message); setMovedIds(ids => [...ids, ...selected]); setSelected([]);
    try { sessionStorage.setItem("sprayplan:product-factory-move", JSON.stringify({ factoryId, message, at: Date.now() })); } catch { /* 已保存，提示保留在当前页面。 */ }
    router.refresh();
  }

  const currentProducts = products.filter(p => !movedIds.includes(p.id));
  const recycleCount = currentProducts.filter((p) => p.status === "archived").length;
  // 正常视图=非作废；回收站视图=作废
  const base = currentProducts.filter((p) => (view === "recycle" ? p.status === "archived" : p.status !== "archived"));
  const rows = filterProducts(base, kw);

  async function archive(id: number, no: string) {
    if (!confirm(`确认作废产品「${no}」？作废后可在回收站恢复。`)) return;
    setBusy(true);
    const res = await apiFetch(`/api/products/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh(); else alert("作废失败，请重试");
  }
  async function restore(id: number, no: string) {
    if (!confirm(`确认恢复产品「${no}」？将回到「待审核」状态，需重新审核生效。`)) return;
    setBusy(true);
    const res = await apiFetch(`/api/products/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "draft" }),
    });
    setBusy(false);
    if (res.ok) router.refresh(); else alert("恢复失败，请重试");
  }

  async function emptyRecycleBin() {
    if (!confirm(`确认永久清空核价回收站？\n\n将删除 ${recycleCount} 个已作废货号；仍被订单引用的货号会自动保留。此操作无法撤销。`)) return;
    setBusy(true);
    const res = await apiFetch("/api/products/recycle-bin", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert(body.error || "清空失败，请重试");
    if (body.skipped > 0) alert(`已永久删除 ${body.deleted} 个货号；另有 ${body.skipped} 个仍被订单引用，已安全保留。`);
    router.refresh();
  }

  return (
    <div>
      {/* 搜索 + 回收站入口按钮 */}
      <div className="mb-4 flex items-center gap-3">
        <input
          value={kw}
          disabled={busy}
          onChange={(e) => { setKw(e.target.value); setSelected([]); }}
          placeholder="🔍 搜货号"
          className="w-72 border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400"
        />
        {canMoveFactory && <button disabled={busy} onClick={() => setMoveOpen(value => !value)} className="rounded-btn border border-mint-400 px-3 py-2 text-sm text-mint-700 disabled:opacity-40">批量修改所属厂区（{selected.length}）</button>}
        {view === "normal" ? (
          <button disabled={busy} onClick={() => { setView("recycle"); setKw(""); setSelected([]); }}
            className="ml-auto text-sm border border-app-border rounded-btn px-3 py-2 text-text-secondary hover:border-text-tertiary">
            🗑 回收站（{recycleCount}）
          </button>
        ) : (
          <button disabled={busy} onClick={() => { setView("normal"); setKw(""); setSelected([]); }}
            className="ml-auto text-sm border border-mint-400 rounded-btn px-3 py-2 text-mint-700 hover:bg-mint-50">
            ← 返回正常产品
          </button>
        )}
      </div>
      {moveNotice && <p role="status" className="mb-3 rounded-lg bg-mint-50 p-3 text-sm text-mint-700">{moveNotice}</p>}
      {canMoveFactory && moveOpen && <FactoryMovePanel ids={selected} factoryId={factoryId} busy={busy} onBusyChange={setBusy} onSaved={factoryMoved} />}

      {view === "recycle" && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-secondary">🗑 回收站：这里是已作废的产品，可「恢复」回待审核状态。</p>
          {isAdmin && recycleCount > 0 && <button disabled={busy} onClick={emptyRecycleBin}
            className="text-sm border border-rose/50 text-rose rounded-btn px-3 py-1.5 hover:bg-rose/5 disabled:opacity-50">清空回收站</button>}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-[#ecfdf5] border-l-[3px] border-mint-400 p-4 rounded-btn text-sm text-[#065f46]">
          {view === "recycle"
            ? "回收站是空的。"
            : kw.trim() ? "没有匹配的产品，换个关键词试试。" : "💡 还没有产品。点右上角“+ 新建产品”，对着核价表把第一个货号录进来。"}
        </div>
      ) : (
        <table className="w-full text-sm table-fixed">
          <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
            <tr>
              {canMoveFactory && <th className="w-10 px-2"><input type="checkbox" aria-label="全选当前显示产品" disabled={busy} checked={rows.length > 0 && rows.every(p => selected.includes(p.id))} onChange={e => setSelected(e.target.checked ? rows.map(p => p.id) : [])} /></th>}
              <th className="px-3 py-3 text-left w-[18%]">产品货号</th>
              <th className="px-3 py-3 text-center w-[9%]">部位数</th>
              <th className="px-3 py-3 text-center w-[10%]">总核价</th>
              <th className="px-3 py-3 text-center w-[10%]">总报价</th>
              <th className="px-3 py-3 text-center w-[10%]">状态</th>
              <th className="px-3 py-3 text-center w-[12%]">修改日期</th>
              <th className="px-3 py-3 text-center w-[10%]">修改人</th>
              <th className="px-3 py-3 text-center w-[13%]">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const st = PRODUCT_STATUS_META[p.status] ?? PRODUCT_STATUS_META.draft;
              return (
                <tr key={p.id} className={i % 2 ? "bg-[#fafdfb]" : ""}>
                  {canMoveFactory && <td className="px-2 text-center"><input type="checkbox" aria-label={`选择产品 ${p.productNo}`} disabled={busy} checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /></td>}
                  <td className="px-3 py-3 font-mono">{p.productNo}</td>
                  <td className="px-3 py-3 text-center">{p.partCount ?? 0}</td>
                  <td className="px-3 py-3 text-center">{((p.totalUnitCost ?? 0) + (p.totalPaintCost ?? 0)).toFixed(3)}</td>
                  <td className="px-3 py-3 text-center">{(p.totalQuotedPrice ?? 0).toFixed(3)}</td>
                  <td className="px-3 py-3 text-center"><span className={`text-[11px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span></td>
                  <td className="px-3 py-3 text-center text-text-secondary">{new Date(p.updatedAt).toLocaleDateString("zh-CN")}</td>
                  <td className="px-3 py-3 text-center text-text-secondary">{p.lastUpdatedBy ?? "—"}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex gap-2.5">
                      <Link href={`/products/${p.id}`} className="text-sky hover:underline">查看</Link>
                      {view === "normal" ? (
                        <button disabled={busy} onClick={() => archive(p.id, p.productNo)} className="text-rose hover:underline disabled:opacity-50">作废</button>
                      ) : (
                        <button disabled={busy} onClick={() => restore(p.id, p.productNo)} className="text-mint-400 font-semibold hover:underline disabled:opacity-50">恢复</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
