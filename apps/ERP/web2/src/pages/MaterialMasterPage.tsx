// 物料资料(工程部;老系统 web/src/pages/materials/MaterialMasterPage.tsx 重写):
// 左类别树(新增同级/子类别) + 物料表(双击选中编辑/删除) + 新增/编辑弹窗
// (编号预填 next-code,仓库位置字典可输可选,价格字段按「单价」位脱敏,货币默认取功能设置)
// + 导入表格(MaterialImportModal) + 打印条码(BarcodePrintModal)。
// CRUD 走 /master/materials(masterDataApi),列表/建档走 /material-master(与老系统一致)。
import { useCallback, useEffect, useState } from "react";
import { Barcode, Pencil, Plus, Prohibit, Trash, UploadSimple } from "@phosphor-icons/react";
import { masterDataApi, materialMasterApi } from "@/api/endpoints";
import type { MasterMaterialRow, MasterRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { toDocCurrency, useFeatureSettings } from "@/lib/featureSettings";
import { MATERIAL_IMPORT_SPEC } from "@/lib/materialImport";
import { cn } from "@/lib/utils";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog } from "@/components/doc/PickerDialog";
import MaterialImportModal from "@/components/doc/MaterialImportModal";
import BarcodePrintModal from "@/components/doc/BarcodePrintModal";
import { CategoryTreePanel } from "@/components/doc/CategoryTreePanel";
import { ALL_CAT_KEY } from "@/lib/categoryTree";
import type { MaterialCategoryNode } from "@/api/types";

const MENU = "物料资料"; // MenuCatalog 实证:基础资料组
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;
const CAT_MENU = "物料类别"; // 类别树增删受「物料类别·保存」位控制
const PAGE_SIZE = 50;

const materialsCrud = masterDataApi("materials");
const materialCategories = masterDataApi("material-categories");
const warehouseLocations = masterDataApi("warehouse-locations");

const num = (v?: number | null) => v ?? "";

export default function MaterialMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const canCatSave = can(CAT_MENU, "保存");
  const priceHidden = !can(MENU, "单价");
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));
  const featureSettings = useFeatureSettings();

  const [cats, setCats] = useState<MaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL_CAT_KEY);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<MasterMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<MasterMaterialRow | null>(null);

  const [editing, setEditing] = useState<MasterMaterialRow | null>(null); // null=关;ID=0=新增
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  // 仓库位置字典(数据源:仓库位置表);可输入可选择,不强制字典值(兼容存量自由文本)
  const [locOptions, setLocOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    warehouseLocations
      .list(1, 200)
      .then((r) =>
        setLocOptions(
          r.items
            .filter((x) => typeof x.编号 === "string" && x.编号)
            .map((x) => ({
              value: x.编号 as string,
              label: `${x.编号}${x.名称 ? ` ${x.名称}` : ""}`,
            })),
        ),
      )
      .catch(() => setLocOptions([])); // 无字典权限等:仍可按自由文本录入
  }, []);

  const selInfo = useCallback((): { 类别?: string; 含子级: boolean } => {
    if (selKey === ALL_CAT_KEY) return { 含子级: false };
    // key=编号 或 ~名称;类别过滤值=name,含子级=有子节点
    const hit = cats.find((c) => (c.编号 ?? `~${c.类别 ?? ""}`) === selKey);
    if (!hit) return { 含子级: false };
    const hasChildren = cats.some((c) => c.父级 === hit.编号 && hit.编号 != null);
    return { 类别: hit.类别 ?? undefined, 含子级: hasChildren };
  }, [cats, selKey]);

  const loadCats = useCallback(async () => {
    try {
      setCats(await materialMasterApi.categories());
    } catch {
      /* 忽略 */
    }
  }, []);

  const loadRows = useCallback(
    async (p: number) => {
      if (!canOpen) return;
      setLoading(true);
      try {
        const { 类别, 含子级 } = selInfo();
        const r = await materialMasterApi.list(类别, keyword || undefined, p, PAGE_SIZE, undefined, 含子级);
        setRows(r.items);
        setTotal(r.total);
        setSelRow(null);
      } catch (e) {
        setToast({ text: errMsg(e, "加载物料失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [canOpen, selInfo, keyword],
  );

  useEffect(() => {
    if (canOpen) void loadCats();
  }, [canOpen, loadCats]);
  // 选中分类变化时重查(回到第1页);关键字由查询按钮显式触发
  useEffect(() => {
    setPage(1);
    void loadRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, selKey, keyword]);

  const openCreate = async () => {
    const { 类别 } = selInfo();
    const init: MasterMaterialRow = { ID: 0, 物料类别: 类别 };
    setEditing(init);
    // 功能设置消费:新增物料的货币默认取 系统.默认货币(HKD→HK$ 写法对齐单据沿用习惯)
    const base: Record<string, string> = {
      物料类别: 类别 ?? "",
      货币: toDocCurrency(featureSettings.默认货币),
    };
    setForm(base);
    try {
      setForm((f) => ({ ...f, 物料编号: "" }));
      const code = await materialMasterApi.nextCode(类别);
      setForm((f) => ({ ...f, 物料编号: code }));
    } catch {
      /* 预填失败可手输;留空保存时后端兜底生成 */
    }
  };

  const openEdit = async (r: MasterMaterialRow) => {
    try {
      const full = (await materialsCrud.get(r.ID!)) as MasterRow;
      setEditing(r);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(full)) v[k] = val == null ? "" : String(val);
      setForm(v);
    } catch (e) {
      setToast({ text: errMsg(e, "加载物料详情失败"), tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      // 数值列空串转 undefined,避免后端收到 ""(单价/销售价)
      for (const k of ["单价", "销售价"]) {
        if (body[k] === "") delete body[k];
        else if (body[k] != null) body[k] = Number(body[k]);
      }
      if ((editing.ID ?? 0) > 0) await materialsCrud.update(editing.ID!, body);
      else await materialMasterApi.create(body); // 编号留空由后端自动生成
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
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
      await materialsCrud.remove(selRow.ID!);
      setToast({ text: "已删除", tone: "ok" });
      setSelRow(null);
      await loadCats();
      await loadRows(page);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "删除失败", tone: "err" });
    }
  };

  // 类别落库:编号 与 名称 同值;父级引用(类别列)指向父类别编号,物料资料.物料类别 用名称过滤
  const createCat = async (name: string, parent: string | null) => {
    try {
      await materialCategories.create({ 编号: name, 名称: name, 类别: parent ?? undefined });
      setToast({ text: "类别已保存", tone: "ok" });
      await loadCats();
      return true;
    } catch (e) {
      setToast({ text: errMsg(e, "类别保存失败"), tone: "err" });
      return false;
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问物料资料"
            description="缺少「物料资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const editField = (name: string, label: string, numeric = false) => (
    <label key={name} className="block">
      <span className="f-label">{label}</span>
      <input
        aria-label={label}
        type={numeric ? "number" : "text"}
        min={numeric ? 0 : undefined}
        className="f-input f-input-slim mt-1.5"
        value={form[name] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
      />
    </label>
  );

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">物料资料</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索物料"
            className="f-input f-input-slim w-64"
            placeholder="物料编号/名称/规格/颜色/供应商"
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
              onClick={() => void openCreate()}
            >
              <Plus className="h-4 w-4" />
              新增
            </button>
          )}
          {canSave && (
            <button type="button" className="f-btn h-9 px-4 text-sm" onClick={() => setImportOpen(true)}>
              <UploadSimple className="h-4 w-4" />
              导入表格
            </button>
          )}
          <button type="button" className="f-btn h-9 px-4 text-sm" onClick={() => setPrintOpen(true)}>
            <Barcode className="h-4 w-4" />
            打印条码
          </button>
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
              ? `已选中:${selRow.物料编号} ${selRow.物料名称 ?? ""}`
              : "双击行选中后可编辑/删除"}
          </span>
        </div>
      </div>

      <div className="f-panel flex gap-3 p-4">
        <CategoryTreePanel
          cats={cats}
          allLabel="全部物料"
          selKey={selKey}
          onSelect={setSelKey}
          canEditCat={canCatSave}
          onCreateCat={createCat}
        />

        <div className="min-w-0 flex-1">
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 1080 }}>
              <thead>
                <tr>
                  {[
                    "物料编号", "物料名称", "类别", "规格", "颜色", "单位",
                    "单价", "销售价", "库存", "最低库存", "供应商", "备注",
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
                    <td colSpan={12} className="px-4 py-10 text-center text-disabled">
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
                      <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap">{r.物料编号}</td>
                      <td className="max-w-44 truncate px-3 py-2" title={r.物料名称}>{r.物料名称}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.物料类别 ?? ""}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.规格 ?? ""}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.颜色 ?? ""}</td>
                      <td className="px-3 py-2">{r.单位 ?? ""}</td>
                      <td className="f-mono px-3 py-2 text-right">{money(r.单价)}</td>
                      <td className="f-mono px-3 py-2 text-right">{money(r.销售价)}</td>
                      <td className="f-mono px-3 py-2 text-right">{num(r.库存)}</td>
                      <td className="f-mono px-3 py-2 text-right">{num(r.最低库存)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.供应商名称 ?? ""}</td>
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

      {/* 新增/编辑物料 */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && (editing.ID ?? 0) > 0 ? "编辑物料" : "新增物料"}
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
          <label className="block">
            <span className="f-label">物料编号(留空则保存时自动生成)</span>
            <input
              aria-label="物料编号"
              className="f-input f-input-slim mt-1.5"
              placeholder="自动生成,可修改"
              value={form.物料编号 ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, 物料编号: e.target.value }))}
            />
          </label>
          {editField("物料名称", "物料名称")}
          {editField("物料类别", "类别")}
          {editField("规格", "规格")}
          {editField("颜色", "颜色")}
          {editField("单位", "单位")}
          <label className="block">
            <span className="f-label">仓库位置(可从字典选择,也可自由输入)</span>
            <input
              aria-label="仓库位置"
              className="f-input f-input-slim mt-1.5"
              list="wh-loc-options"
              value={form.仓库位置 ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, 仓库位置: e.target.value }))}
            />
            <datalist id="wh-loc-options">
              {locOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </datalist>
          </label>
          {!priceHidden && editField("单价", "单价", true)}
          {!priceHidden && editField("销售价", "销售价", true)}
          {editField("供应商编号", "供应商编号")}
          <label className="col-span-2 block">
            <span className="f-label">备注</span>
            <textarea
              aria-label="备注"
              rows={2}
              className="f-input mt-1.5 h-auto w-full py-2"
              value={form.备注 ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, 备注: e.target.value }))}
            />
          </label>
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={`确认删除${selRow ? ` ${selRow.物料编号} ${selRow.物料名称 ?? ""}` : ""}?`}
        onConfirm={() => {
          setDelOpen(false);
          void del();
        }}
      />

      <MaterialImportModal
        open={importOpen}
        title="导入物料表格"
        spec={MATERIAL_IMPORT_SPEC}
        onImport={(rows) => materialMasterApi.importRows(rows)}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          void loadCats();
          setPage(1);
          void loadRows(1);
        }}
      />
      <BarcodePrintModal open={printOpen} onClose={() => setPrintOpen(false)} />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
