// 原料库存月报表(/plastic-raw-material-monthly)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialMonthlyPage.tsx:
// 上/本/下月 + 起止区间(默认本月) + 类别下拉 + 关键字;本期入库绿/本期出库红/盘点盈亏负红/期末加粗;
// 底部合计(期初/入库/出库/盈亏/期末/外发);导出 CSV + 打印。
// 权限菜单=原料库存月报表(MenuCatalog.cs:76 实证:原料报表组)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { plasticRawMaterialMasterApi, rawMaterialReportApi } from "@/api/endpoints";
import type { RawMaterialMonthlyRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "原料库存月报表";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const col = createColumnHelper<RawMaterialMonthlyRow>();

const columns: ColumnDef<RawMaterialMonthlyRow, any>[] = [
  col.accessor("原料编号", {
    header: "原料编号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("原料名称", { header: "原料名称", size: 12 }),
  col.accessor("产地", { header: "产地", size: 8 }),
  col.accessor("每包重量", {
    header: "每包重量",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("物料类别", { header: "物料类别", size: 7 }),
  col.accessor("期初库存", {
    header: "期初库存",
    size: 7,
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("本期入库", {
    header: "本期入库",
    size: 7,
    cell: (c) => (
      <span className={cn("f-mono", Number(c.getValue()) > 0 && "text-[#15803d]")}>
        {c.getValue()}
      </span>
    ),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("本期出库", {
    header: "本期出库",
    size: 7,
    cell: (c) => (
      <span className={cn("f-mono", Number(c.getValue()) > 0 && "text-[#dc2626]")}>
        {c.getValue()}
      </span>
    ),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("盘点盈亏", {
    header: "盘点盈亏",
    size: 7,
    cell: (c) => (
      <span className={cn("f-mono", Number(c.getValue()) < 0 && "text-[#dc2626]")}>
        {c.getValue()}
      </span>
    ),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("期末库存", {
    header: "期末库存",
    size: 7,
    cell: (c) => <span className="f-mono font-semibold">{c.getValue()}</span>,
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("外发库存", {
    header: "外发库存",
    size: 7,
    meta: { align: "right", tdClass: numCls },
  }),
];

// 导出列(对照老系统 exportCols 逐字)
const EXPORT_COLS: ExportCol[] = [
  { title: "原料编号", key: "原料编号" },
  { title: "原料名称", key: "原料名称" },
  { title: "产地", key: "产地" },
  { title: "每包重量", key: "每包重量" },
  { title: "单位", key: "单位" },
  { title: "物料类别", key: "物料类别" },
  { title: "期初库存", key: "期初库存" },
  { title: "本期入库", key: "本期入库" },
  { title: "本期出库", key: "本期出库" },
  { title: "盘点盈亏", key: "盘点盈亏" },
  { title: "期末库存", key: "期末库存" },
  { title: "外发库存", key: "外发库存" },
];

export default function PlasticRawMaterialMonthlyPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [cat, setCat] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string }>({});

  const catsQuery = useQuery({
    queryKey: ["raw-monthly", "categories"],
    queryFn: () => plasticRawMaterialMasterApi.categories(),
    enabled: canOpen && !permsLoading,
  });
  const cats = catsQuery.data ?? [];

  const monthlyQuery = useQuery({
    queryKey: ["raw-monthly", "list", range, cat, applied],
    queryFn: () =>
      rawMaterialReportApi.monthly(range.起, range.止, cat || undefined, applied.keyword),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !!range.起 && !!range.止,
  });
  const rows = useMemo(() => monthlyQuery.data ?? [], [monthlyQuery.data]);
  const sum = (k: keyof RawMaterialMonthlyRow) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料库存月报表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">原料库存月报表</h1>
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
        <div className="w-44 space-y-1.5">
          <label className="f-label block">
            物料类别
          </label>
          <SearchSelect
            ariaLabel="物料类别"
            value={cat}
            options={cats
              .filter((x) => x.类别)
              .map((x) => ({ value: x.类别!, label: `${x.类别}(${x.数量})` }))}
            placeholder="全部类别"
            clearLabel="全部类别"
            onChange={(v) => setCat(v)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="rmm-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="rmm-kw"
            className={inputCls}
            placeholder="原料编号/名称/产地"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined })
            }
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setApplied({ keyword: kwInput.trim() || undefined })}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => downloadCsv("原料库存月报表.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("原料库存月报表", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={monthlyQuery.isLoading}
        isError={monthlyQuery.isError}
        onRetry={() => monthlyQuery.refetch()}
        errorMessage="加载原料库存月报表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前月份没有原料库存流水"
        fill
        minWidth={1250}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>
              合计:期初 {sum("期初库存")} · 入库 {sum("本期入库")} · 出库 {sum("本期出库")} · 盈亏{" "}
              {sum("盘点盈亏")} · 期末 {sum("期末库存")} · 外发 {sum("外发库存")}
            </span>
          </>
        }
      />
    </div>
  );
}
