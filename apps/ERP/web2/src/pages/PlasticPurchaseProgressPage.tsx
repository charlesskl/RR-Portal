// 塑胶订单进度表(/plastic-purchase-progress)。对照老系统 web/src/pages/plastics/PlasticPurchaseProgressPage.tsx:
// 整单视图(默认,一行=一整张采购订单,点行展开该单物料明细)/明细视图(逐物料平铺)切换;
// 筛选=整单/明细 + 上/本/下月 + 起止 + 供应商 + 关键字 + 只看欠数;首屏加载一次,之后由「查询」显式触发;
// 导出 CSV + 打印(明细口径,列规格逐字对照老 exportCols);欠数>0 红色加粗。
// 权限菜单=塑胶进度表(MenuCatalog.cs:47 实证:塑胶采购组)。
// 增补(与 web2 来料版 /order-progress 对齐):点采购单号/双击明细行跳塑胶采购订单整单
// /plastic-purchase-orders?单号=(MENU_PATHS 裁决,不静默断链);老系统本页无跳单。
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import {
  CaretDown,
  CaretRight,
  Export,
  MagnifyingGlass,
  Printer,
  Prohibit,
} from "@phosphor-icons/react";
import { plasticPurchaseProgressApi } from "@/api/endpoints";
import type { PlasticPurchaseProgressRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { useTableDensity, TABLE_DENSITIES } from "@/hooks/useTableDensity";
import { summarizeOrderProgress, type OrderProgressSummaryRow } from "@/lib/orderProgress";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { MENU_PATHS } from "@/nav/menu";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";

const MENU = "塑胶进度表";

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const num = (v?: number | null) => v ?? 0;
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const oweCls = "f-mono px-3 py-2 text-right font-bold";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

// 欠数单元格(>0 红色加粗;对照老系统 owe())
function Owe({ v }: { v?: number | null }) {
  return (
    <span className={cn("f-mono", (v ?? 0) > 0 ? "text-[#dc2626]" : "text-[#1a2330]")}>
      {v ?? 0}
    </span>
  );
}

function AuditTag({ v }: { v?: string }) {
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

// 完成情况(对照老系统 完成情况Tag)
function CompletionTag({ v }: { v: string }) {
  if (v === "已完成")
    return (
      <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
        已完成
      </span>
    );
  if (v === "部分入仓")
    return (
      <span className="inline-flex rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2.5 py-1 text-xs font-semibold text-[#b45309]">
        部分入仓
      </span>
    );
  return (
    <span className="inline-flex rounded-full border border-[#dc2626]/40 bg-[#dc2626]/10 px-2.5 py-1 text-xs font-semibold text-[#dc2626]">
      未入仓
    </span>
  );
}

// ---------- 明细视图列(对照老系统明细 columns) ----------

const detCol = createColumnHelper<PlasticPurchaseProgressRow>();

const detailColumns: ColumnDef<PlasticPurchaseProgressRow, any>[] = [
  detCol.accessor("订购日期", { header: "订购日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  detCol.accessor("交货日期", { header: "交货日期", size: 8, cell: (c) => d10(c.getValue()), meta: { tdClass: monoCls } }),
  detCol.accessor("采购单号", {
    header: "采购单号",
    size: 10,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  detCol.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: monoCls } }),
  detCol.accessor("款号", { header: "款号", size: 7, meta: { tdClass: monoCls } }),
  detCol.accessor("物料编号", { header: "物料编号", size: 8, meta: { tdClass: monoCls } }),
  detCol.accessor("物料名称", { header: "物料名称", size: 11 }),
  detCol.accessor("模具编号", { header: "模具编号", size: 7, meta: { tdClass: monoCls } }),
  detCol.accessor("颜色", { header: "颜色", size: 6 }),
  detCol.accessor("单位", { header: "单位", size: 4 }),
  detCol.accessor("订购数量", { header: "订购数量", size: 7, cell: (c) => num(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  detCol.accessor("入仓数量", { header: "入仓数量", size: 7, cell: (c) => num(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  detCol.accessor("欠数", { header: "欠数", size: 6, cell: (c) => <Owe v={c.getValue()} />, meta: { align: "right", tdClass: oweCls } }),
  detCol.accessor("供应商名称", { header: "供应商", size: 11 }),
  detCol.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) => <AuditTag v={c.getValue()} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

// 导出列(对照老系统 exportCols 逐字)
const EXPORT_COLS: ExportCol[] = [
  { title: "订购日期", key: "订购日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "交货日期", key: "交货日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "采购单号", key: "采购单号" },
  { title: "生产单号", key: "生产单号" },
  { title: "款号", key: "款号" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "模具编号", key: "模具编号" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "订购数量", key: "订购数量" },
  { title: "入仓数量", key: "入仓数量" },
  { title: "欠数", key: "欠数" },
  { title: "供应商名称", key: "供应商名称" },
  { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
];

export default function PlasticPurchaseProgressPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();
  const { density } = useTableDensity();
  const rowH = TABLE_DENSITIES.find((d) => d.key === density)!.rowH;

  const [mode, setMode] = useState<"整单" | "明细">("整单");
  const [供应商, set供应商] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [onlyOwed, setOnlyOwed] = useState(false);
  // 已应用的筛选(首屏加载一次,默认本月区间(对照老系统 range 默认 thisMonth 且首进即带 起/止);
  // 之后由「查询」显式触发,不随筛选自动刷新)
  const [applied, setApplied] = useState<{
    供应商?: string;
    keyword?: string;
    起?: string;
    止?: string;
    onlyOwed?: boolean;
  }>(() => {
    const m = thisMonthRange();
    return { 起: m.起, 止: m.止 };
  });
  const [expanded, setExpanded] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const progressQuery = useQuery({
    queryKey: ["plastic-purchase-progress", applied],
    queryFn: () => plasticPurchaseProgressApi.list(applied),
    enabled: canOpen && !permsLoading,
  });
  const rows = useMemo(() => progressQuery.data ?? [], [progressQuery.data]);
  const summaryRows = useMemo(() => summarizeOrderProgress(rows), [rows]);
  const linesOf = (no: string) => rows.filter((r) => r.采购单号 === no);
  const toggleExpand = (no: string) =>
    setExpanded((keys) => (keys.includes(no) ? keys.filter((k) => k !== no) : [...keys, no]));

  const applyQuery = () => {
    const next = {
      供应商: 供应商.trim() || undefined,
      keyword: kwInput.trim() || undefined,
      起: range.起 || undefined,
      止: range.止 || undefined,
      onlyOwed: onlyOwed || undefined,
    };
    const unchanged = JSON.stringify(next) === JSON.stringify(applied);
    setApplied(next);
    if (unchanged) void progressQuery.refetch();
  };

  // 点采购单号打开塑胶采购订单整单;目标未注册不静默断链(MENU_PATHS 裁决)
  const openOrder = (no?: string) => {
    if (!no) return;
    if (!MENU_PATHS.has("/plastic-purchase-orders")) {
      setToast({ text: `塑胶采购订单页未注册,请记下订单号:${no}`, tone: "err" });
      return;
    }
    navigate(`/plastic-purchase-orders?单号=${encodeURIComponent(no)}`);
  };

  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶进度表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶订单进度表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏 */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {(["整单", "明细"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                mode === m
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {m}
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
          <span className="f-label block">订购日期</span>
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
        <div className="w-40 space-y-1.5">
          <label htmlFor="ppp-sup" className="f-label block">
            供应商
          </label>
          <input
            id="ppp-sup"
            className="f-input"
            placeholder="供应商"
            value={供应商}
            onChange={(e) => set供应商(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyQuery()}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="ppp-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="ppp-kw"
            className={inputCls}
            placeholder="生产单号/款号/物料"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyQuery()}
          />
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2.5 text-[15px] text-[#3d4a5c]">
          <Checkbox
            className="h-5 w-5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
            checked={onlyOwed}
            onCheckedChange={(v) => setOnlyOwed(v === true)}
          />
          只看欠数
        </label>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={applyQuery}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => downloadCsv("塑胶进度表.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("塑胶进度表", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        <span className="text-sm text-[#5f6b7d]">
          {mode === "整单" ? `共 ${summaryRows.length} 张订单` : `共 ${rows.length} 条`}
        </span>
      </div>

      {mode === "明细" ? (
        // 明细视图:一行=一条采购明细(共享查询表;双击行跳塑胶采购订单整单)
        <QueryTable
          columns={detailColumns}
          rows={rows}
          isLoading={progressQuery.isLoading}
          isError={progressQuery.isError}
          onRetry={() => progressQuery.refetch()}
          errorMessage="加载塑胶进度表失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有塑胶采购订单明细"
          fill
          minWidth={1700}
          onRowDoubleClick={(r) => openOrder(r.采购单号)}
          rowTitle={(r) => (r.采购单号 ? `双击打开塑胶采购订单 ${r.采购单号}` : undefined)}
          footer={<span>共 {rows.length} 条</span>}
        />
      ) : (
        // 整单视图:一行=一整张采购订单(点行展开该单物料明细;点单号打开整单)
        <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
          {progressQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 w-full animate-pulse rounded-lg bg-black/5" />
              ))}
            </div>
          ) : progressQuery.isError ? (
            <div className="p-6">
              <DocEmpty
                icon={<Prohibit className="h-5 w-5" />}
                title="加载失败"
                description="加载塑胶进度表失败,请重试"
              />
            </div>
          ) : summaryRows.length === 0 ? (
            <div className="p-6">
              <DocEmpty
                icon={<Prohibit className="h-5 w-5" />}
                title="暂无数据"
                description="当前筛选条件下没有塑胶采购订单"
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table data-freeze className="w-full min-w-[1250px] text-[15px]">
                <thead className="sticky top-0 z-10 border-b border-black/8 bg-white">
                  <tr>
                    <th className="f-label w-10 px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case" />
                    {["订购日期", "交货日期", "采购单号", "供应商名称", "生产单号", "订购数量", "入仓数量", "欠数", "完成情况", "审核"].map(
                      (h) => (
                        <th
                          key={h}
                          className={cn(
                            "f-label px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                            (h === "订购数量" || h === "入仓数量" || h === "欠数") && "text-right",
                            (h === "完成情况" || h === "审核") && "text-center",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((r: OrderProgressSummaryRow) => {
                    const open = expanded.includes(r.采购单号);
                    return (
                      <FragmentRows
                        key={r.采购单号}
                        row={r}
                        open={open}
                        rowH={rowH}
                        lines={open ? linesOf(r.采购单号) : []}
                        onToggle={() => toggleExpand(r.采购单号)}
                        onOpenOrder={openOrder}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!progressQuery.isLoading && summaryRows.length > 0 && (
            <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
              <span>共 {summaryRows.length} 张订单</span>
              <span>点行展开物料明细,点采购单号打开整单</span>
            </div>
          )}
        </div>
      )}

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}

// 整单行(+展开明细行)
function FragmentRows({
  row,
  open,
  rowH,
  lines,
  onToggle,
  onOpenOrder,
}: {
  row: OrderProgressSummaryRow;
  open: boolean;
  rowH: number;
  lines: PlasticPurchaseProgressRow[];
  onToggle: () => void;
  onOpenOrder: (no: string) => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-black/6 transition-colors hover:bg-black/[0.04]"
        style={{ height: rowH }}
        onClick={onToggle}
        title="点击展开/收起物料明细"
      >
        <td className="px-3 py-2 text-[#5f6b7d]">
          {open ? <CaretDown className="h-4 w-4" /> : <CaretRight className="h-4 w-4" />}
        </td>
        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{d10(row.订购日期)}</td>
        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{d10(row.交货日期)}</td>
        <td className="px-3 py-2 whitespace-nowrap">
          <button
            type="button"
            className="f-mono font-semibold text-[#15803d] hover:underline"
            title="打开塑胶采购订单"
            onClick={(e) => {
              e.stopPropagation();
              onOpenOrder(row.采购单号);
            }}
          >
            {row.采购单号}
          </button>
        </td>
        <td className="px-3 py-2 text-[#3d4a5c]">{row.供应商名称}</td>
        <td className="f-mono px-3 py-2 text-[#3d4a5c]">{row.生产单号}</td>
        <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{row.订购数量}</td>
        <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{row.入仓数量}</td>
        <td className="px-3 py-2 text-right">
          <Owe v={row.欠数} />
        </td>
        <td className="px-3 py-2 text-center">
          <CompletionTag v={row.完成情况} />
        </td>
        <td className="px-3 py-2 text-center">
          <AuditTag v={row.审核} />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-black/6 bg-black/[0.02]">
          <td colSpan={11} className="px-6 py-3">
            <table data-freeze className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b border-black/8">
                  {["生产单号", "款号", "物料编号", "物料名称", "模具编号", "颜色", "单位", "订购数量", "入仓数量", "欠数"].map(
                    (h) => (
                      <th
                        key={h}
                        className={cn(
                          "f-label px-3 py-2 text-left font-medium whitespace-nowrap normal-case",
                          (h === "订购数量" || h === "入仓数量" || h === "欠数") && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.生产单号}|${l.款号}|${l.物料编号}`} className="border-b border-black/5 last:border-0">
                    <td className="f-mono px-3 py-2 whitespace-nowrap text-[#15803d]">{l.生产单号}</td>
                    <td className="f-mono px-3 py-2 text-[#3d4a5c]">{l.款号}</td>
                    <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{l.物料编号}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{l.物料名称}</td>
                    <td className="f-mono px-3 py-2 text-[#3d4a5c]">{l.模具编号}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{l.颜色}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{l.单位}</td>
                    <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{num(l.订购数量)}</td>
                    <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{num(l.入仓数量)}</td>
                    <td className="px-3 py-2 text-right">
                      <Owe v={l.欠数} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
