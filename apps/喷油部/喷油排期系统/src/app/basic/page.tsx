import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import BasicDataManager from "./BasicDataManager";

// .NET 接口返回结构（字段为 .NET 默认 camelCase 序列化）
type DotnetLine = { id: number; name: string; workshop: string; leaderName: string | null; craftType: string; isActive: boolean; dailyCapacityLimit: number };
type DotnetMachine = {
  id: number; machineNo: string; lineId: number; machineType: string; isUV: boolean; isActive: boolean; equipmentKind: string;
  line: { name: string; workshop: string } | null;
};
type DotnetHoliday = { id: number; date: string; type: string; remark: string | null };
// 工序对照表：alias=工序小类，category=大类（手喷/移印/自动喷/UV）
type DotnetCraftAlias = { id: number; alias: string; category: string };

export default async function BasicPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // 取数已迁移到 .NET：替代原先的 Prisma 直查（GET /api/lines + /api/machines + /api/holidays + /api/craft-aliases）
  const [lines, machines, holidays, craftAliases] = await Promise.all([
    dotnetGet<DotnetLine[]>("/api/lines"),
    dotnetGet<DotnetMachine[]>("/api/machines"),
    dotnetGet<DotnetHoliday[]>("/api/holidays"),
    dotnetGet<DotnetCraftAlias[]>("/api/craft-aliases"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text">🗄️ 基础数据库</h1>
      <BasicDataManager
        lines={lines.map((l) => ({ id: l.id, name: l.name, workshop: l.workshop, leaderName: l.leaderName, craftType: l.craftType, isActive: l.isActive, dailyCapacityLimit: l.dailyCapacityLimit }))}
        machines={machines.map((m) => ({ id: m.id, machineNo: m.machineNo, lineId: m.lineId, lineName: m.line?.name ?? "", machineType: m.machineType, isUV: m.isUV, isActive: m.isActive, equipmentKind: m.equipmentKind ?? "普通" }))}
        holidays={holidays.map((h) => ({ id: h.id, date: h.date, type: h.type, remark: h.remark }))}
        craftAliases={craftAliases.map((c) => ({ id: c.id, alias: c.alias, category: c.category }))}
      />
    </div>
  );
}
