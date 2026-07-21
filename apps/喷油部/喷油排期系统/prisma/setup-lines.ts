// 一次性数据补充脚本（2026-06-12）：把基础数据库的拉别整理成业务方确认的 4 条拉。
// 幂等：可重复运行。运行：npx tsx prisma/setup-lines.ts
//   A拉 宋沛霖 自动喷 ｜ B拉 宋沛霖 手喷 ｜ C拉 胡旗 移印 ｜ UV拉 唐龙 UV
// 现有「胡旗拉」转 C拉、「宋沛霖拉」转 A拉（保留 id，不破坏已有排期外键），补建 B拉/UV拉。
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 把一条拉的所有机台的机型/UV标记同步成该拉工艺
async function syncMachines(lineId: number, craft: string) {
  await prisma.machine.updateMany({
    where: { lineId },
    data: { machineType: craft, isUV: craft === "UV" },
  });
}

// 按"名字包含"找已有拉，找到则改名+设工艺，找不到则按目标名新建
async function reconcile(matchContains: string, target: { name: string; leaderName: string; craftType: string; workshop: string }) {
  let line = await prisma.productionLine.findFirst({ where: { name: { contains: matchContains } } });
  if (!line) line = await prisma.productionLine.findFirst({ where: { name: target.name } });
  if (line) {
    line = await prisma.productionLine.update({
      where: { id: line.id },
      data: { name: target.name, leaderName: target.leaderName, craftType: target.craftType, isActive: true },
    });
    console.log(`✓ 已有拉「${matchContains}」→ ${target.name}（${target.craftType}，拉长 ${target.leaderName}）id=${line.id}`);
  } else {
    line = await prisma.productionLine.create({ data: target });
    console.log(`✓ 新建拉 ${target.name}（${target.craftType}，拉长 ${target.leaderName}）id=${line.id}`);
  }
  await syncMachines(line.id, target.craftType);
  return line;
}

async function main() {
  console.log("—— 整理前 ——");
  for (const l of await prisma.productionLine.findMany({ orderBy: { id: "asc" } }))
    console.log(`  id=${l.id} ${l.name} / ${(l as any).craftType ?? "?"} / 拉长 ${l.leaderName ?? "—"}`);

  await reconcile("宋沛霖", { name: "A拉", leaderName: "宋沛霖", craftType: "自动喷", workshop: "华登A" });
  await reconcile("胡旗",   { name: "C拉", leaderName: "胡旗",   craftType: "移印",   workshop: "兴信A" });
  // B拉、UV拉：按目标名幂等（reconcile 用目标名兜底，匹配不到就新建）
  await reconcile("B拉",  { name: "B拉",  leaderName: "宋沛霖", craftType: "手喷", workshop: "华登A" });
  await reconcile("UV拉", { name: "UV拉", leaderName: "唐龙",   craftType: "UV",   workshop: "兴信A" });

  console.log("—— 整理后 ——");
  for (const l of await prisma.productionLine.findMany({ orderBy: { id: "asc" }, include: { machines: true } }))
    console.log(`  id=${l.id} ${l.name} / ${(l as any).craftType} / 拉长 ${l.leaderName ?? "—"} / 机台${l.machines.length}台`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
