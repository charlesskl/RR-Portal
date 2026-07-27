// 排期录入页：SSR 拉「拉别+机台」和「可排订单(含部位展开)」，交给客户端组件。
// 已全量迁移到 .NET：GET /api/lines（拉别机台）+ GET /api/schedule/orders（可排订单+展开部位）。
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import ScheduleTabs from "./ScheduleTabs";

// .NET GET /api/lines 返回结构（对齐 server/.../Basic/LineDtos.cs）
type DotnetMachine = { id: number; machineNo: string; lineId: number; machineType: string; isUV: boolean; isActive: boolean };
type DotnetLine = { id: number; name: string; workshop: string; leaderName: string | null; craftType: string; isActive: boolean; machines: DotnetMachine[] };

// .NET GET /api/schedule/orders 返回结构（对齐 lib/schedule.ts 的 SchedulablePart / expandOrderParts 输出）
type SchedulablePart = {
  sourceItemId: number; itemName: string; sourcePartId: number; partName: string;
  productionMode: string; dailyCapacity: number; stdMachineCount: number; totalDemand: number;
  craft: string; isTumbler: boolean; craftPasses: number;
};
type SchedulableOrder = {
  id: number; externalOrderNo: string; productNo: string; isMA: boolean; isUrgent: boolean; scheduled: boolean;
  parts: SchedulablePart[];
};
// 待排急单（GET /api/schedule/urgent/orders）：带交货日 + 是否已排 + 部位展开
type UrgentOrder = {
  id: number; externalOrderNo: string; productNo: string;
  deliveryDate: string | null; scheduled: boolean; parts: SchedulablePart[];
};

export default async function SchedulePage({ searchParams }: { searchParams?: { orderId?: string; orderNo?: string; from?: string; to?: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // 首屏只渲染排期总览。周排所需的拉别、订单和急单在用户点开周排后再加载。
  const orderId = Number(searchParams?.orderId ?? 0) || undefined;
  return <ScheduleTabs orderFilter={orderId ? {
    orderId,
    orderNo: searchParams?.orderNo ?? `#${orderId}`,
    from: searchParams?.from,
    to: searchParams?.to,
  } : undefined} />;
}
