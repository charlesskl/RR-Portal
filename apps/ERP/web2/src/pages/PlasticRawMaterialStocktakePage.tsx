// 原料盘点单(/plastic-raw-material-stocktake;单据+查询双页签)。对照老系统:
// web/src/pages/plastics/PlasticRawMaterialStocktakePage.tsx(单据)
// + PlasticRawMaterialStocktakeQueryPage.tsx(查询,默认汇总)
// + PlasticRawMaterialStocktakeQueryDetailDrawer.tsx(双击明细行弹单据详情)。
// 单据:新建/打开/保存(POST create)/审核(=盘点过账校准库存)/反审核/删除/打印;打开后查看模式;
// 选原料新行带出 原料名称/产地/每包重量/单位/系统数量(=当前库存);盈亏数量=盘点-系统(负红正绿)。
// 权限菜单:单据「原料盘点单」/查询「原料盘点查询」(MenuCatalog.cs:74/87 实证)。
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowCounterClockwise,
  CheckCircle,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Plus,
  Printer,
  Prohibit,
  Trash,
  X,
} from "@phosphor-icons/react";
import { plasticRawMaterialMasterApi, rawStocktakeApi } from "@/api/endpoints";
import type { PlasticRawMaterialRow, RSTHeader, RSTLine } from "@/api/types";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  date10,
  errMsg,
  nextRowKey,
  printRawDoc,
  today,
  type RawDocPrintCfg,
} from "@/lib/rawDocs";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { RawMaterialPickerDialog } from "@/components/doc/RawMaterialPickerDialog";
import { PlasticDocQueryPanel, type PlasticDocQueryCfg, type PlasticQueryCol } from "./PlasticDocQueryPanel";

const MENU = "原料盘点单";
const currentUser = () => getUser() || "admin";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

interface EditLine extends RSTLine {
  key: number;
}

// ---------- 查询页签配置(列序逐字对照老系统 StocktakeQueryPage + DetailDrawer) ----------

const QUERY_CFG: PlasticDocQueryCfg = {
  queryKey: "raw-stocktake-query",
  menu: "原料盘点查询",
  title: "原料盘点查询",
  keywordPlaceholder: "原料/单号/备注",
  defaultTab: "summary",
  fetchCategories: () => plasticRawMaterialMasterApi.categories(),
  fetchDetail: (q) => rawStocktakeApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchSummary: (q) => rawStocktakeApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: (): PlasticQueryCol[] => [
    { title: "原料编号", key: "原料编号", kind: "doc", size: 10 },
    { title: "原料名称", key: "原料名称", size: 16 },
    { title: "产地", key: "产地", size: 9 },
    { title: "单位", key: "单位", size: 6 },
    { title: "系统数", key: "系统数", kind: "num", size: 8 },
    { title: "盘点数", key: "盘点数", kind: "num", size: 8 },
    { title: "盈亏数", key: "盈亏数", kind: "num", size: 8 },
  ],
  detailCols: (): PlasticQueryCol[] => [
    { title: "日期", key: "日期", kind: "date", size: 8 },
    { title: "单号", key: "单号", kind: "doc", size: 10 },
    { title: "原料编号", key: "原料编号", kind: "doc", size: 9 },
    { title: "原料名称", key: "原料名称", size: 14 },
    { title: "产地", key: "产地", size: 8 },
    { title: "单位", key: "单位", size: 5 },
    { title: "系统数量", key: "系统数量", kind: "num", size: 7 },
    { title: "盘点数量", key: "盘点数量", kind: "num", size: 7 },
    { title: "盈亏数量", key: "盈亏数量", kind: "num", size: 7 },
    { title: "备注", key: "备注", size: 9 },
    { title: "审核", key: "审核", kind: "audit", size: 6 },
  ],
  drawerTitle: "原料盘点单",
  fetchDoc: (单号) => rawStocktakeApi.get(单号) as never,
  drawerHead: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["电脑单号", "电脑单号"],
    ["操作员", "操作员"],
    ["审核", "审核"],
    ["备注", "备注"],
  ],
  drawerCols: (): PlasticQueryCol[] => [
    { title: "原料编号", key: "原料编号", kind: "mono" },
    { title: "原料名称", key: "原料名称" },
    { title: "产地", key: "产地" },
    { title: "每包重量", key: "每包重量", kind: "num" },
    { title: "单位", key: "单位" },
    { title: "系统数量", key: "系统数量", kind: "num" },
    { title: "盘点数量", key: "盘点数量", kind: "num" },
    { title: "盈亏数量", key: "盈亏数量", kind: "num" },
    { title: "备注", key: "备注" },
  ],
};

// ---------- 打印规格 ----------

const PRINT_CFG: RawDocPrintCfg = {
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["电脑单号", "电脑单号"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["原料编号", "原料编号"],
    ["原料名称", "原料名称"],
    ["产地", "产地"],
    ["每包重量", "每包重量"],
    ["单位", "单位"],
    ["系统数量", "系统数量"],
    ["盘点数量", "盘点数量"],
    ["盈亏数量", "盈亏数量"],
    ["备注", "备注"],
  ],
};

// ---------- 打开单据弹窗列(对照老系统 listColumns) ----------

const openCol = createColumnHelper<RSTHeader>();
const listColumns: ColumnDef<RSTHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 22,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 15,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("操作员", { header: "操作员", size: 12 }),
  openCol.accessor("备注", { header: "备注", size: 20 }),
  openCol.accessor("审核", {
    header: "状态",
    size: 13,
    cell: (c) =>
      c.getValue() === "1" ? (
        <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
          已审核
        </span>
      ) : (
        <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
          未审核
        </span>
      ),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

// 盈亏单元格(负红正绿;对照老系统 diff 与合计的配色口径)
const DiffText = ({ d }: { d: number }) => (
  <span
    className={cn(
      "f-mono",
      d < 0 ? "text-[#dc2626]" : d > 0 ? "text-[#15803d]" : "text-[#1a2330]",
    )}
  >
    {d}
  </span>
);

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export default function PlasticRawMaterialStocktakePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [opened, setOpened] = useState<{ 单头?: RSTHeader; 明细: RSTLine[] } | null>(null);
  const [form, setFormState] = useState({ 电脑单号: "", 备注: "" });
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  const header = opened?.单头 ?? null;
  const audited = header?.审核 === "1";
  const readOnly = opened !== null;
  const 单号 = header?.单号 ?? "";

  const applyDetail = useCallback((d: { 单头?: RSTHeader; 明细: RSTLine[] }) => {
    const h = d.单头 ?? ({} as RSTHeader);
    setFormState({ 电脑单号: h.电脑单号 ?? "", 备注: h.备注 ?? "" });
    setLines((d.明细 ?? []).map((x) => ({ ...x, key: nextRowKey() })));
    setOpened(d);
    setTab("doc");
  }, []);

  const openDoc = useCallback(
    async (no: string) => {
      setBusy(true);
      try {
        applyDetail(await rawStocktakeApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开原料盘点单失败", "err");
      } finally {
        setBusy(false);
      }
    },
    [applyDetail, notify],
  );

  // ?open=<单号> 直开
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const [consumedOpen, setConsumedOpen] = useState<string | null>(null);
  if (openParam && openParam !== consumedOpen) {
    setConsumedOpen(openParam);
    void openDoc(openParam);
  }
  useEffect(() => {
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("open");
    setSearchParams(next, { replace: true });
  }, [openParam, searchParams, setSearchParams]);

  const reset = () => {
    setFormState({ 电脑单号: "", 备注: "" });
    setOpened(null);
    setLines([]);
  };

  const save = async () => {
    if (readOnly || busy) return;
    const ok = lines.filter((l) => l.原料编号);
    if (ok.length === 0) {
      notify("请至少录入一行有效明细(原料编号)", "err");
      return;
    }
    setBusy(true);
    try {
      await rawStocktakeApi.create({
        ...form,
        日期: today(),
        操作员: currentUser(),
        明细: ok.map(({ key: _key, ...l }) => ({
          ...l,
          盈亏数量: Number(l.盘点数量 ?? 0) - Number(l.系统数量 ?? 0),
        })),
      });
      notify("原料盘点单已创建", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["raw-stocktake"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "创建失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (!单号) return;
    setBusy(true);
    try {
      await fn();
      notify(ok, "ok");
      applyDetail(await rawStocktakeApi.get(单号));
      void qc.invalidateQueries({ queryKey: ["raw-stocktake"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "操作失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!单号) return;
    setBusy(true);
    try {
      await rawStocktakeApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["raw-stocktake"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (key: number, patch: Partial<EditLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const 系统合计 = lines.reduce((s, l) => s + Number(l.系统数量 ?? 0), 0);
  const 盘点合计 = lines.reduce((s, l) => s + Number(l.盘点数量 ?? 0), 0);
  const 盈亏合计 = 盘点合计 - 系统合计;

  const listQuery = useQuery({
    queryKey: ["raw-stocktake", "list", page, keyword],
    queryFn: () => rawStocktakeApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printRawDoc(
      `原料盘点单 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 日期: header?.日期 ?? today(), 操作员: header?.操作员 ?? currentUser() },
        明细: lines.map((l) => ({
          ...l,
          盈亏数量: Number(l.盘点数量 ?? 0) - Number(l.系统数量 ?? 0),
        })) as unknown as Record<string, unknown>[],
      },
      PRINT_CFG,
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
  ];
  const auditActions: DocAction[] = [
    // 审核=盘点过账校准库存(对照老系统提示「已审核·库存已校准」)
    { key: "audit", label: "审核", icon: CheckCircle, perm: "审核", success: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => void act(() => rawStocktakeApi.approve(单号), "已审核·库存已校准") },
    { key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true, disabled: !opened || !audited || busy, disabledTitle: !opened ? "先打开单据" : "单据未审核", onClick: () => void act(() => rawStocktakeApi.unapprove(单号), "已反审核") },
  ];
  const tailActions: DocAction[] = [
    { key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint },
    { key: "close", label: "关闭", icon: X, danger: true, disabled: busy, onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")) },
  ];

  if (!permsLoading && !canOpen && tab === "doc") {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料盘点单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          原料盘点单{tab === "doc" && (readOnly ? ` · ${单号}` : "(新建)")}
        </h1>
        {tab === "doc" && opened && (
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold",
              audited
                ? "border-[#16a34a]/60 bg-[#16a34a]/10 text-[#15803d]"
                : "border-black/10 bg-black/5 text-[#5f6b7d]",
            )}
          >
            {audited ? "已审核" : "未审核"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: "原料盘点单" },
              { key: "query" as const, label: "原料盘点查询" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "h-9 rounded-lg px-4 text-sm transition-colors",
                  tab === t.key
                    ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                    : "text-[#5f6b7d] hover:text-[#3d4a5c]",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "doc" && <FlowSteps steps={["开单", "审核过账"]} current={audited ? 1 : 0} />}
        </div>
      </div>

      {tab === "query" ? (
        <PlasticDocQueryPanel cfg={QUERY_CFG} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={auditActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={tailActions} menuKey={MENU} />
          </div>

          {/* 单头表单(对照老系统 Form) */}
          <div className="f-panel p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
              <FormField label="日期">
                <Input className={inputCls} aria-label="日期" disabled value={date10(header?.日期) || today()} />
              </FormField>
              <FormField label="电脑单号">
                <Input
                  className={inputCls}
                  aria-label="电脑单号"
                  disabled={readOnly}
                  value={form.电脑单号}
                  onChange={(e) => setFormState((f) => ({ ...f, 电脑单号: e.target.value }))}
                />
              </FormField>
              <FormField label="操作员">
                <Input className={inputCls} aria-label="操作员" disabled value={header?.操作员 ?? currentUser()} />
              </FormField>
              <FormField label="备注">
                <Input
                  className={inputCls}
                  aria-label="备注"
                  disabled={readOnly}
                  value={form.备注}
                  onChange={(e) => setFormState((f) => ({ ...f, 备注: e.target.value }))}
                />
              </FormField>
            </div>
          </div>

          {/* 明细(对照老系统 PlasticRawMaterialStocktakeLineTable 列序) */}
          <div className="f-panel overflow-hidden">
            <div className="border-b border-black/8 px-4 py-2.5">
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={readOnly}
                onClick={() => setLines((v) => [...v, { key: nextRowKey(), 系统数量: 0, 盘点数量: 0 }])}
              >
                <Plus className="h-4 w-4" />
                加一行
              </button>
            </div>
            <div className="max-h-[40vh] overflow-auto">
              <table data-freeze className="w-full min-w-[1150px] text-[15px]">
                <thead>
                  <tr className="border-b border-black/8">
                    {["原料编号", "原料名称", "产地", "每包重量", "单位", "系统数量", "盘点数量", "盈亏数量", "备注", "删除"].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                          ["每包重量", "系统数量", "盘点数量", "盈亏数量"].includes(h) && "text-right",
                          h === "删除" && "text-center",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const diff = Number(l.盘点数量 ?? 0) - Number(l.系统数量 ?? 0);
                    return (
                      <tr key={l.key} className="border-b border-black/6 last:border-0">
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              className={cn(cellInputCls, "f-mono")}
                              aria-label="原料编号"
                              disabled={readOnly}
                              value={l.原料编号 ?? ""}
                              onChange={(e) => updateLine(l.key, { 原料编号: e.target.value })}
                            />
                            {!readOnly && (
                              <button
                                type="button"
                                aria-label="选原料"
                                className="f-btn h-8 shrink-0 px-2 text-xs"
                                onClick={() => setMatPickFor(l.key)}
                              >
                                选
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.原料名称 ?? ""}</td>
                        <td className="px-2 py-1.5">
                          {readOnly ? (
                            <span className="text-[#3d4a5c]">{l.产地 ?? ""}</span>
                          ) : (
                            <input
                              className={cellInputCls}
                              aria-label="产地"
                              value={l.产地 ?? ""}
                              onChange={(e) => updateLine(l.key, { 产地: e.target.value })}
                            />
                          )}
                        </td>
                        <td className="f-mono px-3 py-1.5 text-right text-[#1a2330]">{l.每包重量 ?? ""}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.单位 ?? ""}</td>
                        <td className="f-mono px-3 py-1.5 text-right text-[#1a2330]">{l.系统数量 ?? ""}</td>
                        <td className="px-2 py-1.5">
                          {readOnly ? (
                            <span className="f-mono block text-right text-[#1a2330]">{l.盘点数量 ?? 0}</span>
                          ) : (
                            <input
                              className={cn(cellInputCls, "f-mono text-right")}
                              aria-label="盘点数量"
                              type="number"
                              min={0}
                              value={l.盘点数量 ?? 0}
                              onChange={(e) => updateLine(l.key, { 盘点数量: Number(e.target.value || 0) })}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <DiffText d={diff} />
                        </td>
                        <td className="px-2 py-1.5">
                          {readOnly ? (
                            <span className="text-[#3d4a5c]">{l.备注 ?? ""}</span>
                          ) : (
                            <input
                              className={cellInputCls}
                              aria-label="行备注"
                              value={l.备注 ?? ""}
                              onChange={(e) => updateLine(l.key, { 备注: e.target.value })}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            type="button"
                            aria-label="删除明细"
                            disabled={readOnly}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#dc2626] transition-colors hover:bg-[#dc2626]/10"
                            onClick={() => setLines((v) => v.filter((y) => y.key !== l.key))}
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-sm text-disabled">
                        点「加一行」录入,原料编号可手输或点「选」从原料资料带出(带系统数量)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 合计(对照老系统 Statistic) */}
            <div className="flex gap-10 border-t border-black/8 px-4 py-3">
              <span className="text-sm text-[#5f6b7d]">
                系统数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{系统合计.toFixed(2)}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                盘点数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{盘点合计.toFixed(2)}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                盈亏数量合计:
                <span
                  className={cn(
                    "f-mono text-base font-bold",
                    盈亏合计 < 0 ? "text-[#dc2626]" : 盈亏合计 > 0 ? "text-[#15803d]" : "text-[#1a2330]",
                  )}
                >
                  {盈亏合计.toFixed(2)}
                </span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                制单人:<span className="text-base font-bold text-[#1a2330]">{header?.操作员 ?? currentUser()}</span>
              </span>
            </div>
          </div>
        </>
      )}

      <OpenDocDialog
        title="打开原料盘点单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 备注"
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        loading={listQuery.isLoading}
        onPick={(r) => {
          if (!r.单号) return;
          setDialogOpen(false);
          void openDoc(r.单号);
        }}
        footer={
          <>
            <span>共 {listQuery.data?.total ?? 0} 张</span>
            <span className="flex items-center gap-2">
              <button type="button" className="f-btn h-8 px-3 text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
          </>
        }
      />

      <RawMaterialPickerDialog
        open={matPickFor !== null}
        onPick={(row: PlasticRawMaterialRow) => {
          if (matPickFor === null) return;
          updateLine(matPickFor, {
            原料编号: row.物料编号 ?? undefined,
            原料名称: row.物料名称 ?? undefined,
            产地: row.产地 ?? undefined,
            每包重量: row.每包重量 ?? undefined,
            单位: row.单位 ?? undefined,
            系统数量: Number(row.库存 ?? 0),
          });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该原料盘点单?"
        description={单号 ? `原料盘点单 ${单号} 删除后不可恢复` : undefined}
        confirmLabel="删除"
        onConfirm={() => {
          setDeleteOpen(false);
          void remove();
        }}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
