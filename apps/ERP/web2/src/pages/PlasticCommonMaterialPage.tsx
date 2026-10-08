// 塑胶共用物料表(/plastic-common-materials)。对照老系统 web/src/pages/plastics/PlasticCommonMaterialPage.tsx:
// 筛选=客户/塑胶货号/工模编号/关键字/审核情况;双击行选中后 编辑/删除 对其生效;
// 新增/编辑弹窗:选模(工模表带回,无「单价」位跳过价格字段)/选料(回填名称/颜色)/
// 套数校验(=出模数÷用量)/二次加工类别推导提示(第二次加工内容联动);价格列按「单价」位显隐。
// 权限菜单=塑胶共用物料表(MenuCatalog.cs:44 实证:塑胶仓储组);功能位 打开/保存/删除/单价。
import { useCallback, useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Pencil, Plus, Prohibit, Trash } from "@phosphor-icons/react";
import { masterDataApi, plasticCommonMaterialApi } from "@/api/endpoints";
import type { PlasticCommonMaterialRow, PlasticMoldRow } from "@/api/types";
import { 二次加工字母, 二次加工类别后缀 } from "@/lib/secondProcess";
import {
  EMPTY_COMMON_FORM,
  commonFormToPayload,
  validate套数,
  价格字段,
  套数规则提示,
  type CommonFormState,
} from "@/lib/plasticCommonMaterial";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { PlasticMaterialPickerDialog } from "@/components/doc/PlasticMaterialPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import PlasticMoldPicker from "./PlasticMoldPicker";

const MENU = "塑胶共用物料表";
const ALL_APPROVAL = "全部";
const PAGE_SIZE = 50;

const crud = masterDataApi("plastic-common-materials");

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

// 表格列(对照老系统 columns 逐列;价格列按权限裁剪)
interface ColDef {
  title: string;
  key: keyof PlasticCommonMaterialRow;
  num?: boolean;
  price?: boolean;
}
const ALL_COLS: ColDef[] = [
  { title: "客户", key: "客户" },
  { title: "塑胶货号", key: "塑胶货号" },
  { title: "工模编号", key: "工模编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "颜色", key: "颜色" },
  { title: "色粉号", key: "色粉号" },
  { title: "用料名称", key: "用料名称" },
  { title: "加工内容", key: "加工内容" },
  { title: "加工单价", key: "加工单价", num: true, price: true },
  { title: "整啤净重", key: "整啤净重", num: true },
  { title: "原胶件单净重", key: "原胶件单净重", num: true },
  { title: "整啤模腔数", key: "整啤模腔数", num: true },
  { title: "套数", key: "套数", num: true },
  { title: "用量", key: "用量", num: true },
  { title: "出模数", key: "出模数", num: true },
  { title: "水口比例", key: "水口比例", num: true },
  { title: "整啤毛重", key: "整啤毛重", num: true },
  { title: "模具日产量", key: "模具日产量", num: true },
  { title: "啤机机型", key: "啤机机型" },
  { title: "啤机价钱", key: "啤机价钱", num: true, price: true },
  { title: "胶件啤工价", key: "胶件啤工价", num: true, price: true },
  { title: "胶料单价", key: "胶料单价", num: true, price: true },
  { title: "原胶料单价", key: "原胶料单价", num: true, price: true },
  { title: "加工总单价", key: "加工总单价", num: true, price: true },
  { title: "其它成本", key: "其它成本", num: true, price: true },
  { title: "二次加工内容", key: "二次加工内容" },
  { title: "物料编号", key: "物料编号" },
  { title: "共用原料编号", key: "共用原料编号" },
  { title: "审核", key: "调整审核" },
  { title: "备注内容", key: "备注内容" },
];

export default function PlasticCommonMaterialPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const priceHidden = !can(MENU, "单价");

  const [客户, set客户] = useState("");
  const [塑胶货号, set塑胶货号] = useState("");
  const [工模编号, set工模编号] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);
  const [applied, setApplied] = useState<{
    客户?: string;
    塑胶货号?: string;
    工模编号?: string;
    keyword?: string;
    审核情况?: string;
  }>({});

  const [rows, setRows] = useState<PlasticCommonMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<PlasticCommonMaterialRow | null>(null);

  const [editing, setEditing] = useState<PlasticCommonMaterialRow | null>(null);
  const [form, setForm] = useState<CommonFormState>(EMPTY_COMMON_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moldPickerOpen, setMoldPickerOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const loadRows = useCallback(
    async (p: number) => {
      if (!canOpen) return;
      setLoading(true);
      try {
        const r = await plasticCommonMaterialApi.list({ ...applied, page: p, size: PAGE_SIZE });
        setRows(r.items);
        setTotal(r.total);
        setSelRow(null);
      } catch (e) {
        setToast({ text: errMsg(e) || "加载塑胶共用物料失败", tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [canOpen, applied],
  );

  useEffect(() => {
    setPage(1);
    void loadRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, applied]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const search = () => {
    const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
    setApplied({
      客户: t(客户),
      塑胶货号: t(塑胶货号),
      工模编号: t(工模编号),
      keyword: t(kwInput),
      审核情况: 审核情况 === ALL_APPROVAL ? undefined : 审核情况,
    });
  };

  // 二次加工类别推导提示(对照老系统:BD=电镀+印喷,AF=印喷+植绒,AH=印喷+植发)
  const 类别后缀 = 二次加工类别后缀(form.加工内容, form.二次加工内容);
  const 类别提示 = 类别后缀
    ? `${类别后缀} 类(第一次 ${form.加工内容 ?? ""}=${二次加工字母(类别后缀, form.加工内容) ?? "?"},第二次 ${form.二次加工内容 ?? ""}=${二次加工字母(类别后缀, form.二次加工内容) ?? "?"})`
    : "";

  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    const init = {
      ...EMPTY_COMMON_FORM,
      塑胶货号: 塑胶货号.trim(),
      客户: 客户.trim(),
    };
    setEditing({ ID: 0 } as PlasticCommonMaterialRow);
    setForm(init);
  };

  const openEdit = async (r: PlasticCommonMaterialRow) => {
    try {
      const full = (await crud.get(r.ID)) as Record<string, unknown>;
      const next: CommonFormState = { ...EMPTY_COMMON_FORM };
      for (const k of Object.keys(next)) {
        const v = full[k];
        next[k] = v == null ? "" : String(v);
      }
      setEditing(r);
      setForm(next);
    } catch (e) {
      setToast({ text: errMsg(e) || "加载详情失败", tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    if (!form.塑胶货号.trim()) {
      setToast({ text: "请输入塑胶货号", tone: "err" });
      return;
    }
    const 套数Err = validate套数(form);
    if (套数Err) {
      setToast({ text: 套数Err, tone: "err" });
      return;
    }
    const body = commonFormToPayload(form);
    setSaving(true);
    try {
      if (editing.ID > 0) await crud.update(editing.ID, body);
      else await crud.create(body);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      setSelRow(null);
      await loadRows(page);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 工模联动:选中工模后带回对应字段(工模编号必带;价格字段在无单价权限时跳过)
  const applyMold = (m: PlasticMoldRow) => {
    const pairs: [string, unknown][] = [
      ["工模编号", m.工模编号],
      ["颜色", m.颜色],
      ["色粉号", m.色粉号],
      ["用料名称", m.用料名称],
      ["整啤模腔数", m.整啤模腔数],
      ["水口比例", m.水口比例],
      ["模具日产量", m.模具日产量],
      ["整啤毛重", m.整啤毛重],
      ["整啤净重", m.整啤净重],
      ["啤机机型", m.啤机机型],
      ["啤机价钱", m.啤机价钱],
      ["胶件啤工价", m.胶件啤工价],
      ["胶料单价", m.胶料单价],
      ["原胶料单价", m.原胶料单价],
    ];
    setForm((f) => {
      const next = { ...f };
      for (const [k, val] of pairs) {
        if (val == null || val === "") continue;
        if (priceHidden && 价格字段.has(k)) continue;
        next[k] = String(val);
      }
      return next;
    });
    setToast({ text: "已从工模表带回字段", tone: "ok" });
  };

  const del = async () => {
    if (!selRow) return;
    try {
      await crud.remove(selRow.ID);
      setToast({ text: "已删除", tone: "ok" });
      setDeleteOpen(false);
      setSelRow(null);
      await loadRows(page);
    } catch (e) {
      setToast({ text: errMsg(e) || "删除失败", tone: "err" });
    }
  };

  const cols = useMemo(() => ALL_COLS.filter((c) => !c.price || !priceHidden), [priceHidden]);
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶共用物料表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶共用物料表</h1>
      </div>

      {/* 筛选栏(对照老系统:客户/塑胶货号/工模编号/关键字/审核情况 + 查询/新增/编辑/删除) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-32 space-y-1.5">
          <label htmlFor="pcm-cust" className="f-label block">
            客户
          </label>
          <input
            id="pcm-cust"
            className="f-input"
            value={客户}
            onChange={(e) => set客户(e.target.value)}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <label htmlFor="pcm-style" className="f-label block">
            塑胶货号
          </label>
          <input
            id="pcm-style"
            className="f-input"
            value={塑胶货号}
            onChange={(e) => set塑胶货号(e.target.value)}
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label htmlFor="pcm-mold" className="f-label block">
            工模编号
          </label>
          <input
            id="pcm-mold"
            className="f-input"
            value={工模编号}
            onChange={(e) => set工模编号(e.target.value)}
          />
        </div>
        <div className="w-56 space-y-1.5">
          <label htmlFor="pcm-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="pcm-kw"
            className={inputCls}
            placeholder="物料编号/名称/用料/共用原料"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="f-label block">
            审核情况
          </label>
          <SearchSelect
            ariaLabel="审核情况"
            value={审核情况}
            options={[ALL_APPROVAL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set审核情况(v)}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        {canSave && (
          <button type="button" className="f-btn px-5" onClick={openCreate}>
            <Plus className="h-4.5 w-4.5" />
            新增
          </button>
        )}
        {canSave && (
          <button
            type="button"
            className="f-btn px-5"
            disabled={!selRow}
            onClick={() => selRow && void openEdit(selRow)}
          >
            <Pencil className="h-4.5 w-4.5" />
            编辑
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="f-btn px-5 text-[#dc2626]"
            disabled={!selRow}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash className="h-4.5 w-4.5" />
            删除
          </button>
        )}
        <span className={cn("text-sm", selRow ? "text-[#15803d]" : "text-[#5f6b7d]")}>
          {selRow ? `已选中:${selRow.物料编号 ?? ""}` : "双击行选中后可编辑/删除"}
        </span>
      </div>

      {/* 列表(双击选中高亮) */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table data-freeze className="w-full min-w-[2600px] text-sm">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.title} className={cn(thCls, c.num && "text-right")}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={cols.length} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    暂无数据
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.ID}
                    className={cn(
                      "cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]",
                      selRow?.ID === r.ID && "bg-[#16a34a]/8",
                    )}
                    onDoubleClick={() => setSelRow(r)}
                    title="双击选中后可编辑/删除"
                  >
                    {cols.map((c) => {
                      const v = r[c.key];
                      const text =
                        c.key === "调整审核"
                          ? v === "1"
                            ? "已审核"
                            : "未审核"
                          : c.price
                            ? money(v as number | null)
                            : ((v as string | number | null) ?? "");
                      return (
                        <td
                          key={c.title}
                          className={cn(
                            "px-3 py-2 whitespace-nowrap text-[#3d4a5c]",
                            c.num && "f-mono text-right",
                            c.key === "物料编号" && "f-mono text-[#1a2330]",
                          )}
                        >
                          {text === null ? "" : text}
                        </td>
                      );
                    })}
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

      {/* 新增/编辑弹窗(共享弹窗件;对照老系统 Modal 全字段) */}
      <PickerDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing && editing.ID > 0 ? "编辑共用物料" : "新增共用物料"}
        width="sm:max-w-[760px]"
        footer={
          <>
            <button type="button" className="f-btn px-5" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan px-5"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <label className="block">
            <span className="f-label">客户</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="客户"
              value={form.客户}
              onChange={(e) => setF("客户", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="f-label">塑胶货号 *</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="塑胶货号"
              value={form.塑胶货号}
              onChange={(e) => setF("塑胶货号", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="f-label">工模编号(点「选模」从工模表带回)</span>
            <div className="mt-1 flex gap-2">
              <Input
                className={inputCls}
                aria-label="工模编号"
                readOnly
                value={form.工模编号}
              />
              <button
                type="button"
                className="f-btn h-10 shrink-0 px-3.5 text-sm"
                onClick={() => setMoldPickerOpen(true)}
              >
                选模
              </button>
            </div>
          </label>
          <label className="block">
            <span className="f-label">物料编号(选料回填名称/颜色)</span>
            <div className="mt-1 flex gap-2">
              <Input
                className={inputCls}
                aria-label="物料编号"
                readOnly
                value={form.物料编号}
              />
              <button
                type="button"
                className="f-btn h-10 shrink-0 px-3.5 text-sm"
                onClick={() => setPickerOpen(true)}
              >
                选料
              </button>
            </div>
          </label>
          {(
            [
              ["物料名称", "物料名称"],
              ["颜色", "颜色"],
              ["色粉号", "色粉号"],
              ["用料名称", "用料名称"],
              ["加工内容", "加工内容"],
            ] as [string, string][]
          ).map(([label, k]) => (
            <label key={k} className="block">
              <span className="f-label">{label}</span>
              <Input
                className={cn(inputCls, "mt-1")}
                aria-label={label}
                value={form[k]}
                onChange={(e) => setF(k, e.target.value)}
              />
            </label>
          ))}
          {!priceHidden && (
            <label className="block">
              <span className="f-label">加工单价</span>
              <Input
                className={cn(inputCls, "mt-1")}
                aria-label="加工单价"
                type="number"
                min={0}
                value={form.加工单价}
                onChange={(e) => setF("加工单价", e.target.value)}
              />
            </label>
          )}
          {(
            [
              ["整啤净重", "整啤净重"],
              ["原胶件单净重", "原胶件单净重"],
              ["整啤模腔数", "整啤模腔数"],
              ["出模数", "出模数"],
              ["用量", "用量"],
            ] as [string, string][]
          ).map(([label, k]) => (
            <label key={k} className="block">
              <span className="f-label">{label}</span>
              <Input
                className={cn(inputCls, "mt-1")}
                aria-label={label}
                type="number"
                value={form[k]}
                onChange={(e) => setF(k, e.target.value)}
              />
            </label>
          ))}
          <label className="block">
            <span className="f-label">套数(须等于 出模数 ÷ 用量)</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="套数"
              type="number"
              value={form.套数}
              onChange={(e) => setF("套数", e.target.value)}
            />
            {validate套数(form) && (
              <span className="mt-1 block text-xs text-[#dc2626]">{套数规则提示}</span>
            )}
          </label>
          {(
            [
              ["水口比例", "水口比例"],
              ["整啤毛重", "整啤毛重"],
              ["模具日产量", "模具日产量"],
            ] as [string, string][]
          ).map(([label, k]) => (
            <label key={k} className="block">
              <span className="f-label">{label}</span>
              <Input
                className={cn(inputCls, "mt-1")}
                aria-label={label}
                type="number"
                value={form[k]}
                onChange={(e) => setF(k, e.target.value)}
              />
            </label>
          ))}
          <label className="block">
            <span className="f-label">啤机机型</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="啤机机型"
              value={form.啤机机型}
              onChange={(e) => setF("啤机机型", e.target.value)}
            />
          </label>
          {!priceHidden &&
            (
              [
                ["啤机价钱", "啤机价钱"],
                ["胶件啤工价", "胶件啤工价"],
                ["胶料单价", "胶料单价"],
                ["原胶料单价", "原胶料单价"],
                ["加工总单价", "加工总单价"],
                ["其它成本", "其它成本"],
              ] as [string, string][]
            ).map(([label, k]) => (
              <label key={k} className="block">
                <span className="f-label">{label}</span>
                <Input
                  className={cn(inputCls, "mt-1")}
                  aria-label={label}
                  type="number"
                  min={0}
                  value={form[k]}
                  onChange={(e) => setF(k, e.target.value)}
                />
              </label>
            ))}
          <label className="block">
            <span className="f-label">二次加工内容</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="二次加工内容"
              value={form.二次加工内容}
              onChange={(e) => setF("二次加工内容", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="f-label">二次加工类别(按 加工内容+二次加工内容 推导)</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="二次加工类别"
              readOnly
              value={类别提示}
              placeholder="非二次加工组合"
            />
          </label>
          <label className="block">
            <span className="f-label">共用原料编号</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="共用原料编号"
              value={form.共用原料编号}
              onChange={(e) => setF("共用原料编号", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="f-label">工模表备注</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="工模表备注"
              value={form.工模表备注}
              onChange={(e) => setF("工模表备注", e.target.value)}
            />
          </label>
          <label className="col-span-2 block">
            <span className="f-label">备注内容</span>
            <textarea
              className={cn(inputCls, "mt-1 h-auto min-h-14 w-full rounded-md border px-3 py-2")}
              rows={2}
              aria-label="备注内容"
              value={form.备注内容}
              onChange={(e) => setF("备注内容", e.target.value)}
            />
          </label>
        </div>
      </PickerDialog>

      <PlasticMaterialPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(r) =>
          setForm((f) => ({
            ...f,
            物料编号: r.物料编号 ?? "",
            物料名称: r.物料名称 ?? "",
            颜色: r.颜色 ?? "",
          }))
        }
      />
      <PlasticMoldPicker
        open={moldPickerOpen}
        onClose={() => setMoldPickerOpen(false)}
        onPick={applyMold}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`确认删除该行${selRow ? ` [${selRow.物料编号 ?? ""}]` : ""}?`}
        confirmLabel="删除"
        onConfirm={() => void del()}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
