// 原料订货入库统计(/plastic-raw-material-order-receipt-stats)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialOrderReceiptStatsPage.tsx:
// 起止区间(默认近一月) + 关键字;分组列 订货情况/入库情况/相关情况 在共享表中展开为前缀列名
// (与导出列同名);金额 2 位小数;底部合计;导出 CSV + 打印。
// 权限菜单=原料订货入库统计(MenuCatalog.cs:78 实证:原料报表组;老系统菜单项无第三参,权限键同名)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, Printer, Prohibit } from "@phosphor-icons/react";
import { rawOrderReceiptStatsApi } from "@/api/endpoints";
import type { RawOrderReceiptStatRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { date10 } from "@/lib/rawDocs";
import { usePerms } from "@/hooks/usePerms";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "原料订货入库统计";

// 默认区间:近一月(对照老系统 defaultRange = dayjs().subtract(1, "month") -> now)
function defaultRange(): { 起: string; 止: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - 1, end.getDate());
  const p = (n: number) => String(n).padStart(2, "0");
  const f = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { 起: f(start), 止: f(end) };
}

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const fix2 = (v?: number | null) => (v == null ? "" : Number(v).toFixed(2));
const numOr = (v?: number | null) => (v == null ? "" : Number(v));

const col = createColumnHelper<RawOrderReceiptStatRow>();

const columns: ColumnDef<RawOrderReceiptStatRow, any>[] = [
  col.accessor("订购日期", {
    header: "订购日期",
    size: 8,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: monoCls },
  }),
  col.accessor("交货日期", {
    header: "交货日期",
    size: 8,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: monoCls },
  }),
  col.accessor("订购单号", {
    header: "订购单号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("供应商名称", { header: "供应商名称", size: 11 }),
  col.accessor("原料编号", { header: "原料编号", size: 8, meta: { tdClass: monoCls } }),
  col.accessor("原料名称", { header: "原料名称", size: 12 }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("采购单价", {
    header: "采购单价",
    size: 7,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("单价HKDLb", {
    header: "单价 HK$/Lb",
    size: 7,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("其他成本单价HKDLb", {
    header: "其他成本单价(HK$/Lb)",
    size: 10,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("订货数量包", {
    header: "订货数量(包)",
    size: 7,
    cell: (c) => numOr(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("订货金额HKD", {
    header: "订货金额(HK$)",
    size: 8,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("入库数量包", {
    header: "入库数量(包)",
    size: 7,
    cell: (c) => numOr(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("入库订货金额HKD", {
    header: "入库订货金额(HK$)",
    size: 8,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("入库其他费用HKD", {
    header: "入库其他费用(HK$)",
    size: 8,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("入库金额合计HKD", {
    header: "入库金额合计(HK$)",
    size: 8,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("相关数量包", {
    header: "相关数量(包)",
    size: 7,
    cell: (c) => numOr(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("相关金额HKD", {
    header: "相关金额(HK$)",
    size: 8,
    cell: (c) => fix2(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
];

// 导出列(对照老系统 exportCols 逐字)
const EXPORT_COLS: ExportCol[] = [
  { title: "订购日期", key: "订购日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "交货日期", key: "交货日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "订购单号", key: "订购单号" },
  { title: "供应商名称", key: "供应商名称" },
  { title: "原料编号", key: "原料编号" },
  { title: "原料名称", key: "原料名称" },
  { title: "单位", key: "单位" },
  { title: "采购单价", key: "采购单价" },
  { title: "单价HK$/Lb", key: "单价HKDLb" },
  { title: "其他成本单价(HK$/Lb)", key: "其他成本单价HKDLb" },
  { title: "订货数量(包)", key: "订货数量包" },
  { title: "订货金额(HK$)", key: "订货金额HKD" },
  { title: "入库数量(包)", key: "入库数量包" },
  { title: "入库订货金额(HK$)", key: "入库订货金额HKD" },
  { title: "入库其他费用(HK$)", key: "入库其他费用HKD" },
  { title: "入库金额合计(HK$)", key: "入库金额合计HKD" },
  { title: "相关数量(包)", key: "相关数量包" },
  { title: "相关金额(HK$)", key: "相关金额HKD" },
];

export default function PlasticRawMaterialOrderReceiptStatsPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [range, setRange] = useState<{ 起: string; 止: string }>(defaultRange);
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string }>({});

  const statsQuery = useQuery({
    queryKey: ["raw-order-receipt-stats", range, applied],
    queryFn: () => rawOrderReceiptStatsApi.list(range.起, range.止, applied.keyword),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !!range.起 && !!range.止,
  });
  const rows = useMemo(() => statsQuery.data ?? [], [statsQuery.data]);
  const sum = (k: keyof RawOrderReceiptStatRow) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料订货入库统计·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">原料订货入库统计</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="space-y-1.5">
          <span className="f-label block">订购日期</span>
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
        <div className="w-64 space-y-1.5">
          <label htmlFor="rps-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="rps-kw"
            className={inputCls}
            placeholder="订购单号/供应商/原料编号/名称"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined })
            }
          />
        </div>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => downloadCsv("原料订货入库统计.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("原料订货入库统计", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={statsQuery.isLoading}
        isError={statsQuery.isError}
        onRetry={() => statsQuery.refetch()}
        errorMessage="加载原料订货入库统计失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前区间内没有原料订货入库记录"
        fill
        minWidth={1900}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>
              合计:订货 {sum("订货数量包")} 包/{fix2(sum("订货金额HKD"))} · 入库{" "}
              {sum("入库数量包")} 包/{fix2(sum("入库金额合计HKD"))} · 相关 {sum("相关数量包")}{" "}
              包/{fix2(sum("相关金额HKD"))}
            </span>
          </>
        }
      />
    </div>
  );
}
