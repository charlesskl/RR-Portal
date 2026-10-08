import { describe, expect, it } from "vitest";
import { buildSemiSetupLines, type SemiSetupSourceRow } from "@/lib/semiSetup";

const rows: SemiSetupSourceRow[] = [
  { key: 1, 物料编号: "M-001", 物料名称: "面料A", 规格: "100D", 颜色: "红", 单位: "米", 用量: 2.5 },
  { key: 2, 物料编号: "M-002", 物料名称: "辅料B", 单位: "PCS", 用量: 4 },
  { key: 3, 物料编号: "", 物料名称: "空编号行" },
];

describe("buildSemiSetupLines", () => {
  it("按选中 key 映射出明细载荷", () => {
    const lines = buildSemiSetupLines(rows, [1, 2]);
    expect(lines).toEqual([
      { 物料编号: "M-001", 物料名称: "面料A", 规格: "100D", 颜色: "红", 单位: "米", 使用数量: 2.5 },
      { 物料编号: "M-002", 物料名称: "辅料B", 规格: null, 颜色: null, 单位: "PCS", 使用数量: 4 },
    ]);
  });

  it("过滤空物料编号的行", () => {
    expect(buildSemiSetupLines(rows, [1, 3])).toHaveLength(1);
    expect(buildSemiSetupLines(rows, [3])).toEqual([]);
  });

  it("保持勾选中传入的顺序（与表格行顺序无关）", () => {
    const lines = buildSemiSetupLines(rows, [2, 1]);
    expect(lines.map(l => l.物料编号)).toEqual(["M-002", "M-001"]);
  });

  it("忽略不存在的 key", () => {
    expect(buildSemiSetupLines(rows, [999])).toEqual([]);
  });
});
