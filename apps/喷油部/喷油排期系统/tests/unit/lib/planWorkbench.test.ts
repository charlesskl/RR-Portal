import { describe, expect, it } from "vitest";
import { draftOf, parseTsv, pasteDrafts, shiftDraft, valuesOf, type WorkbenchRow } from "../../../src/lib/planWorkbench";
const row = (id: number, lockedReason: string | null = null): WorkbenchRow => ({ id, token: "token", orderNo: "ORDER", productNo: "P", partName: "部位", stepNo: 1, craft: "移印", demand: 100, goodQty: null, inboundQty: null, lockedReason,
  values: { planDate: "2030-01-07", lineId: 1, machineNos: ["5#"], plannedQty: 100, workerCount: 2, workHours: 8, remark: "" } });
const lines = [{ id: 1, name: "C拉：移印", craftType: "移印", isActive: true, dailyLimit: 300000, machineNos: ["5#"] }];
describe("表格排期草稿", () => {
  it("读取 Excel 的多行、引号内换行及转义，不执行公式", () => {
    expect(parseTsv('100\t2\t8\t"第一行\n第二行"\r\n200\t3\t8\t"备注"\r\n')).toEqual([["100", "2", "8", "第一行\n第二行"], ["200", "3", "8", "备注"]]);
    expect(parseTsv('"a""b"\t=1+1')).toEqual([['a"b', '=1+1']]);
  });
  it("多格粘贴只写草稿，支持 Excel 日期与千分位", () => {
    const rows = [row(1), row(2)]; const next = pasteDrafts(rows, {}, 0, "planDate", '2030/1/8\tC拉：移印\t5#\t1,000\t2\t8\t备注\n2030年1月9日\t1\t5#\t200\t3\t7.5\t', lines);
    expect(valuesOf(next[1]).plannedQty).toBe(1000); expect(valuesOf(next[2]).planDate).toBe("2030-01-09"); expect(rows[0].values.plannedQty).toBe(100);
  });
  it("遇到锁定行或无效数值，整批草稿保持不变", () => {
    const initial = { 1: draftOf(row(1).values) };
    expect(() => pasteDrafts([row(1), row(2, "已报工")], initial, 0, "plannedQty", "90\n80", lines)).toThrow("锁定");
    expect(() => pasteDrafts([row(1), row(2)], initial, 0, "plannedQty", "90\n0", lines)).toThrow();
    expect(initial[1].plannedQty).toBe("100");
  });
  it("拒绝越界、未知拉别和非数值公式", () => {
    expect(() => pasteDrafts([row(1)], {}, 0, "remark", "a\tb", lines)).toThrow("超出");
    expect(() => pasteDrafts([row(1)], {}, 0, "lineId", "未知", lines)).toThrow("无法识别");
    expect(() => valuesOf({ ...draftOf(row(1).values), plannedQty: "=1+1" })).toThrow();
  });
  it("数量必须为正整数，工时可小数，日期不得溢出", () => {
    expect(() => valuesOf({ ...draftOf(row(1).values), plannedQty: "1.5" })).toThrow();
    expect(() => valuesOf({ ...draftOf(row(1).values), workHours: "25" })).toThrow();
    expect(shiftDraft(draftOf(row(1).values), -7).planDate).toBe("2029-12-31");
    expect(() => shiftDraft(draftOf(row(1).values), 1.5)).toThrow();
  });
});
