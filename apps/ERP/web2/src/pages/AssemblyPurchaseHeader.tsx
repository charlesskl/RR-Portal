// 装配加工采购单 展示件:审核徽章/状态徽章/单头表单(版式对齐 BOM物料设置页)。
// 页面逻辑在 AssemblyPurchasePage.tsx;三个明细网格在 AssemblyPurchaseTables.tsx。
// 通用选择弹窗骨架 PickerDialog/pickerThCls 已收敛到 components/doc/PickerDialog.tsx。
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";
import type { AssemblyPurchaseOrderHeaderRow, CustomerRow } from "@/api/types";

export const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

// ---------- 审核徽章(三级流转:未审核 -> 主管已审 -> 经理已审 -> 已审核(已下发)) ----------

// 审核徽章/流转所需的单头最小字段(列表行与详情单头共用)
export type AuditHeader = {
  审核?: string;
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
};

export function AuditBadge({ header }: { header?: AuditHeader | null }) {
  if (header?.审核 === "1")
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

export function StatusPill({ h }: { h: AssemblyPurchaseOrderHeaderRow }) {
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

// ---------- 单头表单(版式对齐 BOM物料设置:f-panel p-5 + f-label + f-input-slim + 审核状态胶囊) ----------

import type { HeaderFormState } from "@/lib/assemblyPurchase";

export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// 审核状态小胶囊(BOM 单头卡同款):未审核灰/主管已审琥珀/经理已审蓝/已审核绿
export function AuditStatePill({ audit }: { audit?: AuditHeader | null }) {
  if (audit?.审核 === "1")
    return (
      <span className="rounded-full bg-[#059669]/10 px-3 py-1 text-sm font-medium text-[#059669]">
        已审核
      </span>
    );
  if (audit?.经理审核 === "1")
    return (
      <span className="rounded-full bg-info/10 px-3 py-1 text-sm font-medium text-info-foreground">
        经理已审{audit.经理审核人 ? `(${audit.经理审核人})` : ""}
      </span>
    );
  if (audit?.主管审核 === "1")
    return (
      <span className="rounded-full bg-[#d97706]/10 px-3 py-1 text-sm font-medium text-[#d97706]">
        主管已审{audit.主管审核人 ? `(${audit.主管审核人})` : ""}
      </span>
    );
  return (
    <span className="rounded-full bg-black/6 px-3 py-1 text-sm font-medium text-[#5f6b7d]">
      未审核
    </span>
  );
}

// BOM 同款瘦身输入框(36px)
const slimCls = "f-input f-input-slim w-full";

export function HeaderForm({
  form,
  setForm,
  单号,
  操作员,
  customers,
  onCustomer,
  onPickPartner,
  onFillLastNo,
  readOnly = false,
  audit = null,
}: {
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  单号: string | null;
  操作员: string;
  customers: CustomerRow[];
  onCustomer: (v: string) => void;
  onPickPartner: () => void;
  onFillLastNo: () => void;
  // readOnly=已审核只读查看(BOM 同款:表单不换成卡片,全字段禁改)
  readOnly?: boolean;
  // 审核链状态(未审核/主管已审/经理已审/已审核),null=新建未开单
  audit?: AuditHeader | null;
}) {
  const bind = (k: keyof HeaderFormState) => ({
    value: form[k],
    disabled: readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ [k]: e.target.value }),
  });
  return (
    <div className="f-panel p-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="供应商/加工厂">
          <div className="flex gap-2">
            <input
              className={slimCls}
              readOnly
              placeholder="编号 / 名称"
              aria-label="供应商"
              value={[form.供应商编号, form.供应商名称].filter(Boolean).join(" ")}
            />
            {!readOnly && (
              <button
                type="button"
                className="f-btn h-9 shrink-0 px-3.5 text-sm"
                onClick={onPickPartner}
              >
                选择
              </button>
            )}
          </div>
        </FormField>
        <FormField label="出单日期">
          <input type="date" className={slimCls} aria-label="出单日期" {...bind("出单日期")} />
        </FormField>
        <FormField label="收货仓库">
          <SearchSelect
            ariaLabel="收货仓库"
            value={form.收货仓库}
            options={["半成品仓", "成品仓"].map((v) => ({ value: v, label: v }))}
            disabled={readOnly}
            onChange={(v) => setForm({ 收货仓库: v })}
          />
        </FormField>
        <FormField label="电脑单号">
          <div className="flex gap-2">
            <input
              className={slimCls}
              aria-label="电脑单号"
              value={单号 ?? form.电脑单号}
              onChange={(e) => setForm({ 电脑单号: e.target.value })}
              disabled={单号 != null || readOnly}
              placeholder="保存后生成"
            />
            {!readOnly && (
              <button
                type="button"
                className="f-btn h-9 shrink-0 px-3.5 text-sm"
                onClick={onFillLastNo}
              >
                最后号码
              </button>
            )}
          </div>
        </FormField>
        <FormField label="客户">
          <input
            className={slimCls}
            aria-label="客户"
            placeholder="编号/名称"
            list="asm-header-cust"
            value={form.客户编号}
            disabled={readOnly}
            onChange={(e) => onCustomer(e.target.value)}
          />
          <datalist id="asm-header-cust">
            {customers
              .filter((c) => c.客户编号)
              .map((c) => (
                <option key={c.客户编号} value={c.客户编号}>
                  {c.客户编号} {c.客户名称 ?? ""}
                </option>
              ))}
          </datalist>
        </FormField>
        <FormField label="收货人">
          <input className={slimCls} aria-label="收货人" {...bind("收货人")} />
        </FormField>
        <FormField label="开始交货日期">
          <input
            type="date"
            className={slimCls}
            aria-label="开始交货日期"
            {...bind("开始交货日期")}
          />
        </FormField>
        <FormField label="每天交货">
          <input
            type="number"
            min={0}
            className={cn(slimCls, "f-mono text-right")}
            aria-label="每天交货"
            {...bind("每天交货")}
          />
        </FormField>
        <FormField label="完成日期">
          <input type="date" className={slimCls} aria-label="完成日期" {...bind("完成日期")} />
        </FormField>
        <FormField label="操作员">
          <input className={slimCls} aria-label="操作员" value={操作员} disabled />
        </FormField>
        {/* 审核状态 + 备注 收尾行(BOM 同款排布) */}
        <div>
          <span className="f-label">审核状态</span>
          <div className="mt-2.5">
            <AuditStatePill audit={audit} />
          </div>
        </div>
        <label className="col-span-2 block min-w-0 md:col-span-3">
          <span className="f-label">备注</span>
          <input
            aria-label="备注"
            className="f-input f-input-slim mt-1.5 w-full"
            value={form.备注}
            disabled={readOnly}
            onChange={(e) => setForm({ 备注: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

