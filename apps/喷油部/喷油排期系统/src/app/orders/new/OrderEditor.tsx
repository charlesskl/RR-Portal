"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type Part = { id: number; partGroupId: number; partName: string };
type ProductLite = { id: number; productNo: string };

const num = (s: string | undefined) => (!s ? 0 : Number(s));

export default function OrderEditor({ products }: { products: ProductLite[] }) {
  const router = useRouter();
  const [head, setHead] = useState({ externalOrderNo: "", orderDate: "", deliveryDate: "", remark: "", isUrgent: false });
  const [productId, setProductId] = useState<number | "">("");
  const [parts, setParts] = useState<Part[]>([]);
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function pickProduct(id: number) {
    setProductId(id);
    setQtys({}); setParts([]); setError("");
    const res = await apiFetch(`/api/products/${id}`);
    if (!res.ok) { setError("载入款号数据失败，请重试"); return; }
    const p = await res.json();
    setParts(Array.from(new Map((p.parts || []).map((part: Part) => [part.partGroupId || part.id, {
      ...part, id: part.partGroupId || part.id,
    }])).values()) as Part[]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { setError("请先选择款号"); return; }
    setLoading(true); setError("");
    // 每个子件一行；行内含填了数量(>0)的部位
    const partQtys = parts
      .map((pt, index) => ({ partName: pt.partName, sourcePartId: pt.id, qty: num(qtys[pt.id]), partOrder: index }))
      .filter((q) => q.qty > 0);

    if (partQtys.length === 0) { setError("请至少给一个部位填数量"); setLoading(false); return; }

    const res = await apiFetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...head, productId, partQtys }),
    });
    if (res.ok) { router.push("/orders"); router.refresh(); }
    else { const b = await res.json(); setError(b.error || "创建失败"); setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* 订单头 */}
      <div className="bg-white p-6 rounded-card border border-app-border grid grid-cols-3 gap-4">
        <L label="外部订单号 *"><input className={inp} required value={head.externalOrderNo} onChange={(e) => setHead({ ...head, externalOrderNo: e.target.value })} placeholder="如 ZWZ2026057" /></L>
        <L label="款号 *">
          <select className={inp} required value={productId} onChange={(e) => {
            if (e.target.value) pickProduct(Number(e.target.value));
            else { setProductId(""); setParts([]); setQtys({}); }
          }}>
            <option value="">— 选择款号 —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.productNo}</option>)}
          </select>
        </L>
        <L label="交货日期"><input className={inp} type="date" value={head.deliveryDate} onChange={(e) => setHead({ ...head, deliveryDate: e.target.value })} /></L>
        <L label="下单日期"><input className={inp} type="date" value={head.orderDate} onChange={(e) => setHead({ ...head, orderDate: e.target.value })} /></L>
        <div className="col-span-3"><L label="备注"><input className={inp} value={head.remark} onChange={(e) => setHead({ ...head, remark: e.target.value })} /></L></div>
        {/* 急单勾选：原计划外、临时插入的单；勾上后到「排期·日排」排急单 */}
        <label className="col-span-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={head.isUrgent} onChange={(e) => setHead({ ...head, isUrgent: e.target.checked })} />
          <span>标记为急单（原计划外、临时插入的单）</span>
        </label>
      </div>

      {/* 部件数量（内部仍保留旧 itemId 关联，兼容历史数据） */}
      {parts.length === 0 ? (
        <div className="bg-[#ecfdf5] border-l-[3px] border-mint-400 p-4 rounded-btn text-sm text-[#065f46]">
          先在上面选择货号，系统会直接列出部件供填写订单数量（不需要的部件留空即可）。
        </div>
      ) : (
        <div className="bg-white p-4 rounded-card border border-app-border">
              <table className="w-full table-fixed text-sm">
                <colgroup><col /><col className="w-40" /></colgroup>
                <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
                  <tr><th className="px-2 py-2 text-left">部位</th><th className="px-2 py-2 text-right w-40">数量</th></tr>
                </thead>
                <tbody>
                  {parts.map((pt) => (
                    <tr key={pt.id} className="border-t border-app-border">
                      <td className="px-2 py-1">{pt.partName}</td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" min="0" placeholder="0"
                          value={qtys[pt.id] ?? ""}
                          onChange={(e) => setQtys({ ...qtys, [pt.id]: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
        </div>
      )}

      {error && <p className="text-rose text-sm">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => router.push("/orders")} className="px-4 py-2 border border-app-border rounded-btn text-sm">取消</button>
        <button type="submit" disabled={loading} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm">{loading ? "保存中..." : "💾 保存订单"}</button>
      </div>
    </form>
  );
}

const inp = "w-full border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400";
const cell = "w-full border border-app-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-mint-400";
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-text-secondary mb-1">{label}</label>{children}</div>;
}
