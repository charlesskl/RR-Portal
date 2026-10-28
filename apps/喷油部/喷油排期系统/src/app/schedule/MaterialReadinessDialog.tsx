"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { invalidateClientCache } from "@/lib/clientCache";

type Material = {
  orderId: number; externalOrderNo: string; partName: string; demandQty: number; consumedQty: number;
  arrivedQty: number | null; expectedDate: string | null; actualDate: string | null; remark: string | null;
  version: number; registered: boolean; status: string; waitingQty: number; finishDate: string | null; canEdit: boolean;
};
export default function MaterialReadinessDialog({ selection, canEdit, onClose, onChanged }: {
  selection?: { orderId: number; partName?: string }; canEdit: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [rows, setRows] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Material | null>(null);
  const [keyword, setKeyword] = useState("");
  const [qty, setQty] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const choose = (row: Material) => {
    setSelected(row); setQty(String(row.arrivedQty ?? row.consumedQty));
    setExpected(row.expectedDate ?? ""); setActual(row.actualDate ?? ""); setRemark(row.remark ?? ""); setError(""); setSuccess("");
  };
  async function load() {
    const response = await apiFetch(`/api/materials${selection?.orderId ? `?orderId=${selection.orderId}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("来料信息加载失败");
    const data = await response.json() as Material[];
    setRows(data); return data;
  }
  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const response = await apiFetch(`/api/materials${selection?.orderId ? `?orderId=${selection.orderId}` : ""}`, { cache: "no-store" });
        if (!response.ok) throw new Error("来料信息加载失败");
        const data = await response.json() as Material[];
        if (!active) return;
        setRows(data);
        const first = selection?.partName ? data.find(row => row.partName === selection.partName) : null;
        if (first) choose(first);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "加载失败"); }
      finally { if (active) setLoading(false); }
    }
    start(); return () => { active = false; };
  }, [selection?.orderId, selection?.partName]);
  async function save() {
    if (!selected || saving || !canEdit || !selected.canEdit) return;
    const quantity = Number(qty);
    if (!/^\d+$/.test(qty) || !Number.isInteger(quantity) || quantity < selected.consumedQty || quantity > 2147483647) {
      setError(`累计到料数量必须是整数，且不能小于已投产的 ${selected.consumedQty.toLocaleString("zh-CN")} 件`); return;
    }
    setSaving(true); setError(""); setSuccess(""); let committed = false;
    try {
      const response = await apiFetch("/api/materials", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selected.orderId, partName: selected.partName, arrivedQty: quantity,
          expectedDate: expected || null, actualDate: quantity > 0 ? actual || null : null, remark, version: selected.version }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "保存失败");
      committed = true;
      for (const prefix of ["/api/orders", "/api/schedule", "/api/materials", "/api/recording", "/api/dashboard"]) invalidateClientCache(prefix);
      const fresh = await load();
      const row = fresh.find(row => row.orderId === selected.orderId && row.partName === selected.partName);
      if (row) choose(row);
      setSuccess(`${body.message || "已保存并重排"}${body.reflow?.warnings?.length ? `；${body.reflow.warnings.join("；")}` : ""}`);
      onChanged();
    } catch (error) {
      setError(`${committed ? "登记已保存，但页面更新失败，请重新打开来料管理查看。" : ""}${error instanceof Error ? error.message : "请检查网络后重试"}`);
    } finally { setSaving(false); }
  }
  const filtered = rows.filter(row => `${row.externalOrderNo} ${row.partName}`.toLowerCase().includes(keyword.toLowerCase()));
  return <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" onClick={() => { if (!saving) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label="来料管理" className="bg-white rounded-card border border-app-border shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto p-5" onClick={event => event.stopPropagation()}>
      <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold text-mint-700">来料登记与自动重排</h2><button disabled={saving} type="button" aria-label="关闭来料管理" onClick={onClose}>×</button></div>
      <p className="text-xs text-text-secondary mb-3">按订单和部位登记累计到料数量，不是本批新增数量。未登记的旧计划保持原样；登记后按已到数量和未来预计到料日安排。预计日已过但未到齐时，每五分钟自动复核。已录实绩、入库及库存保持不变。人工撤销后暂停自动重排，再次保存来料可恢复。</p>
      <input className={input + " mb-3"} aria-label="搜索来料订单或部位" placeholder="搜索订单号 / 部位" value={keyword} onChange={event => setKeyword(event.target.value)} />
      {loading ? <p>加载中…</p> : <div className="overflow-x-auto max-h-64"><table className="w-full text-sm min-w-[850px]"><thead className="bg-mint-50 text-mint-700 sticky top-0"><tr>{["订单", "部位", "需求", "累计到料", "预计到料", "状态", "待到料数量", "排期末日", "操作"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
        <tbody>{filtered.map(row => <tr key={`${row.orderId}-${row.partName}`} className="border-b border-app-border-light"><td className="p-2">{row.externalOrderNo}</td><td className="p-2">{row.partName}</td><td className="p-2">{row.demandQty.toLocaleString("zh-CN")}</td><td className="p-2">{row.arrivedQty?.toLocaleString("zh-CN") ?? "未登记"}</td><td className="p-2">{row.expectedDate ?? "—"}</td><td className="p-2">{row.status}</td><td className="p-2">{row.waitingQty.toLocaleString("zh-CN")}</td><td className="p-2">{row.finishDate ?? "—"}</td><td className="p-2"><button disabled={saving} className="text-sky hover:underline" onClick={() => choose(row)}>{canEdit && row.canEdit ? "登记" : "查看"}</button></td></tr>)}</tbody></table>
        {filtered.length === 0 && <p className="py-5 text-text-secondary">没有匹配的订单部位。</p>}
      </div>}
      {selected && <fieldset disabled={saving || !canEdit || !selected.canEdit} className="border border-app-border rounded-card p-4 mt-4">
        <legend className="text-sm font-semibold px-2">{selected.externalOrderNo} · {selected.partName}</legend>
        <p className="text-xs text-text-secondary mb-3">已投产 {selected.consumedQty.toLocaleString("zh-CN")} 件。未到料且没有有效预计日期的部分保持待料；预计日只用于排期预测，不代表实际已到。</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <label>累计到料数量<input aria-label="累计到料数量" type="number" min={selected.consumedQty} max="2147483647" step="1" className={input} value={qty} onChange={event => setQty(event.target.value)} /></label>
          <label>剩余物料预计到料日<input aria-label="剩余物料预计到料日" type="date" className={input} value={expected} onChange={event => setExpected(event.target.value)} /></label>
          <label>实际到料日<input aria-label="实际到料日" type="date" className={input} value={actual} onChange={event => setActual(event.target.value)} /></label>
        </div>
        <label className="text-sm block mt-3">备注<input aria-label="来料备注" className={input} value={remark} onChange={event => setRemark(event.target.value)} /></label>
        <button disabled={saving || !canEdit || !selected.canEdit} type="button" onClick={save} className="mt-3 bg-mint-400 text-white px-4 py-2 rounded-btn disabled:opacity-50">{saving ? "重排中…" : "保存来料并自动重排"}</button>
      </fieldset>}
      {error && <p role="alert" aria-label="来料错误" className="text-rose text-sm mt-3">{error}</p>}
      {success && <p role="status" className="text-mint-700 text-sm mt-3">{success}</p>}
    </div>
  </div>;
}
const input = "w-full border border-app-border rounded-btn px-2 py-2 text-sm bg-white focus:outline-none focus:border-mint-400";
