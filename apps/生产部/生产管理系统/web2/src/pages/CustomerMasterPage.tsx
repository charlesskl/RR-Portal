// 客户资料(/master/客户资料;业务部;老系统 web/src/pages/master/MasterDataPage.tsx + configs.ts 的「客户资料」配置重写):
// 通用主数据维护:搜索/分页(10/页)/新增/编辑/删除 + 双击行选中;类别列徽章展示(对照老系统 Tag);
// 编号/手机类列等宽字体(对照老系统 erp-num)。数据源 /master/customers(masterDataApi)。
// 权限菜单=客户资料(MenuCatalog.cs:10 实证:基础资料组;老系统仅用其做价格脱敏,本页无价格字段)。
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Prohibit, Trash } from "@phosphor-icons/react";
import { masterDataApi } from "@/api/endpoints";
import type { MasterRow } from "@/api/types";
import { ApiError } from "@/lib/api";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { cn } from "@/lib/utils";

const MENU = "客户资料"; // MenuCatalog 实证:基础资料组「客户资料」
const PAGE_SIZE = 10;
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// 字段配置照抄老系统 MASTER_CONFIGS.客户资料
const FIELDS: { name: string; label: string; required?: boolean; max?: number }[] = [
  { name: "客户编号", label: "客户编号", required: true, max: 20 },
  { name: "客户名称", label: "客户名称", required: true, max: 50 },
  { name: "客户类别", label: "类别", max: 10 },
  { name: "联系人", label: "联系人", max: 20 },
  { name: "手机", label: "手机", max: 30 },
  { name: "电话", label: "电话", max: 30 },
  { name: "付款方式", label: "付款方式", max: 20 },
  { name: "备注", label: "备注" },
];

const customersCrud = masterDataApi("customers");
const monoRe = /编号|号|价|手机/;
const tagRe = /类别|类型/;
const rowId = (r: MasterRow) => Number(r.ID ?? r.id ?? 0);

export default function CustomerMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");

  const [rows, setRows] = useState<MasterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [selRow, setSelRow] = useState<MasterRow | null>(null);
  const [editing, setEditing] = useState<MasterRow | null>(null); // null=关;id/ID=0 或空=新增
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const r = await customersCrud.list(page, PAGE_SIZE, keyword);
      setRows(r.items);
      setTotal(r.total);
      setSelRow(null);
    } catch (e) {
      setToast({ text: errMsg(e, "加载客户资料失败"), tone: "err" });
    }
  }, [page, keyword]);

  useEffect(() => {
    if (!canOpen) return;
    // 微任务里拉取:setState 不在 effect 同步路径(页面加载/翻页/搜索即查)
    void Promise.resolve().then(() => load());
  }, [canOpen, load]);

  // 选中行展示/删除提示用的主键字段:编号 > 名称 > id(对照老系统 rowLabel)
  const rowLabel = (r: MasterRow | null) =>
    r ? String(r.客户编号 ?? r.客户名称 ?? rowId(r)) : "";

  const openCreate = () => {
    setEditing({ id: 0 });
    setForm({});
  };
  const openEdit = (row: MasterRow) => {
    setEditing(row);
    const v: Record<string, string> = {};
    for (const f of FIELDS) v[f.name] = row[f.name] == null ? "" : String(row[f.name]);
    setForm(v);
  };

  const onSave = async () => {
    if (!editing) return;
    // 必填前置拦截(与后端 ValidateForSave 同口径:编号/名称必填,编号唯一)
    for (const f of FIELDS) {
      if (f.required && !(form[f.name] ?? "").trim()) {
        setToast({ text: `${f.label}不能为空`, tone: "err" });
        return;
      }
    }
    setSaving(true);
    try {
      const id = rowId(editing);
      if (id > 0) await customersCrud.update(id, form);
      else await customersCrud.create(form);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      setSelRow(null);
      await load();
    } catch (e) {
      // ApiError 用后端中文消息;网络中断等原始 TypeError 不直抛英文,给本地化提示
      setToast({
        text: e instanceof ApiError ? e.message : "保存失败,请检查网络后重试",
        tone: "err",
      });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!selRow) return;
    try {
      await customersCrud.remove(rowId(selRow));
      setToast({ text: "已删除", tone: "ok" });
      setSelRow(null);
      await load();
    } catch (e) {
      setToast({
        text: e instanceof ApiError ? e.message : "删除失败,请检查网络后重试",
        tone: "err",
      });
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问客户资料"
            description="缺少「客户资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="f-page mx-auto max-w-[1200px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">客户资料</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索客户资料"
            className="f-input f-input-slim w-56"
            placeholder="搜索客户资料"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                setKeyword(kwInput);
              }
            }}
          />
          {canSave && (
            <button type="button" className="f-btn f-btn-cyan h-9 px-4 text-sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增
            </button>
          )}
          {canSave && (
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              disabled={!selRow}
              onClick={() => selRow && openEdit(selRow)}
            >
              <Pencil className="h-4 w-4" />
              编辑
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm text-[#dc2626]"
              disabled={!selRow}
              onClick={() => setDelOpen(true)}
            >
              <Trash className="h-4 w-4" />
              删除
            </button>
          )}
          <span className={cn("text-xs", selRow ? "text-[#1d4ed8]" : "text-disabled")}>
            {selRow ? `已选中:${rowLabel(selRow)}` : "双击行选中后可编辑/删除"}
          </span>
        </div>
      </div>

      <div className="f-panel overflow-hidden">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {FIELDS.map((f) => (
                  <th
                    key={f.name}
                    className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-2.5 text-left font-medium whitespace-nowrap normal-case"
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={FIELDS.length} className="px-4 py-10 text-center text-disabled">
                    暂无数据
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={rowId(r)}
                    className={cn(
                      "cursor-pointer border-b border-black/6 hover:bg-black/[0.04]",
                      selRow && rowId(selRow) === rowId(r) && "bg-[#2563eb]/8",
                    )}
                    onDoubleClick={() => setSelRow(r)}
                  >
                    {FIELDS.map((f) => {
                      const v = r[f.name];
                      return (
                        <td key={f.name} className="px-4 py-2.5 text-[#3d4a5c]">
                          {tagRe.test(f.name) ? (
                            v == null || v === "" ? null : (
                              <span className="inline-flex rounded-md bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#15803d]">
                                {String(v)}
                              </span>
                            )
                          ) : monoRe.test(f.name) ? (
                            <span className="f-mono">{v == null ? "" : String(v)}</span>
                          ) : (
                            <span>{v == null ? "" : String(v)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {total} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </span>
        </div>
      </div>

      {/* 新增/编辑弹窗(字段照抄老系统 MASTER_CONFIGS.客户资料) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${editing && rowId(editing) > 0 ? "编辑" : "新增"}客户资料`}
        width="sm:max-w-[560px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={saving}
              onClick={() => void onSave()}
            >
              确定
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {FIELDS.map((f) => (
            <label key={f.name} className="block">
              <span className="f-label">
                {f.label}
                {f.required && <span className="ml-0.5 text-[#dc2626]">*</span>}
              </span>
              <input
                aria-label={f.label}
                className="f-input f-input-slim mt-1.5"
                maxLength={f.max}
                value={form[f.name] ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={`确认删除${selRow ? ` [${rowLabel(selRow)}]` : ""}?`}
        onConfirm={() => {
          setDelOpen(false);
          void onDelete();
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
