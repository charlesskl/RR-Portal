// 库存查询页（W1 只读）—— SSR 取数走 .NET（GET /api/inventory/query）
import { dotnetGet } from "@/lib/dotnet";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { InventoryTable, type InventoryRow } from "./InventoryTable";

export default async function InventoryPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const rows = await dotnetGet<InventoryRow[]>("/api/inventory/query");

  return (
    <div className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">📦 库存查询</h1>
        <span className="text-xs text-text-secondary">成品=实绩累计良品−出库；车间存数=报数−入库（做了未入库）；散件=无主可翻单货（W2 起入账）</span>
      </div>
      <InventoryTable rows={rows} />
    </div>
  );
}
