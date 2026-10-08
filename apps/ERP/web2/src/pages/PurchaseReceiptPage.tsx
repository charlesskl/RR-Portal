import { useEffect, useMemo, useState } from "react";
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
  materialMasterApi,
  purchaseOrderApi,
  purchaseReceiptApi,
  purchaseReturnApi,
  suppliersApi,
} from "@/api/endpoints";
import type {
  MaterialCategoryNode,
  MaterialDocLine,
  PurchaseOrderProgressRow,
  PurchaseReceiptHeader,
  ReceiptQueryDetailRow,
  ReceiptQuerySummaryRow,
  ReturnQueryDetailRow,
  ReturnQuerySummaryRow,
  SupplierRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  ALL_APPROVAL,
  ALL_CAT,
  buildDocQuery,
  monthRange,
  orderRowToLine,
  owedAfter,
  spareTogglePatch,
  sumAmount,
  sumQty,
  thisMonthRange,
  toSubmitLine,
  validLines,
  type EditLine,
} from "@/lib/purchaseReceipt";
import { printMaterialDoc } from "@/lib/printMaterialDoc";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
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
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { usePerms } from "@/hooks/usePerms";

// 单据口径:入仓(审核=入库存) / 退仓(=退回供应商,审核即扣库存)。
// 权限菜单名与后端 MenuCatalog/控制器 Menu 常量一致;退仓用新名「采购退仓单」(旧名「采购出仓单」已迁移)。
interface DocKind {
  key: "receipt" | "return";
  menu: string;
  title: string; // 采购入仓单 / 采购退仓单
  queryLabel: string; // 采购入仓查询 / 采购退仓查询
  flowAudit: string; // 审核入仓 / 审核退仓
}
const RECEIPT: DocKind = {
  key: "receipt",
  menu: "采购入仓单",
  title: "采购入仓单",
  queryLabel: "采购入仓查询",
  flowAudit: "审核入仓",
};
const RETURN: DocKind = {
  key: "return",
  menu: "采购退仓单",
  title: "采购退仓单",
  queryLabel: "采购退仓查询",
  flowAudit: "审核退仓",
};

// 两种单头同构(退仓多 入仓单号;入仓单号=手填送货单号),视图层统一成 DocView
interface DocView {
  单头: (PurchaseReceiptHeader & { 入仓单号?: string }) | null;
  明细: MaterialDocLine[];
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

let rowSeq = 1;
const uid = () => rowSeq++;

const audited = (h?: DocView["单头"] | null) => h?.审核 === "1";

// ---------- 审核徽章 / 列表小徽章 ----------

function AuditBadge({ header }: { header?: DocView["单头"] | null }) {
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

// ---------- 查询页签结果表列(共享查询表 QueryTable;size=宽度权重,单元格类名照原 *Cells) ----------

const qMonoDimCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const qMonoStrongCls = "f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]";
const qMonoPlainCls = "f-mono px-3 py-2 text-[#3d4a5c]";
const qNumCellCls = "f-mono px-3 py-2 text-right text-[#1a2330]";
const qNumBoldCls = "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]";
const qGreenMonoCls = "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]";

const rDetailCol = createColumnHelper<ReceiptQueryDetailRow>();
const receiptDetailTableCols = [
  rDetailCol.accessor("日期", {
    header: "日期",
    size: 8,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: qMonoDimCls },
  }),
  rDetailCol.accessor("单号", { header: "单号", size: 8, meta: { tdClass: qMonoStrongCls } }),
  rDetailCol.accessor("入库单号", { header: "入库单号", size: 9, meta: { tdClass: qGreenMonoCls } }),
  rDetailCol.accessor("订单单号", { header: "订单单号", size: 9, meta: { tdClass: qMonoDimCls } }),
  rDetailCol.accessor("供应商编号", { header: "供应商编号", size: 7 }),
  rDetailCol.accessor("供应商名称", { header: "供应商名称", size: 10 }),
  rDetailCol.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: qMonoPlainCls } }),
  rDetailCol.accessor("款号", { header: "款号", size: 7, meta: { tdClass: qMonoPlainCls } }),
  rDetailCol.accessor("物料编号", { header: "物料编号", size: 8, meta: { tdClass: qMonoStrongCls } }),
  rDetailCol.accessor("物料名称", { header: "物料名称", size: 11 }),
  rDetailCol.accessor("规格", { header: "规格", size: 9 }),
  rDetailCol.accessor("物料类别", { header: "材料", size: 7 }),
  rDetailCol.accessor("颜色", { header: "颜色", size: 6 }),
  rDetailCol.accessor("单位", { header: "单位", size: 4 }),
  rDetailCol.accessor("数量", {
    header: "数量",
    size: 6,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: qNumCellCls },
  }),
  rDetailCol.accessor("备注", { header: "备注", size: 9 }),
  rDetailCol.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) => <StatusPill v={c.getValue()} />,
  }),
];

const tDetailCol = createColumnHelper<ReturnQueryDetailRow>();
const returnDetailTableCols = [
  tDetailCol.accessor("日期", {
    header: "日期",
    size: 8,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: qMonoDimCls },
  }),
  tDetailCol.accessor("单号", { header: "单号", size: 9, meta: { tdClass: qGreenMonoCls } }),
  tDetailCol.accessor("供应商编号", { header: "供应商编号", size: 7 }),
  tDetailCol.accessor("供应商名称", { header: "供应商名称", size: 10 }),
  tDetailCol.accessor("生产单号", { header: "生产单号", size: 9, meta: { tdClass: qMonoPlainCls } }),
  tDetailCol.accessor("款号", { header: "款号", size: 7, meta: { tdClass: qMonoPlainCls } }),
  tDetailCol.accessor("物料编号", { header: "物料编号", size: 8, meta: { tdClass: qMonoStrongCls } }),
  tDetailCol.accessor("物料名称", { header: "物料名称", size: 11 }),
  tDetailCol.accessor("规格", { header: "规格", size: 9 }),
  tDetailCol.accessor("物料类别", { header: "材料", size: 7 }),
  tDetailCol.accessor("颜色", { header: "颜色", size: 6 }),
  tDetailCol.accessor("单位", { header: "单位", size: 4 }),
  tDetailCol.accessor("数量", {
    header: "数量",
    size: 6,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: qNumCellCls },
  }),
  tDetailCol.accessor("备注", { header: "备注", size: 9 }),
  tDetailCol.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) => <StatusPill v={c.getValue()} />,
  }),
];

const rSumCol = createColumnHelper<ReceiptQuerySummaryRow>();
const receiptSummaryTableCols = [
  rSumCol.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: qMonoStrongCls } }),
  rSumCol.accessor("物料名称", { header: "物料名称", size: 12 }),
  rSumCol.accessor("物料类别", { header: "材料", size: 8 }),
  rSumCol.accessor("规格", { header: "规格", size: 10 }),
  rSumCol.accessor("颜色", { header: "颜色", size: 7 }),
  rSumCol.accessor("单位", { header: "单位", size: 5 }),
  rSumCol.accessor("数量", {
    header: "数量",
    size: 7,
    cell: (c) => c.getValue() ?? 0,
    meta: { align: "right", tdClass: qNumBoldCls },
  }),
];

const tSumCol = createColumnHelper<ReturnQuerySummaryRow>();
const returnSummaryTableCols = [
  tSumCol.accessor("物料编号", { header: "物料编号", size: 9, meta: { tdClass: qMonoStrongCls } }),
  tSumCol.accessor("物料名称", { header: "物料名称", size: 12 }),
  tSumCol.accessor("规格", { header: "规格", size: 10 }),
  tSumCol.accessor("物料类别", { header: "材料", size: 8 }),
  tSumCol.accessor("颜色", { header: "颜色", size: 7 }),
  tSumCol.accessor("单位", { header: "单位", size: 5 }),
  tSumCol.accessor("退仓数量", {
    header: "出仓数量",
    size: 7,
    cell: (c) => c.getValue() ?? 0,
    meta: { align: "right", tdClass: qNumBoldCls },
  }),
];

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
  单号: string; // 入仓:送货单号(手填唯一);退仓不用(后端生成)
  入仓单号: string; // 退仓:关联的入仓单号
  供应商编号: string;
  供应商名称: string;
  付款方式: string;
  仓库: string;
  备注: string;
}

const emptyHeader = (kind: DocKind): HeaderFormState => ({
  单号: "",
  入仓单号: "",
  供应商编号: "",
  供应商名称: "",
  付款方式: "",
  // 入仓默认 来料仓(老系统下拉唯一项);退仓默认空,保存必填校验
  仓库: kind.key === "receipt" ? "来料仓" : "",
  备注: "",
});

function HeaderForm({
  kind,
  form,
  setForm,
  操作员,
  onPickSupplier,
}: {
  kind: DocKind;
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  操作员: string;
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
        {kind.key === "receipt" ? (
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
        ) : (
          <FormField label="入仓单号">
            <Input
              className={inputCls}
              aria-label="入仓单号"
              placeholder="关联的采购入仓单号"
              {...bind("入仓单号")}
            />
          </FormField>
        )}
        <FormField label="供应商">
          <div className="flex gap-2">
            <Input
              className={inputCls}
              readOnly
              placeholder="编号 / 名称"
              aria-label="供应商"
              value={[form.供应商编号, form.供应商名称].filter(Boolean).join(" ")}
            />
            <button
              type="button"
              className="f-btn h-10 shrink-0 px-3.5 text-sm"
              onClick={onPickSupplier}
            >
              选择
            </button>
          </div>
        </FormField>
        {kind.key === "receipt" && (
          <FormField label="付款方式">
            <Input className={inputCls} aria-label="付款方式" {...bind("付款方式")} />
          </FormField>
        )}
        <FormField label="仓库">
          <div className="relative">
            <Input
              className={inputCls}
              aria-label="仓库"
              placeholder="来料仓"
              {...bind("仓库")}
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="日期">
          <Input className={inputCls} aria-label="日期" value={today()} disabled />
        </FormField>
        <FormField label="操作员">
          <Input className={inputCls} aria-label="操作员" value={操作员} disabled />
        </FormField>
        {kind.key === "return" && (
          <FormField label="电脑单号">
            <Input className={inputCls} value="" disabled placeholder="保存后自动生成" />
          </FormField>
        )}
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

// ---------- 明细:编辑网格 ----------

function LinesEditor({
  rows,
  priceHidden,
  onPatch,
  onRemove,
  onAddLine,
  onPickOrder,
  onPickMaterial,
  onWholeBring,
}: {
  rows: EditLine[];
  priceHidden: boolean;
  onPatch: (key: number, patch: Partial<EditLine>) => void;
  onRemove: (key: number) => void;
  onAddLine: () => void;
  onPickOrder: (key: number) => void;
  onPickMaterial: (key: number) => void;
  onWholeBring: () => void;
}) {
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
  return (
    <div className="f-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
        <div className="flex gap-2">
          <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onAddLine}>
            <Plus className="h-4 w-4" />
            加一行
          </button>
          <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onWholeBring}>
            整单带入
          </button>
        </div>
        <span className="text-sm text-[#5f6b7d]">
          整单带入按采购订单欠数全收;数量只入库存,不关联生产通知单数量
        </span>
      </div>
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1200px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "序号",
                "款号",
                "物料",
                "规格",
                "颜色",
                "单位",
                "数量",
                "备品",
                "备品数量",
                "收后欠数",
                ...(priceHidden ? [] : ["单价", "金额"]),
                "操作",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    thCls,
                    (h === "数量" || h === "备品数量" || h === "收后欠数" || h === "单价" || h === "金额") &&
                      "text-right",
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
                <td
                  colSpan={priceHidden ? 11 : 13}
                  className="px-4 py-6 text-center text-sm text-disabled"
                >
                  还没有明细行,点「加一行」手选物料,或用「整单带入」按采购订单欠数带入
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const owed = owedAfter(r);
                const spareQty = Number(r.备品数量 || 0);
                return (
                  <tr key={r.key} className="border-b border-black/6 last:border-0">
                    <td className="px-3 py-2 text-disabled">{i + 1}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="f-mono text-sm font-medium text-[#15803d] hover:underline"
                        title={r.订单单号 ? `订单 ${r.订单单号}` : "选采购订单欠数行"}
                        onClick={() => onPickOrder(r.key)}
                      >
                        {r.款号 ? r.款号 : "选订单"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className={cn(
                          "text-sm hover:underline",
                          r.物料编号 ? "f-mono text-[#1a2330]" : "font-medium text-[#15803d]",
                        )}
                        onClick={() => onPickMaterial(r.key)}
                      >
                        {r.物料编号 ? `${r.物料编号} ${r.物料名称}` : "选物料"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                    <td className="px-3 py-2">
                      <Input
                        className={cn(inputCls, "h-9 w-20")}
                        aria-label="颜色"
                        value={r.颜色 ?? ""}
                        onChange={(e) => onPatch(r.key, { 颜色: e.target.value })}
                      />
                    </td>
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
                      {/* 供应商多送的备品:勾选后出现备品数量输入;超收行自动把超收部分拆到备品数量 */}
                      <Checkbox
                        aria-label={`行${i + 1} 备品`}
                        title="供应商多送的备品:勾选后填写备品数量,备品不占订单欠数"
                        className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                        checked={!!r.备品}
                        onCheckedChange={(v) =>
                          onPatch(r.key, spareTogglePatch(r, v === true))
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      {r.备品 ? (
                        <Input
                          type="number"
                          min={0}
                          aria-label={`行${i + 1} 备品数量`}
                          title="备品数量:供应商多送的部分,不占订单欠数,审核后计入可用库存"
                          className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                          value={r.备品数量 ?? ""}
                          onChange={(e) => onPatch(r.key, { 备品数量: e.target.value })}
                        />
                      ) : (
                        <span className="block text-right text-disabled">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.备品 && spareQty > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            title="备品入库:不占订单欠数,审核后计入可用库存"
                            className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#15803d]"
                          >
                            备品 {spareQty}
                          </span>
                          {owed == null ? null : owed.kind === "欠" ? (
                            <span
                              title="本次数量(订单部分) < 订单欠数"
                              className="font-semibold text-[#dc2626]"
                            >
                              欠 {owed.value}
                            </span>
                          ) : owed.kind === "超收" ? (
                            <span
                              title="本次数量(订单部分)仍超订单欠数,超收部分请挪入备品数量"
                              className="font-semibold text-[#d97706]"
                            >
                              超收 {owed.value}
                            </span>
                          ) : (
                            <span className="font-semibold text-[#15803d]">已完成</span>
                          )}
                        </span>
                      ) : r.备品 ? (
                        <span
                          title="备品入库:不占订单欠数,审核后计入可用库存"
                          className="font-semibold text-[#15803d]"
                        >
                          备品
                        </span>
                      ) : owed == null ? (
                        <span className="text-disabled">-</span>
                      ) : owed.kind === "欠" ? (
                        <span
                          title="本次数量 < 订单欠数"
                          className="font-semibold text-[#dc2626]"
                        >
                          欠 {owed.value}
                        </span>
                      ) : owed.kind === "超收" ? (
                        <span
                          title="本次数量 > 订单欠数"
                          className="font-semibold text-[#d97706]"
                        >
                          超收 {owed.value}
                        </span>
                      ) : (
                        <span className="font-semibold text-[#15803d]">已完成</span>
                      )}
                    </td>
                    {!priceHidden && (
                      <>
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
                        <td className="f-mono px-3 py-2 text-right whitespace-nowrap text-[#3d4a5c]">
                          {(Number(r.数量) || 0) * (Number(r.单价) || 0)}
                        </td>
                      </>
                    )}
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
        {!priceHidden && (
          <span className="ml-6">
            金额合计:<span className="f-mono">{sumAmount(rows)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- 明细:查看态(只读) ----------

function LinesView({
  lines,
  priceHidden,
}: {
  lines: MaterialDocLine[];
  priceHidden: boolean;
}) {
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));
  return (
    <div className="f-panel overflow-hidden">
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1200px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              {[
                "订单单号",
                "生产单号",
                "款号",
                "物料编号",
                "物料名称",
                "规格",
                "颜色",
                "单位",
                "数量",
                "备品",
                ...(priceHidden ? [] : ["单价", "金额"]),
                "备注",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 text-left font-medium whitespace-nowrap normal-case",
                    (h === "数量" || h === "单价" || h === "金额") && "text-right",
                    h === "备品" && "text-center",
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
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#15803d]">
                  {txt(l.订单单号)}
                </td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#3d4a5c]">
                  {txt(l.生产单号)}
                </td>
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(l.款号)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">
                  {txt(l.物料编号)}
                </td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
                <td className="px-4 py-2 text-center whitespace-nowrap">
                  {Number(l.备品数量 ?? 0) > 0 ? (
                    <span
                      title="备品:供应商多送,不占订单欠数"
                      className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-medium text-[#15803d]"
                    >
                      备品 {l.备品数量}
                    </span>
                  ) : l.备品 === "1" ? (
                    <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-medium text-[#15803d]">
                      备品
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                {!priceHidden && (
                  <>
                    <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">{money(l.单价)}</td>
                    <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">{money(l.金额)}</td>
                  </>
                )}
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

type OpenRow = PurchaseReceiptHeader & { 入仓单号?: string };
const openCol = createColumnHelper<OpenRow>();

function useOpenColumns(priceHidden: boolean) {
  return useMemo<ColumnDef<OpenRow, any>[]>(
    () => [
      openCol.accessor("单号", {
        header: "单号",
        size: 22,
        cell: (c) => txt(c.getValue()),
        meta: {
          tdClass: "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]",
        },
      }),
      openCol.accessor("日期", {
        header: "日期",
        size: 13,
        cell: (c) => fmtDate(c.getValue()),
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      openCol.accessor("供应商名称", {
        header: "供应商名称",
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
        meta: {
          align: "right",
          tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]",
        },
      }),
      openCol.accessor("金额", {
        header: "金额",
        size: 10,
        cell: (c) => (priceHidden ? "***" : fmtNum(c.getValue(), 2)),
        meta: {
          align: "right",
          tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]",
        },
      }),
      openCol.display({
        id: "状态",
        header: "状态",
        size: 11,
        cell: (c) => <StatusPill v={c.row.original.审核} />,
        meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
      }),
    ],
    [priceHidden],
  );
}

// ---------- 页面 ----------
// 入仓/退仓是两个固定 kind 的薄包装组件,MainLayout 两条路由分别指向。
// 禁止从全局 location 推导身份:keep-alive 下所有标签常驻挂载并订阅 location,
// 开退仓标签会让入仓实例 kind 变化、整体重挂载,未保存表单被销毁(终审 Critical)。

export default function PurchaseReceiptPage() {
  return <DocPage kind={RECEIPT} />;
}

export function PurchaseReturnsPage() {
  return <DocPage kind={RETURN} />;
}

function DocPage({ kind }: { kind: DocKind }) {
  const qc = useQueryClient();
  const { can } = usePerms();
  const priceHidden = !can(kind.menu, "单价");
  const currentUser = getUser() || "用户";
  const api = kind.key === "receipt" ? purchaseReceiptApi : purchaseReturnApi;

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(() => emptyHeader(kind));
  const [rows, setRows] = useState<EditLine[]>([]);
  const [saving, setSaving] = useState(false);

  // 弹窗开关
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false); // 批量审核弹窗(多选模式,只列未审核单)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()); // 勾选的未审核单号
  const [batchRunning, setBatchRunning] = useState(false); // 批量审核中
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierKw, setSupplierKw] = useState("");
  const [materialPickFor, setMaterialPickFor] = useState<number | null>(null);
  const [materialKw, setMaterialKw] = useState("");
  const [orderPickFor, setOrderPickFor] = useState<number | null>(null);
  const [orderKw, setOrderKw] = useState("");
  const [wholeOpen, setWholeOpen] = useState(false);
  const [wholeKw, setWholeKw] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 首次进入自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: [kind.key, "first"],
    queryFn: () => api.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  const detailQuery = useQuery({
    queryKey: [kind.key, "detail", 单号],
    queryFn: () => api.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: [kind.key, "list", page, keyword],
    queryFn: () => api.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen || batchOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;
  // 批量审核只列未审核单(后端列表无审核过滤,本页内前端过滤;老系统同口径:勾选的已审核单跳过)
  const batchRows = (listQuery.data?.items ?? []).filter((r) => r.审核 !== "1");

  const suppliersQuery = useQuery({
    queryKey: [kind.key, "suppliers", supplierKw],
    queryFn: () => suppliersApi.list(1, 500, supplierKw),
    placeholderData: keepPreviousData,
    enabled: supplierOpen,
  });

  const materialsQuery = useQuery({
    queryKey: [kind.key, "materials", materialKw],
    queryFn: () => materialMasterApi.list(undefined, materialKw || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: materialPickFor !== null,
  });

  // 选订单(单行):已审核有欠数的订单行,按表头供应商过滤
  const orderLinesQuery = useQuery({
    queryKey: [kind.key, "order-lines", form.供应商编号, orderKw],
    queryFn: () =>
      purchaseOrderApi.progress({
        onlyOwed: true,
        供应商: form.供应商编号 || undefined,
        keyword: orderKw || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: orderPickFor !== null,
  });

  // 整单带入:全量欠数行,弹窗内按采购单号分组挑选
  const wholeQuery = useQuery({
    queryKey: [kind.key, "whole", form.供应商编号],
    queryFn: () =>
      purchaseOrderApi.progress({ onlyOwed: true, 供应商: form.供应商编号 || undefined }),
    enabled: wholeOpen,
  });

  const detail: DocView | undefined = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = audited(header);
  const openColumns = useOpenColumns(priceHidden);

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));
  const patchRow = (key: number, patch: Partial<EditLine>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // ---------- 新建 ----------
  const reset = () => {
    setMode("new");
    set单号(null);
    setFormState(emptyHeader(kind));
    setRows([]);
  };

  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const onPickSupplier = (s: SupplierRow) => {
    setForm({ 供应商编号: s.供应商编号 ?? "", 供应商名称: s.供应商名称 ?? "" });
    setSupplierOpen(false);
  };

  // 行内选订单欠数行:整行带出(数量=欠数),订单单号=采购单号
  const fillFromOrder = (row: PurchaseOrderProgressRow) => {
    if (orderPickFor === null) return;
    const mapped = orderRowToLine(row, orderPickFor);
    patchRow(orderPickFor, { ...mapped, key: orderPickFor });
    setOrderPickFor(null);
  };

  const fillFromMaterial = (m: {
    物料编号?: string;
    物料名称?: string;
    物料类别?: string;
    规格?: string;
    颜色?: string;
    单位?: string;
    单价?: number | null;
  }) => {
    if (materialPickFor === null) return;
    patchRow(materialPickFor, {
      物料编号: m.物料编号 ?? "",
      物料名称: m.物料名称 ?? "",
      物料类别: m.物料类别,
      规格: m.规格,
      颜色: m.颜色,
      单位: m.单位,
      单价: priceHidden || m.单价 == null ? "" : String(m.单价),
    });
    setMaterialPickFor(null);
  };

  // 整单带入弹窗:欠数行按采购单号分组(一张订单一行,货号去重合并)
  type WholeGroup = {
    采购单号: string;
    订购日期?: string;
    供应商名称?: string;
    货号: string;
    行数: number;
    欠数: number;
  };
  const wholeGroups: WholeGroup[] = (() => {
    const map = new Map<string, WholeGroup & { _款号: Set<string> }>();
    for (const r of wholeQuery.data ?? []) {
      const no = (r.采购单号 ?? "").trim();
      if (!no) continue;
      let g = map.get(no);
      if (!g) {
        g = {
          采购单号: no,
          订购日期: date10(r.订购日期),
          供应商名称: r.供应商名称,
          货号: "",
          行数: 0,
          欠数: 0,
          _款号: new Set(),
        };
        map.set(no, g);
      }
      if (r.款号) g._款号.add(r.款号);
      g.行数 += 1;
      g.欠数 += Number(r.欠数 ?? 0);
    }
    return [...map.values()]
      .map(({ _款号, ...g }) => ({ ...g, 货号: [..._款号].join("、") }))
      .sort((a, b) => b.采购单号.localeCompare(a.采购单号));
  })();
  const wholeKwL = wholeKw.trim().toLowerCase();
  const wholeFiltered = wholeKwL
    ? wholeGroups.filter(
        (g) => g.采购单号.toLowerCase().includes(wholeKwL) || g.货号.toLowerCase().includes(wholeKwL),
      )
    : wholeGroups;

  // 带入该采购单全部欠数行(数量=欠数全收);表头供应商为空时顺带带出
  const bringWholeOrder = (采购单号: string) => {
    const rows0 = (wholeQuery.data ?? []).filter(
      (r) => (r.采购单号 ?? "").trim() === 采购单号,
    );
    if (rows0.length === 0) {
      setToast({ text: `未找到采购单 ${采购单号} 的欠数行`, tone: "err" });
      return;
    }
    setRows((prev) => [...prev.filter((l) => l.物料编号), ...rows0.map((r) => orderRowToLine(r, uid()))]);
    if (!form.供应商编号 && rows0[0].供应商编号)
      setForm({ 供应商编号: rows0[0].供应商编号, 供应商名称: rows0[0].供应商名称 ?? "" });
    setToast({ text: `已带入 ${rows0.length} 行(默认全收欠数)`, tone: "ok" });
    setWholeOpen(false);
  };

  // ---------- 保存(只新建;入仓/退仓单保存后不可改,后端无 PUT) ----------
  const doSave = async () => {
    if (kind.key === "receipt" && !form.单号.trim()) {
      setToast({ text: "请填写送货单号", tone: "err" });
      return;
    }
    if (!form.仓库.trim()) {
      setToast({ text: "请填写仓库", tone: "err" });
      return;
    }
    const ok = validLines(rows);
    if (ok.length === 0) {
      setToast({ text: "请至少录入一行有效物料明细", tone: "err" });
      return;
    }
    // 勾了备品但没填备品数量:没有备品可入,提示(防误勾后整行被当备品)
    const noSpareQty = ok.find((l) => l.备品 && Number(l.备品数量 || 0) <= 0);
    if (noSpareQty) {
      setToast({
        text: `物料 ${noSpareQty.物料编号} 勾选了备品但未填备品数量;请填入备品数量或取消勾选`,
        tone: "err",
      });
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...(kind.key === "receipt"
          ? { 单号: form.单号.trim(), 付款方式: form.付款方式.trim() || undefined }
          : { 入仓单号: form.入仓单号.trim() || undefined }),
        供应商编号: form.供应商编号.trim() || undefined,
        供应商名称: form.供应商名称.trim() || undefined,
        日期: today(),
        仓库: form.仓库.trim(),
        备注: form.备注.trim() || undefined,
        明细: ok.map(toSubmitLine),
      };
      const r = await api.create(body);
      setToast({ text: `${kind.title}已创建:${r.单号}`, tone: "ok" });
      setMode("view");
      set单号(r.单号);
      void qc.invalidateQueries({ queryKey: [kind.key, "first"] });
      void qc.invalidateQueries({ queryKey: [kind.key, "list"] });
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // ---------- 审核(=入库存/退回供应商) / 反审核 / 删除 ----------
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      await fn();
      setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        void qc.invalidateQueries({ queryKey: [kind.key, "first"] });
        void qc.invalidateQueries({ queryKey: [kind.key, "list"] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // ---------- 批量审核(对照老系统 MaterialDocPage.batchApprove:逐张调审核接口,汇总成功/失败) ----------
  const doBatchApprove = async () => {
    const targets = [...selected];
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
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: [kind.key, "list"] });
    void qc.invalidateQueries({ queryKey: [kind.key, "first"] });
    void qc.invalidateQueries({ queryKey: [kind.key, "detail"] });
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
    ...(isView && !isAudited
      ? [
          {
            key: "audit",
            label: "审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(
                () => api.approve(单号!),
                kind.key === "receipt" ? "已审核(入库存)" : "已审核(退回供应商)",
                "reload",
              ),
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

  // ---------- 打印:开新窗口渲染单头+明细(对照老系统 printMaterialDoc;价格按权限脱敏) ----------
  const doPrint = () => {
    if (!detail?.单头) return;
    printMaterialDoc(
      `${kind.title} ${单号 ?? ""}`,
      { 单头: { ...detail.单头 }, 明细: detail.明细 },
      {
        hidePrice: priceHidden,
        // 单头额外字段照抄老系统 listExtra(供应商/仓库)
        headerFields: [
          { name: "供应商名称", label: "供应商" },
          { name: "仓库", label: "仓库" },
        ],
      },
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
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        ...(kind.key === "return"
          ? [{ label: "入仓单号", value: txt(header.入仓单号), mono: true }]
          : []),
        { label: "供应商名称", value: txt(header.供应商名称), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "金额", value: priceHidden ? "***" : String(header.金额 ?? "-"), mono: true },
        ...(kind.key === "receipt"
          ? [{ label: "付款方式", value: txt(header.付款方式), mono: true }]
          : []),
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
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
          {kind.title}
          {tab === "doc" && (isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : "")}
        </h1>
        {tab === "doc" && isView && <AuditBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: kind.title },
              { key: "query" as const, label: kind.queryLabel },
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
            <FlowSteps steps={["开单", kind.flowAudit]} current={isAudited ? 1 : 0} />
          )}
        </div>
      </div>

      {tab === "query" ? (
        <QueryPanel kind={kind} onOpenDoc={(no) => {
          setTab("doc");
          setMode("view");
          set单号(no);
        }} />
      ) : (
        <>
          {/* 操作栏:编辑 / 审核流转 / 打印 三组,组间分隔线 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={kind.menu} />
            {auditActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={auditActions} menuKey={kind.menu} />
              </>
            )}
            {can(kind.menu, "审核") && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={batchActions} menuKey={kind.menu} />
              </>
            )}
            {printActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={printActions} menuKey={kind.menu} />
              </>
            )}
          </div>

          {/* 单头:新建 = 表单;查看 = 只读单头卡(入仓/退仓单保存后不可改) */}
          {mode === "new" ? (
            <HeaderForm
              kind={kind}
              form={form}
              setForm={setForm}
              操作员={currentUser}
              onPickSupplier={() => setSupplierOpen(true)}
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
                description={`点击上方「打开」选择一张${kind.title},或点「新建」开一张新单`}
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
                onAddLine={() =>
                  setRows((rs) => [...rs, { key: uid(), 物料编号: "", 物料名称: "", 数量: "", 单价: "" }])
                }
                onPickOrder={(key) => {
                  setOrderKw("");
                  setOrderPickFor(key);
                }}
                onPickMaterial={(key) => {
                  setMaterialKw("");
                  setMaterialPickFor(key);
                }}
                onWholeBring={() => {
                  setWholeKw("");
                  setWholeOpen(true);
                }}
              />
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
                  <LinesView lines={detail?.明细 ?? []} priceHidden={priceHidden} />
                )}
              </div>
            )
          )}
        </>
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title={`打开${kind.title}`}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns}
        rows={(listQuery.data?.items ?? []) as OpenRow[]}
        searchPlaceholder="单号 / 供应商 / 备注"
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
        description="按单号、供应商或备注搜索,点击一行打开"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint={`没有匹配的${kind.title},换个关键字试试`}
      />

      {/* 批量审核(多选模式,只列未审核单;分页/关键字与打开弹窗共用) */}
      <OpenDocDialog
        title={`批量审核${kind.title}`}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        columns={openColumns}
        rows={batchRows}
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
        description="仅列未审核单,勾选后逐张审核;部分失败时失败的单保留在列表"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint={`本页没有未审核的${kind.title}`}
      />

      {/* 选择供应商 */}
      <PickerDialog
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title="选择供应商"
        width="sm:max-w-[560px]"
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
              <th className={pickerThCls}>供应商编号</th>
              <th className={pickerThCls}>供应商名称</th>
            </tr>
          </thead>
          <tbody>
            {(suppliersQuery.data?.items ?? []).map((s, i) => (
              <tr
                key={s.供应商编号 ?? i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => onPickSupplier(s)}
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

      {/* 行内选物料 */}
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
          <Input
            name="kw"
            className={inputCls}
            placeholder="物料编号/名称/规格/颜色/供应商"
            aria-label="物料搜索"
          />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["物料编号", "物料名称", "规格", "材料", "颜色", "单位", "库存", ...(priceHidden ? [] : ["单价"])].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(pickerThCls, (h === "库存" || h === "单价") && "text-right")}
                  >
                    {h}
                  </th>
                ),
              )}
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
                {!priceHidden && (
                  <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{m.单价 ?? ""}</td>
                )}
              </tr>
            ))}
            {materialsQuery.isSuccess && (materialsQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td
                  colSpan={priceHidden ? 7 : 8}
                  className="px-3 py-4 text-center text-sm text-disabled"
                >
                  没有匹配的物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 行内选订单(仅列欠数行) */}
      <PickerDialog
        open={orderPickFor !== null}
        onClose={() => setOrderPickFor(null)}
        title="选择采购订单明细(仅列欠数行)"
        width="sm:max-w-[940px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setOrderKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input
            name="kw"
            className={inputCls}
            placeholder="款号/物料/生产单号"
            aria-label="订单搜索"
          />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["订单单号", "款号", "物料编号", "物料名称", "规格", "颜色", "单位", "订购", "已入仓", "欠数"].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(pickerThCls, (h === "订购" || h === "已入仓" || h === "欠数") && "text-right")}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(orderLinesQuery.data ?? []).map((r, i) => (
              <tr
                key={`${r.采购单号}-${r.物料编号}-${i}`}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => fillFromOrder(r)}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.采购单号}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.款号}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{r.物料编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.规格}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.单位}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.订购数量 ?? 0}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.入仓数量 ?? 0}</td>
                <td className="f-mono px-3 py-2 text-right font-semibold text-[#dc2626]">
                  {r.欠数 ?? 0}
                </td>
              </tr>
            ))}
            {orderLinesQuery.isSuccess && (orderLinesQuery.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-center text-sm text-disabled">
                  没有欠数的采购订单行
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 整单带入采购订单(仅列仍有欠数的订单,一张订单一行) */}
      <PickerDialog
        open={wholeOpen}
        onClose={() => setWholeOpen(false)}
        title="整单带入采购订单"
        width="sm:max-w-[880px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setWholeKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input
            name="kw"
            className={inputCls}
            placeholder="按采购单号/货号查询"
            aria-label="整单搜索"
          />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["采购单号", "订购日期", "供应商", "货号", "欠数行", "欠数合计", ""].map((h) => (
                <th
                  key={h}
                  className={cn(pickerThCls, (h === "欠数行" || h === "欠数合计") && "text-right")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {wholeFiltered.map((g) => (
              <tr key={g.采购单号} className="h-11 border-b border-black/6 last:border-0">
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{g.采购单号}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{g.订购日期}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{g.供应商名称 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{g.货号}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{g.行数}</td>
                <td className="f-mono px-3 py-2 text-right font-semibold text-[#dc2626]">{g.欠数}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#15803d] hover:underline"
                    onClick={() => bringWholeOrder(g.采购单号)}
                  >
                    带入
                  </button>
                </td>
              </tr>
            ))}
            {wholeQuery.isSuccess && wholeFiltered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-disabled">
                  没有带欠数的采购订单
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-[#5f6b7d]">
          仅列仍有欠数的采购订单(一张订单一行);点「带入」把该单全部欠数行带进来,数量默认=欠数(全收);当前空白行会被替换
        </p>
      </PickerDialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`确认删除该${kind.title}?`}
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

// ---------- 查询页签(明细/汇总;对照老系统 PurchaseReceiptQueryPage / PurchaseReturnQueryPage) ----------

function QueryPanel({ kind, onOpenDoc }: { kind: DocKind; onOpenDoc: (单号: string) => void }) {
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
  });

  const params = buildDocQuery({
    keyword: kw,
    类别,
    审核情况,
    起: range.起,
    止: range.止,
  });

  const detailQuery = useQuery({
    queryKey: [kind.key, "query-detail", params],
    queryFn: () =>
      kind.key === "receipt"
        ? purchaseReceiptApi.queryDetail(params)
        : purchaseReturnApi.queryDetail(params),
    placeholderData: keepPreviousData,
    enabled: sub === "detail",
  });
  const summaryQuery = useQuery({
    queryKey: [kind.key, "query-summary", params],
    queryFn: () =>
      kind.key === "receipt"
        ? purchaseReceiptApi.querySummary(params)
        : purchaseReturnApi.querySummary(params),
    placeholderData: keepPreviousData,
    enabled: sub === "summary",
  });

  const receiptDetail = kind.key === "receipt" ? (detailQuery.data as ReceiptQueryDetailRow[] | undefined) : undefined;
  const returnDetail = kind.key === "return" ? (detailQuery.data as ReturnQueryDetailRow[] | undefined) : undefined;
  const receiptSummary = kind.key === "receipt" ? (summaryQuery.data as ReceiptQuerySummaryRow[] | undefined) : undefined;
  const returnSummary = kind.key === "return" ? (summaryQuery.data as ReturnQuerySummaryRow[] | undefined) : undefined;

  // 导出/打印列(对照老系统 detailExportCols / summaryExportCols)
  const detailCols: ExportCol[] =
    kind.key === "receipt"
      ? [
          { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
          { title: "单号", key: "单号" },
          { title: "入库单号", key: "入库单号" },
          { title: "订单单号", key: "订单单号" },
          { title: "供应商编号", key: "供应商编号" },
          { title: "供应商名称", key: "供应商名称" },
          { title: "生产单号", key: "生产单号" },
          { title: "款号", key: "款号" },
          { title: "物料编号", key: "物料编号" },
          { title: "物料名称", key: "物料名称" },
          { title: "规格", key: "规格" },
          { title: "材料", key: "物料类别" },
          { title: "颜色", key: "颜色" },
          { title: "单位", key: "单位" },
          { title: "数量", key: "数量" },
          { title: "备注", key: "备注" },
          { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
        ]
      : [
          { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
          { title: "单号", key: "单号" },
          { title: "供应商编号", key: "供应商编号" },
          { title: "供应商名称", key: "供应商名称" },
          { title: "生产单号", key: "生产单号" },
          { title: "款号", key: "款号" },
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
  const summaryCols: ExportCol[] =
    kind.key === "receipt"
      ? [
          { title: "物料编号", key: "物料编号" },
          { title: "物料名称", key: "物料名称" },
          { title: "材料", key: "物料类别" },
          { title: "规格", key: "规格" },
          { title: "颜色", key: "颜色" },
          { title: "单位", key: "单位" },
          { title: "数量", key: "数量" },
        ]
      : [
          { title: "物料编号", key: "物料编号" },
          { title: "物料名称", key: "物料名称" },
          { title: "规格", key: "规格" },
          { title: "材料", key: "物料类别" },
          { title: "颜色", key: "颜色" },
          { title: "单位", key: "单位" },
          { title: "出仓数量", key: "退仓数量" },
        ];

  const exportTarget = () =>
    sub === "detail"
      ? {
          cols: detailCols,
          rows: (detailQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: kind.key === "receipt" ? "采购入仓明细" : "采购退仓明细",
        }
      : {
          cols: summaryCols,
          rows: (summaryQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: kind.key === "receipt" ? "采购入仓汇总" : "采购退仓汇总",
        };

  const activeQuery = sub === "detail" ? detailQuery : summaryQuery;
  const rowCount = (activeQuery.data ?? []).length;

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
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
            className={cn(inputCls, "w-28 rounded-md border px-2")}
            value={审核情况}
            options={[ALL_APPROVAL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set审核情况(v)}
          />
        </FormField>
        <FormField label="物料类别">
          <SearchSelect
            ariaLabel="物料类别"
            className={cn(inputCls, "w-40 rounded-md border px-2")}
            value={类别}
            options={[
              { value: ALL_CAT, label: "所有类别" },
              ...(catsQuery.data ?? [])
                .filter((c: MaterialCategoryNode) => c.类别)
                .map((c) => ({ value: c.类别!, label: `${c.类别}(${c.数量})` })),
            ]}
            onChange={(v) => set类别(v)}
          />
        </FormField>
        <FormField label="关键字">
          <Input
            className={cn(inputCls, "w-60")}
            placeholder={
              kind.key === "receipt"
                ? "单号/入库单号/订单号/供应商/物料"
                : "单号/供应商/物料编号/名称/规格"
            }
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

      {/* 明细/汇总子页签 + 密度切换 */}
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

      {/* 结果表(共享查询表:虚拟滚动 + 密度三档 + sticky 表头内置) */}
      {sub === "detail" ? (
        kind.key === "receipt" ? (
          <QueryTable
            columns={receiptDetailTableCols}
            rows={receiptDetail ?? []}
            isLoading={activeQuery.isLoading}
            isError={activeQuery.isError}
            onRetry={() => activeQuery.refetch()}
            errorMessage={`加载${kind.queryLabel}失败,请重试`}
            emptyIcon={<Prohibit className="h-5 w-5" />}
            emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
            minWidth={1500}
            onRowDoubleClick={(r) => {
              if (r.入库单号) onOpenDoc(r.入库单号);
            }}
            rowTitle={(r) => `双击打开整单 ${r.入库单号 ?? ""}`}
            footer={`共 ${rowCount} 条,双击行打开${kind.title}整单`}
          />
        ) : (
          <QueryTable
            columns={returnDetailTableCols}
            rows={returnDetail ?? []}
            isLoading={activeQuery.isLoading}
            isError={activeQuery.isError}
            onRetry={() => activeQuery.refetch()}
            errorMessage={`加载${kind.queryLabel}失败,请重试`}
            emptyIcon={<Prohibit className="h-5 w-5" />}
            emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
            minWidth={1500}
            onRowDoubleClick={(r) => {
              if (r.单号) onOpenDoc(r.单号);
            }}
            rowTitle={(r) => `双击打开整单 ${r.单号 ?? ""}`}
            footer={`共 ${rowCount} 条,双击行打开${kind.title}整单`}
          />
        )
      ) : kind.key === "receipt" ? (
        <QueryTable
          columns={receiptSummaryTableCols}
          rows={receiptSummary ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage={`加载${kind.queryLabel}失败,请重试`}
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={900}
          footer={`共 ${rowCount} 条`}
        />
      ) : (
        <QueryTable
          columns={returnSummaryTableCols}
          rows={returnSummary ?? []}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => activeQuery.refetch()}
          errorMessage={`加载${kind.queryLabel}失败,请重试`}
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={900}
          footer={`共 ${rowCount} 条`}
        />
      )}
    </div>
  );
}
