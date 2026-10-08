// 半成品仓单据查询页签共享件(入仓/出库/报废/盘点/标签 5 个查询同构,配置化收敛;
// 对照老系统 web/src/pages/warehouse/Semi*QueryPage.tsx):
// 汇总/明细双页签;上/本/下月 + 起止日期 + 字段+关键字(模糊/精确);汇总侧 物料查询(共用物料)
// + 按供应商/按装配采购单号/按领料备注 汇总开关(按页配置);明细侧 审核情况(+制单人);
// 出库查询另有 领料备注 下拉(两页签共用);导出 CSV + 打印(列规格逐字对照老 exportExcel);
// 双击明细行回单据页签打开整单(=旧版 ?open= 跳入);汇总底栏合计(总合计/盈亏合计)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import type { SemiQueryParams } from "@/api/types";
import { monthRange, shiftDayRange, thisMonthRange, todayRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { DocEmpty } from "@/components/doc/DocEmpty";

export interface SemiQueryCol {
  title: string;
  key: string;
  kind?: "text" | "mono" | "doc" | "date" | "num" | "signed" | "audit";
  size?: number;
}

export interface SemiDocQueryCfg {
  queryKey: string;
  menu: string; // 权限菜单(与单据同菜单,后端同控制器鉴权)
  title: string; // 查询页签名(如 半成品入仓查询)
  docTitle: string; // 双击行提示中的单据名(如 半成品入仓单)
  fields: string[]; // 「请选择条件」字段下拉
  defaultField: string;
  fetchSummary: (q: SemiQueryParams) => Promise<Record<string, unknown>[]>;
  fetchDetail: (q: SemiQueryParams) => Promise<Record<string, unknown>[]>;
  summaryCols: SemiQueryCol[] | ((extra: boolean) => SemiQueryCol[]);
  detailCols: SemiQueryCol[];
  exportSummary: { name: string; cols: string[] };
  exportDetail: { name: string; cols: string[] };
  materialOnlyLabel?: string; // 汇总物料查询复选框文案,默认 物料查询(共用物料)
  materialOnlyScope?: "summary" | "always"; // 物料查询复选框显示范围(出库/盘点查询两页签都显示),默认仅汇总页签
  // 汇总附加开关:bySupplier(汇总按供应商,多带供应商列)/byOrderNo(按装配采购单号)/byIssueRemark(按领料备注)
  summaryBy?: { key: "bySupplier" | "byOrderNo" | "byIssueRemark"; label: string; defaultOn?: boolean; extraCol?: SemiQueryCol };
  customerFilter?: boolean; // 客户下拉(成品入仓查询,两页签共用;选项从已加载行累计去重)
  remarkFilter?: boolean; // 领料备注下拉(出库查询,两页签共用)
  makerFilter?: boolean; // 制单人下拉(出库查询明细页签)
  totalKey?: string; // 汇总合计字段(入仓数量/领料数量/报废数量/盈亏数)
  totalLabel?: string; // 总合计/盈亏合计;不传则不出合计
  totalKey2?: string; // 第二合计字段(成品入仓查询的 入仓箱数)
  totalLabel2?: string;
  autoReload?: boolean; // 30s 轮询 + 聚焦刷新(对照老系统 useAutoReload,仅出库查询有)
  dayShift?: boolean; // 日级跳转按钮 上一天/今天/下一天(对照老系统 FinishedReceiptQueryPage,仅成品入仓查询有)
}

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]";

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

function toTableCols(specs: SemiQueryCol[]): ColumnDef<Record<string, unknown>, any>[] {
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
          case "num":
            return v == null || v === "" ? "" : Number(v).toLocaleString();
          case "signed": {
            const n = Number(v ?? 0);
            return (
              <span className={n < 0 ? "text-[#dc2626]" : n > 0 ? "text-[#15803d]" : undefined}>
                {n.toLocaleString()}
              </span>
            );
          }
          case "audit":
            return <AuditText v={v} />;
          default:
            return v == null ? "" : String(v);
        }
      },
      meta: {
        align: s.kind === "num" || s.kind === "signed" ? "right" : undefined,
        tdClass:
          s.kind === "doc"
            ? "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]"
            : s.kind === "mono" || s.kind === "date"
              ? monoCls
              : s.kind === "num" || s.kind === "signed"
                ? numCls
                : "px-3 py-2 text-[#3d4a5c]",
      },
    }),
  );
}

function toExportCols(keys: string[], specs: SemiQueryCol[]): ExportCol[] {
  return keys.map((key) => {
    const s = specs.find((x) => x.key === key);
    return {
      title: s?.title ?? key,
      key,
      fmt:
        s?.kind === "date"
          ? (v) => String(v ?? "").slice(0, 10)
          : s?.kind === "audit"
            ? (v) => (v === "1" ? "已审核" : "未审核")
            : undefined,
    };
  });
}

export function SemiDocQueryPanel({
  cfg,
  onOpenDoc,
}: {
  cfg: SemiDocQueryCfg;
  onOpenDoc: (单号: string) => void;
}) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(cfg.menu, "打开");
  const [tab, setTab] = useState<"summary" | "detail">("summary");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [field, setField] = useState(cfg.defaultField);
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string; exact: boolean }>({ exact: false });
  const [materialOnly, setMaterialOnly] = useState(true);
  const [byExtra, setByExtra] = useState(cfg.summaryBy?.defaultOn ?? false);
  const [审核, set审核] = useState("");
  const [客户, set客户] = useState("");
  const [领料备注, set领料备注] = useState("");
  const [制单人, set制单人] = useState("");

  const params: SemiQueryParams = useMemo(
    () => ({
      起日期: range.起,
      止日期: range.止,
      field,
      keyword: applied.keyword,
      exact: applied.exact,
      materialOnly,
      审核: tab === "detail" ? 审核 || undefined : undefined,
      客户: cfg.customerFilter ? 客户 || undefined : undefined,
      领料备注: cfg.remarkFilter ? 领料备注 || undefined : undefined,
      制单人: cfg.makerFilter && tab === "detail" ? 制单人 || undefined : undefined,
      ...(cfg.summaryBy && tab === "summary" ? { [cfg.summaryBy.key]: byExtra } : {}),
    }),
    [range, field, applied, materialOnly, 审核, 客户, 领料备注, 制单人, tab, byExtra, cfg],
  );

  const dataQuery = useQuery({
    queryKey: [cfg.queryKey, tab, params],
    queryFn: () => (tab === "summary" ? cfg.fetchSummary(params) : cfg.fetchDetail(params)),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !!range.起 && !!range.止,
    refetchInterval: cfg.autoReload ? 30_000 : false,
    refetchOnWindowFocus: cfg.autoReload ?? false,
  });
  const rows = useMemo(() => dataQuery.data ?? [], [dataQuery.data]);

  // 出库查询:领料备注/制单人 下拉选项从已加载行去重(对照老系统 opt())
  const remarkOpts = useMemo(() => {
    if (!cfg.remarkFilter) return [];
    const s = new Set<string>();
    rows.forEach((r) => r.领料备注 && s.add(String(r.领料备注)));
    if (领料备注) s.add(领料备注);
    return [...s];
  }, [cfg.remarkFilter, rows, 领料备注]);
  // 成品入仓查询:客户下拉选项跨页签累计(对照老系统 custOpts 取 summary+detail 两端已加载行);
  // 渲染期比对前次 rows 集累计(同 SemiProductPickerDialog 的 open 重置写法,避免 effect 内 setState)
  const [seenCustomers, setSeenCustomers] = useState<Set<string>>(new Set());
  const [prevRows, setPrevRows] = useState<Record<string, unknown>[]>([]);
  if (cfg.customerFilter && prevRows !== rows) {
    setPrevRows(rows);
    const next = new Set(seenCustomers);
    rows.forEach((r) => r.客户 && next.add(String(r.客户)));
    setSeenCustomers(next);
  }
  const custOpts = useMemo(() => {
    const s = new Set(seenCustomers);
    if (客户) s.add(客户);
    return [...s];
  }, [seenCustomers, 客户]);
  const makerOpts = useMemo(() => {
    if (!cfg.makerFilter) return [];
    const s = new Set<string>();
    rows.forEach((r) => r.制单人 && s.add(String(r.制单人)));
    if (制单人) s.add(制单人);
    return [...s];
  }, [cfg.makerFilter, rows, 制单人]);

  const summarySpecs = useMemo(
    () =>
      typeof cfg.summaryCols === "function"
        ? cfg.summaryCols(byExtra)
        : cfg.summaryBy?.extraCol && byExtra
          ? [cfg.summaryCols[0], cfg.summaryBy.extraCol, ...cfg.summaryCols.slice(1)]
          : cfg.summaryCols,
    [cfg, byExtra],
  );
  const specs = tab === "summary" ? summarySpecs : cfg.detailCols;
  const columns = useMemo(() => toTableCols(specs), [specs]);

  const total =
    cfg.totalKey && tab === "summary"
      ? rows.reduce((s, r) => s + Number(r[cfg.totalKey!] ?? 0), 0)
      : null;
  const total2 =
    cfg.totalKey2 && tab === "summary"
      ? rows.reduce((s, r) => s + Number(r[cfg.totalKey2!] ?? 0), 0)
      : null;

  const exportNow = (action: "csv" | "print") => {
    if (rows.length === 0) return;
    const spec = tab === "summary" ? cfg.exportSummary : cfg.exportDetail;
    const cols = toExportCols(spec.cols, specs);
    if (action === "csv") downloadCsv(`${spec.name}.csv`, cols, rows);
    else printTable(spec.name, cols, rows);
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="f-panel p-6">
        <DocEmpty
          icon={<Prohibit className="h-5 w-5" />}
          title={`无权访问${cfg.title}`}
          description={`缺少「${cfg.menu}·打开」权限,请联系管理员开通`}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 筛选栏(对照老系统:上/本/下月 + 起止 + 字段 + 关键字 + 模糊/精确 + 各页开关) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
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
        {cfg.dayShift && (
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { label: "上一天", off: -1 },
              { label: "今天", off: null },
              { label: "下一天", off: 1 },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                className="h-9 rounded-lg px-4 text-sm text-[#5f6b7d] transition-colors hover:text-[#3d4a5c]"
                onClick={() => setRange((r) => (b.off === null ? todayRange() : shiftDayRange(r.起, b.off)))}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
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
        <div className="w-36 space-y-1.5">
          <label className="f-label block">请选择条件</label>
          <SearchSelect
            ariaLabel="请选择条件"
            value={field}
            options={cfg.fields.map((f) => ({ value: f, label: f }))}
            onChange={(v) => setField(v)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor={`${cfg.queryKey}-kw`} className="f-label block">
            关键字
          </label>
          <Input
            id={`${cfg.queryKey}-kw`}
            className={inputCls}
            placeholder="输入查询内容"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined, exact: false })
            }
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setApplied({ keyword: kwInput.trim() || undefined, exact: false })}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => setApplied({ keyword: kwInput.trim() || undefined, exact: true })}
        >
          精确查询
        </button>
        {cfg.customerFilter && (
          <div className="w-32 space-y-1.5">
            <label className="f-label block">客户</label>
            <SearchSelect
              ariaLabel="客户"
              value={客户}
              options={custOpts.map((v) => ({ value: v, label: v }))}
              placeholder="全部"
              clearLabel="全部"
              onChange={(v) => set客户(v)}
            />
          </div>
        )}
        {cfg.remarkFilter && (
          <div className="w-32 space-y-1.5">
            <label className="f-label block">领料备注</label>
            <SearchSelect
              ariaLabel="领料备注"
              value={领料备注}
              options={remarkOpts.map((v) => ({ value: v, label: v }))}
              placeholder="全部"
              clearLabel="全部"
              onChange={(v) => set领料备注(v)}
            />
          </div>
        )}
        {(cfg.materialOnlyScope === "always" || tab === "summary") && (
          <label className="flex h-10 items-center gap-2 text-sm text-[#3d4a5c]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#16a34a]"
              checked={materialOnly}
              onChange={(e) => setMaterialOnly(e.target.checked)}
            />
            {cfg.materialOnlyLabel ?? "物料查询(共用物料)"}
          </label>
        )}
        {tab === "summary" && cfg.summaryBy && (
          <label className="flex h-10 items-center gap-2 text-sm text-[#3d4a5c]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#16a34a]"
              checked={byExtra}
              onChange={(e) => setByExtra(e.target.checked)}
            />
            {cfg.summaryBy.label}
          </label>
        )}
        {tab === "detail" && cfg.makerFilter && (
          <div className="w-32 space-y-1.5">
            <label className="f-label block">制单人</label>
            <SearchSelect
              ariaLabel="制单人"
              value={制单人}
              options={makerOpts.map((v) => ({ value: v, label: v }))}
              placeholder="全部"
              clearLabel="全部"
              onChange={(v) => set制单人(v)}
            />
          </div>
        )}
        {tab === "detail" && (
          <div className="w-32 space-y-1.5">
            <label className="f-label block">审核情况</label>
            <SearchSelect
              ariaLabel="审核情况"
              value={审核}
              options={[
                { value: "1", label: "已审核" },
                { value: "0", label: "未审核" },
              ]}
              placeholder="全部"
              clearLabel="全部"
              onChange={(v) => set审核(v)}
            />
          </div>
        )}
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

      <div className="flex items-center gap-3">
        <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { key: "summary" as const, label: "汇总查询" },
            { key: "detail" as const, label: "明细查询" },
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
        <span className="text-sm text-[#5f6b7d]">
          查询记录:{rows.length}
          {total2 != null && (
            <>
              {"　"}
              {cfg.totalLabel2}:{total2.toLocaleString()}
            </>
          )}
          {total != null && (
            <>
              {"　"}
              {cfg.totalLabel}:{total.toLocaleString()}
            </>
          )}
        </span>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={dataQuery.isLoading}
        isError={dataQuery.isError}
        onRetry={() => dataQuery.refetch()}
        errorMessage={`加载${cfg.title}失败,请重试`}
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
        fill
        minWidth={tab === "detail" ? 1600 : 1100}
        onRowDoubleClick={
          tab === "detail" ? (r) => r.单号 && onOpenDoc(String(r.单号)) : undefined
        }
        rowTitle={
          tab === "detail"
            ? (r) => (r.单号 ? `双击打开${cfg.docTitle} ${r.单号}` : undefined)
            : undefined
        }
        footer={
          <>
            <span>共 {rows.length} 条</span>
            {tab === "detail" && <span>双击明细行可打开{cfg.docTitle}</span>}
          </>
        }
      />
    </div>
  );
}
