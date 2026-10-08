// 加工厂资料(/master/加工厂资料;外发加工;老系统 web/src/pages/master/FactoryMasterPage.tsx 重写):
// 左树按加工类别分组(全部加工厂 + 类别(数量),数据源 /factory-master/categories);
// 右侧加工厂表服务端分页(50/页),双击行选中后编辑/删除;新增默认带当前选中类别;
// 新增/编辑弹窗(加工厂编号必填;类别下拉取自 加工厂类别 主数据 名称)。
// 列表/类别树走 /factory-master,CRUD 走 /master/factories(masterDataApi),与老系统一致。
// 权限菜单=加工厂资料(MenuCatalog.cs:11 实证:基础资料组)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Prohibit, Trash } from "@phosphor-icons/react";
import { factoryMasterApi, masterDataApi } from "@/api/endpoints";
import type { FactoryCategoryNode, FactoryRow, MasterRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";

const MENU = "加工厂资料"; // MenuCatalog 实证:基础资料组「加工厂资料」
const ALL = "__ALL__";
const PAGE_SIZE = 50;

const factoriesCrud = masterDataApi("factories");
const factoryCategories = masterDataApi("factory-categories");
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// 表单字段(对照老系统 Form;编号必填)
const FORM_FIELDS: { name: string; label: string; required?: boolean; textarea?: boolean }[] = [
  { name: "加工厂编号", label: "加工厂编号", required: true },
  { name: "加工厂名称", label: "加工厂名称" },
  { name: "联系人", label: "联系人" },
  { name: "手机", label: "手机" },
  { name: "电话", label: "电话" },
  { name: "传真", label: "传真" },
  { name: "联系地址", label: "联系地址" },
  { name: "货币", label: "货币" },
  { name: "付款方式", label: "付款方式" },
  { name: "备注", label: "备注", textarea: true },
];

export default function FactoryMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");

  const [cats, setCats] = useState<FactoryCategoryNode[]>([]);
  const [catOptions, setCatOptions] = useState<{ value: string; label: string }[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<FactoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<FactoryRow | null>(null);

  const [editing, setEditing] = useState<FactoryRow | null>(null); // null=关;ID=0=新增
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const 类别 = selKey === ALL ? undefined : selKey;

  const loadCats = useCallback(async () => {
    try {
      setCats(await factoryMasterApi.categories());
    } catch {
      /* 忽略 */
    }
  }, []);

  const loadRows = useCallback(
    async (p: number) => {
      if (!canOpen) return;
      setLoading(true);
      try {
        const r = await factoryMasterApi.list(类别, keyword || undefined, p, PAGE_SIZE);
        setRows(r.items);
        setTotal(r.total);
        setSelRow(null);
      } catch (e) {
        setToast({ text: errMsg(e, "加载加工厂失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [canOpen, 类别, keyword],
  );

  useEffect(() => {
    if (canOpen) void loadCats();
  }, [canOpen, loadCats]);
  // 类别下拉选项(新增/编辑弹窗用),来自 加工厂类别 主数据(对照老系统)
  useEffect(() => {
    if (!canOpen) return;
    factoryCategories
      .list(1, 100)
      .then((r) =>
        setCatOptions(
          r.items
            .map((x) => String(x.名称 ?? ""))
            .filter(Boolean)
            .map((n) => ({ value: n, label: n })),
        ),
      )
      .catch(() => {
        /* 忽略 */
      });
  }, [canOpen]);
  // 选中分类/关键字变化时重查(回到第1页)
  useEffect(() => {
    setPage(1);
    void loadRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, selKey, keyword]);

  const openCreate = () => {
    const init: FactoryRow = { ID: 0, 加工厂类别: 类别 };
    setEditing(init);
    setForm({ 加工厂类别: 类别 ?? "" });
  };
  const openEdit = async (r: FactoryRow) => {
    try {
      const full = (await factoriesCrud.get(r.ID!)) as MasterRow;
      setEditing(r);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(full)) v[k] = val == null ? "" : String(val);
      setForm(v);
    } catch (e) {
      setToast({ text: errMsg(e, "加载加工厂详情失败"), tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    if (!form.加工厂编号?.trim()) {
      setToast({ text: "请输入加工厂编号", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      if ((editing.ID ?? 0) > 0) await factoriesCrud.update(editing.ID!, form);
      else await factoriesCrud.create(form);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      setSelRow(null);
      await loadCats();
      await loadRows(page);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!selRow) return;
    try {
      await factoriesCrud.remove(selRow.ID!);
      setToast({ text: "已删除", tone: "ok" });
      setSelRow(null);
      await loadCats();
      await loadRows(page);
    } catch (e) {
      setToast({ text: errMsg(e, "删除失败"), tone: "err" });
    }
  };

  const rowLabel = (r: FactoryRow | null) =>
    r ? String(r.加工厂编号 ?? r.加工厂名称 ?? "") : "";

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const treeItems = useMemo(
    () => cats.map((c) => ({ key: c.类别 ?? "", label: `${c.类别}(${c.数量})` })),
    [cats],
  );

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问加工厂资料"
            description="缺少「加工厂资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">加工厂资料</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索加工厂"
            className="f-input f-input-slim w-64"
            placeholder="加工厂编号/名称/联系人/电话"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                setKeyword(kwInput.trim());
              }
            }}
          />
          <button
            type="button"
            className="f-btn h-9 px-4 text-sm"
            onClick={() => {
              setPage(1);
              setKeyword(kwInput.trim());
            }}
          >
            查询
          </button>
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
              onClick={() => selRow && void openEdit(selRow)}
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

      <div className="f-panel flex gap-3 p-4">
        {/* 左:加工类别树(一级;对照老系统 Tree 全部加工厂 + 类别(数量)) */}
        <div className="w-60 shrink-0 border-r border-black/8 pr-3">
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              selKey === ALL
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#3d4a5c] hover:bg-black/[0.04]",
            )}
            onClick={() => setSelKey(ALL)}
          >
            全部加工厂
          </button>
          {treeItems.map((c) => (
            <button
              key={c.key}
              type="button"
              className={cn(
                "flex w-full items-center rounded-lg px-2 py-1.5 pl-6 text-left text-sm transition-colors",
                selKey === c.key
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#3d4a5c] hover:bg-black/[0.04]",
              )}
              onClick={() => setSelKey(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  {[
                    "加工厂编号", "加工厂名称", "加工厂类别", "联系地址", "联系人",
                    "电话", "手机", "传真", "货币", "付款方式", "备注",
                  ].map((h) => (
                    <th
                      key={h}
                      className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-disabled">
                      {loading ? "加载中..." : "暂无数据"}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.ID}
                      className={cn(
                        "cursor-pointer border-b border-black/6 hover:bg-black/[0.04]",
                        selRow?.ID === r.ID && "bg-[#2563eb]/8",
                      )}
                      onDoubleClick={() => setSelRow(r)}
                    >
                      <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap">{r.加工厂编号}</td>
                      <td className="max-w-48 truncate px-3 py-2" title={r.加工厂名称}>{r.加工厂名称}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.加工厂类别 ?? ""}</td>
                      <td className="max-w-52 truncate px-3 py-2" title={r.联系地址}>{r.联系地址 ?? ""}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.联系人 ?? ""}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap">{r.电话 ?? ""}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap">{r.手机 ?? ""}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap">{r.传真 ?? ""}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.货币 ?? ""}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.付款方式 ?? ""}</td>
                      <td className="max-w-40 truncate px-3 py-2" title={r.备注}>{r.备注 ?? ""}</td>
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
                className="f-btn h-8 px-3 text-sm"
                disabled={page <= 1}
                onClick={() => {
                  setPage((p) => p - 1);
                  void loadRows(page - 1);
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
                  void loadRows(page + 1);
                }}
              >
                下一页
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* 新增/编辑加工厂(对照老系统 Modal 表单) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && (editing.ID ?? 0) > 0 ? "编辑加工厂" : "新增加工厂"}
        width="sm:max-w-[680px]"
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
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {FORM_FIELDS.slice(0, 2).map((f) => (
            <label key={f.name} className="block">
              <span className="f-label">
                {f.label}
                {f.required && <span className="text-[#dc2626]"> *</span>}
              </span>
              <input
                aria-label={f.label}
                className="f-input f-input-slim mt-1.5"
                value={form[f.name] ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
          <label className="block">
            <span className="f-label">加工厂类别</span>
            <SearchSelect
              ariaLabel="加工厂类别"
              className="mt-1.5"
              value={form.加工厂类别 ?? ""}
              options={catOptions}
              placeholder="选择加工类别"
              clearLabel="选择加工类别"
              onChange={(v) => setForm((f) => ({ ...f, 加工厂类别: v }))}
            />
          </label>
          {FORM_FIELDS.slice(2).map((f) => (
            <label key={f.name} className={cn("block", f.textarea && "col-span-2")}>
              <span className="f-label">{f.label}</span>
              {f.textarea ? (
                <textarea
                  aria-label={f.label}
                  rows={2}
                  className="f-input mt-1.5 h-auto w-full py-2"
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              ) : (
                <input
                  aria-label={f.label}
                  className="f-input f-input-slim mt-1.5"
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={`确认删除该加工厂${selRow ? ` [${rowLabel(selRow)}]` : ""}?`}
        onConfirm={() => {
          setDelOpen(false);
          void del();
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
