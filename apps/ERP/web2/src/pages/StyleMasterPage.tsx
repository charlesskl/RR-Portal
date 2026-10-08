// 款号总表(工程部;老系统 web/src/pages/master/MasterDataPage.tsx + configs.ts 的「款号资料」配置重写):
// 通用主数据维护:搜索/分页/新增/编辑/删除 + 双击行选中 + 单价类字段按「单价」权限位脱敏。
// 数据源 /master/styles(masterDataApi);明细跳 /bom-setup?款号=(老系统跳 /styles/:款号 详情页,
// web2 无该路由,BOM物料设置页为最近的等价入口)。
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Pencil, Plus, Prohibit, Trash } from "@phosphor-icons/react";
import { masterDataApi } from "@/api/endpoints";
import type { MasterRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { cn } from "@/lib/utils";

const MENU = "款号资料"; // MenuCatalog 实证:基础资料组「款号资料」
const PAGE_SIZE = 10;
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// 字段配置照抄老系统 MASTER_CONFIGS.款号资料(price=单价权限位脱敏)
const FIELDS: { name: string; label: string; price?: boolean }[] = [
  { name: "款号", label: "款号" },
  { name: "款式", label: "款式" },
  { name: "单价", label: "单价", price: true },
  { name: "成本价", label: "成本价", price: true },
  { name: "批发价", label: "批发价", price: true },
  { name: "零售价", label: "零售价", price: true },
];

const stylesMaster = masterDataApi("styles");
const monoRe = /编号|号|价|手机/;
const rowId = (r: MasterRow) => r.ID ?? r.id ?? 0;

export default function StyleMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const priceHidden = !can(MENU, "单价");
  const navigate = useNavigate();

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

  const fields = FIELDS.filter((f) => !(f.price && priceHidden));

  const load = useCallback(async () => {
    try {
      const r = await stylesMaster.list(page, PAGE_SIZE, keyword);
      setRows(r.items);
      setTotal(r.total);
      setSelRow(null);
    } catch (e) {
      setToast({ text: errMsg(e, "加载款号资料失败"), tone: "err" });
    }
  }, [page, keyword]);

  useEffect(() => {
    if (!canOpen) return;
    // 微任务里拉取:setState 不在 effect 同步路径(页面加载/翻页/搜索即查)
    void Promise.resolve().then(() => load());
  }, [canOpen, load]);

  const rowLabel = (r: MasterRow | null) =>
    r ? String(r.款号 ?? r.款式 ?? rowId(r)) : "";

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
    setSaving(true);
    try {
      const id = rowId(editing);
      if (id > 0) await stylesMaster.update(id, form);
      else await stylesMaster.create(form);
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

  const onDelete = async () => {
    if (!selRow) return;
    try {
      await stylesMaster.remove(rowId(selRow));
      setToast({ text: "已删除", tone: "ok" });
      setSelRow(null);
      await load();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "删除失败", tone: "err" });
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问款号总表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="f-page mx-auto max-w-[1200px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">款号总表</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索款号总表"
            className="f-input f-input-slim w-56"
            placeholder="搜索款号总表"
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
          <button
            type="button"
            className="f-btn h-9 px-4 text-sm"
            disabled={!selRow?.款号}
            onClick={() =>
              selRow?.款号 && navigate(`/bom-setup?款号=${encodeURIComponent(String(selRow.款号))}`)
            }
          >
            明细
          </button>
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
                {fields.map((f) => (
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
                  <td colSpan={fields.length} className="px-4 py-10 text-center text-disabled">
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
                    {fields.map((f) => (
                      <td key={f.name} className="px-4 py-2.5 text-[#3d4a5c]">
                        {monoRe.test(f.name) ? (
                          <span className="f-mono">{r[f.name] == null ? "" : String(r[f.name])}</span>
                        ) : (
                          <span>{r[f.name] == null ? "" : String(r[f.name])}</span>
                        )}
                      </td>
                    ))}
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

      {/* 新增/编辑弹窗 */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${editing && rowId(editing) > 0 ? "编辑" : "新增"}款号资料`}
        width="sm:max-w-[520px]"
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
          {fields.map((f) => (
            <label key={f.name} className="block">
              <span className="f-label">{f.label}</span>
              <input
                aria-label={f.label}
                className="f-input f-input-slim mt-1.5"
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
