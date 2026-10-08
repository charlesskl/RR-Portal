// 采购订单进度·整单视图:明细行按 采购单号 汇总成一行(一整张订单的进度)。
// 照抄老系统 web/src/utils/orderProgressSummary.ts(通用形状:来料仓/塑胶/原料三个进度表共用)。
export interface ProgressLineLike {
  采购单号?: string;
  订购日期?: string;
  交货日期?: string;
  生产单号?: string | null;
  供应商名称?: string;
  操作员?: string;
  审核?: string;
  订购数量?: number | null; // 来料仓/塑胶口径
  订货数量?: number | null; // 原料仓口径
  入仓数量?: number | null;
  欠数?: number | null;
}

export interface OrderProgressSummaryRow {
  采购单号: string;
  订购日期?: string;
  交货日期?: string;
  生产单号: string; // 一张订单可挂多个生产单,顿号连接;无则空串
  供应商名称?: string;
  操作员?: string;
  审核?: string;
  订购数量: number;
  入仓数量: number;
  欠数: number;
  完成情况: "已完成" | "部分入仓" | "未入仓";
}

export const summarizeOrderProgress = (rows: ProgressLineLike[]): OrderProgressSummaryRow[] => {
  const map = new Map<string, OrderProgressSummaryRow & { _mos: Set<string> }>();
  for (const r of rows) {
    const no = r.采购单号 ?? "";
    if (!no) continue;
    let g = map.get(no);
    if (!g) {
      g = {
        采购单号: no,
        订购日期: r.订购日期,
        交货日期: r.交货日期,
        生产单号: "",
        供应商名称: r.供应商名称,
        操作员: r.操作员,
        审核: r.审核,
        订购数量: 0,
        入仓数量: 0,
        欠数: 0,
        完成情况: "未入仓",
        _mos: new Set(),
      };
      map.set(no, g);
    }
    if (r.生产单号) g._mos.add(r.生产单号);
    g.订购数量 += Number(r.订购数量 ?? r.订货数量) || 0;
    g.入仓数量 += Number(r.入仓数量) || 0;
    g.欠数 += Number(r.欠数) || 0;
  }
  return [...map.values()].map(({ _mos, ...g }) => ({
    ...g,
    生产单号: [..._mos].join("、"),
    完成情况: g.欠数 <= 0 ? "已完成" : g.入仓数量 > 0 ? "部分入仓" : "未入仓",
  }));
};
