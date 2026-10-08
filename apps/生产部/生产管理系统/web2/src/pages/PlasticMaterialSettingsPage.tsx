// 塑胶物料设置(/plastic-material-settings)。对照老系统 web/src/pages/plastics/PlasticMaterialSettingsPage.tsx:
// 关键字(物料编号/名称/规格) + 服务端分页;双击行选中后 编辑/删除 对其生效;
// 编辑弹窗(默认仓库/损耗率%/备注);已设置徽章(ID 非空=已设置);删除需确认且仅已设置行可删。
// 权限菜单=塑胶物料设置(MenuCatalog.cs:108 实证:塑胶采购组);功能位 打开/保存/删除。
import { useCallback, useEffect, useState } from "react";
import {
  ArrowClockwise,
  MagnifyingGlass,
  Pencil,
  Prohibit,
  Trash,
} from "@phosphor-icons/react";
import { plasticMaterialSettingsApi } from "@/api/endpoints";
import type { PlasticMaterialSettingRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DensitySwitch } from "@/components/doc/QueryTable";

const MENU = "塑胶物料设置";
const PAGE_SIZE = 50;

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

// 表头四律:sticky + 不透明白底 + z-10 + nowrap(本页为自定义表格,非 QueryTable:需行选中高亮)
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

interface EditForm {
  默认仓库: string;
  损耗率: string;
  备注: string;
}

export default function PlasticMaterialSettingsPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");

  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticMaterialSettingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  // 双击选中的行,工具栏 编辑/删除 按钮对其生效(对照老系统 selRow)
  const [selRow, setSelRow] = useState<PlasticMaterialSettingRow | null>(null);
  const [editing, setEditing] = useState<PlasticMaterialSettingRow | null>(null);
  const [form, setForm] = useState<EditForm>({ 默认仓库: "", 损耗率: "", 备注: "" });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(
    async (p: number) => {
      if (!canOpen) return;
      setLoading(true);
      try {
        const r = await plasticMaterialSettingsApi.list(p, PAGE_SIZE, keyword.trim());
        setRows(r.items);
        setTotal(r.total);
        setSelRow(null); // 重新加载后清空选中行(对照老系统)
      } catch (e) {
        setToast({ text: errMsg(e) || "加载塑胶物料设置失败", tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [canOpen, keyword],
  );

  useEffect(() => {
    setPage(1);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, keyword]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const search = () => setKeyword(kwInput.trim());

  const openEdit = (row: PlasticMaterialSettingRow) => {
    setForm({
      默认仓库: row.默认仓库 ?? "",
      损耗率: row.损耗率 != null ? String(row.损耗率) : "",
      备注: row.备注 ?? "",
    });
    setEditing(row);
  };

  const save = async () => {
    if (!editing || !canSave) return;
    if (form.默认仓库.length > 80) {
      setToast({ text: "默认仓库不能超过 80 个字符", tone: "err" });
      return;
    }
    if (form.备注.length > 500) {
      setToast({ text: "备注不能超过 500 个字符", tone: "err" });
      return;
    }
    const 损耗率 = form.损耗率.trim() === "" ? null : Number(form.损耗率);
    if (损耗率 != null && (Number.isNaN(损耗率) || 损耗率 < 0 || 损耗率 > 100)) {
      setToast({ text: "损耗率须在 0-100 之间", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      await plasticMaterialSettingsApi.save(editing.物料编号, {
        默认仓库: form.默认仓库.trim() || null,
        损耗率,
        备注: form.备注.trim() || null,
      });
      setToast({ text: `塑胶物料 [${editing.物料编号}] 设置已保存`, tone: "ok" });
      setEditing(null);
      await load(page);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存塑胶物料设置失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selRow || !canDelete) return;
    try {
      await plasticMaterialSettingsApi.remove(selRow.物料编号);
      setToast({ text: `塑胶物料 [${selRow.物料编号}] 设置已删除`, tone: "ok" });
      setDeleteOpen(false);
      setSelRow(null); // 删除成功后清空选中行(对照老系统)
      await load(page);
    } catch (e) {
      setToast({ text: errMsg(e) || "删除塑胶物料设置失败", tone: "err" });
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶物料设置·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶物料设置</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 工具栏(对照老系统:搜索 + 编辑/删除(双击选中后生效) + 刷新) */}
      <div className="f-panel flex shrink-0 flex-wrap items-center gap-3 p-5">
        <div className="w-72">
          <Input
            aria-label="关键字"
            className={inputCls}
            placeholder="物料编号/名称/规格"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={!selRow || !canSave}
          onClick={() => selRow && openEdit(selRow)}
        >
          <Pencil className="h-4.5 w-4.5" />
          编辑
        </button>
        <button
          type="button"
          className="f-btn px-5 text-[#dc2626]"
          disabled={!selRow?.ID || !canDelete}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash className="h-4.5 w-4.5" />
          删除
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={loading}
          onClick={() => void load(page)}
        >
          <ArrowClockwise className="h-4.5 w-4.5" />
          刷新
        </button>
        <span className={cn("text-sm", selRow ? "text-[#15803d]" : "text-[#5f6b7d]")}>
          {selRow ? `已选中:${selRow.物料编号}` : "双击行选中后可编辑/删除"}
        </span>
      </div>

      {/* 列表(双击选中高亮;对照老系统 columns) */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table data-freeze className="w-full min-w-[1000px] text-[15px]">
            <thead>
              <tr>
                {["物料编号", "物料名称", "规格", "单位", "默认仓库", "损耗率%", "备注", "已设置"].map(
                  (h) => (
                    <th key={h} className={cn(thCls, (h === "损耗率%" || h === "已设置") && "text-right")}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    暂无数据
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.物料编号}
                    className={cn(
                      "cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]",
                      selRow?.物料编号 === r.物料编号 && "bg-[#16a34a]/8",
                    )}
                    onDoubleClick={() => setSelRow(r)}
                    title="双击选中后可编辑/删除"
                  >
                    <td className="f-mono px-3 py-2.5 font-semibold whitespace-nowrap text-[#1a2330]">
                      {r.物料编号}
                    </td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                    <td className="f-mono px-3 py-2.5 whitespace-nowrap text-[#3d4a5c]">
                      {r.规格 ?? ""}
                    </td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.默认仓库 ?? ""}</td>
                    <td className="f-mono px-3 py-2.5 text-right text-[#3d4a5c]">
                      {r.损耗率 ?? ""}
                    </td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.备注 ?? ""}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.ID ? (
                        <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
                          是
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
                          否
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {total} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => p - 1);
                void load(page - 1);
              }}
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
              onClick={() => {
                setPage((p) => p + 1);
                void load(page + 1);
              }}
            >
              下一页
            </button>
          </span>
        </div>
      </div>

      {/* 编辑弹窗(共享弹窗件;对照老系统 Modal 三字段) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `塑胶物料设置 - ${editing.物料编号} ${editing.物料名称 ?? ""}` : ""}
        width="sm:max-w-[520px]"
        footer={
          <>
            <button type="button" className="f-btn px-5" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan px-5"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="f-label">默认仓库</span>
            <Input
              className={cn(inputCls, "mt-1.5")}
              aria-label="默认仓库"
              value={form.默认仓库}
              onChange={(e) => setForm((f) => ({ ...f, 默认仓库: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="f-label">损耗率(%)</span>
            <Input
              className={cn(inputCls, "mt-1.5")}
              aria-label="损耗率"
              type="number"
              min={0}
              max={100}
              value={form.损耗率}
              onChange={(e) => setForm((f) => ({ ...f, 损耗率: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="f-label">备注</span>
            <textarea
              className={cn(inputCls, "mt-1.5 h-auto min-h-16 w-full rounded-md border px-3 py-2")}
              rows={2}
              aria-label="备注"
              value={form.备注}
              onChange={(e) => setForm((f) => ({ ...f, 备注: e.target.value }))}
            />
          </label>
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`确认删除塑胶物料 [${selRow?.物料编号 ?? ""}] 的设置?`}
        confirmLabel="删除"
        onConfirm={() => void remove()}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
