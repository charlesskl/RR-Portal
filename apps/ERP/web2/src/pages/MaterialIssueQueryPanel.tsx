import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Printer, Prohibit } from "@phosphor-icons/react";
import { materialIssueApi, materialMasterApi } from "@/api/endpoints";
import type {
  MaterialCategoryNode,
  MaterialIssueQueryDetailRow,
  MaterialIssueSummaryRow,
} from "@/api/types";
import { ALL_APPROVAL, ALL_CAT, buildDocQuery, monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { usePerms } from "@/hooks/usePerms";

// 来料领料查询页签(对照老系统 web/src/pages/materials/MaterialIssueQueryPage.tsx):
// 明细/汇总双查询,筛选=月份跳转+起止+审核情况+物料类别+关键字;明细双击回单据页签打开整单。
// 权限菜单与单据同为「来料领料单」(后端 MaterialIssueController 对 issue-query 也用该菜单,
// MenuCatalog 无独立「来料领料查询」;与塑胶侧「塑胶领料查询」分离模式不同,以实证为准)。
// 查询行本身无价格字段,不涉及单价/金额位。

const QUERY_MENU = "来料领料单";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// 明细/汇总导出列(对照老系统 detailExportCols/summaryExportCols;无价格列)
const detailCols: ExportCol[] = [
  { title: "类型", key: "类型" },
  { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "单号", key: "单号" },
  { title: "生产单号", key: "生产单号" },
  { title: "款号", key: "款号" },
  { title: "领料部门", key: "领料部门" },
  { title: "领料人", key: "领料人" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "物料类别" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "数量", key: "数量" },
  { title: "备注", key: "备注" },
  { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
];
const summaryCols: ExportCol[] = [
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "物料类别" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "领用数量", key: "领用数量" },
];

// ---------- 结果表列(共享查询表 QueryTable;size=宽度权重,单元格类名照原 DetailCells/SummaryCells) ----------

const monoDimCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const monoStrongCls = "f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]";

const detailCol = createColumnHelper<MaterialIssueQueryDetailRow>();
const detailTableCols = [
  detailCol.accessor("类型", { header: "类型", size: 5 }),
  detailCol.accessor("日期", {
    header: "日期",
    size: 8,
    cell: (c) => String(c.getValue() ?? "").slice(0, 10),
    meta: { tdClass: monoDimCls },
  }),
  detailCol.accessor("单号", {
    header: "单号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  detailCol.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoDimCls } }),
  detailCol.accessor("款号", {
    header: "款号",
    size: 7,
    meta: { tdClass: "f-mono px-3 py-2 text-[#3d4a5c]" },
  }),
  detailCol.accessor("领料部门", { header: "领料部门", size: 8 }),
  detailCol.accessor("领料人", { header: "领料人", size: 6 }),
  detailCol.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoStrongCls } }),
  detailCol.accessor("物料名称", { header: "物料名称", size: 12 }),
  detailCol.accessor("规格", { header: "规格", size: 10 }),
  detailCol.accessor("物料类别", { header: "材料", size: 7 }),
  detailCol.accessor("颜色", { header: "颜色", size: 6 }),
  detailCol.accessor("单位", { header: "单位", size: 4 }),
  detailCol.accessor("数量", {
    header: "数量",
    size: 6,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  detailCol.accessor("备注", { header: "备注", size: 10 }),
  detailCol.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) => (c.getValue() === "1" ? "已审核" : "未审核"),
  }),
];

const summaryCol = createColumnHelper<MaterialIssueSummaryRow>();
const summaryTableCols = [
  summaryCol.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoStrongCls } }),
  summaryCol.accessor("物料名称", { header: "物料名称", size: 12 }),
  summaryCol.accessor("规格", { header: "规格", size: 10 }),
  summaryCol.accessor("物料类别", { header: "材料", size: 8 }),
  summaryCol.accessor("颜色", { header: "颜色", size: 7 }),
  summaryCol.accessor("单位", { header: "单位", size: 5 }),
  summaryCol.accessor("领用数量", {
    header: "领用数量",
    size: 8,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]" },
  }),
];

export function MaterialIssueQueryPanel({ onOpenDoc }: { onOpenDoc: (单号: string) => void }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(QUERY_MENU, "打开");

  const [sub, setSub] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);
  const [类别, set类别] = useState(ALL_CAT);
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");

  const catsQuery = useQuery({
    queryKey: ["material-categories"],
    queryFn: () => materialMasterApi.categories(),
    staleTime: 5 * 60_000,
    enabled: !permsLoading && canOpen,
  });

  const params = buildDocQuery({
    keyword: kw,
    类别,
    审核情况,
    起: range.起,
    止: range.止,
  });

  const detailQuery = useQuery({
    queryKey: ["material-issue", "query-detail", params],
    queryFn: () => materialIssueApi.queryDetail(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && sub === "detail",
  });
  const summaryQuery = useQuery({
    queryKey: ["material-issue", "query-summary", params],
    queryFn: () => materialIssueApi.querySummary(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && sub === "summary",
  });

  const exportTarget = () =>
    sub === "detail"
      ? {
          cols: detailCols,
          rows: (detailQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "领料明细",
        }
      : {
          cols: summaryCols,
          rows: (summaryQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "领料汇总",
        };

  const activeQuery = sub === "detail" ? detailQuery : summaryQuery;
  const rowCount = (activeQuery.data ?? []).length;

  if (!permsLoading && !canOpen) {
    return (
      <div className="f-panel p-6">
        <DocEmpty
          icon={<Prohibit className="h-5 w-5" />}
          title="无权访问来料领料查询"
          description="缺少「来料领料单·打开」权限,请联系管理员开通"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="f-panel flex flex-wrap items-end gap-3 p-5">
        <div className="flex gap-1">
          {[
            { label: "上月", off: -1 },
            { label: "本月", off: 0 },
            { label: "下月", off: 1 },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              className="f-btn h-10 px-3.5 text-sm"
              onClick={() => setRange(monthRange(m.off))}
            >
              {m.label}
            </button>
          ))}
        </div>
        <FormField label="起">
          <Input
            type="date"
            className={inputCls}
            aria-label="起"
            value={range.起}
            onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
          />
        </FormField>
        <FormField label="止">
          <Input
            type="date"
            className={inputCls}
            aria-label="止"
            value={range.止}
            onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
          />
        </FormField>
        <FormField label="审核情况">
          <SearchSelect
            ariaLabel="审核情况"
            className={cn(inputCls, "w-28 rounded-md border px-2")}
            value={审核情况}
            options={[ALL_APPROVAL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set审核情况(v)}
          />
        </FormField>
        <FormField label="物料类别">
          <SearchSelect
            ariaLabel="物料类别"
            className={cn(inputCls, "w-40 rounded-md border px-2")}
            value={类别}
            options={[
              { value: ALL_CAT, label: "所有类别" },
              ...(catsQuery.data ?? [])
                .filter((c: MaterialCategoryNode) => c.类别)
                .map((c) => ({ value: c.类别!, label: `${c.类别}(${c.数量})` })),
            ]}
            onChange={(v) => set类别(v)}
          />
        </FormField>
        <FormField label="关键字">
          <Input
            className={cn(inputCls, "w-60")}
            placeholder="单号/生产单号/款号/领料人/物料"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKw(kwInput.trim())}
          />
        </FormField>
        <button
          type="button"
          className="f-btn f-btn-cyan h-10 px-5 text-sm"
          onClick={() => setKw(kwInput.trim())}
        >
          查询
        </button>
        <button
          type="button"
          className="f-btn h-10 px-4 text-sm"
          onClick={() => {
            const { cols, rows, name } = exportTarget();
            if (!rows.length) return;
            downloadCsv(`${name}.csv`, cols, rows);
          }}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn h-10 px-4 text-sm"
          onClick={() => {
            const { cols, rows, name } = exportTarget();
            if (!rows.length) return;
            printTable(`${name}查询`, cols, rows);
          }}
        >
          <Printer className="h-4 w-4" />
          打印
        </button>
      </div>

      {/* 明细/汇总子页签 + 密度切换 */}
      <div className="flex items-center gap-3">
        <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { key: "detail" as const, label: "明细查询" },
            { key: "summary" as const, label: "汇总查询" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                sub === t.key
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 结果表(共享查询表:虚拟滚动 + 密度三档 + sticky 表头内置) */}
      {sub === "detail" ? (
        <QueryTable
          columns={detailTableCols}
          rows={detailQuery.data ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage="加载来料领料查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={1600}
          onRowDoubleClick={(r) => r.单号 && onOpenDoc(r.单号)}
          rowTitle={(r) => `双击打开整单 ${r.单号 ?? ""}`}
          footer={`共 ${rowCount} 条,双击行打开来料领料单整单`}
        />
      ) : (
        <QueryTable
          columns={summaryTableCols}
          rows={summaryQuery.data ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage="加载来料领料查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={900}
          footer={`共 ${rowCount} 条`}
        />
      )}
    </div>
  );
}
