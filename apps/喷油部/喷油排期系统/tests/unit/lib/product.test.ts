import { describe, it, expect } from "vitest";
import { comprehensiveCost, sumUnitCost, sumQuotedPrice, filterProducts } from "@/lib/product";

const parts = [
  { unitCost: 0.5, laborPrice: 0.2, paintCost: 0.35, quotedPrice: 1.5 },
  { unitCost: 0.3, laborPrice: 0.1, paintCost: 0.15, quotedPrice: 0.8 },
];

describe("comprehensiveCost", () => {
  it("综合成本 = 核价 + 人工价 + 油漆价（无色加价）", () => {
    expect(comprehensiveCost(parts[0])).toBeCloseTo(1.05, 4);
  });
});

describe("sumUnitCost（总核价）", () => {
  it("各部位核价相加", () => {
    expect(sumUnitCost(parts)).toBeCloseTo(0.8, 4);
  });
  it("空数组返回 0", () => {
    expect(sumUnitCost([])).toBe(0);
  });
});

describe("sumQuotedPrice（总报价）", () => {
  it("各部位报价相加", () => {
    expect(sumQuotedPrice(parts)).toBeCloseTo(2.3, 4);
  });
});

describe("filterProducts（列表搜索）", () => {
  const rows = [
    { productNo: "11494" },
    { productNo: "20881" },
  ];
  it("关键词为空时原样返回", () => {
    expect(filterProducts(rows, "")).toHaveLength(2);
    expect(filterProducts(rows, "   ")).toHaveLength(2);
  });
  it("按货号模糊匹配", () => {
    const r = filterProducts(rows, "114");
    expect(r).toHaveLength(1);
    expect(r[0].productNo).toBe("11494");
  });
  it("无匹配返回空", () => {
    expect(filterProducts(rows, "xxxx")).toHaveLength(0);
  });
});
