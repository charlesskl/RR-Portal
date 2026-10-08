// 装配采购查询(装配部报表群;老系统 web/src/pages/assembly/AssemblyPurchaseQueryPage.tsx 重写):
// 汇总/明细双页签 + 筛选(出单日期区间/收货仓库/审核情况/关键字) + 导出 CSV + 打印;
// 双击行跳装配加工采购单整单(web2 路由 /assembly-purchases?单号=)。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyPurchaseQueryController.cs:16)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { assemblyPurchaseQueryApi } from "@/api/endpoints";
import type { AssemblyPurchaseDetailRow, AssemblyPurchaseSummaryRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { assemblyOrderPath, type DateRange } from "@/lib/assemblyReports";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { cn } from "@/lib/utils";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "款号资料";
const ALL = "全部";

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const fmtNum = (v?: number | null) => (v == null ? "" : Number(v).toLocaleString());
const fmtAudit = (v?: string) => (v === "1" ? "已审核" : "未审核");
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const monoStrongCls = "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const sumCol = createColumnHelper<AssemblyPurchaseSummaryRow>();
const summaryColumns = [
  sumCol.accessor("收货仓库", { header: "收货仓库", size: 8 }),
  sumCol.accessor("产品货号", { header: "产品货号", size: 10, meta: { tdClass: monoCls } }),
  sumCol.accessor("配件编号", { header: "配件编号", size: 9 }),
  sumCol.accessor("产品装配名称", { header: "产品装配名称", size: 12 }),
  sumCol.accessor("装配方式", { header: "装配方式", size: 10 }),
  sumCol.accessor("生产单号", { header: "生产单号", size: 10, meta: { tdClass: monoCls } }),
  sumCol.accessor("加工数量", {
    header: "加工数量",
    size: 7,
    cell: (c) => fmtNum(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
];

const detCol = createColumnHelper<AssemblyPurchaseDetailRow>();
const detailColumns = [
  detCol.accessor("开单日期", { header: "开单日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  detCol.accessor("单号", { header: "单号", size: 9, meta: { tdClass: monoStrongCls } }),
  detCol.accessor("完成日期", { header: "完成日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  detCol.accessor("收货仓库", { header: "收货仓库", size: 7 }),
  detCol.accessor("供应商编号", { header: "供应商编号", size: 8 }),
  detCol.accessor("供应商名称", { header: "供应商名称", size: 11 }),
  detCol.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  detCol.accessor("配件编号", { header: "配件编号", size: 8 }),
  detCol.accessor("产品装配名称", { header: "产品装配名称", size: 11 }),
  detCol.accessor("装配方式", { header: "装配方式", size: 9 }),
  detCol.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoCls } }),
  detCol.accessor("货币", { header: "货币", size: 5 }),
  detCol.accessor("数量", {
    header: "数量",
    size: 6,
    cell: (c) => fmtNum(c.getValue()),
    meta: { align: "right", tdClass: numCls },
  }),
  detCol.accessor("备注", { header: "备注", size: 10 }),
  detCol.accessor("审核", { header: "审核", size: 6, cell: (c) => fmtAudit(c.getValue()) }),
];

// 导出列(对照老系统 exportNow:日期列截 10 位,审核列 1->已审核)
const summaryExportCols: ExportCol[] = [
  { title: "收货仓库", key: "收货仓库" },
  { title: "产品货号", key: "产品货号" },
  { title: "配件编号", key: "配件编号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "装配方式", key: "装配方式" },
  { title: "生产单号", key: "生产单号" },
  { title: "加工数量", key: "加工数量" },
];
const detailExportCols: ExportCol[] = [
  { title: "开单日期", key: "开单日期", fmt: (v) => d10(v as string) },
  { title: "单号", key: "单号" },
  { title: "完成日期", key: "完成日期", fmt: (v) => d10(v as string) },
  { title: "收货仓库", key: "收货仓库" },
  { title: "供应商编号", key: "供应商编号" },
  { title: "供应商名称", key: "供应商名称" },
  { title: "产品货号", key: "产品货号" },
  { title: "配件编号", key: "配件编号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "装配方式", key: "装配方式" },
  { title: "生产单号", key: "生产单号" },
  { title: "货币", key: "货币" },
  { title: "数量", key: "数量" },
  { title: "备注", key: "备注" },
  { title: "审核", key: "审核", fmt: (v) => fmtAudit(v as string) },
];

export default function AssemblyPurchaseQueryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [tab, setTab] = useState<"summary" | "detail">("summary");
  const [range, setRange] = useState<DateRange>(thisMonthRange);
  const [warehouse, setWarehouse] = useState(ALL);
  const [audit, setAudit] = useState(ALL);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const params = {
    起: range.起,
    止: range.止,
    keyword: keyword || undefined,
    收货仓库: warehouse === ALL ? undefined : warehouse,
    审核情况: audit === ALL ? undefined : audit,
  };

  const summaryQuery = useQuery({
    queryKey: ["asm-po-query", "summary", params],
    queryFn: () => assemblyPurchaseQueryApi.summary(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && tab === "summary",
  });
  const detailQuery = useQuery({
    queryKey: ["asm-po-query", "detail", params],
    queryFn: () => assemblyPurchaseQueryApi.detail(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && tab === "detail",
  });
  const active = tab === "summary" ? summaryQuery : detailQuery;
  const rows = active.data ?? [];

  const openOrder = (单号?: string) => {
    const path = assemblyOrderPath(单号);
    if (path) navigate(path);
  };

  const exportNow = (action: "csv" | "print") => {
    const cols = tab === "summary" ? summaryExportCols : detailExportCols;
    const name = tab === "summary" ? "装配采购查询-汇总" : "装配采购查询-明细";
    const data = rows as unknown as Record<string, unknown>[];
    if (!data.length) return;
    if (action === "csv") downloadCsv(`${name}.csv`, cols, data);
    else printTable(name, cols, data);
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 装配采购查询"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">装配采购查询</h1>
        <DensitySwitch className="ml-auto" />
      </div>

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
        <div className="space-y-1.5">
          <span className="f-label block">日期(出单日期)</span>
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
        <div className="space-y-1.5">
          <label className="f-label block">收货仓库</label>
          <SearchSelect
            ariaLabel="收货仓库"
            className="w-28"
            value={warehouse}
            options={[ALL, "成品仓", "半成品仓"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => setWarehouse(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">审核情况</label>
          <SearchSelect
            ariaLabel="审核情况"
            className="w-28"
            value={audit}
            options={[ALL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => setAudit(v)}
          />
        </div>
        <div className="w-64 space-y-1.5">
          <label htmlFor="apq-kw" className="f-label block">
            关键字
          </label>
          <input
            id="apq-kw"
            className="f-input"
            placeholder="生产单号 / 产品货号 / 配件编号 / 供应商"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setKeyword(kwInput.trim())}
        >
          查询
        </button>
        <button
          type="button"
          className="f-btn px-4"
          onClick={() => setKeyword(kwInput.trim())}
        >
          精确查询
        </button>
        <button type="button" className="f-btn px-4" onClick={() => exportNow("csv")}>
          导出EXCEL
        </button>
        <button type="button" className="f-btn px-4" onClick={() => exportNow("print")}>
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        <button type="button" className="f-btn px-4" onClick={() => navigate(-1)}>
          <X className="h-4.5 w-4.5" />
          关闭
        </button>
      </div>

      {/* 汇总/明细子页签 */}
      <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
        {[
          { key: "summary" as const, label: "汇总查询" },
          { key: "detail" as const, label: "明细查询" },
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

      {tab === "summary" ? (
        <QueryTable
          columns={summaryColumns}
          rows={summaryQuery.data ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          onRetry={() => active.refetch()}
          errorMessage="加载装配采购查询失败,请重试"
          emptyTitle="暂无数据"
          emptyDescription="当前筛选条件下没有装配采购记录"
          onRowDoubleClick={(r) => openOrder(r.单号)}
          rowTitle={(r) => (r.单号 ? `双击打开委托加工单 ${r.单号}` : undefined)}
          fill
          minWidth={1000}
          footer={<span>共查询到记录数:{rows.length}</span>}
        />
      ) : (
        <QueryTable
          columns={detailColumns}
          rows={detailQuery.data ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          onRetry={() => active.refetch()}
          errorMessage="加载装配采购查询失败,请重试"
          emptyTitle="暂无数据"
          emptyDescription="当前筛选条件下没有装配采购记录"
          onRowDoubleClick={(r) => openOrder(r.单号)}
          rowTitle={(r) => (r.单号 ? `双击打开委托加工单 ${r.单号}` : undefined)}
          fill
          minWidth={1900}
          footer={<span>共查询到记录数:{rows.length}</span>}
        />
      )}
    </div>
  );
}
