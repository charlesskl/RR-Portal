// 装配需领明细表(装配部报表群;老系统 web/src/pages/assembly/AssemblyRequiredMaterialDetailPage.tsx 重写):
// 筛选(收货仓库 + 类型 + 审核情况 + 日期区间 + 关键字) + 共享查询表 + 导出/打印;
// 双击行跳装配加工采购单整单(web2 路由 /assembly-purchases?单号=)。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyPurchaseQueryController.cs:16)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { assemblyPurchaseQueryApi } from "@/api/endpoints";
import type { AssemblyRequiredMaterialRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import {
  ASSEMBLY_ALL,
  assemblyOrderPath,
  buildRequiredMaterialQuery,
  type DateRange,
} from "@/lib/assemblyReports";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "款号资料";

const fmtDate = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtNum = (v?: number | null) => (v == null ? "" : Number(v).toLocaleString());
const fmtAudit = (v?: string | null) => (v === "1" || v === "已审核" ? "已审核" : "");
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";

const col = createColumnHelper<AssemblyRequiredMaterialRow>();
const columns = [
  col.accessor("日期", { header: "日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("单号", {
    header: "单号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("收货仓库", { header: "收货仓库", size: 7 }),
  col.accessor("供应商编号", { header: "供应商编号", size: 8 }),
  col.accessor("供应商名称", { header: "供应商名称", size: 12 }),
  col.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("产品装配名称", { header: "产品装配名称", size: 12 }),
  col.accessor("装配方式", { header: "装配方式", size: 9 }),
  col.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("物料名称", { header: "物料名称", size: 13 }),
  col.accessor("需领数量", {
    header: "需领数量",
    size: 7,
    cell: (c) => fmtNum(c.getValue()),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  col.accessor("审核", { header: "审核", size: 6, cell: (c) => fmtAudit(c.getValue()) }),
];

const exportCols: ExportCol[] = [
  { title: "日期", key: "日期", fmt: (v) => fmtDate(v as string) },
  { title: "单号", key: "单号" },
  { title: "收货仓库", key: "收货仓库" },
  { title: "供应商编号", key: "供应商编号" },
  { title: "供应商名称", key: "供应商名称" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "装配方式", key: "装配方式" },
  { title: "生产单号", key: "生产单号" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "需领数量", key: "需领数量" },
  { title: "审核", key: "审核", fmt: (v) => fmtAudit(v as string) },
];

export default function AssemblyRequiredMaterialDetailPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [warehouse, setWarehouse] = useState(ASSEMBLY_ALL);
  const [materialType, setMaterialType] = useState(ASSEMBLY_ALL);
  const [audit, setAudit] = useState(ASSEMBLY_ALL);
  const [range, setRange] = useState<DateRange>(thisMonthRange);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const params = buildRequiredMaterialQuery({
    起: range.起,
    止: range.止,
    keyword,
    收货仓库: warehouse,
    类型: materialType,
    审核情况: audit,
  });

  const q = useQuery({
    queryKey: ["asm-required-materials", params],
    queryFn: () => assemblyPurchaseQueryApi.requiredMaterials(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const openOrder = (row: AssemblyRequiredMaterialRow) => {
    const path = assemblyOrderPath(row.单号);
    if (path) navigate(path);
  };

  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 装配需领明细表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">装配需领明细表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-x-3 gap-y-3 p-5">
        <div className="space-y-1.5">
          <label className="f-label block">
            收货仓库
          </label>
          <SearchSelect
            ariaLabel="收货仓库"
            className="w-28"
            value={warehouse}
            options={[ASSEMBLY_ALL, "成品仓", "半成品仓"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setWarehouse(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            类型
          </label>
          <SearchSelect
            ariaLabel="类型"
            className="w-36"
            value={materialType}
            options={[ASSEMBLY_ALL, "成品", "半成品", "未包装半成品"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setMaterialType(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            审核情况
          </label>
          <SearchSelect
            ariaLabel="审核情况"
            className="w-28"
            value={audit}
            options={[ASSEMBLY_ALL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setAudit(v)}
          />
        </div>
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
          <span className="f-label block">日期</span>
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
          <label htmlFor="arm-kw" className="f-label block">
            关键字
          </label>
          <input
            id="arm-kw"
            className="f-input"
            placeholder="单号 / 生产单号 / 产品货号 / 物料 / 供应商"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={() => setKeyword(kwInput.trim())}>
          查询
        </button>
        <button type="button" className="f-btn px-4" onClick={() => setKeyword(kwInput.trim())}>
          精确查询
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => downloadCsv("装配需领明细表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => printTable("装配需领明细表", exportCols, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        <button type="button" className="f-btn px-4" onClick={() => navigate(-1)}>
          <X className="h-4.5 w-4.5" />
          关闭
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => q.refetch()}
        errorMessage="加载装配需领明细表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有需领记录"
        onRowDoubleClick={openOrder}
        rowTitle={(r) => (r.单号 ? `双击打开委托加工单 ${r.单号}` : undefined)}
        fill
        minWidth={1700}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
