// 加工厂分类明细表(装配部报表群;老系统 web/src/pages/assembly/FactoryCategoryDetailPage.tsx 重写):
// 筛选(加工厂类别 + 加工厂 + 日期区间 + 关键字) + 共享查询表 + 导出/打印;底栏合计 数量/金额。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 FactoryCategoryDetailController.cs:14);
// 金额列按「单价」位脱敏(无位显示 ***,合计同步脱敏;照抄老系统 money())。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Printer, Prohibit } from "@phosphor-icons/react";
import { factoryCategoryDetailApi, factoryMasterApi } from "@/api/endpoints";
import type { FactoryCategoryDetailRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { lastMonthToToday, type DateRange } from "@/lib/assemblyReports";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "款号资料";
const ALL = "全部";

const fmtDate = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtNum = (v?: number | null) => (v == null ? "" : Number(v));
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";

const col = createColumnHelper<FactoryCategoryDetailRow>();

const exportCols: ExportCol[] = [  { title: "加工厂类别", key: "加工厂类别" },
  { title: "加工厂编号", key: "加工厂编号" },
  { title: "加工厂名称", key: "加工厂名称" },
  { title: "单据类型", key: "单据类型" },
  { title: "单号", key: "单号" },
  { title: "日期", key: "日期", fmt: (v) => fmtDate(v as string) },
  { title: "交货日期", key: "交货日期", fmt: (v) => fmtDate(v as string) },
  { title: "客户名称", key: "客户名称" },
  { title: "数量", key: "数量" },
  { title: "金额", key: "金额" },
  { title: "审核", key: "审核" },
];

export default function FactoryCategoryDetailPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");

  const [cat, setCat] = useState(ALL);
  const [factory, setFactory] = useState("");
  const [range, setRange] = useState<DateRange>(lastMonthToToday);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const catsQuery = useQuery({
    queryKey: ["factory-categories"],
    queryFn: () => factoryMasterApi.categories(),
    staleTime: 5 * 60_000,
    enabled: !permsLoading && canOpen,
  });

  const params = {
    起: range.起,
    止: range.止,
    类别: cat === ALL ? undefined : cat,
    加工厂: factory.trim() || undefined,
    keyword: keyword || undefined,
  };

  const q = useQuery({
    queryKey: ["factory-category-detail", params],
    queryFn: () => factoryCategoryDetailApi.list(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  // 金额列脱敏(照抄老系统 money():无单价位一律 ***)
  const money = (v?: number | null) => (priceHidden ? "***" : fmtNum(v));

  const columns = useMemo(
    () => [
      col.accessor("加工厂类别", { header: "加工厂类别", size: 8 }),
      col.accessor("加工厂编号", { header: "加工厂编号", size: 8 }),
      col.accessor("加工厂名称", { header: "加工厂名称", size: 11 }),
      col.accessor("单据类型", { header: "单据类型", size: 9 }),
      col.accessor("单号", {
        header: "单号",
        size: 9,
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
      }),
      col.accessor("日期", { header: "日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
      col.accessor("交货日期", { header: "交货日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
      col.accessor("客户名称", { header: "客户名称", size: 10 }),
      col.accessor("数量", { header: "数量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
      col.accessor("金额", { header: "金额", size: 8, cell: (c) => money(c.getValue()), meta: { align: "right", tdClass: numCls } }),
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priceHidden],
  );

  const sum = (k: "数量" | "金额") => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 加工厂分类明细表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">加工厂分类明细表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="space-y-1.5">
          <label className="f-label block">
            加工厂类别
          </label>
          <SearchSelect
            ariaLabel="加工厂类别"
            className="w-34"
            value={cat}
            options={[
              { value: ALL, label: ALL },
              ...(catsQuery.data ?? [])
                .map((c) => c.类别 ?? "")
                .filter((v) => v !== "")
                .map((v) => ({ value: v, label: v })),
            ]}
            onChange={(v) => setCat(v)}
          />
        </div>
        <div className="w-40 space-y-1.5">
          <label htmlFor="fcd-factory" className="f-label block">
            加工厂
          </label>
          <input
            id="fcd-factory"
            className="f-input"
            placeholder="加工厂编号/名称"
            value={factory}
            onChange={(e) => setFactory(e.target.value)}
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
        <div className="w-60 space-y-1.5">
          <label htmlFor="fcd-kw" className="f-label block">
            关键字
          </label>
          <input
            id="fcd-kw"
            className="f-input"
            placeholder="单号/客户/加工厂"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={() => setKeyword(kwInput.trim())}>
          查询
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => downloadCsv("加工厂分类明细表.csv", exportCols, asRecords())}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!rows.length}
          onClick={() => printTable("加工厂分类明细表", exportCols, asRecords())}
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
        errorMessage="加载加工厂分类明细表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有单据记录"
        fill
        minWidth={1400}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>
              合计:数量 {sum("数量")} · 金额 {priceHidden ? "***" : sum("金额")}
            </span>
          </>
        }
      />
    </div>
  );
}
