// 订购单查询(/purchase-order-query;来料仓)。对照老系统 web/src/pages/production/PurchaseOrderQueryPage.tsx:
// 明细/汇总双查询,筛选=月份跳转+日期类型(订货/交货)+起止+供应商+物料类别+关键字;
// 价格列尊重「单价」权限(无权限不渲染也不导出);明细双击跳采购订单整单(/purchase-orders?单号=)。
// 权限菜单=采购订单(MenuCatalog 实证:物料管理组;后端 PurchaseOrderController order-query 同菜单鉴权)。
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { materialMasterApi, purchaseOrderApi } from "@/api/endpoints";
import type {
  MaterialCategoryNode,
  PurchaseOrderQueryDetailRow,
  PurchaseOrderQuerySummaryRow,
} from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { ALL_CAT, monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { buildOrderQuery } from "@/lib/purchaseOrderQuery";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { MENU_PATHS } from "@/nav/menu";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "采购订单";

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const fmtAudit = (v?: string) => (v === "1" ? "已审核" : "未审核");
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const monoStrongCls = "f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

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

// 导出/打印列规格(对照老系统 detailExportCols/summaryExportCols;价格列按权限裁剪)
const detailExportColsAll: ExportCol[] = [
  { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "单号", key: "单号" },
  { title: "供应商", key: "供应商名称" },
  { title: "生产单号", key: "生产单号" },
  { title: "款号", key: "款号" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "物料类别" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "数量", key: "数量" },
  { title: "单价", key: "单价" },
  { title: "金额", key: "金额" },
  { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
  { title: "备注", key: "备注" },
];
const summaryExportCols: ExportCol[] = [
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "材料", key: "物料类别" },
  { title: "规格", key: "规格" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "订购数量", key: "订购数量" },
];

export default function PurchaseOrderQueryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");
  const navigate = useNavigate();

  const [tab, setTab] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [日期类型, set日期类型] = useState("订货日期");
  const [供应商, set供应商] = useState("");
  const [类别, set类别] = useState(ALL_CAT);
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const catsQuery = useQuery({
    queryKey: ["material-categories"],
    queryFn: () => materialMasterApi.categories(),
    staleTime: 5 * 60_000,
    enabled: !permsLoading && canOpen,
  });

  const params = buildOrderQuery({
    供应商,
    keyword: kw,
    类别,
    日期类型,
    起: range.起,
    止: range.止,
  });

  const detailQuery = useQuery({
    queryKey: ["po-order-query", "detail", params],
    queryFn: () => purchaseOrderApi.orderQueryDetail(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && tab === "detail",
  });
  const summaryQuery = useQuery({
    queryKey: ["po-order-query", "summary", params],
    queryFn: () => purchaseOrderApi.orderQuerySummary(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && tab === "summary",
  });
  const active = tab === "detail" ? detailQuery : summaryQuery;
  const rowCount = (active.data ?? []).length;

  // 明细列(价格列按「单价」权限裁剪;对照老系统 detailColumns 的 priceHidden 分支)
  const detailColumns = useMemo<ColumnDef<PurchaseOrderQueryDetailRow, any>[]>(() => {
    const c = createColumnHelper<PurchaseOrderQueryDetailRow>();
    return [
      c.accessor("日期", { header: "日期", size: 8, cell: (x) => d10(x.getValue()), meta: { tdClass: monoCls } }),
      c.accessor("单号", {
        header: "单号",
        size: 9,
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
      }),
      c.accessor("供应商名称", { header: "供应商", size: 11 }),
      c.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoCls } }),
      c.accessor("款号", { header: "款号", size: 7, meta: { tdClass: monoCls } }),
      c.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoStrongCls } }),
      c.accessor("物料名称", { header: "物料名称", size: 12 }),
      c.accessor("规格", { header: "规格", size: 9 }),
      c.accessor("物料类别", { header: "材料", size: 7 }),
      c.accessor("颜色", { header: "颜色", size: 6 }),
      c.accessor("单位", { header: "单位", size: 4 }),
      c.accessor("数量", {
        header: "数量",
        size: 6,
        cell: (x) => x.getValue() ?? "",
        meta: { align: "right", tdClass: numCls },
      }),
      ...(priceHidden
        ? []
        : ([
            c.accessor("单价", {
              header: "单价",
              size: 6,
              cell: (x) => x.getValue() ?? "",
              meta: { align: "right", tdClass: numCls },
            }),
            c.accessor("金额", {
              header: "金额",
              size: 7,
              cell: (x) => x.getValue() ?? "",
              meta: { align: "right", tdClass: numCls },
            }),
          ] as ColumnDef<PurchaseOrderQueryDetailRow, any>[])),
      c.accessor("审核", { header: "审核", size: 6, cell: (x) => fmtAudit(x.getValue()) }),
      c.accessor("备注", { header: "备注", size: 10 }),
    ];
  }, [priceHidden]);

  const summaryColumns = useMemo<ColumnDef<PurchaseOrderQuerySummaryRow, any>[]>(() => {
    const c = createColumnHelper<PurchaseOrderQuerySummaryRow>();
    return [
      c.accessor("物料编号", { header: "物料编号", size: 10, meta: { tdClass: monoStrongCls } }),
      c.accessor("物料名称", { header: "物料名称", size: 14 }),
      c.accessor("物料类别", { header: "材料", size: 8 }),
      c.accessor("规格", { header: "规格", size: 10 }),
      c.accessor("颜色", { header: "颜色", size: 7 }),
      c.accessor("单位", { header: "单位", size: 5 }),
      c.accessor("订购数量", {
        header: "订购数量",
        size: 8,
        cell: (x) => x.getValue() ?? "",
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]" },
      }),
    ];
  }, []);

  const exportTarget = () => {
    const detailCols = priceHidden
      ? detailExportColsAll.filter((c) => c.key !== "单价" && c.key !== "金额")
      : detailExportColsAll;
    return tab === "detail"
      ? {
          cols: detailCols,
          rows: (detailQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "订购单明细",
        }
      : {
          cols: summaryExportCols,
          rows: (summaryQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "订购单汇总",
        };
  };
  const exportNow = (action: "csv" | "print") => {
    const { cols, rows, name } = exportTarget();
    if (!rows.length) return;
    if (action === "csv") downloadCsv(`${name}.csv`, cols, rows);
    else printTable(`${name}查询`, cols, rows);
  };

  // 双击明细行跳采购订单整单;目标未注册不静默断链(MENU_PATHS 裁决)
  const openOrder = (单号?: string) => {
    if (!单号) return;
    if (!MENU_PATHS.has("/purchase-orders")) {
      setToast({ text: `采购订单页未注册,请记下订单号:${单号}`, tone: "err" });
      return;
    }
    navigate(`/purchase-orders?单号=${encodeURIComponent(单号)}`);
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 订购单查询"
            description="缺少「采购订单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">订购单查询</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏 */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
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
        <FormField label="日期类型">
          <SearchSelect
            ariaLabel="日期类型"
            className={cn(inputCls, "w-28 rounded-md border px-2")}
            value={日期类型}
            options={["订货日期", "交货日期"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set日期类型(v)}
          />
        </FormField>
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
        <FormField label="供应商">
          <Input
            className={cn(inputCls, "w-40")}
            aria-label="供应商"
            placeholder="供应商"
            value={供应商}
            onChange={(e) => set供应商(e.target.value)}
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
            className={cn(inputCls, "w-56")}
            aria-label="关键字"
            placeholder="物料编号/名称/规格"
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
        <button type="button" className="f-btn h-10 px-4 text-sm" onClick={() => exportNow("csv")}>
          导出EXCEL
        </button>
        <button type="button" className="f-btn h-10 px-4 text-sm" onClick={() => exportNow("print")}>
          <Printer className="h-4 w-4" />
          打印
        </button>
        <button type="button" className="f-btn h-10 px-4 text-sm" onClick={() => navigate(-1)}>
          <X className="h-4 w-4" />
          关闭
        </button>
      </div>

      {/* 明细/汇总子页签 */}
      <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
        {[
          { key: "detail" as const, label: "明细查询" },
          { key: "summary" as const, label: "汇总查询" },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "h-9 rounded-lg px-4 text-sm transition-colors",
              tab === t.key
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#5f6b7d] hover:text-[#3d4a5c]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "detail" ? (
        <QueryTable
          columns={detailColumns}
          rows={detailQuery.data ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          onRetry={() => active.refetch()}
          errorMessage="加载订购单查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          fill
          minWidth={1700}
          onRowDoubleClick={(r) => openOrder(r.单号)}
          rowTitle={(r) => (r.单号 ? `双击打开采购订单 ${r.单号}` : undefined)}
          footer={<span>共 {rowCount} 条,双击行打开采购订单整单</span>}
        />
      ) : (
        <QueryTable
          columns={summaryColumns}
          rows={summaryQuery.data ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          onRetry={() => active.refetch()}
          errorMessage="加载订购单查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          fill
          minWidth={900}
          footer={<span>共 {rowCount} 条</span>}
        />
      )}

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
