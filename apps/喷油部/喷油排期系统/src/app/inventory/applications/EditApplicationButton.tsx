"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

// 入库申请单编辑：生产日期/数量/子件位置/备注可改，保存后 ERP 下次增量拉取会拿到最新版（等同重新发送）。
export type EditableApplication = {
  applicationNo: string; productionDate: string; orderNo: string; productNo: string;
  itemName: string; partName: string; quantity: number; remark: string | null;
};

export default function EditApplicationButton({ row }: { row: EditableApplication }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [productionDate, setProductionDate] = useState(row.productionDate.slice(0, 10));
  const [quantity, setQuantity] = useState(String(row.quantity));
  const [partName, setPartName] = useState(row.partName);
  const [remark, setRemark] = useState(row.remark ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty === 0) { setErr("数量必须是非 0 整数"); return; }
    if (!productionDate) { setErr("请选择生产日期"); return; }
    if (!partName.trim()) { setErr("子件/位置不能为空"); return; }
    setBusy(true); setErr("");
    try {
      const res = await apiFetch(`/api/inventory/inbound-applications/${encodeURIComponent(row.applicationNo)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productionDate,
          quantity: qty,
          partName: partName.trim(),
          remark: remark.trim() || null,
        }),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "保存失败，请重试"); return; }
      setOpen(false);
      router.refresh();
    } catch { setErr("网络错误，请重试"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-mint-700 hover:underline text-sm">编辑</button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 py-16">
          <div className="bg-white rounded-card border border-app-border w-[480px] max-w-[95vw] p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">编辑入库申请单</h2>
              <button onClick={() => setOpen(false)} aria-label="关闭" className="text-text-secondary hover:text-text">✕</button>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              单号 <b className="font-mono">{row.applicationNo}</b>（订单 {row.orderNo} / 货号 {row.productNo}，不可改）。
              保存后 ERP 下次拉取会收到该单的最新版本。
            </p>
            <div className="space-y-3">
              <label className="block text-xs text-text-secondary">生产日期
                <input type="date" value={productionDate} onChange={(e) => setProductionDate(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-app-border px-3 py-2 text-sm text-text" />
              </label>
              <label className="block text-xs text-text-secondary">数量（调减为负数）
                <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-app-border px-3 py-2 text-sm text-text" />
              </label>
              <label className="block text-xs text-text-secondary">子件 / 位置{row.itemName ? `（${row.itemName}）` : ""}
                <input type="text" value={partName} onChange={(e) => setPartName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-app-border px-3 py-2 text-sm text-text" />
              </label>
              <label className="block text-xs text-text-secondary">备注
                <input type="text" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可留空"
                  className="mt-1 block w-full rounded-md border border-app-border px-3 py-2 text-sm text-text" />
              </label>
            </div>
            {err && <p className="text-rose text-sm mt-3">{err}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setOpen(false)} className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">取消</button>
              <button disabled={busy} onClick={submit}
                className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold disabled:opacity-50">
                {busy ? "保存中…" : "保存并重发 ERP"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
