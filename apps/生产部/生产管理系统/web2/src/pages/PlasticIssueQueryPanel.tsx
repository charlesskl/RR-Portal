import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Printer, Prohibit } from "@phosphor-icons/react";
import { plasticIssueApi, plasticMaterialMasterApi } from "@/api/endpoints";
import type {
  PlasticIssueQueryDetailRow,
  PlasticIssueQuerySummaryRow,
  PlasticMaterialCategoryNode,
} from "@/api/types";
import { ALL_APPROVAL, ALL_CAT, buildDocQuery, monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { usePerms } from "@/hooks/usePerms";

// 塑胶领料查询页签(对照老系统 web/src/pages/plastics/PlasticIssueQueryPage.tsx):
// 明细/汇总双查询,筛选=月份跳转+起止+审核情况+物料类别+关键字;明细双击回单据页签打开整单。
// 权限菜单为「塑胶领料查询」(与单据「塑胶领料单」分开);无单价位不出单价/金额列。

const QUERY_MENU = "塑胶领料查询";

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

const fix2 = (v?: number | null) => (v == null ? "" : Number(v).toFixed(2));

// 明细/汇总导出列(对照老系统 detailColumns/summaryColumns;价格列按权限裁剪)
function detailCols(priceHidden: boolean): ExportCol[] {
  return [
    { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
    { title: "单号", key: "单号" },
    { title: "生产单号", key: "生产单号" },
    { title: "款号", key: "款号" },
    { title: "领料部门", key: "领料部门" },
    { title: "领料人", key: "领料人" },
    { title: "装配采购", key: "装配采购" },
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "颜色", key: "颜色" },
    { title: "塑胶货号", key: "塑胶货号" },
    { title: "共用物料", key: "共用物料" },
    { title: "共用货号", key: "共用货号" },
    { title: "单位", key: "单位" },
    { title: "数量", key: "数量" },
    ...(priceHidden
      ? []
      : [
          { title: "单价", key: "单价" },
          { title: "金额", key: "金额", fmt: (v: unknown) => fix2(v as number | null) },
        ]),
    { title: "备注", key: "备注" },
    { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
  ];
}
function summaryCols(priceHidden: boolean): ExportCol[] {
  return [
    { title: "生产单号", key: "生产单号" },
    { title: "款号", key: "款号" },
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "颜色", key: "颜色" },
    { title: "塑胶货号", key: "塑胶货号" },
    { title: "共用物料", key: "共用物料" },
    { title: "共用货号", key: "共用货号" },
    { title: "单位", key: "单位" },
    { title: "数量", key: "数量" },
    ...(priceHidden
      ? []
      : [
          { title: "单价", key: "单价" },
          { title: "金额", key: "金额", fmt: (v: unknown) => fix2(v as number | null) },
        ]),
  ];
}

// ---------- 结果表列(共享查询表 QueryTable;size=宽度权重,单元格类名照原 DetailCells/SummaryCells) ----------

const monoDimCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const monoStrongCls = "f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]";
const monoPlainCls = "f-mono px-3 py-2 text-[#3d4a5c]";
const numCellCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const numDimCls = "f-mono px-3 py-2 text-right text-[#3d4a5c]";

const detailCol = createColumnHelper<PlasticIssueQueryDetailRow>();
function detailTableCols(priceHidden: boolean) {
  return [
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
    detailCol.accessor("款号", { header: "款号", size: 7, meta: { tdClass: monoPlainCls } }),
    detailCol.accessor("领料部门", { header: "领料部门", size: 8 }),
    detailCol.accessor("领料人", { header: "领料人", size: 6 }),
    detailCol.accessor("装配采购", { header: "装配采购", size: 7 }),
    detailCol.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoStrongCls } }),
    detailCol.accessor("物料名称", { header: "物料名称", size: 12 }),
    detailCol.accessor("颜色", { header: "颜色", size: 6 }),
    detailCol.accessor("塑胶货号", { header: "塑胶货号", size: 7, meta: { tdClass: monoPlainCls } }),
    detailCol.accessor("共用物料", { header: "共用物料", size: 7 }),
    detailCol.accessor("共用货号", { header: "共用货号", size: 7 }),
    detailCol.accessor("单位", { header: "单位", size: 4 }),
    detailCol.accessor("数量", {
      header: "数量",
      size: 6,
      cell: (c) => c.getValue() ?? "",
      meta: { align: "right", tdClass: numCellCls },
    }),
    ...(priceHidden
      ? []
      : [
          detailCol.accessor("单价", {
            header: "单价",
            size: 6,
            cell: (c) => c.getValue() ?? "",
            meta: { align: "right", tdClass: numDimCls },
          }),
          detailCol.accessor("金额", {
            header: "金额",
            size: 7,
            cell: (c) => fix2(c.getValue()),
            meta: { align: "right", tdClass: numDimCls },
          }),
        ]),
    detailCol.accessor("备注", { header: "备注", size: 10 }),
    detailCol.accessor("审核", {
      header: "审核",
      size: 6,
      cell: (c) => (c.getValue() === "1" ? "已审核" : "未审核"),
    }),
  ];
}

const summaryCol = createColumnHelper<PlasticIssueQuerySummaryRow>();
function summaryTableCols(priceHidden: boolean) {
  return [
    summaryCol.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoDimCls } }),
    summaryCol.accessor("款号", { header: "款号", size: 7, meta: { tdClass: monoPlainCls } }),
    summaryCol.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoStrongCls } }),
    summaryCol.accessor("物料名称", { header: "物料名称", size: 12 }),
    summaryCol.accessor("颜色", { header: "颜色", size: 7 }),
    summaryCol.accessor("塑胶货号", { header: "塑胶货号", size: 8, meta: { tdClass: monoPlainCls } }),
    summaryCol.accessor("共用物料", { header: "共用物料", size: 9 }),
    summaryCol.accessor("共用货号", { header: "共用货号", size: 8 }),
    summaryCol.accessor("单位", { header: "单位", size: 5 }),
    summaryCol.accessor("数量", {
      header: "数量",
      size: 7,
      cell: (c) => c.getValue() ?? 0,
      meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]" },
    }),
    ...(priceHidden
      ? []
      : [
          summaryCol.accessor("单价", {
            header: "单价",
            size: 6,
            cell: (c) => c.getValue() ?? "",
            meta: { align: "right", tdClass: numDimCls },
          }),
          summaryCol.accessor("金额", {
            header: "金额",
            size: 7,
            cell: (c) => fix2(c.getValue()),
            meta: { align: "right", tdClass: numDimCls },
          }),
        ]),
  ];
}

export function PlasticIssueQueryPanel({ onOpenDoc }: { onOpenDoc: (单号: string) => void }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(QUERY_MENU, "打开");
  const priceHidden = !can(QUERY_MENU, "单价");

  const [sub, setSub] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);
  const [类别, set类别] = useState(ALL_CAT);
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");

  const catsQuery = useQuery({
    queryKey: ["plastic-material-categories"],
    queryFn: () => plasticMaterialMasterApi.categories(),
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
    queryKey: ["plastic-issue", "query-detail", params],
    queryFn: () => plasticIssueApi.queryDetail(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && sub === "detail",
  });
  const summaryQuery = useQuery({
    queryKey: ["plastic-issue", "query-summary", params],
    queryFn: () => plasticIssueApi.querySummary(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && sub === "summary",
  });

  const dCols = detailCols(priceHidden);
  const sCols = summaryCols(priceHidden);
  const dTableCols = useMemo(() => detailTableCols(priceHidden), [priceHidden]);
  const sTableCols = useMemo(() => summaryTableCols(priceHidden), [priceHidden]);
  const exportTarget = () =>
    sub === "detail"
      ? {
          cols: dCols,
          rows: (detailQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "塑胶领料查询-明细",
        }
      : {
          cols: sCols,
          rows: (summaryQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "塑胶领料查询-汇总",
        };

  const activeQuery = sub === "detail" ? detailQuery : summaryQuery;
  const rowCount = (activeQuery.data ?? []).length;

  if (!permsLoading && !canOpen) {
    return (
      <div className="f-panel p-6">
        <DocEmpty
          icon={<Prohibit className="h-5 w-5" />}
          title="无权访问塑胶领料查询"
          description="缺少「塑胶领料查询·打开」权限,请联系管理员开通"
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
                .filter((c: PlasticMaterialCategoryNode) => c.类别)
                .map((c) => ({ value: c.类别!, label: `${c.类别}(${c.数量})` })),
            ]}
            onChange={(v) => set类别(v)}
          />
        </FormField>
        <FormField label="关键字">
          <Input
            className={cn(inputCls, "w-60")}
            placeholder="物料编号/名称/生产单号/款号"
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
            printTable(name, cols, rows);
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
          columns={dTableCols}
          rows={detailQuery.data ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage="加载塑胶领料查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={1600}
          onRowDoubleClick={(r) => r.单号 && onOpenDoc(r.单号)}
          rowTitle={(r) => `双击打开整单 ${r.单号 ?? ""}`}
          footer={`共 ${rowCount} 条,双击行打开塑胶领料单整单`}
        />
      ) : (
        <QueryTable
          columns={sTableCols}
          rows={summaryQuery.data ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage="加载塑胶领料查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={1100}
          footer={`共 ${rowCount} 条`}
        />
      )}
    </div>
  );
}
