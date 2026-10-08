// 塑胶类型客户统计(/plastic-customer-type-stats)。对照老系统 web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx:
// 上月/本月/下月 + 日期区间 + 客户关键字;透视表(行=客户,列=类型 x 本月数量/本月金额,末尾总合计);
// 无「金额」位不出金额列(后端同时把金额置 null);底部总合计行;导出 CSV + 打印(透视平铺列)。
// 权限菜单=塑胶类型客户统计(MenuCatalog.cs:56 实证:塑胶报表组)。
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { plasticCustomerTypeApi } from "@/api/endpoints";
import {
  collectTypes,
  exportCols,
  exportRows,
  fix1,
  pivotCustomerType,
} from "@/lib/plasticCustomerType";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "塑胶类型客户统计";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-center font-medium whitespace-nowrap normal-case";
// 第二级表头 sticky 偏移=第一级行高(py-2.5 + f-label 行高 + 边框)
const thCls2 =
  "f-label sticky top-[37px] z-10 border-b border-black/8 bg-white px-3 py-2 text-center font-medium whitespace-nowrap normal-case";

export default function PlasticCustomerTypeStatsPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const 金额Hidden = !can(MENU, "金额");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [客户Input, set客户Input] = useState("");
  const [applied, setApplied] = useState<{ 客户?: string }>({});

  const statsQuery = useQuery({
    queryKey: ["plastic-customer-type-stats", range, applied],
    queryFn: () => plasticCustomerTypeApi.list(range.起, range.止, applied.客户),
    enabled: canOpen && !permsLoading && !!range.起 && !!range.止,
  });
  const rows = useMemo(() => statsQuery.data ?? [], [statsQuery.data]);
  const types = useMemo(() => collectTypes(rows), [rows]);
  const pivot = useMemo(() => pivotCustomerType(rows), [rows]);

  const typeQ = (t: string) => pivot.reduce((s, r) => s + (r.cells[t]?.数量 ?? 0), 0);
  const typeA = (t: string) => pivot.reduce((s, r) => s + (r.cells[t]?.金额 ?? 0), 0);
  const grandQ = pivot.reduce((s, r) => s + r.总数量, 0);
  const grandA = pivot.reduce((s, r) => s + r.总金额, 0);

  const doExport = () =>
    downloadCsv("塑胶类型客户统计.csv", exportCols(types, 金额Hidden), exportRows(pivot, types));
  const doPrint = () =>
    printTable("塑胶类型客户统计", exportCols(types, 金额Hidden), exportRows(pivot, types));

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶类型客户统计·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶类型客户统计</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏(对照老系统:上/本/下月 + 起止 + 客户 + 货币(默认,禁用) + 导出/打印) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { label: "上月", off: -1 },
            { label: "本月", off: 0 },
            { label: "下月", off: 1 },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              className="h-9 rounded-lg px-4 text-sm text-[#5f6b7d] transition-colors hover:text-[#3d4a5c]"
              onClick={() => setRange(monthRange(b.off))}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <span className="f-label block">日期区间</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="起"
              className="f-input w-38"
              value={range.起}
              onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
            />
            <span className="text-[#5f6b7d]">~</span>
            <input
              type="date"
              aria-label="止"
              className="f-input w-38"
              value={range.止}
              onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
            />
          </div>
        </div>
        <div className="w-48 space-y-1.5">
          <label htmlFor="pct-cust" className="f-label block">
            客户
          </label>
          <Input
            id="pct-cust"
            className={inputCls}
            placeholder="客户"
            value={客户Input}
            onChange={(e) => set客户Input(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ 客户: 客户Input.trim() || undefined })
            }
          />
        </div>
        <div className="w-32 space-y-1.5">
          <span className="f-label block">货币</span>
          <SearchSelect ariaLabel="货币" value="默认" options={[{ value: "默认", label: "货币:默认" }]} disabled onChange={() => {}} />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setApplied({ 客户: 客户Input.trim() || undefined })}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button type="button" className="f-btn px-5" onClick={doExport}>
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button type="button" className="f-btn px-5" onClick={doPrint}>
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      {/* 透视表(两级表头:类型 -> 本月数量/本月金额;末尾总合计;底部合计行) */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        {statsQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full bg-black/5" />
            ))}
          </div>
        ) : statsQuery.isError ? (
          <div className="p-6">
            <DocError message="加载塑胶类型客户统计失败,请重试" onRetry={() => statsQuery.refetch()} />
          </div>
        ) : pivot.length === 0 ? (
          <div className="p-6">
            <DocEmpty
              icon={<Prohibit className="h-5 w-5" />}
              title="暂无数据"
              description="当前筛选条件下没有统计数据"
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[900px] text-[15px]">
              <thead>
                <tr>
                  <th rowSpan={2} className={cn(thCls, "text-left")}>
                    客户
                  </th>
                  {types.map((t) => (
                    <th key={t} colSpan={金额Hidden ? 1 : 2} className={thCls}>
                      {t}
                    </th>
                  ))}
                  <th colSpan={金额Hidden ? 1 : 2} className={thCls}>
                    总合计
                  </th>
                </tr>
                <tr>
                  {types.flatMap((t) => [
                    <th key={`${t}-q`} className={cn(thCls2, "text-right")}>
                      本月数量
                    </th>,
                    ...(金额Hidden
                      ? []
                      : [
                          <th key={`${t}-a`} className={cn(thCls2, "text-right")}>
                            本月金额
                          </th>,
                        ]),
                  ])}
                  <th className={cn(thCls2, "text-right")}>总数量</th>
                  {!金额Hidden && <th className={cn(thCls2, "text-right")}>总金额</th>}
                </tr>
              </thead>
              <tbody>
                {pivot.map((r) => (
                  <tr key={r.客户} className="border-b border-black/6 last:border-0">
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap text-[#1a2330]">
                      {r.客户}
                    </td>
                    {types.flatMap((t) => [
                      <td
                        key={`${t}-q`}
                        className="f-mono px-3 py-2.5 text-right whitespace-nowrap text-[#3d4a5c]"
                      >
                        {r.cells[t]?.数量 ?? 0}
                      </td>,
                      ...(金额Hidden
                        ? []
                        : [
                            <td
                              key={`${t}-a`}
                              className="f-mono px-3 py-2.5 text-right whitespace-nowrap text-[#3d4a5c]"
                            >
                              {fix1(r.cells[t]?.金额 ?? 0)}
                            </td>,
                          ]),
                    ])}
                    <td className="f-mono px-3 py-2.5 text-right font-semibold whitespace-nowrap text-[#1a2330]">
                      {r.总数量}
                    </td>
                    {!金额Hidden && (
                      <td className="f-mono px-3 py-2.5 text-right font-semibold whitespace-nowrap text-[#1a2330]">
                        {fix1(r.总金额)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/10 bg-black/[0.03]">
                  <td className="px-3 py-2.5 font-bold whitespace-nowrap text-[#1a2330]">总合计</td>
                  {types.flatMap((t) => [
                    <td
                      key={`${t}-q`}
                      className="f-mono px-3 py-2.5 text-right font-bold whitespace-nowrap text-[#1a2330]"
                    >
                      {typeQ(t)}
                    </td>,
                    ...(金额Hidden
                      ? []
                      : [
                          <td
                            key={`${t}-a`}
                            className="f-mono px-3 py-2.5 text-right font-bold whitespace-nowrap text-[#1a2330]"
                          >
                            {fix1(typeA(t))}
                          </td>,
                        ]),
                  ])}
                  <td className="f-mono px-3 py-2.5 text-right font-bold whitespace-nowrap text-[#1a2330]">
                    {grandQ}
                  </td>
                  {!金额Hidden && (
                    <td className="f-mono px-3 py-2.5 text-right font-bold whitespace-nowrap text-[#1a2330]">
                      {fix1(grandA)}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!statsQuery.isLoading && !statsQuery.isError && pivot.length > 0 && (
          <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
            <span>共 {pivot.length} 客户</span>
            <span>类型 {types.length} 种</span>
          </div>
        )}
      </div>
    </div>
  );
}
