// 供应商资料(/master/供应商资料;基础设置;老系统 web/src/pages/master/SupplierMasterPage.tsx 重写):
// 左侧供应商类别树(一级;全部供应商(N) + 类别(数量);类别主数据只有 类别/名称 两列,
// 供应商行按 供应商类别 ∈ {类别,名称} 精确匹配归属,匹配不上仅出现在「全部供应商」下);
// 一次拉全量(2000),类别过滤/关键字(编号/名称/联系人)/类别计数均在前端做;
// 双击行选中后编辑/删除;新增默认带当前选中类别;编号/名称必填;
// 左树顶部 新增同级/子类别 按钮(受「供应商类别·保存」位控制,类别与名称同值落库,一级)。
// 权限菜单=供应商资料(MenuCatalog.cs:10 实证:基础资料组),类别维护=供应商类别。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Prohibit, Trash } from "@phosphor-icons/react";
import { masterDataApi } from "@/api/endpoints";
import type { MasterRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";

const MENU = "供应商资料"; // 供应商权限菜单名
const CAT_MENU = "供应商类别"; // 类别权限菜单名
const ALL = "__ALL__"; // 左侧「全部供应商」根节点 key

const suppliers = masterDataApi("suppliers");
const supplierCategories = masterDataApi("supplier-categories");
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

type Row = MasterRow & { ID: number };

// 左树类别节点(对照老系统 CatInfo)
interface CatInfo {
  key: string; // 树节点 key(主数据 id)
  display: string; // 展示名 = 名称 ?? 类别
  matchValues: string[]; // 参与归属匹配的值(类别、名称,去空)
  filterValue: string; // 新增供应商时默认带入的类别值 = 类别 ?? 名称
}

// 表单字段(对照老系统 Modal;编号/名称必填;职务/传真/邮政编码/电子邮箱 后端实体未持久化,按旧系统说明书保留)
const FORM_FIELDS: { name: string; label: string; required?: boolean; span2?: boolean; textarea?: boolean }[] = [
  { name: "供应商编号", label: "供应商编号", required: true },
  { name: "供应商名称", label: "供应商名称", required: true },
  { name: "联系人", label: "联系人" },
  { name: "职务", label: "职务" },
  { name: "手机", label: "手机" },
  { name: "电话", label: "电话" },
  { name: "传真", label: "传真" },
  { name: "电子邮箱", label: "电子邮箱" },
  { name: "邮政编码", label: "邮政编码" },
  { name: "付款方式", label: "付款方式" },
  { name: "货币", label: "货币" },
  { name: "联系地址", label: "联系地址", span2: true },
  { name: "备注", label: "备注", span2: true, textarea: true },
];

export default function SupplierMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const canCatSave = can(CAT_MENU, "保存");

  const [cats, setCats] = useState<Row[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<Row | null>(null);

  const [editing, setEditing] = useState<Row | null>(null); // null=关;ID=0=新增
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const loadCats = useCallback(async () => {
    try {
      const r = await supplierCategories.list(1, 500);
      setCats(r.items.map((x) => ({ ...x, ID: Number(x.ID ?? x.id ?? 0) })));
    } catch {
      /* 无类别权限等:左侧树留空,供应商区仍可用 */
    }
  }, []);

  // 一次拉全量:类别过滤/关键字搜索/各类别供应商数统计均在前端做(无专用统计端点,对照老系统)
  const loadRows = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await suppliers.list(1, 2000);
      setRows(r.items.map((x) => ({ ...x, ID: Number(x.ID ?? x.id ?? 0) })));
      setSelRow(null);
    } catch (e) {
      setToast({ text: errMsg(e, "加载供应商失败"), tone: "err" });
    } finally {
      setLoading(false);
    }
  }, [canOpen]);

  useEffect(() => {
    if (!canOpen) return;
    // 微任务里拉取:setState 不在 effect 同步路径
    void Promise.resolve().then(async () => {
      await loadCats();
      await loadRows();
    });
  }, [canOpen, loadCats, loadRows]);

  // 类别主数据 → CatInfo(一级,无父子组装)
  const catInfos = useMemo<CatInfo[]>(() => {
    const list: CatInfo[] = [];
    for (const c of cats) {
      const 类别 = String(c.类别 ?? "").trim();
      const 名称 = String(c.名称 ?? "").trim();
      const display = 名称 || 类别;
      if (!display) continue;
      list.push({
        key: String(c.ID),
        display,
        matchValues: [类别, 名称].filter((v) => v !== ""),
        filterValue: 类别 || 名称,
      });
    }
    return list;
  }, [cats]);

  // 供应商类别值 → 类别节点 key(用于归属统计与过滤)
  const catKeyByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catInfos) for (const v of c.matchValues) if (!m.has(v)) m.set(v, c.key);
    return m;
  }, [catInfos]);

  // 每个类别的供应商数(左侧名称后括号展示)
  const countByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = catKeyByValue.get(String(r.供应商类别 ?? ""));
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows, catKeyByValue]);

  // 类别值 → 展示名(网格「类别」列把旧编号尽量翻译成类别名称)
  const catDisplayByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catInfos) for (const v of c.matchValues) if (!m.has(v)) m.set(v, c.display);
    return m;
  }, [catInfos]);

  const selCat = selKey === ALL ? undefined : catInfos.find((c) => c.key === selKey);

  // 右侧供应商:按选中类别(精确匹配) + 关键字(编号/名称/联系人)前端过滤
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (selCat && !selCat.matchValues.includes(String(r.供应商类别 ?? ""))) return false;
      if (!kw) return true;
      return [r.供应商编号, r.供应商名称, r.联系人].some((v) =>
        String(v ?? "").toLowerCase().includes(kw),
      );
    });
  }, [rows, selCat, keyword]);

  const openCreate = () => {
    setEditing({ ID: 0 });
    // 新增默认:类别带当前左侧选中类别
    setForm({ 供应商类别: selCat?.filterValue ?? "" });
  };
  const openEdit = async (r: Row) => {
    try {
      const full = await suppliers.get(r.ID);
      setEditing(r);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(full)) v[k] = val == null ? "" : String(val);
      setForm(v);
    } catch (e) {
      setToast({ text: errMsg(e, "加载供应商详情失败"), tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    if (!form.供应商编号?.trim()) {
      setToast({ text: "请输入供应商编号", tone: "err" });
      return;
    }
    if (!form.供应商名称?.trim()) {
      setToast({ text: "请输入供应商名称", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      if (editing.ID > 0) await suppliers.update(editing.ID, form);
      else await suppliers.create(form);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      setSelRow(null);
      await loadCats();
      await loadRows();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!selRow) return;
    try {
      await suppliers.remove(selRow.ID);
      setToast({ text: "已删除", tone: "ok" });
      setSelRow(null);
      await loadCats();
      await loadRows();
    } catch (e) {
      setToast({ text: errMsg(e, "删除失败"), tone: "err" });
    }
  };

  // 类别主数据无父级列,「新增同级/子类别」均创建为一级类别(按钮保留与物料资料页一致的交互)
  const [catDlgOpen, setCatDlgOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);
  const openCatCreate = () => {
    setCatName("");
    setCatDlgOpen(true);
  };
  const submitCat = async () => {
    const name = catName.trim();
    if (!name) return;
    setCatSaving(true);
    try {
      // 类别 与 名称 同值:供应商资料.供应商类别 用 类别 值过滤(同物料类别「编号=名称」约定)
      await supplierCategories.create({ 类别: name, 名称: name });
      setToast({ text: "类别已保存", tone: "ok" });
      setCatDlgOpen(false);
      await loadCats();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "类别保存失败", tone: "err" });
    } finally {
      setCatSaving(false);
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问供应商资料"
            description="缺少「供应商资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">供应商资料</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索供应商"
            className="f-input f-input-slim w-64"
            placeholder="供应商编号/名称/联系人"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
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
            {selRow
              ? `已选中:${String(selRow.供应商编号 ?? "")} ${String(selRow.供应商名称 ?? "")}`
              : "双击行选中后可编辑/删除"}
          </span>
        </div>
      </div>

      <div className="f-panel flex gap-3 p-4">
        {/* 左:供应商类别树(一级;对照老系统 Tree) */}
        <div className="w-60 shrink-0 border-r border-black/8 pr-3">
          {canCatSave && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="f-btn h-8 px-2.5 text-xs"
                disabled={!selCat}
                onClick={openCatCreate}
              >
                新增同级类别
              </button>
              <button type="button" className="f-btn h-8 px-2.5 text-xs" onClick={openCatCreate}>
                新增子类别
              </button>
            </div>
          )}
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
            全部供应商({rows.length})
          </button>
          {catInfos.map((c) => (
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
              {c.display}({countByCat.get(c.key) ?? 0})
            </button>
          ))}
        </div>

        {/* 右:供应商网格 */}
        <div className="min-w-0 flex-1">
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  {["供应商编号", "供应商名称", "类别", "联系人", "手机", "电话", "付款方式", "备注"].map(
                    (h) => (
                      <th
                        key={h}
                        className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-disabled">
                      {loading ? "加载中..." : "暂无数据"}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.ID}
                      className={cn(
                        "cursor-pointer border-b border-black/6 hover:bg-black/[0.04]",
                        selRow?.ID === r.ID && "bg-[#2563eb]/8",
                      )}
                      onDoubleClick={() => setSelRow(r)}
                    >
                      <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap">
                        {String(r.供应商编号 ?? "")}
                      </td>
                      <td className="max-w-48 truncate px-3 py-2" title={String(r.供应商名称 ?? "")}>
                        {String(r.供应商名称 ?? "")}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {catDisplayByValue.get(String(r.供应商类别 ?? "")) ??
                          (r.供应商类别 ? String(r.供应商类别) : "")}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{String(r.联系人 ?? "")}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap">{String(r.手机 ?? "")}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap">{String(r.电话 ?? "")}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{String(r.付款方式 ?? "")}</td>
                      <td className="max-w-44 truncate px-3 py-2" title={String(r.备注 ?? "")}>
                        {String(r.备注 ?? "")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="f-mono mt-2 flex items-center justify-between px-1 text-sm text-[#5f6b7d]">
            <span>共 {filtered.length} 条</span>
          </div>
        </div>
      </div>

      {/* 供应商表单(新增/编辑;对照老系统 Modal) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && editing.ID > 0 ? "编辑供应商" : "新增供应商"}
        width="sm:max-w-[760px]"
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
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
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
            <span className="f-label">供应商类别</span>
            <SearchSelect
              ariaLabel="供应商类别"
              className="mt-1.5"
              value={form.供应商类别 ?? ""}
              options={catInfos.map((c) => ({ value: c.filterValue, label: c.display }))}
              placeholder="请选择"
              clearLabel="请选择"
              onChange={(v) => setForm((f) => ({ ...f, 供应商类别: v }))}
            />
          </label>
          {FORM_FIELDS.slice(2).map((f) => (
            <label key={f.name} className={cn("block", f.span2 && "col-span-3")}>
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

      {/* 新增类别弹窗(类别/名称 同值,一级) */}
      <PickerDialog
        open={catDlgOpen}
        onClose={() => setCatDlgOpen(false)}
        title="新增供应商类别"
        width="sm:max-w-[420px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setCatDlgOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={!catName.trim() || catSaving}
              onClick={() => void submitCat()}
            >
              确定
            </button>
          </>
        }
      >
        <input
          aria-label="类别名称"
          className="f-input f-input-slim"
          placeholder="类别名称"
          value={catName}
          maxLength={20}
          onChange={(e) => setCatName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submitCat()}
        />
      </PickerDialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={`确认删除供应商${selRow ? ` ${String(selRow.供应商编号 ?? "")} ${String(selRow.供应商名称 ?? "")}` : ""}?`}
        onConfirm={() => {
          setDelOpen(false);
          void del();
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
