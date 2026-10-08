// 加工厂分类月报表(装配部报表群;老系统 web/src/pages/assembly/AssemblyFactoryCategoryMonthlyPage.tsx 重写):
// 筛选(月份跳转 + 加工厂 + 日期区间 + 关键字) + 共享查询表 + 导出/打印。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyPurchaseQueryController.cs:16)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { assemblyPurchaseQueryApi, factoriesApi } from "@/api/endpoints";
import type { AssemblyFactoryCategoryMonthlyRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import {
  ASSEMBLY_ALL,
  buildFactoryCategoryMonthlyQuery,
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
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";

const col = createColumnHelper<AssemblyFactoryCategoryMonthlyRow>();
const columns = [
  col.accessor("加工厂编号", { header: "加工厂编号", size: 8 }),
  col.accessor("加工厂名称", { header: "加工厂名称", size: 13 }),
  col.accessor("收货仓库", { header: "收货仓库", size: 7 }),
  col.accessor("物料分类", { header: "物料分类", size: 9 }),
  col.accessor("产品款数", { header: "产品款数", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("物料款数", { header: "物料款数", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("领料数量", { header: "领料数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("送货数量", { header: "送货数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("库存数量", { header: "库存数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("起始日期", { header: "起始日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("截止日期", { header: "截止日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
];

const exportCols: ExportCol[] = [
  { title: "加工厂编号", key: "加工厂编号" },
  { title: "加工厂名称", key: "加工厂名称" },
  { title: "收货仓库", key: "收货仓库" },
  { title: "物料分类", key: "物料分类" },
  { title: "产品款数", key: "产品款数" },
  { title: "物料款数", key: "物料款数" },
  { title: "领料数量", key: "领料数量" },
  { title: "送货数量", key: "送货数量" },
  { title: "库存数量", key: "库存数量" },
  { title: "起始日期", key: "起始日期", fmt: (v) => fmtDate(v as string) },
  { title: "截止日期", key: "截止日期", fmt: (v) => fmtDate(v as string) },
];

export default function AssemblyFactoryCategoryMonthlyPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [range, setRange] = useState<DateRange>(thisMonthRange);
  const [factory, setFactory] = useState(ASSEMBLY_ALL);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const factoriesQuery = useQuery({
    queryKey: ["factories", "pick"],
    queryFn: () => factoriesApi.list(1, 500, ""),
    staleTime: 5 * 60_000,
    enabled: !permsLoading && canOpen,
  });

  const params = buildFactoryCategoryMonthlyQuery({
    起: range.起,
    止: range.止,
    加工厂: factory,
    keyword,
  });

  const q = useQuery({
    queryKey: ["asm-factory-category-monthly", params],
    queryFn: () => assemblyPurchaseQueryApi.factoryCategoryMonthly(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const factoryOptions = useMemo(
    () =>
      (factoriesQuery.data?.items ?? [])
        .filter((f) => f.加工厂编号 || f.加工厂名称)
        .map((f) => `${f.加工厂编号 ?? ""} ${f.加工厂名称 ?? ""}`.trim()),
    [factoriesQuery.data],
  );

  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 加工厂分类月报表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">加工厂分类月报表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-x-3 gap-y-3 p-5">
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
          <label className="f-label block">加工厂</label>
          <SearchSelect
            ariaLabel="加工厂"
            className="w-64"
            value={factory}
            options={[
              { value: ASSEMBLY_ALL, label: "全部" },
              ...factoryOptions.map((v) => ({ value: v, label: v })),
            ]}
            onChange={(v) => setFactory(v)}
          />
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
          <label htmlFor="afcm-kw" className="f-label block">
            关键字
          </label>
          <input
            id="afcm-kw"
            className="f-input"
            placeholder="加工厂名称 / 编号 / 物料分类"
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
          onClick={() => downloadCsv("加工厂分类月报表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => printTable("加工厂分类月报表", exportCols, asRecords())}
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
        errorMessage="加载加工厂分类月报表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有月报记录"
        fill
        minWidth={1400}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
