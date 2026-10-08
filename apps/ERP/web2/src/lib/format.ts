/** 数字/日期显示工具;全部 tabular-nums 由全局字体特性保证 */

export function fmtNum(v: number | null | undefined, digits?: number): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits ?? 2,
  });
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 空值兜底 */
export function txt(v: string | null | undefined): string {
  return v && v.trim() !== "" ? v : "-";
}
