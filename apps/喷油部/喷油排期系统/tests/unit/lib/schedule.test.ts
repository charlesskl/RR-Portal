import { describe, it, expect } from "vitest";
import {
  partDailyOutput, partRemainingDays,
  subItemTotalDemand, expandOrderParts,
  addDays, orderRemainingDays, orderFirstPlanDate, weeklyPlanDates,
} from "@/lib/schedule";

describe("partDailyOutput", () => {
  it("日产量 = 投入资源数 × 单台日产能", () => {
    expect(partDailyOutput(2, 3000)).toBe(6000);
    expect(partDailyOutput(3, 5000)).toBe(15000);
  });
  it("资源数或产能为 0/负 → 0", () => {
    expect(partDailyOutput(0, 3000)).toBe(0);
    expect(partDailyOutput(2, 0)).toBe(0);
    expect(partDailyOutput(-1, 3000)).toBe(0);
  });
});

describe("partRemainingDays", () => {
  it("剩余天数 = ceil(余下数 / 日产量)", () => {
    expect(partRemainingDays(57000, 6000)).toBe(10);
    expect(partRemainingDays(1000, 1000)).toBe(1);
    expect(partRemainingDays(0, 6000)).toBe(0);
  });
  it("日产量为 0 → null（无法估）", () => {
    expect(partRemainingDays(500, 0)).toBeNull();
  });
});

describe("subItemTotalDemand — 某子件所有明细行各部位数量之和（不分颜色/规格）", () => {
  const lines = [
    { sourceItemId: 1, partQtys: [{ sourcePartId: 11, qty: 500 }] },
    { sourceItemId: 1, partQtys: [{ sourcePartId: 11, qty: 300 }, { sourcePartId: 12, qty: 200 }] },
    { sourceItemId: 2, partQtys: [{ sourcePartId: 21, qty: 100 }] },
    { sourceItemId: 1, partQtys: [] },
  ];
  it("子件1 各部位数量加总 = 1000", () => {
    expect(subItemTotalDemand(lines, 1)).toBe(1000);
  });
  it("子件2 = 100", () => {
    expect(subItemTotalDemand(lines, 2)).toBe(100);
  });
  it("不存在的子件 = 0", () => {
    expect(subItemTotalDemand(lines, 99)).toBe(0);
  });
});

describe("expandOrderParts — 把订单展开成可排部位清单（每部位带订单数量）", () => {
  const order = {
    lines: [
      { sourceItemId: 1, itemName: "兔子头", partQtys: [
        { sourcePartId: 11, partName: "头", qty: 500 },
        { sourcePartId: 12, partName: "耳", qty: 300 },
      ]},
      { sourceItemId: 2, itemName: "兔子身", partQtys: [
        { sourcePartId: 21, partName: "身", qty: 1000 },
      ]},
    ],
    product: {
      items: [
        { id: 1, itemName: "兔子头", parts: [
          { id: 11, partName: "头", productionMode: "machine", dailyCapacity: 11000, stdMachineCount: 1 },
          { id: 12, partName: "耳", productionMode: "machine", dailyCapacity: 11000, stdMachineCount: 1 },
        ]},
        { id: 2, itemName: "兔子身", parts: [
          { id: 21, partName: "身", productionMode: "manual", dailyCapacity: 5000, stdMachineCount: 1 },
        ]},
        { id: 3, itemName: "没下单的子件", parts: [{ id: 31, partName: "x", productionMode: "machine", dailyCapacity: 1, stdMachineCount: 1 }] },
      ],
    },
  };
  it("只展开订单填了数量的部位（子件3 不出现）", () => {
    const parts = expandOrderParts(order);
    expect(parts.map((p) => p.sourcePartId).sort((a, b) => a - b)).toEqual([11, 12, 21]);
  });
  it("每部位 totalDemand = 该部位订单数量（头 500、耳 300）", () => {
    const parts = expandOrderParts(order);
    expect(parts.find((p) => p.sourcePartId === 11)!.totalDemand).toBe(500);
    expect(parts.find((p) => p.sourcePartId === 12)!.totalDemand).toBe(300);
  });
  it("带出 productionMode/dailyCapacity/stdMachineCount/itemName/partName", () => {
    const parts = expandOrderParts(order);
    const body = parts.find((p) => p.sourcePartId === 21)!;
    expect(body).toMatchObject({
      sourceItemId: 2, itemName: "兔子身", partName: "身",
      productionMode: "manual", dailyCapacity: 5000, stdMachineCount: 1, totalDemand: 1000,
    });
  });
});

describe("addDays — 纯函数加天（不用 Date.now）", () => {
  it("2026-06-03 + 2 = 2026-06-05", () => {
    expect(addDays(new Date("2026-06-03"), 2).toISOString().slice(0, 10)).toBe("2026-06-05");
  });
});

describe("orderRemainingDays — 木桶取最慢部位（spec §5.3 口径A）", () => {
  it("单部位：5000 ÷ (1×11000) = ceil(0.45) = 1 天", () => {
    expect(orderRemainingDays([{ remainingQty: 5000, resourceCount: 1, dailyCapacity: 11000 }])).toBe(1);
  });
  it("多部位取 MAX：机喷1天 vs 人工2天 → 2 天", () => {
    expect(orderRemainingDays([
      { remainingQty: 5000, resourceCount: 1, dailyCapacity: 11000 },
      { remainingQty: 10000, resourceCount: 1, dailyCapacity: 5000 },
    ])).toBe(2);
  });
  it("某部位日产能 0（无法估）→ 返回 null", () => {
    expect(orderRemainingDays([{ remainingQty: 100, resourceCount: 0, dailyCapacity: 5000 }])).toBeNull();
  });
  it("空清单 → 0", () => {
    expect(orderRemainingDays([])).toBe(0);
  });
});

describe("orderFirstPlanDate — 上车间日 = 最早 planDate（spec §8-Q3）", () => {
  it("取最早", () => {
    expect(orderFirstPlanDate(["2026-06-05", "2026-06-03", "2026-06-09"])).toBe("2026-06-03");
  });
  it("无计划 → null", () => {
    expect(orderFirstPlanDate([])).toBeNull();
  });
});

describe("weeklyPlanDates — 每周排期：只对填了数的天生成日期（spec §3.3）", () => {
  it("周一(0)与周三(2)填了 → 两个日期", () => {
    expect(weeklyPlanDates("2026-06-08", [0, 2])).toEqual(["2026-06-08", "2026-06-10"]);
  });
  it("没填任何天 → 空数组", () => {
    expect(weeklyPlanDates("2026-06-08", [])).toEqual([]);
  });
});
