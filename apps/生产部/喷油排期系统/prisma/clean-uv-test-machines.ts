// 一次性：清掉 UV拉 下因批量录入空格分隔 bug 录进的碎片机台（UV拉本应 0 台真实机）。
// 运行：npx tsx prisma/clean-uv-test-machines.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const uv = await prisma.productionLine.findFirst({ where: { name: { startsWith: "UV拉" } } });
  if (!uv) { console.log("未找到 UV拉，跳过"); return; }
  const before = await prisma.machine.findMany({ where: { lineId: uv.id }, select: { machineNo: true } });
  console.log(`UV拉(id=${uv.id}) 当前机台 ${before.length} 台：`, before.map((m) => m.machineNo).join(" | "));
  const r = await prisma.machine.deleteMany({ where: { lineId: uv.id } });
  console.log(`✓ 已删除 ${r.count} 台 UV拉机台`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
