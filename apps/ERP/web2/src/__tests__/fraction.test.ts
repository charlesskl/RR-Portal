import { describe, expect, it } from "vitest";
import { formatQty, parseQtyInput } from "@/lib/fraction";

describe("parseQtyInput", () => {
  it("分数写法:1/6、1 / 2、2/3", () => {
    expect(parseQtyInput("1/6")).toBeCloseTo(1 / 6, 10);
    expect(parseQtyInput("1 / 2")).toBe(0.5);
    expect(parseQtyInput("2/3")).toBeCloseTo(2 / 3, 10);
  });

  it("整数/小数原样解析", () => {
    expect(parseQtyInput("2")).toBe(2);
    expect(parseQtyInput("0.1667")).toBe(0.1667);
  });

  it("空/非法/除零 → undefined", () => {
    expect(parseQtyInput("")).toBeUndefined();
    expect(parseQtyInput("  ")).toBeUndefined();
    expect(parseQtyInput("abc")).toBeUndefined();
    expect(parseQtyInput("1/0")).toBeUndefined();
    expect(parseQtyInput("1/")).toBeUndefined();
  });

  it("中文输入法兼容:全角斜杠/分数斜杠/除法斜杠/全角数字/全角点", () => {
    expect(parseQtyInput("1／2")).toBe(0.5); // 全角斜杠 U+FF0F
    expect(parseQtyInput("１／２")).toBe(0.5); // 全角数字+全角斜杠
    expect(parseQtyInput("1⁄2")).toBe(0.5); // 分数斜杠 U+2044
    expect(parseQtyInput("1∕2")).toBe(0.5); // 除法斜杠 U+2215
    expect(parseQtyInput("０．５")).toBe(0.5); // 全角小数
    expect(parseQtyInput("２／３")).toBeCloseTo(2 / 3, 10);
  });
});

describe("formatQty", () => {
  it("整数原样", () => {
    expect(formatQty(1)).toBe("1");
    expect(formatQty(12)).toBe("12");
    expect(formatQty(0)).toBe("0");
  });

  it("0~1 之间可约分数显示为分数(decimal(18,4) 存的四舍五入值也能回显)", () => {
    expect(formatQty(0.1667)).toBe("1/6"); // 数据库存的 1/6
    expect(formatQty(1 / 6)).toBe("1/6");
    expect(formatQty(0.5)).toBe("1/2");
    expect(formatQty(0.3333)).toBe("1/3");
    expect(formatQty(0.25)).toBe("1/4");
    expect(formatQty(0.6667)).toBe("2/3");
  });

  it("不可约/超出范围 → 小数去尾零", () => {
    expect(formatQty(2.5)).toBe("2.5");
    expect(formatQty(1.5)).toBe("1.5");
    expect(formatQty(0.137)).toBe("0.137");
  });

  it("空值 → 空串", () => {
    expect(formatQty(null)).toBe("");
    expect(formatQty(undefined)).toBe("");
  });
});
