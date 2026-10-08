// 塑胶类型客户统计·透视纯逻辑(对照老系统 web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx):
// 行=客户,列=类型(本月数量/本月金额),末尾总合计;类型集合从数据去重排序。
import type { PlasticCustomerTypeStatRow } from "@/api/types";
import type { ExportCol } from "@/lib/tableExport";

export interface PivotCell {
  数量: number;
  金额: number;
}
export interface PivotRow {
  客户: string;
  cells: Record<string, PivotCell>;
  总数量: number;
  总金额: number;
}

// 类型集合:空类型归「未分类」,按 locale 排序(对照老系统 types useMemo)
export function collectTypes(rows: PlasticCustomerTypeStatRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.类型 ?? "未分类"))).sort((a, b) => a.localeCompare(b));
}

// 透视:客户 x 类型;同 客户+类型 只保留最后一行口径(老系统 cells[t] 直接覆盖),总数量/总金额累加
export function pivotCustomerType(rows: PlasticCustomerTypeStatRow[]): PivotRow[] {
  const m: Record<string, PivotRow> = {};
  for (const r of rows) {
    const k = r.客户 ?? "";
    (m[k] ??= { 客户: k, cells: {}, 总数量: 0, 总金额: 0 });
    const t = r.类型 ?? "未分类";
    const q = Number(r.数量 ?? 0);
    const a = Number(r.金额 ?? 0);
    m[k].cells[t] = { 数量: q, 金额: a };
    m[k].总数量 += q;
    m[k].总金额 += a;
  }
  return Object.values(m).sort((x, y) => x.客户.localeCompare(y.客户));
}

// 金额显示 1 位小数(对照老系统 fix1)
export const fix1 = (v: number) => Number(v).toFixed(1);

// 导出列(对照老系统 exportCols;无「金额」位时只出数量列)
export function exportCols(types: string[], 金额Hidden: boolean): ExportCol[] {
  return [
    { title: "客户", key: "客户" },
    ...types.flatMap((t) =>
      金额Hidden
        ? [{ title: `${t}-数量`, key: `${t}__q` }]
        : [
            { title: `${t}-数量`, key: `${t}__q` },
            { title: `${t}-金额`, key: `${t}__a` },
          ],
    ),
    { title: "总数量", key: "总数量" },
    ...(金额Hidden ? [] : [{ title: "总金额", key: "总金额" }]),
  ];
}

// 导出行(透视行平铺为 类型__q/类型__a 键)
export function exportRows(pivot: PivotRow[], types: string[]): Record<string, unknown>[] {
  return pivot.map((r) => {
    const o: Record<string, unknown> = { 客户: r.客户, 总数量: r.总数量, 总金额: r.总金额 };
    for (const t of types) {
      o[`${t}__q`] = r.cells[t]?.数量 ?? 0;
      o[`${t}__a`] = r.cells[t]?.金额 ?? 0;
    }
    return o;
  });
}
