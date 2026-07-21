// src/app/orders/[id]/edit/page.tsx
// 订单头编辑页（只改头部：客户/下单日/交货日/备注/MA/状态；明细不可改）
import { getSession } from "@/lib/session";
import { redirect, notFound } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import OrderHeadEditor from "./OrderHeadEditor";

// .NET GET /api/orders/{id} 详情（本页只用头部字段 + product.productNo）
type OrderHeadDto = {
  id: number;
  externalOrderNo: string;
  orderDate: string;             // ISO datetime
  deliveryDate: string | null;   // ISO datetime | null
  status: string;
  isMA: boolean;
  isUrgent: boolean;
  remark: string | null;
  product: { productNo: string } | null;
};

// 用本地时区年月日，避免 toISOString UTC 偏差导致日期少一天
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (s: string | null) => {
  if (!s) return "";
  const x = new Date(s);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

export default async function EditOrderPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // 原 prisma.order.findUnique（含 product.productNo）→ 调 .NET 详情接口；404 → notFound()
  let order: OrderHeadDto | null = null;
  try {
    order = await dotnetGet<OrderHeadDto>(`/api/orders/${Number(params.id)}`);
  } catch {
    order = null;
  }
  if (!order) notFound();

  return (
    <OrderHeadEditor
      id={order.id}
      externalOrderNo={order.externalOrderNo}
      productNo={order.product?.productNo ?? ""}
      init={{
        orderDate: ymd(order.orderDate),
        deliveryDate: ymd(order.deliveryDate),
        remark: order.remark ?? "",
        isMA: order.isMA,
        isUrgent: order.isUrgent,
        status: order.status,
      }}
    />
  );
}
