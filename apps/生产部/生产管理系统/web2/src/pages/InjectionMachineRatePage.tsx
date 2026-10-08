// 啤机机型啤工表(/system/injection-machine-rates;老系统 web/src/pages/system/InjectionMachineRatePage.tsx 重写):
// 机型 + 啤工价主数据(工模表.啤机机型 引用);服务端分页(page,size=10)+关键字搜索(机型/备注);
// 双击行选中后编辑/删除;啤工价受「单价」权限位控制(无单价位=隐藏列与表单字段,对照老系统 hidePrice)。
// 权限菜单=啤机机型啤工表(MenuCatalog.cs:102 实证:系统管理组)。
import { useCallback, useEffect, useState } from "react";
import { CaretLeft, CaretRight, Pencil, Plus, Trash } from "@phosphor-icons/react";
import { injectionMachineRateApi } from "@/api/endpoints";
import type { InjectionMachineRateRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { cn } from "@/lib/utils";

const MENU = "啤机机型啤工表";
const PAGE_SIZE = 10;
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function InjectionMachineRatePage() {
  const { can } = usePerms();
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  // 与后端 PermissionFlags.单价 对齐:无「单价」权限即隐藏啤工价(成本保密)
  const priceHidden = !can(MENU, "单价");

  const [rows, setRows] = useState<InjectionMachineRateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<InjectionMachineRateRow | null>(null);
  const [editing, setEditing] = useState<InjectionMachineRateRow | null>(null); // null=关;id=0=新增
  const [form, setForm] = useState({ 啤机机型: "", 啤工价: "", 备注: "" });
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await injectionMachineRateApi.list(page, PAGE_SIZE, keyword);
      setRows(r.items);
      setTotal(r.total);
      setSelRow(null);
    } catch (e) {
      setToast({ text: errMsg(e, "加载啤机机型啤工表失败"), tone: "err" });
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const openCreate = () => {
    setEditing({ id: 0 });
    setForm({ 啤机机型: "", 啤工价: "", 备注: "" });
  };
  const openEdit = (r: InjectionMachineRateRow) => {
    setEditing(r);
    setForm({ 啤机机型: r.啤机机型 ?? "", 啤工价: r.啤工价 == null ? "" : String(r.啤工价), 备注: r.备注 ?? "" });
  };

  const submit = async () => {
    if (!editing) return;
    if (!form.啤机机型.trim()) {
      setToast({ text: "请输入啤机机型", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        啤机机型: form.啤机机型.trim(),
        啤工价: form.啤工价 === "" ? null : Number(form.啤工价),
        备注: form.备注,
      };
      if (editing.id > 0) await injectionMachineRateApi.update(editing.id, body);
      else await injectionMachineRateApi.create(body);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      setSelRow(null);
      await load();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!selRow) return;
    try {
      await injectionMachineRateApi.remove(selRow.id);
      setToast({ text: "已删除", tone: "ok" });
      setDelOpen(false);
      setSelRow(null);
      await load();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "删除失败", tone: "err" });
      setDelOpen(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const colCount = priceHidden ? 2 : 3;

  return (
    <div className="f-page mx-auto max-w-5xl space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">啤机机型啤工表</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索啤机机型"
            className="f-input f-input-slim w-56"
            placeholder="搜索机型/备注"
            value={keyword}
            onChange={(e) => {
              setPage(1);
              setKeyword(e.target.value);
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
            {selRow ? `已选中:${selRow.啤机机型 ?? ""}` : "双击行选中后可编辑/删除"}
          </span>
        </div>
      </div>

      <div className="f-panel p-4">
        <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case">
                  啤机机型
                </th>
                {!priceHidden && (
                  <th className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-right font-medium whitespace-nowrap normal-case">
                    啤工价
                  </th>
                )}
                <th className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case">
                  备注
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-disabled">
                    {loading ? "加载中..." : "暂无数据"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "cursor-pointer border-b border-black/6 hover:bg-black/[0.04]",
                      selRow?.id === r.id && "bg-[#2563eb]/8",
                    )}
                    onDoubleClick={() => setSelRow(r)}
                  >
                    <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap">{r.啤机机型}</td>
                    {!priceHidden && (
                      <td className="f-mono px-3 py-2 text-right whitespace-nowrap">
                        {r.啤工价 ?? ""}
                      </td>
                    )}
                    <td className="max-w-72 truncate px-3 py-2" title={r.备注 ?? ""}>
                      {r.备注}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono mt-2 flex items-center justify-between px-1 text-sm text-[#5f6b7d]">
          <span>共 {total} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-label="上一页"
              className="f-btn h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <CaretLeft className="h-3.5 w-3.5" />
            </button>
            {page} / {pages}
            <button
              type="button"
              aria-label="下一页"
              className="f-btn h-7 w-7"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <CaretRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      </div>

      {/* 新增/编辑弹窗(机型必填;啤工价受单价位控制;对照老系统 Modal) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${editing && editing.id > 0 ? "编辑" : "新增"}啤机机型`}
        width="sm:max-w-[420px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={saving}
              onClick={() => void submit()}
            >
              确定
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="f-label">
              啤机机型<span className="text-[#dc2626]"> *</span>
            </span>
            <input
              aria-label="啤机机型"
              className="f-input f-input-slim mt-1.5"
              placeholder="如 120T / 168T"
              maxLength={30}
              value={form.啤机机型}
              onChange={(e) => setForm((v) => ({ ...v, 啤机机型: e.target.value }))}
            />
          </label>
          {!priceHidden && (
            <label className="block">
              <span className="f-label">啤工价</span>
              <input
                aria-label="啤工价"
                type="number"
                min={0}
                step="0.0001"
                className="f-input f-input-slim mt-1.5"
                value={form.啤工价}
                onChange={(e) => setForm((v) => ({ ...v, 啤工价: e.target.value }))}
              />
            </label>
          )}
          <label className="block">
            <span className="f-label">备注</span>
            <input
              aria-label="备注"
              className="f-input f-input-slim mt-1.5"
              maxLength={200}
              value={form.备注}
              onChange={(e) => setForm((v) => ({ ...v, 备注: e.target.value }))}
            />
          </label>
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={`确认删除该机型${selRow ? ` [${selRow.啤机机型}]` : ""}?`}
        onConfirm={() => void del()}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
