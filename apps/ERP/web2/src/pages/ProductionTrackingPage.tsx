// 生产单跟踪表(装配部报表群;老系统 web/src/pages/production/ProductionTrackingPage.tsx 重写):
// 筛选(关键字 + 审核 + 完成) + 共享查询表 + 导出 CSV + 打印。
// 权限菜单=生产制单(MenuCatalog 实证:业务单据组;后端 ProductionReportController.cs:17)。
// 未完成数>0 红色加粗(照抄老系统 未完成Cell)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { productionReportApi } from "@/api/endpoints";
import type { ProductionTrackingRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "生产制单";

const d10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
const num = (v?: number | null) => (v == null ? "" : v);
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const col = createColumnHelper<ProductionTrackingRow>();

const columns = [
  col.accessor("标识", { header: "标识", size: 5 }),
  col.accessor("生产单号", {
    header: "生产单号",
    size: 10,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("款号", { header: "款号", size: 8, meta: { tdClass: monoCls } }),
  col.accessor("款式", { header: "款式", size: 9 }),
  col.accessor("客户名称", { header: "客户名称", size: 10 }),
  col.accessor("日期", { header: "日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("下单日期", { header: "下单日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("交货日期", { header: "交货日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("计划数量", { header: "计划数量", size: 7, cell: (c) => num(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("裁床数量", { header: "裁床数量", size: 7, cell: (c) => num(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("录入数量", { header: "录入数量", size: 7, cell: (c) => num(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("未完成数", {
    header: "未完成数",
    size: 7,
    cell: (c) => {
      const n = c.getValue() ?? 0;
      return n > 0 ? <span className="font-semibold text-[#dc2626]">{n}</span> : n;
    },
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("装箱方式", { header: "装箱方式", size: 8 }),
  col.accessor("订单总箱数", { header: "订单总箱数", size: 7, cell: (c) => num(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("完成", {
    header: "完成",
    size: 5,
    cell: (c) =>
      c.getValue() === "是" ? (
        <span className="rounded-full bg-[#2563eb]/10 px-2 py-0.5 text-xs font-medium text-[#2563eb]">是</span>
      ) : (
        <span className="rounded-full bg-black/6 px-2 py-0.5 text-xs font-medium text-[#5f6b7d]">否</span>
      ),
  }),
  col.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) =>
      c.getValue() === "1" ? (
        <span className="rounded-full bg-[#059669]/10 px-2 py-0.5 text-xs font-medium text-[#059669]">已审核</span>
      ) : (
        <span className="rounded-full bg-black/6 px-2 py-0.5 text-xs font-medium text-[#5f6b7d]">未审核</span>
      ),
  }),
];

const exportCols: ExportCol[] = [
  { title: "标识", key: "标识" },
  { title: "生产单号", key: "生产单号" },
  { title: "款号", key: "款号" },
  { title: "款式", key: "款式" },
  { title: "客户名称", key: "客户名称" },
  { title: "日期", key: "日期", fmt: (v) => d10(v as string) },
  { title: "下单日期", key: "下单日期", fmt: (v) => d10(v as string) },
  { title: "交货日期", key: "交货日期", fmt: (v) => d10(v as string) },
  { title: "计划数量", key: "计划数量" },
  { title: "裁床数量", key: "裁床数量" },
  { title: "录入数量", key: "录入数量" },
  { title: "未完成数", key: "未完成数" },
  { title: "装箱方式", key: "装箱方式" },
  { title: "订单总箱数", key: "订单总箱数" },
  { title: "完成", key: "完成" },
  { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
];

export default function ProductionTrackingPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");

  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [审核, set审核] = useState<"all" | "1" | "0">("all");
  const [完成, set完成] = useState<"all" | "是" | "否">("all");

  const q = useQuery({
    queryKey: ["production-tracking", keyword, 审核, 完成],
    queryFn: () =>
      productionReportApi.tracking(
        keyword || undefined,
        审核 === "all" ? undefined : 审核,
        完成 === "all" ? undefined : 完成,
      ),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 生产单跟踪表"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">生产单跟踪表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-72 space-y-1.5">
          <label htmlFor="pt-kw" className="f-label block">
            关键字
          </label>
          <input
            id="pt-kw"
            className="f-input"
            placeholder="生产单号 / 款号 / 款式 / 客户"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            审核
          </label>
          <SearchSelect
            ariaLabel="审核"
            className="w-28"
            value={审核}
            options={[
              { value: "all", label: "全部" },
              { value: "1", label: "已审核" },
              { value: "0", label: "未审核" },
            ]}
            onChange={(v) => set审核(v as typeof 审核)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            完成
          </label>
          <SearchSelect
            ariaLabel="完成"
            className="w-28"
            value={完成}
            options={[
              { value: "all", label: "全部" },
              { value: "是", label: "已完成" },
              { value: "否", label: "未完成" },
            ]}
            onChange={(v) => set完成(v as typeof 完成)}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setKeyword(kwInput.trim())}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={!rows.length}
          onClick={() => downloadCsv("生产单跟踪表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={!rows.length}
          onClick={() => printTable("生产单跟踪表", exportCols, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => q.refetch()}
        errorMessage="加载 生产单跟踪表 失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有生产单"
        fill
        minWidth={1700}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
