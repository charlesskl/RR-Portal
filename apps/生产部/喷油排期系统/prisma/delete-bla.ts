// 一次性：删除「B拉：手喷」（业务方 2026-06-12 决定不要手喷拉）。
// 安全：先确认无机台、无排期引用才硬删；否则中止报告。
// 运行：npx tsx prisma/delete-bla.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const bla = await prisma.productionLine.findFirst({ where: { name: { startsWith: "B拉" } } });
  if (!bla) { console.log("未找到 B拉，可能已删除，跳过"); return; }
  const machineCount = await prisma.machine.count({ where: { lineId: bla.id } });
  const planCount = await prisma.productionPlan.count({ where: { lineId: bla.id } });
  console.log(`B拉(id=${bla.id} ${bla.name}) 机台 ${machineCount} 台，排期引用 ${planCount} 条`);
  if (machineCount > 0 || planCount > 0) {
    console.warn("⚠️ B拉 下还有机台或排期，未删除（避免破坏数据）。请先清空再删。");
    return;
  }
  await prisma.productionLine.delete({ where: { id: bla.id } });
  console.log("✓ 已彻底删除 B拉");
  console.log("—— 剩余拉别 ——");
  for (const l of await prisma.productionLine.findMany({ orderBy: { id: "asc" } }))
    console.log(`  id=${l.id} ${l.name} / ${(l as any).craftType}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
