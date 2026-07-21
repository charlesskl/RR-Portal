"use client";
import { apiFetch } from "@/lib/apiFetch";
// 待补产品订单补全：选一个产品库货号 → 调 continue-parse 用原 PDF 自动补明细。
import { useEffect, useState } from "react";

type Prod = { id: number; productNo: string; status: string };

export default function CompletePendingDialog({
  order, onClose, onDone,
}: { order: { id: number; externalOrderNo: string }; onClose: () => void; onDone: () => void }) {
  const [prods, setProds] = useState<Prod[]>([]);
  const [pid, setPid] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiFetch("/api/products")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Prod[]) => setProds(list.filter((p) => p.status !== "archived")))
      .catch(() => setErr("载入产品库失败，请确认后端服务后重试"));
  }, []);

  async function submit() {
    if (!pid) { setErr("请先选择货号"); return; }
    setBusy(true); setErr("");
    try {
      const res = await apiFetch(`/api/orders/${order.id}/continue-parse`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: pid }),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "补全失败，请重试"); return; }
      const r = await res.json();
      alert(`补全成功，导入 ${r.lines} 个子件明细。`);
      onDone();
    } catch { setErr("网络错误，请重试"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 py-16">
      <div className="bg-white rounded-card border border-app-border w-[480px] max-w-[95vw] p-6 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">补全待补产品订单</h2>
          <button onClick={onClose} aria-label="关闭" className="text-text-secondary hover:text-text">✕</button>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          订单 <b className="font-mono">{order.externalOrderNo}</b>。选择它对应的产品库货号，系统将用当初上传的 PDF 自动补全子件明细。
        </p>
        <select value={pid} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : "")}
          className="w-full h-[38px] border border-app-border rounded-btn px-3 text-sm bg-white focus:outline-none focus:border-mint-400">
          <option value="">选择货号…</option>
          {prods.map((p) => <option key={p.id} value={p.id}>{p.productNo}</option>)}
        </select>
        {err && <p className="text-rose text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">取消</button>
          <button disabled={busy} onClick={submit}
            className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold disabled:opacity-50">
            {busy ? "补全中…" : "确认补全"}
          </button>
        </div>
      </div>
    </div>
  );
}
