import { describe, expect, it } from "vitest";
import { calculateInventoryRows, type RawInventoryRow } from "@/lib/inventory";

function row(overrides: Partial<RawInventoryRow>): RawInventoryRow {
  return {
    productId: 1,
    productNo: "11494",
    orderId: 1,
    orderNo: "ZWZ001",
    partName: "耳朵",
    stepNo: 1,
    craft: "喷油",
    totalGood: 0,
    totalInbound: 0,
    ...overrides,
  };
}

describe("calculateInventoryRows", () => {
  it("先按订单计算工序积压，再汇总同货号部位", () => {
    const result = calculateInventoryRows([
      row({ orderId: 1, orderNo: "A", stepNo: 1, totalGood: 100 }),
      row({ orderId: 1, orderNo: "A", stepNo: 2, totalGood: 20, totalInbound: 10 }),
      row({ orderId: 2, orderNo: "B", stepNo: 1, totalGood: 20 }),
      row({ orderId: 2, orderNo: "B", stepNo: 2, totalGood: 100, totalInbound: 90 }),
    ])[0];

    expect(result.wipTotal).toBe(80);
    expect(result.finishedStock).toBe(100);
    expect(result.workshopStock).toBe(20);
    expect(result.orderNos).toBe("A,B");
  });

  it("同一订单相同 stepNo 的多条实绩合并后再计算", () => {
    const result = calculateInventoryRows([
      row({ stepNo: 1, craft: "喷油", totalGood: 60 }),
      row({ stepNo: 1, craft: "移印", totalGood: 40 }),
      row({ stepNo: 2, craft: "UV", totalGood: 70, totalInbound: 50 }),
    ])[0];

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ stepNo: 1, totalGood: 100, backlog: 30 });
    expect(result.wipTotal).toBe(30);
    expect(result.finishedStock).toBe(50);
    expect(result.workshopStock).toBe(20);
  });
});
