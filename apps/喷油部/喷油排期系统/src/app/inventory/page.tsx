// 库存查询页 —— 统一走 .NET 库存服务，确保库存流水与实绩撤销使用同一口径。
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import { InventoryTable, type InventoryRow } from "./InventoryTable";
import Link from "next/link";

export default async function InventoryPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const rows = await dotnetGet<InventoryRow[]>("/api/inventory/query");

  return (
    <div className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">
          📦 库存查询
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-text-secondary">
            半成品=各工序间积压合计；成品=最后工序入库累计；车间存数=最后工序完成未入库
          </span>
          <Link href="/inventory/applications" className="rounded-btn bg-mint-400 px-4 py-2 text-sm font-medium text-white hover:bg-mint-700">
            入库申请单
          </Link>
        </div>
      </div>
      <InventoryTable rows={rows} />
    </div>
  );
}
