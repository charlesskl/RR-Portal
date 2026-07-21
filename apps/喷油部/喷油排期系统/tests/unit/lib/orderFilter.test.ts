import { describe, it, expect } from "vitest";
import { filterOrders, type OrderRow } from "@/lib/orderFilter";

const rows: OrderRow[] = [
  { id: 1, externalOrderNo: "ZWZ001", productNo: "GH-1", orderDate: "2026-05-20", deliveryDate: "2026-06-10", status: "received",      isMA: false, isUrgent: false, totalQty: 100, pendingProduct: false },
  { id: 2, externalOrderNo: "ZWZ002", productNo: "KT-2", orderDate: "2026-05-22", deliveryDate: "2026-06-08", status: "scheduled",     isMA: true,  isUrgent: false, totalQty: 200, pendingProduct: false },
  { id: 3, externalOrderNo: "ZWZ003", productNo: "LP-3", orderDate: "2026-05-26", deliveryDate: "2026-06-05", status: "in_production", isMA: false, isUrgent: false, totalQty: 300, pendingProduct: false },
  { id: 4, externalOrderNo: "ZWZ004", productNo: "GH-9", orderDate: "2026-05-12", deliveryDate: "2026-05-30", status: "archived",      isMA: false, isUrgent: false, totalQty: 400, pendingProduct: false },
  { id: 5, externalOrderNo: "ZWZ005", productNo: "",     orderDate: "2026-05-28", deliveryDate: "2026-06-12", status: "received",      isMA: false, isUrgent: false, totalQty: 0,   pendingProduct: true },
];

describe("filterOrders", () => {
  it("正常单视图排除作废与待补产品", () => {
    const r = filterOrders(rows, { view: "normal" });
    expect(r.map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it("回收站视图只含作废", () => {
    const r = filterOrders(rows, { view: "recycle" });
    expect(r.map((x) => x.id)).toEqual([4]);
  });
  it("待补产品视图只含待补产品（非作废）", () => {
    const r = filterOrders(rows, { view: "pending" });
    expect(r.map((x) => x.id)).toEqual([5]);
  });
  it("关键词匹配 订单号/款号（不分大小写）", () => {
    expect(filterOrders(rows, { view: "normal", keyword: "lp-3" }).map((x) => x.id)).toEqual([3]);
    expect(filterOrders(rows, { view: "normal", keyword: "zwz002" }).map((x) => x.id)).toEqual([2]);
  });
  it("状态筛选只在正常单视图生效", () => {
    expect(filterOrders(rows, { view: "normal", status: "scheduled" }).map((x) => x.id)).toEqual([2]);
  });
  it("MA 筛选", () => {
    expect(filterOrders(rows, { view: "normal", ma: "ma" }).map((x) => x.id)).toEqual([2]);
    expect(filterOrders(rows, { view: "normal", ma: "formal" }).map((x) => x.id)).toEqual([1, 3]);
  });
  it("下单日范围", () => {
    expect(filterOrders(rows, { view: "normal", orderFrom: "2026-05-21", orderTo: "2026-05-26" }).map((x) => x.id)).toEqual([2, 3]);
  });
  it("交货日范围", () => {
    expect(filterOrders(rows, { view: "normal", deliveryFrom: "2026-06-09" }).map((x) => x.id)).toEqual([1]);
  });
});
