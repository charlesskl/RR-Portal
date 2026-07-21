// 订单列表页（SSR 拉全部订单 → 客户端筛选）—— spec §3.C 表格增强
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import type { OrderRow } from "@/lib/orderFilter";
import type { GanttOrder } from "@/lib/scheduleData";
import { orderScheduleCoverage, recordedOrderProgress } from "@/lib/orderProgress";
import OrdersTable from "./OrdersTable";

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
  const [orders, ganttOrders] = await Promise.all([
    dotnetGet<OrderListItemDto[]>("/api/orders"),
    dotnetGet<GanttOrder[]>(`/api/schedule?today=${todayStr}`),
  ]);
  const ganttById = new Map(ganttOrders.map((g) => [g.id, g]));

  const rows: OrderRow[] = orders.map((o) => ({
    ...buildOrderRow(o, ganttById.get(o.id), todayStr),
  }));

  return <OrdersTable orders={rows} />;
}

function buildOrderRow(o: OrderListItemDto, g: GanttOrder | undefined, today: string): OrderRow {
  const deliveryDate = ymd(o.deliveryDate);
  const progress = g ? recordedOrderProgress(g) : { demandQty: o.totalQty, recordedQty: 0, progressPct: 0 };
  const demandQty = progress.demandQty;
  const plannedQty = g?.plans.reduce((sum, p) => sum + p.plannedQty, 0) ?? 0;
  const recordedQty = progress.recordedQty;
  const progressPct = progress.progressPct;
  const scheduled = g?.scheduled ?? false;
  const scheduleInfo = g ? orderScheduleCoverage(g) : { covered: false, finishDate: null };
  const expectedOutDate = scheduleInfo.finishDate ?? g?.expectedOutDate ?? null;
  const active = o.status !== "archived" && o.status !== "completed";
  let riskLevel: OrderRow["riskLevel"] = "none";
  let riskText = "正常";

  if (active && !deliveryDate) {
    riskLevel = "missing_due";
    riskText = "缺交货日";
  } else if (active && deliveryDate && expectedOutDate && expectedOutDate > deliveryDate) {
    riskLevel = "late";
    riskText = "预计超期";
  } else if (active && deliveryDate && deliveryDate < today && !scheduleInfo.covered) {
    riskLevel = "overdue";
    riskText = "已超交期";
  } else if (active && !scheduled && !o.pendingProduct) {
    riskLevel = "unscheduled";
    riskText = "未排期";
  }

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
    scheduled,
    firstPlanDate: g?.firstPlanDate ?? null,
    expectedOutDate,
    scheduleFinishDate: scheduleInfo.finishDate,
    scheduleCovered: scheduleInfo.covered,
    plannedQty,
    recordedQty,
    demandQty,
    progressPct,
    riskLevel,
    riskText,
  };
}
