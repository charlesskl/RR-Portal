// 原料采购分析表(/plastic-raw-material-purchase-analysis)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialPurchaseAnalysisPage.tsx:
// 类别下拉(塑胶原料类别) + 关键字 + 「只看可购」;可购数量>0 红;导出 CSV + 打印。
// 权限菜单=原料采购分析表(MenuCatalog.cs:68 实证:原料仓库组)。
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit, ShoppingCart } from "@phosphor-icons/react";
import { plasticRawMaterialMasterApi, rawPurchaseAnalysisApi } from "@/api/endpoints";
import type { RawPurchaseAnalysisRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";
import RawPurchaseGenerateDialog from "@/pages/RawPurchaseGenerateDialog";

const MENU = "原料采购分析表";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const col = createColumnHelper<RawPurchaseAnalysisRow>();

const columns: ColumnDef<RawPurchaseAnalysisRow, any>[] = [
  col.accessor("原料编号", {
    header: "原料编号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("原料名称", { header: "原料名称", size: 12 }),
  col.accessor("规格", { header: "规格", size: 8 }),
  col.accessor("物料类别", { header: "物料类别", size: 8 }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("当前库存", {
    header: "当前库存",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("安全库存", {
    header: "安全库存",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("生产需求", {
    header: "生产需求(KG)",
    size: 8,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("在途数量", {
    header: "在途未到",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("可购数量", {
    header: "可购数量",
    size: 8,
    // 可购数量>0 红(对照老系统 render)
    cell: (c) => (
      <span
        className={cn("f-mono", Number(c.getValue()) > 0 ? "text-[#dc2626]" : "text-[#1a2330]")}
      >
        {c.getValue() ?? ""}
      </span>
    ),
    meta: { align: "right", tdClass: numCls },
  }),
];

// 导出列(对照老系统 exportCols 逐字)
const EXPORT_COLS: ExportCol[] = [
  { title: "原料编号", key: "原料编号" },
  { title: "原料名称", key: "原料名称" },
  { title: "规格", key: "规格" },
  { title: "物料类别", key: "物料类别" },
  { title: "单位", key: "单位" },
  { title: "当前库存", key: "当前库存" },
  { title: "安全库存", key: "安全库存" },
  { title: "生产需求(KG)", key: "生产需求" },
  { title: "在途未到", key: "在途数量" },
  { title: "可购数量", key: "可购数量" },
];

export default function PlasticRawMaterialPurchaseAnalysisPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canGenPo = can("原料采购订单", "保存");
  const navigate = useNavigate();
  const [cat, setCat] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [onlyBuy, setOnlyBuy] = useState(false);
  const [applied, setApplied] = useState<{ keyword?: string }>({});
  const [genOpen, setGenOpen] = useState(false);

  const catsQuery = useQuery({
    queryKey: ["raw-purchase-analysis", "categories"],
    queryFn: () => plasticRawMaterialMasterApi.categories(),
    enabled: canOpen && !permsLoading,
  });
  const cats = catsQuery.data ?? [];

  const analysisQuery = useQuery({
    queryKey: ["raw-purchase-analysis", "list", cat, onlyBuy, applied],
    queryFn: () =>
      rawPurchaseAnalysisApi.list({
        物料类别: cat || undefined,
        keyword: applied.keyword,
        onlyBuy,
      }),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading,
  });
  const rows = useMemo(() => analysisQuery.data ?? [], [analysisQuery.data]);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料采购分析表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">原料采购分析表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-44 space-y-1.5">
          <label className="f-label block">物料类别</label>
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
          <label htmlFor="rpa-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="rpa-kw"
            className={inputCls}
            placeholder="原料编号/名称"
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
            checked={onlyBuy}
            onCheckedChange={(v) => setOnlyBuy(v === true)}
          />
          只看可购
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
          onClick={() => downloadCsv("原料采购分析表.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("原料采购分析表", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        {canGenPo && (
          <button
            type="button"
            className="f-btn f-btn-cyan px-5"
            disabled={rows.length === 0}
            onClick={() => setGenOpen(true)}
          >
            <ShoppingCart className="h-4.5 w-4.5" />
            生成采购单
          </button>
        )}
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={analysisQuery.isLoading}
        isError={analysisQuery.isError}
        onRetry={() => analysisQuery.refetch()}
        errorMessage="加载原料采购分析表失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有原料采购分析数据"
        fill
        minWidth={1100}
        footer={<span>共 {rows.length} 条</span>}
      />

      {genOpen && (
        <RawPurchaseGenerateDialog
          open
          rows={rows}
          onClose={() => setGenOpen(false)}
          onDone={(单号) => {
            setGenOpen(false);
            navigate(`/plastic-raw-material-purchase-order?open=${encodeURIComponent(单号)}`);
          }}
        />
      )}
    </div>
  );
}
