// 排期录入页：SSR 拉「拉别+机台」和「可排订单(含部位展开)」，交给客户端组件。
// 已全量迁移到 .NET：GET /api/lines（拉别机台）+ GET /api/schedule/orders（可排订单+展开部位）。
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
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

export default async function SchedulePage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // 拉别+机台、可排订单 —— 都改调 .NET（替代原先的 prisma 直查 + expandOrderParts）
  const [allLines, orders, urgentOrders] = await Promise.all([
    dotnetGet<DotnetLine[]>("/api/lines"),
    dotnetGet<SchedulableOrder[]>("/api/schedule/orders"),
    dotnetGet<UrgentOrder[]>("/api/schedule/urgent/orders"),
  ]);

  // /api/lines 返回所有拉别（含停用），按原页面口径只取启用的
  const lines = allLines.filter((l) => l.isActive);
  const lineData = lines.map((l) => ({
    id: l.id,
    name: l.name,
    workshop: l.workshop,
    leaderName: l.leaderName,
    craftType: l.craftType,
    machines: l.machines.map((m) => ({ id: m.id, machineNo: m.machineNo, isUV: m.isUV })),
  }));

  return <ScheduleTabs lines={lineData} orders={orders} urgentOrders={urgentOrders} />;
}
