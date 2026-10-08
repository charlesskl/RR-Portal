// 半成品库存月报表(/semi-inventory-monthly)。对照老系统 web/src/pages/warehouse/SemiMonthlyReportPage.tsx:
// 仓库固定半成品仓;上/本/下月跳转 + 起止日期(默认本月);字段+关键字模糊/精确查询;
// 期初/本期入库/出库/报废/盘点盈亏(红负绿正)/期末(加粗负数红);导出 CSV(文件名带年月) + 打印。
// 权限菜单=半成品库存(MenuCatalog.cs:30 实证;与库存统计表同菜单,老系统同)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { semiInventoryApi } from "@/api/endpoints";
import type { SemiMonthlyRow } from "@/api/types";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
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

const col = createColumnHelper<SemiMonthlyRow>();
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right whitespace-nowrap";

const signed = (v: number) => (
  <span className={v < 0 ? "text-[#dc2626]" : v > 0 ? "text-[#15803d]" : "text-[#1a2330]"}>
    {Number(v || 0).toLocaleString()}
  </span>
);

const columns: ColumnDef<SemiMonthlyRow, any>[] = [
  col.accessor("配件编号", { header: "配件编号", size: 9, meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" } }),
  col.accessor("客户", { header: "客户", size: 8 }),
  col.accessor("产品货号", { header: "产品货号", size: 11, meta: { tdClass: monoCls } }),
  col.accessor("产品名称", { header: "产品名称", size: 13 }),
  col.accessor("产品装配名称", { header: "产品装配名称", size: 14 }),
  col.accessor("期初库存", { header: "期初库存", size: 8, cell: (c) => signed(Number(c.getValue())), meta: { align: "right", tdClass: numCls } }),
  col.accessor("本期入库", { header: "本期入库", size: 8, cell: (c) => signed(Number(c.getValue())), meta: { align: "right", tdClass: numCls } }),
  col.accessor("本期出库", { header: "本期出库", size: 8, cell: (c) => signed(Number(c.getValue())), meta: { align: "right", tdClass: numCls } }),
  col.accessor("本期报废", { header: "本期报废", size: 8, cell: (c) => signed(Number(c.getValue())), meta: { align: "right", tdClass: numCls } }),
  col.accessor("盘点盈亏", { header: "盘点盈亏", size: 8, cell: (c) => signed(Number(c.getValue())), meta: { align: "right", tdClass: numCls } }),
  col.accessor("期末库存", {
    header: "期末库存",
    size: 9,
    cell: (c) => (
      <span className={cn("font-semibold", Number(c.getValue()) < 0 ? "text-[#dc2626]" : "text-[#1a2330]")}>
        {Number(c.getValue() || 0).toLocaleString()}
      </span>
    ),
    meta: { align: "right", tdClass: numCls },
  }),
];

// 导出列(对照老系统 cols 常量)
const EXPORT_COLS: ExportCol[] = [
  { title: "配件编号", key: "配件编号" },
  { title: "客户", key: "客户" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "期初库存", key: "期初库存" },
  { title: "本期入库", key: "本期入库" },
  { title: "本期出库", key: "本期出库" },
  { title: "本期报废", key: "本期报废" },
  { title: "盘点盈亏", key: "盘点盈亏" },
  { title: "期末库存", key: "期末库存" },
];

export default function SemiMonthlyReportPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [field, setField] = useState("产品货号");
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string; exact: boolean }>({ exact: false });

  const reportQuery = useQuery({
    queryKey: ["semi-inventory", "monthly", range, field, applied],
    queryFn: () =>
      semiInventoryApi.monthly({
        仓库: WAREHOUSE,
        起日期: range.起,
        止日期: range.止,
        field,
        keyword: applied.keyword,
        exact: applied.exact,
      }),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !!range.起 && !!range.止,
  });
  const rows = useMemo(() => reportQuery.data ?? [], [reportQuery.data]);
  const asRecords = () => rows as unknown as Record<string, unknown>[];
  const exportName = `半成品库存月报表_${range.起.slice(0, 7).replace("-", "")}`;

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
        <h1 className="text-2xl font-bold text-[#1a2330]">半成品库存月报表</h1>
        <span className="text-sm text-[#15803d]">查询记录:{rows.length}</span>
        <span className="rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
          仓库:{WAREHOUSE}
        </span>
        <DensitySwitch className="ml-auto" />
      </div>

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
        <div className="w-52 space-y-1.5">
          <label htmlFor="smr-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="smr-kw"
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
          onClick={() => downloadCsv(`${exportName}.csv`, EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable(exportName, EXPORT_COLS, asRecords())}
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
        errorMessage="加载半成品库存月报表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="该日期区间内没有半成品库存月报数据"
        fill
        minWidth={1300}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
