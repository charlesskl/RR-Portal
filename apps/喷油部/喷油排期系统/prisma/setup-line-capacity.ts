// 一次性幂等：① 现有 dev.db 重建 B拉（手喷）若不存在 ② 按工艺写 4 条拉的日产能上限。可重复运行。
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const CAP: Record<string, number> = { "自动喷": 300000, "手喷": 200000, "移印": 300000, "UV": 400000 };

async function main() {
  // ① B拉（手喷）不存在则建
  const bla = await prisma.productionLine.findFirst({ where: { name: { startsWith: "B拉" } } });
  if (!bla) {
    const created = await prisma.productionLine.create({
      data: { name: "B拉：手喷", workshop: "华登A", leaderName: "宋沛霖", craftType: "手喷", dailyCapacityLimit: 200000, isActive: true },
    });
    console.log(`✓ 新建 B拉：手喷 id=${created.id}`);
  } else {
    console.log(`✓ B拉 已存在 id=${bla.id}，跳过新建`);
  }
  // ② 按工艺写日上限（覆盖式，幂等）
  const lines = await prisma.productionLine.findMany();
  for (const l of lines) {
    const cap = CAP[(l as any).craftType];
    if (cap == null) { console.log(`  - 跳过 ${l.name}（工艺 ${(l as any).craftType} 无预设上限）`); continue; }
    await prisma.productionLine.update({ where: { id: l.id }, data: { dailyCapacityLimit: cap } as any });
    console.log(`  ✓ ${l.name}（${(l as any).craftType}）日上限 = ${cap}`);
  }
}
main().finally(() => prisma.$disconnect());
