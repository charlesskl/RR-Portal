// 「货号资料查询」打印模板纯函数单测：标题/表头/总表+明细行/审核情况/日期区间与打印时间。
import { describe, expect, it } from "vitest";
import { auditText, buildStyleQueryPrintHtml } from "@/lib/printStyleQuery";
import type { BomStyleRow } from "@/api/types";

const rows: BomStyleRow[] = [
  {
    款号: "K001", 款式: "毛绒熊", 单价: 12.5, 物料项数: 2,
    日期: "2026-09-05", 台头: "测试台头A", 审核: "1", 操作员: "张三",
    明细: [
      { 物料编号: "157131", 物料名称: "子件单（包装）" },
      { 物料编号: "M-002", 物料名称: "透明胶纸" },
    ],
  },
  {
    款号: "K002", 款式: "塑料车", 单价: null, 物料项数: 0,
    日期: null, 台头: undefined, 审核: "0", 操作员: "李四",
    明细: [],
  },
];

describe("货号资料查询打印模板", () => {
  const html = buildStyleQueryPrintHtml(rows, {
    起: "2026-09-01", 止: "2026-09-30", 打印时间: new Date(2026, 8, 8),
  });

  it("标题/日期区间/打印时间/页脚", () => {
    expect(html).toContain("货 号 资 料 查 询");
    expect(html).toContain("日期： 2026年09月01日 至 2026年09月30日");
    expect(html).toContain("打印时间： 2026/9/8");
    expect(html).toContain("共　页，第　页");
    expect(html).toContain("A4 landscape");
  });

  it("表头九列齐全", () => {
    for (const h of ["单据类型", "日期", "客户编号", "客户名称", "款号", "款式", "默认价格", "操作员", "审核情况"])
      expect(html).toContain(`<th>${h}</th>`);
  });

  it("总表行渲染款号/款式/默认价格/操作员/审核情况", () => {
    expect(html).toContain("<td>总表</td><td>2026/9/5</td><td></td><td>测试台头A</td>");
    expect(html).toContain("<td>K001</td><td>毛绒熊</td>");
    expect(html).toContain(">12.5<");
    expect(html).toContain("<td>张三</td><td>已审核</td>");
    expect(html).toContain("<td>李四</td><td>未审核</td>");
  });

  it("明细行款号列显示 物料编号+物料名称", () => {
    expect(html).toContain("<td>明细</td>");
    expect(html).toContain("<td>157131子件单（包装）</td>");
    expect(html).toContain("<td>M-002透明胶纸</td>");
  });

  it("默认不传日期区间时取打印时间所在月", () => {
    const h2 = buildStyleQueryPrintHtml([], { 打印时间: new Date(2026, 8, 8) });
    expect(h2).toContain("日期： 2026年09月01日 至 2026年09月30日");
  });

  it("hidePrice 时默认价格脱敏为 ***", () => {
    const h3 = buildStyleQueryPrintHtml(rows, { hidePrice: true, 打印时间: new Date(2026, 8, 8) });
    expect(h3).toContain("***");
    expect(h3).not.toContain(">12.5<");
  });

  it("auditText 映射", () => {
    expect(auditText("1")).toBe("已审核");
    expect(auditText("0")).toBe("未审核");
    expect(auditText(null)).toBe("");
    expect(auditText("")).toBe("");
  });
});
