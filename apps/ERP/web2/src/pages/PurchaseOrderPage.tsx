import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClipboardText,
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
  replenishmentApi,
  suppliersApi,
} from "@/api/endpoints";
import type {
  MasterMaterialRow,
  PurchaseOrderBasisRow,
  PurchaseOrderCreate,
  PurchaseOrderCreateLine,
  PurchaseOrderHeader,
  PurchaseOrderLine,
  ReplenishmentDetail,
  ReplenishmentHeader,
  SupplierRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { printPurchaseOrder } from "@/lib/printPurchaseOrder";
import {
  applyLossRate,
  parse材料,
  replenishPurchaseLines,
  shouldDefaultSelect,
} from "@/lib/purchaseOrder";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocHeaderCard, type HeaderField } from "@/components/doc/DocHeaderCard";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { usePerms } from "@/hooks/usePerms";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

// 权限菜单名:与后端 MenuCatalog(物料管理/采购订单)及老系统 MENU 常量一致
const MENU = "采购订单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");

let rowSeq = 1;
const uid = () => rowSeq++;

// 锁定的 生产单号 单元格 tooltip 文案
const LOCK_TOOLTIP = "补料单已挂生产单号,锁定不可改(贯穿到入库/统计)";

// ---------- 编辑态类型 ----------

interface EditRow {
  key: number;
  生产单号?: string;
  锁定生产单号?: boolean; // 补料带入且补料单挂了生产单号:锁死不可改
  款号?: string;
  物料编号: string;
  物料名称: string;
  物料类别?: string;
  规格?: string;
  材料?: string;
  颜色?: string;
  单位?: string;
  数量: string; // 输入框受控值,保存时 Number() 转换
  单价: string;
  需订数量?: number; // basis 带出的需订数量,保存时作 预算数量 提交
  供应商编号?: string; // BOM 默认供应商(选择供应商时自动勾选匹配行)
  供应商名称?: string;
  已订数量?: number; // 该生产单下已下单数量(>0=已下单,默认不勾选,重复下单需确认)
  可用库存?: number; // 实时库存(>=需订数量=库存够,默认不勾选下单)
  采购损耗率?: number | null; // 采购物料设置(%):默认数量=需订×(1+损耗率/100),可手改
  备注?: string;
  fromBasis?: boolean; // 生产单 basis 带入的行(切换供应商时按 默认供应商 从 basisPool 重算显隐)
  basisId?: number; // 生产BOM物料清单.ID(分析页勾选行随 URL「行」参数带入时按它对齐勾选)
}

interface HeaderFormState {
  供应商编号: string;
  供应商名称: string;
  日期: string;
  交货日期: string;
  PO号: string;
  收件人: string;
  仓库: string;
  备注: string;
}

const emptyHeader = (): HeaderFormState => ({
  供应商编号: "",
  供应商名称: "",
  日期: new Date().toISOString().slice(0, 10),
  交货日期: "",
  PO号: "",
  收件人: "",
  仓库: "",
  备注: "",
});

// 默认供应商记忆:采购订单选过供应商后,下次新建自动带出(本地按浏览器记住)
const LAST_SUPPLIER_KEY = "po.lastSupplier";
const readLastSupplier = (): { 供应商编号: string; 供应商名称: string } | null => {
  try {
    const raw = localStorage.getItem(LAST_SUPPLIER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { 供应商编号?: unknown; 供应商名称?: unknown };
    return typeof v?.供应商编号 === "string" && v.供应商编号
      ? { 供应商编号: v.供应商编号, 供应商名称: typeof v.供应商名称 === "string" ? v.供应商名称 : "" }
      : null;
  } catch {
    return null;
  }
};

// basis 行 -> 编辑行(预填/录入清单共用;数量默认=需订×(1+采购损耗率/100),可手改)
const basisToRow = (b: PurchaseOrderBasisRow, mo?: string): EditRow => ({
  key: uid(),
  basisId: b.ID,
  生产单号: mo,
  物料编号: b.物料编号,
  物料名称: b.物料名称 ?? "",
  物料类别: b.物料类别,
  规格: b.规格,
  颜色: b.颜色,
  单位: b.单位,
  数量: applyLossRate(b.需订数量, b.采购损耗率)?.toString() ?? "",
  单价: b.预算单价 != null ? String(b.预算单价) : "",
  需订数量: b.需订数量,
  供应商编号: b.供应商编号,
  供应商名称: b.供应商名称,
  已订数量: b.已订数量 != null ? Number(b.已订数量) : undefined,
  可用库存: b.可用库存 != null ? Number(b.可用库存) : undefined,
  采购损耗率: b.采购损耗率 != null ? Number(b.采购损耗率) : undefined,
  fromBasis: true,
});

// 已有单明细 -> 编辑行(供应商/可用库存随详情返回,重开已存单能看到)
const lineToRow = (l: PurchaseOrderLine): EditRow => ({
  key: uid(),
  生产单号: l.生产单号,
  款号: l.款号,
  物料编号: l.物料编号 ?? "",
  物料名称: l.物料名称 ?? "",
  物料类别: l.物料类别,
  规格: l.规格,
  材料: l.材料,
  颜色: l.颜色,
  单位: l.单位,
  数量: l.数量 != null ? String(l.数量) : "",
  单价: l.单价 != null ? String(l.单价) : "",
  需订数量: l.预算数量 != null ? Number(l.预算数量) : undefined,
  供应商编号: l.供应商编号,
  供应商名称: l.供应商名称,
  可用库存: l.可用库存 != null ? Number(l.可用库存) : undefined,
  备注: l.备注,
});

const audited = (h?: PurchaseOrderHeader | null) => h?.审核 === "1";

// ---------- 审核徽章(三级流转:未审核 -> 主管已审 -> 经理已审 -> 已审核(已下发)) ----------

function AuditBadge({ header }: { header?: PurchaseOrderHeader | null }) {
  if (audited(header))
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/60 bg-[#16a34a]/10 px-4 py-1.5 text-sm font-semibold text-[#15803d] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_12px_-2px_rgb(22_163_74/0.35)]">
        <span className="f-pulse h-2 w-2 rounded-full bg-[#16a34a]" />
        已审核
      </span>
    );
  if (header?.经理审核 === "1")
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-info/50 bg-info/10 px-4 py-1.5 text-sm font-semibold text-info-foreground">
        经理已审{header.经理审核人 ? `(${header.经理审核人})` : ""}
      </span>
    );
  if (header?.主管审核 === "1")
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-4 py-1.5 text-sm font-semibold text-[var(--warning,#d97706)]">
        主管已审{header.主管审核人 ? `(${header.主管审核人})` : ""}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/5 px-4 py-1.5 text-sm font-semibold text-[#5f6b7d]">
      未审核
    </span>
  );
}

// 打开弹窗/列表用的小状态徽章
function StatusPill({ h }: { h: PurchaseOrderHeader }) {
  if (h.审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
        已审核
      </span>
    );
  if (h.经理审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-info/40 bg-info/10 px-2.5 py-1 text-xs font-semibold text-info-foreground">
        经理已审
      </span>
    );
  if (h.主管审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#d97706]/40 bg-[#d97706]/10 px-2.5 py-1 text-xs font-semibold text-[var(--warning,#d97706)]">
        主管已审
      </span>
    );
  return (
    <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
      未审核
    </span>
  );
}

// ---------- 表头表单(新建态 / 未审核查看态可改) ----------

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

function HeaderForm({
  form,
  setForm,
  单号,
  操作员,
  onPickSupplier,
}: {
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  单号: string | null;
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
        <FormField label="日期">
          <Input type="date" className={inputCls} {...bind("日期")} />
        </FormField>
        <FormField label="交货日期">
          <Input type="date" className={inputCls} {...bind("交货日期")} />
        </FormField>
        <FormField label="收件人">
          <Input className={inputCls} {...bind("收件人")} />
        </FormField>
        <FormField label="仓库">
          <Input className={inputCls} {...bind("仓库")} />
        </FormField>
        <FormField label="PO号(合同号)">
          <div className="relative">
            <Input
              className={inputCls}
              aria-label="PO号(合同号)"
              placeholder="客户合同号,按生产单下单自动带出"
              {...bind("PO号")}
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">*</span>
          </div>
        </FormField>
        <FormField label="电脑单号">
          <Input className={inputCls} value={单号 ?? ""} disabled placeholder="保存后生成" />
        </FormField>
        <FormField label="操作员">
          <Input className={inputCls} value={操作员} disabled />
        </FormField>
      </div>
      <div className="mt-4">
        <FormField label="备注">
          <textarea
            className={cn(inputCls, "h-auto min-h-16 w-full rounded-md border px-3 py-2")}
            rows={2}
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
  sel,
  priceHidden,
  onToggle,
  onToggleAll,
  onPatch,
  onRemove,
  onAddLine,
}: {
  rows: EditRow[];
  sel: number[];
  priceHidden: boolean;
  onToggle: (key: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onPatch: (key: number, patch: Partial<EditRow>) => void;
  onRemove: (key: number) => void;
  onAddLine: () => void;
}) {
  const chosen = rows.filter((r) => sel.includes(r.key));
  const totalQty = chosen.reduce((s, r) => s + (Number(r.数量) || 0), 0);
  const totalAmt = chosen.reduce((s, r) => s + (Number(r.数量) || 0) * (Number(r.单价) || 0), 0);
  const thCls =
    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
  return (
    <div className="f-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
        <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={onAddLine}>
          <Plus className="h-4 w-4" />
          加行
        </button>
        <span className="text-sm text-[#5f6b7d]">
          已勾选 {sel.length} / {rows.length} 行,勾选的物料才会下单到当前供应商
        </span>
      </div>
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1500px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8">
              <th className={cn(thCls, "w-10 text-center")}>
                <input
                  type="checkbox"
                  aria-label="全选"
                  className="h-4 w-4 accent-[#16a34a]"
                  checked={rows.length > 0 && sel.length === rows.length}
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              </th>
              {[
                "序号",
                "生产单号",
                "款号",
                "物料编号",
                "物料名称",
                "规格",
                "材料",
                "颜色",
                "单位",
                "默认供应商",
                "可用库存",
                "数量",
                "已订数量",
                ...(priceHidden ? [] : ["单价", "金额"]),
                "备注",
                "操作",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    thCls,
                    (h === "可用库存" || h === "数量" || h === "已订数量" || h === "单价" || h === "金额") &&
                      "text-right",
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
                <td
                  colSpan={priceHidden ? 15 : 17}
                  className="px-4 py-6 text-center text-sm text-disabled"
                >
                  还没有明细行,点「加行」手选物料,或用「录入清单」「从补料单带入」
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.key} className="border-b border-black/6 last:border-0">
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`勾选 ${r.物料编号 || r.key}`}
                      className="h-4 w-4 accent-[#16a34a]"
                      checked={sel.includes(r.key)}
                      onChange={(e) => onToggle(r.key, e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2 text-disabled">{i + 1}</td>
                  <td className="px-3 py-2">
                    {r.锁定生产单号 ? (
                      <span title={LOCK_TOOLTIP} className="block">
                        <Input
                          className={cn(inputCls, "h-9 w-28")}
                          aria-label="生产单号"
                          value={r.生产单号 ?? ""}
                          disabled
                        />
                      </span>
                    ) : (
                      <Input
                        className={cn(inputCls, "h-9 w-28")}
                        aria-label="生产单号"
                        placeholder="可空,只进库存"
                        value={r.生产单号 ?? ""}
                        onChange={(e) => onPatch(r.key, { 生产单号: e.target.value })}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className={cn(inputCls, "h-9 w-24")}
                      aria-label="款号"
                      value={r.款号 ?? ""}
                      onChange={(e) => onPatch(r.key, { 款号: e.target.value })}
                    />
                  </td>
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">
                    {r.物料编号}
                  </td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                  <td className="px-3 py-2">
                    <Input
                      className={cn(inputCls, "h-9 w-20")}
                      aria-label="材料"
                      value={r.材料 ?? ""}
                      onChange={(e) => onPatch(r.key, { 材料: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色 ?? ""}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">
                    {r.供应商名称 ? (
                      <span title={`${r.供应商编号 ?? ""} ${r.供应商名称}`.trim()}>
                        {r.供应商名称}
                      </span>
                    ) : (
                      <span className="text-disabled">未指定</span>
                    )}
                  </td>
                  <td className="f-mono px-3 py-2 text-right">
                    {r.可用库存 == null ? (
                      <span className="text-disabled">-</span>
                    ) : r.需订数量 != null && Number(r.可用库存) >= Number(r.需订数量) ? (
                      <span
                        title="实时库存已够需求,默认不勾选下单"
                        className="font-semibold text-[#15803d]"
                      >
                        {r.可用库存}
                      </span>
                    ) : (
                      <span>{r.可用库存}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {Number(r.采购损耗率) > 0 && (
                        <span
                          title={`采购损耗率 ${r.采购损耗率}%:默认数量=需订×(1+损耗率),可手改`}
                          className="shrink-0 rounded-full bg-[#d97706]/10 px-1.5 py-0.5 text-xs font-medium text-[#d97706]"
                        >
                          损{r.采购损耗率}%
                        </span>
                      )}
                      <Input
                        type="number"
                        min={0}
                        aria-label="数量"
                        className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                        value={r.数量}
                        onChange={(e) => onPatch(r.key, { 数量: e.target.value })}
                      />
                    </div>
                  </td>
                  <td className="f-mono px-3 py-2 text-right whitespace-nowrap">
                    {Number(r.已订数量) > 0 ? (
                      <span
                        title="该工作单已下过此物料,重复下单会重复采购"
                        className="inline-flex rounded-full border border-[#d97706]/40 bg-[#d97706]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--warning,#d97706)]"
                      >
                        已下单 {r.已订数量}
                      </span>
                    ) : (
                      <span className="text-disabled">-</span>
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
                  <td className="px-3 py-2">
                    <Input
                      className={cn(inputCls, "h-9 w-28")}
                      aria-label="行备注"
                      value={r.备注 ?? ""}
                      onChange={(e) => onPatch(r.key, { 备注: e.target.value })}
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
        数量合计:<span className="f-mono">{totalQty}</span>
        {!priceHidden && (
          <span className="ml-6">
            金额合计:<span className="f-mono">{totalAmt}</span>
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
  lines: PurchaseOrderLine[];
  priceHidden: boolean;
}) {
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));
  return (
    <div className="f-panel overflow-hidden">
      <div className="max-h-[46vh] overflow-auto">
        <table data-freeze className="w-full min-w-[1100px] text-[15px]">
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
                ...(priceHidden ? [] : ["单价", "金额"]),
                "备注",
              ].map((h) => (
                <th
                  key={h}
                  className={cn(
                    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 text-left font-medium whitespace-nowrap normal-case",
                    (h === "数量" || h === "单价" || h === "金额") && "text-right",
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
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#3d4a5c]">
                  {txt(l.生产单号)}
                </td>
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(l.款号)}</td>
                <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">
                  {txt(l.物料编号)}
                </td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.材料)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
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

const openCol = createColumnHelper<PurchaseOrderHeader>();

function useOpenColumns(priceHidden: boolean) {
  return useMemo<ColumnDef<PurchaseOrderHeader, any>[]>(
    () => [
      openCol.accessor("单号", {
        header: "单号",
        size: 19,
        cell: (c) => txt(c.getValue()),
        meta: {
          tdClass: "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]",
        },
      }),
      openCol.accessor("日期", {
        header: "日期",
        size: 12,
        cell: (c) => fmtDate(c.getValue()),
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      openCol.accessor("供应商名称", {
        header: "供应商名称",
        size: 25,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      openCol.accessor("生产单号", {
        header: "生产单号",
        size: 16,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "f-mono truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      openCol.accessor("数量", {
        header: "数量",
        size: 8,
        cell: (c) => fmtNum(c.getValue(), 0),
        meta: {
          align: "right",
          tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]",
        },
      }),
      openCol.accessor("金额", {
        header: "金额",
        size: 9,
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
        cell: (c) => <StatusPill h={c.row.original} />,
        meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
      }),
    ],
    [priceHidden],
  );
}

// ---------- 页面 ----------

export default function PurchaseOrderPage() {
  const qc = useQueryClient();
  const { can } = usePerms();
  const priceHidden = !can(MENU, "单价");
  const currentUser = getUser() || "用户";
  const moneyText = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // 弹窗开关
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierKw, setSupplierKw] = useState("");
  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialKw, setMaterialKw] = useState("");
  // 「只查有库存」复选 + 服务端分页 50/页(对照老系统 MaterialPicker;关闭时重置,避免重开闪现旧条件)
  const [materialPage, setMaterialPage] = useState(1);
  const [materialOnlyStock, setMaterialOnlyStock] = useState(false);
  const [replOpen, setReplOpen] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);
  const [basisMo, setBasisMo] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dupRows, setDupRows] = useState<EditRow[] | null>(null);

  // 「从补料单带入」:本次已带入的补料单号(保存成功后逐个标记已采购)
  const [replMarked, setReplMarked] = useState<string[]>([]);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 生产单 basis 带入的完整行池(含各供应商);切换供应商时从池里重算可见行
  const [basisPool, setBasisPool] = useState<EditRow[]>([]);

  // 首次进入自动打开最新一单(查看态)。渲染期按引用比对调整(规避 effect 内同步 setState):
  // firstQuery.data 新引用到达且尚未开单时执行一次
  const firstQuery = useQuery({
    queryKey: ["po-first"],
    queryFn: () => purchaseOrderApi.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  // URL 参数:?单号= 直开指定单(订购单查询/采购订单进度表 双击跳入;对照 AssemblyPurchasePage 同款),
  // ?basis= 新建态自动按生产单追加待采购物料(采购物料分析「下采购订单」跳入,对照老系统 PurchaseOrderDrawer 新建模式预填),
  // 可带 &供应商编号=&供应商名称=(分析页按供应商分组跳入,只带该供应商+未绑定的物料),
  // 消费后清掉(keep-alive 下再次带参导航仍可生效)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const basisMoParam = searchParams.get("basis");
    if (basisMoParam) {
      const suppCode = searchParams.get("供应商编号");
      const suppName = searchParams.get("供应商名称");
      // 分析页勾选行随「行」参数带入(生产BOM物料清单.ID 逗号串)
      const idsRaw = searchParams.get("行");
      const ids = idsRaw
        ? new Set(idsRaw.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0))
        : undefined;
      setSearchParams({}, { replace: true });
      reset();
      void appendBasis(
        basisMoParam,
        suppCode ? { 供应商编号: suppCode, 供应商名称: suppName ?? "" } : undefined,
        ids,
      );
      return;
    }
    const no = searchParams.get("单号");
    if (!no) return;
    setSearchParams({}, { replace: true });
    setMode("view");
    set单号(no);
    void qc.invalidateQueries({ queryKey: ["po-detail", no] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  const detailQuery = useQuery({
    queryKey: ["po-detail", 单号],
    queryFn: () => purchaseOrderApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["po-list", page, keyword],
    queryFn: () => purchaseOrderApi.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const suppliersQuery = useQuery({
    queryKey: ["po-suppliers", supplierKw],
    queryFn: () => suppliersApi.list(1, 500, supplierKw),
    placeholderData: keepPreviousData,
    enabled: supplierOpen,
  });

  const materialsQuery = useQuery({
    queryKey: ["po-materials", materialKw, materialPage, materialOnlyStock],
    queryFn: () =>
      materialMasterApi.list(
        undefined,
        materialKw || undefined,
        materialPage,
        50,
        materialOnlyStock || undefined,
      ),
    placeholderData: keepPreviousData,
    enabled: materialOpen,
  });
  const materialTotalPages = materialsQuery.data
    ? Math.max(1, Math.ceil(materialsQuery.data.total / 50))
    : 1;

  // 待采购补料单:已审核且未采购,按 来料仓 过滤
  const replQuery = useQuery({
    queryKey: ["po-repl"],
    queryFn: () => replenishmentApi.list(1, 100, "", undefined, "来料仓", true),
    enabled: replOpen,
  });

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = audited(header);
  // 编辑态 = 新建 或 未审核的查看单(回填后可改);已审核 = 只读查看态
  const editing = mode === "new" || (isView && !isAudited);
  const openColumns = useOpenColumns(priceHidden);

  // 查看态(未审核):把后端单据水合到表单/明细(渲染期按引用比对,新数据到达时执行一次)
  const [hydrated, setHydrated] = useState<typeof detail>(undefined);
  if (mode === "view" && detail?.单头 && detail !== hydrated) {
    const h = detail.单头;
    setHydrated(detail);
    if (h.审核 !== "1") {
      setFormState({
        供应商编号: h.供应商编号 ?? "",
        供应商名称: h.供应商名称 ?? "",
        日期: date10(h.日期) || new Date().toISOString().slice(0, 10),
        交货日期: date10(h.交货日期),
        PO号: h.PO号 ?? "",
        收件人: h.收件人 ?? "",
        仓库: h.仓库 ?? "",
        备注: h.备注 ?? "",
      });
      const rs = detail.明细.map(lineToRow);
      setRows(rs);
      setSel(rs.map((r) => r.key));
    }
  }

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));
  const patchRow = (key: number, patch: Partial<EditRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // ---------- 新建 ----------
  const reset = () => {
    setMode("new");
    set单号(null);
    setHydrated(undefined);
    setBasisPool([]);
    // 默认供应商记忆:上次选过的供应商直接带出(可再改)
    const last = readLastSupplier();
    setFormState({
      ...emptyHeader(),
      供应商编号: last?.供应商编号 ?? "",
      供应商名称: last?.供应商名称 ?? "",
    });
    setRows([]);
    setSel([]);
    setReplMarked([]);
  };

  // ---------- 明细勾选 ----------
  const toggleRow = (key: number, checked: boolean) =>
    setSel((prev) => (checked ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)));
  const toggleAll = (checked: boolean) => setSel(checked ? rows.map((r) => r.key) : []);
  const removeRow = (key: number) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setSel((prev) => prev.filter((k) => k !== key));
  };

  // 选择供应商:记入默认供应商记忆(下次新建带出);
  // 有 basis 行池时重算明细——只留 本供应商+未绑定供应商 的行,其他供应商的行移出(重选可从池里回来);
  // 无行池时退回旧行为:自动勾选 本供应商/未指定 的行(已下单/库存已够的不勾)。
  const onPickSupplier = (s: SupplierRow) => {
    const code = s.供应商编号 ?? "";
    const name = s.供应商名称 ?? "";
    setForm({ 供应商编号: code, 供应商名称: name });
    if (code)
      localStorage.setItem(LAST_SUPPLIER_KEY, JSON.stringify({ 供应商编号: code, 供应商名称: name }));
    if (basisPool.length > 0) {
      const manual = rows.filter((r) => !r.fromBasis);
      const visible = code
        ? basisPool.filter((r) => !r.供应商编号 || r.供应商编号 === code)
        : basisPool;
      setRows([...manual, ...visible]);
      setSel([...manual.map((r) => r.key), ...visible.filter(shouldDefaultSelect).map((r) => r.key)]);
      const hidden = basisPool.length - visible.length;
      if (code && hidden > 0)
        setToast({ text: `已按供应商 ${name || code} 过滤:${hidden} 行其他供应商的物料未带入`, tone: "ok" });
    } else if (code) {
      setSel(
        rows
          .filter((r) => shouldDefaultSelect(r) && (!r.供应商编号 || r.供应商编号 === code))
          .map((r) => r.key),
      );
    }
    setSupplierOpen(false);
  };

  // 选料追加一行(材料从物料资料.备注解析;无价格权限不带单价)
  const onPickMaterial = (m: MasterMaterialRow) => {
    const row: EditRow = {
      key: uid(),
      物料编号: m.物料编号 ?? "",
      物料名称: m.物料名称 ?? "",
      物料类别: m.物料类别,
      规格: m.规格,
      材料: parse材料(m.备注),
      颜色: m.颜色,
      单位: m.单位,
      数量: "",
      单价: priceHidden || m.单价 == null ? "" : String(m.单价),
    };
    setRows((rs) => [...rs, row]);
    setSel((prev) => [...prev, row.key]);
    setMaterialOpen(false);
  };

  // 录入清单:按生产单号把待采购物料追加进网格(供应商/PO号为空时顺带带出);
  // moArg 传入时跳过输入框取值(?basis= 深链自动追加用,采购物料分析「下采购订单」跳入);
  // suppArg=分析页按供应商分组跳入时指定供应商(优先级最高);
  // idsArg=分析页勾选行(生产BOM物料清单.ID 集合):带了这个就只勾这些行,不再按默认规则。
  // 供应商落定后:只带出 该供应商+未绑定供应商 的行,其他供应商的行不入网格(一单只下一个供应商)。
  const appendBasis = async (
    moArg?: string,
    suppArg?: { 供应商编号: string; 供应商名称?: string },
    idsArg?: Set<number>,
  ) => {
    const mo = (moArg ?? basisMo).trim();
    if (!mo) {
      setToast({ text: "请输入生产单号", tone: "err" });
      return;
    }
    try {
      const basis = await purchaseOrderApi.basis(mo);
      if (basis.length === 0) {
        setToast({ text: "该生产单号没有待采购物料", tone: "err" });
        return;
      }
      const rs = basis.map((b) => basisToRow(b, mo));
      const pool = [...basisPool, ...rs];
      setBasisPool(pool);
      // 供应商落定:URL/分析页指定 > 表头已选(含记忆默认) > 首个已绑定默认供应商的行
      const settleCode =
        suppArg?.供应商编号 || form.供应商编号 || rs.find((r) => r.供应商编号)?.供应商编号 || "";
      const settleName =
        suppArg?.供应商名称 ??
        (settleCode === form.供应商编号
          ? form.供应商名称
          : (rs.find((r) => r.供应商编号 === settleCode)?.供应商名称 ?? ""));
      const visible = settleCode
        ? pool.filter((r) => !r.供应商编号 || r.供应商编号 === settleCode)
        : pool;
      const manual = rows.filter((r) => !r.fromBasis);
      setRows([...manual, ...visible]);
      // 分析页带「行」参数:只勾这些行;否则默认规则(已下单/库存已够的行不勾,防重复下单/多余采购)
      const picked = idsArg
        ? visible.filter((r) => r.basisId != null && idsArg.has(r.basisId))
        : visible.filter(shouldDefaultSelect);
      setSel([...manual.map((r) => r.key), ...picked.map((r) => r.key)]);
      setFormState((h) => ({
        ...h,
        供应商编号: settleCode || h.供应商编号,
        供应商名称: settleName || h.供应商名称,
        PO号: h.PO号 || basis[0]?.合同号 || "",
      }));
      const hidden = pool.length - visible.length;
      if (settleCode && hidden > 0)
        setToast({
          text: `已按供应商 ${settleName || settleCode} 带入 ${visible.length} 行;${hidden} 行其他供应商的物料未带入(换供应商下单请改选供应商)`,
          tone: "ok",
        });
      setBasisOpen(false);
      setBasisMo("");
    } catch (e) {
      setToast({ text: errMsg(e) || "加载采购物料分析失败", tone: "err" });
    }
  };

  // 从补料单带入:补料明细行追加进网格并默认勾选(数量=补料数量),保存成功后标记该补料单已采购
  const bringReplenishment = (d: ReplenishmentDetail) => {
    const rs: EditRow[] = replenishPurchaseLines(d).map((l) => ({
      key: uid(),
      生产单号: l.生产单号,
      锁定生产单号: l.锁定生产单号,
      款号: l.款号,
      物料编号: l.物料编号,
      物料名称: l.物料名称 ?? "",
      规格: l.规格,
      颜色: l.颜色,
      单位: l.单位,
      数量: String(l.数量),
      单价: "",
    }));
    if (rs.length === 0) {
      setToast({ text: "该补料单没有可带入的物料行", tone: "err" });
      return;
    }
    setRows((prev) => [...prev, ...rs]);
    setSel((prev) => [...prev, ...rs.map((r) => r.key)]);
    if (d.单头?.单号) setReplMarked((prev) => [...new Set([...prev, d.单头!.单号!])]);
    setToast({ text: `已从补料单 ${d.单头?.单号 ?? ""} 带入 ${rs.length} 行`, tone: "ok" });
    setReplOpen(false);
  };

  const pickReplenishment = async (no?: string) => {
    if (!no) return;
    try {
      bringReplenishment(await replenishmentApi.get(no));
    } catch (e) {
      setToast({ text: errMsg(e) || "打开补料单失败", tone: "err" });
    }
  };

  // ---------- 保存(新建 POST / 未审核修改 PUT;只有勾选的行才进采购订单) ----------
  const buildBody = (): PurchaseOrderCreate | null => {
    if (!form.供应商编号.trim()) {
      setToast({ text: "请选择供应商", tone: "err" });
      return null;
    }
    if (!form.PO号.trim()) {
      setToast({
        text: "请填写 PO号(合同号):按生产单下单会自动带出,自由开单需手填",
        tone: "err",
      });
      return null;
    }
    const chosen = rows.filter((r) => sel.includes(r.key));
    if (chosen.length === 0) {
      setToast({ text: "请勾选要下单的物料行", tone: "err" });
      return null;
    }
    // 单供应商兜底:勾选行里有绑定其他默认供应商的物料时拦截(正常已被过滤不带入,手改供应商后可能撞上)
    const badRow = chosen.find(
      (r) => r.供应商编号 && r.供应商编号 !== form.供应商编号.trim(),
    );
    if (badRow) {
      setToast({
        text: `物料 ${badRow.物料编号} 的默认供应商是 ${badRow.供应商名称 || badRow.供应商编号}，一张采购订单只能下一个供应商的物料`,
        tone: "err",
      });
      return null;
    }
    const lines: PurchaseOrderCreateLine[] = chosen
      .filter((r) => r.物料编号 && Number(r.数量) > 0)
      .map((r) => ({
        物料编号: r.物料编号,
        物料名称: r.物料名称 || undefined,
        物料类别: r.物料类别 || undefined,
        规格: r.规格 || undefined,
        颜色: r.颜色 || undefined,
        单位: r.单位 || undefined,
        数量: Number(r.数量),
        单价: r.单价.trim() !== "" ? Number(r.单价) : undefined,
        预算数量: r.需订数量 != null ? Number(r.需订数量) : undefined,
        材料: r.材料?.trim() || undefined,
        生产单号: r.生产单号?.trim() || undefined,
        款号: r.款号?.trim() || undefined,
        备注: r.备注?.trim() || undefined,
      }));
    if (lines.length === 0) {
      setToast({ text: "请至少录入一行数量>0的明细", tone: "err" });
      return null;
    }
    // 单头生产单号兜底:未指定时,若所有明细行同属一个生产单号则带出
    const lineMos = [...new Set(lines.map((l) => l.生产单号).filter((x): x is string => !!x))];
    return {
      生产单号:
        detail?.单头?.生产单号 ?? (lineMos.length === 1 ? lineMos[0] : undefined),
      供应商编号: form.供应商编号.trim(),
      供应商名称: form.供应商名称.trim() || undefined,
      日期: form.日期 || undefined,
      交货日期: form.交货日期 || undefined,
      PO号: form.PO号.trim() || undefined,
      收件人: form.收件人.trim() || undefined,
      仓库: form.仓库.trim() || undefined,
      备注: form.备注.trim() || undefined,
      明细: lines,
    };
  };

  const doSave = async () => {
    const body = buildBody();
    if (!body) return;
    setSaving(true);
    try {
      if (单号) {
        await purchaseOrderApi.update(单号, body);
        setToast({ text: `采购订单已保存:${单号}`, tone: "ok" });
        await detailQuery.refetch();
      } else {
        const r = await purchaseOrderApi.create(body);
        setToast({ text: `采购订单已创建:${r.单号}`, tone: "ok" });
        setMode("view");
        set单号(r.单号);
        void qc.invalidateQueries({ queryKey: ["po-first"] });
        void qc.invalidateQueries({ queryKey: ["po-list"] });
      }
      // 服务端已把下单物料中未绑定的默认供应商回填成本单供应商(物料资料+BOM快照):
      // 本地行/行池同步显示(按物料编号对齐,只补未绑定的),不用等重开
      const savedCodes = new Set(body.明细.map((l) => l.物料编号));
      const fillSupplier = (r: EditRow): EditRow =>
        !r.供应商编号 && savedCodes.has(r.物料编号)
          ? { ...r, 供应商编号: body.供应商编号, 供应商名称: body.供应商名称 }
          : r;
      setRows((prev) => prev.map(fillSupplier));
      setBasisPool((prev) => prev.map(fillSupplier));
      invalidateCrossPage(qc);
      // 带入过补料单:保存成功后标记已采购(静默失败只提示手动处理)
      for (const no of replMarked) {
        try {
          await replenishmentApi.markPurchased(no);
        } catch (e) {
          setToast({ text: errMsg(e) || `补料单 ${no} 标记「已采购」失败,请在补料单页手动核对`, tone: "err" });
        }
      }
      setReplMarked([]);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 保存入口:勾选中包含「已下单」物料时先弹确认,防重复下单;否则直接提交
  const save = () => {
    const ordered = rows.filter((r) => sel.includes(r.key) && Number(r.已订数量) > 0);
    if (ordered.length === 0) {
      void doSave();
      return;
    }
    setDupRows(ordered);
  };

  // ---------- 审核 / 反审核 / 删除 ----------
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      await fn();
      setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        void qc.invalidateQueries({ queryKey: ["po-first"] });
        void qc.invalidateQueries({ queryKey: ["po-list"] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // ---------- 打印:先登记打印次数,再取最新详情按「採購單」格式开新窗口打印 ----------
  const doPrint = async () => {
    if (!单号) return;
    try {
      await purchaseOrderApi.print(单号);
      const fresh = await purchaseOrderApi.get(单号);
      printPurchaseOrder(fresh, { hidePrice: priceHidden });
      await detailQuery.refetch();
    } catch (e) {
      setToast({ text: errMsg(e) || "打印失败", tone: "err" });
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
    ...(editing
      ? [
          {
            key: "save",
            label: mode === "new" ? "保存" : "保存修改",
            icon: FloppyDisk,
            perm: "保存" as const,
            primary: true,
            disabled: saving,
            onClick: save,
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
  const lineActions: DocAction[] = editing
    ? [
        {
          key: "basis",
          label: "录入清单",
          icon: ClipboardText,
          onClick: () => {
            setBasisMo("");
            setBasisOpen(true);
          },
        },
        {
          key: "repl",
          label: "从补料单带入",
          icon: Plus,
          onClick: () => setReplOpen(true),
        },
      ]
    : [];
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
              void act(() => purchaseOrderApi.supervisorApprove(单号!), "主管已审核", "reload"),
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
              void act(() => purchaseOrderApi.managerApprove(单号!), "经理已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && header?.经理审核 === "1"
      ? [
          {
            key: "audit",
            label: "审核(下发)",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => purchaseOrderApi.approve(单号!), "已审核", "reload"),
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
            onClick: () =>
              void act(() => purchaseOrderApi.unapprove(单号!), "已反审核", "reload"),
          },
        ]
      : []),
  ];
  const printActions: DocAction[] =
    isView && isAudited
      ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: () => void doPrint() }]
      : [];

  // ---------- 查看态单头卡字段(已审核只读;价格位按权限脱敏) ----------
  const mainFields: HeaderField[] = header
    ? [
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        { label: "供应商名称", value: txt(header.供应商名称), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "交货日期", value: fmtDate(header.交货日期), mono: true },
        { label: "PO号", value: txt(header.PO号), mono: true },
        { label: "生产单号", value: txt(header.生产单号), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "金额", value: String(moneyText(header.金额)), mono: true },
        { label: "收件人", value: txt(header.收件人), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "供应商编号", value: txt(header.供应商编号), mono: true },
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "主管审核人", value: txt(header.主管审核人), mono: true },
        { label: "经理审核人", value: txt(header.经理审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
        { label: "打印次数", value: String(header.打印次数 ?? 0), mono: true },
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

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          采购订单{isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : ""}
        </h1>
        {isView && <AuditBadge header={header} />}
        <div className="ml-auto">
          <FlowSteps steps={["开单", "主管审核", "经理审核", "审核下发"]} current={flowCurrent} />
        </div>
      </div>

      {/* 操作栏:编辑 / 明细带入 / 审核流转 / 打印 四组,组间分隔线 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <DocToolbar actions={editActions} menuKey={MENU} />
        {lineActions.length > 0 && (
          <>
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={lineActions} menuKey={MENU} />
          </>
        )}
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

      {/* 单头:新建/未审核 = 表单;已审核 = 只读单头卡 */}
      {mode === "new" ? (
        <HeaderForm
          form={form}
          setForm={setForm}
          单号={null}
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
          <DocError message="单据加载失败,请重试或重新打开" onRetry={() => detailQuery.refetch()} />
        </div>
      ) : !header ? (
        <div className="f-panel p-6">
          <DocEmpty
            icon={<FolderOpen className="h-5 w-5" />}
            title="尚未打开单据"
            description="点击上方「打开」选择一张采购订单,或点「新建」开一张新单"
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
      ) : isAudited ? (
        <DocHeaderCard fields={mainFields} extra={extraFields} />
      ) : (
        <HeaderForm
          form={form}
          setForm={setForm}
          单号={单号}
          操作员={txt(header.操作员)}
          onPickSupplier={() => setSupplierOpen(true)}
        />
      )}

      {/* 明细 */}
      {editing ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1a2330]">采购明细</h2>
            <span className="f-mono text-sm text-[#5f6b7d]">{rows.length} 行</span>
          </div>
          <LinesEditor
            rows={rows}
            sel={sel}
            priceHidden={priceHidden}
            onToggle={toggleRow}
            onToggleAll={toggleAll}
            onPatch={patchRow}
            onRemove={removeRow}
            onAddLine={() => setMaterialOpen(true)}
          />
        </div>
      ) : (
        header &&
        !detailQuery.isLoading &&
        !detailQuery.isError && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1a2330]">采购明细</h2>
              <span className="f-mono text-sm text-[#5f6b7d]">
                {detail?.明细.length ?? 0} 行
              </span>
            </div>
            {(detail?.明细.length ?? 0) === 0 ? (
              <div className="f-panel">
                <DocEmpty
                  icon={<Prohibit className="h-5 w-5" />}
                  title="暂无采购明细"
                  description="该单据还没有录入明细行"
                />
              </div>
            ) : (
              <LinesView lines={detail?.明细 ?? []} priceHidden={priceHidden} />
            )}
          </div>
        )
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开采购订单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 供应商 / 生产单号"
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
        description="按单号、供应商或生产单号搜索,点击一行打开"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="没有匹配的采购订单,换个关键字试试"
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
          <Input
            name="kw"
            className={inputCls}
            placeholder="编号/名称"
            aria-label="供应商搜索"
          />
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
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">
                  {s.供应商编号}
                </td>
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

      {/* 选择物料(加行;只查有库存 + 50/页分页,对照老系统 MaterialPicker) */}
      <PickerDialog
        open={materialOpen}
        onClose={() => {
          setMaterialOpen(false);
          setMaterialKw("");
          setMaterialPage(1);
          setMaterialOnlyStock(false);
        }}
        title="选择物料"
        width="sm:max-w-[860px]"
        footer={
          <>
            <span className="f-mono mr-auto text-sm text-[#5f6b7d]">
              共 {materialsQuery.data?.total ?? 0} 条,第 {materialPage} / {materialTotalPages} 页
            </span>
            <button
              type="button"
              className="f-btn h-10 px-3.5 text-sm"
              disabled={materialPage <= 1}
              onClick={() => setMaterialPage((p) => p - 1)}
            >
              <CaretLeft className="h-4 w-4" />
              上一页
            </button>
            <button
              type="button"
              className="f-btn h-10 px-3.5 text-sm"
              disabled={materialPage >= materialTotalPages}
              onClick={() => setMaterialPage((p) => p + 1)}
            >
              下一页
              <CaretRight className="h-4 w-4" />
            </button>
          </>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMaterialPage(1);
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
          {/* 复选框勿放 form 内:radix Checkbox 检出表单上下文会挂 BubbleInput(useSize 依赖 ResizeObserver) */}
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-[#3d4a5c]">
            <Checkbox
              className="h-5 w-5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
              checked={materialOnlyStock}
              onCheckedChange={(v) => {
                setMaterialOnlyStock(v === true);
                setMaterialPage(1);
              }}
            />
            只查有库存
          </label>
        </div>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["物料编号", "物料名称", "规格", "材料", "颜色", "单位", "库存", ...(priceHidden ? [] : ["单价"])].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(
                      pickerThCls,
                      (h === "库存" || h === "单价") && "text-right",
                    )}
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
                onClick={() => onPickMaterial(m)}
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

      {/* 从补料单带入(来料仓 · 已审核未采购) */}
      <PickerDialog
        open={replOpen}
        onClose={() => setReplOpen(false)}
        title="从补料单带入(来料仓 · 已审核未采购)"
        width="sm:max-w-[860px]"
      >
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["单号", "日期", "部门", "生产单号", "款号", "数量合计", "审核时间", ""].map((h) => (
                <th
                  key={h}
                  className={cn(pickerThCls, h === "数量合计" && "text-right")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(replQuery.data?.items ?? []).map((r: ReplenishmentHeader) => (
              <tr key={r.单号} className="h-11 border-b border-black/6 last:border-0">
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.单号}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                  {date10(r.日期)}
                </td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.部门 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.生产单号 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.款号 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.数量 ?? 0}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                  {r.审核时间 ? String(r.审核时间).slice(0, 16).replace("T", " ") : ""}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#15803d] hover:underline"
                    onClick={() => void pickReplenishment(r.单号)}
                  >
                    带入
                  </button>
                </td>
              </tr>
            ))}
            {replQuery.isSuccess && (replQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-sm text-disabled">
                  无待采购补料单
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-[#5f6b7d]">
          点「带入」把该补料单全部物料追加进采购明细(数量=补料数量);采购订单保存成功后该补料单自动标记「已采购」,不再出现在本列表
        </p>
      </PickerDialog>

      {/* 录入清单:按生产单号带待采购物料 */}
      <Dialog open={basisOpen} onOpenChange={setBasisOpen}>
        <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>录入清单</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              输入生产单号,带出待采购物料
            </DialogDescription>
          </DialogHeader>
          <Input
            className={inputCls}
            aria-label="生产单号"
            placeholder="输入生产单号,带出待采购物料"
            value={basisMo}
            onChange={(e) => setBasisMo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void appendBasis();
            }}
          />
          <DialogFooter>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setBasisOpen(false)}>
              取消
            </button>
            <button type="button" className="f-btn f-btn-cyan h-10 px-4" onClick={() => void appendBasis()}>
              追加
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该采购订单?"
        description={`${单号} 删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => purchaseOrderApi.remove(单号!), "已删除", "reset");
        }}
      />

      {/* 重复下单确认:勾选中包含已下单物料 */}
      <Dialog open={dupRows != null} onOpenChange={(v) => !v && setDupRows(null)}>
        <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>勾选项中包含已下单物料</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              以下物料在此工作单已下过单(再下单会重复采购),确认继续下单吗?
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-56 list-disc space-y-1 overflow-auto pl-6 text-[15px] text-[#3d4a5c]">
            {(dupRows ?? []).map((r) => (
              <li key={r.key}>
                {r.物料编号} {r.物料名称}(已订 {r.已订数量})
              </li>
            ))}
          </ul>
          <DialogFooter>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setDupRows(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              onClick={() => {
                setDupRows(null);
                void doSave();
              }}
            >
              仍要下单
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
