// 实绩录入页（SSR）：拉「选中日」的待录/已录行 + 历史欠录数 + 各订单完工状态，交客户端组件。
// 取数已迁移到 .NET：替代原先的 Prisma 直查（GET /api/plans、/api/lines、/api/orders/{id}）。
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import { ymd } from "@/lib/scheduleData";
import { partUnitPrice, isPartComplete } from "@/lib/recording";
import { expandOrderParts } from "@/lib/schedule";
import { lineLabel } from "@/lib/line";
import RecordingEditor from "./RecordingEditor";

export const dynamic = "force-dynamic";

// ── .NET 接口返回结构（字段为 .NET 默认 camelCase 序列化）──
// GET /api/plans：单条计划（含实绩字段；machineNos 已是数组；planDate 为 ISO 字符串）
type DotnetPlan = {
  id: number; planDate: string; planType: string; lineId: number; orderId: number;
  itemName: string; partName: string; sourcePartId: number | null; machineNos: string[];
  plannedQty: number; workerCount: number; goodQty: number | null; reportedQty: number | null;
  workHours: number; productionValue: number | null; status: string;
};
// GET /api/lines：拉别 + 机台（用 id/name/leaderName 做统一显示名映射；后端已按 A/B/C/UV 排序）
type DotnetLine = { id: number; name: string; leaderName: string | null };
// GET /api/orders/{id}：订单详情（含引用产品的部位基础价 + 明细行数量/部位加价）
type DotnetOrderPart = { id: number; partName: string; unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number };
type DotnetOrderItem = { id: number; itemName: string; parts: DotnetOrderPart[] };
type DotnetOrderProduct = { id: number; productNo: string; items: DotnetOrderItem[] };
type DotnetOrderPartQty = { id: number; partName: string; sourcePartId: number | null; qty: number; partOrder: number };
type DotnetOrderLine = { id: number; itemName: string; sourceItemId: number | null; lineOrder: number; partQtys: DotnetOrderPartQty[] };
type DotnetOrderDetail = {
  id: number; externalOrderNo: string; productId: number | null;
  orderDate: string; deliveryDate: string | null; status: string; isMA: boolean;
  product: DotnetOrderProduct | null; lines: DotnetOrderLine[];
};

// 部位级聚合 key：订单 + 子件 + 部位名（套装里不同子件的同名部位不混淆）
const partKey = (orderId: number, itemName: string, partName: string) => `${orderId}|${itemName}|${partName}`;

export default async function RecordingPage({ searchParams }: { searchParams: { date?: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const date = searchParams.date || ymd(new Date());

  // ── 当天全部行（GET /api/plans?planDate=）+ 拉别名映射 + 历史欠录条数 ──
  const [plans, lines, overduePlans] = await Promise.all([
    dotnetGet<DotnetPlan[]>(`/api/plans?planDate=${date}`),
    dotnetGet<DotnetLine[]>("/api/lines"),
    // 历史欠录：planDate < 当天 且未录（goodQty 为空）—— 用 unrecordedBefore 过滤
    dotnetGet<DotnetPlan[]>(`/api/plans?unrecordedBefore=${date}`),
  ]);
  // 拉别统一显示名（拉长+拉别简称）；filterLines 保持后端 A/B/C/UV 顺序供筛选侧栏用
  const lineLabelMap = new Map(lines.map((l) => [l.id, lineLabel(l)]));
  const filterLines = lines.map((l) => ({ id: l.id, label: lineLabel(l) }));
  const overdueCount = overduePlans.length;

  const orderIds = Array.from(new Set(plans.map((p) => p.orderId)));

  // ── 各涉及订单：详情（GET /api/orders/{id}，含部位基础价/加价/明细行）+ 全期计划（GET /api/plans?orderId=）──
  // 详情提供 订单头/产品款号/部位需求与单价料；全期计划用于累计已录 goodQty。
  const [orderDetails, orderAllPlans] = await Promise.all([
    Promise.all(orderIds.map((id) => dotnetGet<DotnetOrderDetail>(`/api/orders/${id}`))),
    Promise.all(orderIds.map((id) => dotnetGet<DotnetPlan[]>(`/api/plans?orderId=${id}`))),
  ]);
  const orderMap = new Map(orderDetails.map((o) => [o.id, o]));

  // ── 该订单各(子件,部位)全期累计已录 goodQty ──
  const recMap = new Map<string, number>();
  for (const list of orderAllPlans) {
    for (const p of list) {
      const k = partKey(p.orderId, p.itemName, p.partName);
      recMap.set(k, (recMap.get(k) ?? 0) + (p.goodQty ?? 0));
    }
  }

  // ── 部位总需求 + 订单完工判定（用订单详情的明细行 + 产品子件/部位展开）──
  const demandMap = new Map<string, number>(); // orderId|itemName|partName → 总需求
  const completedOrderIds: number[] = [];
  for (const o of orderDetails) {
    // expandOrderParts 仅用到 lines(sourceItemId/qtys) + product.items(id/itemName/parts)。
    // 详情里部位无产能字段，这里补默认值占位（完工判定只看 itemName/partName/totalDemand）。
    const oParts = expandOrderParts({
      lines: (o.lines ?? []).map((l) => ({ sourceItemId: l.sourceItemId, itemName: l.itemName, partQtys: l.partQtys })),
      product: {
        items: (o.product?.items ?? []).map((it) => ({
          id: it.id,
          itemName: it.itemName,
          parts: it.parts.map((pt) => ({
            id: pt.id, partName: pt.partName,
            productionMode: "", dailyCapacity: 0, stdMachineCount: 0,
          })),
        })),
      },
    });
    for (const pt of oParts) demandMap.set(partKey(o.id, pt.itemName, pt.partName), pt.totalDemand);
    const done = oParts.length > 0 && oParts.every((pt) =>
      isPartComplete(pt.totalDemand, recMap.get(partKey(o.id, pt.itemName, pt.partName)) ?? 0));
    if (done) completedOrderIds.push(o.id);
  }

  // ── 综合工价（算行级产值料）：部位基础价(来自产品)按 partName 映射 + 该订单该部位特殊色加价(取最大) ──
  // 部位单价表：orderId → (partName → 基础价部件)。详情里部位价挂在 product.items.parts。
  const partPriceByOrder = new Map<number, Map<string, DotnetOrderPart>>();
  for (const o of orderDetails) {
    const m = new Map<string, DotnetOrderPart>();
    for (const it of o.product?.items ?? []) for (const pt of it.parts) m.set(pt.partName, pt);
    partPriceByOrder.set(o.id, m);
  }
  const rows = plans.map((p) => {
    const order = orderMap.get(p.orderId);
    const part = partPriceByOrder.get(p.orderId)?.get(p.partName) ?? null;
    const unitPrice = part ? partUnitPrice(part) : 0;
    const k = partKey(p.orderId, p.itemName, p.partName);
    return {
      id: p.id,
      orderId: p.orderId,
      orderNo: order?.externalOrderNo ?? "",
      productNo: order?.product?.productNo ?? "",
      deliveryDate: order?.deliveryDate ? ymd(new Date(order.deliveryDate)) : null,
      lineId: p.lineId,
      lineName: lineLabelMap.get(p.lineId) ?? "",
      itemName: p.itemName,
      partName: p.partName,
      machineNos: p.machineNos,
      plannedQty: p.plannedQty,
      workerCount: p.workerCount,
      goodQty: p.goodQty,
      reportedQty: p.reportedQty,
      workHours: p.workHours,
      productionValue: p.productionValue ?? 0,
      unitPrice,
      status: p.status,
      totalDemand: demandMap.get(k) ?? 0,         // 部位总需求
      recordedTotal: recMap.get(k) ?? 0,          // 该部位全期累计已录
    };
  });

  return <RecordingEditor date={date} rows={rows} overdueCount={overdueCount} completedOrderIds={completedOrderIds} filterLines={filterLines} />;
}
