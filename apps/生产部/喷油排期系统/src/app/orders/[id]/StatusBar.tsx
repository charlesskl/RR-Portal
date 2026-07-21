"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StatusBar({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [val, setVal] = useState(status);
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    setBusy(true);
    const res = await apiFetch(`/api/orders/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (res.ok) { setVal(next); router.refresh(); }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-text-secondary">状态</label>
      <select
        className="border border-app-border rounded-btn px-2 py-1 text-sm"
        value={val} disabled={busy}
        onChange={(e) => save(e.target.value)}
      >
        <option value="received">已接单</option>
        <option value="scheduled">已排期</option>
        <option value="in_production">在产</option>
        <option value="completed">完工</option>
        <option value="archived">作废</option>
      </select>
    </div>
  );
}
