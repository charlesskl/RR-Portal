// 工序对照表预置脚本（一次性、幂等）
// 用途：把核价表中出现的工序小类映射到系统四大类（手喷/移印/自动喷/UV）
// 运行方式：npx tsx prisma/seed-craft-aliases.ts
// 幂等：按 alias 做 upsert，已存在则只更新 category，不存在则新建。可重复跑。

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 预置映射：大类 → 小类列表
// 注意：「喷油（夹）」用全角括号（），与真实核价表保持一致
const SEED_DATA: { alias: string; category: string }[] = [
  // —— 自动喷 ——
  { alias: "自动",   category: "自动喷" },
  { alias: "自动机", category: "自动喷" },
  { alias: "机喷",   category: "自动喷" },

  // —— 手喷 ——
  { alias: "喷油",     category: "手喷" },
  { alias: "散枪",     category: "手喷" },
  { alias: "画油",     category: "手喷" },
  { alias: "PP水",     category: "手喷" },
  { alias: "擦PP水",   category: "手喷" },
  { alias: "洗油",     category: "手喷" },
  { alias: "喷油（夹）", category: "手喷" },  // 全角括号，与核价表原文一致
  { alias: "手喷",     category: "手喷" },
  { alias: "炒货机",   category: "手喷" },

  // —— 移印 ——
  { alias: "移印", category: "移印" },

  // —— UV ——
  { alias: "UV",      category: "UV" },
  { alias: "平板机打印", category: "UV" },
];

async function main() {
  console.log(`开始写入工序对照表预置数据，共 ${SEED_DATA.length} 条…`);

  let upserted = 0;
  for (const item of SEED_DATA) {
    await prisma.craftAlias.upsert({
      where: { alias: item.alias },
      update: { category: item.category },
      create: { alias: item.alias, category: item.category, createdBy: "system" },
    });
    upserted++;
  }

  console.log(`✅ 写入完成，共 ${upserted} 条（已存在则更新 category，不存在则新建）。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
