// 塑胶库存统计表(/plastic-inventory)。对照老系统 web/src/pages/plastics/PlasticInventoryPage.tsx:
// 左侧类别树(全部物料 + 类别(数量) 平铺两层)+ 仓库/关键字筛选;库存数量负数红;
// 已加工工序绿徽章;无「单价」位不出 单价/金额 列;底部合计(库存数量/金额);导出 CSV + 打印。
// 权限菜单=塑胶库存(MenuCatalog.cs:54 实证:塑胶报表组)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { plasticInventoryApi, plasticMaterialMasterApi } from "@/api/endpoints";
import type { PlasticStockRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "塑胶库存";
const ALL = "__ALL__"; // 类别「全部物料」key(不下发 物料类别 过滤)

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

const col = createColumnHelper<PlasticStockRow>();
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]";

// 已加工工序徽章(对照老系统 Tag color=green)
function ProcessedTag({ v }: { v?: string }) {
  if (!v) return null;
  return (
    <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
      已加工:{v}
    </span>
  );
}

function buildColumns(priceHidden: boolean): ColumnDef<PlasticStockRow, any>[] {
  return [
    col.accessor("物料编号", {
      header: "物料编号",
      size: 9,
      meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
    }),
    col.accessor("工模编号", { header: "工模编号", size: 8, meta: { tdClass: monoCls } }),
    col.accessor("物料名称", { header: "物料名称", size: 11 }),
    col.accessor("规格", { header: "规格", size: 8, meta: { tdClass: monoCls } }),
    col.accessor("颜色", { header: "颜色", size: 7, meta: { tdClass: monoCls } }),
    col.accessor("物料类别", { header: "材料", size: 6 }),
    col.accessor("塑胶货号", { header: "塑胶货号", size: 7, meta: { tdClass: monoCls } }),
    col.accessor("已加工工序", {
      header: "已加工工序",
      size: 8,
      cell: (c) => <ProcessedTag v={c.getValue()} />,
      meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
    }),
    col.accessor("仓位号", { header: "仓位号", size: 6, meta: { tdClass: monoCls } }),
    col.accessor("单位", { header: "单位", size: 4 }),
    col.accessor("仓库", { header: "仓库", size: 7 }),
    col.accessor("库存数量", {
      header: "库存数量",
      size: 7,
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
      meta: { align: "right", tdClass: "px-3 py-2 text-right whitespace-nowrap" },
    }),
    ...(priceHidden
      ? []
      : [
          col.accessor("单价", {
            header: "单价",
            size: 6,
            cell: (c) => c.getValue() ?? "",
            meta: { align: "right", tdClass: numCls },
          }),
          col.accessor("金额", {
            header: "金额",
            size: 8,
            cell: (c) => {
              const v = c.getValue();
              return v == null ? "" : Number(v).toFixed(2);
            },
            meta: { align: "right", tdClass: numCls },
          }),
        ]),
  ];
}

// 导出列(对照老系统 exportCols;价格列按权限裁剪)
function exportCols(priceHidden: boolean): ExportCol[] {
  return [
    { title: "物料编号", key: "物料编号" },
    { title: "工模编号", key: "工模编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "规格", key: "规格" },
    { title: "颜色", key: "颜色" },
    { title: "材料", key: "物料类别" },
    { title: "塑胶货号", key: "塑胶货号" },
    { title: "仓位号", key: "仓位号" },
    { title: "单位", key: "单位" },
    { title: "仓库", key: "仓库" },
    { title: "库存数量", key: "库存数量" },
    ...(priceHidden
      ? []
      : [
          { title: "单价", key: "单价" },
          { title: "金额", key: "金额" },
        ]),
  ];
}

export default function PlasticInventoryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");
  const [selKey, setSelKey] = useState(ALL);
  const [仓库, set仓库] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string }>({});

  const catsQuery = useQuery({
    queryKey: ["plastic-inventory", "categories"],
    queryFn: () => plasticMaterialMasterApi.categories(),
    enabled: canOpen && !permsLoading,
  });
  const cats = catsQuery.data ?? [];

  const stockQuery = useQuery({
    queryKey: ["plastic-inventory", "list", 仓库, selKey, applied],
    queryFn: () =>
      plasticInventoryApi.list(
        仓库.trim() || undefined,
        applied.keyword,
        selKey === ALL ? undefined : selKey,
      ),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading,
  });
  const rows = useMemo(() => stockQuery.data ?? [], [stockQuery.data]);

  const columns = useMemo(() => buildColumns(priceHidden), [priceHidden]);
  const 库存合计 = rows.reduce((s, r) => s + Number(r.库存数量 ?? 0), 0);
  const 金额合计 = rows.reduce((s, r) => s + Number(r.金额 ?? 0), 0);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶库存·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶库存统计表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左树:全部物料 + 类别(数量)(对照老系统 treeData 两层) */}
        <div className="f-panel w-52 shrink-0 overflow-auto p-3">
          {[{ key: ALL, label: "全部物料" }].map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setSelKey(n.key)}
              className={cn(
                "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selKey === n.key
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#3d4a5c] hover:bg-black/[0.04]",
              )}
            >
              {n.label}
            </button>
          ))}
          {cats.map((c) => (
            <button
              key={c.类别}
              type="button"
              onClick={() => setSelKey(c.类别 ?? "")}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2.5 py-2 pl-5 text-left text-sm transition-colors",
                selKey === c.类别
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#3d4a5c] hover:bg-black/[0.04]",
              )}
            >
              <span className="truncate">{c.类别}</span>
              <span className="f-mono text-xs text-[#5f6b7d]">({c.数量})</span>
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* 筛选栏 */}
          <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
            <div className="w-40 space-y-1.5">
              <label htmlFor="pi-wh" className="f-label block">
                仓库
              </label>
              <input
                id="pi-wh"
                className="f-input"
                placeholder="仓库"
                value={仓库}
                onChange={(e) => set仓库(e.target.value)}
              />
            </div>
            <div className="w-56 space-y-1.5">
              <label htmlFor="pi-kw" className="f-label block">
                关键字
              </label>
              <Input
                id="pi-kw"
                className={inputCls}
                placeholder="物料编号/名称/规格"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined })
                }
              />
            </div>
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
              onClick={() => downloadCsv("塑胶库存统计表.csv", exportCols(priceHidden), asRecords())}
            >
              <Export className="h-4.5 w-4.5" />
              导出EXCEL
            </button>
            <button
              type="button"
              className="f-btn px-5"
              onClick={() => printTable("塑胶库存统计表", exportCols(priceHidden), asRecords())}
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
            errorMessage="加载塑胶库存失败,请重试"
            emptyTitle="暂无数据"
            emptyDescription="当前筛选条件下没有塑胶库存"
            fill
            minWidth={1500}
            footer={
              <>
                <span>共 {rows.length} 条</span>
                <span>
                  合计:库存数量 {库存合计}
                  {!priceHidden && ` · 金额 ${金额合计.toFixed(2)}`}
                </span>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
