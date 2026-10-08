// 原料资料(/plastic-raw-material-master,菜单名「原料资料」权限键「塑胶原料资料表」)。
// 对照老系统 web/src/pages/plastics/PlasticRawMaterialMasterPage.tsx:
// 左侧类别树(全部塑胶原料 + 类别(数量) 平铺) + 关键字搜索 + 服务端分页(50/页);
// 新增/编辑弹窗(编辑先取 /master/plastic-raw-materials/{id} 全量详情);删除带确认;
// 无「单价」位时 单价/销售价 列显 *** 且编辑弹窗不出价格段。
// CRUD 走 /master/plastic-raw-materials(同老系统 masterApi),列表/类别走 /plastic-raw-material-master。
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Prohibit, Trash } from "@phosphor-icons/react";
import { masterDataApi, plasticRawMaterialMasterApi } from "@/api/endpoints";
import type { PlasticRawMaterialCategoryNode, PlasticRawMaterialRow } from "@/api/types";
import { errMsg } from "@/lib/rawDocs";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog } from "@/components/doc/PickerDialog";

const MENU = "塑胶原料资料表"; // MenuCatalog.cs:14 实证:基础资料组
const ALL = "__ALL__";
const PAGE_SIZE = 50;

const plasticRaws = masterDataApi("plastic-raw-materials");

// 数值表单字段(保存时转 Number,空串不下发)
const NUM_FIELDS = new Set(["每包重量", "单价", "销售价", "起订量", "安全库存"]);

export default function PlasticRawMaterialMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const priceHidden = !can(MENU, "单价");
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [cats, setCats] = useState<PlasticRawMaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticRawMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<PlasticRawMaterialRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<PlasticRawMaterialRow | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const 类别 = selKey === ALL ? undefined : selKey;

  const loadCats = useCallback(async () => {
    try {
      setCats(await plasticRawMaterialMasterApi.categories());
    } catch {
      /* 取类别失败不阻塞 */
    }
  }, []);

  const loadRows = useCallback(
    async (p: number) => {
      if (!canOpen) return;
      setLoading(true);
      try {
        const r = await plasticRawMaterialMasterApi.list(类别, keyword || undefined, p, PAGE_SIZE);
        setRows(r.items);
        setTotal(r.total);
      } catch (e) {
        setToast({ text: errMsg(e) || "加载塑胶原料失败", tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [canOpen, 类别, keyword],
  );

  useEffect(() => {
    if (canOpen) void loadCats();
  }, [canOpen, loadCats]);
  useEffect(() => {
    setPage(1);
    void loadRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, selKey, keyword]);

  const openCreate = () => {
    const init: PlasticRawMaterialRow = { ID: 0, 物料类别: 类别 };
    setEditing(init);
    setForm({ 物料类别: 类别 ?? "" });
  };

  const openEdit = async (r: PlasticRawMaterialRow) => {
    try {
      const full = await plasticRaws.get(r.ID);
      setEditing(r);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(full)) v[k] = val == null ? "" : String(val);
      setForm(v);
    } catch (e) {
      setToast({ text: errMsg(e) || "加载塑胶原料详情失败", tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    if (!form.物料编号?.trim()) {
      setToast({ text: "请输入物料编号", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      for (const k of Object.keys(body)) {
        if (!NUM_FIELDS.has(k)) continue;
        if (body[k] === "") delete body[k];
        else if (body[k] != null) body[k] = Number(body[k]);
      }
      if ((editing.ID ?? 0) > 0) await plasticRaws.update(editing.ID!, body);
      else await plasticRaws.create(body);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      await loadCats();
      await loadRows(page);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!deleting) return;
    try {
      await plasticRaws.remove(deleting.ID);
      setToast({ text: "已删除", tone: "ok" });
      setDeleting(null);
      await loadCats();
      await loadRows(page);
    } catch (e) {
      setToast({ text: errMsg(e) || "删除失败", tone: "err" });
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶原料资料表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const textField = (name: string, label: string) => (
    <label key={name} className="block">
      <span className="f-label">{label}</span>
      <input
        aria-label={label}
        className="f-input f-input-slim mt-1.5"
        value={form[name] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
      />
    </label>
  );
  const numField = (name: string, label: string) => (
    <label key={name} className="block">
      <span className="f-label">{label}</span>
      <input
        aria-label={label}
        type="number"
        className="f-input f-input-slim mt-1.5"
        value={form[name] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
      />
    </label>
  );

  // 列表列(对照老系统 columns;价格列按「单价」位显 ***)
  const COLUMNS: { title: string; key: keyof PlasticRawMaterialRow; money?: boolean; num?: boolean }[] = [
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "类别", key: "物料类别" },
    { title: "规格", key: "规格" },
    { title: "颜色", key: "颜色" },
    { title: "商品名称", key: "商品名称" },
    { title: "产地", key: "产地" },
    { title: "每包重量", key: "每包重量", num: true },
    { title: "单位", key: "单位" },
    { title: "单价", key: "单价", money: true },
    { title: "销售价", key: "销售价", money: true },
    { title: "起订量", key: "起订量", num: true },
    { title: "安全库存", key: "安全库存", num: true },
    { title: "库存", key: "库存", num: true },
    { title: "供应商", key: "供应商名称" },
    { title: "备注", key: "备注" },
  ];

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶原料资料表</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索塑胶原料"
            className="f-input f-input-slim w-72"
            placeholder="物料编号/名称/规格/颜色/商品名称/供应商"
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
            <button
              type="button"
              className="f-btn f-btn-cyan h-9 px-4 text-sm"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4" />
              新增
            </button>
          )}
        </div>
      </div>

      <div className="f-panel flex gap-3 p-4">
        {/* 左树:全部塑胶原料 + 类别(数量)(对照老系统 treeData 两层平铺) */}
        <div className="w-52 shrink-0 space-y-0.5 overflow-auto border-r border-black/8 pr-3">
          <button
            type="button"
            onClick={() => setSelKey(ALL)}
            className={cn(
              "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
              selKey === ALL
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#3d4a5c] hover:bg-black/[0.04]",
            )}
          >
            全部塑胶原料
          </button>
          {cats.map((c) => (
            <button
              key={c.类别}
              type="button"
              onClick={() => setSelKey(c.类别 ?? "")}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2.5 py-2 pl-5 text-left text-sm transition-colors",
                selKey === c.类别
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#3d4a5c] hover:bg-black/[0.04]",
              )}
            >
              <span className="truncate">{c.类别}</span>
              <span className="f-mono text-xs text-[#5f6b7d]">({c.数量})</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 1900 }}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.title}
                      className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case"
                    >
                      {c.title}
                    </th>
                  ))}
                  <th className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-4 py-10 text-center text-disabled">
                      {loading ? "加载中..." : "暂无数据"}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.ID} className="border-b border-black/6 last:border-0 hover:bg-black/[0.04]">
                      {COLUMNS.map((c) => {
                        const v = r[c.key];
                        if (c.money)
                          return (
                            <td key={c.title} className="f-mono px-3 py-2 text-right whitespace-nowrap">
                              {money(v as number | null | undefined)}
                            </td>
                          );
                        if (c.num)
                          return (
                            <td key={c.title} className="f-mono px-3 py-2 text-right whitespace-nowrap">
                              {v ?? ""}
                            </td>
                          );
                        return (
                          <td
                            key={c.title}
                            className={cn(
                              "px-3 py-2 whitespace-nowrap",
                              c.key === "物料编号" && "f-mono font-semibold",
                            )}
                          >
                            {v == null ? "" : String(v)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          {canSave && (
                            <button
                              type="button"
                              aria-label={`编辑 ${r.物料编号}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#15803d] transition-colors hover:bg-[#16a34a]/10"
                              onClick={() => void openEdit(r)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              aria-label={`删除 ${r.物料编号}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#dc2626] transition-colors hover:bg-[#dc2626]/10"
                              onClick={() => setDeleting(r)}
                            >
                              <Trash className="h-4 w-4" />
                            </button>
                          )}
                        </span>
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

      {/* 新增/编辑塑胶原料(字段对照老系统 Form;价格段按「单价」位裁剪) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && (editing.ID ?? 0) > 0 ? "编辑塑胶原料" : "新增塑胶原料"}
        width="sm:max-w-[780px]"
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
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {textField("物料编号", "物料编号")}
          {textField("物料名称", "物料名称")}
          {textField("物料类别", "类别")}
          {textField("规格", "规格")}
          {textField("颜色", "颜色")}
          {textField("商品名称", "商品名称")}
          {textField("单位", "单位")}
          {textField("产地", "产地")}
          {numField("每包重量", "每包重量")}
          {textField("仓位号", "仓位号")}
          {!priceHidden && numField("单价", "单价")}
          {!priceHidden && numField("销售价", "销售价")}
          {numField("起订量", "起订量")}
          {numField("安全库存", "安全库存")}
          {textField("供应商编号", "供应商编号")}
        </div>
        <label className="mt-3 block">
          <span className="f-label">备注</span>
          <textarea
            aria-label="备注"
            rows={2}
            className="f-input mt-1.5 h-auto w-full py-2"
            value={form.备注 ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, 备注: e.target.value }))}
          />
        </label>
      </PickerDialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`确认删除该塑胶原料${deleting?.物料编号 ? `(${deleting.物料编号})` : ""}?`}
        confirmLabel="删除"
        onConfirm={() => void del()}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
