// 排期行手工新增/编辑弹窗(客户排期表 CRUD;字段与后端 ScheduleRowSaveRequest 一致):
// 排期客户/状态必填,其余可空;日期/数字分列;排期客户带既有客户 datalist 快选。
import { useState } from "react";
import type { ScheduleRow, ScheduleRowSave } from "@/api/types";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";

const 状态列表 = ["在排", "已走货", "已取消"] as const;

type TextField = { name: keyof ScheduleRowSave; label: string; max?: number; required?: boolean };
const TEXT_FIELDS: TextField[] = [
  { name: "排期客户", label: "排期客户", max: 60, required: true },
  { name: "货号", label: "货号", max: 60 },
  { name: "品名", label: "品名", max: 100 },
  { name: "PO号", label: "PO号", max: 60 },
  { name: "客PO", label: "客PO", max: 60 },
  { name: "SKU", label: "SKU", max: 60 },
  { name: "客户名称", label: "客户名称", max: 60 },
  { name: "国家", label: "国家", max: 40 },
  { name: "车间", label: "车间", max: 20 },
  { name: "第三方验货", label: "第三方验货", max: 10 },
];
const NUM_FIELDS: TextField[] = [
  { name: "数量", label: "数量" },
  { name: "内箱", label: "内箱" },
  { name: "外箱", label: "外箱" },
  { name: "总箱数", label: "总箱数" },
];
const DATE_FIELDS: TextField[] = [
  { name: "接单日期", label: "接单日期" },
  { name: "走货期", label: "走货期" },
  { name: "验货期", label: "验货期" },
];

type FormState = Record<string, string>;

function toForm(row: ScheduleRow | null): FormState {
  if (!row) return { 状态: "在排" };
  const v: FormState = {};
  for (const f of [...TEXT_FIELDS, ...NUM_FIELDS]) {
    const val = row[f.name as keyof ScheduleRow];
    v[f.name] = val == null ? "" : String(val);
  }
  for (const f of DATE_FIELDS) {
    const val = row[f.name as keyof ScheduleRow];
    v[f.name] = typeof val === "string" ? val.slice(0, 10) : "";
  }
  v.状态 = row.状态 ?? "在排";
  v.备注 = row.备注 ?? "";
  return v;
}

function toBody(form: FormState): ScheduleRowSave {
  const body: ScheduleRowSave = {};
  const put = (k: keyof ScheduleRowSave, s: string | undefined) => {
    const t = (s ?? "").trim();
    if (t) (body as Record<string, unknown>)[k] = t;
  };
  for (const f of TEXT_FIELDS) put(f.name, form[f.name]);
  for (const f of DATE_FIELDS) put(f.name, form[f.name]);
  put("状态", form.状态);
  put("备注", form.备注);
  for (const f of NUM_FIELDS) {
    const t = (form[f.name] ?? "").trim();
    if (t) (body as Record<string, unknown>)[f.name] = Number(t);
  }
  return body;
}

export default function ScheduleRowEditDialog({
  open,
  row,
  customers,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  row: ScheduleRow | null; // null=新增
  customers: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: ScheduleRowSave) => void;
}) {
  // 父组件按 key 重挂载(open+行变化即重置),表单初值直接取首渲染的 row,无需 effect
  const [form, setForm] = useState<FormState>(() => toForm(row));
  const [err, setErr] = useState("");

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (!(form.排期客户 ?? "").trim()) {
      setErr("排期客户不能为空");
      return;
    }
    onSave(toBody(form));
  };

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title={row ? `编辑排期行 [${row.货号 || row.PO号 || row.ID}]` : "新增排期行"}
      width="sm:max-w-[760px]"
      footer={
        <>
          {err && <span className="mr-auto text-sm text-[#dc2626]">{err}</span>}
          <button type="button" className="f-btn h-10 px-4" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-4"
            disabled={saving}
            onClick={submit}
          >
            确定
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        {TEXT_FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="f-label">
              {f.label}
              {f.required && <span className="ml-0.5 text-[#dc2626]">*</span>}
            </span>
            <input
              aria-label={f.label}
              className="f-input f-input-slim mt-1.5"
              maxLength={f.max}
              list={f.name === "排期客户" ? "sch-cust-list" : undefined}
              value={form[f.name] ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            />
          </label>
        ))}
        <label className="block">
          <span className="f-label">
            状态<span className="ml-0.5 text-[#dc2626]">*</span>
          </span>
          <SearchSelect
            ariaLabel="状态"
            className="mt-1.5"
            value={form.状态 ?? "在排"}
            options={状态列表.map((s) => ({ value: s, label: s }))}
            onChange={(v) => set("状态", v)}
          />
        </label>
        {NUM_FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="f-label">{f.label}</span>
            <input
              aria-label={f.label}
              type="number"
              min={0}
              className="f-input f-input-slim mt-1.5"
              value={form[f.name] ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            />
          </label>
        ))}
        {DATE_FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="f-label">{f.label}</span>
            <input
              aria-label={f.label}
              type="date"
              className="f-input f-input-slim mt-1.5"
              value={form[f.name] ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            />
          </label>
        ))}
        <label className="col-span-2 block sm:col-span-3">
          <span className="f-label">备注</span>
          <input
            aria-label="备注"
            className="f-input f-input-slim mt-1.5"
            maxLength={400}
            value={form.备注 ?? ""}
            onChange={(e) => set("备注", e.target.value)}
          />
        </label>
      </div>
      <datalist id="sch-cust-list">
        {customers.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </PickerDialog>
  );
}
