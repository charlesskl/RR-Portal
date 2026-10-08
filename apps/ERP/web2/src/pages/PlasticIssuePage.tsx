import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Checks,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Plus,
  Printer,
  Prohibit,
  Trash,
} from "@phosphor-icons/react";
import {
  plasticInventoryApi,
  plasticIssueApi,
  plasticMaterialMasterApi,
  plasticMaterialSettingsApi,
  productionApi,
  productionReportApi,
} from "@/api/endpoints";
import type {
  IssueBasisRow,
  PlasticIssueHeader,
  PlasticIssueLine,
  PlasticMaterialRow,
  ProductionTrackingRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  basisRowToLine,
  distinct货号,
  issueBasisKey,
  mergeIssueBasisRows,
  parse生产单号s,
  prefillDefaultWarehouse,
  printPlasticIssue,
  stockRefRows,
  sumQty,
  toSubmitLine,
  validLines,
  type EditLine,
} from "@/lib/plasticIssue";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocHeaderCard, type HeaderField } from "@/components/doc/DocHeaderCard";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { usePerms } from "@/hooks/usePerms";
import { PlasticIssueQueryPanel } from "./PlasticIssueQueryPanel";

// 塑胶领料单(塑胶仓;审核=出库)。对照老系统:
// web/src/pages/plastics/PlasticIssueFormPage.tsx + PlasticIssueLineTable.tsx。
// 权限菜单名 = 后端 MenuCatalog「塑胶领料单」(菜单 label 带「(塑胶仓)」后缀,不等于权限键,
// 故 DocToolbar 一律显式传 menuKey)。查询页签权限菜单为「塑胶领料查询」。
const MENU = "塑胶领料单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
// ISO 格式:后端 DateTime 反序列化要求(老系统同款 today())
const today = () => new Date().toISOString().slice(0, 10);

let rowSeq = 1;
const uid = () => rowSeq++;

// 三级流转:未审核 -> 主管已审 -> 经理已审 -> 已审核(塑胶仓已出库)
const audited = (h?: PlasticIssueHeader | null) => h?.审核 === "1";

// ---------- 审核徽章 / 状态小徽章 ----------

function StatusText({ header }: { header?: PlasticIssueHeader | null }) {
  if (audited(header)) return "已审核";
  if (header?.经理审核 === "1")
    return `经理已审${header.经理审核人 ? `(${header.经理审核人})` : ""}`;
  if (header?.主管审核 === "1")
    return `主管已审${header.主管审核人 ? `(${header.主管审核人})` : ""}`;
  return "未审核";
}

function AuditBadge({ header }: { header?: PlasticIssueHeader | null }) {
  const s = StatusText({ header });
  if (audited(header))
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/60 bg-[#16a34a]/10 px-4 py-1.5 text-sm font-semibold text-[#15803d] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_12px_-2px_rgb(22_163_74/0.35)]">
        <span className="f-pulse h-2 w-2 rounded-full bg-[#16a34a]" />
        {s}
      </span>
    );
  const mid = header?.主管审核 === "1";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold",
        mid
          ? "border-[#d97706]/50 bg-[#d97706]/10 text-[#b45309]"
          : "border-black/10 bg-black/5 text-[#5f6b7d]",
      )}
    >
      {s}
    </span>
  );
}

function StatusPill({ row }: { row: PlasticIssueHeader }) {
  const s = StatusText({ header: row });
  if (row.审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
        {s}
      </span>
    );
  if (row.主管审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2.5 py-1 text-xs font-semibold text-[#b45309]">
        {s}
      </span>
    );
  return (
    <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
      {s}
    </span>
  );
}

// ---------- 表头表单(新建态) ----------

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

interface HeaderFormState {
  领料部门: string;
  领料人: string;
  仓库: string;
  收件人: string;
  领料备注: string;
  备注: string;
  胶箱数: string;
  纸箱数: string;
  钙塑箱数: string;
  卡板数: string;
}

const emptyHeader = (): HeaderFormState => ({
  领料部门: "",
  领料人: "",
  仓库: "",
  收件人: "",
  // 领料备注默认「生产领料」(对照老系统 reset)
  领料备注: "生产领料",
  备注: "",
  胶箱数: "",
  纸箱数: "",
  钙塑箱数: "",
  卡板数: "",
});

const 领料备注选项 = ["生产领料", "样品领料", "维修领料"];

function HeaderForm({
  form,
  setForm,
  操作员,
}: {
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  操作员: string;
}) {
  const bind = (k: keyof HeaderFormState) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ [k]: e.target.value }),
  });
  const numBind = (k: keyof HeaderFormState) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ [k]: e.target.value }),
  });
  return (
    <div className="f-panel p-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="领料部门">
          <Input className={inputCls} aria-label="领料部门" placeholder="直接填写部门" {...bind("领料部门")} />
        </FormField>
        <FormField label="领料人">
          <div className="relative">
            <Input className={inputCls} aria-label="领料人" placeholder="直接填写领料人" {...bind("领料人")} />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="仓库">
          <div className="relative">
            <Input className={inputCls} aria-label="仓库" placeholder="塑胶仓" {...bind("仓库")} />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="日期">
          <Input className={inputCls} aria-label="日期" value={today()} disabled />
        </FormField>
        <FormField label="操作员">
          <Input className={inputCls} aria-label="操作员" value={操作员} disabled />
        </FormField>
        <FormField label="电脑单号">
          <Input className={inputCls} value="" disabled placeholder="保存后自动生成" />
        </FormField>
        <FormField label="收件人">
          <Input className={inputCls} aria-label="收件人" {...bind("收件人")} />
        </FormField>
        <FormField label="领料备注">
          <SearchSelect
            ariaLabel="领料备注"
            className={cn(inputCls, "w-full rounded-md border px-2")}
            value={form.领料备注}
            options={领料备注选项.map((v) => ({ value: v, label: v }))}
            onChange={(v) => setForm({ 领料备注: v })}
          />
        </FormField>
        <FormField label="胶箱数">
          <Input type="number" min={0} className={cn(inputCls, "f-mono")} aria-label="胶箱数" {...numBind("胶箱数")} />
        </FormField>
        <FormField label="纸箱">
          <Input type="number" min={0} className={cn(inputCls, "f-mono")} aria-label="纸箱数" {...numBind("纸箱数")} />
        </FormField>
        <FormField label="钙塑箱">
          <Input type="number" min={0} className={cn(inputCls, "f-mono")} aria-label="钙塑箱数" {...numBind("钙塑箱数")} />
        </FormField>
        <FormField label="卡板数">
          <Input type="number" min={0} className={cn(inputCls, "f-mono")} aria-label="卡板数" {...numBind("卡板数")} />
        </FormField>
      </div>
      <div className="mt-4">
        <FormField label="备注">
          <textarea
            className={cn(inputCls, "h-auto min-h-16 w-full rounded-md border px-3 py-2")}
            rows={2}
            aria-label="备注"
            {...bind("备注")}
          />
        </FormField>
      </div>
    </div>
  );
}

// ---------- 明细:编辑网格(保真列序照抄 PlasticIssueLineTable) ----------

function LinesEditor({
  rows,
  onPatch,
  onRemove,
  onAddLine,
  onPickProduction,
  onPickMaterial,
  onOpenBasis,
}: {
  rows: EditLine[];
  onPatch: (key: number, patch: Partial<EditLine>) => void;
  onRemove: (key: number) => void;
  onAddLine: () => void;
  onPickProduction: (key: number) => void;
  onPickMaterial: (key: number) => void;
  onOpenBasis: () => void;
}) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
  const cellInput = (
    r: EditLine,
    k: keyof EditLine,
    label: string,
    w: string,
  ) => (
    <Input
      className={cn(inputCls, "h-9", w)}
      aria-label={label}
      value={(r[k] as string | undefined) ?? ""}
      onChange={(e) => onPatch(r.key, { [k]: e.target.value })}
    />
  );
  // 「输入框+选钮」单元格:可手输,点「选」弹选择器(对照老系统 pickCell 的放大镜)
  const pickCell = (
    r: EditLine,
    k: keyof EditLine,
    label: string,
    w: string,
    onPick: () => void,
  ) => (
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
          按生产单带入为应领量(接单数×BOM用量,塑胶档),可改完再保存;当前空白行会被替换
        </span>
      </div>
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1400px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "序号",
                "装配采购",
                "生产单号",
                "款号",
                "物料编号",
                "模具编号",
                "物料名称",
                "颜色",
                "色粉号",
                "用料名称",
                "单位",
                "数量",
                "操作",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(thCls, h === "数量" && "text-right", h === "操作" && "text-center")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-6 text-center text-sm text-disabled">
                  还没有明细行,点「加一行」手选物料,或「按生产单带入」应领明细
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.key} className="border-b border-black/6 last:border-0">
                  <td className="px-3 py-2 text-disabled">{i + 1}</td>
                  <td className="px-3 py-2">{cellInput(r, "装配采购", "装配采购", "w-20")}</td>
                  <td className="px-3 py-2">
                    {pickCell(r, "生产单号", "生产单号", "w-28", () => onPickProduction(r.key))}
                  </td>
                  <td className="px-3 py-2">
                    {pickCell(r, "款号", "款号", "w-24", () => onPickProduction(r.key))}
                  </td>
                  <td className="px-3 py-2">
                    {pickCell(r, "物料编号", "物料编号", "w-28", () => onPickMaterial(r.key))}
                  </td>
                  <td className="px-3 py-2">{cellInput(r, "模具编号", "模具编号", "w-24")}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                  <td className="px-3 py-2">{cellInput(r, "颜色", "颜色", "w-20")}</td>
                  <td className="px-3 py-2">{cellInput(r, "色粉号", "色粉号", "w-20")}</td>
                  <td className="px-3 py-2">{cellInput(r, "用料名称", "用料名称", "w-24")}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
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
              ))
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

// ---------- 明细:查看态(只读) ----------

function LinesView({ lines }: { lines: PlasticIssueLine[] }) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 text-left font-medium whitespace-nowrap normal-case";
  return (
    <div className="f-panel overflow-hidden">
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1500px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "装配采购",
                "生产单号",
                "款号",
                "物料编号",
                "模具编号",
                "物料名称",
                "规格",
                "颜色",
                "色粉号",
                "用料名称",
                "仓位号",
                "单位",
                "数量",
                "备注",
              ].map((h) => (
                <th key={h} className={cn(thCls, h === "数量" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.ID ?? i} className="h-11 border-b border-black/6 last:border-0">
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.装配采购)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#15803d]">{txt(l.生产单号)}</td>
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(l.款号)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">{txt(l.物料编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.模具编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.色粉号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.用料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.仓位号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.备注)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 库存参考(明细内 distinct 物料的现存量;对照老系统「库存参考」表) ----------

function StockRefPanel({
  lines,
}: {
  lines: { 物料编号?: string; 物料名称?: string; 库存数量: number }[];
}) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
  return (
    <div className="f-panel overflow-hidden">
      <div className="border-b border-black/8 px-4 py-2.5 text-sm font-medium text-[#3d4a5c]">
        库存参考
      </div>
      <div className="max-h-[220px] overflow-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              <th className={thCls}>序号</th>
              <th className={thCls}>物料编号</th>
              <th className={thCls}>物料名称</th>
              <th className={cn(thCls, "text-right")}>库存数量</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-sm text-disabled">
                  明细行选了物料且表头填了仓库后,这里显示对应现存量
                </td>
              </tr>
            ) : (
              lines.map((r, i) => (
                <tr key={r.物料编号} className="border-b border-black/6 last:border-0">
                  <td className="px-3 py-2 text-disabled">{i + 1}</td>
                  <td className="f-mono px-3 py-2 text-[#1a2330]">{r.物料编号}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{r.库存数量}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 打开单据弹窗列(列宽按百分比,合计 100) ----------

const openCol = createColumnHelper<PlasticIssueHeader>();

const openColumns: ColumnDef<PlasticIssueHeader, any>[] = [
  openCol.accessor("单号", {
    header: "领料单号",
    size: 22,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 13,
    cell: (c) => fmtDate(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("领料部门", {
    header: "领料部门",
    size: 15,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
  }),
  openCol.accessor("领料人", {
    header: "领料人",
    size: 12,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("仓库", {
    header: "仓库",
    size: 10,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("数量", {
    header: "数量",
    size: 9,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]" },
  }),
  openCol.display({
    id: "状态",
    header: "状态",
    size: 19,
    cell: (c) => <StatusPill row={c.row.original} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

// ---------- 页面 ----------

export default function PlasticIssuePage() {
  const qc = useQueryClient();
  const currentUser = getUser() || "用户";
  const { can } = usePerms();

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [rows, setRows] = useState<EditLine[]>([]);
  const [saving, setSaving] = useState(false);

  // 弹窗开关
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false); // 批量审核弹窗(多选模式,只列未审核单)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()); // 勾选的未审核单号
  const [batchRunning, setBatchRunning] = useState(false); // 批量审核中
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [materialPickFor, setMaterialPickFor] = useState<number | null>(null);
  const [materialKw, setMaterialKw] = useState("");
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);
  const [prodKw, setProdKw] = useState("");
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

  // 首次进入自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: ["plastic-issue", "first"],
    queryFn: () => plasticIssueApi.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  const detailQuery = useQuery({
    queryKey: ["plastic-issue", "detail", 单号],
    queryFn: () => plasticIssueApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["plastic-issue", "list", page, keyword],
    queryFn: () => plasticIssueApi.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen || batchOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;
  // 批量审核只列未审核单(后端列表无审核过滤,本页内前端过滤;老系统同口径:勾选的已审核单跳过)
  const batchRows = (listQuery.data?.items ?? []).filter((r) => r.审核 !== "1");

  const materialsQuery = useQuery({
    queryKey: ["plastic-issue", "materials", materialKw],
    queryFn: () => plasticMaterialMasterApi.list(undefined, materialKw || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: materialPickFor !== null,
  });

  const prodQuery = useQuery({
    queryKey: ["plastic-issue", "productions", prodKw],
    queryFn: () => productionReportApi.tracking(prodKw || undefined, "1"),
    placeholderData: keepPreviousData,
    enabled: prodPickFor !== null,
  });

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = audited(header);

  // 库存参考:表头仓库(新建=表单值;查看=单头值)对应的塑胶库存
  const stock仓库 = mode === "new" ? form.仓库.trim() : (header?.仓库 ?? "").trim();
  const stockQuery = useQuery({
    queryKey: ["plastic-issue", "stock", stock仓库],
    queryFn: () => plasticInventoryApi.list(stock仓库),
    enabled: stock仓库 !== "",
  });
  const stockMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of stockQuery.data ?? []) if (r.物料编号) m[r.物料编号] = r.库存数量;
    return m;
  }, [stockQuery.data]);
  const stockLines = mode === "new" ? rows : (detail?.明细 ?? []);
  const stockRef = stockRefRows(stockLines, stockMap);

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));
  const patchRow = (key: number, patch: Partial<EditLine>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  // ---------- 新建 ----------
  const reset = () => {
    setMode("new");
    set单号(null);
    setFormState(emptyHeader());
    setRows([]);
  };

  // 选物料:回填名称/规格/颜色/仓位号/单位(对照老系统 fillFromMaterial);
  // 另按塑胶物料设置预填表头默认仓库(不覆盖已填)
  const fillFromMaterial = (m: PlasticMaterialRow) => {
    if (materialPickFor === null) return;
    patchRow(materialPickFor, {
      物料编号: m.物料编号 ?? "",
      物料名称: m.物料名称 ?? "",
      规格: m.规格 ?? undefined,
      颜色: m.颜色 ?? undefined,
      仓位号: m.仓位号 ?? undefined,
      单位: m.单位 ?? undefined,
    });
    setMaterialPickFor(null);
    const code = (m.物料编号 ?? "").trim();
    if (code) {
      plasticMaterialSettingsApi
        .lookup(code)
        .then((s) => {
          const wh = prefillDefaultWarehouse(form.仓库, s?.默认仓库);
          if (wh) setForm({ 仓库: wh });
        })
        .catch(() => {
          /* 未设置/不可达则不预填 */
        });
    }
  };

  // 选生产制单:回填生产单号/款号(对照老系统 fillFromProduction)
  const fillFromProduction = (p: ProductionTrackingRow) => {
    if (prodPickFor === null) return;
    patchRow(prodPickFor, {
      生产单号: p.生产单号 ?? undefined,
      款号: p.款号 ?? undefined,
    });
    setProdPickFor(null);
  };

  // ---------- 按生产单带入(批量领料 · 按货号挑选应领明细) ----------
  // 多单号输入解析 -> 逐单调 issue-basis(档=塑胶,按货号) -> 合并/排序/去重 -> 默认全选
  // 口径标注:多单合并 + 按货号带入超出老系统塑胶侧口径(老系统该能力原属来料侧
  // MaterialDocCreateDrawer,塑胶领料仅单生产单带入),待产品确认后再回写对照口径。
  const loadIssueBasisPick = async () => {
    const nos = parse生产单号s(basisNo);
    if (nos.length === 0) {
      setToast({ text: "请输入生产单号(多个用逗号/空格/换行分隔)", tone: "err" });
      return;
    }
    setBasisLoading(true);
    try {
      const groups: IssueBasisRow[][] = [];
      let empty = 0;
      for (const no of nos) {
        const rs = await productionApi.issueBasis(no, "塑胶", true);
        if (rs.length === 0) empty++;
        else groups.push(rs);
      }
      const merged = mergeIssueBasisRows(groups);
      if (merged.length === 0) {
        setToast({ text: `生产单 ${nos.join("/")} 无塑胶应领明细`, tone: "err" });
        return;
      }
      if (empty > 0) setToast({ text: `${empty} 张生产单无应领明细,已跳过`, tone: "err" });
      setBasisRows(merged);
      setBasisSel(merged.map(issueBasisKey)); // 默认全选
      setBasis货号("");
    } catch (e) {
      setToast({ text: errMsg(e) || "应领明细调入失败", tone: "err" });
    } finally {
      setBasisLoading(false);
    }
  };

  // 确定带入:勾选的行映射成明细行(数量=应领量),丢弃空白行后追加
  const confirmIssueBasisPick = () => {
    const picked = basisRows.filter((r) => basisSel.includes(issueBasisKey(r)));
    if (picked.length === 0) {
      setToast({ text: "请先勾选要领的行", tone: "err" });
      return;
    }
    const mapped = picked.map((r) => basisRowToLine(r, r.生产单号 ?? "", uid()));
    setRows((prev) => [...prev.filter((l) => l.物料编号), ...mapped]);
    setToast({ text: `已带入 ${mapped.length} 行(应领量)`, tone: "ok" });
    closeBasis();
  };

  const closeBasis = () => {
    setBasisOpen(false);
    setBasisNo("");
    setBasisRows([]);
    setBasisSel([]);
    setBasis货号("");
  };

  // 下推入口:URL 带 ?basis=生产单号 时自动带入应领明细(从生产通知单「下推领料」跳入)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoBasisDone = useRef(false);
  useEffect(() => {
    const basis = searchParams.get("basis");
    if (!basis || autoBasisDone.current) return;
    autoBasisDone.current = true;
    setSearchParams({}, { replace: true }); // 先清参数,避免刷新/返回重复带入
    setMode("new");
    set单号(null);
    void (async () => {
      try {
        const rs = await productionApi.issueBasis(basis.trim(), "塑胶");
        if (rs.length === 0) {
          setToast({ text: `生产单 ${basis} 无塑胶应领明细`, tone: "err" });
          return;
        }
        setRows((prev) => [
          ...prev.filter((l) => l.物料编号),
          ...rs.map((r) => basisRowToLine(r, basis.trim(), uid())),
        ]);
        setToast({ text: `已带入 ${rs.length} 行(应领量)`, tone: "ok" });
      } catch (e) {
        setToast({ text: errMsg(e) || "按生产单带入失败", tone: "err" });
      }
    })();
  }, [searchParams, setSearchParams]);

  // ---------- 保存(只新建;塑胶领料单保存后不可改,后端无 PUT) ----------
  const doSave = async () => {
    if (!form.领料人.trim()) {
      setToast({ text: "请填领料人", tone: "err" });
      return;
    }
    if (!form.仓库.trim()) {
      setToast({ text: "请填仓库", tone: "err" });
      return;
    }
    const ok = validLines(rows);
    if (ok.length === 0) {
      setToast({ text: "请至少录入一行有效物料明细(物料编号+数量)", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const num = (s: string) => (s.trim() !== "" ? Number(s) : undefined);
      const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
      const r = await plasticIssueApi.create({
        领料部门: t(form.领料部门),
        领料人: t(form.领料人),
        仓库: form.仓库.trim(),
        收件人: t(form.收件人),
        领料备注: t(form.领料备注),
        备注: t(form.备注),
        胶箱数: num(form.胶箱数),
        纸箱数: num(form.纸箱数),
        钙塑箱数: num(form.钙塑箱数),
        卡板数: num(form.卡板数),
        明细: ok.map(toSubmitLine),
      });
      setToast({ text: `塑胶领料单已创建:${r.单号}`, tone: "ok" });
      setMode("view");
      set单号(r.单号);
      void qc.invalidateQueries({ queryKey: ["plastic-issue", "first"] });
      void qc.invalidateQueries({ queryKey: ["plastic-issue", "list"] });
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "创建失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // ---------- 审核流转(主管 -> 经理 -> 审核=出库) / 反审核 / 删除 ----------
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      await fn();
      setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        void qc.invalidateQueries({ queryKey: ["plastic-issue", "first"] });
        void qc.invalidateQueries({ queryKey: ["plastic-issue", "list"] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // ---------- 批量审核(对照老系统 PlasticIssueFormPage.batchApprove:对勾选的未审核单逐张调
  // 终审接口 approve(=出库),未走完三级流转的单会被后端拒绝,计入失败) ----------
  const doBatchApprove = async () => {
    const targets = [...selected];
    if (targets.length === 0) return;
    setBatchRunning(true);
    let ok = 0;
    const fails: string[] = [];
    for (const no of targets) {
      try {
        await plasticIssueApi.approve(no);
        ok++;
      } catch (e) {
        fails.push(errMsg(e));
      }
    }
    setBatchRunning(false);
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ["plastic-issue", "list"] });
    void qc.invalidateQueries({ queryKey: ["plastic-issue", "first"] });
    void qc.invalidateQueries({ queryKey: ["plastic-issue", "detail"] });
    invalidateCrossPage(qc);
    if (fails.length === 0) {
      setToast({ text: `已审核 ${ok} 张`, tone: "ok" });
      setBatchOpen(false);
    } else {
      setToast({
        text: `已审核 ${ok} 张,失败 ${fails.length} 张(${fails[0]})`,
        tone: "err",
      });
    }
  };

  // ---------- 工具条 ----------
  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, onClick: reset },
    {
      key: "open",
      label: "打开",
      icon: FolderOpen,
      primary: true,
      onClick: () => setDialogOpen(true),
    },
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
    ...(isView && !isAudited && header?.主管审核 !== "1"
      ? [
          {
            key: "sup",
            label: "主管审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(() => plasticIssueApi.supervisorApprove(单号!), "主管已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && header?.主管审核 === "1" && header?.经理审核 !== "1"
      ? [
          {
            key: "mgr",
            label: "经理审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(() => plasticIssueApi.managerApprove(单号!), "经理已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && header?.经理审核 === "1"
      ? [
          {
            key: "audit",
            label: "审核(出库)",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => plasticIssueApi.approve(单号!), "已审核(出库)", "reload"),
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
            onClick: () => void act(() => plasticIssueApi.unapprove(单号!), "已反审核", "reload"),
          },
        ]
      : []),
  ];

  // ---------- 打印:开新窗口渲染单头+明细(无价格列,与老系统表单页一致) ----------
  const doPrint = () => {
    if (!detail?.单头) return;
    printPlasticIssue(`塑胶领料单 ${单号 ?? ""}`, {
      单头: { ...detail.单头 },
      明细: (detail.明细 ?? []) as unknown as Record<string, unknown>[],
    });
  };
  const printActions: DocAction[] = isView
    ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint }]
    : [];
  // 批量审核:单据级动作(不依赖当前打开的单),老系统在历史列表上方,web2 落在工具条
  const batchActions: DocAction[] = [
    {
      key: "batch",
      label: "批量审核",
      icon: Checks,
      perm: "审核",
      success: true,
      onClick: () => {
        setSelected(new Set());
        setBatchOpen(true);
      },
    },
  ];

  // ---------- 查看态单头卡字段 ----------
  const mainFields: HeaderField[] = header
    ? [
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        { label: "领料部门", value: txt(header.领料部门), mono: true },
        { label: "领料人", value: txt(header.领料人), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "领料备注", value: txt(header.领料备注), mono: true },
        { label: "收件人", value: txt(header.收件人), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "电脑单号", value: txt(header.电脑单号), mono: true },
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "主管审核人", value: txt(header.主管审核人), mono: true },
        { label: "经理审核人", value: txt(header.经理审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
        { label: "胶箱数", value: header.胶箱数 ?? "-", mono: true },
        { label: "纸箱数", value: header.纸箱数 ?? "-", mono: true },
        { label: "钙塑箱数", value: header.钙塑箱数 ?? "-", mono: true },
        { label: "卡板数", value: header.卡板数 ?? "-", mono: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];

  const flowCurrent = isAudited
    ? 3
    : header?.经理审核 === "1"
      ? 2
      : header?.主管审核 === "1"
        ? 1
        : 0;

  const basisFiltered = basis货号
    ? basisRows.filter((r) => (r.货号 ?? "") === basis货号)
    : basisRows;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          塑胶领料单
          {tab === "doc" && (isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : "")}
        </h1>
        {tab === "doc" && isView && <AuditBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: "塑胶领料单" },
              { key: "query" as const, label: "塑胶领料查询" },
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
          {tab === "doc" && (
            <FlowSteps steps={["开单", "主管审核", "经理审核", "审核出库"]} current={flowCurrent} />
          )}
        </div>
      </div>

      {tab === "query" ? (
        <PlasticIssueQueryPanel
          onOpenDoc={(no) => {
            setTab("doc");
            setMode("view");
            set单号(no);
          }}
        />
      ) : (
        <>
          {/* 操作栏:编辑 / 审核流转 / 打印 三组,组间分隔线 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            {auditActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={auditActions} menuKey={MENU} />
              </>
            )}
            {can(MENU, "审核") && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={batchActions} menuKey={MENU} />
              </>
            )}
            {printActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={printActions} menuKey={MENU} />
              </>
            )}
          </div>

          {/* 单头:新建 = 表单;查看 = 只读单头卡(塑胶领料单保存后不可改) */}
          {mode === "new" ? (
            <HeaderForm form={form} setForm={setForm} 操作员={currentUser} />
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
              <DocError
                message="单据加载失败,请重试或重新打开"
                onRetry={() => detailQuery.refetch()}
              />
            </div>
          ) : !header ? (
            <div className="f-panel p-6">
              <DocEmpty
                icon={<FolderOpen className="h-5 w-5" />}
                title="尚未打开单据"
                description="点击上方「打开」选择一张塑胶领料单,或点「新建」开一张新单"
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

          {/* 明细 + 库存参考 */}
          {mode === "new" ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1a2330]">物料明细</h2>
                <span className="f-mono text-sm text-[#5f6b7d]">{rows.length} 行</span>
              </div>
              <LinesEditor
                rows={rows}
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
                onOpenBasis={() => setBasisOpen(true)}
              />
              <StockRefPanel lines={stockRef} />
              <div className="f-mono text-sm text-[#5f6b7d]">制单人:{currentUser}</div>
            </div>
          ) : (
            header &&
            !detailQuery.isLoading &&
            !detailQuery.isError && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[#1a2330]">物料明细</h2>
                  <span className="f-mono text-sm text-[#5f6b7d]">
                    {detail?.明细.length ?? 0} 行
                  </span>
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
                <StockRefPanel lines={stockRef} />
              </div>
            )
          )}
        </>
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开塑胶领料单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 领料人 / 备注"
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
                <CaretRight className="h-4 w-4" />
                下一页
              </button>
            </div>
          </>
        }
        description="按单号、领料人或备注搜索,点击一行打开"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="没有匹配的塑胶领料单,换个关键字试试"
      />

      {/* 批量审核(多选模式,只列未审核单;分页/关键字与打开弹窗共用) */}
      <OpenDocDialog
        title="批量审核塑胶领料单"
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        columns={openColumns}
        rows={batchRows}
        searchPlaceholder="单号 / 领料人 / 备注"
        onPick={() => {}}
        selection={{
          selected,
          onChange: setSelected,
          rowId: (r) => r.单号 ?? "",
        }}
        footer={
          <>
            <span className="f-mono">
              第 {page} / {totalPages} 页,已选 {selected.size} 张
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
              <button
                type="button"
                className="f-btn f-btn-cyan h-10 px-5 text-sm"
                disabled={selected.size === 0 || batchRunning}
                onClick={() => void doBatchApprove()}
              >
                <Checks className="h-4 w-4" />
                {batchRunning ? "审核中..." : "批量审核"}
              </button>
            </div>
          </>
        }
        description="仅列未审核单,勾选后逐张终审(出库);未走完主管/经理审核的单会被后端拒绝"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="本页没有未审核的塑胶领料单"
      />

      {/* 选择塑胶物料 */}
      <PickerDialog
        open={materialPickFor !== null}
        onClose={() => setMaterialPickFor(null)}
        title="选择塑胶物料"
        width="sm:max-w-[860px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMaterialKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="物料编号/名称/规格/颜色" aria-label="物料搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["物料编号", "物料名称", "规格", "颜色", "仓位号", "单位"].map((h) => (
                <th key={h} className={pickerThCls}>
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
                onClick={() => fillFromMaterial(m)}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{m.物料编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.物料名称}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.规格}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.颜色}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.仓位号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.单位}</td>
              </tr>
            ))}
            {materialsQuery.isSuccess && (materialsQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的塑胶物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 选择生产制单(仅列已审核) */}
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
              {["生产单号", "款号", "款式", "客户名称", "计划数量", "未完成", "交货日期"].map((h) => (
                <th
                  key={h}
                  className={cn(
                    pickerThCls,
                    (h === "计划数量" || h === "未完成") && "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(prodQuery.data ?? []).map((p, i) => (
              <tr
                key={`${p.生产单号}-${i}`}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => fillFromProduction(p)}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{p.生产单号}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{p.款号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.款式}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.客户名称}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{p.计划数量 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{p.未完成数 ?? ""}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{date10(p.交货日期)}</td>
              </tr>
            ))}
            {prodQuery.isSuccess && (prodQuery.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的生产制单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 批量领料:按生产单带入应领明细(多单合并,按货号挑选,默认全选) */}
      <PickerDialog
        open={basisOpen}
        onClose={closeBasis}
        title="批量领料 · 按货号挑选应领明细"
        width="sm:max-w-[1000px]"
        footer={
          <>
            <span className="text-sm text-[#5f6b7d]">
              塑胶档应领量(接单数×BOM用量);已选 {basisSel.length} / 共 {basisRows.length} 行;当前空白行会被替换
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
          <button
            type="submit"
            className="f-btn f-btn-cyan h-10 shrink-0 px-5 text-sm"
            disabled={basisLoading}
          >
            调入
          </button>
        </form>
        {basisRows.length > 0 && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <span className="f-label">货号筛选</span>
              <SearchSelect
                ariaLabel="货号筛选"
                className={cn(inputCls, "h-9 w-44 rounded-md border px-2")}
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
                  {["货号", "生产单号", "物料编号", "物料名称", "规格", "颜色", "单位", "应领数量"].map(
                    (h) => (
                      <th key={h} className={cn(pickerThCls, h === "应领数量" && "text-right")}>
                        {h}
                      </th>
                    ),
                  )}
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
                        setBasisSel((sel) =>
                          checked ? sel.filter((x) => x !== k) : [...sel, k],
                        )
                      }
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${r.物料编号}`}
                          checked={checked}
                          onChange={() =>
                            setBasisSel((sel) =>
                              checked ? sel.filter((x) => x !== k) : [...sel, k],
                            )
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
                      <td className="f-mono px-3 py-2 text-right font-semibold text-[#1a2330]">
                        {r.数量}
                      </td>
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

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该塑胶领料单?"
        description={`${单号} 删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => plasticIssueApi.remove(单号!), "已删除", "reset");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
