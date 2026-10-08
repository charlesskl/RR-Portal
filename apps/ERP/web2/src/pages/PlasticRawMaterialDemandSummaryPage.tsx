// 原料生产需求汇总(/plastic-raw-material-demand-summary)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialDemandSummaryPage.tsx:
// 上/本/下月 + 起止(默认本月) + 领料备注/审核情况下拉 + 关键字;双击行弹原料需求表详情
// (单头描述 + 明细表 + 合计);底部合计(需求数量KG/包);导出 CSV + 打印。
// 权限菜单=原料生产需求汇总(MenuCatalog.cs:77 实证:原料报表组)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Export, Printer, Prohibit } from "@phosphor-icons/react";
import { rawMaterialDemandApi } from "@/api/endpoints";
import type { RMDSummaryRow } from "@/api/types";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { ISSUE_REMARKS, date10 } from "@/lib/rawDocs";
import { usePerms } from "@/hooks/usePerms";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";

const MENU = "原料生产需求汇总";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";

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

const col = createColumnHelper<RMDSummaryRow>();

// 列序逐字对照老系统 columns
const columns: ColumnDef<RMDSummaryRow, any>[] = [
  col.accessor("开单日期", {
    header: "开单日期",
    size: 8,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: monoCls },
  }),
  col.accessor("生产车间", { header: "生产车间", size: 9 }),
  col.accessor("领料备注", { header: "领料备注", size: 8 }),
  col.accessor("啤机生产单号", { header: "啤机生产单号", size: 10, meta: { tdClass: monoCls } }),
  col.accessor("原料编号", {
    header: "原料编号",
    size: 9,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  col.accessor("原料名称", { header: "原料名称", size: 13 }),
  col.accessor("每包重量", {
    header: "每包重量",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("单位", { header: "单位", size: 5 }),
  col.accessor("需求数量KG", {
    header: "需求数量(KG)",
    size: 8,
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("需求数量包", {
    header: "需求数量(包)",
    size: 8,
    meta: { align: "right", tdClass: numCls },
  }),
  col.accessor("备注", { header: "备注", size: 9 }),
  col.accessor("制单人", { header: "制单人", size: 6 }),
  col.accessor("操作员", { header: "操作员", size: 6 }),
  col.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) => <AuditTag v={c.getValue()} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

// 导出列(对照老系统 exportCols 逐字)
const EXPORT_COLS: ExportCol[] = [
  { title: "开单日期", key: "开单日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "生产车间", key: "生产车间" },
  { title: "领料备注", key: "领料备注" },
  { title: "啤机生产单号", key: "啤机生产单号" },
  { title: "原料编号", key: "原料编号" },
  { title: "原料名称", key: "原料名称" },
  { title: "每包重量", key: "每包重量" },
  { title: "单位", key: "单位" },
  { title: "需求数量(KG)", key: "需求数量KG" },
  { title: "需求数量(包)", key: "需求数量包" },
  { title: "备注", key: "备注" },
  { title: "制单人", key: "制单人" },
  { title: "操作员", key: "操作员" },
  { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
];

// 明细弹窗列(对照老系统 detailColumns)
const DETAIL_COLS: { title: string; key: string; num?: boolean }[] = [
  { title: "原料编号", key: "原料编号" },
  { title: "原料名称", key: "原料名称" },
  { title: "每包重量", key: "每包重量", num: true },
  { title: "单位", key: "单位" },
  { title: "需求数量(KG)", key: "需求数量KG", num: true },
  { title: "需求数量(包)", key: "需求数量包", num: true },
  { title: "备注", key: "备注" },
];

// 原料需求表详情弹窗(对照老系统 Modal:单头 Descriptions + 明细表 + 合计行)
function DemandDetailDialog({ 单号, onClose }: { 单号: string; onClose: () => void }) {
  const docQuery = useQuery({
    queryKey: ["raw-demand-summary", "doc", 单号],
    queryFn: () => rawMaterialDemandApi.get(单号),
  });
  const h = docQuery.data?.单头;
  const lines = useMemo(() => docQuery.data?.明细 ?? [], [docQuery.data]);
  const sumKG = lines.reduce((s, l) => s + Number(l.需求数量KG ?? 0), 0);
  const sum包 = lines.reduce((s, l) => s + Number(l.需求数量包 ?? 0), 0);

  return (
    <PickerDialog
      open
      onClose={onClose}
      title={`原料需求表${h?.单号 ? `(${h.单号})` : ""}`}
      width="sm:max-w-[1100px]"
    >
      {docQuery.isLoading ? (
        <div className="py-6 text-center text-sm text-[#5f6b7d]">加载中...</div>
      ) : docQuery.isError ? (
        <div className="py-6 text-center text-sm text-[#dc2626]">单据加载失败</div>
      ) : (
        <>
          {h && (
            <div className="mb-4 grid grid-cols-4 gap-x-6 gap-y-2 rounded-xl border border-black/8 bg-black/[0.02] p-4 text-sm">
              {(
                [
                  ["啤机生产单号", h.啤机生产单号],
                  ["开单日期", date10(h.开单日期)],
                  ["制单人", h.制单人],
                  ["生产车间", h.生产车间],
                  ["领料备注", h.领料备注],
                  ["操作员", h.操作员],
                  ["备注", h.备注],
                ] as [string, unknown][]
              ).map(([label, v]) => (
                <div key={label} className="flex gap-2">
                  <span className="shrink-0 text-[#5f6b7d]">{label}</span>
                  <span className="f-mono min-w-0 truncate text-[#1a2330]">{String(v ?? "")}</span>
                </div>
              ))}
              <div className="flex gap-2">
                <span className="shrink-0 text-[#5f6b7d]">审核</span>
                <AuditTag v={h.审核} />
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr>
                {DETAIL_COLS.map((c) => (
                  <th key={c.key} className={cn(pickerThCls, c.num && "text-right")}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.原料编号 ?? i} className="border-b border-black/6 last:border-0">
                  {DETAIL_COLS.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2 text-[#3d4a5c]",
                        c.num && "f-mono text-right",
                        c.key === "原料编号" && "f-mono whitespace-nowrap",
                      )}
                    >
                      {String((l as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={DETAIL_COLS.length} className="px-3 py-4 text-center text-sm text-disabled">
                    无明细
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/8">
                <td colSpan={4} className="px-3 py-2 text-sm font-semibold text-[#1a2330]">
                  合计
                </td>
                <td className="f-mono px-3 py-2 text-right font-semibold">{sumKG}</td>
                <td className="f-mono px-3 py-2 text-right font-semibold">{sum包}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </PickerDialog>
  );
}

export default function PlasticRawMaterialDemandSummaryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [领料备注, set领料备注] = useState("");
  const [审核情况, set审核情况] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string }>({});
  const [viewing, setViewing] = useState<string | undefined>(undefined);

  const summaryQuery = useQuery({
    queryKey: ["raw-demand-summary", range, 领料备注, 审核情况, applied],
    queryFn: () =>
      rawMaterialDemandApi.summary({
        起: range.起,
        止: range.止,
        keyword: applied.keyword,
        领料备注: 领料备注 || undefined,
        审核情况: 审核情况 || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !!range.起 && !!range.止,
  });
  const rows = useMemo(() => summaryQuery.data ?? [], [summaryQuery.data]);
  const sumKG = rows.reduce((s, r) => s + Number(r.需求数量KG ?? 0), 0);
  const sum包 = rows.reduce((s, r) => s + Number(r.需求数量包 ?? 0), 0);
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料生产需求汇总·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">原料生产需求汇总</h1>
        <DensitySwitch className="ml-auto" />
      </div>

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
          <label className="f-label block">
            领料备注
          </label>
          <SearchSelect
            ariaLabel="领料备注"
            value={领料备注}
            options={ISSUE_REMARKS.map((v) => ({ value: v, label: v }))}
            placeholder="领料备注:全部"
            clearLabel="领料备注:全部"
            onChange={(v) => set领料备注(v)}
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="f-label block">
            审核情况
          </label>
          <SearchSelect
            ariaLabel="审核情况"
            value={审核情况}
            options={[
              { value: "已审核", label: "已审核" },
              { value: "未审核", label: "未审核" },
            ]}
            placeholder="审核:全部"
            clearLabel="审核:全部"
            onChange={(v) => set审核情况(v)}
          />
        </div>
        <div className="w-64 space-y-1.5">
          <label htmlFor="rds-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="rds-kw"
            className={inputCls}
            placeholder="单号/生产单号/原料/车间/制单人"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setApplied({ keyword: kwInput.trim() || undefined })
            }
          />
        </div>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => downloadCsv("原料生产需求汇总.csv", EXPORT_COLS, asRecords())}
        >
          <Export className="h-4.5 w-4.5" />
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          onClick={() => printTable("原料生产需求汇总", EXPORT_COLS, asRecords())}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={summaryQuery.isLoading}
        isError={summaryQuery.isError}
        onRetry={() => summaryQuery.refetch()}
        errorMessage="加载原料生产需求汇总失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前筛选条件下没有原料生产需求"
        fill
        minWidth={1500}
        onRowDoubleClick={(r) => r.单号 && setViewing(r.单号)}
        rowTitle={(r) => (r.单号 ? `双击打开原料需求表 ${r.单号}` : undefined)}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>
              合计:需求数量(KG) {sumKG} · 需求数量(包) {sum包}
            </span>
          </>
        }
      />

      {viewing !== undefined && (
        <DemandDetailDialog 单号={viewing} onClose={() => setViewing(undefined)} />
      )}
    </div>
  );
}
