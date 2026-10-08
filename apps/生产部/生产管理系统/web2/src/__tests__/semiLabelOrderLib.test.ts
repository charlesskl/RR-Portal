// 半成品标签单领域纯函数:移植老系统 web/src/__tests__/semiFinishedLabelOrders.test.ts 核心场景。
import { describe, expect, it } from "vitest";
import {
  buildSemiPrintLabels,
  calculateExpectedLabels,
  markActualLabelsEdited,
  mergeSelectedLabelProducts,
  recalculateLabelLine,
  validateSemiLabelOrder,
  validateSemiLabelOrderForPrint,
  type SemiLabelLine,
} from "@/lib/semiLabelOrder";

const line = (p: Partial<SemiLabelLine>): SemiLabelLine => ({
  key: 0,
  配件编号: "A",
  产品货号: "G",
  数量: 0,
  预计标签数: 0,
  实需标签数: 0,
  实需标签数已手改: false,
  ...p,
});

describe("半成品标签单前端领域", () => {
  it("calculateExpectedLabels:向上取整;每箱为空/<=0/数量<=0 得 0", () => {
    expect(calculateExpectedLabels(10, 4)).toBe(3);
    expect(calculateExpectedLabels(8, 4)).toBe(2);
    expect(calculateExpectedLabels(10, 0)).toBe(0);
    expect(calculateExpectedLabels(10, null)).toBe(0);
    expect(calculateExpectedLabels(0, 4)).toBe(0);
  });

  it("recalculateLabelLine:数量/每箱改动重算;实需手改后不跟随", () => {
    const base = line({ 数量: 5, 每箱数量: 2 });
    const recalc = recalculateLabelLine(base, { 数量: 7 });
    expect(recalc.预计标签数).toBe(4);
    expect(recalc.实需标签数).toBe(4);
    const manual = markActualLabelsEdited(base, 9);
    const recalc2 = recalculateLabelLine(manual, { 数量: 100 });
    expect(recalc2.预计标签数).toBe(50);
    expect(recalc2.实需标签数).toBe(9);
  });

  it("mergeSelectedLabelProducts:按配件编号(去空格,大小写不敏感)合并,数量累加重算", () => {
    const merged = mergeSelectedLabelProducts(
      [line({ 配件编号: " AAA ", 数量: 4, 每箱数量: 2 })],
      [
        { 配件编号: "aaa", 产品货号: "G1", 数量: 3, 每箱数量: 2 },
        { 配件编号: "B", 产品货号: "G2", 数量: 5, 每箱数量: 5 },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].配件编号).toBe("AAA"); // 保留首个显示值
    expect(merged[0].数量).toBe(7);
    expect(merged[0].预计标签数).toBe(4);
    expect(merged[1]).toMatchObject({ 配件编号: "B", 数量: 5, 预计标签数: 1, 实需标签数: 1 });
  });

  it("validateSemiLabelOrder:保存级校验(每箱可空;预计须等于计算值;实需非负整数)", () => {
    expect(validateSemiLabelOrder({ 明细: [] })[0].消息).toBe("至少需要一条明细");
    expect(
      validateSemiLabelOrder({ 明细: [line({ 配件编号: "", 产品货号: "" })] }).map((i) => i.字段),
    ).toEqual(["明细[0].配件编号", "明细[0].产品货号"]);
    const ok = line({ 数量: 10, 每箱数量: 4, 预计标签数: 3, 实需标签数: 3 });
    expect(validateSemiLabelOrder({ 明细: [ok] })).toEqual([]);
    const badActual = line({ 数量: 10, 每箱数量: 4, 预计标签数: 3, 实需标签数: 1.5 });
    expect(validateSemiLabelOrder({ 明细: [badActual] })[0].消息).toBe("实际标签数必须为有限的非负整数");
  });

  it("validateSemiLabelOrderForPrint:打印级要求每箱数量>0", () => {
    const noBox = line({ 数量: 10, 每箱数量: null, 预计标签数: 0, 实需标签数: 0 });
    expect(validateSemiLabelOrder({ 明细: [noBox] })).toEqual([]);
    expect(validateSemiLabelOrderForPrint({ 明细: [noBox] })[0].消息).toBe("打印前每箱数量必须大于 0");
  });

  it("buildSemiPrintLabels:按实需标签数展开,0 跳过,带序号/总数", () => {
    const labels = buildSemiPrintLabels([
      line({ 配件编号: "A", 实需标签数: 2 }),
      line({ 配件编号: "B", 实需标签数: 0 }),
      line({ 配件编号: "C", 实需标签数: 1 }),
    ]);
    expect(labels.map((l) => [l.配件编号, l.标签序号, l.标签总数])).toEqual([
      ["A", 1, 2],
      ["A", 2, 2],
      ["C", 1, 1],
    ]);
  });
});
