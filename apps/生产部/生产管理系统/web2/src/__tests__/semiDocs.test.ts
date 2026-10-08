// 半成品仓单据纯函数:移植老系统 semiReceiptOrder/semiIssue/semiScrap/semiStocktake 测试场景
// (web/src/__tests__/{semiReceiptOrder,semiIssue,semiScrap,semiStocktake}.test.ts) + 打印 HTML 断言。
import { describe, expect, it } from "vitest";
import {
  buildSemiDocPrintHtml,
  mergeSemiDraftLines,
  mergeSemiReceiptProducts,
  mergeSemiStocktakeLines,
  summarizeSemiReceiptLines,
  validateSemiDraft,
  validateSemiReceipt,
  validateSemiStocktake,
  type SemiDraftLine,
  type SemiReceiptEditLine,
  type SemiStkDraftLine,
} from "@/lib/semiDocs";

const rLine = (p: Partial<SemiReceiptEditLine>): SemiReceiptEditLine => ({
  key: 0,
  配件编号: "",
  产品货号: "",
  数量: 0,
  ...p,
});
const dLine = (p: Partial<SemiDraftLine>): SemiDraftLine => ({ key: 0, 配件编号: "", 数量: 0, ...p });
const sLine = (p: Partial<SemiStkDraftLine>): SemiStkDraftLine => ({
  key: 0,
  配件编号: "",
  系统数量: 0,
  盘点数量: 0,
  ...p,
});

describe("mergeSemiReceiptProducts", () => {
  it("按 配件编号|产品货号 去重,已有行保留数量,新产品数量 0", () => {
    const result = mergeSemiReceiptProducts(
      [rLine({ key: 1, 配件编号: "AAA0001", 产品货号: "9215A", 数量: 5 })],
      [
        { 配件编号: "AAA0001", 产品货号: "9215A", 产品装配名称: "已有配件" },
        { 配件编号: "AAA0002", 产品货号: "9215B", 产品装配名称: "新增配件", 客户: "ZURU" },
      ],
    );
    expect(result).toHaveLength(2);
    expect(result[0].数量).toBe(5);
    expect(result[1]).toMatchObject({ 配件编号: "AAA0002", 产品货号: "9215B", 客户: "ZURU", 数量: 0 });
  });
});

describe("summarizeSemiReceiptLines", () => {
  it("按 配件编号|产品装配名称 汇总入仓数量(数量<=0 跳过)", () => {
    const result = summarizeSemiReceiptLines([
      rLine({ key: 1, 配件编号: "AAA0001", 产品货号: "9215A", 产品装配名称: "彩盒", 数量: 10 }),
      rLine({ key: 2, 配件编号: "AAA0001", 产品货号: "9215B", 产品装配名称: "彩盒", 数量: 6 }),
      rLine({ key: 3, 配件编号: "AAA0002", 产品货号: "9215C", 产品装配名称: "胶袋", 数量: 4 }),
      rLine({ key: 4, 配件编号: "AAA0003", 产品货号: "9215D", 产品装配名称: "零", 数量: 0 }),
    ]);
    expect(result).toEqual([
      { key: "AAA0001|彩盒", 序号: 1, 配件编号: "AAA0001", 产品装配名称: "彩盒", 入仓数量: 16 },
      { key: "AAA0002|胶袋", 序号: 2, 配件编号: "AAA0002", 产品装配名称: "胶袋", 入仓数量: 4 },
    ]);
  });
});

describe("validateSemiReceipt", () => {
  it("供应商/仓库/有效明细三级校验", () => {
    expect(validateSemiReceipt({ 供应商名称: "", 仓库: "", 明细: [] })).toBe("请选择供应商");
    expect(validateSemiReceipt({ 供应商名称: "加工厂", 仓库: "", 明细: [] })).toBe("请选择收货仓库");
    expect(
      validateSemiReceipt({
        供应商名称: "加工厂",
        仓库: "半成品仓",
        明细: [rLine({ key: 1, 配件编号: "AAA", 产品货号: "9215", 数量: 0 })],
      }),
    ).toBe("请至少录入一行数量大于 0 的明细");
    expect(
      validateSemiReceipt({
        供应商名称: "加工厂",
        仓库: "半成品仓",
        明细: [rLine({ key: 1, 配件编号: "AAA", 产品货号: "9215", 数量: 1 })],
      }),
    ).toBeNull();
  });
});

describe("mergeSemiDraftLines(出库/报废同构)", () => {
  it("按配件编号去重,保留已存在数量,追加新产品", () => {
    const merged = mergeSemiDraftLines(
      [dLine({ key: 1, 配件编号: "A", 数量: 5 })],
      [{ 配件编号: "A" }, { 配件编号: "B" }],
    );
    expect(merged.map((l) => l.配件编号)).toEqual(["A", "B"]);
    expect(merged.find((l) => l.配件编号 === "A")!.数量).toBe(5);
  });
});

describe("validateSemiDraft(出库/报废同构)", () => {
  it("至少一行有效明细/数量>0/配件编号不重复", () => {
    expect(validateSemiDraft({ 明细: [] }, "出库")).toBe("请至少录入一行出库产品。");
    expect(validateSemiDraft({ 明细: [] }, "报废")).toBe("请至少录入一行报废产品。");
    expect(validateSemiDraft({ 明细: [dLine({ 配件编号: "A", 数量: 0 })] }, "出库")).toBe(
      "出库数量必须大于 0。",
    );
    expect(validateSemiDraft({ 明细: [dLine({ 配件编号: "A", 数量: 0 })] }, "报废")).toBe(
      "报废数量必须大于 0。",
    );
    expect(
      validateSemiDraft({ 明细: [dLine({ 配件编号: "A", 数量: 1 }), dLine({ 配件编号: "A", 数量: 2 })] }, "出库"),
    ).toBe("配件编号 A 在同一单据中重复。");
    expect(validateSemiDraft({ 明细: [dLine({ 配件编号: "A", 数量: 1 })] }, "出库")).toBeNull();
  });
});

describe("mergeSemiStocktakeLines", () => {
  it("按配件编号去重,保留已存在行;新行带出系统数量且盘点数量默认等于系统数量", () => {
    const merged = mergeSemiStocktakeLines(
      [sLine({ key: 1, 配件编号: "A", 系统数量: 5, 盘点数量: 3 })],
      [{ 配件编号: "A" }, { 配件编号: "B" }],
      (code) => (code === "B" ? 7 : 0),
    );
    expect(merged.map((l) => l.配件编号)).toEqual(["A", "B"]);
    expect(merged.find((l) => l.配件编号 === "A")!.盘点数量).toBe(3);
    const b = merged.find((l) => l.配件编号 === "B")!;
    expect(b.系统数量).toBe(7);
    expect(b.盘点数量).toBe(7);
  });
});

describe("validateSemiStocktake", () => {
  it("至少一行/盘点数量不为负/配件编号不重复/盘点 0 允许(盈亏为负合法)", () => {
    expect(validateSemiStocktake({ 明细: [] })).toBe("请至少录入一行盘点产品。");
    expect(validateSemiStocktake({ 明细: [sLine({ 配件编号: "A", 盘点数量: -1 })] })).toBe(
      "盘点数量不能为负。",
    );
    expect(
      validateSemiStocktake({ 明细: [sLine({ 配件编号: "A" }), sLine({ 配件编号: "A" })] }),
    ).toBe("配件编号 A 在同一单据中重复。");
    expect(
      validateSemiStocktake({ 明细: [sLine({ 配件编号: "A", 系统数量: 5, 盘点数量: 0 })] }),
    ).toBeNull();
  });
});

describe("buildSemiDocPrintHtml", () => {
  it("渲染单头+明细表,日期截前 10 位,HTML 转义", () => {
    const html = buildSemiDocPrintHtml(
      "半成品出库单 SI1",
      {
        单头: { 单号: "SI1", 日期: "2026-09-01T00:00:00", 领料人: "<张三>" },
        明细: [{ 配件编号: "AAA0001", 数量: 5 }],
      },
      { headItems: [["单号", "单号"], ["日期", "日期"], ["领料人", "领料人"]], lineCols: [["配件编号", "配件编号"], ["数量", "数量"]] },
    );
    expect(html).toContain("半成品出库单 SI1");
    expect(html).toContain("2026-09-01");
    expect(html).toContain("&lt;张三&gt;");
    expect(html).toContain("AAA0001");
    expect(html).toContain("<td>5</td>");
  });
});
