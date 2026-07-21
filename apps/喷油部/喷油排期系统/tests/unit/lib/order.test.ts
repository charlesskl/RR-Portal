import { describe, it, expect } from "vitest";
import {
  lineTotalQty, orderTotalQty,
  partComprehensivePrice, lineUnitPrice,
} from "@/lib/order";

const lines = [
  { partQtys: [{ partName: "头", qty: 500 }, { partName: "身", qty: 300 }] },
  { partQtys: [{ partName: "头", qty: 100 }, { partName: "身", qty: 200 }] },
];

describe("lineTotalQty（行合计）", () => {
  it("某行各部位数量相加", () => {
    expect(lineTotalQty(lines[0].partQtys)).toBe(800);
  });
  it("空数组为 0", () => {
    expect(lineTotalQty([])).toBe(0);
  });
});

describe("orderTotalQty（整单总数）", () => {
  it("全单所有部位数量相加", () => {
    expect(orderTotalQty(lines)).toBe(1100);
  });
});

describe("partComprehensivePrice（部位单件综合价）", () => {
  it("= 核+人工+油漆", () => {
    const base = { unitCost: 0.5, laborPrice: 0.2, paintCost: 0.35 };
    expect(partComprehensivePrice(base)).toBeCloseTo(1.05, 4);
  });
});

describe("lineUnitPrice（子件单件综合价）", () => {
  it("Σ 各部位(核+人工+油漆)", () => {
    const parts = [
      { partName: "头", unitCost: 0.5, laborPrice: 0.2, paintCost: 0.35 },
      { partName: "身", unitCost: 0.3, laborPrice: 0.1, paintCost: 0.15 },
    ];
    // 头 1.05 ; 身 0.55 ; 合计 1.6
    expect(lineUnitPrice(parts)).toBeCloseTo(1.6, 4);
  });
});
