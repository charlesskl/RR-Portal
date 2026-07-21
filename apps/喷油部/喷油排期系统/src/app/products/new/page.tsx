"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CRAFTS } from "@/lib/product";

type PartForm = { partName: string; craft: string; unitCost: string; laborPrice: string; paintCost: string; quotedPrice: string; dailyCapacity: string };
type ItemForm = { itemName: string; parts: PartForm[] };

const emptyPart = (): PartForm => ({ partName: "", craft: "移印", unitCost: "", laborPrice: "", paintCost: "", quotedPrice: "", dailyCapacity: "" });
const emptyItem = (): ItemForm => ({ itemName: "", parts: [emptyPart()] });

export default function NewProductPage() {
  const router = useRouter();
  const [head, setHead] = useState({ productNo: "" });
  const [items, setItems] = useState<ItemForm[]>([emptyItem()]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const num = (s: string) => (s === "" ? 0 : Number(s));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const payload = {
      ...head,
      items: items.map((it, ii) => ({
        itemName: it.itemName, itemOrder: ii,
        parts: it.parts.map((p, pi) => ({
          partName: p.partName, partOrder: pi, craft: p.craft,
          unitCost: num(p.unitCost), laborPrice: num(p.laborPrice),
          paintCost: num(p.paintCost), quotedPrice: num(p.quotedPrice),
          dailyCapacity: num(p.dailyCapacity),
        })),
      })),
    };
    const res = await apiFetch("/api/products", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (res.ok) { router.push("/products"); router.refresh(); }
    else { const b = await res.json(); setError(b.error || "创建失败"); setLoading(false); }
  }

  const updItem = (ii: number, patch: Partial<ItemForm>) =>
    setItems(items.map((it, i) => (i === ii ? { ...it, ...patch } : it)));
  const updPart = (ii: number, pi: number, patch: Partial<PartForm>) =>
    updItem(ii, { parts: items[ii].parts.map((p, i) => (i === pi ? { ...p, ...patch } : p)) });

  return (
    <div className="max-w-[850px]">
      <h1 className="text-2xl font-bold text-text mb-6">📇 新建产品</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white p-6 rounded-card border border-app-border">
          <L label="产品货号 *"><input className={inp} value={head.productNo} required onChange={(e) => setHead({ ...head, productNo: e.target.value })} /></L>
        </div>

        {items.map((it, ii) => (
          <div key={ii} className="bg-white p-6 rounded-card border border-app-border space-y-3">
            <L label={`子件 ${ii + 1} 名称`}><input className={inp} placeholder="如 兔子" value={it.itemName} required onChange={(e) => updItem(ii, { itemName: e.target.value })} /></L>
            {items.length > 1 && <button type="button" className="text-rose text-sm" onClick={() => setItems(items.filter((_, i) => i !== ii))}>删除子件</button>}

            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[25%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[10%]" />
                <col className="w-[10%]" /><col className="w-[7%]" /><col className="w-[10%]" /><col className="w-[13%]" /><col className="w-[4%]" />
              </colgroup>
              <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
                <tr>
                  <th className="px-2 py-1 text-left">部位名</th>
                  <th className="px-2 py-1">工序</th>
                  <th className="px-2 py-1">核价</th><th className="px-2 py-1">人工</th>
                  <th className="px-2 py-1">油漆</th><th className="px-2 py-1 text-mint-700">总核价</th><th className="px-2 py-1">报价</th><th className="px-2 py-1">日产能</th><th></th>
                </tr>
              </thead>
              <tbody>
                {it.parts.map((p, pi) => (
                  <tr key={pi}>
                    <td className="px-1 py-1"><input className={cell} placeholder="如 头" value={p.partName} required onChange={(e) => updPart(ii, pi, { partName: e.target.value })} /></td>
                    <td className="px-1 py-1"><select className={cell} value={p.craft} onChange={(e) => updPart(ii, pi, { craft: e.target.value })}>{CRAFTS.map((c2) => <option key={c2} value={c2}>{c2}</option>)}</select></td>
                    <td><input className={cell} type="number" step="0.0001" value={p.unitCost} onChange={(e) => updPart(ii, pi, { unitCost: e.target.value })} /></td>
                    <td><input className={cell} type="number" step="0.0001" value={p.laborPrice} onChange={(e) => updPart(ii, pi, { laborPrice: e.target.value })} /></td>
                    <td><input className={cell} type="number" step="0.0001" value={p.paintCost} onChange={(e) => updPart(ii, pi, { paintCost: e.target.value })} /></td>
                    <td className="px-2 text-center text-mint-700 font-semibold">{(num(p.unitCost) + num(p.paintCost)).toFixed(3)}</td>
                    <td><input className={cell} type="number" step="0.0001" value={p.quotedPrice} onChange={(e) => updPart(ii, pi, { quotedPrice: e.target.value })} /></td>
                    <td><input className={cell} type="number" step="1" placeholder="一天" value={p.dailyCapacity} onChange={(e) => updPart(ii, pi, { dailyCapacity: e.target.value })} /></td>
                    <td className="text-center">{it.parts.length > 1 && <button type="button" className="text-rose text-xs" onClick={() => updItem(ii, { parts: it.parts.filter((_, i) => i !== pi) })}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="text-mint-700 text-sm" onClick={() => updItem(ii, { parts: [...it.parts, emptyPart()] })}>+ 添加部位</button>
          </div>
        ))}

        <button type="button" className="text-mint-700 text-sm" onClick={() => setItems([...items, emptyItem()])}>+ 添加子件</button>
        {error && <p className="text-rose text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => router.push("/products")} className="px-4 py-2 border border-app-border rounded-btn text-sm">取消</button>
          <button type="submit" disabled={loading} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm">{loading ? "保存中..." : "💾 保存产品"}</button>
        </div>
      </form>
    </div>
  );
}

const inp = "w-full border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400";
const cell = "w-full border border-app-border rounded px-2 py-1 text-sm focus:outline-none focus:border-mint-400";
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-text-secondary mb-1">{label}</label>{children}</div>;
}
