// 库存月结/月报表纯逻辑(照抄老系统 web/src/utils/monthEnd.ts)
export type MonthEndKind = "成品" | "半成品" | "物料";

export interface MonthEndDimCol {
  title: string;
  key: string;
}

// 维度列按口径切换;公共列(期初/本期入/本期出/结存)由页面拼接
export function dimColumns(kind: MonthEndKind): MonthEndDimCol[] {
  if (kind === "成品")
    return [
      { title: "仓库", key: "仓库" },
      { title: "款号", key: "款号" },
      { title: "色号", key: "色号" },
      { title: "颜色", key: "颜色" },
      { title: "尺码", key: "尺码" },
    ];
  if (kind === "半成品")
    return [
      { title: "仓库", key: "仓库" },
      { title: "物料编号", key: "物料编号" },
      { title: "规格", key: "规格" },
      { title: "颜色", key: "颜色" },
    ];
  return [
    { title: "仓库", key: "仓库" },
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "规格", key: "规格" },
    { title: "单位", key: "单位" },
  ];
}

// 物料口径的金额列(成本保密由服务端置 null 落地);其它口径无金额列
export function moneyColumns(kind: MonthEndKind): MonthEndDimCol[] {
  if (kind !== "物料") return [];
  return [
    { title: "加权单价", key: "加权单价" },
    { title: "期初金额", key: "期初金额" },
    { title: "本期入金额", key: "本期入金额" },
    { title: "本期出金额", key: "本期出金额" },
    { title: "结存金额", key: "结存金额" },
  ];
}

// 月份输入(type="month" 的 YYYY-MM) -> 后端口径 yyyyMM;空串原样回
export function toYearMonth(monthValue: string | null | undefined): string {
  const v = (monthValue ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return "";
  return v.replace("-", "");
}

// 当前月的 type="month" 输入值(YYYY-MM)
export function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
