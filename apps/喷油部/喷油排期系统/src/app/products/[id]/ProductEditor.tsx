"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { CRAFTS } from "@/lib/product";

type Part = { id: number; partGroupId: number; partName: string; craft: string; unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number; dailyCapacity: number; productionMode: string; stdMachineCount: number; remark: string | null; craftPasses: number };
const numberValue = (value: string) => Number(value) || 0;

export function ProductEditor({ productId, parts }: { productId: number; parts: Part[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(parts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const patch = (id: number, values: Partial<Part>) => setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row));

  async function save() {
    setSaving(true); setError("");
    const res = await apiFetch(`/api/products/${productId}/parts`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts: rows }) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); setError(body.error || "保存失败"); }
    else router.refresh();
    setSaving(false);
  }
  async function addPart() {
    const res = await apiFetch(`/api/products/${productId}/parts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partName: "新部位", partOrder: rows.length, craft: "移印" }) });
    if (res.ok) router.refresh(); else { const body = await res.json().catch(() => ({})); setError(body.error || "添加失败"); }
  }
  async function removePart(id: number) {
    if (!confirm("确认删除这个部位？")) return;
    const res = await apiFetch(`/api/products/${productId}/parts/${id}`, { method: "DELETE" });
    if (res.ok) { setRows(current => current.filter(row => row.id !== id)); router.refresh(); }
    else setError("删除失败");
  }

  return <div className="bg-white rounded-card border border-app-border overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-fixed min-w-[1050px]">
        <thead className="bg-[#f0fdf4] text-[#047857] text-xs"><tr>
          <th className="px-2 py-3 text-left w-[18%]">部位</th><th className="px-2 py-3 w-[9%]">工序</th>
          <th className="px-2 py-3 w-[9%]">核价</th><th className="px-2 py-3 w-[9%]">人工</th><th className="px-2 py-3 w-[9%]">油漆</th>
          <th className="px-2 py-3 w-[9%]">报价</th><th className="px-2 py-3 w-[10%]">日产能</th><th className="px-2 py-3 w-[8%]">工序数</th><th className="px-2 py-3 w-[8%]">操作</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id} className={index % 2 ? "bg-[#fafdfb]" : ""}>
          <td className="p-1"><input className={cell} value={row.partName} onChange={e => patch(row.id, { partName: e.target.value })} /></td>
          <td className="p-1"><select className={cell} value={row.craft} onChange={e => patch(row.id, { craft: e.target.value })}>{CRAFTS.map(craft => <option key={craft}>{craft}</option>)}</select></td>
          <NumberCell value={row.unitCost} onChange={value => patch(row.id, { unitCost: value })} />
          <NumberCell value={row.laborPrice} onChange={value => patch(row.id, { laborPrice: value })} />
          <NumberCell value={row.paintCost} onChange={value => patch(row.id, { paintCost: value })} />
          <NumberCell value={row.quotedPrice} onChange={value => patch(row.id, { quotedPrice: value })} />
          <NumberCell value={row.dailyCapacity} onChange={value => patch(row.id, { dailyCapacity: value })} step="1" />
          <NumberCell value={row.craftPasses} onChange={value => patch(row.id, { craftPasses: value })} step="1" />
          <td className="text-center"><button className="text-rose hover:underline" onClick={() => removePart(row.id)}>删除</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="flex items-center justify-between p-4 border-t border-app-border">
      <button type="button" onClick={addPart} className="text-mint-700 text-sm">+ 添加部位</button>
      <div className="flex items-center gap-3">{error && <span className="text-rose text-sm">{error}</span>}<button disabled={saving} onClick={save} className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm disabled:opacity-60">{saving ? "保存中..." : "保存核价表"}</button></div>
    </div>
  </div>;
}
const cell = "w-full border border-app-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-mint-400";
function NumberCell({ value, onChange, step = "0.0001" }: { value: number; onChange: (value: number) => void; step?: string }) { return <td className="p-1"><input className={`${cell} text-right`} type="number" min="0" step={step} value={value} onChange={e => onChange(numberValue(e.target.value))} /></td>; }
