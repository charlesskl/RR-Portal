// 塑胶库存月报表(/plastic-monthly-report)。对照老系统 web/src/pages/plastics/PlasticMonthlyReportPage.tsx:
// 月份(上月/本月/下月跳转+month 输入) + 物料类别 + 关键字筛选;期初/本月入库(绿)/本月出库(红)/期末(粗);
// 底部合计行;导出 CSV + 打印(列规格逐字对照老 exportCols)。
// 权限菜单=塑胶库存月报表(MenuCatalog.cs:111 实证:塑胶报表组)。
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { plasticMonthlyReportApi } from "@/api/endpoints";
import type { PlasticMonthlyReportRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "塑胶库存月报表";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

// 当前月 type="month" 输入值(YYYY-MM)
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
// 月份偏移(对照老系统 month.add(off, "month"))
const shiftMonth = (v: string, off: number) => {
  const [y, m] = v.split("-").map(Number);
  const d = new Date(y, m - 1 + off, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// 导出列(对照老系统 exportCols;材料列取 物料类别)
const EXPORT_COLS: ExportCol[] = [
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "颜色", key: "颜色" },
  { title: "材料", key: "物料类别" },
  { title: "单位", key: "单位" },
  { title: "期初数量", key: "期初数量" },
  { title: "本月入库", key: "本期入库" },
  { title: "本月出库", key: "本期出库" },
  { title: "期末数量", key: "期末数量" },
];

const col = createColumnHelper<PlasticMonthlyReportRow>();
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right whitespace-nowrap";

const columns: ColumnDef<PlasticMonthlyReportRow, any>[] = [
  col.accessor("物料编号", {
    header: "物料编号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("物料名称", { header: "物料名称", size: 12 }),
  col.accessor("规格", { header: "规格", size: 8, meta: { tdClass: monoCls } }),
  col.accessor("颜色", { header: "颜色", size: 7, meta: { tdClass: monoCls } }),
  col.accessor("物料类别", { header: "材料", size: 6 }),
  col.accessor("单位", { header: "单位", size: 4 }),
  col.accessor("期初数量", {
    header: "期初数量",
    size: 7,
    meta: { align: "right", tdClass: cn(numCls, "text-[#1a2330]") },
  }),
  col.accessor("本期入库", {
    header: "本月入库",
    size: 7,
    cell: (c) => <span className="text-[#15803d]">{c.getValue()}</span>,
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("本期出库", {
    header: "本月出库",
    size: 7,
    cell: (c) => <span className="text-[#dc2626]">{c.getValue()}</span>,
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("期末数量", {
    header: "期末数量",
    size: 7,
    cell: (c) => <span className="font-semibold">{c.getValue()}</span>,
    meta: { align: "right", tdClass: cn(numCls, "text-[#1a2330]") },
  }),
];

export default function PlasticMonthlyReportPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [month, setMonth] = useState(currentMonth);
  const [物料类别, set物料类别] = useState("");
  const [kwInput, setKwInput] = useState("");
  // 已应用的筛选(首屏加载一次;关键字由「查询」显式触发,对照老系统 onSearch)
  const [applied, setApplied] = useState<{ keyword?: string }>({});

  const reportQuery = useQuery({
    queryKey: ["plastic-monthly-report", month, 物料类别, applied],
    queryFn: () =>
      plasticMonthlyReportApi.list(
        `${month}-01`,
        物料类别.trim() || undefined,
        applied.keyword,
      ),
    enabled: canOpen && !permsLoading && !!month,
  });
  const rows = useMemo(() => reportQuery.data ?? [], [reportQuery.data]);

  const sum = (k: "期初数量" | "本期入库" | "本期出库" | "期末数量") =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶库存月报表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶库存月报表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏(对照老系统:上/本/下月 + month + 物料类别 + 关键字 + 导出/打印) */}
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
              onClick={() =>
                setMonth(b.off === 0 ? currentMonth() : shiftMonth(currentMonth(), b.off))
              }
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="w-44 space-y-1.5">
          <label htmlFor="pmr-month" className="f-label block">
            月份
          </label>
          <input
            id="pmr-month"
            type="month"
            className="f-input"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <label htmlFor="pmr-cat" className="f-label block">
            物料类别
          </label>
          <input
            id="pmr-cat"
            className="f-input"
            placeholder="物料类别"
            value={物料类别}
            onChange={(e) => set物料类别(e.target.value)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="pmr-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="pmr-kw"
            className={inputCls}
            placeholder="物料编号/名称/规格"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined })}
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
          onClick={() => downloadCsv("塑胶库存月报表.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("塑胶库存月报表", EXPORT_COLS, asRecords())}
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
        errorMessage="加载塑胶库存月报表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="该月份/类别下没有塑胶库存月报数据"
        fill
        minWidth={1150}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>
              合计:期初 {sum("期初数量")} · 入库 {sum("本期入库")} · 出库 {sum("本期出库")} · 期末{" "}
              {sum("期末数量")}
            </span>
          </>
        }
      />
    </div>
  );
}
