"use client";
import { apiFetch } from "@/lib/apiFetch";
// 产品审核条：显示当前状态徽章；管理员可「审核通过」(待审核→已生效) / 「驳回」(已生效→待审核)。
// 文员看到的是只读状态 + 待审核提示。订单只能选「已生效」的产品。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_STATUS_META } from "@/lib/product";

export default function ApprovalBar({ productId, status, role }: { productId: number; status: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const st = PRODUCT_STATUS_META[status] ?? PRODUCT_STATUS_META.draft;
  const isAdmin = role === "admin";

  async function setStatus(next: string, confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    const res = await apiFetch(`/api/products/${productId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json().catch(() => ({}))).error || "操作失败");
  }

  return (
    <div className="flex items-center gap-3">
      <span className={`text-[12px] px-2.5 py-1 rounded-full ${st.cls}`}>{st.text}</span>

      {status === "draft" && isAdmin && (
        <button disabled={busy} onClick={() => setStatus("active", "确认审核通过？产品将生效，可被订单选用。")}
          className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold disabled:opacity-50">
          ✅ 审核通过
        </button>
      )}
      {status === "active" && isAdmin && (
        <button disabled={busy} onClick={() => setStatus("draft", "确认驳回？产品退回「待审核」，订单将无法选用，直到重新审核通过。")}
          className="border border-app-border text-text-secondary hover:border-text-tertiary px-4 py-2 rounded-btn text-sm disabled:opacity-50">
          ↩ 驳回
        </button>
      )}
      {status === "draft" && !isAdmin && (
        <span className="text-xs text-text-secondary">（待管理员审核，生效后才能被订单选用）</span>
      )}
    </div>
  );
}
