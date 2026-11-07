import type { RSILine } from "@/api/types";

// 仅格式化显示：保留行内数量和冻结换算，不把包与KG相加。
export function rawIssueQuantitySummary(lines: Pick<RSILine, "单位" | "数量">[]): string {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const rawUnit = line.单位?.trim() || "单位未填";
    const unit = ["KG", "公斤", "千克"].includes(rawUnit.toUpperCase()) ? "KG" : rawUnit;
    const quantity = Number(line.数量 ?? 0);
    if (!Number.isFinite(quantity)) continue;
    totals.set(unit, (totals.get(unit) ?? 0) + quantity);
  }
  const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8, useGrouping: false });
  return totals.size ? [...totals].map(([unit, value]) => `${format.format(value)} ${unit}`).join("；") : "0";
}
