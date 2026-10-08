// 半成品共用物料表(/semi-finished-common-materials)。对照老系统
// web/src/pages/semi/SemiFinishedCommonMaterialsPage.tsx + utils/semiFinishedCommonMaterials.ts:
// 字段+关键字模糊/精确查询 + 重复内容/待操作物料/审核情况 三个下拉;服务端分页(50/页);
// 库存单价按「单价」位遮蔽 ***;导出 CSV/打印 按「打印」位且空数据禁用;
// 筛选状态 sessionStorage 持久化(双击跳装配物料设置后返回还原);
// 双击行跳 /assembly-material-setup?款号=&return=(目标已注册,走 MENU_PATHS 裁决)。
// 权限菜单=半成品共用物料表(MenuCatalog.cs:31 实证:半成品仓库组)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { semiCommonMaterialApi } from "@/api/endpoints";
import type { SemiCommonMaterialRow } from "@/api/types";
import {
  buildAssemblyMaterialDetailUrl,
  buildSemiCommonMaterialParams,
  loadSemiCommonMaterialFilters,
  maskSemiCommonMaterialPrice,
  saveSemiCommonMaterialFilters,
  type SemiCommonMaterialFilterState,
} from "@/lib/semiCommonMaterial";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { MENU_PATHS } from "@/nav/menu";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { Skeleton } from "@/components/ui/skeleton";

const MENU = "半成品共用物料表";
const PAGE_SIZE = 50;

const FIELD_OPTIONS = ["产品货号", "客户", "产品名称", "产品装配名称", "配件编号", "共用物料编号"];
const DUPLICATE_OPTIONS = ["全部", "显示重复"];
const PENDING_OPTIONS = ["全部", "待设置", "已设置"];
const AUDIT_OPTIONS = ["全部", "已审核", "未审核"];

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

function initialFilters(): SemiCommonMaterialFilterState {
  const stored = loadSemiCommonMaterialFilters();
  return {
    field: stored.field ?? "产品货号",
    keyword: stored.keyword ?? "",
    exact: stored.exact ?? false,
    duplicate: stored.duplicate ?? "全部",
    pending: stored.pending ?? "全部",
    audit: stored.audit ?? "全部",
    page: stored.page ?? 1,
    size: stored.size ?? PAGE_SIZE,
  };
}

const col = createColumnHelper<SemiCommonMaterialRow>();
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";

function buildColumns(canSeePrice: boolean): ColumnDef<SemiCommonMaterialRow, any>[] {
  return [
    col.accessor("客户", { header: "客户", size: 9 }),
    col.accessor("产品货号", { header: "产品货号", size: 11, meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" } }),
    col.accessor("产品名称", { header: "产品名称", size: 12 }),
    col.accessor("产品装配名称", { header: "产品装配名称", size: 13 }),
    col.accessor("库存单价", {
      header: "库存单价",
      size: 8,
      cell: (c) => maskSemiCommonMaterialPrice(c.getValue(), canSeePrice),
      meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]" },
    }),
    col.accessor("配件编号", { header: "配件编号", size: 10, meta: { tdClass: monoCls } }),
    col.accessor("共用物料编号", { header: "共用物料编号", size: 11, meta: { tdClass: monoCls } }),
    col.accessor("调整审核", {
      header: "调整审核",
      size: 8,
      cell: (c) =>
        c.getValue() === "已审核" ? (
          <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
            已审核
          </span>
        ) : (
          <span className="inline-flex rounded-full border border-[#b45309]/40 bg-[#b45309]/10 px-2.5 py-1 text-xs font-semibold text-[#b45309]">
            未审核
          </span>
        ),
      meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
    }),
    col.accessor("备注内容", { header: "备注内容", size: 16 }),
  ];
}

function buildExportCols(canSeePrice: boolean): ExportCol[] {
  return [
    { title: "客户", key: "客户" },
    { title: "产品货号", key: "产品货号" },
    { title: "产品名称", key: "产品名称" },
    { title: "产品装配名称", key: "产品装配名称" },
    {
      title: "库存单价",
      key: "库存单价",
      fmt: (v) =>
        String(maskSemiCommonMaterialPrice(typeof v === "number" ? v : null, canSeePrice)),
    },
    { title: "配件编号", key: "配件编号" },
    { title: "共用物料编号", key: "共用物料编号" },
    { title: "调整审核", key: "调整审核" },
    { title: "备注内容", key: "备注内容" },
  ];
}

export default function SemiCommonMaterialPage() {
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSeePrice = can(MENU, "单价");
  const canPrint = can(MENU, "打印");
  const [filters, setFilters] = useState<SemiCommonMaterialFilterState>(initialFilters);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const params = useMemo(() => buildSemiCommonMaterialParams(filters), [filters]);
  const listQuery = useQuery({
    queryKey: ["semi-common-materials", params],
    queryFn: () => semiCommonMaterialApi.list(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading,
  });
  const rows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (filters.size ?? PAGE_SIZE)));

  const updateFilter = <K extends keyof SemiCommonMaterialFilterState>(
    key: K,
    value: SemiCommonMaterialFilterState[K],
  ) => setFilters((cur) => ({ ...cur, [key]: value }));

  const runQuery = (exact: boolean) => setFilters((cur) => ({ ...cur, exact, page: 1 }));

  // 双击行:存筛选 -> 跳装配物料设置(对照老系统 onDoubleClick;目标已注册,MENU_PATHS 裁决)
  const openDetail = useCallback(
    (row: SemiCommonMaterialRow) => {
      if (!row.产品货号) {
        setToast({ text: "该记录缺少产品货号，无法打开详情", tone: "err" });
        return;
      }
      const target = buildAssemblyMaterialDetailUrl(row.产品货号);
      const base = target.split("?")[0];
      if (!MENU_PATHS.has(base)) {
        setToast({ text: "装配物料设置页未注册,暂不跳转", tone: "err" });
        return;
      }
      saveSemiCommonMaterialFilters(filters);
      navigate(target);
    },
    [filters, navigate],
  );

  const columns = useMemo(() => buildColumns(canSeePrice), [canSeePrice]);
  const exportCols = useMemo(() => buildExportCols(canSeePrice), [canSeePrice]);
  const exportDisabled = !canPrint || listQuery.isLoading || rows.length === 0;
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「半成品共用物料表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">半成品共用物料表</h1>
        <span className="text-sm text-[#15803d]">查询记录:{total}</span>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏(对照老系统两行 Space:字段/关键字/三个下拉 + 操作按钮) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-40 space-y-1.5">
          <label className="f-label block">
            查询字段
          </label>
          <SearchSelect
            ariaLabel="查询字段"
            value={filters.field ?? "产品货号"}
            options={FIELD_OPTIONS.map((f) => ({ value: f, label: f }))}
            onChange={(v) => updateFilter("field", v)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="scm-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="scm-kw"
            className={inputCls}
            placeholder="请输入关键字"
            value={filters.keyword ?? ""}
            onChange={(e) => updateFilter("keyword", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runQuery(false)}
          />
        </div>
        {[
          { id: "scm-dup", label: "重复内容", key: "duplicate" as const, options: DUPLICATE_OPTIONS },
          { id: "scm-pending", label: "待操作物料", key: "pending" as const, options: PENDING_OPTIONS },
          { id: "scm-audit", label: "审核情况", key: "audit" as const, options: AUDIT_OPTIONS },
        ].map((s) => (
          <div key={s.id} className="w-32 space-y-1.5">
            <label className="f-label block">
              {s.label}
            </label>
            <SearchSelect
              ariaLabel={s.label}
              value={filters[s.key] ?? "全部"}
              options={s.options.map((o) => ({ value: o, label: o }))}
              onChange={(v) => updateFilter(s.key, v)}
            />
          </div>
        ))}
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={() => runQuery(false)}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button type="button" className="f-btn px-5" onClick={() => runQuery(true)}>
          精确查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={exportDisabled}
          onClick={() => downloadCsv("半成品共用物料表.csv", exportCols, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={exportDisabled}
          onClick={() => printTable("半成品共用物料表", exportCols, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      {/* 表格(服务端分页;双击行跳装配物料设置;单击选中高亮,对照老系统 erp-row-selected) */}
      <SemiCommonMaterialTable
        columns={columns}
        rows={rows}
        loading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => listQuery.refetch()}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onOpen={openDetail}
      />
      {!listQuery.isLoading && !listQuery.isError && rows.length > 0 && (
        <div className="f-mono flex shrink-0 items-center justify-between rounded-b-xl border border-black/8 border-t-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>
            共 {total} 条,第 {filters.page ?? 1} / {totalPages} 页,双击行打开装配物料设置
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={(filters.page ?? 1) <= 1}
              onClick={() => updateFilter("page", (filters.page ?? 1) - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={(filters.page ?? 1) >= totalPages}
              onClick={() => updateFilter("page", (filters.page ?? 1) + 1)}
            >
              下一页
            </button>
          </span>
        </div>
      )}
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}

// 表格体(单击选中 + 双击跳详情;sticky 表头四律内置)
function SemiCommonMaterialTable({
  columns,
  rows,
  loading,
  isError,
  onRetry,
  selectedKey,
  onSelect,
  onOpen,
}: {
  columns: ColumnDef<SemiCommonMaterialRow, any>[];
  rows: SemiCommonMaterialRow[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedKey?: string;
  onSelect: (key: string) => void;
  onOpen: (row: SemiCommonMaterialRow) => void;
}) {
  // React Compiler 对 TanStack Table 的已知提示(与 QueryTable 同款),非实际问题
  // oxlint-disable-next-line react/incompatible-library
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full bg-black/5" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-6">
          <DocError message="加载半成品共用物料表失败,请重试" onRetry={onRetry} />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="暂无数据"
            description="当前筛选条件下没有半成品共用物料"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table data-freeze className="w-full min-w-[1250px] text-[15px]">
            <thead className="sticky top-0 z-10 border-b border-black/8 bg-white">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={cn(
                        "f-label px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                        h.column.columnDef.meta?.align === "right" && "text-right",
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]",
                    selectedKey === r.original.产品货号 && "bg-[#16a34a]/8",
                  )}
                  title={
                    r.original.产品货号 ? `双击打开装配物料设置 ${r.original.产品货号}` : undefined
                  }
                  onClick={() => onSelect(r.original.产品货号)}
                  onDoubleClick={() => onOpen(r.original)}
                >
                  {r.getVisibleCells().map((c) => (
                    <td
                      key={c.id}
                      className={c.column.columnDef.meta?.tdClass ?? "px-3 py-2 text-[#3d4a5c]"}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
