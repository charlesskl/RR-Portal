// 装配采购进度表(装配部报表群;老系统 web/src/pages/assembly/AssemblyPurchaseProgressPage.tsx 重写):
// 数据源=装配采购查询明细(映射为进度行:入仓数量恒 0,相差=订货,出货情况 未到/已到),
// 到货情况/只显示3天内交货 为客户端过滤(纯函数 filterAssemblyProgress,见 lib/assemblyReports.ts);
// 双击行跳装配加工采购单整单(web2 路由 /assembly-purchases?单号=)。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyPurchaseQueryController.cs:16)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { assemblyPurchaseQueryApi } from "@/api/endpoints";
import { usePerms } from "@/hooks/usePerms";
import {
  ASSEMBLY_ALL,
  assemblyOrderPath,
  filterAssemblyProgress,
  lastMonthToToday,
  toAssemblyProgressRow,
  wideRange,
  type AssemblyProgressRow,
  type DateRange,
} from "@/lib/assemblyReports";
import { monthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { Checkbox } from "@/components/ui/checkbox";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "款号资料";

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const fmtNum = (v?: number | null) => (v == null ? "" : Number(v).toLocaleString());
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const col = createColumnHelper<AssemblyProgressRow>();
const columns = [
  col.accessor("订购日期", { header: "订购日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("完成日期", { header: "完成日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("入库日期", { header: "入库日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("订单单号", {
    header: "订单单号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("加工厂编号", { header: "加工厂编号", size: 8 }),
  col.accessor("加工厂名称", { header: "加工厂名称", size: 11 }),
  col.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("产品名称", { header: "产品名称", size: 11 }),
  col.accessor("配件编号", { header: "配件编号", size: 8 }),
  col.accessor("产品装配名称", { header: "产品装配名称", size: 11 }),
  col.accessor("装配方式", { header: "装配方式", size: 9 }),
  col.accessor("生产接单日期", { header: "生产接单日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("货币", { header: "货币", size: 5 }),
  col.accessor("订货数量", { header: "订货数量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("入仓数量", { header: "入仓数量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("相差数量", { header: "相差数量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("出货情况", { header: "出货情况", size: 6 }),
];

const exportCols: ExportCol[] = [
  { title: "订购日期", key: "订购日期", fmt: (v) => d10(v as string) },
  { title: "完成日期", key: "完成日期", fmt: (v) => d10(v as string) },
  { title: "入库日期", key: "入库日期", fmt: (v) => d10(v as string) },
  { title: "订单单号", key: "订单单号" },
  { title: "加工厂编号", key: "加工厂编号" },
  { title: "加工厂名称", key: "加工厂名称" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "配件编号", key: "配件编号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "装配方式", key: "装配方式" },
  { title: "生产接单日期", key: "生产接单日期", fmt: (v) => d10(v as string) },
  { title: "生产单号", key: "生产单号" },
  { title: "货币", key: "货币" },
  { title: "订货数量", key: "订货数量" },
  { title: "入仓数量", key: "入仓数量" },
  { title: "相差数量", key: "相差数量" },
  { title: "出货情况", key: "出货情况" },
];

export default function AssemblyPurchaseProgressPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [arrival, setArrival] = useState("未到");
  const [dateMode, setDateMode] = useState<"不选择日期" | "订购日期">("不选择日期");
  const [range, setRange] = useState<DateRange>(lastMonthToToday);
  const [warehouse, setWarehouse] = useState(ASSEMBLY_ALL);
  const [onlyDueSoon, setOnlyDueSoon] = useState(false);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  // 不选择日期 -> 宽区间(2000-01-01 到今天+1年;对照老系统 wideRange)
  const queryRange = dateMode === "不选择日期" ? wideRange() : range;

  const q = useQuery({
    queryKey: ["asm-po-progress", queryRange.起, queryRange.止, keyword, warehouse],
    queryFn: () =>
      assemblyPurchaseQueryApi.detail({
        起: queryRange.起,
        止: queryRange.止,
        keyword: keyword || undefined,
        收货仓库: warehouse === ASSEMBLY_ALL ? undefined : warehouse,
      }),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });

  const rows = useMemo(() => (q.data ?? []).map(toAssemblyProgressRow), [q.data]);
  const filteredRows = useMemo(
    () => filterAssemblyProgress(rows, arrival, onlyDueSoon),
    [rows, arrival, onlyDueSoon],
  );

  const jumpMonth = (off: number) => {
    setDateMode("订购日期");
    setRange(monthRange(off));
  };

  const openOrder = (单号?: string) => {
    const path = assemblyOrderPath(单号);
    if (path) navigate(path);
  };

  const asRecords = () => filteredRows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 装配采购进度表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">装配采购进度表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-x-3 gap-y-3 p-5">
        <div className="space-y-1.5">
          <label className="f-label block">到货情况</label>
          <SearchSelect
            ariaLabel="到货情况"
            className="w-26"
            value={arrival}
            options={["未到", "已到", ASSEMBLY_ALL].map((v) => ({ value: v, label: v }))}
            onChange={(v) => setArrival(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">日期</label>
          <SearchSelect
            ariaLabel="日期"
            className="w-32"
            value={dateMode}
            options={["不选择日期", "订购日期"].map((v) => ({ value: v, label: v }))}
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
              disabled={dateMode === "不选择日期"}
              value={range.起}
              onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
            />
            <span className="text-[#5f6b7d]">~</span>
            <input
              type="date"
              aria-label="止"
              className="f-input w-38"
              disabled={dateMode === "不选择日期"}
              value={range.止}
              onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
            />
          </div>
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
              onClick={() => jumpMonth(m.off)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">收货仓库</label>
          <SearchSelect
            ariaLabel="收货仓库"
            className="w-28"
            value={warehouse}
            options={[ASSEMBLY_ALL, "成品仓", "半成品仓"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => setWarehouse(v)}
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-[#3d4a5c]">
          <Checkbox
            aria-label="只显示3天内交货的订单"
            className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
            checked={onlyDueSoon}
            onCheckedChange={(v) => setOnlyDueSoon(v === true)}
          />
          只显示3天内交货的订单
        </label>
        <div className="w-64 space-y-1.5">
          <label htmlFor="app-kw" className="f-label block">
            关键字
          </label>
          <input
            id="app-kw"
            className="f-input"
            placeholder="生产单号 / 订单单号 / 产品货号 / 加工厂"
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
          disabled={!filteredRows.length}
          onClick={() => downloadCsv("装配采购进度表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!filteredRows.length}
          onClick={() => printTable("装配采购进度表", exportCols, asRecords())}
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
        rows={filteredRows}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => q.refetch()}
        errorMessage="加载装配采购进度表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有未到/已到的装配采购记录"
        onRowDoubleClick={(r) => openOrder(r.订单单号)}
        rowTitle={(r) => (r.订单单号 ? `双击打开委托加工单 ${r.订单单号}` : undefined)}
        fill
        minWidth={2100}
        footer={<span>共 {filteredRows.length} 条,双击行打开装配加工单</span>}
      />
    </div>
  );
}
