// 订单详情页（SSR 取数）—— 查看+就地编辑合并，交给客户端组件 OrderDetailEditor
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { dotnetGet } from "@/lib/dotnet";
import OrderDetailEditor, { type OrderDetailDto } from "./OrderDetailEditor";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  let dto: OrderDetailDto | null = null;
  try {
    dto = await dotnetGet<OrderDetailDto>(`/api/orders/${Number(params.id)}`);
  } catch {
    dto = null;
  }
  if (!dto) notFound();
  if (!dto.product) notFound();

  return <OrderDetailEditor order={dto} />;
}
