// 一次性：拉别名改为「X拉：工艺」格式，车间统一兴信A（业务方 2026-06-12 定）。幂等。
// 运行：npx tsx prisma/rename-lines.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 当前名 → 目标名（craftType 字段保持不变，仅改显示名 + 车间）
const renames: { match: string; name: string }[] = [
  { match: "A拉", name: "A拉：自动喷" },
  { match: "B拉", name: "B拉：手喷" },
  { match: "C拉", name: "C拉：移印" },
  { match: "UV拉", name: "UV拉：UV" },
];

async function main() {
  for (const r of renames) {
    // 用 startsWith 语义找：名字以「A拉」开头（含已改成「A拉：自动喷」的，保证可重复运行）
    const line = await prisma.productionLine.findFirst({ where: { name: { startsWith: r.match } } });
    if (!line) { console.warn(`⚠️ 未找到拉别 ${r.match}，跳过`); continue; }
    await prisma.productionLine.update({
      where: { id: line.id },
      data: { name: r.name, workshop: "兴信A" },
    });
    console.log(`✓ id=${line.id} → ${r.name}（车间 兴信A）`);
  }
  console.log("—— 结果 ——");
  for (const l of await prisma.productionLine.findMany({ orderBy: { id: "asc" } }))
    console.log(`  id=${l.id} ${l.name} / ${(l as any).craftType} / ${l.workshop} / 拉长 ${l.leaderName ?? "—"}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
