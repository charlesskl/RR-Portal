import { useEffect, useState } from "react";
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
  plasticMaterialMasterApi,
  plasticMaterialSettingsApi,
  plasticPurchaseOrderApi,
  plasticPurchaseProgressApi,
  plasticReceiptApi,
  productionReportApi,
  suppliersApi,
  warehouseLocationApi,
} from "@/api/endpoints";
import type {
  PlasticMaterialRow,
  PlasticReceiptHeader,
  PlasticReceiptLine,
  ProductionTrackingRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { prefillDefaultWarehouse } from "@/lib/plasticIssue";
import {
  filterOwedOrders,
  owedOrders,
  printPlasticReceipt,
  progressRowToLine,
  sumAmount,
  sumQty,
  toSubmitLine,
  validLines,
  type EditLine,
} from "@/lib/plasticReceipt";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PlasticReceiptQueryPanel } from "./PlasticReceiptQueryPanel";

// 塑胶入仓单(塑胶仓;单级审核=入库存)。对照老系统:
// web/src/pages/plastics/PlasticReceiptFormPage.tsx(cfg=plastic-receipts)
// + PlasticReceiptLineTable.tsx(保真列序)+ PlasticPurchaseOrderDrawer 的带入口径。
// 权限菜单名 = 后端 MenuCatalog「塑胶入仓单」(组 塑胶仓储;菜单 label 不等于权限键,
// DocToolbar 一律显式传 menuKey)。「塑胶退仓单」是另一单据(resource=plastic-warehouse-returns),不在本页。
const MENU = "塑胶入仓单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
// ISO 格式:后端 DateTime 反序列化要求(老系统同款 today())
const today = () => new Date().toISOString().slice(0, 10);

let rowSeq = 1;
const uid = () => rowSeq++;

const audited = (h?: PlasticReceiptHeader | null) => h?.审核 === "1";

// ---------- 审核徽章 / 状态小徽章 ----------

function AuditBadge({ header }: { header?: PlasticReceiptHeader | null }) {
  if (audited(header))
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/60 bg-[#16a34a]/10 px-4 py-1.5 text-sm font-semibold text-[#15803d] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_12px_-2px_rgb(22_163_74/0.35)]">
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

function StatusPill({ v }: { v?: string }) {
  if (v === "1")
    return (
      <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
        已审核
      </span>
    );
  return (
    <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
      未审核
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
  单号: string; // 送货单号(供应商送货单号,手填必填,全表唯一)
  供应商编号: string;
  供应商名称: string;
  入仓单号: string; // 老表单「入库单号」字段
  订单单号: string;
  仓库: string;
  备注: string;
}

const emptyHeader = (): HeaderFormState => ({
  单号: "",
  供应商编号: "",
  供应商名称: "",
  入仓单号: "",
  订单单号: "",
  仓库: "",
  备注: "",
});

function HeaderForm({
  form,
  setForm,
  操作员,
  whOptions,
  onPickSupplier,
}: {
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  操作员: string;
  whOptions: { value: string; label: string }[];
  onPickSupplier: () => void;
}) {
  const bind = (k: keyof HeaderFormState) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ [k]: e.target.value }),
  });
  return (
    <div className="f-panel p-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="供应商">
          <div className="relative flex gap-2">
            <Input
              className={inputCls}
              readOnly
              placeholder="点「选择」挑供应商"
              aria-label="供应商"
              value={form.供应商名称}
            />
            <button
              type="button"
              className="f-btn h-10 shrink-0 px-3.5 text-sm"
              onClick={onPickSupplier}
            >
              选择
            </button>
            <span className="absolute top-1/2 right-16 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="日期">
          <Input className={inputCls} aria-label="日期" value={today()} disabled />
        </FormField>
        <FormField label="送货单号">
          <div className="relative">
            <Input
              className={inputCls}
              aria-label="送货单号"
              placeholder="供应商送货单号,全表唯一"
              {...bind("单号")}
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="仓库">
          <div className="relative">
            <SearchSelect
              ariaLabel="仓库"
              className={cn(inputCls, "w-full rounded-md border px-2")}
              value={form.仓库}
              options={whOptions}
              placeholder="选择仓库"
              clearLabel="选择仓库"
              onChange={(v) => setForm({ 仓库: v })}
            />
            <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="入库单号">
          <Input className={inputCls} aria-label="入库单号" {...bind("入仓单号")} />
        </FormField>
        <FormField label="订单单号">
          <Input className={inputCls} aria-label="订单单号" {...bind("订单单号")} />
        </FormField>
        <FormField label="电脑单号">
          <Input className={inputCls} value="" disabled placeholder="保存后自动生成" />
        </FormField>
        <FormField label="操作员">
          <Input className={inputCls} aria-label="操作员" value={操作员} disabled />
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

// ---------- 明细:编辑网格(保真列序照抄 PlasticReceiptLineTable) ----------

// 锁定行提示:从采购单带入且采购行带生产单号 -> 锁死(贯穿到入库/统计;同 Task 4 replenishPoLock 口径)
const LOCK_TIP = "采购行已挂生产单号,锁定不可改(贯穿到入库/统计)";

function LinesEditor({
  rows,
  priceHidden,
  onPatch,
  onRemove,
  onAddLine,
  onPickProduction,
  onPickMaterial,
  onOpenPpo,
}: {
  rows: EditLine[];
  priceHidden: boolean;
  onPatch: (key: number, patch: Partial<EditLine>) => void;
  onRemove: (key: number) => void;
  onAddLine: () => void;
  onPickProduction: (key: number) => void;
  onPickMaterial: (key: number) => void;
  onOpenPpo: () => void;
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
  const pickCell = (r: EditLine, k: keyof EditLine, label: string, w: string, onPick: () => void) => (
    <div className="flex items-center gap-1">
      <Input
        className={cn(inputCls, "h-9", w)}
        aria-label={label}
        value={(r[k] as string | undefined) ?? ""}
        onChange={(e) => onPatch(r.key, { [k]: e.target.value })}
      />
      <button type="button" aria-label={`${label}选择`} className="f-btn h-9 shrink-0 px-2 text-xs" onClick={onPick}>
        选
      </button>
    </div>
  );
  const lineAmt = (r: EditLine) => (Number(r.数量 || 0) * Number(r.单价 || 0)).toFixed(2);
  const colCount = priceHidden ? 14 : 16;
  return (
    <div className="f-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
        <div className="flex gap-2">
          <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onAddLine}>
            <Plus className="h-4 w-4" />
            加一行
          </button>
          <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onOpenPpo}>
            从采购单带入
          </button>
        </div>
        <span className="text-sm text-[#5f6b7d]">
          从采购单带入仅列已审核且有欠数的塑胶采购订单,数量默认=欠数(全收);当前空白行会被丢弃
        </span>
      </div>
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1500px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "序号",
                "订单单号",
                "生产单号",
                "款号",
                "物料编号",
                "工模编号",
                "物料名称",
                "颜色",
                "塑胶货号",
                "单位",
                "数量",
                "备品",
                ...(priceHidden ? [] : ["单价", "金额"]),
                "备注",
                "操作",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    thCls,
                    (h === "数量" || h === "单价" || h === "金额") && "text-right",
                    (h === "操作" || h === "备品") && "text-center",
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
                <td colSpan={colCount} className="px-4 py-6 text-center text-sm text-disabled">
                  还没有明细行,点「加一行」手选物料,或「从采购单带入」欠数行
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.key} className="border-b border-black/6 last:border-0">
                  <td className="px-3 py-2 text-disabled">{i + 1}</td>
                  <td className="px-3 py-2">{cellInput(r, "订单单号", "订单单号", "w-28")}</td>
                  <td className="px-3 py-2">
                    {r.锁定生产单号 ? (
                      <Input
                        className={cn(inputCls, "h-9 w-28")}
                        aria-label="生产单号"
                        value={r.生产单号 ?? ""}
                        disabled
                        title={LOCK_TIP}
                      />
                    ) : (
                      pickCell(r, "生产单号", "生产单号", "w-28", () => onPickProduction(r.key))
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {pickCell(r, "款号", "款号", "w-24", () => onPickProduction(r.key))}
                  </td>
                  <td className="px-3 py-2">
                    {pickCell(r, "物料编号", "物料编号", "w-28", () => onPickMaterial(r.key))}
                  </td>
                  <td className="px-3 py-2">{cellInput(r, "工模编号", "工模编号", "w-24")}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                  <td className="px-3 py-2">{cellInput(r, "颜色", "颜色", "w-20")}</td>
                  <td className="px-3 py-2">{cellInput(r, "塑胶货号", "塑胶货号", "w-24")}</td>
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
                  <td className="px-2 py-2 text-center">
                    {/* 供应商多送的备品:勾选后允许超订单数量入库,不占订单欠数 */}
                    <Checkbox
                      aria-label={`行${i + 1} 备品`}
                      title="供应商多送的备品:允许超订单数量入库,不占订单欠数"
                      className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                      checked={!!r.备品}
                      onCheckedChange={(v) => onPatch(r.key, { 备品: v === true })}
                    />
                  </td>
                  {!priceHidden && (
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        aria-label="单价"
                        className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                        value={r.单价}
                        onChange={(e) => onPatch(r.key, { 单价: e.target.value })}
                      />
                    </td>
                  )}
                  {!priceHidden && (
                    <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{lineAmt(r)}</td>
                  )}
                  <td className="px-3 py-2">{cellInput(r, "备注", "备注", "w-28")}</td>
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
      <div className="flex items-center justify-end gap-8 border-t border-black/8 px-4 py-3 font-semibold text-[#1a2330]">
        <span>
          数量合计:<span className="f-mono">{sumQty(rows)}</span>
        </span>
        {!priceHidden && (
          <span>
            金额合计:<span className="f-mono">{sumAmount(rows).toFixed(2)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- 明细:查看态(只读) ----------

function LinesView({ lines, priceHidden }: { lines: PlasticReceiptLine[]; priceHidden: boolean }) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 text-left font-medium whitespace-nowrap normal-case";
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));
  return (
    <div className="f-panel overflow-hidden">
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1600px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "订单单号",
                "生产单号",
                "款号",
                "物料编号",
                "工模编号",
                "物料名称",
                "规格",
                "颜色",
                "塑胶货号",
                "仓位号",
                "单位",
                "数量",
                "备品",
                "单价",
                "金额",
                "备注",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(thCls, (h === "数量" || h === "单价" || h === "金额") && "text-right", h === "备品" && "text-center")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.ID ?? i} className="h-11 border-b border-black/6 last:border-0">
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(l.订单单号)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#15803d]">{txt(l.生产单号)}</td>
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(l.款号)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">{txt(l.物料编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.工模编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.塑胶货号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.仓位号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
                <td className="px-4 py-2 text-center whitespace-nowrap">
                  {l.备品 === "1" ? (
                    <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-medium text-[#15803d]">
                      备品
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{money(l.单价)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{money(l.金额)}</td>
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

const openCol = createColumnHelper<PlasticReceiptHeader>();

const openColumns = (priceHidden: boolean): ColumnDef<PlasticReceiptHeader, any>[] => [
  openCol.accessor("单号", {
    header: "送货单号",
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
  openCol.accessor("供应商名称", {
    header: "供应商",
    size: 25,
    cell: (c) => txt(c.getValue()),
    meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
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
  openCol.accessor("金额", {
    header: "金额",
    size: 10,
    cell: (c) => (priceHidden ? "***" : fmtNum(c.getValue(), 2)),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]" },
  }),
  openCol.display({
    id: "状态",
    header: "状态",
    size: 11,
    cell: (c) => <StatusPill v={c.row.original.审核} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

// ---------- 页面 ----------

export default function PlasticReceiptPage() {
  const qc = useQueryClient();
  const currentUser = getUser() || "用户";
  const { can } = usePerms();
  const priceHidden = !can(MENU, "单价");

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
  // 批量审核弹窗独立分页/关键字:服务端只拉未审核单,审核完后面页的未审核单自动前移
  const [batchPage, setBatchPage] = useState(1);
  const [batchKeyword, setBatchKeyword] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierKw, setSupplierKw] = useState("");
  const [materialPickFor, setMaterialPickFor] = useState<number | null>(null);
  const [materialKw, setMaterialKw] = useState("");
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);
  const [prodKw, setProdKw] = useState("");
  const [ppoOpen, setPpoOpen] = useState(false);
  const [ppoKw, setPpoKw] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 首次进入自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: ["plastic-receipt", "first"],
    queryFn: () => plasticReceiptApi.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  // 详情查询:每次打开单号都重新取(喷油排期改单会后台更新未审核入仓单,
  // 重开/审核后 refetch 即拿到最新数量;已审核单后端不动,展示不受刷新影响)
  const detailQuery = useQuery({
    queryKey: ["plastic-receipt", "detail", 单号],
    queryFn: () => plasticReceiptApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["plastic-receipt", "list", page, keyword],
    queryFn: () => plasticReceiptApi.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  // 批量审核:服务端只列未审核单(onlyUnapproved),整页审核完后面页自动前移;
  // 页码超出收缩后的总页数时回退到末页(部分失败时失败的单仍留在当前页)
  const batchQuery = useQuery({
    queryKey: ["plastic-receipt", "batch-list", batchPage, batchKeyword],
    queryFn: () => plasticReceiptApi.list(batchPage, 10, batchKeyword || undefined, true),
    placeholderData: keepPreviousData,
    enabled: batchOpen,
  });
  const batchTotalPages = batchQuery.data ? Math.max(1, Math.ceil(batchQuery.data.total / 10)) : 1;
  useEffect(() => {
    if (batchPage > batchTotalPages) setBatchPage(batchTotalPages);
  }, [batchPage, batchTotalPages]);

  const suppliersQuery = useQuery({
    queryKey: ["plastic-receipt", "suppliers", supplierKw],
    queryFn: () => suppliersApi.list(1, 500, supplierKw),
    placeholderData: keepPreviousData,
    enabled: supplierOpen,
  });

  const materialsQuery = useQuery({
    queryKey: ["plastic-receipt", "materials", materialKw],
    queryFn: () => plasticMaterialMasterApi.list(undefined, materialKw || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: materialPickFor !== null,
  });

  const prodQuery = useQuery({
    queryKey: ["plastic-receipt", "productions", prodKw],
    queryFn: () => productionReportApi.tracking(prodKw || undefined, "1"),
    placeholderData: keepPreviousData,
    enabled: prodPickFor !== null,
  });

  // 表头「仓库」下拉选项(仓库位置主数据)
  const whQuery = useQuery({
    queryKey: ["warehouse-location", "options"],
    queryFn: () => warehouseLocationApi.options(),
  });
  const whOptions = (whQuery.data ?? [])
    .map((w) => ({
      value: w.名称 ?? w.编号 ?? "",
      label: `${w.编号 ?? ""} ${w.名称 ?? ""}`.trim(),
    }))
    .filter((o) => o.value);

  // 「从采购单带入」数据源:塑胶进度表欠数行(不限日期;onlyOwed),弹窗内按单号去重+前端过滤
  const ppoQuery = useQuery({
    queryKey: ["plastic-receipt", "ppo-progress"],
    queryFn: () => plasticPurchaseProgressApi.list({ onlyOwed: true }),
    enabled: ppoOpen,
  });
  const ppoOrders = filterOwedOrders(owedOrders(ppoQuery.data ?? []), ppoKw);

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = audited(header);

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

  // 从采购单带入:该单全部欠数行,数量=欠数(默认全收);表头 供应商/订单单号 带出。
  // 直接查进度表 API(不依赖弹窗 state),手动带入与 URL ?ppo= 自动带入共用(照抄老系统)
  const bringFromPurchaseOrder = async (no: string) => {
    try {
      const all = await plasticPurchaseProgressApi.list({ onlyOwed: true });
      const owed = all.filter((r) => r.审核 === "1" && r.采购单号 === no);
      if (owed.length === 0) {
        setToast({ text: `采购单 ${no} 无欠数行`, tone: "err" });
        return;
      }
      const d = await plasticPurchaseOrderApi.get(no); // 进度表无供应商编号,取单头补齐
      setForm({
        供应商编号: d.单头?.供应商编号 ?? "",
        供应商名称: d.单头?.供应商名称 ?? owed[0].供应商名称 ?? "",
        订单单号: no,
      });
      const mapped = owed.map((r) => progressRowToLine(r, no, uid()));
      setRows((prev) => [...prev.filter((l) => l.物料编号), ...mapped]); // 丢弃空白行后追加
      setToast({ text: `已带入 ${mapped.length} 行(默认全收)`, tone: "ok" });
      setPpoOpen(false);
    } catch (e) {
      setToast({ text: errMsg(e) || "从采购单带入失败", tone: "err" });
    }
  };

  // URL 参数:?单号= 直开指定单(试点承诺的塑胶页能力);?ppo=采购单号 下推带入(老系统「下推入仓」入口)。
  // 两个参数消费后都清掉(replace),keep-alive 下同实例再次带参导航仍可生效。
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const no = searchParams.get("单号");
    const ppo = searchParams.get("ppo");
    if (!no && !ppo) return;
    setSearchParams({}, { replace: true }); // 先清参数,避免刷新/返回重复消费
    if (no) {
      setMode("view");
      set单号(no);
      // 直开也强制重取:喷油排期改单可能刚更新过该未审核入仓单
      void qc.invalidateQueries({ queryKey: ["plastic-receipt", "detail", no] });
      return;
    }
    setMode("new");
    set单号(null);
    void bringFromPurchaseOrder(ppo!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  // ---------- 保存(只新建;塑胶入仓单保存后不可改,后端无 PUT) ----------
  const doSave = async () => {
    if (!form.单号.trim()) {
      setToast({ text: "请填写送货单号", tone: "err" });
      return;
    }
    if (!form.供应商编号.trim() && !form.供应商名称.trim()) {
      setToast({ text: "请选供应商", tone: "err" });
      return;
    }
    if (!form.仓库.trim()) {
      setToast({ text: "请选择仓库", tone: "err" });
      return;
    }
    const ok = validLines(rows);
    if (ok.length === 0) {
      setToast({ text: "请至少录入一行有效物料明细(物料编号+数量)", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
      const r = await plasticReceiptApi.create({
        单号: form.单号.trim(),
        供应商编号: t(form.供应商编号),
        供应商名称: t(form.供应商名称),
        仓库: form.仓库.trim(),
        入仓单号: t(form.入仓单号),
        订单单号: t(form.订单单号),
        备注: t(form.备注),
        明细: ok.map(toSubmitLine),
      });
      setToast({ text: `塑胶入仓单已创建:${r.单号}`, tone: "ok" });
      setMode("view");
      set单号(r.单号);
      void qc.invalidateQueries({ queryKey: ["plastic-receipt", "first"] });
      void qc.invalidateQueries({ queryKey: ["plastic-receipt", "list"] });
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "创建失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // ---------- 审核(=入库存)/反审核/删除 ----------
  // 审核可能返回 {提示}(已生成目标仓入仓单)/{警告}(排产推送失败):优先展示,否则用默认成功文案
  const act = async (
    fn: () => Promise<unknown>,
    ok: string,
    after: "reload" | "reset",
  ) => {
    try {
      const r = (await fn()) as { 提示?: string; 警告?: string } | undefined;
      // 提示+警告并存:审核本身已成功,警告只是附带(如排产推送失败),用 ok 语义展示
      if (r?.提示 && r?.警告) setToast({ text: `${r.提示};${r.警告}`, tone: "ok" });
      else if (r?.提示) setToast({ text: r.提示, tone: "ok" });
      else if (r?.警告) setToast({ text: r.警告, tone: "err" });
      else setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        void qc.invalidateQueries({ queryKey: ["plastic-receipt", "first"] });
        void qc.invalidateQueries({ queryKey: ["plastic-receipt", "list"] });
      } else {
        // 审核/反审核后立即重取详情:审核状态与数量(含喷油同步改单)以最新为准
        await detailQuery.refetch();
        void qc.invalidateQueries({ queryKey: ["plastic-receipt", "list"] });
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // ---------- 批量审核(对照老系统 PlasticReceiptFormPage.batchApprove:逐张调审核接口,汇总成功/失败;
  // 单审返回的 {提示}/{警告} 在批量场景忽略,与老系统一致) ----------
  const doBatchApprove = async () => {
    const targets = [...selected];
    if (targets.length === 0) return;
    setBatchRunning(true);
    let ok = 0;
    const fails: string[] = [];
    for (const no of targets) {
      try {
        await plasticReceiptApi.approve(no);
        ok++;
      } catch (e) {
        fails.push(errMsg(e));
      }
    }
    setBatchRunning(false);
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ["plastic-receipt", "batch-list"] });
    void qc.invalidateQueries({ queryKey: ["plastic-receipt", "list"] });
    void qc.invalidateQueries({ queryKey: ["plastic-receipt", "first"] });
    void qc.invalidateQueries({ queryKey: ["plastic-receipt", "detail"] });
    invalidateCrossPage(qc);
    if (fails.length === 0) {
      // 弹窗保持打开:未审核单服务端分页前移,可连续勾选下一批
      setToast({ text: `已审核 ${ok} 张`, tone: "ok" });
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
            label: "审核(入仓)",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => plasticReceiptApi.approve(单号!), "已审核(入仓)", "reload"),
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
            onClick: () => void act(() => plasticReceiptApi.unapprove(单号!), "已反审核", "reload"),
          },
        ]
      : []),
  ];

  // ---------- 打印:开新窗口渲染单头+明细(老系统表单页为 window.print()) ----------
  const doPrint = () => {
    if (!detail?.单头) return;
    printPlasticReceipt(
      `塑胶入仓单 ${单号 ?? ""}`,
      {
        单头: { ...detail.单头 },
        明细: (detail.明细 ?? []) as unknown as Record<string, unknown>[],
      },
      { hidePrice: priceHidden },
    );
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
        { label: "送货单号", value: txt(header.单号), mono: true, strong: true },
        { label: "供应商", value: txt(header.供应商名称), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "金额", value: priceHidden ? "***" : String(header.金额 ?? "-"), mono: true },
        { label: "订单单号", value: txt(header.订单单号), mono: true },
        { label: "入库单号", value: txt(header.入仓单号), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "电脑单号", value: txt(header.电脑单号), mono: true },
        { label: "供应商编号", value: txt(header.供应商编号), mono: true },
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签(对照老系统 DocQueryTabs) */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          塑胶入仓单
          {tab === "doc" && (isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : "")}
        </h1>
        {tab === "doc" && isView && <AuditBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: "塑胶入仓单" },
              { key: "query" as const, label: "塑胶入仓查询" },
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
          {tab === "doc" && <FlowSteps steps={["开单", "审核入仓"]} current={isAudited ? 1 : 0} />}
        </div>
      </div>

      {tab === "query" ? (
        <PlasticReceiptQueryPanel
          onOpenDoc={(no) => {
            setTab("doc");
            setMode("view");
            set单号(no);
            // 双击开整单也强制重取,展示最新(喷油同步改单)数量
            void qc.invalidateQueries({ queryKey: ["plastic-receipt", "detail", no] });
          }}
        />
      ) : (
        <>
      {/* 操作栏:编辑 / 审核 / 打印 三组,组间分隔线 */}
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

      {/* 单头:新建 = 表单;查看 = 只读单头卡(塑胶入仓单保存后不可改) */}
      {mode === "new" ? (
        <HeaderForm
          form={form}
          setForm={setForm}
          操作员={currentUser}
          whOptions={whOptions}
          onPickSupplier={() => {
            setSupplierKw("");
            setSupplierOpen(true);
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
            description="点击上方「打开」选择一张塑胶入仓单,或点「新建」开一张新单"
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
            priceHidden={priceHidden}
            onPatch={patchRow}
            onRemove={removeRow}
            onAddLine={() => setRows((rs) => [...rs, { key: uid(), 数量: "0", 单价: "" }])}
            onPickProduction={(key) => {
              setProdKw("");
              setProdPickFor(key);
            }}
            onPickMaterial={(key) => {
              setMaterialKw("");
              setMaterialPickFor(key);
            }}
            onOpenPpo={() => {
              setPpoKw("");
              setPpoOpen(true);
            }}
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
              <LinesView lines={detail?.明细 ?? []} priceHidden={priceHidden} />
            )}
          </div>
        )
      )}
        </>
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开塑胶入仓单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns(priceHidden)}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 供应商 / 备注"
        onPick={(h) => {
          if (h.单号) {
            setMode("view");
            set单号(h.单号);
            // 重开同一单也强制重取:喷油排期改单会后台更新未审核入仓单的数量
            void qc.invalidateQueries({ queryKey: ["plastic-receipt", "detail", h.单号] });
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
        description="按送货单号、供应商或备注搜索,点击一行打开"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="没有匹配的塑胶入仓单,换个关键字试试"
      />

      {/* 批量审核(多选模式,服务端只列未审核单,审核完自动前移;分页/关键字独立于打开弹窗) */}
      <OpenDocDialog
        title="批量审核塑胶入仓单"
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        columns={openColumns(priceHidden)}
        rows={batchQuery.data?.items ?? []}
        searchPlaceholder="单号 / 供应商 / 备注"
        onPick={() => {}}
        selection={{
          selected,
          onChange: setSelected,
          rowId: (r) => r.单号 ?? "",
        }}
        footer={
          <>
            <span className="f-mono">
              第 {batchPage} / {batchTotalPages} 页,已选 {selected.size} 张
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="f-btn h-10 px-3.5 text-sm"
                disabled={batchPage <= 1}
                onClick={() => setBatchPage((p) => p - 1)}
              >
                <CaretLeft className="h-4 w-4" />
                上一页
              </button>
              <button
                type="button"
                className="f-btn h-10 px-3.5 text-sm"
                disabled={batchPage >= batchTotalPages}
                onClick={() => setBatchPage((p) => p + 1)}
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
        description="仅列未审核单,勾选后逐张审核;审核完后面页的未审核单自动前移,部分失败时失败的单保留在列表"
        loading={batchQuery.isLoading}
        error={batchQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => batchQuery.refetch()}
        onSearch={(kw) => {
          setBatchPage(1);
          setBatchKeyword(kw);
        }}
        emptyHint="没有未审核的塑胶入仓单"
      />

      {/* 选择供应商 */}
      <PickerDialog
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title="选择供应商"
        width="sm:max-w-[640px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSupplierKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="编号/名称" aria-label="供应商搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["供应商编号", "供应商名称"].map((h) => (
                <th key={h} className={pickerThCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(suppliersQuery.data?.items ?? []).map((s, i) => (
              <tr
                key={s.供应商编号 ?? i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  setForm({ 供应商编号: s.供应商编号 ?? "", 供应商名称: s.供应商名称 ?? "" });
                  setSupplierOpen(false);
                }}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{s.供应商编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{s.供应商名称}</td>
              </tr>
            ))}
            {suppliersQuery.isSuccess && (suppliersQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的供应商
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

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
                  className={cn(pickerThCls, (h === "计划数量" || h === "未完成") && "text-right")}
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

      {/* 从塑胶采购订单带入(仅列已审核、有欠数) */}
      <PickerDialog
        open={ppoOpen}
        onClose={() => setPpoOpen(false)}
        title="从塑胶采购订单带入(仅列已审核、有欠数)"
        width="sm:max-w-[720px]"
      >
        <Input
          className={cn(inputCls, "mb-3 w-64")}
          placeholder="采购单号/供应商名称 过滤"
          aria-label="采购单过滤"
          value={ppoKw}
          onChange={(e) => setPpoKw(e.target.value)}
        />
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["采购单号", "供应商", "订购日期"].map((h) => (
                <th key={h} className={pickerThCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ppoOrders.map((r) => (
              <tr
                key={r.采购单号}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => r.采购单号 && void bringFromPurchaseOrder(r.采购单号)}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#15803d]">{r.采购单号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.供应商名称}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{date10(r.订购日期)}</td>
              </tr>
            ))}
            {ppoQuery.isSuccess && ppoOrders.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-sm text-disabled">
                  没有已审核且有欠数的塑胶采购订单
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-2 text-sm text-disabled">
          点单号带入该单全部欠数行,数量默认=欠数(全收)
        </div>
      </PickerDialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该塑胶入仓单?"
        description={`${单号} 删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => plasticReceiptApi.remove(单号!), "已删除", "reset");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
