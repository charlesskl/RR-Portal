/** 日期调整只使用日历日期，避免本地时区、空日期和年份溢出。 */
export function isPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftPlanDate(value: string, days: number): string {
  if (!isPlanDate(value)) throw new Error("请先为勾选的计划填写有效日期");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!isPlanDate(result)) throw new Error("调整后的日期超出有效范围，请减少调整天数");
  return result;
}

export const canEditPlanDates = (role?: string) => role === "clerk" || role === "manager" || role === "admin";
