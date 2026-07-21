import { describe, it, expect } from "vitest";
import {
  craftColor, loadLevel, dateRange, cellKey, buildOverviewGrid,
  type OverviewPlan, type OverviewLine,
} from "@/lib/scheduleOverview";

describe("craftColor", () => {
  it("手喷/自动喷/喷油 → 绿(spray)", () => {
    expect(craftColor("手喷")).toBe("spray");
    expect(craftColor("自动喷")).toBe("spray");
    expect(craftColor("喷油")).toBe("spray");
  });
  it("移印 → 蓝(print)、UV → 紫(uv)、其它 → other", () => {
    expect(craftColor("移印")).toBe("print");
    expect(craftColor("UV")).toBe("uv");
    expect(craftColor(" uv ")).toBe("uv");
    expect(craftColor("烫金")).toBe("other");
  });
});

describe("loadLevel", () => {
  it("<90% 未满 ok", () => expect(loadLevel(80, 100)).toBe("ok"));
  it("=90% 快满 busy", () => expect(loadLevel(90, 100)).toBe("busy"));
  it("90~100% 快满 busy", () => expect(loadLevel(95, 100)).toBe("busy"));
  it(">100% 超载 over", () => expect(loadLevel(106, 100)).toBe("over"));
  it("上限=0 不卡 → null", () => expect(loadLevel(500, 0)).toBeNull());
});

describe("dateRange", () => {
  it("闭区间含首尾", () => {
    expect(dateRange("2026-06-23", "2026-06-25")).toEqual(["2026-06-23", "2026-06-24", "2026-06-25"]);
  });
  it("跨月正确进位", () => {
    expect(dateRange("2026-06-29", "2026-07-01")).toEqual(["2026-06-29", "2026-06-30", "2026-07-01"]);
  });
  it("to < from → 空", () => expect(dateRange("2026-06-25", "2026-06-23")).toEqual([]));
});

describe("buildOverviewGrid", () => {
  const lines: OverviewLine[] = [
    { lineId: 1, name: "A拉", craftType: "自动喷", dailyLimit: 400000 },
    { lineId: 3, name: "C拉", craftType: "移印", dailyLimit: 300000 },
  ];
  const mk = (o: Partial<OverviewPlan>): OverviewPlan => ({
    id: 1, lineId: 1, date: "2026-06-23", orderId: 1, productNo: "P1", itemName: "兔子",
    partName: "头", stepNo: 1, craft: "自动喷", plannedQty: 1000, machineNos: [], workerCount: 1, ...o,
  });

  it("按 (日期,拉别) 分格，同格累加、计数", () => {
    const grid = buildOverviewGrid([
      mk({ partName: "头", plannedQty: 5000 }),
      mk({ partName: "身", plannedQty: 4000 }),
    ], lines);
    const cell = grid[cellKey("2026-06-23", 1)];
    expect(cell.count).toBe(2);
    expect(cell.total).toBe(9000);
  });

  it("同格 items 按数量降序", () => {
    const grid = buildOverviewGrid([
      mk({ partName: "小", plannedQty: 2000 }),
      mk({ partName: "大", plannedQty: 8000 }),
    ], lines);
    const items = grid[cellKey("2026-06-23", 1)].items;
    expect(items.map((i) => i.partName)).toEqual(["大", "小"]);
  });

  it("产能占用% + 档位按该拉日上限算", () => {
    const grid = buildOverviewGrid([mk({ lineId: 3, craft: "移印", plannedQty: 300000 })], lines);
    const cell = grid[cellKey("2026-06-23", 3)];
    expect(cell.occupancyPct).toBe(100);
    expect(cell.level).toBe("busy");
  });

  it("超载 >100% 判 over", () => {
    const grid = buildOverviewGrid([mk({ lineId: 3, craft: "移印", plannedQty: 330000 })], lines);
    expect(grid[cellKey("2026-06-23", 3)].level).toBe("over");
  });

  it("不同日期/拉别分到不同格", () => {
    const grid = buildOverviewGrid([
      mk({ date: "2026-06-23", lineId: 1 }),
      mk({ date: "2026-06-24", lineId: 1 }),
      mk({ date: "2026-06-23", lineId: 3, craft: "移印" }),
    ], lines);
    expect(Object.keys(grid).length).toBe(3);
  });

  it("计划行 craft 为空时，用所在拉别 craftType 兜底上色", () => {
    const uvLines: OverviewLine[] = [...lines, { lineId: 4, name: "UV拉", craftType: "UV", dailyLimit: 400000 }];
    const grid = buildOverviewGrid([
      mk({ lineId: 1, craft: "", partName: "自动喷部位" }),
      mk({ lineId: 4, craft: "", partName: "UV部位" }),
    ], uvLines);

    expect(grid[cellKey("2026-06-23", 1)].items[0].craft).toBe("自动喷");
    expect(grid[cellKey("2026-06-23", 1)].items[0].color).toBe("spray");
    expect(grid[cellKey("2026-06-23", 4)].items[0].craft).toBe("UV");
    expect(grid[cellKey("2026-06-23", 4)].items[0].color).toBe("uv");
  });
});
