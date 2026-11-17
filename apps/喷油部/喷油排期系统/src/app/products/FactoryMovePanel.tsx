"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { invalidateClientCache } from "@/lib/clientCache";

type Item = { id: number; productNo: string; canMove: boolean; reasons: string[] };
type Preview = { previewToken: string; canSave: boolean; items: Item[] };
const names: Record<string, string> = { XINGXIN: "兴信", HUADENG: "华登" };

export default function FactoryMovePanel({ ids, factoryId, busy, onBusyChange, onSaved }: {
  ids: number[]; factoryId: string; busy: boolean; onBusyChange: (value: boolean) => void; onSaved: () => void;
}) {
  const target = factoryId === "HUADENG" ? "XINGXIN" : "HUADENG";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setPreview(null); setError(""); }, [ids, factoryId]);
  async function submit(checkOnly: boolean) {
    onBusyChange(true); setError("");
    try {
      const response = await apiFetch("/api/products/factory-move", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, targetFactoryId: target, preview: checkOnly, previewToken: checkOnly ? undefined : preview?.previewToken }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setPreview(null); throw new Error(body.error || "厂区调整失败，本批未修改，请重新检查"); }
      if (checkOnly) { setPreview(body); return; }
      setPreview(null); invalidateClientCache("/api/products");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "调整失败，请重试"); }
    finally { onBusyChange(false); }
  }
  return <section aria-label="批量修改所属厂区" className="mb-4 rounded-lg border border-mint-400 bg-mint-50 p-4 text-sm">
    <h2 className="font-semibold text-mint-700">管理员批量修改所属厂区</h2>
    <p className="my-2">已选 {ids.length} 个产品：{names[factoryId]} → {names[target]}。先检查，再确认整批调整。已关联订单、排期、库存或入库申请的产品不能直接迁移；目标厂区已有同货号时不会覆盖。</p>
    <button disabled={busy || !ids.length || ids.length > 500} onClick={() => submit(true)} className="rounded-btn border border-mint-400 bg-white px-3 py-2 text-mint-700 disabled:opacity-40">检查所属厂区调整</button>
    {ids.length > 500 && <p className="mt-2 text-red-700">每批最多 500 个产品，请减少选择。</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {preview && <div className="mt-3">
      <p>{preview.canSave ? "检查通过，确认后将从当前厂区列表移出，并出现在目标厂区。" : "本批暂不能保存。请取消勾选下列有冲突或历史引用的产品，再重新检查。"}</p>
      <ul className="my-2 max-h-64 overflow-auto bg-white p-2">{preview.items.map(item => <li key={item.id} className={`border-b p-2 ${item.canMove ? "text-mint-700" : "text-red-700"}`}>{item.productNo}：{item.canMove ? "可调整" : item.reasons.join("；")}</li>)}</ul>
      <button disabled={busy || !preview.canSave} onClick={() => submit(false)} className="rounded-btn bg-mint-400 px-3 py-2 font-semibold text-white disabled:opacity-40">确认移至{names[target]}（{ids.length}）</button>
    </div>}
  </section>;
}
