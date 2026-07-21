import { describe, it, expect } from "vitest";
import {
  partUnitPrice,
  productionValue,
  partRecordedTotal,
  partRemainingQty,
  isPartComplete,
  isOrderComplete,
} from "@/lib/recording";

describe("partUnitPrice 部位综合工价", () => {
  it("核+人工+油漆+特殊色加价求和", () => {
    expect(partUnitPrice({ unitCost: 0.5, laborPrice: 0.2, paintCost: 0.35 }, 0.08)).toBeCloseTo(1.13);
  });
  it("无特殊色加价时第二参默认 0", () => {
    expect(partUnitPrice({ unitCost: 0.5, laborPrice: 0.2, paintCost: 0.3 })).toBeCloseTo(1.0);
  });
  it("缺字段按 0 处理", () => {
    expect(partUnitPrice({ unitCost: 0.5 } as any)).toBeCloseTo(0.5);
  });
});

describe("productionValue 产值", () => {
  it("产值 = 生产数 × 综合工价", () => {
    expect(productionValue(200, 1.13)).toBeCloseTo(226);
  });
  it("负数/0 兜底为 0", () => {
    expect(productionValue(-5, 1)).toBe(0);
    expect(productionValue(100, -1)).toBe(0);
  });
});

describe("部位累计 / 余下数 / 完工", () => {
  it("partRecordedTotal 累计良品（忽略 null）", () => {
    expect(partRecordedTotal([100, null, 50])).toBe(150);
  });
  it("partRemainingQty 不为负", () => {
    expect(partRemainingQty(200, 150)).toBe(50);
    expect(partRemainingQty(200, 250)).toBe(0);
  });
  it("isPartComplete 累计 ≥ 需求且需求 > 0", () => {
    expect(isPartComplete(200, 200)).toBe(true);
    expect(isPartComplete(200, 199)).toBe(false);
    expect(isPartComplete(0, 0)).toBe(false);
  });
  it("isOrderComplete 所有部位都达成才算（木桶）", () => {
    expect(isOrderComplete([{ demand: 200, recorded: 200 }, { demand: 180, recorded: 180 }])).toBe(true);
    expect(isOrderComplete([{ demand: 200, recorded: 200 }, { demand: 180, recorded: 100 }])).toBe(false);
    expect(isOrderComplete([])).toBe(false);
  });
});
