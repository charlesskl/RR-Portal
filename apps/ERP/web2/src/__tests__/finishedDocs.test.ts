// 成品入仓单明细纯函数(逐条移植老系统 web/src/__tests__/finished.test.ts 的 sumQty/validLines,
// 并补 merge/summarize/validate 对照 web/src/utils/finishedReceiptOrder.ts 的口径)
import { describe, expect, it } from "vitest";
import {
  mergeFinishedReceiptProducts,
  sumQty,
  summarizeFinishedReceiptLines,
  validateFinishedReceipt,
  validLines,
  type FinishedReceiptEditLine,
} from "@/lib/finishedDocs";

const line = (patch: Partial<FinishedReceiptEditLine>): FinishedReceiptEditLine => ({
  key: 1,
  配件编号: "",
  产品货号: "",
  数量: 0,
  ...patch,
});

describe("成品明细(移植老 finished.test.ts)", () => {
  it("sumQty 合计数量", () => {
    expect(sumQty([{ 数量: 60 }, { 数量: 40 }])).toBe(100);
    expect(sumQty([])).toBe(0);
  });
  it("validLines 过滤数量<=0 的行", () => {
    expect(validLines([{ 数量: 60 }, { 数量: 0 }, { 数量: -1 }])).toHaveLength(1);
  });
});

describe("mergeFinishedReceiptProducts", () => {
  it("按 配件编号|产品货号 去重,新行数量置 0,key 重排", () => {
    const cur = [line({ key: 1, 配件编号: "A1", 产品货号: "H1", 数量: 5 })];
    const merged = mergeFinishedReceiptProducts(cur, [
      { 配件编号: "A1", 产品货号: "H1" },
      { 配件编号: "A2", 产品货号: "H2" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ key: 2, 配件编号: "A2", 数量: 0 });
  });
});

describe("summarizeFinishedReceiptLines", () => {
  it("按 配件编号|产品装配名称 汇总入仓数量,跳过空行/数量<=0", () => {
    const rows = summarizeFinishedReceiptLines([
      line({ key: 1, 配件编号: "A1", 产品装配名称: "彩盒", 数量: 3 }),
      line({ key: 2, 配件编号: "A1", 产品装配名称: "彩盒", 数量: 2 }),
      line({ key: 3, 配件编号: "A1", 产品装配名称: "胶袋", 数量: 7 }),
      line({ key: 4, 配件编号: "", 数量: 9 }),
      line({ key: 5, 配件编号: "A2", 数量: 0 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 序号: 1, 配件编号: "A1", 产品装配名称: "彩盒", 入仓数量: 5 });
    expect(rows[1]).toMatchObject({ 序号: 2, 配件编号: "A1", 产品装配名称: "胶袋", 入仓数量: 7 });
  });
});

describe("validateFinishedReceipt", () => {
  it("仓库必填;至少一行 配件编号+数量>0", () => {
    expect(validateFinishedReceipt({ 仓库: "", 明细: [line({ 配件编号: "A1", 数量: 1 })] })).toBe(
      "请选择收货仓库",
    );
    expect(validateFinishedReceipt({ 仓库: "成品仓", 明细: [line({ 配件编号: "A1", 数量: 0 })] })).toBe(
      "请至少录入一行数量大于 0 的明细",
    );
    expect(
      validateFinishedReceipt({ 仓库: "成品仓", 明细: [line({ 配件编号: "A1", 数量: 1 })] }),
    ).toBeNull();
  });
});
