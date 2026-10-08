// 装配物料跟踪表(装配部报表群;老系统 web/src/pages/assembly/AssemblyMaterialTrackingPage.tsx 重写):
// 筛选(月份跳转 + 按第二日期截止统计 + 收货仓库 + 订购日期区间 + 关键字) + 共享查询表 + 导出/打印;
// 双击行跳装配加工采购单整单(web2 路由 /assembly-purchases?单号=订单单号)。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyPurchaseQueryController.cs:16)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Printer, Prohibit, X } from "@phosphor-icons/react";
import { assemblyPurchaseQueryApi } from "@/api/endpoints";
import type { AssemblyMaterialTrackingRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import {
  ASSEMBLY_ALL,
  assemblyOrderPath,
  buildMaterialTrackingQuery,
  type DateRange,
} from "@/lib/assemblyReports";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { Checkbox } from "@/components/ui/checkbox";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "款号资料";

// 老系统 fmtDate:dayjs 有效则 YYYY/M/D,否则截 10 位
const fmtDate = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtNum = (v?: number | null) => (v == null ? "" : Number(v).toLocaleString());
const fmtAudit = (v?: string | null) => (v === "1" || v === "已审核" ? "已审核" : "");
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const col = createColumnHelper<AssemblyMaterialTrackingRow>();
const columns = [
  col.accessor("订购日期", { header: "订购日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
  col.accessor("订单单号", {
    header: "订单单号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("收货仓库", { header: "收货仓库", size: 7 }),
  col.accessor("加工厂编号", { header: "加工厂编号", size: 8 }),
  col.accessor("加工厂名称", { header: "加工厂名称", size: 11 }),
  col.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("产品名称", { header: "产品名称", size: 11 }),
  col.accessor("配件编号", { header: "配件编号", size: 8 }),
  col.accessor("产品装配名称", { header: "产品装配名称", size: 12 }),
  col.accessor("装配方式", { header: "装配方式", size: 9 }),
  col.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoCls } }),
  col.accessor("物料名称", { header: "物料名称", size: 12 }),
  col.accessor("规格", { header: "规格", size: 9 }),
  col.accessor("材料", { header: "材料", size: 8 }),
  col.accessor("颜色", { header: "颜色", size: 7 }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("单件用量", { header: "单件用量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("加工数量", { header: "加工数量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("需求数量", { header: "需求数量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("已入仓数量", { header: "已入仓数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("未入仓数量", { header: "未入仓数量", size: 8, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  col.accessor("审核", { header: "审核", size: 6, cell: (c) => fmtAudit(c.getValue()) }),
];

const exportCols: ExportCol[] = [
  { title: "订购日期", key: "订购日期", fmt: (v) => fmtDate(v as string) },
  { title: "订单单号", key: "订单单号" },
  { title: "收货仓库", key: "收货仓库" },
  { title: "加工厂编号", key: "加工厂编号" },
  { title: "加工厂名称", key: "加工厂名称" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "配件编号", key: "配件编号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "装配方式", key: "装配方式" },
  { title: "生产单号", key: "生产单号" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "材料" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "单件用量", key: "单件用量" },
  { title: "加工数量", key: "加工数量" },
  { title: "需求数量", key: "需求数量" },
  { title: "已入仓数量", key: "已入仓数量" },
  { title: "未入仓数量", key: "未入仓数量" },
  { title: "审核", key: "审核", fmt: (v) => fmtAudit(v as string) },
];

export default function AssemblyMaterialTrackingPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [deadline, setDeadline] = useState(false);
  const [warehouse, setWarehouse] = useState(ASSEMBLY_ALL);
  const [range, setRange] = useState<DateRange>(thisMonthRange);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const params = buildMaterialTrackingQuery({
    起: range.起,
    止: range.止,
    keyword,
    收货仓库: warehouse,
    截止统计: deadline,
  });

  const q = useQuery({
    queryKey: ["asm-mat-tracking", params],
    queryFn: () => assemblyPurchaseQueryApi.tracking(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const openOrder = (row: AssemblyMaterialTrackingRow) => {
    const path = assemblyOrderPath(row.订单单号);
    if (path) navigate(path);
  };

  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 装配物料跟踪表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">装配物料跟踪表</h1>
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
        <label className="flex h-10 items-center gap-2 text-sm text-[#3d4a5c]">
          <Checkbox
            aria-label="按第二日期截止统计"
            className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
            checked={deadline}
            onCheckedChange={(v) => setDeadline(v === true)}
          />
          按第二日期截止统计
        </label>
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
        <div className="space-y-1.5">
          <span className="f-label block">日期(订购日期)</span>
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
          <label htmlFor="amt-kw" className="f-label block">
            关键字
          </label>
          <input
            id="amt-kw"
            className="f-input"
            placeholder="订单单号 / 生产单号 / 产品货号 / 物料"
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
          onClick={() => downloadCsv("装配物料跟踪表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => printTable("装配物料跟踪表", exportCols, asRecords())}
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
        errorMessage="加载装配物料跟踪表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有跟踪记录"
        onRowDoubleClick={openOrder}
        rowTitle={(r) => (r.订单单号 ? `双击打开装配加工采购单 ${r.订单单号}` : undefined)}
        fill
        minWidth={2400}
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
