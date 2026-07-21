"use client";
import { apiFetch } from "@/lib/apiFetch";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { filterProducts, PRODUCT_STATUS_META } from "@/lib/product";

// 列表行结构（与 page.tsx 取数后传入的字段一致）
export type ProductRow = {
  id: number;
  productNo: string;
  status: string;            // draft 待审核 / active 已生效 / archived 作废
  itemCount: number;
  totalUnitCost: number;     // 核价合计
  totalPaintCost: number;    // 油漆合计
  totalQuotedPrice: number;
  lastUpdatedBy: string | null;
  updatedAt: string;
};

export function ProductsTable({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [kw, setKw] = useState("");
  const [view, setView] = useState<"normal" | "recycle">("normal");
  const [busy, setBusy] = useState(false);

  const recycleCount = products.filter((p) => p.status === "archived").length;
  // 正常视图=非作废；回收站视图=作废
  const base = products.filter((p) => (view === "recycle" ? p.status === "archived" : p.status !== "archived"));
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

  return (
    <div>
      {/* 搜索 + 回收站入口按钮 */}
      <div className="mb-4 flex items-center gap-3">
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="🔍 搜货号"
          className="w-72 border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400"
        />
        {view === "normal" ? (
          <button onClick={() => { setView("recycle"); setKw(""); }}
            className="ml-auto text-sm border border-app-border rounded-btn px-3 py-2 text-text-secondary hover:border-text-tertiary">
            🗑 回收站（{recycleCount}）
          </button>
        ) : (
          <button onClick={() => { setView("normal"); setKw(""); }}
            className="ml-auto text-sm border border-mint-400 rounded-btn px-3 py-2 text-mint-700 hover:bg-mint-50">
            ← 返回正常产品
          </button>
        )}
      </div>

      {view === "recycle" && (
        <p className="text-xs text-text-secondary mb-3">🗑 回收站：这里是已作废的产品，可「恢复」回待审核状态。</p>
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
              <th className="px-3 py-3 text-left w-[18%]">产品货号</th>
              <th className="px-3 py-3 text-center w-[9%]">子件数</th>
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
                  <td className="px-3 py-3 font-mono">{p.productNo}</td>
                  <td className="px-3 py-3 text-center">{p.itemCount}</td>
                  <td className="px-3 py-3 text-center">{(p.totalUnitCost + p.totalPaintCost).toFixed(3)}</td>
                  <td className="px-3 py-3 text-center">{p.totalQuotedPrice.toFixed(3)}</td>
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
