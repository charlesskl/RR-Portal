import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { dotnetGet } from "@/lib/dotnet";

type Application = {
  applicationNo: string; sourcePlanId: number; productionDate: string;
  orderNo: string; productNo: string; itemName: string; partName: string;
  quantity: number; createdBy: string; createdAt: string; remark: string | null;
};
type ApplicationPage = { items: Application[]; total: number; page: number; pageSize: number };

function ymd(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value));
}

export default async function InboundApplicationsPage({ searchParams }: {
  searchParams: { applicationNo?: string; orderNo?: string; productNo?: string; page?: string };
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const params = new URLSearchParams();
  if (searchParams.applicationNo) params.set("applicationNo", searchParams.applicationNo);
  if (searchParams.orderNo) params.set("orderNo", searchParams.orderNo);
  if (searchParams.productNo) params.set("productNo", searchParams.productNo);
  params.set("page", searchParams.page || "1");
  params.set("pageSize", "50");
  const data = await dotnetGet<ApplicationPage>(`/api/inventory/inbound-applications?${params}`);

  return (
    <div className="rounded-card border border-app-border bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="border-l-4 border-mint-400 pl-3 text-lg font-semibold text-text">📄 入库申请单</h1>
        <Link href="/inventory" className="text-sm text-mint-700 hover:underline">返回库存查询</Link>
      </div>
      <form className="mb-5 flex flex-wrap items-end gap-3">
        <FilterInput name="applicationNo" label="申请单号" value={searchParams.applicationNo} />
        <FilterInput name="orderNo" label="订单号" value={searchParams.orderNo} />
        <FilterInput name="productNo" label="货号" value={searchParams.productNo} />
        <button className="rounded-btn bg-mint-400 px-5 py-2 text-sm font-medium text-white hover:bg-mint-700">查询</button>
        <Link href="/inventory/applications" className="rounded-btn border border-app-border px-5 py-2 text-sm text-text-secondary hover:bg-gray-50">清空</Link>
      </form>
      <div className="mb-2 text-sm text-text-secondary">共 {data.total.toLocaleString("zh-CN")} 张申请单</div>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
        <thead><tr className="bg-mint-400 text-left text-xs font-semibold text-white">
          <th className="px-3 py-2">申请单号</th><th className="px-3 py-2">生成时间</th><th className="px-3 py-2">生产日期</th>
          <th className="px-3 py-2">订单号</th><th className="px-3 py-2">货号</th><th className="px-3 py-2">子件 / 部位</th>
          <th className="px-3 py-2 text-right">数量</th><th className="px-3 py-2">录入人</th>
        </tr></thead>
        <tbody>
          {data.items.map((row) => <tr key={row.applicationNo} className="odd:bg-[#F9F9F9] hover:bg-[#F0F7FF]">
            <td className="border-b border-app-border px-3 py-2 font-mono font-semibold">{row.applicationNo}</td>
            <td className="border-b border-app-border px-3 py-2 whitespace-nowrap">{dateTime(row.createdAt)}</td>
            <td className="border-b border-app-border px-3 py-2 whitespace-nowrap">{ymd(row.productionDate)}</td>
            <td className="border-b border-app-border px-3 py-2">{row.orderNo}</td>
            <td className="border-b border-app-border px-3 py-2 font-mono">{row.productNo}</td>
            <td className="border-b border-app-border px-3 py-2">{row.itemName || "-"} / {row.partName}</td>
            <td className={`border-b border-app-border px-3 py-2 text-right font-semibold tabular-nums ${row.quantity < 0 ? "text-rose-dark" : ""}`}>{row.quantity.toLocaleString("zh-CN")}</td>
            <td className="border-b border-app-border px-3 py-2">{row.createdBy}</td>
          </tr>)}
          {data.items.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-text-secondary">暂无入库申请单</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function FilterInput({ name, label, value }: { name: string; label: string; value?: string }) {
  return <label className="text-xs text-text-secondary">{label}<input name={name} defaultValue={value} className="mt-1 block rounded-md border border-app-border px-3 py-2 text-sm text-text" /></label>;
}
