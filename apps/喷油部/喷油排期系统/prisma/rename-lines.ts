// 一次性：拉别名改为「X拉：工艺」格式，车间统一兴信A（业务方 2026-06-12 定）。幂等。
// 运行：npx tsx prisma/rename-lines.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 按工艺识别兴信拉别，避免交换 A/B 后将工艺名称写错。
const renames = [
  { craftType: "手喷", names: ["B拉", "B拉：手喷", "A拉：手喷"], name: "A拉：手喷" },
  { craftType: "自动喷", names: ["A拉", "A拉：自动喷", "B拉：自动喷"], name: "B拉：自动喷" },
  { craftType: "移印", names: ["C拉", "C拉：移印"], name: "C拉：移印" },
  { craftType: "UV", names: ["UV拉", "UV拉：UV"], name: "UV拉：UV" },
];

async function main() {
  for (const r of renames) {
    // 新旧标准名称可能并存；一次更新全部匹配项，避免先命中已改名记录。
    const result = await prisma.productionLine.updateMany({
      where: { factoryId: "XINGXIN", craftType: r.craftType, name: { in: r.names } },
      data: { name: r.name, workshop: "兴信A" },
    });
    if (!result.count) { console.warn(`⚠️ 未找到拉别 ${r.name}，跳过`); continue; }
    console.log(`✓ ${result.count} 条 → ${r.name}（车间 兴信A）`);
  }
  console.log("—— 结果 ——");
  for (const l of await prisma.productionLine.findMany({ orderBy: { id: "asc" } }))
    console.log(`  id=${l.id} ${l.name} / ${(l as any).craftType} / ${l.workshop} / 拉长 ${l.leaderName ?? "—"}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
