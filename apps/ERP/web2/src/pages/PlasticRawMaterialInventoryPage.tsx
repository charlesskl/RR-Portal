// 原料库存统计表(/plastic-raw-material-inventory)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialInventoryPage.tsx:
// 类别下拉(塑胶原料类别)/关键字/「只显示库存数」+「零库存」复选(零库存勾选时禁用只显示库存数,
// displayMode: zero/stock/all);库存数量负数红;底部合计;导出 CSV + 打印。
// 权限菜单=原料库存统计表(MenuCatalog.cs:75 实证:原料报表组)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { plasticRawMaterialMasterApi, rawMaterialReportApi } from "@/api/endpoints";
import type { RawMaterialInventoryRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "原料库存统计表";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const col = createColumnHelper<RawMaterialInventoryRow>();

const columns: ColumnDef<RawMaterialInventoryRow, any>[] = [
  col.accessor("原料编号", {
    header: "原料编号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("原料名称", { header: "原料名称", size: 13 }),
  col.accessor("产地", { header: "产地", size: 8 }),
  col.accessor("每包重量", {
    header: "每包重量",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("物料类别", { header: "物料类别", size: 7 }),
  col.accessor("库存数量", {
    header: "库存数量",
    size: 8,
    cell: (c) => (
      <span
        className={cn(
          "f-mono font-semibold",
          Number(c.getValue()) < 0 ? "text-[#dc2626]" : "text-[#1a2330]",
        )}
      >
        {c.getValue()}
      </span>
    ),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap" },
  }),
];

// 导出列(对照老系统 exportCols 逐字)
const EXPORT_COLS: ExportCol[] = [
  { title: "原料编号", key: "原料编号" },
  { title: "原料名称", key: "原料名称" },
  { title: "产地", key: "产地" },
  { title: "每包重量", key: "每包重量" },
  { title: "单位", key: "单位" },
  { title: "物料类别", key: "物料类别" },
  { title: "库存数量", key: "库存数量" },
];

export default function PlasticRawMaterialInventoryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [cat, setCat] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [onlyStock, setOnlyStock] = useState(true);
  const [onlyZero, setOnlyZero] = useState(false);
  const [applied, setApplied] = useState<{ keyword?: string }>({});

  const catsQuery = useQuery({
    queryKey: ["raw-inventory", "categories"],
    queryFn: () => plasticRawMaterialMasterApi.categories(),
    enabled: canOpen && !permsLoading,
  });
  const cats = catsQuery.data ?? [];

  // displayMode 口径对照老系统:零库存优先,其次只显示库存数,否则全部
  const displayMode = onlyZero ? "zero" : onlyStock ? "stock" : "all";
  const stockQuery = useQuery({
    queryKey: ["raw-inventory", "list", cat, displayMode, applied],
    queryFn: () =>
      rawMaterialReportApi.inventory(cat || undefined, applied.keyword, displayMode),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading,
  });
  const rows = useMemo(() => stockQuery.data ?? [], [stockQuery.data]);
  const totalStock = rows.reduce((s, r) => s + Number(r.库存数量 ?? 0), 0);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料库存统计表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">原料库存统计表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-44 space-y-1.5">
          <label className="f-label block">
            物料类别
          </label>
          <SearchSelect
            ariaLabel="物料类别"
            value={cat}
            options={cats
              .filter((x) => x.类别)
              .map((x) => ({ value: x.类别!, label: `${x.类别}(${x.数量})` }))}
            placeholder="全部类别"
            clearLabel="全部类别"
            onChange={(v) => setCat(v)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="rmi-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="rmi-kw"
            className={inputCls}
            placeholder="原料编号/名称/产地"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined })
            }
          />
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2.5 text-[15px] text-[#3d4a5c]">
          <Checkbox
            className="h-5 w-5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
            checked={onlyStock}
            disabled={onlyZero}
            onCheckedChange={(v) => setOnlyStock(v === true)}
          />
          只显示库存数
        </label>
        <label className="flex h-10 cursor-pointer items-center gap-2.5 text-[15px] text-[#3d4a5c]">
          <Checkbox
            className="h-5 w-5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
            checked={onlyZero}
            onCheckedChange={(v) => setOnlyZero(v === true)}
          />
          零库存
        </label>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setApplied({ keyword: kwInput.trim() || undefined })}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => downloadCsv("原料库存统计表.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("原料库存统计表", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={stockQuery.isLoading}
        isError={stockQuery.isError}
        onRetry={() => stockQuery.refetch()}
        errorMessage="加载原料库存统计表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有原料库存"
        fill
        minWidth={1000}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>合计:库存数量 {totalStock}</span>
          </>
        }
      />
    </div>
  );
}
