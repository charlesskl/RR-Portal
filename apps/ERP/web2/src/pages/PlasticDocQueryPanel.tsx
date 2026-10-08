// 塑胶退仓查询/塑胶报废查询 共享查询页签(两查询后端同构,配置化收敛;
// 对照老系统 web/src/pages/plastics/PlasticWarehouseReturnQueryPage.tsx + PlasticScrapQueryPage.tsx):
// 明细/汇总双页签;筛选=上/本/下月+起止+审核情况+物料类别+关键字;导出 CSV/打印(列规格逐字对照);
// 双击明细行弹单据详情(单头描述+明细表,对照老系统 DetailDrawer)。
// 权限菜单=各自「塑胶退仓查询」/「塑胶报废查询」(MenuCatalog.cs:66/63 实证);无「单价」位不出价格列。
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { plasticMaterialMasterApi } from "@/api/endpoints";
import type { DocQueryParams, PlasticReceiptDetail } from "@/api/types";
import {
  ALL_APPROVAL,
  ALL_CAT,
  buildDocQuery,
  monthRange,
  thisMonthRange,
} from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";

// 查询列规格:kind 驱动单元格渲染(date 取前 10 位;doc=单号绿 mono;money=2 位小数;audit=审核徽章)
export interface PlasticQueryCol {
  title: string;
  key: string;
  kind?: "text" | "mono" | "doc" | "date" | "num" | "money" | "audit";
  size?: number;
}

export interface PlasticDocQueryCfg {
  queryKey: string; // 查询缓存前缀
  menu: string; // 查询权限菜单
  title: string; // 页签标题(塑胶退仓查询/塑胶报废查询)
  keywordPlaceholder: string;
  fetchDetail: (q: DocQueryParams) => Promise<Record<string, unknown>[]>;
  fetchSummary: (q: DocQueryParams) => Promise<Record<string, unknown>[]>;
  detailCols: (priceHidden: boolean) => PlasticQueryCol[];
  summaryCols: (priceHidden: boolean) => PlasticQueryCol[];
  // 单据详情弹窗(双击明细行)
  drawerTitle: string; // 塑胶退仓单/塑胶报废单
  fetchDoc: (单号: string) => Promise<PlasticReceiptDetail>;
  drawerHead: [string, string][]; // [标签, 单头键]
  drawerCols: (priceHidden: boolean) => PlasticQueryCol[];
  // 以下为 Batch 7 原料仓查询的可选扩展(不传保持原行为):
  defaultTab?: "detail" | "summary"; // 默认页签(老系统原料仓查询默认「汇总查询」)
  fetchCategories?: () => Promise<{ 类别?: string; 数量: number }[]>; // 类别数据源(默认塑胶物料;原料仓查询=塑胶原料)
  // 额外筛选(原料出库查询的 领料备注/制单人):node 渲染控件,params 并入查询参数(即时生效,同 审核/类别)
  extras?: {
    node: (vals: Record<string, string>, set: (k: string, v: string) => void) => ReactNode;
    params: (vals: Record<string, string>) => Record<string, unknown>;
  };
}

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]";
const fix2 = (v: unknown) => (v == null || v === "" ? "" : Number(v).toFixed(2));

function AuditText({ v }: { v: unknown }) {
  return v === "1" ? (
    <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
      已审核
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
      未审核
    </span>
  );
}

// 列规格 -> QueryTable 列(size=宽度权重)
function toTableCols(specs: PlasticQueryCol[]): ColumnDef<Record<string, unknown>, any>[] {
  const col = createColumnHelper<Record<string, unknown>>();
  return specs.map((s) =>
    col.accessor((r) => r[s.key], {
      id: s.key,
      header: s.title,
      size: s.size ?? 8,
      cell: (c) => {
        const v = c.getValue();
        switch (s.kind) {
          case "date":
            return String(v ?? "").slice(0, 10);
          case "money":
            return fix2(v);
          case "num":
            return v == null ? "" : String(v);
          case "audit":
            return <AuditText v={v} />;
          default:
            return v == null ? "" : String(v);
        }
      },
      meta: {
        align: s.kind === "num" || s.kind === "money" ? "right" : undefined,
        tdClass:
          s.kind === "doc"
            ? "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]"
            : s.kind === "mono" || s.kind === "date"
              ? monoCls
              : s.kind === "num" || s.kind === "money"
                ? numCls
                : "px-3 py-2 text-[#3d4a5c]",
      },
    }),
  );
}

// 列规格 -> 导出列(对照老系统 exportNow:日期截断/审核映射/money 2 位)
function toExportCols(specs: PlasticQueryCol[]): ExportCol[] {
  return specs.map((s) => ({
    title: s.title,
    key: s.key,
    fmt:
      s.kind === "date"
        ? (v) => String(v ?? "").slice(0, 10)
        : s.kind === "audit"
          ? (v) => (v === "1" ? "已审核" : "未审核")
          : s.kind === "money"
            ? (v) => fix2(v)
            : undefined,
  }));
}

// 单据详情弹窗(对照老系统 DetailDrawer:单头 Descriptions + 明细表)
function DocDetailDialog({
  cfg,
  单号,
  priceHidden,
  onClose,
}: {
  cfg: PlasticDocQueryCfg;
  单号: string;
  priceHidden: boolean;
  onClose: () => void;
}) {
  const docQuery = useQuery({
    queryKey: [cfg.queryKey, "doc", 单号],
    queryFn: () => cfg.fetchDoc(单号),
  });
  const head = (docQuery.data?.单头 ?? null) as Record<string, unknown> | null;
  const lines = (docQuery.data?.明细 ?? []) as unknown as Record<string, unknown>[];
  const cols = cfg.drawerCols(priceHidden);

  return (
    <PickerDialog
      open
      onClose={onClose}
      title={`${cfg.drawerTitle} ${单号}`}
      width="sm:max-w-[960px]"
    >
      {docQuery.isLoading ? (
        <div className="py-6 text-center text-sm text-[#5f6b7d]">加载中...</div>
      ) : docQuery.isError ? (
        <div className="py-6 text-center text-sm text-[#dc2626]">单据加载失败</div>
      ) : (
        <>
          {head && (
            <div className="mb-4 grid grid-cols-3 gap-x-6 gap-y-2 rounded-xl border border-black/8 bg-black/[0.02] p-4 text-sm">
              {cfg.drawerHead.map(([label, key]) => (
                <div key={key} className="flex gap-2">
                  <span className="shrink-0 text-[#5f6b7d]">{label}</span>
                  <span className="f-mono min-w-0 truncate text-[#1a2330]">
                    {key === "审核" ? (
                      <AuditText v={head[key]} />
                    ) : key === "日期" ? (
                      String(head[key] ?? "").slice(0, 10)
                    ) : (
                      String(head[key] ?? "")
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      pickerThCls,
                      (c.kind === "num" || c.kind === "money") && "text-right",
                    )}
                  >
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={String(l.ID ?? l.id ?? i)} className="border-b border-black/6 last:border-0">
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2 text-[#3d4a5c]",
                        c.kind === "mono" || c.kind === "doc"
                          ? "f-mono whitespace-nowrap"
                          : "",
                        (c.kind === "num" || c.kind === "money") && "f-mono text-right",
                      )}
                    >
                      {c.kind === "money" ? fix2(l[c.key]) : String(l[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="px-3 py-4 text-center text-sm text-disabled">
                    无明细
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </PickerDialog>
  );
}

export function PlasticDocQueryPanel({ cfg }: { cfg: PlasticDocQueryCfg }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(cfg.menu, "打开");
  const priceHidden = !can(cfg.menu, "单价");
  const [tab, setTab] = useState<"detail" | "summary">(cfg.defaultTab ?? "detail");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);
  const [selCat, setSelCat] = useState(ALL_CAT);
  const [kwInput, setKwInput] = useState("");
  const [appliedKw, setAppliedKw] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const [extraVals, setExtraVals] = useState<Record<string, string>>({});
  const setExtra = (k: string, v: string) => setExtraVals((m) => ({ ...m, [k]: v }));

  const catsQuery = useQuery({
    queryKey: [cfg.queryKey, "categories"],
    queryFn: () => (cfg.fetchCategories ?? plasticMaterialMasterApi.categories)(),
    enabled: canOpen && !permsLoading,
  });
  const cats = catsQuery.data ?? [];

  const query: DocQueryParams = useMemo(
    () =>
      ({
        ...buildDocQuery({
          keyword: appliedKw,
          类别: selCat,
          审核情况,
          起: range.起,
          止: range.止,
        }),
        ...cfg.extras?.params(extraVals),
      }) as DocQueryParams,
    [appliedKw, selCat, 审核情况, range, cfg, extraVals],
  );

  const dataQuery = useQuery({
    queryKey: [cfg.queryKey, tab, query, extraVals],
    queryFn: () => (tab === "detail" ? cfg.fetchDetail(query) : cfg.fetchSummary(query)),
    enabled: canOpen && !permsLoading && !!query.起 && !!query.止,
  });
  const rows = useMemo(() => dataQuery.data ?? [], [dataQuery.data]);

  const detailSpecs = useMemo(() => cfg.detailCols(priceHidden), [cfg, priceHidden]);
  const summarySpecs = useMemo(() => cfg.summaryCols(priceHidden), [cfg, priceHidden]);
  const specs = tab === "detail" ? detailSpecs : summarySpecs;
  const columns = useMemo(() => toTableCols(specs), [specs]);

  const exportNow = (action: "csv" | "print") => {
    const cols = toExportCols(specs);
    const name = tab === "detail" ? `${cfg.title}-明细` : `${cfg.title}-汇总`;
    if (action === "csv") downloadCsv(`${name}.csv`, cols, rows);
    else printTable(name, cols, rows);
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="f-panel p-6">
        <DocEmpty
          icon={<Prohibit className="h-5 w-5" />}
          title={`无权访问 ${cfg.title}`}
          description={`缺少「${cfg.menu}·打开」权限,请联系管理员开通`}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 筛选栏(对照老系统:上/本/下月 + 起止 + 审核情况 + 物料类别 + 关键字 + 导出/打印) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { label: "明细查询", key: "detail" as const },
            { label: "汇总查询", key: "summary" as const },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                tab === t.key
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { label: "上月", off: -1 },
            { label: "本月", off: 0 },
            { label: "下月", off: 1 },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              className="h-9 rounded-lg px-4 text-sm text-[#5f6b7d] transition-colors hover:text-[#3d4a5c]"
              onClick={() => setRange(monthRange(b.off))}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <span className="f-label block">日期区间</span>
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
        <div className="w-32 space-y-1.5">
          <label className="f-label block">审核情况</label>
          <SearchSelect
            ariaLabel="审核情况"
            value={审核情况}
            options={[ALL_APPROVAL, "已审核", "未审核"].map((v) => ({
              value: v,
              label: v === ALL_APPROVAL ? "审核:全部" : v,
            }))}
            onChange={(v) => set审核情况(v)}
          />
        </div>
        <div className="w-40 space-y-1.5">
          <label className="f-label block">物料类别</label>
          <SearchSelect
            ariaLabel="物料类别"
            value={selCat}
            options={[
              { value: ALL_CAT, label: "所有类别" },
              ...cats.map((c) => ({ value: c.类别 ?? "", label: `${c.类别}(${c.数量})` })),
            ]}
            onChange={(v) => setSelCat(v)}
          />
        </div>
        {cfg.extras?.node(extraVals, setExtra)}
        <div className="w-56 space-y-1.5">
          <label htmlFor={`${cfg.queryKey}-kw`} className="f-label block">
            关键字
          </label>
          <Input
            id={`${cfg.queryKey}-kw`}
            className={inputCls}
            placeholder={cfg.keywordPlaceholder}
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setAppliedKw(kwInput.trim() || undefined)}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setAppliedKw(kwInput.trim() || undefined)}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button type="button" className="f-btn px-5" onClick={() => exportNow("csv")}>
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button type="button" className="f-btn px-5" onClick={() => exportNow("print")}>
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        <DensitySwitch className="ml-auto" />
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={dataQuery.isLoading}
        isError={dataQuery.isError}
        onRetry={() => dataQuery.refetch()}
        errorMessage={`加载${cfg.title}失败,请重试`}
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有单据"
        fill
        minWidth={tab === "detail" ? 1900 : 1100}
        onRowDoubleClick={
          tab === "detail" ? (r) => r.单号 && setViewing(String(r.单号)) : undefined
        }
        rowTitle={
          tab === "detail" ? (r) => (r.单号 ? `双击打开${cfg.drawerTitle} ${r.单号}` : undefined) : undefined
        }
        footer={
          <>
            <span>共 {rows.length} 条</span>
            {tab === "detail" && <span>双击明细行可打开{cfg.drawerTitle}</span>}
          </>
        }
      />

      {viewing !== undefined && (
        <DocDetailDialog
          cfg={cfg}
          单号={viewing}
          priceHidden={priceHidden}
          onClose={() => setViewing(undefined)}
        />
      )}
    </div>
  );
}
