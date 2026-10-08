import { describe, expect, it } from "vitest";
import {
  maDefRow, maMaterialKey, pickedMaDefRows, pickedMaMaterialRows,
} from "@/lib/maPick";

const existing = [
  { 物料编号: "M1", 物料名称: "面料", 规格: "1.5m", 颜色: "黑色" },
  { 物料编号: "织带A", 物料名称: "织带", 规格: "", 颜色: "" },
];

describe("maMaterialKey / pickedMaMaterialRows（实单版勾选 MA 物料去重）", () => {
  it("去重键=编号+规格+颜色", () => {
    expect(maMaterialKey("M1", "1.5m", "黑色")).toBe("M1|1.5m|黑色");
    expect(maMaterialKey(" M1 ", null, undefined)).toBe("M1||");
  });

  it("跳过明细已存在的 编号+规格+颜色 组合，规格/颜色不同则算新行", () => {
    const added = pickedMaMaterialRows(existing, [
      { 物料编号: "M1", 物料名称: "面料", 规格: "1.5m", 颜色: "黑色", 使用数量: 2 },   // 已存在 → 跳过
      { 物料编号: "M1", 物料名称: "面料", 规格: "2.0m", 颜色: "黑色", 使用数量: 3 },   // 规格不同 → 保留
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ 物料编号: "M1", 规格: "2.0m", 用量: 3 });
  });

  it("勾选内重复只加一次；材料列取 MA 行的物料类别，空编号行忽略", () => {
    const added = pickedMaMaterialRows([], [
      { 物料编号: "P1", 物料名称: "塑胶件", 物料类别: "塑胶", 单位: "PCS", 使用数量: 1 },
      { 物料编号: "P1", 物料名称: "塑胶件", 物料类别: "塑胶", 单位: "PCS", 使用数量: 1 },
      { 物料编号: " ", 物料名称: "空编号" },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ 物料编号: "P1", 材料: "塑胶", 单位: "PCS", 用量: 1 });
  });
});

describe("maDefRow / pickedMaDefRows（半成品行构造）", () => {
  it("半成品行：编号=名称=定义名称，材料列标“半成品”，单位 个 用量 1", () => {
    expect(maDefRow("纸袋MA", "半成品")).toEqual({
      物料编号: "纸袋MA", 物料名称: "纸袋MA", 工模编号: "", 规格: "",
      材料: "半成品", 颜色: "", 单位: "个", 用量: 1, 备注: "",
    });
  });

  it("半成品行用量取定义上的半成品用量(做 1 个成品要几个),未设置按 1", () => {
    expect(maDefRow("大蛋", "半成品", 2.5)).toMatchObject({ 用量: 2.5 });
    expect(maDefRow("大蛋", "半成品", null)).toMatchObject({ 用量: 1 });
    const added = pickedMaDefRows([], [
      { 名称: "大蛋", 类型: "半成品", 用量: 6 },
      { 名称: "底座", 类型: "半成品" },
    ]);
    expect(added[0]).toMatchObject({ 物料编号: "大蛋", 用量: 6 });
    expect(added[1]).toMatchObject({ 物料编号: "底座", 用量: 1 });
  });

  it("同名（编号或名称命中已存在行）跳过，勾选内重复只加一次", () => {
    const added = pickedMaDefRows(existing, [
      { 名称: "织带A", 类型: "半成品" },     // 与已存在行编号同名 → 跳过
      { 名称: "织带", 类型: "半成品" },      // 与已存在行名称同名 → 跳过
      { 名称: "纸袋MA", 类型: "半成品" },
      { 名称: "纸袋MA", 类型: "半成品" },   // 勾选内重复 → 只加一次
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ 物料编号: "纸袋MA", 材料: "半成品" });
  });
});
