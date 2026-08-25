// 订单列表页（SSR 拉全部订单 → 客户端筛选）—— spec §3.C 表格增强
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import type { OrderRow } from "@/lib/orderFilter";
import OrdersDataLoader from "./OrdersDataLoader";

// .NET GET /api/orders 列表项（整单总数已由后端聚合，字段 camelCase）
type OrderListItemDto = {
  id: number;
  externalOrderNo: string;
  productNo: string;
  orderDate: string;             // ISO datetime
  deliveryDate: string | null;   // ISO datetime | null
  status: string;
  isMA: boolean;
  isUrgent: boolean;
  totalQty: number;
  pendingProduct: boolean;
};

// 转 'YYYY-MM-DD'，用本地时区年月日（不用 toISOString，避免 UTC+8 凌晨下单日少一天，
// 并与筛选用的 DatePicker（本地年月日）口径一致）
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (s: string | null) => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const x = new Date(s);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

export default async function OrdersPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // 原 prisma.order.findMany（含 product/lines/qtys 聚合）→ 调 .NET 列表接口（后端已聚合整单总数）
  // 同时复用甘特数据，补齐订单总览的排期进度 / 预计出单日 / 风险状态。
  // 首屏只等订单基础列表；排期进度和风险信息由客户端随后补齐。
  const orders = await dotnetGet<OrderListItemDto[]>("/api/orders");
  const rows: OrderRow[] = orders.map((o) => buildOrderRow(o));
  return <OrdersDataLoader initialRows={rows} today={todayStr} isAdmin={session.role === "admin"} />;
}

function buildOrderRow(o: OrderListItemDto): OrderRow {
  const deliveryDate = ymd(o.deliveryDate);
  return {
    id: o.id,
    externalOrderNo: o.externalOrderNo,
    productNo: o.productNo,
    orderDate: ymd(o.orderDate) ?? "",
    deliveryDate,
    status: o.status,
    isMA: o.isMA,
    isUrgent: o.isUrgent,
    totalQty: o.totalQty,
    pendingProduct: o.pendingProduct,
    scheduled: o.status === "scheduled" || o.status === "in_production" || o.status === "completed",
    firstPlanDate: null,
    expectedOutDate: null,
    scheduleFinishDate: null,
    scheduleCovered: false,
    plannedQty: 0,
    recordedQty: 0,
    demandQty: o.totalQty,
    progressPct: o.status === "completed" ? 100 : 0,
    riskLevel: "none",
    riskText: "计算中",
  };
}
