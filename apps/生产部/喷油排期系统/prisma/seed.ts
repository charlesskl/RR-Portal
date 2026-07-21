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

  // ===== 示例产品：11494 兔子套装（产品信息库结构，部位级）=====
  const existing = await prisma.product.findUnique({ where: { productNo: "11494" } });
  if (!existing) {
    await prisma.product.create({
      data: {
        productNo: "11494",
        iterationNo: "V1", status: "active", createdBy: "clerk",
        effectiveDate: new Date("2026-05-28"),
        items: {
          create: [{
            itemName: "兔子", itemOrder: 0,
            parts: { create: [
              { partName: "头", partOrder: 0, unitCost: 0.5, laborPrice: 0.2, paintCost: 0.35, quotedPrice: 1.5 },
              { partName: "身体", partOrder: 1, unitCost: 0.3, laborPrice: 0.1, paintCost: 0.15, quotedPrice: 0.8 },
              { partName: "腿", partOrder: 2, unitCost: 0.3, laborPrice: 0.1, paintCost: 0.15, quotedPrice: 0.8 },
            ] },
          }],
        },
      },
    });
    console.log("✅ 已创建示例产品 11494 兔子套装");
  }

  // ===== 示例订单：引用 11494，按部位填数量 =====
  const prod = await prisma.product.findUnique({
    where: { productNo: "11494" },
    include: { items: { include: { parts: true } } },
  });
  const orderExists = await prisma.order.findUnique({ where: { externalOrderNo: "ZWZ2026057" } });
  if (prod && !orderExists) {
    const rabbit = prod.items[0];
    await prisma.order.create({
      data: {
        externalOrderNo: "ZWZ2026057",
        productId: prod.id, status: "received",
        orderDate: new Date("2026-05-20"), deliveryDate: new Date("2026-06-09"),
        createdBy: "clerk",
        lines: { create: [{
          itemName: rabbit.itemName, sourceItemId: rabbit.id, lineOrder: 0,
          partQtys: { create: rabbit.parts.map((p, i) => ({
            partName: p.partName, sourcePartId: p.id, qty: 800, partOrder: i,
          })) },
        }] },
      },
    });
    console.log("✅ 已创建示例订单 ZWZ2026057");
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

  // —— 给示例产品 11494 的部位填上日产能（机喷、单台 3000/天）——
  const parts = await prisma.productPart.findMany({ where: { dailyCapacity: 0 } });
  for (const p of parts) {
    await prisma.productPart.update({
      where: { id: p.id },
      data: { dailyCapacity: 3000, productionMode: "machine", stdMachineCount: 1 },
    });
  }
  if (parts.length > 0) {
    console.log(`✓ updated ${parts.length} productPart(s) dailyCapacity → 3000`);
  }

  // —— 验证输出 ——
  const lineCount = await prisma.productionLine.count();
  const machineCount = await prisma.machine.count();
  const samplePart = await prisma.productPart.findFirst();
  console.log(`📊 productionLine.count=${lineCount}, machine.count=${machineCount}, samplePart.dailyCapacity=${samplePart?.dailyCapacity ?? "N/A"}`);

  // === 示例排期计划（幂等：先清该订单的计划再建）===
  const demoOrder = await prisma.order.findUnique({
    where: { externalOrderNo: "ZWZ2026057" },
    include: { lines: true },
  });
  const demoLine = await prisma.productionLine.findFirst({
    where: { name: { startsWith: "C拉" } },
  });
  if (demoOrder && demoLine) {
    // 幂等：先删该订单已有的所有排期计划，再重新创建
    await prisma.productionPlan.deleteMany({ where: { orderId: demoOrder.id } });
    const firstItem = demoOrder.lines[0];
    if (firstItem) {
      await prisma.productionPlan.create({
        data: {
          planDate: new Date(),
          planType: "daily",
          lineId: demoLine.id,
          orderId: demoOrder.id,
          itemName: firstItem.itemName,
          partName: "头",        // 示意部位，seed 仅建一条示例
          machineNos: '["5#"]',  // JSON 字符串，与 schema @default("[]") 一致
          plannedQty: 3000,
          workerCount: 1,
          createdBy: "seed",
        },
      });
      console.log(`✅ 已创建示例排期计划：orderId=${demoOrder.id} lineId=${demoLine.id} qty=3000`);
    }
    // 将示例订单状态更新为「已排期」
    await prisma.order.update({
      where: { id: demoOrder.id },
      data: { status: "scheduled" },
    });
    console.log(`✓ 已将订单 ZWZ2026057 状态更新为 scheduled`);
  } else {
    console.warn("⚠️  未找到订单 ZWZ2026057 或拉别「胡旗」，跳过示例排期计划创建");
  }

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
