import { describe, expect, it } from "vitest";
import { orderScheduleCoverage, recordedOrderProgress } from "@/lib/orderProgress";
import type { GanttOrder } from "@/lib/scheduleData";

function order(plans: GanttOrder["plans"]): GanttOrder {
  return {
    id: 1, externalOrderNo: "T1", productNo: "P1", status: "in_production",
    deliveryDate: null, scheduled: true, firstPlanDate: null, expectedOutDate: null,
    demandParts: [
      { sourceItemId: 1, itemName: "抹茶杯", sourcePartId: 11, partName: "杯", totalDemand: 100_000 },
      { sourceItemId: 2, itemName: "抹茶花朵", sourcePartId: 12, partName: "花朵", totalDemand: 100_000 },
    ],
    plans,
  };
}

const plan = (itemName: string, partName: string, plannedQty: number, goodQty: number | null, planDate = "2026-07-15") => ({
  planDate, itemName, partName, sourcePartId: null, plannedQty, goodQty,
  reportedQty: goodQty, machineNos: [], workerCount: 1,
});

describe("recordedOrderProgress", () => {
  it("does not let one over-reported child part cover a missing child part", () => {
    const result = recordedOrderProgress(order([
      plan("抹茶杯", "杯", 100_000, 100_000),
      plan("抹茶杯", "杯", 100_000, 100_000),
    ]));
    expect(result).toEqual({ demandQty: 200_000, recordedQty: 100_000, progressPct: 50 });
  });

  it("reaches 100% only when both child parts are recorded", () => {
    const result = recordedOrderProgress(order([
      plan("抹茶杯", "杯", 100_000, 100_000),
      plan("抹茶花朵", "花朵", 100_000, 100_000),
    ]));
    expect(result).toEqual({ demandQty: 200_000, recordedQty: 200_000, progressPct: 100 });
  });
});

describe("orderScheduleCoverage", () => {
  it("is not covered when only one child part is over-scheduled", () => {
    expect(orderScheduleCoverage(order([plan("抹茶杯", "杯", 450_000, null)]))).toEqual({
      covered: false, finishDate: null,
    });
  });

  it("uses the date on which the last required child part becomes covered", () => {
    const result = orderScheduleCoverage(order([
      plan("抹茶杯", "杯", 100_000, null, "2026-07-15"),
      plan("抹茶花朵", "花朵", 100_000, null, "2026-07-18"),
    ]));
    expect(result).toEqual({ covered: true, finishDate: "2026-07-18" });
  });
});
