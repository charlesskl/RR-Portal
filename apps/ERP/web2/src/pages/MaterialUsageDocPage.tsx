// 退料单/报废单(来料仓)通用单据页:两单据同构(仅 部门/人 字段名与汇总数量字段不同),
// 对照老系统 web/src/pages/materials/{MaterialDocPage,MaterialDocCreateDrawer,MaterialDocDetailDrawer}.tsx
// (materialDocConfigs["material-returns"]/["material-scraps"]) + MaterialReturnQueryPage/MaterialScrapQueryPage。
// 单级审核=过账(退料入库存/报废出库存);保存后不可改(后端无 PUT)。
// 权限菜单=退料单/报废单(MenuCatalog 实证:物料管理组);查询页签与单据共用同一菜单(后端同控制器鉴权)。
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Copy,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Plus,
  Printer,
  Prohibit,
  Trash,
} from "@phosphor-icons/react";
import {
  employeesApi,
  finishedInventoryApi,
  inventoryApi,
  materialMasterApi,
  productionApi,
  productionReportApi,
  semiInventoryApi,
} from "@/api/endpoints";
import type {
  IssueBasisRow,
  ProductionTrackingRow,
  UsageDocDetail,
  UsageDocHeader,
  UsageDocQueryDetailRow,
  UsageDocQuerySummaryRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  basisRowToLine,
  distinct货号,
  issueBasisKey,
  issueBasis档,
  issueBasis档说明,
  mergeIssueBasisRows,
  parse生产单号s,
  sumQty,
  toSubmitLine,
  validLines,
  可挑选档,
  type EditLine,
} from "@/lib/materialIssue";
import { ALL_APPROVAL, ALL_CAT, buildDocQuery, monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { printMaterialDoc } from "@/lib/printMaterialDoc";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import type { UsageDocCfg } from "@/lib/usageDoc";
import { usePerms } from "@/hooks/usePerms";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocHeaderCard, type HeaderField } from "@/components/doc/DocHeaderCard";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const money = (v?: number | null) => (v == null ? "***" : String(v));

let rowSeq = 1;
const uid = () => rowSeq++;

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- 审核徽章(单级:已审核/未审核) ----------

function AuditBadge({ header }: { header?: UsageDocHeader | null }) {
  if (header?.审核 === "1")
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/60 bg-[#16a34a]/10 px-4 py-1.5 text-sm font-semibold text-[#15803d]">
        <span className="f-pulse h-2 w-2 rounded-full bg-[#16a34a]" />
        已审核
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/5 px-4 py-1.5 text-sm font-semibold text-[#5f6b7d]">
      未审核
    </span>
  );
}

// ---------- 新建态表头(字段对照 materialDocConfigs:部门/日期/人(选人)/电脑单号/操作员/仓库/备注) ----------

interface HeaderFormState {
  部门: string;
  人: string;
  仓库: string;
  备注: string;
}

const emptyHeader = (): HeaderFormState => ({ 部门: "", 人: "", 仓库: "", 备注: "" });

function HeaderForm({
  cfg,
  form,
  setForm,
  操作员,
  onPickEmployee,
}: {
  cfg: UsageDocCfg;
  form: HeaderFormState;
  setForm: (p: Partial<HeaderFormState>) => void;
  操作员: string;
  onPickEmployee: () => void;
}) {
  return (
    <div className="f-panel p-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="部门">
          <Input
            className={inputCls}
            aria-label={cfg.deptField}
            placeholder="直接填写部门"
            value={form.部门}
            onChange={(e) => setForm({ 部门: e.target.value })}
          />
        </FormField>
        <FormField label="日期">
          <Input className={inputCls} aria-label="日期" value={today()} disabled />
        </FormField>
        <FormField label={cfg.personField}>
          <div className="flex items-center gap-1">
            <Input
              className={inputCls}
              aria-label={cfg.personField}
              placeholder="点「选」从人事档案选人"
              readOnly
              value={form.人}
            />
            <button
              type="button"
              aria-label={`${cfg.personField}选择`}
              className="f-btn h-10 shrink-0 px-3 text-sm"
              onClick={onPickEmployee}
            >
              选
            </button>
          </div>
        </FormField>
        <FormField label="电脑单号">
          <Input className={inputCls} value="" disabled placeholder="保存后自动生成" />
        </FormField>
        <FormField label="操作员">
          <Input className={inputCls} aria-label="操作员" value={操作员} disabled />
        </FormField>
        <FormField label="仓库">
          <div className="relative">
            <Input
              className={inputCls}
              aria-label="仓库"
              value={form.仓库}
              onChange={(e) => setForm({ 仓库: e.target.value })}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">
              *
            </span>
          </div>
        </FormField>
        <FormField label="备注">
          <Input
            className={inputCls}
            aria-label="备注"
            value={form.备注}
            onChange={(e) => setForm({ 备注: e.target.value })}
          />
        </FormField>
      </div>
    </div>
  );
}

// ---------- 明细编辑网格(usageCols 保真列序:装配采购|生产单号|款号|物料编号|物料名称|规格|材料|颜色|单位|库存|数量|备注) ----------

function LinesEditor({
  rows,
  stockMap,
  onPatch,
  onRemove,
  onAddLine,
  onPickProduction,
  onPickMaterial,
  onOpenBasis,
  basis说明,
}: {
  rows: EditLine[];
  stockMap: Record<string, number>;
  onPatch: (key: number, patch: Partial<EditLine>) => void;
  onRemove: (key: number) => void;
  onAddLine: () => void;
  onPickProduction: (key: number) => void;
  onPickMaterial: (key: number) => void;
  onOpenBasis: () => void;
  basis说明: string;
}) {
  const cellInput = (r: EditLine, k: keyof EditLine, label: string, w: string) => (
    <Input
      className={cn(inputCls, "h-9", w)}
      aria-label={label}
      value={(r[k] as string | undefined) ?? ""}
      onChange={(e) => onPatch(r.key, { [k]: e.target.value })}
    />
  );
  const pickCell = (r: EditLine, k: keyof EditLine, label: string, w: string, onPick: () => void) => (
    <div className="flex items-center gap-1">
      <Input
        className={cn(inputCls, "h-9", w)}
        aria-label={label}
        value={(r[k] as string | undefined) ?? ""}
        onChange={(e) => onPatch(r.key, { [k]: e.target.value })}
      />
      <button
        type="button"
        aria-label={`${label}选择`}
        className="f-btn h-9 shrink-0 px-2 text-xs"
        onClick={onPick}
      >
        选
      </button>
    </div>
  );
  return (
    <div className="f-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
        <div className="flex gap-2">
          <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onAddLine}>
            <Plus className="h-4 w-4" />
            加一行
          </button>
          <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onOpenBasis}>
            按生产单带入
          </button>
        </div>
        <span className="text-sm text-[#5f6b7d]">
          口径跟随表头仓库({basis说明});可改完再保存;当前空白行会被替换
        </span>
      </div>
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1350px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {["序号", "装配采购", "生产单号", "款号", "物料编号", "物料名称", "规格", "材料", "颜色", "单位", "库存", "数量", "备注", "操作"].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(
                      pickerThCls,
                      (h === "库存" || h === "数量") && "text-right",
                      h === "操作" && "text-center",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-sm text-disabled">
                  还没有明细行,点「加一行」手选物料,或「按生产单带入」应领明细
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const stock = r.物料编号 ? (stockMap[r.物料编号] ?? 0) : null;
                return (
                  <tr key={r.key} className="border-b border-black/6 last:border-0">
                    <td className="px-3 py-2 text-disabled">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Input className={cn(inputCls, "h-9 w-20")} aria-label="装配采购" disabled placeholder="-" />
                    </td>
                    <td className="px-3 py-2">{pickCell(r, "生产单号", "生产单号", "w-28", () => onPickProduction(r.key))}</td>
                    <td className="px-3 py-2">{pickCell(r, "款号", "款号", "w-24", () => onPickProduction(r.key))}</td>
                    <td className="px-3 py-2">{pickCell(r, "物料编号", "物料编号", "w-28", () => onPickMaterial(r.key))}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.物料类别 ?? ""}</td>
                    <td className="px-3 py-2">{cellInput(r, "颜色", "颜色", "w-20")}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                    <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{stock ?? ""}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        aria-label="数量"
                        className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                        value={r.数量}
                        onChange={(e) => onPatch(r.key, { 数量: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">{cellInput(r, "备注", "行备注", "w-32")}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        aria-label="删除明细行"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#dc2626] transition-colors hover:bg-[#dc2626]/10"
                        onClick={() => onRemove(r.key)}
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-black/8 px-4 py-3 text-right font-semibold text-[#1a2330]">
        数量合计:<span className="f-mono">{sumQty(rows)}</span>
      </div>
    </div>
  );
}

// ---------- 明细查看态(只读;单价/金额无权限时后端置 null 显示 ***) ----------

function LinesView({ lines }: { lines: UsageDocDetail["明细"] }) {
  return (
    <div className="f-panel overflow-hidden">
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1350px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {["生产单号", "款号", "物料编号", "物料名称", "规格", "材料", "颜色", "单位", "数量", "单价", "金额", "备注"].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(pickerThCls, (h === "数量" || h === "单价" || h === "金额") && "text-right")}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.ID ?? i} className="h-11 border-b border-black/6 last:border-0">
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#15803d]">{txt(l.生产单号)}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{txt(l.款号)}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{txt(l.物料编号)}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.物料类别)}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{money(l.单价)}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{money(l.金额)}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.备注)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 查询页签(明细/汇总;对照老系统 MaterialReturnQueryPage/MaterialScrapQueryPage) ----------

const monoDimCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const monoStrongCls = "f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]";

function QueryPanel({ cfg, onOpenDoc }: { cfg: UsageDocCfg; onOpenDoc: (单号: string) => void }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(cfg.menu, "打开") && !permsLoading;

  const [sub, setSub] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);
  const [类别, set类别] = useState(ALL_CAT);
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");

  const catsQuery = useQuery({
    queryKey: ["material-categories"],
    queryFn: () => materialMasterApi.categories(),
    staleTime: 5 * 60_000,
    enabled: canOpen,
  });

  const params = buildDocQuery({ keyword: kw, 类别, 审核情况, 起: range.起, 止: range.止 });

  const detailQuery = useQuery({
    queryKey: [cfg.key, "query-detail", params],
    queryFn: () => cfg.api.queryDetail(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && sub === "detail",
  });
  const summaryQuery = useQuery({
    queryKey: [cfg.key, "query-summary", params],
    queryFn: () => cfg.api.querySummary(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && sub === "summary",
  });
  const activeQuery = sub === "detail" ? detailQuery : summaryQuery;
  const rowCount = (activeQuery.data ?? []).length;

  // 结果表列(列序对照老系统 detailColumns/summaryColumns)
  const detailTableCols = useMemo<ColumnDef<UsageDocQueryDetailRow, any>[]>(() => {
    const c = createColumnHelper<UsageDocQueryDetailRow>();
    return [
      c.accessor("生产单号", { header: "生产单号", size: 10, meta: { tdClass: monoDimCls } }),
      c.accessor("款号", { header: "款号", size: 8, meta: { tdClass: monoDimCls } }),
      c.accessor("日期", {
        header: "日期",
        size: 8,
        cell: (x) => date10(x.getValue()),
        meta: { tdClass: monoDimCls },
      }),
      c.accessor("单号", {
        header: "单号",
        size: 9,
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
      }),
      c.accessor(cfg.deptField, { header: cfg.deptField, size: 8 }),
      c.accessor(cfg.personField, { header: cfg.personField, size: 7 }),
      c.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: monoStrongCls } }),
      c.accessor("物料名称", { header: "物料名称", size: 12 }),
      c.accessor("规格", { header: "规格", size: 9 }),
      c.accessor("物料类别", { header: "材料", size: 7 }),
      c.accessor("颜色", { header: "颜色", size: 6 }),
      c.accessor("单位", { header: "单位", size: 5 }),
      c.accessor("数量", {
        header: "数量",
        size: 6,
        cell: (x) => x.getValue() ?? "",
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
      }),
      c.accessor("备注", { header: "备注", size: 10 }),
      c.accessor("审核", {
        header: "审核",
        size: 6,
        cell: (x) => (x.getValue() === "1" ? "已审核" : "未审核"),
      }),
    ];
  }, [cfg]);

  const summaryTableCols = useMemo<ColumnDef<UsageDocQuerySummaryRow, any>[]>(() => {
    const c = createColumnHelper<UsageDocQuerySummaryRow>();
    return [
      c.accessor("生产单号", { header: "生产单号", size: 10, meta: { tdClass: monoDimCls } }),
      c.accessor("款号", { header: "款号", size: 8, meta: { tdClass: monoDimCls } }),
      c.accessor("物料编号", { header: "物料编号", size: 10, meta: { tdClass: monoStrongCls } }),
      c.accessor("物料名称", { header: "物料名称", size: 14 }),
      c.accessor("规格", { header: "规格", size: 10 }),
      c.accessor("物料类别", { header: "材料", size: 8 }),
      c.accessor("颜色", { header: "颜色", size: 7 }),
      c.accessor("单位", { header: "单位", size: 5 }),
      c.accessor(cfg.sumField, {
        header: cfg.sumLabel,
        size: 8,
        cell: (x) => x.getValue() ?? "",
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]" },
      }),
    ];
  }, [cfg]);

  // 导出/打印列(对照老系统 detailExportCols/summaryExportCols)
  const detailExportCols: ExportCol[] = [
    { title: "生产单号", key: "生产单号" },
    { title: "款号", key: "款号" },
    { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
    { title: "单号", key: "单号" },
    { title: cfg.deptField, key: cfg.deptField },
    { title: cfg.personField, key: cfg.personField },
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "规格", key: "规格" },
    { title: "材料", key: "物料类别" },
    { title: "颜色", key: "颜色" },
    { title: "单位", key: "单位" },
    { title: "数量", key: "数量" },
    { title: "备注", key: "备注" },
    { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
  ];
  const summaryExportCols: ExportCol[] = [
    { title: "生产单号", key: "生产单号" },
    { title: "款号", key: "款号" },
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "规格", key: "规格" },
    { title: "材料", key: "物料类别" },
    { title: "颜色", key: "颜色" },
    { title: "单位", key: "单位" },
    { title: cfg.sumLabel, key: cfg.sumField },
  ];

  const exportTarget = () =>
    sub === "detail"
      ? {
          cols: detailExportCols,
          rows: (detailQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: `${cfg.exportName}明细`,
        }
      : {
          cols: summaryExportCols,
          rows: (summaryQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: `${cfg.exportName}汇总`,
        };

  if (!permsLoading && !canOpen) {
    return (
      <div className="f-panel p-6">
        <DocEmpty
          icon={<Prohibit className="h-5 w-5" />}
          title={`无权访问${cfg.title}单查询`}
          description={`缺少「${cfg.menu}·打开」权限,请联系管理员开通`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="f-panel flex flex-wrap items-end gap-3 p-5">
        <div className="flex gap-1">
          {[
            { label: "上月", off: -1 },
            { label: "本月", off: 0 },
            { label: "下月", off: 1 },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              className="f-btn h-10 px-3.5 text-sm"
              onClick={() => setRange(monthRange(m.off))}
            >
              {m.label}
            </button>
          ))}
        </div>
        <FormField label="起">
          <Input
            type="date"
            className={inputCls}
            aria-label="起"
            value={range.起}
            onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
          />
        </FormField>
        <FormField label="止">
          <Input
            type="date"
            className={inputCls}
            aria-label="止"
            value={range.止}
            onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
          />
        </FormField>
        <FormField label="审核情况">
          <SearchSelect
            ariaLabel="审核情况"
            className={cn(inputCls, "w-28 rounded-md border")}
            value={审核情况}
            options={[ALL_APPROVAL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set审核情况(v)}
          />
        </FormField>
        <FormField label="物料类别">
          <SearchSelect
            ariaLabel="物料类别"
            className={cn(inputCls, "w-40 rounded-md border")}
            value={类别}
            options={[
              { value: ALL_CAT, label: "所有类别" },
              ...(catsQuery.data ?? [])
                .filter((c) => c.类别)
                .map((c) => ({ value: c.类别!, label: `${c.类别}(${c.数量})` })),
            ]}
            onChange={(v) => set类别(v)}
          />
        </FormField>
        <FormField label="关键字">
          <Input
            className={cn(inputCls, "w-60")}
            aria-label="关键字"
            placeholder={cfg.keywordPlaceholder}
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKw(kwInput.trim())}
          />
        </FormField>
        <button
          type="button"
          className="f-btn f-btn-cyan h-10 px-5 text-sm"
          onClick={() => setKw(kwInput.trim())}
        >
          查询
        </button>
        <button
          type="button"
          className="f-btn h-10 px-4 text-sm"
          onClick={() => {
            const { cols, rows, name } = exportTarget();
            if (!rows.length) return;
            downloadCsv(`${name}.csv`, cols, rows);
          }}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn h-10 px-4 text-sm"
          onClick={() => {
            const { cols, rows, name } = exportTarget();
            if (!rows.length) return;
            printTable(`${name}查询`, cols, rows);
          }}
        >
          <Printer className="h-4 w-4" />
          打印
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { key: "detail" as const, label: "明细查询" },
            { key: "summary" as const, label: "汇总查询" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                sub === t.key
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <DensitySwitch className="ml-auto" />
      </div>

      {sub === "detail" ? (
        <QueryTable
          columns={detailTableCols}
          rows={detailQuery.data ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage={`加载${cfg.title}单查询失败,请重试`}
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={1600}
          onRowDoubleClick={(r) => r.单号 && onOpenDoc(r.单号)}
          rowTitle={(r) => `双击打开整单 ${r.单号 ?? ""}`}
          footer={`共 ${rowCount} 条,双击行打开${cfg.title}单整单`}
        />
      ) : (
        <QueryTable
          columns={summaryTableCols}
          rows={summaryQuery.data ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage={`加载${cfg.title}单查询失败,请重试`}
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={1000}
          footer={`共 ${rowCount} 条`}
        />
      )}
    </div>
  );
}

// ---------- 页面 ----------

export function MaterialUsageDocPage({ cfg }: { cfg: UsageDocCfg }) {
  const qc = useQueryClient();
  const currentUser = getUser() || "用户";
  const { can } = usePerms();
  const api = cfg.api;

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [rows, setRows] = useState<EditLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSelected, setBatchSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [materialPickFor, setMaterialPickFor] = useState<number | null>(null);
  const [materialKw, setMaterialKw] = useState("");
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);
  const [prodKw, setProdKw] = useState("");
  const [empPickOpen, setEmpPickOpen] = useState(false);
  const [empKw, setEmpKw] = useState("");
  const [basisOpen, setBasisOpen] = useState(false);
  const [basisNo, setBasisNo] = useState("");
  const [basisLoading, setBasisLoading] = useState(false);
  const [basisRows, setBasisRows] = useState<IssueBasisRow[]>([]);
  const [basisSel, setBasisSel] = useState<string[]>([]);
  const [basis货号, setBasis货号] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = (text: string, tone: "ok" | "err") => setToast({ text, tone });

  // 首进自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: [cfg.key, "first"],
    queryFn: () => api.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  const detailQuery = useQuery({
    queryKey: [cfg.key, "detail", 单号],
    queryFn: () => api.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: [cfg.key, "list", page, keyword],
    queryFn: () => api.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen || batchOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const materialsQuery = useQuery({
    queryKey: [cfg.key, "materials", materialKw],
    queryFn: () => materialMasterApi.list(undefined, materialKw || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: materialPickFor !== null,
  });

  const prodQuery = useQuery({
    queryKey: [cfg.key, "productions", prodKw],
    queryFn: () => productionReportApi.tracking(prodKw || undefined, "1"),
    placeholderData: keepPreviousData,
    enabled: prodPickFor !== null,
  });

  const empQuery = useQuery({
    queryKey: [cfg.key, "employees", empKw],
    queryFn: () => employeesApi.list(1, 200, empKw || undefined),
    placeholderData: keepPreviousData,
    enabled: empPickOpen,
  });

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = header?.审核 === "1";

  // 明细「库存」列:按表头仓库整仓拉一次库存(口径同领料单;先判半成品再成品)
  const stock仓库 = mode === "new" ? form.仓库.trim() : (header?.仓库 ?? "").trim();
  const stockQuery = useQuery({
    queryKey: [cfg.key, "stock", stock仓库],
    queryFn: async () => {
      const m: Record<string, number> = {};
      if (stock仓库.includes("半成品")) {
        for (const r of await semiInventoryApi.list(stock仓库))
          m[r.物料编号] = (m[r.物料编号] ?? 0) + Number(r.库存 ?? 0);
      } else if (stock仓库.includes("成品")) {
        for (const r of await finishedInventoryApi.list(stock仓库))
          m[r.配件编号] = (m[r.配件编号] ?? 0) + Number(r.库存数量 ?? 0);
      } else {
        for (const r of await inventoryApi.list({ 仓库: stock仓库 }))
          m[r.物料编号] = Number(r.库存数量 ?? 0);
      }
      return m;
    },
    enabled: stock仓库 !== "" && mode === "new",
  });
  const stockMap = stockQuery.data ?? {};

  const setForm = (patch: Partial<HeaderFormState>) => setFormState((f) => ({ ...f, ...patch }));
  const patchRow = (key: number, patch: Partial<EditLine>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const reset = () => {
    setMode("new");
    set单号(null);
    setFormState(emptyHeader());
    setRows([]);
  };

  // 复制单(对照老系统 buildCopyInitial:表头可复制字段带出,明细整行带出去 id/金额)
  const copyDoc = () => {
    if (!detail?.单头) return;
    setFormState({
      部门: String(detail.单头[cfg.deptField] ?? ""),
      人: String(detail.单头[cfg.personField] ?? ""),
      仓库: detail.单头.仓库 ?? "",
      备注: detail.单头.备注 ?? "",
    });
    setRows(
      (detail.明细 ?? []).map((l) => ({
        key: uid(),
        生产单号: l.生产单号 ?? undefined,
        款号: l.款号 ?? undefined,
        物料编号: l.物料编号 ?? undefined,
        物料名称: l.物料名称 ?? undefined,
        物料类别: l.物料类别 ?? undefined,
        规格: l.规格 ?? undefined,
        颜色: l.颜色 ?? undefined,
        单位: l.单位 ?? undefined,
        数量: String(l.数量 ?? 0),
        备注: l.备注 ?? undefined,
      })),
    );
    setMode("new");
    set单号(null);
    notify("已复制为未保存新单", "ok");
  };

  // ---------- 按生产单带入(口径跟随表头仓库;来料/塑胶档多单合并按货号挑选,默认全选) ----------
  const openBasis = () => {
    if (!form.仓库.trim()) {
      notify("请先填写仓库,再按生产单带入", "err");
      return;
    }
    setBasisOpen(true);
  };
  const closeBasis = () => {
    setBasisOpen(false);
    setBasisNo("");
    setBasisRows([]);
    setBasisSel([]);
    setBasis货号("");
  };

  const loadIssueBasisPick = async () => {
    const nos = parse生产单号s(basisNo);
    if (nos.length === 0) {
      notify("请输入生产单号(多个用逗号/空格/换行分隔)", "err");
      return;
    }
    const 档 = issueBasis档(form.仓库);
    setBasisLoading(true);
    try {
      const groups: IssueBasisRow[][] = [];
      let empty = 0;
      for (const no of nos) {
        const rs = await productionApi.issueBasis(no, 档, true);
        if (rs.length === 0) empty++;
        else groups.push(rs);
      }
      const merged = mergeIssueBasisRows(groups);
      if (merged.length === 0) {
        notify(`生产单 ${nos.join("/")} 无${form.仓库}应领明细`, "err");
        return;
      }
      if (empty > 0) notify(`${empty} 张生产单无应领明细,已跳过`, "err");
      setBasisRows(merged);
      setBasisSel(merged.map(issueBasisKey)); // 默认全选
      setBasis货号("");
    } catch (e) {
      notify(errMsg(e) || "应领明细调入失败", "err");
    } finally {
      setBasisLoading(false);
    }
  };

  const confirmIssueBasisPick = () => {
    const picked = basisRows.filter((r) => basisSel.includes(issueBasisKey(r)));
    if (picked.length === 0) {
      notify("请先勾选要带出的行", "err");
      return;
    }
    const mapped = picked.map((r) => basisRowToLine(r, r.生产单号 ?? "", uid()));
    setRows((prev) => [...prev.filter((l) => l.物料编号), ...mapped]);
    notify(`已带入 ${mapped.length} 行(应领量)`, "ok");
    closeBasis();
  };

  // 半成品/成品档:单生产单直接带入库存现存
  const bringIssueBasis = async () => {
    const no = basisNo.trim();
    if (!no) return;
    const 档 = issueBasis档(form.仓库);
    setBasisLoading(true);
    try {
      const rs = await productionApi.issueBasis(no, 档);
      if (rs.length === 0) {
        notify(`生产单 ${no} 无${form.仓库}应领明细`, "err");
        return;
      }
      const mapped = rs.map((r) => basisRowToLine(r, no, uid(), 档));
      setRows((prev) => [...prev.filter((l) => l.物料编号), ...mapped]);
      notify(`已带入 ${rs.length} 行(库存现存)`, "ok");
      closeBasis();
    } catch (e) {
      notify(errMsg(e) || "按生产单带入失败", "err");
    } finally {
      setBasisLoading(false);
    }
  };

  // ---------- 保存(只新建;退料/报废保存后不可改,后端无 PUT) ----------
  const doSave = async () => {
    if (!form.仓库.trim()) {
      notify("请填写仓库", "err");
      return;
    }
    const ok = validLines(rows);
    if (ok.length === 0) {
      notify("请至少录入一行有效物料明细", "err");
      return;
    }
    setSaving(true);
    try {
      const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
      const r = await api.create({
        [cfg.deptField]: t(form.部门),
        [cfg.personField]: t(form.人),
        日期: today(),
        仓库: form.仓库.trim(),
        备注: t(form.备注),
        明细: ok.map(toSubmitLine),
      });
      notify(`${cfg.title}单已创建:${r.单号}`, "ok");
      setMode("view");
      set单号(r.单号);
      void qc.invalidateQueries({ queryKey: [cfg.key] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "创建失败", "err");
    } finally {
      setSaving(false);
    }
  };

  // ---------- 审核/反审核/删除 ----------
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      await fn();
      notify(ok, "ok");
      if (after === "reset") {
        reset();
        setMode("view");
        void qc.invalidateQueries({ queryKey: [cfg.key] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "操作失败", "err");
    }
  };

  // ---------- 批量审核(对照老系统 MaterialDocPage.batchApprove:逐张调审核接口,汇总成功/失败) ----------
  const doBatchApprove = async () => {
    const targets = [...batchSelected];
    if (targets.length === 0) return;
    setBatchRunning(true);
    let ok = 0;
    const fails: string[] = [];
    for (const no of targets) {
      try {
        await api.approve(no);
        ok++;
      } catch (e) {
        fails.push(errMsg(e));
      }
    }
    setBatchRunning(false);
    setBatchSelected(new Set());
    void qc.invalidateQueries({ queryKey: [cfg.key] });
    invalidateCrossPage(qc);
    if (fails.length === 0) {
      notify(`已审核 ${ok} 张`, "ok");
      setBatchOpen(false);
    } else {
      notify(`已审核 ${ok} 张,失败 ${fails.length} 张(${fails[0]})`, "err");
    }
  };

  // ---------- 打印(对照老系统 DetailDrawer 打印;无「单价」位脱敏 ***) ----------
  const doPrint = () => {
    if (!detail?.单头) return;
    printMaterialDoc(
      `${cfg.title}单 ${单号 ?? ""}`,
      { 单头: { ...detail.单头 }, 明细: detail.明细 ?? [] },
      {
        hidePrice: !can(cfg.menu, "单价"),
        headerFields: [
          { name: cfg.deptField, label: cfg.deptField },
          { name: cfg.personField, label: cfg.personField },
          { name: "仓库", label: "仓库" },
        ],
      },
    );
  };

  // ---------- 工具条 ----------
  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, onClick: () => setDialogOpen(true) },
    ...(mode === "new"
      ? [
          {
            key: "save",
            label: "保存",
            icon: FloppyDisk,
            perm: "保存" as const,
            primary: true,
            disabled: saving,
            onClick: () => void doSave(),
          },
        ]
      : []),
    // 批量审核:单据级动作(不依赖当前打开的单),对照老系统列表上方「批量审核」
    {
      key: "batch",
      label: "批量审核",
      icon: CheckCircle,
      perm: "审核" as const,
      success: true,
      onClick: () => {
        setBatchSelected(new Set());
        setBatchOpen(true);
      },
    },
    ...(isView
      ? [
          {
            key: "copy",
            label: "复制单",
            icon: Copy,
            perm: "保存" as const,
            onClick: copyDoc,
          },
        ]
      : []),
    ...(isView && !isAudited
      ? [
          {
            key: "del",
            label: "删除",
            icon: Trash,
            perm: "删除" as const,
            danger: true,
            onClick: () => setDeleteOpen(true),
          },
        ]
      : []),
  ];
  const auditActions: DocAction[] = [
    ...(isView && !isAudited
      ? [
          {
            key: "audit",
            label: "审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => api.approve(单号!), "已审核", "reload"),
          },
        ]
      : []),
    ...(isView && isAudited
      ? [
          {
            key: "unaudit",
            label: "反审核",
            icon: ArrowCounterClockwise,
            perm: "反审核" as const,
            danger: true,
            onClick: () => void act(() => api.unapprove(单号!), "已反审核", "reload"),
          },
        ]
      : []),
  ];
  const printActions: DocAction[] = isView
    ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint }]
    : [];

  // ---------- 查看态单头卡 ----------
  const mainFields: HeaderField[] = header
    ? [
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        { label: cfg.deptField, value: txt(header[cfg.deptField] as string), mono: true },
        { label: cfg.personField, value: txt(header[cfg.personField] as string), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "金额", value: money(header.金额), mono: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
      ]
    : [];

  // 打开弹窗列(size=百分比,合计 100)
  const openColumns = useMemo<ColumnDef<UsageDocHeader, any>[]>(() => {
    const c = createColumnHelper<UsageDocHeader>();
    return [
      c.accessor("单号", {
        header: `${cfg.title}单号`,
        size: 24,
        cell: (x) => txt(x.getValue()),
        meta: { tdClass: "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]" },
      }),
      c.accessor("日期", {
        header: "日期",
        size: 14,
        cell: (x) => fmtDate(x.getValue()),
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      c.accessor(cfg.deptField, {
        header: cfg.deptField,
        size: 14,
        cell: (x) => txt(x.getValue() as string),
        meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      c.accessor(cfg.personField, {
        header: cfg.personField,
        size: 12,
        cell: (x) => txt(x.getValue() as string),
        meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      c.accessor("仓库", {
        header: "仓库",
        size: 12,
        cell: (x) => txt(x.getValue()),
        meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      c.accessor("数量", {
        header: "数量",
        size: 10,
        cell: (x) => fmtNum(x.getValue(), 0),
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]" },
      }),
      c.accessor("审核", {
        header: "状态",
        size: 14,
        cell: (x) =>
          x.getValue() === "1" ? (
            <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
              已审核
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
              未审核
            </span>
          ),
        meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
      }),
    ];
  }, [cfg]);

  const basisFiltered = basis货号
    ? basisRows.filter((r) => (r.货号 ?? "") === basis货号)
    : basisRows;
  const pickable = 可挑选档(form.仓库);

  // 下推/消息入口:URL ?doc=单号 直开该单(查看态),消费后清参(同 MaterialIssuePage)
  const [searchParams, setSearchParams] = useSearchParams();
  const docParam = searchParams.get("doc");
  if (docParam && (mode !== "view" || 单号 !== docParam)) {
    setMode("view");
    set单号(docParam);
  }
  useEffect(() => {
    if (!docParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("doc");
    setSearchParams(next, { replace: true });
  }, [docParam, searchParams, setSearchParams]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          {cfg.title}单
          {tab === "doc" && (isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : "")}
        </h1>
        {tab === "doc" && isView && <AuditBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: `${cfg.title}单` },
              { key: "query" as const, label: `${cfg.title}单查询` },
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
          {tab === "doc" && <FlowSteps steps={["开单", "审核"]} current={isAudited ? 2 : isView ? 1 : 0} />}
        </div>
      </div>

      {tab === "query" ? (
        <QueryPanel
          cfg={cfg}
          onOpenDoc={(no) => {
            setTab("doc");
            setMode("view");
            set单号(no);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={cfg.menu} />
            {auditActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={auditActions} menuKey={cfg.menu} />
              </>
            )}
            {printActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={printActions} menuKey={cfg.menu} />
              </>
            )}
          </div>

          {mode === "new" ? (
            <HeaderForm
              cfg={cfg}
              form={form}
              setForm={setForm}
              操作员={currentUser}
              onPickEmployee={() => {
                setEmpKw("");
                setEmpPickOpen(true);
              }}
            />
          ) : detailQuery.isLoading ? (
            <div className="f-panel p-6">
              <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full bg-black/5" />
                ))}
              </div>
            </div>
          ) : detailQuery.isError ? (
            <div className="f-panel p-6">
              <DocError message="单据加载失败,请重试或重新打开" onRetry={() => detailQuery.refetch()} />
            </div>
          ) : !header ? (
            <div className="f-panel p-6">
              <DocEmpty
                icon={<FolderOpen className="h-5 w-5" />}
                title="尚未打开单据"
                description={`点击上方「打开」选择一张${cfg.title}单,或点「新建」开一张新单`}
                action={
                  <button
                    type="button"
                    className="f-btn f-btn-cyan px-5"
                    onClick={() => setDialogOpen(true)}
                  >
                    <FolderOpen className="h-5 w-5" />
                    打开单据
                  </button>
                }
              />
            </div>
          ) : (
            <DocHeaderCard fields={mainFields} extra={extraFields} />
          )}

          {mode === "new" ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1a2330]">物料明细</h2>
                <span className="f-mono text-sm text-[#5f6b7d]">{rows.length} 行</span>
              </div>
              <LinesEditor
                rows={rows}
                stockMap={stockMap}
                onPatch={patchRow}
                onRemove={removeRow}
                onAddLine={() => setRows((rs) => [...rs, { key: uid(), 数量: "0" }])}
                onPickProduction={(key) => {
                  setProdKw("");
                  setProdPickFor(key);
                }}
                onPickMaterial={(key) => {
                  setMaterialKw("");
                  setMaterialPickFor(key);
                }}
                onOpenBasis={openBasis}
                basis说明={issueBasis档说明(form.仓库)}
              />
              <div className="f-mono text-sm text-[#5f6b7d]">制单人:{currentUser}</div>
            </div>
          ) : (
            header &&
            !detailQuery.isLoading &&
            !detailQuery.isError && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[#1a2330]">物料明细</h2>
                  <span className="f-mono text-sm text-[#5f6b7d]">{detail?.明细.length ?? 0} 行</span>
                </div>
                {(detail?.明细.length ?? 0) === 0 ? (
                  <div className="f-panel">
                    <DocEmpty
                      icon={<Prohibit className="h-5 w-5" />}
                      title="暂无物料明细"
                      description="该单据还没有录入明细行"
                    />
                  </div>
                ) : (
                  <LinesView lines={detail?.明细 ?? []} />
                )}
              </div>
            )
          )}
        </>
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title={`打开${cfg.title}单`}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder={`单号 / ${cfg.personField} / 备注`}
        onPick={(h) => {
          if (h.单号) {
            setMode("view");
            set单号(h.单号);
          }
          setDialogOpen(false);
        }}
        footer={
          <>
            <span className="f-mono">
              共 {listQuery.data?.total ?? 0} 单,第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="f-btn h-10 px-3.5 text-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <CaretLeft className="h-4 w-4" />
                上一页
              </button>
              <button
                type="button"
                className="f-btn h-10 px-3.5 text-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
                <CaretRight className="h-4 w-4" />
              </button>
            </div>
          </>
        }
        description={`按单号、${cfg.personField}或备注搜索,点击一行打开`}
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint={`没有匹配的${cfg.title}单,换个关键字试试`}
      />

      {/* 批量审核(多选模式,只列未审核单;分页/关键字与打开弹窗共用) */}
      <OpenDocDialog
        title={`批量审核${cfg.title}单`}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        columns={openColumns}
        rows={(listQuery.data?.items ?? []).filter((h) => h.审核 !== "1")}
        searchPlaceholder={`单号 / ${cfg.personField} / 备注`}
        onPick={() => {}}
        selection={{
          selected: batchSelected,
          onChange: (next) => setBatchSelected(next),
          rowId: (h) => h.单号 ?? "",
        }}
        footer={
          <>
            <span className="f-mono">已选 {batchSelected.size} 张未审核单</span>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-5 text-sm"
              disabled={batchSelected.size === 0 || batchRunning}
              onClick={() => void doBatchApprove()}
            >
              {batchRunning ? "审核中..." : "批量审核"}
            </button>
          </>
        }
        description="勾选要审核的单据,逐张调审核接口"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="没有待审核的单据"
      />

      {/* 选择物料 */}
      <PickerDialog
        open={materialPickFor !== null}
        onClose={() => setMaterialPickFor(null)}
        title="选择物料"
        width="sm:max-w-[860px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMaterialKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="物料编号/名称/规格/颜色/供应商" aria-label="物料搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["物料编号", "物料名称", "规格", "材料", "颜色", "单位", "库存"].map((h) => (
                <th key={h} className={cn(pickerThCls, h === "库存" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(materialsQuery.data?.items ?? []).map((m, i) => (
              <tr
                key={m.ID ?? i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  if (materialPickFor === null) return;
                  patchRow(materialPickFor, {
                    物料编号: m.物料编号 ?? "",
                    物料名称: m.物料名称 ?? "",
                    物料类别: m.物料类别 ?? undefined,
                    规格: m.规格 ?? undefined,
                    颜色: m.颜色 ?? undefined,
                    单位: m.单位 ?? undefined,
                  });
                  setMaterialPickFor(null);
                }}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{m.物料编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.物料名称}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.规格}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.物料类别}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.颜色}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.单位}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{m.库存 ?? ""}</td>
              </tr>
            ))}
            {materialsQuery.isSuccess && (materialsQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 选择生产制单(仅列已审核;回填 生产单号/款号) */}
      <PickerDialog
        open={prodPickFor !== null}
        onClose={() => setProdPickFor(null)}
        title="选择生产制单(仅列已审核)"
        width="sm:max-w-[860px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setProdKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="生产单号/款号/款式/客户" aria-label="生产单搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["生产单号", "款号", "款式", "客户名称", "计划数量", "交货日期"].map((h) => (
                <th key={h} className={cn(pickerThCls, h === "计划数量" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(prodQuery.data ?? []).map((p: ProductionTrackingRow, i: number) => (
              <tr
                key={`${p.生产单号}-${i}`}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  if (prodPickFor === null) return;
                  patchRow(prodPickFor, {
                    生产单号: p.生产单号 ?? undefined,
                    款号: p.款号 ?? undefined,
                  });
                  setProdPickFor(null);
                }}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{p.生产单号}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{p.款号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.款式}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.客户名称}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{p.计划数量 ?? ""}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{date10(p.交货日期)}</td>
              </tr>
            ))}
            {prodQuery.isSuccess && (prodQuery.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的生产制单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 选择人员(人事档案;点行回填 退料人/报废人) */}
      <PickerDialog
        open={empPickOpen}
        onClose={() => setEmpPickOpen(false)}
        title="选择人员(人事档案)"
        width="sm:max-w-[560px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setEmpKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="编号/姓名" aria-label="人员搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["编号", "姓名", "部门", "职称"].map((h) => (
                <th key={h} className={pickerThCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(empQuery.data?.items ?? []).map((emp, i) => (
              <tr
                key={emp.编号 ?? i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  setForm({ 人: emp.姓名 ?? "" });
                  setEmpPickOpen(false);
                }}
              >
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{emp.编号}</td>
                <td className="px-3 py-2 text-[#1a2330]">{emp.姓名}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{emp.部门编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{emp.职称}</td>
              </tr>
            ))}
            {empQuery.isSuccess && (empQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的人员
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 按生产单带入:来料/塑胶档 = 多单合并按货号挑选(默认全选);半成品/成品档 = 单调入现存 */}
      {pickable ? (
        <PickerDialog
          open={basisOpen}
          onClose={closeBasis}
          title={`按生产单带入 · 按货号挑选应领明细`}
          width="sm:max-w-[1000px]"
          footer={
            <>
              <span className="text-sm text-[#5f6b7d]">
                口径跟随表头仓库({form.仓库 || "未填"}:{issueBasis档说明(form.仓库)});已选{" "}
                {basisSel.length} / 共 {basisRows.length} 行;当前空白行会被替换
              </span>
              <button
                type="button"
                className="f-btn f-btn-cyan h-10 px-5 text-sm"
                disabled={basisSel.length === 0}
                onClick={confirmIssueBasisPick}
              >
                确定带入
              </button>
            </>
          }
        >
          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void loadIssueBasisPick();
            }}
          >
            <textarea
              className={cn(inputCls, "h-auto min-h-10 w-full rounded-md border px-3 py-2")}
              rows={2}
              aria-label="生产单号输入"
              placeholder="输入生产单号,多个用逗号/空格/换行分隔"
              value={basisNo}
              onChange={(e) => setBasisNo(e.target.value)}
            />
            <button type="submit" className="f-btn f-btn-cyan h-10 shrink-0 px-5 text-sm" disabled={basisLoading}>
              调入
            </button>
          </form>
          {basisRows.length > 0 && (
            <>
              <div className="mt-3 flex items-center gap-2">
                <span className="f-label">货号筛选</span>
                <SearchSelect
                  ariaLabel="货号筛选"
                  className={cn(inputCls, "h-9 w-44 rounded-md border")}
                  value={basis货号}
                  options={distinct货号(basisRows).map((v) => ({ value: v, label: v || "(空)" }))}
                  placeholder="全部货号"
                  clearLabel="全部货号"
                  onChange={(v) => setBasis货号(v)}
                />
              </div>
              <table className="mt-3 w-full text-[15px]">
                <thead>
                  <tr>
                    <th className={cn(pickerThCls, "w-10 text-center")}>
                      <input
                        type="checkbox"
                        aria-label="全选"
                        checked={basisSel.length === basisRows.length && basisRows.length > 0}
                        onChange={(e) =>
                          setBasisSel(e.target.checked ? basisRows.map(issueBasisKey) : [])
                        }
                      />
                    </th>
                    {["货号", "生产单号", "物料编号", "物料名称", "规格", "颜色", "单位", "应领数量"].map((h) => (
                      <th key={h} className={cn(pickerThCls, h === "应领数量" && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {basisFiltered.map((r) => {
                    const k = issueBasisKey(r);
                    const checked = basisSel.includes(k);
                    return (
                      <tr
                        key={k}
                        className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                        onClick={() =>
                          setBasisSel((sel) => (checked ? sel.filter((x) => x !== k) : [...sel, k]))
                        }
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${r.物料编号}`}
                            checked={checked}
                            onChange={() =>
                              setBasisSel((sel) => (checked ? sel.filter((x) => x !== k) : [...sel, k]))
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.货号 ?? ""}</td>
                        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.生产单号}</td>
                        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{r.物料编号}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色 ?? ""}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                        <td className="f-mono px-3 py-2 text-right font-semibold text-[#1a2330]">{r.数量}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {basisLoading && (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full bg-black/5" />
              ))}
            </div>
          )}
        </PickerDialog>
      ) : (
        <PickerDialog
          open={basisOpen}
          onClose={closeBasis}
          title="按生产单带入应领明细"
          width="sm:max-w-[480px]"
          footer={
            <span className="text-sm text-[#5f6b7d]">
              口径跟随表头仓库({form.仓库 || "未填"}:{issueBasis档说明(form.仓库)});可改完再保存;当前空白行会被替换
            </span>
          }
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void bringIssueBasis();
            }}
          >
            <Input
              className={inputCls}
              aria-label="生产单号输入"
              placeholder="输入生产单号,回车带入"
              value={basisNo}
              onChange={(e) => setBasisNo(e.target.value)}
            />
            <button type="submit" className="f-btn f-btn-cyan h-10 shrink-0 px-5 text-sm" disabled={basisLoading}>
              带入
            </button>
          </form>
        </PickerDialog>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`确认删除该${cfg.title}单?`}
        description={`${单号} 删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => api.remove(单号!), "已删除", "reset");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
