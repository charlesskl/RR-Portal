import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import {
  ArrowClockwise,
  Export,
  MagnifyingGlass,
  Package,
  Printer,
  StackIcon,
  WarningOctagon,
} from "@phosphor-icons/react";
import { inventoryApi } from "@/api/endpoints";
import type { MaterialStockRow } from "@/api/types";
import { fmtNum, txt } from "@/lib/format";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

// ---------- bento 大数字卡(玻璃 + mono 大数字;负库存红色调) ----------

function StatCard({
  icon,
  label,
  value,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "f-panel flex min-w-52 flex-1 items-center gap-4 px-5 py-4",
        danger && "border-[#dc2626]/30 bg-[#dc2626]/[0.06]",
      )}
    >
      <div
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border",
          danger
            ? "border-[#dc2626]/40 bg-[#dc2626]/10 text-[#dc2626]"
            : "border-[#16a34a]/30 bg-[#16a34a]/10 text-[#15803d]",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className={cn("f-label", danger && "text-[#dc2626]/80")}>{label}</div>
        <div
          className={cn(
            "f-mono mt-1 truncate text-[26px] leading-8 font-bold",
            danger ? "text-[#dc2626]" : "text-[#1a2330]",
          )}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

// ---------- 列 ----------

const col = createColumnHelper<MaterialStockRow>();

const columns = [
  col.accessor("物料编号", {
    header: "物料编号",
    size: 160,
    cell: (c) => (
      <span className="f-mono font-semibold text-[#1a2330]">{txt(c.getValue())}</span>
    ),
  }),
  col.accessor("货号", {
    header: "货号",
    size: 120,
    cell: (c) => <span className="block truncate" title={c.getValue()}>{txt(c.getValue())}</span>,
  }),
  col.accessor("物料名称", {
    header: "物料名称",
    size: 280,
    cell: (c) => <span className="block truncate" title={c.getValue()}>{txt(c.getValue())}</span>,
  }),
  col.accessor("规格", {
    header: "规格",
    size: 170,
    cell: (c) => <span className="block truncate" title={c.getValue()}>{txt(c.getValue())}</span>,
  }),
  col.accessor("物料类别", {
    header: "物料类别",
    size: 120,
    cell: (c) => txt(c.getValue()),
  }),
  col.accessor("单位", { header: "单位", size: 70, cell: (c) => txt(c.getValue()) }),
  col.accessor("仓库", { header: "仓库", size: 100, cell: (c) => txt(c.getValue()) }),
  col.accessor("库存数量", {
    header: "库存数量",
    size: 140,
    meta: { align: "right" },
    cell: (c) => {
      const v = c.getValue();
      return (
        <span
          className={cn(
            "f-mono block text-right text-[17px] font-bold",
            v < 0 ? "text-[#dc2626]" : "text-[#1a2330]",
          )}
        >
          {fmtNum(v, 2)}
        </span>
      );
    },
  }),
];

// 导出/打印列(与表格列一致;tableExport 场景对照老系统 web/src/__tests__/tableExport.test.ts)
const EXPORT_COLS: ExportCol[] = [
  { title: "物料编号", key: "物料编号" },
  { title: "货号", key: "货号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "物料类别", key: "物料类别" },
  { title: "单位", key: "单位" },
  { title: "仓库", key: "仓库" },
  {
    title: "库存数量",
    key: "库存数量",
    fmt: (v) => fmtNum(typeof v === "number" ? v : null, 2),
  },
];

// ---------- 页面 ----------

interface Filters {
  仓库?: string;
  物料类别?: string;
  keyword?: string;
  含零库存: boolean;
}

export default function InventoryPage() {
  const [keywordInput, setKeywordInput] = useState("");
  const [仓库, set仓库] = useState("all");
  const [类别, set类别] = useState("all");
  const [含零, set含零] = useState(false);
  const [applied, setApplied] = useState<Filters>({ 含零库存: false });

  const warehouseQuery = useQuery({
    queryKey: ["material-inventory-warehouses"],
    queryFn: () => inventoryApi.list({}),
    staleTime: 5 * 60_000,
  });
  const warehouses = useMemo(
    () =>
      Array.from(
        new Set((warehouseQuery.data ?? []).map((r) => r.仓库).filter(Boolean) as string[]),
      ).sort(),
    [warehouseQuery.data],
  );

  const catQuery = useQuery({
    queryKey: ["material-inventory-categories"],
    queryFn: () => inventoryApi.categories(),
    staleTime: 5 * 60_000,
  });

  const listQuery = useQuery({
    queryKey: ["material-inventory", applied],
    queryFn: () => inventoryApi.list(applied),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const totalQty = useMemo(() => rows.reduce((s, r) => s + (r.库存数量 ?? 0), 0), [rows]);
  const negativeCount = useMemo(() => rows.filter((r) => (r.库存数量 ?? 0) < 0).length, [rows]);

  function applyFilters() {
    const next: Filters = {
      仓库: 仓库 === "all" ? undefined : 仓库,
      物料类别: 类别 === "all" ? undefined : 类别,
      keyword: keywordInput.trim() || undefined,
      含零库存: 含零,
    };
    // 筛选条件不变时 queryKey 哈希相同,缓存未失效就不会自动重拉;
    // keep-alive 下本页常驻挂载,显式 refetch 保证「查询」一定拿到最新库存
    const unchanged =
      next.仓库 === applied.仓库 &&
      next.物料类别 === applied.物料类别 &&
      next.keyword === applied.keyword &&
      next.含零库存 === applied.含零库存;
    setApplied(next);
    if (unchanged) void listQuery.refetch();
  }

  function resetFilters() {
    setKeywordInput("");
    set仓库("all");
    set类别("all");
    set含零(false);
    setApplied({ 含零库存: false });
  }

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* 页头 + 密度切换 */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">物料库存查询</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* bento 大数字卡 */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          icon={<Package className="h-6 w-6" weight="duotone" />}
          label="物料条数"
          value={listQuery.isSuccess ? fmtNum(rows.length, 0) : "-"}
        />
        <StatCard
          icon={<StackIcon className="h-6 w-6" weight="duotone" />}
          label="库存总量"
          value={listQuery.isSuccess ? fmtNum(totalQty, 2) : "-"}
        />
        <StatCard
          icon={<WarningOctagon className="h-6 w-6" weight="duotone" />}
          label="负库存条数"
          value={listQuery.isSuccess ? fmtNum(negativeCount, 0) : "-"}
          danger={negativeCount > 0}
        />
      </div>

      {/* 筛选栏(深色玻璃) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-64 space-y-1.5">
          <label htmlFor="f-kw" className="f-label block">关键字</label>
          <input
            id="f-kw"
            className="f-input"
            placeholder="物料编号 / 名称 / 规格"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>
        <div className="w-40 space-y-1.5">
          <label className="f-label block">仓库</label>
          <SearchSelect
            ariaLabel="仓库"
            value={仓库}
            options={[
              { value: "all", label: "全部仓库" },
              ...warehouses.map((w) => ({ value: w, label: w })),
            ]}
            placeholder="全部仓库"
            onChange={set仓库}
          />
        </div>
        <div className="w-44 space-y-1.5">
          <label className="f-label block">物料类别</label>
          <SearchSelect
            ariaLabel="物料类别"
            value={类别}
            options={[
              { value: "all", label: "全部类别" },
              ...(catQuery.data ?? [])
                .filter((c) => c.类别)
                .map((c) => ({ value: c.类别!, label: `${c.类别}(${c.数量})` })),
            ]}
            placeholder="全部类别"
            onChange={set类别}
          />
        </div>
        <label className="flex h-11 cursor-pointer items-center gap-2.5 text-[15px] text-[#3d4a5c]">
          <Checkbox
            className="h-5 w-5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
            checked={含零}
            onCheckedChange={(v) => set含零(v === true)}
          />
          含零库存
        </label>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={applyFilters}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button type="button" className="f-btn px-5" onClick={resetFilters}>
          <ArrowClockwise className="h-4.5 w-4.5" />
          重置
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => {
            if (!rows.length) return;
            downloadCsv(
              "物料库存.csv",
              EXPORT_COLS,
              rows as unknown as Record<string, unknown>[],
            );
          }}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => {
            if (!rows.length) return;
            printTable(
              "物料库存查询",
              EXPORT_COLS,
              rows as unknown as Record<string, unknown>[],
            );
          }}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      {/* 表格(共享查询表:虚拟滚动 + 密度三档 + sticky 表头内置) */}
      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => listQuery.refetch()}
        errorMessage="库存数据加载失败,请重试"
        emptyIcon={<Package className="h-5 w-5" />}
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有库存记录,试试放宽条件或勾选「含零库存」"
        fill
        skeletonRows={12}
        defaultTdClass="truncate px-4 text-[#3d4a5c]"
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>
              库存合计:
              <span className="ml-1 text-[16px] font-bold text-[#15803d]">
                {fmtNum(totalQty, 2)}
              </span>
            </span>
          </>
        }
      />
    </div>
  );
}
