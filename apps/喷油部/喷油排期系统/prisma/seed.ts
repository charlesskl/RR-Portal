// 种子脚本：初始化 3 个默认账号
// 用途：首次部署 / 重置数据库后填充必要的用户数据
// 运行方式：npm run db:seed
//
// 角色约定（与 schema.prisma 中的 User.role 字段保持一致）：
//   - admin  → 主管管理员（全部权限）
//   - clerk  → 文员 / 拉长共用（日常录入与排程）
//   - viewer → 统计组（只读）
//
// 密码安全：bcrypt cost=10（标准强度）。V1 部署使用占位密码，
// 生产环境上线前必须由业务方修改。
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const users = [
    { username: "admin",  displayName: "主管管理员", role: "admin",  password: "admin123"  },
    { username: "clerk",  displayName: "文员",       role: "clerk",  password: "clerk123"  },
    { username: "viewer", displayName: "统计组",     role: "viewer", password: "viewer123" },
  ];

  for (const u of users) {
    // 使用 bcrypt 对密码做哈希（cost=10）
    const hash = await bcrypt.hash(u.password, 10);
    // upsert：若 username 已存在则跳过（update 为空对象），否则创建
    // 这样脚本可重复运行而不会报错或重复创建
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        passwordHash: hash,
        displayName: u.displayName,
        role: u.role,
      },
    });
    console.log(`✓ seeded user: ${u.username} / ${u.password}`);
  }

  // —— 第 2 章基础数据：4 条拉别（业务方定：名字含工艺、车间兴信A）+ 示例机台（幂等：先查后建）——
  // 工艺类型贴在拉别上（手喷/移印/自动喷/UV），机台工艺继承所属拉别
  const lineDefs = [
    { name: "A拉：自动喷", workshop: "兴信A", leaderName: "宋沛霖", craftType: "自动喷", dailyCapacityLimit: 120000 },
    { name: "B拉：手喷",   workshop: "华登A", leaderName: "宋沛霖", craftType: "手喷",   dailyCapacityLimit: 22000  },
    { name: "C拉：移印",   workshop: "兴信A", leaderName: "胡旗",   craftType: "移印",   dailyCapacityLimit: 120000 },
    { name: "UV拉：UV",    workshop: "兴信A", leaderName: "唐龙",   craftType: "UV",     dailyCapacityLimit: 360000 },
  ];
  for (const ld of lineDefs) {
    const exist = await prisma.productionLine.findFirst({ where: { name: ld.name } });
    const line = exist ?? (await prisma.productionLine.create({ data: ld }));
    // 给 C拉 建几台示例机（工艺继承拉别=移印；机台号同拉别内唯一）
    if (ld.name === "C拉：移印") {
      for (const mn of ["5#", "21#", "38#", "39#"]) {
        const m = await prisma.machine.findFirst({ where: { lineId: line.id, machineNo: mn } });
        if (!m) await prisma.machine.create({ data: { machineNo: mn, lineId: line.id, machineType: ld.craftType, isUV: false } });
      }
    }
  }
  console.log(`✓ seeded productionLines: ${lineDefs.map(l => l.name).join(", ")}`);

  // —— 验证输出 ——
  const lineCount = await prisma.productionLine.count();
  const machineCount = await prisma.machine.count();
  console.log(`📊 productionLine.count=${lineCount}, machine.count=${machineCount}`);

  // —— 2026 法定节假日（休息日。⚠️ 以国务院《放假安排通知》为准，文员可在节假日 tab 微调；
  //     调休「补班日」每年不同，此处不预填，由文员按官方通知补 workday 记录）——
  const holiday2026: { date: string; remark: string }[] = [
    { date: "2026-01-01", remark: "元旦" },
    // 春节（除夕~初六）
    { date: "2026-02-16", remark: "春节" }, { date: "2026-02-17", remark: "春节" },
    { date: "2026-02-18", remark: "春节" }, { date: "2026-02-19", remark: "春节" },
    { date: "2026-02-20", remark: "春节" }, { date: "2026-02-21", remark: "春节" },
    { date: "2026-02-22", remark: "春节" },
    // 清明
    { date: "2026-04-04", remark: "清明" }, { date: "2026-04-05", remark: "清明" }, { date: "2026-04-06", remark: "清明" },
    // 劳动节
    { date: "2026-05-01", remark: "劳动节" }, { date: "2026-05-02", remark: "劳动节" },
    { date: "2026-05-03", remark: "劳动节" }, { date: "2026-05-04", remark: "劳动节" }, { date: "2026-05-05", remark: "劳动节" },
    // 端午
    { date: "2026-06-19", remark: "端午" }, { date: "2026-06-20", remark: "端午" }, { date: "2026-06-21", remark: "端午" },
    // 中秋
    { date: "2026-09-25", remark: "中秋" }, { date: "2026-09-26", remark: "中秋" }, { date: "2026-09-27", remark: "中秋" },
    // 国庆
    { date: "2026-10-01", remark: "国庆" }, { date: "2026-10-02", remark: "国庆" }, { date: "2026-10-03", remark: "国庆" },
    { date: "2026-10-04", remark: "国庆" }, { date: "2026-10-05", remark: "国庆" }, { date: "2026-10-06", remark: "国庆" },
    { date: "2026-10-07", remark: "国庆" },
  ];
  for (const h of holiday2026) {
    const d = new Date(h.date + "T00:00:00Z");
    const exist = await prisma.holiday.findFirst({ where: { date: d } });
    if (!exist) await prisma.holiday.create({ data: { date: d, type: "holiday", remark: h.remark } });
  }
  console.log(`✓ seeded holidays 2026: ${holiday2026.length} 天（法定假，补班待文员补）`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
