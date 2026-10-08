// 补料单(补料区;/replenishments)。对照老系统 web/src/pages/replenishment/ReplenishmentPage.tsx:
// 装配开单(必选 PMC 负责人 + 部门,部门选项来自部门信息) -> 通知所选部门人员/仓管/PMC ->
// 审核(不扣库存,补料只是采购申请) -> 审核后知会该 PMC 与部门 -> 采购订单可从已审核补料单带入
// (web2 采购订单页「从补料单带入」已实现,见 PurchaseOrderPage);
// 扣库存走 采购入库->领料单。权限菜单=补料单(MenuCatalog 实证:补料管理组)。
// ReplenishmentPickerModal(采购订单侧带入弹窗)已在首批随 PurchaseOrderPage 落地,不在本页重复。
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  FilePlus,
  MagnifyingGlass,
  Plus,
  Prohibit,
  Trash,
} from "@phosphor-icons/react";
import {
  employeesApi,
  masterDataApi,
  materialMasterApi,
  productionApi,
  productionReportApi,
  replenishmentApi,
} from "@/api/endpoints";
import type {
  IssueBasisRow,
  MasterRow,
  ReplenishmentDetail,
  ReplenishmentHeader,
} from "@/api/types";
import { fmtNum, txt } from "@/lib/format";
import { invalidateCrossPage } from "@/lib/crossPage";
import { validateReplenishment, type ReplenishDraftLine } from "@/lib/replenishment";
import { usePerms } from "@/hooks/usePerms";
import { useTableDensity } from "@/hooks/useTableDensity";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DensitySwitch } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "补料单";
const PAGE_SIZE = 20;
const 仓库选项 = ["来料仓", "塑胶仓"];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

let rowSeq = 1;
const uid = () => rowSeq++;

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- 新建补料单弹窗(对照老系统 CreateDrawer:单头 + 明细行编辑 + 按生产单带出物料) ----------

interface HeaderFormState {
  日期: string;
  部门: string;
  仓库: string;
  生产单号: string;
  款号: string;
  PMC: string;
  备注: string;
}

function CreateDialog({
  open,
  onClose,
  onSaved,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (text: string, tone: "ok" | "err") => void;
}) {
  const [form, setFormState] = useState<HeaderFormState>({
    日期: today(),
    部门: "",
    仓库: "来料仓",
    生产单号: "",
    款号: "",
    PMC: "",
    备注: "",
  });
  const [lines, setLines] = useState<ReplenishDraftLine[]>([]);
  const [selKeys, setSelKeys] = useState<number[]>([]);
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [matKw, setMatKw] = useState("");
  const [prodOpen, setProdOpen] = useState(false);
  const [prodKw, setProdKw] = useState("");
  const [basisOpen, setBasisOpen] = useState(false);
  const [basisLoading, setBasisLoading] = useState(false);
  const [basisRows, setBasisRows] = useState<IssueBasisRow[]>([]);
  const [basisSel, setBasisSel] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));

  // 部门选项:部门信息表;默认部门优先 装配部,否则第一个部门(对照老系统)
  const deptQuery = useQuery({
    queryKey: ["replenishment", "departments"],
    queryFn: () => masterDataApi("departments").list(1, 500),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const deptOptions = useMemo(
    () =>
      (deptQuery.data?.items ?? ([] as MasterRow[]))
        .map((x) => String(x.部门 ?? "").trim())
        .filter(Boolean),
    [deptQuery.data],
  );
  useEffect(() => {
    if (!open || form.部门 || deptOptions.length === 0) return;
    setForm({ 部门: deptOptions.includes("装配部") ? "装配部" : deptOptions[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deptOptions]);

  // PMC 选项:人事档案中 职称='PMC' 的人员姓名(对照老系统;加载失败仍可手输)
  const pmcQuery = useQuery({
    queryKey: ["replenishment", "pmc"],
    queryFn: () => employeesApi.list(1, 500, ""),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const pmcOptions = useMemo(
    () =>
      (pmcQuery.data?.items ?? [])
        .filter((x) => x.职称 === "PMC" && x.姓名)
        .map((x) => String(x.姓名)),
    [pmcQuery.data],
  );

  const materialsQuery = useQuery({
    queryKey: ["replenishment", "materials", matKw],
    queryFn: () => materialMasterApi.list(undefined, matKw || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: matPickFor !== null,
  });

  const prodQuery = useQuery({
    queryKey: ["replenishment", "productions", prodKw],
    queryFn: () => productionReportApi.tracking(prodKw || undefined, "1"),
    placeholderData: keepPreviousData,
    enabled: prodOpen,
  });

  const setLine = (key: number, patch: Partial<ReplenishDraftLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const nextKey = () => lines.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  // 按生产单带出物料:调入 issue-basis BOM 应领明细(档跟随仓库:塑胶仓->塑胶,否则->来料),默认不勾
  const basisKey = (r: IssueBasisRow, i: number) =>
    `${r.物料编号 ?? ""}|${r.规格 ?? ""}|${r.颜色 ?? ""}|${i}`;
  const openIssueBasisPick = async () => {
    const no = form.生产单号.trim();
    if (!no) {
      onToast("请先填写生产单号", "err");
      return;
    }
    const 档 = form.仓库.includes("塑胶") ? "塑胶" : "来料";
    setBasisLoading(true);
    try {
      const rows = (await productionApi.issueBasis(no, 档, false)).filter((r) => !!r.物料编号);
      if (rows.length === 0) {
        onToast(`生产单 ${no} 无${form.仓库}应领明细`, "err");
        return;
      }
      setBasisRows(rows);
      setBasisSel([]); // 默认一个都不勾
      setBasisOpen(true);
    } catch (e) {
      onToast(errMsg(e) || "按生产单带出物料失败", "err");
    } finally {
      setBasisLoading(false);
    }
  };

  // 确定带入:只带勾选行,数量默认 0 让手填
  const confirmIssueBasisPick = () => {
    const picked = basisRows.filter((r, i) => basisSel.includes(basisKey(r, i)));
    if (picked.length === 0) {
      onToast("请先勾选要补的物料", "err");
      return;
    }
    let k = nextKey();
    const mapped: ReplenishDraftLine[] = picked.map((r) => ({
      key: k++,
      物料编号: r.物料编号 ?? "",
      物料名称: r.物料名称 ?? null,
      规格: r.规格 ?? null,
      颜色: r.颜色 ?? null,
      单位: r.单位 ?? null,
      数量: 0,
      备注: "",
    }));
    setLines((prev) => [...prev.filter((l) => l.物料编号.trim()), ...mapped]);
    if (picked[0].款号 && !form.款号) setForm({ 款号: picked[0].款号 });
    onToast(`已带入 ${mapped.length} 行(数量请手填)`, "ok");
    setBasisOpen(false);
  };

  const save = async () => {
    if (!form.部门.trim()) {
      onToast("请选择部门", "err");
      return;
    }
    if (!form.PMC.trim()) {
      onToast("请选择PMC", "err");
      return;
    }
    const issue = validateReplenishment({ 仓库: form.仓库, 明细: lines });
    if (issue) {
      onToast(issue, "err");
      return;
    }
    setSaving(true);
    try {
      const valid = lines.filter((l) => l.物料编号.trim());
      const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
      const r = await replenishmentApi.create({
        日期: form.日期 || today(),
        部门: t(form.部门),
        生产单号: t(form.生产单号),
        款号: t(form.款号),
        仓库: form.仓库,
        PMC: t(form.PMC),
        备注: t(form.备注),
        明细: valid.map((l) => ({
          物料编号: l.物料编号.trim(),
          物料名称: l.物料名称 ?? undefined,
          规格: l.规格 ?? undefined,
          颜色: l.颜色 ?? undefined,
          单位: l.单位 ?? undefined,
          数量: Number(l.数量),
          备注: l.备注?.trim() || undefined,
        })),
      });
      onToast(`补料单 ${r.单号} 已保存(已通知${form.部门 || "部门"}、仓管与 PMC,待 PMC 审核)`, "ok");
      onSaved();
    } catch (e) {
      onToast(errMsg(e) || "保存失败", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title="新建补料单"
      width="sm:max-w-[1080px]"
      footer={
        <>
          <span className="mr-auto text-sm text-[#5f6b7d]">
            保存后知会仓管与所选 PMC,审核后由该 PMC 安排采购(补料不扣库存,采购入库后开领料单才扣
            {form.仓库 === "塑胶仓" ? "塑胶仓" : "来料仓"}库存)
          </span>
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-5 text-sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      }
    >
      {/* 单头 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="日期">
          <Input
            type="date"
            className={inputCls}
            aria-label="日期"
            value={form.日期}
            onChange={(e) => setForm({ 日期: e.target.value })}
          />
        </FormField>
        <FormField label="部门">
          <div className="relative">
            <SearchSelect
              ariaLabel="部门"
              className={cn(inputCls, "rounded-md border")}
              value={form.部门}
              options={deptOptions.map((v) => ({ value: v, label: v }))}
              placeholder="请选择部门"
              clearLabel="请选择部门"
              onChange={(v) => setForm({ 部门: v })}
            />
            <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-[#dc2626]">
              *
            </span>
          </div>
        </FormField>
        <FormField label="仓库">
          <div className="relative">
            <SearchSelect
              ariaLabel="仓库"
              className={cn(inputCls, "rounded-md border")}
              value={form.仓库}
              options={仓库选项.map((v) => ({ value: v, label: v }))}
              onChange={(v) => setForm({ 仓库: v })}
            />
            <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-[#dc2626]">
              *
            </span>
          </div>
        </FormField>
        <FormField label="生产单号">
          <div className="flex items-center gap-1">
            <Input
              className={inputCls}
              aria-label="生产单号"
              value={form.生产单号}
              onChange={(e) => setForm({ 生产单号: e.target.value })}
            />
            <button
              type="button"
              aria-label="生产单号选择"
              className="f-btn h-10 shrink-0 px-3 text-sm"
              onClick={() => {
                setProdKw("");
                setProdOpen(true);
              }}
            >
              选
            </button>
          </div>
        </FormField>
        <FormField label="款号">
          <Input
            className={inputCls}
            aria-label="款号"
            value={form.款号}
            onChange={(e) => setForm({ 款号: e.target.value })}
          />
        </FormField>
        <FormField label="PMC">
          <div className="relative">
            <SearchSelect
              ariaLabel="PMC"
              className={cn(inputCls, "rounded-md border")}
              value={form.PMC}
              options={pmcOptions.map((v) => ({ value: v, label: v }))}
              placeholder="请选择PMC"
              clearLabel="请选择PMC"
              onChange={(v) => setForm({ PMC: v })}
            />
            <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-[#dc2626]">
              *
            </span>
          </div>
        </FormField>
        <FormField label="备注">
          <Input
            className={inputCls}
            aria-label="备注"
            value={form.备注}
            onChange={(e) => setForm({ 备注: e.target.value })}
          />
        </FormField>
      </div>

      {/* 明细行编辑 */}
      <div className="mt-4 overflow-hidden rounded-xl border border-black/8">
        <div className="flex items-center justify-between border-b border-black/8 bg-black/[0.02] px-4 py-2.5">
          <div className="flex gap-2">
            <button
              type="button"
              className="f-btn h-9 px-3.5 text-sm"
              onClick={() =>
                setLines((v) => [...v, { key: nextKey() || uid(), 物料编号: "", 数量: 0, 备注: "" }])
              }
            >
              <Plus className="h-4 w-4" />
              加一行
            </button>
            <button
              type="button"
              className="f-btn h-9 px-3.5 text-sm text-[#dc2626]"
              disabled={selKeys.length === 0}
              onClick={() => {
                const drop = new Set(selKeys);
                setLines((v) => v.filter((l) => !drop.has(l.key)));
                setSelKeys([]);
              }}
            >
              <Trash className="h-4 w-4" />
              删除选中
            </button>
            <button
              type="button"
              className="f-btn h-9 px-3.5 text-sm"
              disabled={basisLoading}
              onClick={() => void openIssueBasisPick()}
            >
              {basisLoading ? "调入中..." : "按生产单带出物料"}
            </button>
          </div>
          <span className="text-sm text-[#5f6b7d]">数量默认 0 需手填;空白物料编号行保存时丢弃</span>
        </div>
        <div className="max-h-[38vh] overflow-auto">
          <table className="w-full min-w-[900px] text-[15px]">
            <thead>
              <tr>
                <th className={cn(pickerThCls, "w-10 text-center")}>选</th>
                {["物料编号", "物料名称", "规格", "颜色", "单位", "数量", "备注", "操作"].map((h) => (
                  <th
                    key={h}
                    className={cn(pickerThCls, h === "数量" && "text-right", h === "操作" && "text-center")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-disabled">
                    还没有明细行,点「加一行」手选物料,或「按生产单带出物料」勾选要补的物料
                  </td>
                </tr>
              ) : (
                lines.map((r) => (
                  <tr key={r.key} className="border-b border-black/6 last:border-0">
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`选择行 ${r.物料编号 || r.key}`}
                        checked={selKeys.includes(r.key)}
                        onChange={(e) =>
                          setSelKeys((ks) =>
                            e.target.checked ? [...ks, r.key] : ks.filter((k) => k !== r.key),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Input
                          className={cn(inputCls, "h-9 w-32")}
                          aria-label="物料编号"
                          value={r.物料编号}
                          onChange={(e) => setLine(r.key, { 物料编号: e.target.value })}
                        />
                        <button
                          type="button"
                          aria-label="物料编号选择"
                          className="f-btn h-9 shrink-0 px-2 text-xs"
                          onClick={() => {
                            setMatKw("");
                            setMatPickFor(r.key);
                          }}
                        >
                          选
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色 ?? ""}</td>
                    <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        aria-label="数量"
                        className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                        value={r.数量}
                        onChange={(e) => setLine(r.key, { 数量: Number(e.target.value || 0) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className={cn(inputCls, "h-9 w-32")}
                        aria-label="行备注"
                        value={r.备注 ?? ""}
                        onChange={(e) => setLine(r.key, { 备注: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        aria-label="删除明细行"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#dc2626] transition-colors hover:bg-[#dc2626]/10"
                        onClick={() => setLines((v) => v.filter((x) => x.key !== r.key))}
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 选择物料 */}
      <PickerDialog
        open={matPickFor !== null}
        onClose={() => setMatPickFor(null)}
        title="选择物料"
        width="sm:max-w-[860px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMatKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="物料编号/名称/规格/颜色/供应商" aria-label="物料搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["物料编号", "物料名称", "规格", "材料", "颜色", "单位", "库存"].map((h) => (
                <th key={h} className={cn(pickerThCls, h === "库存" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(materialsQuery.data?.items ?? []).map((m, i) => (
              <tr
                key={m.ID ?? i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  if (matPickFor === null) return;
                  setLine(matPickFor, {
                    物料编号: m.物料编号 ?? "",
                    物料名称: m.物料名称 ?? null,
                    规格: m.规格 ?? null,
                    颜色: m.颜色 ?? null,
                    单位: m.单位 ?? null,
                  });
                  setMatPickFor(null);
                }}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{m.物料编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.物料名称}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.规格}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.物料类别}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.颜色}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.单位}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{m.库存 ?? ""}</td>
              </tr>
            ))}
            {materialsQuery.isSuccess && (materialsQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 选择生产制单(仅列已审核;回填 生产单号/款号) */}
      <PickerDialog
        open={prodOpen}
        onClose={() => setProdOpen(false)}
        title="选择生产制单(仅列已审核)"
        width="sm:max-w-[860px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setProdKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input name="kw" className={inputCls} placeholder="生产单号/款号/款式/客户" aria-label="生产单搜索" />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["生产单号", "款号", "款式", "客户名称", "计划数量", "交货日期"].map((h) => (
                <th key={h} className={cn(pickerThCls, h === "计划数量" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(prodQuery.data ?? []).map((p, i) => (
              <tr
                key={`${p.生产单号}-${i}`}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  setForm({ 生产单号: p.生产单号 ?? "", 款号: p.款号 ?? "" });
                  setProdOpen(false);
                }}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{p.生产单号}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{p.款号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.款式}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.客户名称}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{p.计划数量 ?? ""}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{date10(p.交货日期)}</td>
              </tr>
            ))}
            {prodQuery.isSuccess && (prodQuery.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的生产制单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 按生产单带出物料:勾选要补的物料(默认不勾),数量带入后手填 */}
      <PickerDialog
        open={basisOpen}
        onClose={() => setBasisOpen(false)}
        title="按生产单带出物料 · 勾选要补的物料"
        width="sm:max-w-[920px]"
        footer={
          <>
            <span className="mr-auto text-sm text-[#5f6b7d]">
              已选 {basisSel.length} / 共 {basisRows.length} 行;带入后数量在明细表里手填
            </span>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-5 text-sm"
              disabled={basisSel.length === 0}
              onClick={confirmIssueBasisPick}
            >
              确定带入
            </button>
          </>
        }
      >
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              <th className={cn(pickerThCls, "w-10 text-center")}>选</th>
              {["物料编号", "物料名称", "规格", "颜色", "单位", "应领数量"].map((h) => (
                <th key={h} className={cn(pickerThCls, h === "应领数量" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {basisRows.map((r, i) => {
              const k = basisKey(r, i);
              const checked = basisSel.includes(k);
              return (
                <tr
                  key={k}
                  className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                  onClick={() =>
                    setBasisSel((sel) => (checked ? sel.filter((x) => x !== k) : [...sel, k]))
                  }
                >
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${r.物料编号}`}
                      checked={checked}
                      onChange={() =>
                        setBasisSel((sel) => (checked ? sel.filter((x) => x !== k) : [...sel, k]))
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.物料编号}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色 ?? ""}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                  <td className="f-mono px-3 py-2 text-right font-semibold text-[#1a2330]">{r.数量}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PickerDialog>
    </PickerDialog>
  );
}

// ---------- 补料单明细弹窗(查看整单) ----------

function DetailDialog({ detail, onClose }: { detail: ReplenishmentDetail | null; onClose: () => void }) {
  const h = detail?.单头;
  return (
    <PickerDialog
      open={detail !== null}
      onClose={onClose}
      title={`补料单明细 ${h?.单号 ?? ""}`}
      width="sm:max-w-[860px]"
    >
      {h && (
        <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
          {[
            ["日期", date10(h.日期)],
            ["部门", h.部门 ?? ""],
            ["仓库", h.仓库 ?? ""],
            ["生产单号", h.生产单号 ?? ""],
            ["款号", h.款号 ?? ""],
            ["状态", h.审核 === "1" ? "已审核" : "未审核"],
            ["操作员", h.操作员 ?? ""],
            ["PMC", h.PMC ?? ""],
            ["审核人", h.审核人 ?? ""],
            ["备注", h.备注 ?? ""],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2 text-sm">
              <span className="f-label shrink-0">{k}</span>
              <span className="text-[#1a2330]">{v || "-"}</span>
            </div>
          ))}
        </div>
      )}
      <table className="w-full text-[15px]">
        <thead>
          <tr>
            {["物料编号", "物料名称", "规格", "颜色", "单位", "数量", "备注"].map((x) => (
              <th key={x} className={cn(pickerThCls, x === "数量" && "text-right")}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(detail?.明细 ?? []).map((l, i) => (
            <tr key={l.ID ?? i} className="border-b border-black/6 last:border-0">
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{txt(l.物料编号)}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.规格)}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
              <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{l.数量 ?? ""}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.备注)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PickerDialog>
  );
}

// ---------- 页面 ----------

export default function ReplenishmentPage() {
  const qc = useQueryClient();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canDelete = can(MENU, "删除");
  const canAudit = can(MENU, "审核");
  const { density } = useTableDensity();
  const rowH = density === "compact" ? "h-8" : density === "relaxed" ? "h-12" : "h-10";

  const [page, setPage] = useState(1);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [auditFilter, setAuditFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailNo, setDetailNo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { type: "audit"; row: ReplenishmentHeader }
    | { type: "reverse"; row: ReplenishmentHeader }
    | { type: "delete"; row: ReplenishmentHeader }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = (text: string, tone: "ok" | "err") => setToast({ text, tone });

  // 消息中心跳入:URL ?doc=单号 直接打开该单明细弹窗(渲染期消费,effect 清参;同 MaterialIssuePage ?doc= 模式)
  const [searchParams, setSearchParams] = useSearchParams();
  const docParam = searchParams.get("doc");
  if (docParam && docParam !== detailNo) setDetailNo(docParam);
  useEffect(() => {
    if (!docParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("doc");
    setSearchParams(next, { replace: true });
  }, [docParam, searchParams, setSearchParams]);

  const listQuery = useQuery({
    queryKey: ["replenishments", "list", page, keyword, auditFilter],
    queryFn: () => replenishmentApi.list(page, PAGE_SIZE, keyword, auditFilter || undefined),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading,
  });
  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const detailQuery = useQuery({
    queryKey: ["replenishments", "detail", detailNo],
    queryFn: () => replenishmentApi.get(detailNo!),
    enabled: !permsLoading && canOpen && detailNo !== null,
  });

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["replenishments"] });
    invalidateCrossPage(qc);
  };

  const doConfirm = async () => {
    if (!confirm) return;
    const no = confirm.row.单号;
    if (!no) return;
    setBusy(true);
    try {
      if (confirm.type === "audit") {
        await replenishmentApi.audit(no);
        notify("已审核(已通知所选 PMC 安排采购)", "ok");
      } else if (confirm.type === "reverse") {
        await replenishmentApi.reverseAudit(no);
        notify("已反审核", "ok");
      } else {
        await replenishmentApi.remove(no);
        notify("已删除", "ok");
      }
      setConfirm(null);
      reload();
    } catch (e) {
      notify(errMsg(e) || (confirm.type === "delete" ? "删除失败" : confirm.type === "audit" ? "审核失败" : "反审核失败"), "err");
    } finally {
      setBusy(false);
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「补料单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">补料单</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏 */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-72 space-y-1.5">
          <label htmlFor="repl-kw" className="f-label block">
            关键字
          </label>
          <input
            id="repl-kw"
            className="f-input"
            placeholder="单号 / 部门 / 生产单号 / 款号 / 备注"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                setKeyword(kwInput.trim());
              }
            }}
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="f-label block">
            审核状态
          </label>
          <SearchSelect
            ariaLabel="审核状态"
            value={auditFilter}
            options={[
              { value: "已审核", label: "已审核" },
              { value: "未审核", label: "未审核" },
            ]}
            placeholder="全部"
            clearLabel="全部"
            onChange={(v) => {
              setPage(1);
              setAuditFilter(v);
            }}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => {
            setPage(1);
            setKeyword(kwInput.trim());
          }}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button type="button" className="f-btn px-5" onClick={() => listQuery.refetch()}>
          <ArrowClockwise className="h-4.5 w-4.5" />
          刷新
        </button>
        {canSave && (
          <button type="button" className="f-btn f-btn-cyan px-5" onClick={() => setCreateOpen(true)}>
            <FilePlus className="h-4.5 w-4.5" />
            新建补料单
          </button>
        )}
      </div>

      {/* 列表(服务端分页 20/页,对照老系统) */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        {listQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full bg-black/5" />
            ))}
          </div>
        ) : listQuery.isError ? (
          <div className="p-6">
            <DocError message="加载补料单失败,请重试" onRetry={() => listQuery.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <DocEmpty title="暂无补料单" description="点「新建补料单」开一张,或调整筛选条件" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table data-freeze className="w-full min-w-[1500px] text-[15px]">
              <thead className="sticky top-0 z-10 border-b border-black/8 bg-white">
                <tr>
                  {[
                    "单号", "日期", "部门", "生产单号", "款号", "仓库", "数量",
                    "操作员", "PMC", "状态", "采购", "审核人", "备注", "操作",
                  ].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        "f-label px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                        h === "数量" && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const audited = r.审核 === "1";
                  return (
                    <tr key={r.单号} className={cn("border-b border-black/6 last:border-0", rowH)}>
                      <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => r.单号 && setDetailNo(r.单号)}
                        >
                          {r.单号}
                        </button>
                      </td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{date10(r.日期)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.部门)}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.生产单号)}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.款号)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.仓库)}</td>
                      <td className="f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]">
                        {fmtNum(r.数量, 0)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.操作员)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.PMC)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {audited ? (
                          <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
                            已审核
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
                            未审核
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.已采购 === "1" && (
                          <span className="inline-flex rounded-full border border-[#2563eb]/40 bg-[#2563eb]/10 px-2.5 py-1 text-xs font-semibold text-[#2563eb]">
                            已采购
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.审核人)}</td>
                      <td className="max-w-40 truncate px-3 py-2 text-[#3d4a5c]" title={r.备注 ?? ""}>
                        {txt(r.备注)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex gap-2 text-sm">
                          <button
                            type="button"
                            className="text-[#15803d] hover:underline"
                            onClick={() => r.单号 && setDetailNo(r.单号)}
                          >
                            明细
                          </button>
                          {canAudit && !audited && (
                            <button
                              type="button"
                              className="text-[#059669] hover:underline"
                              onClick={() => setConfirm({ type: "audit", row: r })}
                            >
                              审核
                            </button>
                          )}
                          {canAudit && audited && (
                            <button
                              type="button"
                              className="text-[#3d4a5c] hover:underline"
                              onClick={() => setConfirm({ type: "reverse", row: r })}
                            >
                              反审核
                            </button>
                          )}
                          {canDelete && !audited && (
                            <button
                              type="button"
                              className="text-[#dc2626] hover:underline"
                              onClick={() => setConfirm({ type: "delete", row: r })}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!listQuery.isLoading && !listQuery.isError && rows.length > 0 && (
          <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
            <span>共 {total} 条,第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <CaretLeft className="h-4 w-4" />
                上一页
              </button>
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
                <CaretRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 新建 */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          setPage(1);
          reload();
        }}
        onToast={notify}
      />

      {/* 明细 */}
      <DetailDialog
        detail={detailNo === null ? null : (detailQuery.data ?? null)}
        onClose={() => setDetailNo(null)}
      />

      {/* 审核/反审核/删除确认(文案对照老系统 Popconfirm) */}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm?.type === "audit"
            ? `审核后补料单将发送给 PMC「${confirm.row.PMC ?? "未指定"}」安排采购(不扣库存,待采购入库后开领料单才扣),确认审核?`
            : confirm?.type === "reverse"
              ? "确认反审核该补料单?"
              : "确认删除该补料单?"
        }
        description={confirm ? `单号:${confirm.row.单号 ?? ""}` : undefined}
        confirmLabel={
          busy ? "处理中..." : confirm?.type === "audit" ? "确认审核" : confirm?.type === "reverse" ? "确认反审核" : "确认删除"
        }
        onConfirm={() => void doConfirm()}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
