import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Export,
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
  materialIssueApi,
  materialMasterApi,
  productionApi,
  productionReportApi,
  semiInventoryApi,
  stylesApi,
} from "@/api/endpoints";
import type {
  AssemblyIssueRow,
  IssueBasisRow,
  MasterMaterialRow,
  MaterialIssueHeader,
  MaterialDocLine,
  ProductionTrackingRow,
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
import { printMaterialDoc } from "@/lib/printMaterialDoc";
import { usePerms } from "@/hooks/usePerms";
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
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { MaterialIssueQueryPanel } from "./MaterialIssueQueryPanel";
import { MaterialIssueOutboundDialog } from "./MaterialIssueOutboundDialog";

// 来料领料单(来料仓;审核=出库)。对照老系统:
// web/src/pages/materials/MaterialDocPage.tsx + MaterialDocCreateDrawer.tsx +
// MaterialLineTable.tsx(usageCols 模式) + MaterialIssueQueryPage.tsx。
// 权限菜单名 = 后端 MenuCatalog「来料领料单」(旧名「领料单」已迁移平移;查询页签与单据共用该菜单,
// 后端 MaterialIssueController 对 issue-query 同样以「来料领料单」鉴权,MenuCatalog 无独立查询菜单)。
// DocToolbar 一律显式传 menuKey(菜单 label 可能带后缀,不等于权限键)。
const MENU = "来料领料单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
// ISO 格式:后端 DateTime 反序列化要求(老系统同款 today())
const today = () => new Date().toISOString().slice(0, 10);

let rowSeq = 1;
const uid = () => rowSeq++;

// 三级流转:未审核 -> 主管已审 -> 经理已审 -> 已审核(整单出库)
const audited = (h?: MaterialIssueHeader | null) => h?.审核 === "1";

// ---------- 审核徽章 / 状态小徽章(状态文案照抄老系统 MaterialDocPage 领料单列) ----------

function StatusText({ header }: { header?: MaterialIssueHeader | null }) {
  if (audited(header)) return "出库完成";
  if (header?.经理审核 === "1") return "待出库";
  if (header?.主管审核 === "1") return "待经理审核";
  return "待主管审核";
}

function AuditBadge({ header }: { header?: MaterialIssueHeader | null }) {
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

function StatusPill({ row }: { row: MaterialIssueHeader }) {
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

// ---------- 表头表单(新建态;字段/默认值照抄 materialDocConfigs["material-issues"]) ----------

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
  接受人: string;
  备注: string;
}

const emptyHeader = (): HeaderFormState => ({
  // 部门默认「装配部」,仓库默认「来料仓」(对照老系统 defaultValue)
  领料部门: "装配部",
  领料人: "",
  仓库: "来料仓",
  接受人: "",
  备注: "",
});

// 仓库下拉决定「按生产单带入」口径与明细「库存」列数据源(来料仓/塑胶仓/半成品仓/成品仓)
const 仓库选项 = ["来料仓", "塑胶仓", "半成品仓", "成品仓"];

function HeaderForm({
  form,
  setForm,
  操作员,
  recipients,
  onPickEmployee,
}: {
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  操作员: string;
  recipients: string[];
  onPickEmployee: () => void;
}) {
  const bind = (k: keyof HeaderFormState) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ [k]: e.target.value }),
  });
  return (
    <div className="f-panel p-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="部门">
          <Input className={inputCls} aria-label="领料部门" placeholder="直接填写部门" {...bind("领料部门")} />
        </FormField>
        <FormField label="日期">
          <Input className={inputCls} aria-label="日期" value={today()} disabled />
        </FormField>
        <FormField label="领料人">
          <div className="flex items-center gap-1">
            <Input
              className={inputCls}
              aria-label="领料人"
              placeholder="点「选」从人事档案选人"
              readOnly
              value={form.领料人}
            />
            <button
              type="button"
              aria-label="领料人选择"
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
            <SearchSelect
              ariaLabel="仓库"
              className={cn(inputCls, "rounded-md border")}
              value={form.仓库}
              options={仓库选项.map((v) => ({ value: v, label: v }))}
              onChange={(v) => setForm({ 仓库: v })}
            />
            <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="接受人">
          <div className="relative">
            <SearchSelect
              ariaLabel="接受人"
              className={cn(inputCls, "rounded-md border")}
              value={form.接受人}
              options={recipients.map((v) => ({ value: v, label: v }))}
              placeholder="选择仓管/PMC"
              clearLabel="选择仓管/PMC"
              onChange={(v) => setForm({ 接受人: v })}
            />
            <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
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

// ---------- 明细:编辑网格(保真列序照抄 MaterialLineTable usageCols) ----------

function LinesEditor({
  rows,
  stockMap,
  onPatch,
  onRemove,
  onAddLine,
  onPickProduction,
  onPickMaterial,
  onOpenBasis,
  onOpenAsm,
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
  onOpenAsm: () => void;
  basis说明: string;
}) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
  const cellInput = (r: EditLine, k: keyof EditLine, label: string, w: string) => (
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
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            title="装配物料设置里的半成品 × 半成品设置明细,展开成组装半成品的物料"
            onClick={onOpenAsm}
          >
            按装配BOM带入
          </button>
        </div>
        <span className="text-sm text-[#5f6b7d]">
          口径跟随表头仓库({basis说明});可改完再保存;当前空白行会被替换
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
                "物料名称",
                "规格",
                "材料",
                "颜色",
                "库存",
                "数量",
                "备注",
                "操作",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    thCls,
                    (h === "库存" || h === "数量") && "text-right",
                    h === "操作" && "text-center",
                  )}
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
              rows.map((r, i) => {
                const stock = r.物料编号 ? (stockMap[r.物料编号] ?? 0) : null;
                const shortage = stock !== null && stock < Number(r.数量 || 0);
                return (
                  <tr key={r.key} className="border-b border-black/6 last:border-0">
                    <td className="px-3 py-2 text-disabled">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Input className={cn(inputCls, "h-9 w-20")} aria-label="装配采购" disabled placeholder="-" />
                    </td>
                    <td className="px-3 py-2">
                      {pickCell(r, "生产单号", "生产单号", "w-28", () => onPickProduction(r.key))}
                    </td>
                    <td className="px-3 py-2">
                      {pickCell(r, "款号", "款号", "w-24", () => onPickProduction(r.key))}
                    </td>
                    <td className="px-3 py-2">
                      {pickCell(r, "物料编号", "物料编号", "w-28", () => onPickMaterial(r.key))}
                    </td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.物料类别 ?? ""}</td>
                    <td className="px-3 py-2">{cellInput(r, "颜色", "颜色", "w-20")}</td>
                    <td
                      className={cn(
                        "f-mono px-3 py-2 text-right",
                        shortage ? "font-semibold text-[#dc2626]" : "text-[#3d4a5c]",
                      )}
                    >
                      {stock ?? ""}
                    </td>
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

// ---------- 明细:查看态(只读;领料单额外 已出数量/未领 两列,对照老系统 DetailDrawer) ----------

function LinesView({ lines }: { lines: MaterialDocLine[] }) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 text-left font-medium whitespace-nowrap normal-case";
  return (
    <div className="f-panel overflow-hidden">
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1400px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "生产单号",
                "款号",
                "物料编号",
                "物料名称",
                "规格",
                "材料",
                "颜色",
                "单位",
                "数量",
                "已出数量",
                "未领",
                "备注",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    thCls,
                    (h === "数量" || h === "已出数量" || h === "未领") && "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.ID ?? i} className="h-11 border-b border-black/6 last:border-0">
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#15803d]">{txt(l.生产单号)}</td>
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(l.款号)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">{txt(l.物料编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.物料类别)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
                <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">{l.已出数量 ?? 0}</td>
                <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                  {(l.数量 ?? 0) - (l.已出数量 ?? 0)}
                </td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.备注)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 打开单据弹窗列(列宽按百分比,合计 100) ----------

const openCol = createColumnHelper<MaterialIssueHeader>();

const openColumns: ColumnDef<MaterialIssueHeader, any>[] = [
  openCol.accessor("单号", {
    header: "领料单号",
    size: 20,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 11,
    cell: (c) => fmtDate(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("领料部门", {
    header: "领料部门",
    size: 13,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
  }),
  openCol.accessor("领料人", {
    header: "领料人",
    size: 10,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("仓库", {
    header: "仓库",
    size: 10,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("接受人", {
    header: "接受人",
    size: 10,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("数量", {
    header: "数量",
    size: 8,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]" },
  }),
  openCol.display({
    id: "状态",
    header: "状态",
    size: 18,
    cell: (c) => <StatusPill row={c.row.original} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

// 打印单头字段(对照老系统 listExtra:领料部门/领料人/仓库/接受人)
const PRINT_HEADER_FIELDS = [
  { name: "领料部门", label: "领料部门" },
  { name: "领料人", label: "领料人" },
  { name: "仓库", label: "仓库" },
  { name: "接受人", label: "接受人" },
];

// ---------- 页面 ----------

// titleOverride/docLabel/queryLabel:仓侧别名入口用(半成品出仓单 /semi-outbound,
// 对照老系统 web/src/App.tsx:245 MaterialsDocCenter forceDoc="material-issues" 同页异名)
export default function MaterialIssuePage({
  titleOverride,
  docLabel = "来料领料单",
  queryLabel = "来料领料查询",
}: {
  titleOverride?: string;
  docLabel?: string;
  queryLabel?: string;
} = {}) {
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
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
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

  // 按装配BOM带入:装配物料设置的半成品行 × 半成品设置明细 展开成组成物料
  const [asmOpen, setAsmOpen] = useState(false);
  const [asm货号, setAsm货号] = useState("");
  const [asmQty, setAsmQty] = useState("1");
  const [asmRows, setAsmRows] = useState<AssemblyIssueRow[]>([]);
  const [asmFilteredOut, setAsmFilteredOut] = useState(0); // 不属于表头仓库、被过滤掉的行数
  const [asmLoading, setAsmLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [outboundOpen, setOutboundOpen] = useState(false); // 分次出库弹窗

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 首次进入自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: ["material-issue", "first"],
    queryFn: () => materialIssueApi.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  const detailQuery = useQuery({
    queryKey: ["material-issue", "detail", 单号],
    queryFn: () => materialIssueApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["material-issue", "list", page, keyword],
    queryFn: () => materialIssueApi.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const materialsQuery = useQuery({
    queryKey: ["material-issue", "materials", materialKw],
    queryFn: () => materialMasterApi.list(undefined, materialKw || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: materialPickFor !== null,
  });

  const prodQuery = useQuery({
    queryKey: ["material-issue", "productions", prodKw],
    queryFn: () => productionReportApi.tracking(prodKw || undefined, "1"),
    placeholderData: keepPreviousData,
    enabled: prodPickFor !== null,
  });

  // 人事档案:领料人选择器(关键字查询) + 接受人候选(职称=仓管/PMC,进新建态时拉一次)
  const empQuery = useQuery({
    queryKey: ["material-issue", "employees", empKw],
    queryFn: () => employeesApi.list(1, 200, empKw || undefined),
    placeholderData: keepPreviousData,
    enabled: empPickOpen,
  });
  const recipientsQuery = useQuery({
    queryKey: ["material-issue", "recipients"],
    queryFn: () => employeesApi.list(1, 2000),
    staleTime: 5 * 60_000,
    enabled: mode === "new",
  });
  const recipients = useMemo(
    () =>
      (recipientsQuery.data?.items ?? [])
        .filter((x) => x.职称 === "仓管" || x.职称 === "PMC")
        .map((x) => String(x.姓名 ?? ""))
        .filter(Boolean),
    [recipientsQuery.data],
  );

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = audited(header);

  // 明细「库存」列:按表头仓库整仓拉一次库存,行内按物料编号(成品仓按配件编号)查现存
  // (照抄 MaterialLineTable stockMap:半成品仓->semi-inventory 累加,成品仓->finished-inventory 累加,其余->material-inventory)
  const stock仓库 = mode === "new" ? form.仓库.trim() : (header?.仓库 ?? "").trim();
  const stockQuery = useQuery({
    queryKey: ["material-issue", "stock", stock仓库],
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

  // 选物料:回填编号/名称/材料/规格/颜色/单位(对照老系统 fillFromMaterial;领料无单价)
  const fillFromMaterial = (m: MasterMaterialRow) => {
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
  };

  // 选生产制单:仅回填生产单号/款号(对照老系统 productionLinePatch)
  const fillFromProduction = (p: ProductionTrackingRow) => {
    if (prodPickFor === null) return;
    patchRow(prodPickFor, {
      生产单号: p.生产单号 ?? undefined,
      款号: p.款号 ?? undefined,
    });
    setProdPickFor(null);
  };

  // ---------- 按生产单带入 ----------
  // 口径跟随表头仓库:来料/塑胶=应领(接单数×BOM用量,多单合并按货号挑选);
  // 半成品/成品=该生产单对应仓库存现存(单弹窗直接带入)
  const openBasis = () => {
    if (!form.仓库.trim()) {
      setToast({ text: "请先选择仓库,再按生产单带入", tone: "err" });
      return;
    }
    setBasisOpen(true);
  };

  // 批量领料(来料/塑胶档):多单号解析 -> 逐单调 issue-basis(按货号) -> 合并/排序/去重 -> 默认全选
  const loadIssueBasisPick = async () => {
    const nos = parse生产单号s(basisNo);
    if (nos.length === 0) {
      setToast({ text: "请输入生产单号(多个用逗号/空格/换行分隔)", tone: "err" });
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
        setToast({ text: `生产单 ${nos.join("/")} 无${form.仓库}应领明细`, tone: "err" });
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

  // 半成品/成品档:单生产单直接带入库存现存
  const bringIssueBasis = async () => {
    const no = basisNo.trim();
    if (!no) return;
    const 档 = issueBasis档(form.仓库);
    setBasisLoading(true);
    try {
      const rs = await productionApi.issueBasis(no, 档);
      if (rs.length === 0) {
        setToast({ text: `生产单 ${no} 无${form.仓库}应领明细`, tone: "err" });
        return;
      }
      const mapped = rs.map((r) => basisRowToLine(r, no, uid(), 档));
      setRows((prev) => [...prev.filter((l) => l.物料编号), ...mapped]);
      setToast({ text: `已带入 ${rs.length} 行(库存现存)`, tone: "ok" });
      closeBasis();
    } catch (e) {
      setToast({ text: errMsg(e) || "按生产单带入失败", tone: "err" });
    } finally {
      setBasisLoading(false);
    }
  };

  const closeBasis = () => {
    setBasisOpen(false);
    setBasisNo("");
    setBasisRows([]);
    setBasisSel([]);
    setBasis货号("");
  };

  // ---------- 按装配BOM带入 ----------
  // 半成品还是未组装的:领的是「组装成半成品的物料」(后端 /assembly-issue 展开:
  // 数量=做货数量×BOM半成品行.使用数量×半成品设置明细.使用数量);
  // 自动按表头仓库分类:来料仓只带来料仓的料,塑胶仓只带塑胶件,其它仓不过滤
  const loadAsm = async () => {
    const key = asm货号.trim();
    const n = Number(asmQty);
    if (!key) {
      setToast({ text: "请输入产品货号", tone: "err" });
      return;
    }
    if (!(n > 0)) {
      setToast({ text: "请输入做货数量(>0)", tone: "err" });
      return;
    }
    setAsmLoading(true);
    try {
      const view = await stylesApi.assemblyIssue(key, n);
      const wh = form.仓库.trim();
      const want = wh.includes("塑胶") ? "塑胶" : wh.includes("来料") ? "来料" : "";
      const rs = want ? view.行.filter((r) => r.仓库 === want) : view.行;
      if (rs.length === 0) {
        setToast({
          text:
            view.行.length > 0
              ? `货号 ${key} 展开的 ${view.行.length} 行都不属于${wh || "当前仓库"},没有可带出的料`
              : `货号 ${key} 的装配BOM没有可展开的半成品行(先在「装配物料设置」选半成品)`,
          tone: "err",
        });
        return;
      }
      setAsmRows(rs);
      setAsmFilteredOut(view.行.length - rs.length);
      if (view.跳过半成品.length > 0) {
        setToast({
          text: `${view.跳过半成品.length} 行半成品未找到定义,已跳过:${view.跳过半成品.join("/")}`,
          tone: "err",
        });
      }
    } catch (e) {
      setToast({ text: errMsg(e) || "装配BOM调入失败", tone: "err" });
    } finally {
      setAsmLoading(false);
    }
  };

  const confirmAsm = () => {
    if (asmRows.length === 0) return;
    const mapped: EditLine[] = asmRows.map((r) => ({
      key: uid(),
      款号: asm货号.trim(),
      物料编号: r.物料编号,
      物料名称: r.物料名称 ?? undefined,
      规格: r.规格 ?? undefined,
      颜色: r.颜色 ?? undefined,
      单位: r.单位 ?? undefined,
      数量: String(r.数量),
    }));
    setRows((prev) => [...prev.filter((l) => l.物料编号), ...mapped]);
    setToast({ text: `已带入 ${mapped.length} 行(装配BOM展开)`, tone: "ok" });
    closeAsm();
  };

  const closeAsm = () => {
    setAsmOpen(false);
    setAsm货号("");
    setAsmQty("1");
    setAsmRows([]);
    setAsmFilteredOut(0);
  };

  // 下推入口:URL 带 ?basis=生产单号 时自动带入应领明细(从生产通知单「下推领料」跳入)
  const [searchParams, setSearchParams] = useSearchParams();
  // 消息中心跳入:URL 带 ?doc=单号 时直接打开该领料单(查看态);
  // 渲染期派生 mode/单号(同 ProductionPage ?mo= 模式),effect 只做消费清参
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
  const autoBasisDone = useRef(false);
  useEffect(() => {
    const basis = searchParams.get("basis");
    if (!basis || autoBasisDone.current) return;
    autoBasisDone.current = true;
    setSearchParams({}, { replace: true }); // 先清参数,避免刷新/返回重复带入
    setMode("new");
    set单号(null);
    const 档 = issueBasis档(form.仓库 || "来料仓");
    const 现存档 = 档 === "半成品" || 档 === "成品";
    void (async () => {
      try {
        const rs = await productionApi.issueBasis(basis.trim(), 档);
        if (rs.length === 0) {
          setToast({ text: `生产单 ${basis} 无应领明细`, tone: "err" });
          return;
        }
        setRows((prev) => [
          ...prev.filter((l) => l.物料编号),
          ...rs.map((r) => basisRowToLine(r, basis.trim(), uid(), 现存档 ? 档 : undefined)),
        ]);
        setToast({ text: `已带入 ${rs.length} 行(${现存档 ? "库存现存" : "应领量"})`, tone: "ok" });
      } catch (e) {
        setToast({ text: errMsg(e) || "按生产单带入失败", tone: "err" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  // ---------- 保存(只新建;来料领料单保存后不可改,后端无 PUT) ----------
  const doSave = async () => {
    if (!form.仓库.trim()) {
      setToast({ text: "请填写仓库", tone: "err" });
      return;
    }
    if (!form.接受人.trim()) {
      setToast({ text: "请填写接受人", tone: "err" });
      return;
    }
    const ok = validLines(rows);
    if (ok.length === 0) {
      setToast({ text: "请至少录入一行有效物料明细", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
      const r = await materialIssueApi.create({
        领料部门: t(form.领料部门),
        领料人: t(form.领料人),
        日期: today(),
        仓库: form.仓库.trim(),
        接受人: t(form.接受人),
        备注: t(form.备注),
        明细: ok.map(toSubmitLine),
      });
      setToast({ text: `来料领料单已创建:${r.单号}`, tone: "ok" });
      setMode("view");
      set单号(r.单号);
      void qc.invalidateQueries({ queryKey: ["material-issue", "first"] });
      void qc.invalidateQueries({ queryKey: ["material-issue", "list"] });
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
        void qc.invalidateQueries({ queryKey: ["material-issue", "first"] });
        void qc.invalidateQueries({ queryKey: ["material-issue", "list"] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
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
              void act(() => materialIssueApi.supervisorApprove(单号!), "主管已审核", "reload"),
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
              void act(() => materialIssueApi.managerApprove(单号!), "经理已审核", "reload"),
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
            onClick: () => void act(() => materialIssueApi.approve(单号!), "已审核(出库)", "reload"),
          },
          // 分次出库抽屉(老系统领料单出库主流程;与「审核(出库)」并存,共用 已出数量 口径)
          {
            key: "outbound",
            label: "出库",
            icon: Export,
            perm: "审核" as const,
            success: true,
            onClick: () => setOutboundOpen(true),
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
            onClick: () => void act(() => materialIssueApi.unapprove(单号!), "已反审核", "reload"),
          },
        ]
      : []),
  ];

  // ---------- 打印:开新窗口渲染单头+明细(对照老系统 DetailDrawer 打印;无「单价」位不出价格列) ----------
  const doPrint = () => {
    if (!detail?.单头) return;
    printMaterialDoc(
      `来料领料单 ${单号 ?? ""}`,
      { 单头: { ...detail.单头 }, 明细: detail.明细 ?? [] },
      { hidePrice: !can(MENU, "单价"), headerFields: PRINT_HEADER_FIELDS },
    );
  };
  const printActions: DocAction[] = isView
    ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint }]
    : [];

  // ---------- 查看态单头卡字段 ----------
  const mainFields: HeaderField[] = header
    ? [
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        { label: "领料部门", value: txt(header.领料部门), mono: true },
        { label: "领料人", value: txt(header.领料人), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
        { label: "接受人", value: txt(header.接受人), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "主管审核人", value: txt(header.主管审核人), mono: true },
        { label: "经理审核人", value: txt(header.经理审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
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
  const pickable = 可挑选档(form.仓库);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          {titleOverride ?? "来料领料单"}
          {tab === "doc" && (isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : "")}
        </h1>
        {tab === "doc" && isView && <AuditBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: docLabel },
              { key: "query" as const, label: queryLabel },
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
        <MaterialIssueQueryPanel
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
            {printActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={printActions} menuKey={MENU} />
              </>
            )}
          </div>

          {/* 单头:新建 = 表单;查看 = 只读单头卡(来料领料单保存后不可改) */}
          {mode === "new" ? (
            <HeaderForm
              form={form}
              setForm={setForm}
              操作员={currentUser}
              recipients={recipients}
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
                description="点击上方「打开」选择一张来料领料单,或点「新建」开一张新单"
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

          {/* 明细 */}
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
                onOpenAsm={() => setAsmOpen(true)}
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
              </div>
            )
          )}
        </>
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开来料领料单"
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
        emptyHint="没有匹配的来料领料单,换个关键字试试"
      />

      {/* 选择物料(物料资料;领料无单价列) */}
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
                onClick={() => fillFromMaterial(m)}
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

      {/* 选择人员(人事档案;点行回填领料人) */}
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
                  setForm({ 领料人: emp.姓名 ?? "" });
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

      {/* 按生产单带入:来料/塑胶档 = 批量领料(多单合并,按货号挑选,默认全选);半成品/成品档 = 单调入现存 */}
      {pickable ? (
        <PickerDialog
          open={basisOpen}
          onClose={closeBasis}
          title="批量领料 · 按货号挑选应领明细"
          width="sm:max-w-[1000px]"
          footer={
            <>
              <span className="text-sm text-[#5f6b7d]">
                口径跟随表头仓库({form.仓库 || "未选"}:{issueBasis档说明(form.仓库)});已选{" "}
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
      ) : (
        <PickerDialog
          open={basisOpen}
          onClose={closeBasis}
          title="按生产单带入应领明细"
          width="sm:max-w-[480px]"
          footer={
            <span className="text-sm text-[#5f6b7d]">
              口径跟随表头仓库({form.仓库 || "未选"}:{issueBasis档说明(form.仓库)});可改完再保存;当前空白行会被替换
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
            <button
              type="submit"
              className="f-btn f-btn-cyan h-10 shrink-0 px-5 text-sm"
              disabled={basisLoading}
            >
              带入
            </button>
          </form>
        </PickerDialog>
      )}

      {/* 按装配BOM带入:装配物料设置的半成品 × 半成品设置明细 展开成组成物料 */}
      <PickerDialog
        open={asmOpen}
        onClose={closeAsm}
        title="按装配BOM带入(半成品展开成组成物料)"
        width="sm:max-w-[860px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={closeAsm}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={asmRows.length === 0}
              onClick={confirmAsm}
            >
              确定带入{asmRows.length > 0 ? ` ${asmRows.length} 行` : ""}
            </button>
          </>
        }
      >
        <form
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void loadAsm();
          }}
        >
          <Input
            className={cn(inputCls, "w-56")}
            aria-label="装配BOM货号"
            placeholder="产品货号(已建装配物料设置)"
            value={asm货号}
            onChange={(e) => setAsm货号(e.target.value)}
          />
          <Input
            className={cn(inputCls, "w-32")}
            aria-label="做货数量"
            type="number"
            min={0}
            placeholder="做货数量"
            value={asmQty}
            onChange={(e) => setAsmQty(e.target.value)}
          />
          <button
            type="submit"
            className="f-btn f-btn-cyan h-10 shrink-0 px-5 text-sm"
            disabled={asmLoading}
          >
            {asmLoading ? "展开中..." : "展开"}
          </button>
          <span className="text-xs text-[#5f6b7d]">
            数量=做货数量×BOM半成品用量×半成品组成用量
            {form.仓库.trim()
              ? `;已按表头仓库(${form.仓库.trim()})分类`
              : ""}
            {asmFilteredOut > 0 ? `,另有 ${asmFilteredOut} 行其它仓物料未列出` : ""}
          </span>
        </form>
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={pickerThCls}>物料编号</th>
                <th className={pickerThCls}>物料名称</th>
                <th className={pickerThCls}>规格</th>
                <th className={pickerThCls}>颜色</th>
                <th className={pickerThCls}>单位</th>
                <th className={pickerThCls}>仓库</th>
                <th className={cn(pickerThCls, "text-right")}>数量</th>
              </tr>
            </thead>
            <tbody>
              {asmRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-disabled">
                    输入产品货号与做货数量,点「展开」预览组成物料(按表头仓库自动分类)
                  </td>
                </tr>
              ) : (
                asmRows.map((r, i) => (
                  <tr key={`${r.物料编号}-${i}`} className="border-b border-black/6">
                    <td className="f-mono px-3 py-2">{r.物料编号}</td>
                    <td className="px-3 py-2">{r.物料名称 ?? ""}</td>
                    <td className="px-3 py-2">{r.规格 ?? ""}</td>
                    <td className="px-3 py-2">{r.颜色 ?? ""}</td>
                    <td className="px-3 py-2">{r.单位 ?? ""}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          r.仓库 === "塑胶"
                            ? "bg-[#7c3aed]/10 text-[#7c3aed]"
                            : "bg-[#2563eb]/10 text-[#2563eb]",
                        )}
                      >
                        {r.仓库}
                      </span>
                    </td>
                    <td className="f-mono px-3 py-2 text-right">{r.数量}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PickerDialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该来料领料单?"
        description={`${单号} 删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => materialIssueApi.remove(单号!), "已删除", "reset");
        }}
      />

      {/* 分次出库(经理已审后;全部出完单据自动置已审核) */}
      <MaterialIssueOutboundDialog
        单号={单号}
        open={outboundOpen && isView && !isAudited}
        onClose={() => setOutboundOpen(false)}
        onToast={(text, tone) => setToast({ text, tone })}
        onDone={() => {
          void detailQuery.refetch();
          void qc.invalidateQueries({ queryKey: ["material-issue", "first"] });
          void qc.invalidateQueries({ queryKey: ["material-issue", "list"] });
          void qc.invalidateQueries({ queryKey: ["material-issue", "outbound"] });
          invalidateCrossPage(qc);
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
