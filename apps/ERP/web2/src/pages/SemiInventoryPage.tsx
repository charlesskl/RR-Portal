// 半成品库存统计表(/semi-inventory)。对照老系统 web/src/pages/warehouse/SemiInventoryPage.tsx:
// 仓库固定半成品仓;显示(有发生的记录/全部记录) + 零库存(只显示库存数/含零库存)两个下拉;
// 字段+关键字模糊/精确查询;30s 轮询 + 窗口聚焦自动刷新(对照老系统 useAutoReload);
// 库存数量负数红;导出 CSV + 打印(列序逐字对照老 exportExcel)。
// 权限菜单=半成品库存(MenuCatalog.cs:30 实证:半成品仓储组)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { semiInventoryApi } from "@/api/endpoints";
import type { SemiInvReportRow, SemiInvReportQuery } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "半成品库存";
const WAREHOUSE = "半成品仓";
const FIELDS = ["产品货号", "产品名称", "配件编号", "客户", "产品装配名称"];

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

const col = createColumnHelper<SemiInvReportRow>();
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";

const columns: ColumnDef<SemiInvReportRow, any>[] = [
  col.accessor("配件编号", { header: "配件编号", size: 10, meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" } }),
  col.accessor("客户", { header: "客户", size: 9 }),
  col.accessor("产品货号", { header: "产品货号", size: 12, meta: { tdClass: monoCls } }),
  col.accessor("产品名称", { header: "产品名称", size: 14 }),
  col.accessor("产品装配名称", { header: "产品装配名称", size: 15 }),
  col.accessor("库存数量", {
    header: "库存数量",
    size: 9,
    cell: (c) => (
      <span
        className={cn(
          "f-mono font-semibold",
          Number(c.getValue()) < 0 ? "text-[#dc2626]" : "text-[#1a2330]",
        )}
      >
        {Number(c.getValue() ?? 0).toLocaleString()}
      </span>
    ),
    meta: { align: "right", tdClass: "px-3 py-2 text-right whitespace-nowrap" },
  }),
  col.accessor("仓库位置", { header: "仓库位置", size: 10, meta: { tdClass: monoCls } }),
];

// 导出列(对照老系统 cols 常量)
const EXPORT_COLS: ExportCol[] = [
  { title: "配件编号", key: "配件编号" },
  { title: "客户", key: "客户" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "库存数量", key: "库存数量" },
  { title: "仓库位置", key: "仓库位置" },
];

export default function SemiInventoryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [showAll, setShowAll] = useState(false);
  const [includeZero, setIncludeZero] = useState(false);
  const [field, setField] = useState("产品货号");
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string; exact: boolean }>({ exact: false });

  const query: SemiInvReportQuery = useMemo(
    () => ({
      仓库: WAREHOUSE,
      field,
      keyword: applied.keyword,
      exact: applied.exact,
      includeZero,
      showAll,
    }),
    [field, applied, includeZero, showAll],
  );

  const reportQuery = useQuery({
    queryKey: ["semi-inventory", "report", query],
    queryFn: () => semiInventoryApi.report(query),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading,
    // 对照老系统 useAutoReload:切回本页/窗口聚焦/30秒轮询 自动刷新
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const rows = useMemo(() => reportQuery.data ?? [], [reportQuery.data]);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「半成品库存·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">半成品库存统计表</h1>
        <span className="text-sm text-[#15803d]">查询记录:{rows.length}</span>
        <span className="rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
          仓库:{WAREHOUSE}
        </span>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-36 space-y-1.5">
          <label className="f-label block">
            显示
          </label>
          <SearchSelect
            ariaLabel="显示"
            value={showAll ? "1" : "0"}
            options={[
              { value: "0", label: "有发生的记录" },
              { value: "1", label: "全部记录" },
            ]}
            onChange={(v) => setShowAll(v === "1")}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <label className="f-label block">
            零库存
          </label>
          <SearchSelect
            ariaLabel="零库存"
            value={includeZero ? "1" : "0"}
            options={[
              { value: "0", label: "只显示库存数" },
              { value: "1", label: "含零库存" },
            ]}
            onChange={(v) => setIncludeZero(v === "1")}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <label className="f-label block">
            请选择条件
          </label>
          <SearchSelect
            ariaLabel="请选择条件"
            value={field}
            options={FIELDS.map((f) => ({ value: f, label: f }))}
            onChange={(v) => setField(v)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="si-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="si-kw"
            className={inputCls}
            placeholder="输入查询内容"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined, exact: false })
            }
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setApplied({ keyword: kwInput.trim() || undefined, exact: false })}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => setApplied({ keyword: kwInput.trim() || undefined, exact: true })}
        >
          精确查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={rows.length === 0}
          onClick={() => downloadCsv("半成品库存统计表.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("半成品库存统计表", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        onRetry={() => reportQuery.refetch()}
        errorMessage="加载半成品库存统计表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有半成品库存"
        fill
        minWidth={1070}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
