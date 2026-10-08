// 塑胶物料资料(塑胶仓/工程部;老系统 web/src/pages/plastics/PlasticMaterialMasterPage.tsx 重写):
// 左类别树 + 28 列固定表头(顺序不可变;塑胶货号=款号,原胶件单价=单价) + 勾选多选批量删除
// + 新增先弹工模选择器(工模带出字段:原料单价 ← 工模.胶料单价) + 从BOM选料建档
// + 编辑/删除 + 导入表格。CRUD 走 /master/plastic-materials,列表走 /plastic-material-master。
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Prohibit, Trash, UploadSimple } from "@phosphor-icons/react";
import { masterDataApi, plasticMaterialMasterApi, stylesApi } from "@/api/endpoints";
import type {
  PlasticMaterialCategoryNode,
  PlasticMaterialRow,
  PlasticMoldRow,
  StyleBomLine,
} from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { toDocCurrency, useFeatureSettings } from "@/lib/featureSettings";
import { PLASTIC_IMPORT_SPEC } from "@/lib/materialImport";
import { cn } from "@/lib/utils";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import MaterialImportModal from "@/components/doc/MaterialImportModal";
import { CategoryTreePanel } from "@/components/doc/CategoryTreePanel";
import { ALL_CAT_KEY } from "@/lib/categoryTree";
import { Checkbox } from "@/components/ui/checkbox";
import PlasticMoldPicker from "./PlasticMoldPicker";

const MENU = "塑胶物料资料"; // MenuCatalog 实证:塑胶仓储组
const PAGE_SIZE = 50;
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

const plasticMaterials = masterDataApi("plastic-materials");
const plasticMaterialCategories = masterDataApi("plastic-material-categories");

// 说明书 2-2:工模带出的字段(原料单价 ← 工模.胶料单价)
const moldFieldsOf = (m: PlasticMoldRow): Record<string, unknown> => ({
  工模编号: m.工模编号,
  颜色: m.颜色,
  色粉号: m.色粉号,
  用料名称: m.用料名称,
  啤机机型: m.啤机机型,
  整啤模腔数: m.整啤模腔数 ?? null,
  水口比例: m.水口比例 ?? null,
  模具日产量: m.模具日产量 ?? null,
  整啤毛重: m.整啤毛重 ?? null,
  整啤净重: m.整啤净重 ?? null,
  啤机价钱: m.啤机价钱 ?? null,
  胶件啤工价: m.胶件啤工价 ?? null,
  原料单价: m.胶料单价 ?? null,
  原胶料单价: m.原胶料单价 ?? null,
});

const num = (v?: number | null) => v ?? "";

// 数值表单字段(编辑弹窗「工模资料/重量与用量/价格」段)
const NUM_FIELDS = new Set([
  "单价", "销售价", "二次加工价", "加工总单价", "其他成本", "整啤毛重", "整啤净重",
  "原胶件单净重", "整啤模腔数", "套数", "出模数", "用量", "水口比例", "模具日产量",
  "啤机价钱", "胶件啤工价", "原料单价", "胶件料价", "原胶料单价",
]);

export default function PlasticMaterialMasterPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const priceHidden = !can(MENU, "单价");
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));
  const featureSettings = useFeatureSettings();

  const [cats, setCats] = useState<PlasticMaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL_CAT_KEY);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<PlasticMaterialRow | null>(null);
  const [selIds, setSelIds] = useState<number[]>([]); // 勾选多选(批量删除)

  const [editing, setEditing] = useState<PlasticMaterialRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 从 BOM 选料建档:选款号 → 挑 BOM 行 → 带出编号/名称/规格/颜色/单位
  const [bomPickOpen, setBomPickOpen] = useState(false);
  const [bomKw, setBomKw] = useState("");
  const [bomKwInput, setBomKwInput] = useState("");
  const [bomRows, setBomRows] = useState<StyleBomLine[]>([]);
  const [bom客户, setBom客户] = useState("");
  const [bomLoading, setBomLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const selInfo = useCallback((): { 类别?: string; 含子级: boolean } => {
    if (selKey === ALL_CAT_KEY) return { 含子级: false };
    const hit = cats.find((c) => (c.编号 ?? `~${c.类别 ?? ""}`) === selKey);
    if (!hit) return { 含子级: false };
    const hasChildren = cats.some((c) => c.父级 === hit.编号 && hit.编号 != null);
    return { 类别: hit.类别 ?? undefined, 含子级: hasChildren };
  }, [cats, selKey]);

  const loadCats = useCallback(async () => {
    try {
      setCats(await plasticMaterialMasterApi.categories());
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
        const r = await plasticMaterialMasterApi.list(
          类别,
          keyword || undefined,
          p,
          PAGE_SIZE,
          undefined,
          含子级,
        );
        setRows(r.items);
        setTotal(r.total);
        setSelRow(null);
        setSelIds([]);
      } catch (e) {
        setToast({ text: errMsg(e, "加载塑胶物料失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [canOpen, selInfo, keyword],
  );

  useEffect(() => {
    if (canOpen) void loadCats();
  }, [canOpen, loadCats]);
  useEffect(() => {
    setPage(1);
    void loadRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, selKey, keyword]);

  // 类别落库:编号 与 名称 同值;父级引用(类别列)指向父类别编号
  const createCat = async (name: string, parent: string | null) => {
    try {
      await plasticMaterialCategories.create({ 编号: name, 名称: name, 类别: parent ?? undefined });
      setToast({ text: "类别已保存", tone: "ok" });
      await loadCats();
      return true;
    } catch (e) {
      setToast({ text: errMsg(e, "类别保存失败"), tone: "err" });
      return false;
    }
  };

  // 新增:先弹工模选择器;编辑中的「重选工模」只覆盖工模字段,手动字段保留
  const openCreate = () => setPickerOpen(true);

  // 从 BOM 选料:载入指定款号的 BOM 明细,点行带出基本资料(工模字段之后可再「重选工模」补)
  const openBomPick = () => {
    setBomKw("");
    setBomKwInput("");
    setBomRows([]);
    setBom客户("");
    setBomPickOpen(true);
  };
  const loadBomRows = async (款号: string) => {
    const kw = 款号.trim();
    if (!kw) return;
    setBomLoading(true);
    try {
      const v = await stylesApi.materials(kw);
      setBomKw(kw);
      setBomRows(v.物料 ?? []);
      setBom客户(v.单头?.客户名称 ?? "");
    } catch (e) {
      setToast({ text: errMsg(e, `加载款号 ${kw} 的 BOM 失败`), tone: "err" });
      setBomRows([]);
    } finally {
      setBomLoading(false);
    }
  };
  const onBomRowPicked = (r: StyleBomLine) => {
    if (!r.物料编号) {
      setToast({ text: "该行没有物料编号", tone: "err" });
      return;
    }
    const { 类别 } = selInfo();
    const init: PlasticMaterialRow = {
      ID: 0,
      物料类别: 类别,
      单位: r.单位 ?? "个",
      物料编号: r.物料编号,
      款号: bomKw,
      物料名称: r.物料名称 ?? undefined,
      规格: r.规格 ?? undefined,
      颜色: r.颜色 ?? undefined,
      客户: bom客户 || undefined,
      用量: r.使用数量 ?? null,
    };
    setEditing(init);
    const v: Record<string, string> = {};
    for (const [k, val] of Object.entries(init)) v[k] = val == null ? "" : String(val);
    setForm({ ...v, 货币: toDocCurrency(featureSettings.默认货币) });
    setBomPickOpen(false);
  };

  const onMoldPicked = (m: PlasticMoldRow) => {
    const moldFields = moldFieldsOf(m);
    if (editing) {
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(moldFields)) v[k] = val == null ? "" : String(val);
      setForm((f) => ({ ...f, ...v }));
      return;
    }
    const { 类别 } = selInfo();
    const init: PlasticMaterialRow = { ID: 0, 物料类别: 类别, 单位: "个" };
    setEditing(init);
    const v: Record<string, string> = { 物料类别: 类别 ?? "", 单位: "个" };
    for (const [k, val] of Object.entries(moldFields)) v[k] = val == null ? "" : String(val);
    setForm({ ...v, 货币: toDocCurrency(featureSettings.默认货币) });
  };

  const openEdit = async (r: PlasticMaterialRow) => {
    try {
      const full = await plasticMaterials.get(r.ID!);
      setEditing(r);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(full)) v[k] = val == null ? "" : String(val);
      setForm(v);
    } catch (e) {
      setToast({ text: errMsg(e, "加载塑胶物料详情失败"), tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      for (const k of Object.keys(body)) {
        if (!NUM_FIELDS.has(k)) continue;
        if (body[k] === "") delete body[k];
        else if (body[k] != null) body[k] = Number(body[k]);
      }
      if ((editing.ID ?? 0) > 0) await plasticMaterials.update(editing.ID!, body);
      else await plasticMaterials.create(body);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      await loadCats();
      await loadRows(page);
    } catch (e) {
      setToast({ text: errMsg(e, "保存失败"), tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 批量删除:勾选了走勾选集,否则走双击选中行
  const delSelected = async () => {
    const ids = selIds.length > 0 ? selIds : selRow ? [selRow.ID!] : [];
    if (!ids.length) return;
    let ok = 0;
    try {
      for (const id of ids) {
        await plasticMaterials.remove(id);
        ok++;
      }
      setToast({ text: ids.length > 1 ? `已删除 ${ok} 条` : "已删除", tone: "ok" });
    } catch (e) {
      setToast({ text: errMsg(e, `删除中断:已删 ${ok}/${ids.length} 条`), tone: "err" });
    } finally {
      await loadCats();
      await loadRows(page);
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问塑胶物料资料"
            description="缺少「塑胶物料资料·打开」权限,请联系管理员开通"
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

  // 旧系统固定表头(28 列,顺序不可变)
  const COLUMNS: { title: string; key: keyof PlasticMaterialRow; money?: boolean; num?: boolean }[] = [
    { title: "物料编号", key: "物料编号" },
    { title: "客户", key: "客户" },
    { title: "塑胶货号", key: "款号" },
    { title: "工模编号", key: "工模编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "颜色", key: "颜色" },
    { title: "色粉号", key: "色粉号" },
    { title: "原料名称", key: "原料名称" },
    { title: "用料名称", key: "用料名称" },
    { title: "加工内容", key: "加工内容" },
    { title: "加工总单价(HKD)", key: "加工总单价", money: true },
    { title: "二次加工", key: "二次加工" },
    { title: "二次加工价", key: "二次加工价", money: true },
    { title: "整啤净重", key: "整啤净重", num: true },
    { title: "原胶件单净重", key: "原胶件单净重", num: true },
    { title: "整啤模腔数", key: "整啤模腔数", num: true },
    { title: "套数", key: "套数", num: true },
    { title: "出模数", key: "出模数", num: true },
    { title: "用量", key: "用量", num: true },
    { title: "啤机机型", key: "啤机机型" },
    { title: "模具日产量", key: "模具日产量", num: true },
    { title: "啤机价钱", key: "啤机价钱", money: true },
    { title: "胶件啤工价", key: "胶件啤工价", money: true },
    { title: "原料单价", key: "原料单价", money: true },
    { title: "胶件料价", key: "胶件料价", money: true },
    { title: "原胶件单价", key: "单价", money: true },
    { title: "备注", key: "备注" },
    { title: "其他成本", key: "其他成本", money: true },
  ];

  const allChecked = rows.length > 0 && selIds.length === rows.length;

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶物料资料</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索塑胶物料"
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
            <button type="button" className="f-btn f-btn-cyan h-9 px-4 text-sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增
            </button>
          )}
          {canSave && (
            <button type="button" className="f-btn h-9 px-4 text-sm" onClick={openBomPick}>
              <Plus className="h-4 w-4" />
              从BOM选料
            </button>
          )}
          {canSave && (
            <button type="button" className="f-btn h-9 px-4 text-sm" onClick={() => setImportOpen(true)}>
              <UploadSimple className="h-4 w-4" />
              导入表格
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
              disabled={!selRow && selIds.length === 0}
              onClick={() => setDelOpen(true)}
            >
              <Trash className="h-4 w-4" />
              删除{selIds.length > 0 ? `(${selIds.length})` : ""}
            </button>
          )}
          <span className={cn("text-xs", selRow ? "text-[#1d4ed8]" : "text-disabled")}>
            {selRow
              ? `已选中:${selRow.物料编号} ${selRow.物料名称 ?? ""}`
              : "双击行选中后可编辑/删除;勾选可多选删除"}
          </span>
        </div>
      </div>

      <div className="f-panel flex gap-3 p-4">
        <CategoryTreePanel
          cats={cats}
          allLabel="全部塑胶物料"
          selKey={selKey}
          onSelect={setSelKey}
          canEditCat={canSave}
          onCreateCat={createCat}
        />

        <div className="min-w-0 flex-1">
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 2400 }}>
              <thead>
                <tr>
                  <th
                    className="f-label sticky top-0 z-10 w-10 border-b border-black/8 bg-white px-3 py-2.5"
                  >
                    <Checkbox
                      aria-label="全选"
                      className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                      checked={allChecked}
                      onCheckedChange={(v) =>
                        setSelIds(v === true ? rows.map((r) => r.ID!) : [])
                      }
                    />
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.title}
                      className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case"
                    >
                      {c.title}
                    </th>
                  ))}
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
                    <tr
                      key={r.ID}
                      className={cn(
                        "cursor-pointer border-b border-black/6 hover:bg-black/[0.04]",
                        selRow?.ID === r.ID && "bg-[#2563eb]/8",
                      )}
                      onDoubleClick={() => setSelRow(r)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`勾选 ${r.物料编号}`}
                          className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                          checked={selIds.includes(r.ID!)}
                          onCheckedChange={(v) =>
                            setSelIds((ids) =>
                              v === true ? [...ids, r.ID!] : ids.filter((x) => x !== r.ID),
                            )
                          }
                        />
                      </td>
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
                              {num(v as number | null | undefined)}
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

      {/* 新增/编辑塑胶物料 */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && (editing.ID ?? 0) > 0 ? "编辑塑胶物料" : "新增塑胶物料"}
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
        <div className="space-y-4">
          <section>
            <div className="f-label mb-2">基本资料</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              {textField("物料编号", "物料编号")}
              {textField("款号", "塑胶货号")}
              {textField("物料名称", "物料名称")}
              {textField("客户", "客户")}
              {textField("物料类别", "类别")}
              {textField("规格", "规格")}
              {textField("加工内容", "加工内容")}
              {textField("二次加工", "二次加工")}
              {textField("原料名称", "原料名称")}
              {textField("单位", "单位")}
              {textField("仓位号", "仓位号")}
              {textField("供应商编号", "供应商编号")}
            </div>
          </section>
          <section>
            <div className="f-label mb-2">工模资料</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <div>
                <span className="f-label">工模编号</span>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    aria-label="工模编号"
                    readOnly
                    placeholder="点右侧按钮选择工模"
                    className="f-input f-input-slim"
                    value={form.工模编号 ?? ""}
                  />
                  <button
                    type="button"
                    className="f-btn h-9 shrink-0 px-3 text-sm"
                    onClick={() => setPickerOpen(true)}
                  >
                    重选工模
                  </button>
                </div>
              </div>
              {textField("颜色", "颜色")}
              {textField("色粉号", "色粉号")}
              {textField("用料名称", "用料名称")}
              {textField("啤机机型", "啤机机型")}
              {numField("整啤模腔数", "整啤模腔数")}
              {numField("水口比例", "水口比例")}
              {numField("模具日产量", "模具日产量")}
            </div>
          </section>
          <section>
            <div className="f-label mb-2">重量与用量</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              {numField("整啤毛重", "整啤毛重")}
              {numField("整啤净重", "整啤净重")}
              {numField("原胶件单净重", "原胶件单净重")}
              {numField("出模数", "出模数")}
              {numField("用量", "用量")}
              {numField("套数", "套数")}
            </div>
          </section>
          {!priceHidden && (
            <section>
              <div className="f-label mb-2">价格</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                {numField("单价", "单价")}
                {numField("销售价", "销售价")}
                {numField("啤机价钱", "啤机价钱")}
                {numField("胶件啤工价", "胶件啤工价")}
                {numField("原料单价", "原料单价")}
                {numField("胶件料价", "胶件料价")}
                {numField("原胶料单价", "原胶料单价")}
                {numField("二次加工价", "二次加工价")}
                {numField("加工总单价", "加工总单价")}
                {numField("其他成本", "其他成本")}
              </div>
            </section>
          )}
          <label className="block">
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

      {/* 从 BOM 选料 */}
      <PickerDialog
        open={bomPickOpen}
        onClose={() => setBomPickOpen(false)}
        title="从 BOM 选料(选款号 → 点行带出物料)"
        width="sm:max-w-[860px]"
      >
        <div className="mb-3 flex items-center gap-2">
          <input
            aria-label="BOM款号"
            className="f-input f-input-slim w-72"
            placeholder="输入款号(如 92125-MA)"
            value={bomKwInput}
            onChange={(e) => setBomKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void loadBomRows(bomKwInput)}
          />
          <button
            type="button"
            className="f-btn h-9 px-4 text-sm"
            disabled={bomLoading}
            onClick={() => void loadBomRows(bomKwInput)}
          >
            载入
          </button>
          {bom客户 && <span className="text-xs text-disabled">客户:{bom客户}</span>}
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                {["物料编号", "物料名称", "物料类别", "规格", "颜色", "单位", "使用数量"].map((h) => (
                  <th key={h} className={pickerThCls}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bomRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-disabled">
                    {bomLoading ? "加载中..." : "输入款号载入 BOM,点击行建档"}
                  </td>
                </tr>
              ) : (
                bomRows.map((r) => (
                  <tr
                    key={`${r.物料编号}|${r.颜色 ?? ""}`}
                    className="cursor-pointer border-b border-black/6 hover:bg-black/[0.04]"
                    onClick={() => onBomRowPicked(r)}
                  >
                    <td className="f-mono px-3 py-2 font-semibold text-[#1d4ed8]">{r.物料编号}</td>
                    <td className="px-3 py-2">{r.物料名称 ?? ""}</td>
                    <td className="px-3 py-2">{r.物料类别 ?? ""}</td>
                    <td className="px-3 py-2">{r.规格 ?? ""}</td>
                    <td className="px-3 py-2">{r.颜色 ?? ""}</td>
                    <td className="px-3 py-2">{r.单位 ?? ""}</td>
                    <td className="f-mono px-3 py-2 text-right">{r.使用数量 ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={
          selIds.length > 1
            ? `确认删除勾选的 ${selIds.length} 条物料?`
            : `确认删除${selRow ? ` ${selRow.物料编号} ${selRow.物料名称 ?? ""}` : "选中物料"}?`
        }
        onConfirm={() => {
          setDelOpen(false);
          void delSelected();
        }}
      />

      <PlasticMoldPicker
        open={pickerOpen}
        onPick={onMoldPicked}
        onClose={() => setPickerOpen(false)}
      />

      <MaterialImportModal
        open={importOpen}
        title="导入塑胶物料表格"
        spec={PLASTIC_IMPORT_SPEC}
        onImport={(rows) => plasticMaterialMasterApi.importRows(rows)}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          void loadCats();
          setPage(1);
          void loadRows(1);
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
