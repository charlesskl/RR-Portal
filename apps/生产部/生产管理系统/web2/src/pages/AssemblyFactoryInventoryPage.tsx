// 加工厂库存汇总表(装配部报表群;老系统 web/src/pages/assembly/AssemblyFactoryInventoryPage.tsx 重写):
// 筛选(加工厂 + 物料分类 + 收货仓库 + 日期区间 + 领料送货截止日期 + 关键字) + 共享查询表 + 导出/打印。
// 物料分类选项由已加载行去重生成(照抄老系统 categoryOptions)。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyPurchaseQueryController.cs:16)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { assemblyPurchaseQueryApi, factoriesApi } from "@/api/endpoints";
import type { AssemblyFactoryInventoryRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import {
  ASSEMBLY_ALL,
  buildFactoryInventoryQuery,
  fmtDay,
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
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const col = createColumnHelper<AssemblyFactoryInventoryRow>();
const columns = [
  col.accessor("加工厂编号", { header: "加工厂编号", size: 8 }),
  col.accessor("加工厂名称", { header: "加工厂名称", size: 12 }),
  col.accessor("收货仓库", { header: "收货仓库", size: 7 }),
  col.accessor("物料分类", { header: "物料分类", size: 8 }),
  col.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("产品名称", { header: "产品名称", size: 12 }),
  col.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("物料名称", { header: "物料名称", size: 12 }),
  col.accessor("规格", { header: "规格", size: 10 }),
  col.accessor("材料", { header: "材料", size: 8 }),
  col.accessor("颜色", { header: "颜色", size: 7 }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("领料数量", { header: "领料数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("送货数量", { header: "送货数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("库存数量", { header: "库存数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("最后订购日期", { header: "最后订购日期", size: 9, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("领料送货截止日期", { header: "领料送货截止日期", size: 10, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
];

const exportCols: ExportCol[] = [
  { title: "加工厂编号", key: "加工厂编号" },
  { title: "加工厂名称", key: "加工厂名称" },
  { title: "收货仓库", key: "收货仓库" },
  { title: "物料分类", key: "物料分类" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "材料" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "领料数量", key: "领料数量" },
  { title: "送货数量", key: "送货数量" },
  { title: "库存数量", key: "库存数量" },
  { title: "最后订购日期", key: "最后订购日期", fmt: (v) => fmtDate(v as string) },
  { title: "领料送货截止日期", key: "领料送货截止日期", fmt: (v) => fmtDate(v as string) },
];

export default function AssemblyFactoryInventoryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [range, setRange] = useState<DateRange>(thisMonthRange);
  const [dateMode, setDateMode] = useState<"不选择" | "日期">("不选择");
  const [cutoff, setCutoff] = useState(() => fmtDay(new Date()));
  const [factory, setFactory] = useState(ASSEMBLY_ALL);
  const [materialCategory, setMaterialCategory] = useState(ASSEMBLY_ALL);
  const [warehouse, setWarehouse] = useState(ASSEMBLY_ALL);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const factoriesQuery = useQuery({
    queryKey: ["factories", "pick"],
    queryFn: () => factoriesApi.list(1, 500, ""),
    staleTime: 5 * 60_000,
    enabled: !permsLoading && canOpen,
  });

  const params = buildFactoryInventoryQuery({
    启用日期: dateMode === "日期",
    起: range.起,
    止: range.止,
    截止日期: cutoff,
    加工厂: factory,
    物料分类: materialCategory,
    收货仓库: warehouse,
    keyword,
  });

  const q = useQuery({
    queryKey: ["asm-factory-inventory", params],
    queryFn: () => assemblyPurchaseQueryApi.factoryInventory(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const jumpMonth = (off: number) => {
    setDateMode("日期");
    setRange(monthRange(off));
  };

  const factoryOptions = useMemo(
    () =>
      (factoriesQuery.data?.items ?? [])
        .filter((f) => f.加工厂编号 || f.加工厂名称)
        .map((f) => `${f.加工厂编号 ?? ""} ${f.加工厂名称 ?? ""}`.trim()),
    [factoriesQuery.data],
  );

  // 物料分类选项由当前行集去重生成(照抄老系统 categoryOptions)
  const categoryOptions = useMemo(
    () => [...new Set(rows.map((r) => r.物料分类).filter((v): v is string => !!v))],
    [rows],
  );

  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 加工厂库存汇总表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">加工厂库存汇总表</h1>
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
              onClick={() => jumpMonth(m.off)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            加工厂
          </label>
          <SearchSelect
            ariaLabel="加工厂"
            className="w-64"
            value={factory}
            options={[ASSEMBLY_ALL, ...factoryOptions].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setFactory(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            物料分类
          </label>
          <SearchSelect
            ariaLabel="物料分类"
            className="w-30"
            value={materialCategory}
            options={[ASSEMBLY_ALL, ...categoryOptions].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setMaterialCategory(v)}
          />
        </div>
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
            日期
          </label>
          <SearchSelect
            ariaLabel="日期"
            className="w-26"
            value={dateMode}
            options={["不选择", "日期"].map((v) => ({ value: v, label: v }))}
            placeholder="不选择"
            onChange={(v) => setDateMode(v as typeof dateMode)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="f-label block">区间</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="起"
              className="f-input w-38"
              disabled={dateMode === "不选择"}
              value={range.起}
              onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
            />
            <span className="text-[#5f6b7d]">~</span>
            <input
              type="date"
              aria-label="止"
              className="f-input w-38"
              disabled={dateMode === "不选择"}
              value={range.止}
              onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="afi-cutoff" className="f-label block">
            领料送货截止日期
          </label>
          <input
            id="afi-cutoff"
            type="date"
            className="f-input w-38"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
          />
        </div>
        <div className="w-64 space-y-1.5">
          <label htmlFor="afi-kw" className="f-label block">
            关键字
          </label>
          <input
            id="afi-kw"
            className="f-input"
            placeholder="产品货号 / 产品名称 / 物料编号 / 物料名称 / 加工厂名称"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={() => setKeyword(kwInput.trim())}>
          查询
        </button>
        <button type="button" className="f-btn px-4" onClick={() => setKeyword(kwInput.trim())}>
          精确
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => downloadCsv("加工厂库存汇总表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => printTable("加工厂库存汇总表", exportCols, asRecords())}
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
        errorMessage="加载加工厂库存汇总表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有加工厂库存记录"
        fill
        minWidth={2200}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
