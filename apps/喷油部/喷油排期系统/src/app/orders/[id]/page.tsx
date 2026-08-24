// 订单详情页（SSR 取数）—— 查看+就地编辑合并，交给客户端组件 OrderDetailEditor
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Link from "next/link";
import { DotnetHttpError, dotnetGet } from "@/lib/dotnet";
import OrderDetailEditor, { type OrderDetailDto } from "./OrderDetailEditor";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  let dto: OrderDetailDto;
  try {
    dto = await dotnetGet<OrderDetailDto>(`/api/orders/${Number(params.id)}`);
  } catch (error) {
    if (error instanceof DotnetHttpError && error.status === 404) notFound();
    throw error;
  }

  if (!dto.product) {
    return <div className="max-w-4xl bg-white rounded-card border border-app-border p-6">
      <h1 className="text-xl font-bold text-text border-l-4 border-mint-400 pl-3">编辑订单 {dto.externalOrderNo}</h1>
      <p className="mt-5 text-sm text-text-secondary">该订单尚未关联产品核价，请先在订单总览的“待补产品”中完成产品补全，之后才能编辑数量和工序排期。</p>
      <Link href="/orders" className="inline-block mt-5 text-sky text-sm hover:underline">← 返回订单总览</Link>
    </div>;
  }

  return <OrderDetailEditor order={dto} isAdmin={session.role === "admin"} />;
}
