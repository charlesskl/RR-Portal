import { describe, it, expect } from "vitest";
import { canEditPlanDates, isPlanDate, shiftPlanDate } from "@/lib/planDateAdjustment";

describe("plan date adjustment", () => {
  it.each(["", "2026-02-29", "2026-13-01", "2026-10-00", "0000-01-01", "+010000-01-01", "2026-1-2"])("拒绝空日期、不存在日期和扩展年份 %s", value => {
    expect(isPlanDate(value)).toBe(false);
    expect(() => shiftPlanDate(value, 1)).toThrow("有效日期");
  });
  it.each(["0001-01-01", "2024-02-29", "2026-10-14", "9999-12-31"])("保留有效日期 %s", value => {
    expect(isPlanDate(value)).toBe(true);
  });
  it("跨月、跨年、闰年顺延和提前按UTC日历计算", () => {
    expect(shiftPlanDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftPlanDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftPlanDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("年份溢出会提示，不能截断成错误的日期", () => {
    expect(() => shiftPlanDate("9999-12-31", 1)).toThrow("超出有效范围");
    expect(() => shiftPlanDate("0001-01-01", -1)).toThrow("超出有效范围");
  });
  it.each(["admin", "manager", "clerk"])("写角色 %s 可以调整", role => expect(canEditPlanDates(role)).toBe(true));
  it.each(["viewer", "", undefined, "unknown"])("其他角色 %s 不提供日期写入口", role => expect(canEditPlanDates(role)).toBe(false));
});
