// 半成品盘点单(/semi-stocktakes;单据+查询双页签)。对照老系统:
// web/src/pages/warehouse/SemiStocktakePage.tsx + SemiStocktakeQueryPage.tsx。
// 预载半成品仓库存基准(basis),选产品新行带出系统数量、盘点数量默认=系统数量;
// 盈亏数量=盘点-系统(负红正绿);审核=盘点过账(调整库存),支持反审核;已开未审核单可 PUT 更新。
// 查询页签:半成品盘点查询(汇总 系统数/盘点数/盈亏数,盈亏合计;明细 审核情况),双击回单据页签。
// 权限菜单:单据与查询同为「半成品盘点」(MenuCatalog.cs:30 实证;老系统两页同 MENU)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Copy,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Printer,
  Prohibit,
  Trash,
  X,
} from "@phosphor-icons/react";
import { semiStocktakeApi } from "@/api/endpoints";
import type { STKDetail, STKHeader } from "@/api/types";
import {
  mergeSemiStocktakeLines,
  printSemiDoc,
  validateSemiStocktake,
  type SemiDocPrintCfg,
  type SemiStkDraftLine,
} from "@/lib/semiDocs";
import { fmtDate, fmtNum } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { SemiProductPickerDialog } from "@/components/doc/SemiProductPickerDialog";
import { SemiDocQueryPanel, type SemiDocQueryCfg, type SemiQueryCol } from "./SemiDocQueryPanel";

const MENU = "半成品盘点";
const WAREHOUSE = "半成品仓";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const currentUser = () => getUser() || "admin";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

let rowSeq = 1;

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const diffText = (d: number) => (
  <span className={cn("f-mono", d < 0 ? "text-[#dc2626]" : d > 0 ? "text-[#15803d]" : "text-[#1a2330]")}>
    {d}
  </span>
);

// ---------- 查询页签配置(列序逐字对照老系统 SemiStocktakeQueryPage) ----------

const STK_SUMMARY_COLS: SemiQueryCol[] = [
  { title: "配件编号", key: "配件编号", kind: "doc", size: 10 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 12 },
  { title: "产品名称", key: "产品名称", size: 14 },
  { title: "产品装配名称", key: "产品装配名称", size: 15 },
  { title: "系统数", key: "系统数", kind: "num", size: 8 },
  { title: "盘点数", key: "盘点数", kind: "num", size: 8 },
  { title: "盈亏数", key: "盈亏数", kind: "signed", size: 8 },
];
const STK_DETAIL_COLS: SemiQueryCol[] = [
  { title: "日期", key: "日期", kind: "date", size: 8 },
  { title: "单号", key: "单号", kind: "doc", size: 11 },
  { title: "配件编号", key: "配件编号", kind: "mono", size: 9 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 11 },
  { title: "产品名称", key: "产品名称", size: 12 },
  { title: "产品装配名称", key: "产品装配名称", size: 14 },
  { title: "系统数量", key: "系统数量", kind: "num", size: 8 },
  { title: "盘点数量", key: "盘点数量", kind: "num", size: 8 },
  { title: "盈亏数量", key: "盈亏数量", kind: "signed", size: 8 },
  { title: "备注", key: "备注", size: 9 },
  { title: "审核", key: "审核", kind: "audit", size: 6 },
];

const STK_QUERY_CFG: SemiDocQueryCfg = {
  queryKey: "semi-stocktake-query",
  menu: MENU,
  title: "半成品盘点查询",
  docTitle: "半成品盘点单",
  fields: ["产品装配名称", "产品货号", "产品名称", "配件编号", "客户"],
  defaultField: "产品装配名称",
  fetchSummary: (q) => semiStocktakeApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchDetail: (q) => semiStocktakeApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: STK_SUMMARY_COLS,
  detailCols: STK_DETAIL_COLS,
  exportSummary: {
    name: "半成品盘点查询_汇总",
    cols: ["配件编号", "产品货号", "产品名称", "产品装配名称", "系统数", "盘点数", "盈亏数"],
  },
  exportDetail: {
    name: "半成品盘点查询_明细",
    cols: ["日期", "单号", "配件编号", "产品货号", "产品名称", "产品装配名称", "系统数量", "盘点数量", "盈亏数量", "备注", "审核"],
  },
  materialOnlyScope: "always",
  totalKey: "盈亏数",
  totalLabel: "盈亏合计",
};

// ---------- 打印规格 ----------

const PRINT_CFG: SemiDocPrintCfg = {
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["仓库", "仓库"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["配件编号", "配件编号"],
    ["产品货号", "产品货号"],
    ["产品名称", "产品名称"],
    ["产品装配名称", "产品装配名称"],
    ["系统数量", "系统数量"],
    ["盘点数量", "盘点数量"],
    ["盈亏数量", "盈亏数量"],
    ["备注", "备注"],
  ],
};

// ---------- 打开单据弹窗列 ----------

const openCol = createColumnHelper<STKHeader>();
const listColumns: ColumnDef<STKHeader, any>[] = [
  openCol.accessor("单号", {
    header: "电脑单号",
    size: 22,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 14,
    cell: (c) => fmtDate(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("系统数量", {
    header: "系统数量",
    size: 11,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("盘点数量", {
    header: "盘点数量",
    size: 11,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("盈亏数量", {
    header: "盈亏数量",
    size: 11,
    cell: (c) => diffText(Number(c.getValue() ?? 0)),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right" },
  }),
  openCol.accessor("审核", {
    header: "状态",
    size: 12,
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

export default function SemiStocktakePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [opened, setOpened] = useState<STKDetail | null>(null);
  const [form, setFormState] = useState({ 日期: today(), 备注: "" });
  const [lines, setLines] = useState<SemiStkDraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [productOpen, setProductOpen] = useState(false);
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
  const readOnly = audited || !canSave || busy;
  const 单号 = header?.单号 ?? "";

  // 预载半成品仓库存基准(按配件编号汇总系统数量;选产品时带出)
  const basisQuery = useQuery({
    queryKey: ["semi-stocktake", "basis"],
    queryFn: () => semiStocktakeApi.basis(WAREHOUSE),
    enabled: canOpen && !permsLoading,
  });
  const sysQtyMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of basisQuery.data ?? []) m.set((r.物料编号 ?? "").trim(), Number(r.系统数量 ?? 0));
    return m;
  }, [basisQuery.data]);

  const applyDetail = useCallback((d: STKDetail) => {
    const h = d.单头 ?? ({} as STKHeader);
    setFormState({ 日期: date10(h.日期) || today(), 备注: h.备注 ?? "" });
    const loaded: SemiStkDraftLine[] = (d.明细 ?? []).map((x, i) => ({
      key: i + 1,
      配件编号: x.配件编号 ?? "",
      客户: x.客户,
      产品货号: x.产品货号,
      产品名称: x.产品名称,
      产品装配名称: x.产品装配名称,
      系统数量: Number(x.系统数量 ?? 0),
      盘点数量: Number(x.盘点数量 ?? 0),
      备注: x.备注 ?? "",
    }));
    rowSeq = Math.max(rowSeq, loaded.length + 1);
    setLines(loaded);
    setOpened(d);
    setTab("doc");
  }, []);

  const openDoc = useCallback(
    async (no: string) => {
      setBusy(true);
      try {
        applyDetail(await semiStocktakeApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开盘点单失败", "err");
      } finally {
        setBusy(false);
      }
    },
    [applyDetail, notify],
  );

  // ?open=<单号> 查询页签双击跳入(仅首次)
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
    setFormState({ 日期: today(), 备注: "" });
    setOpened(null);
    setLines([]);
  };

  const buildPayload = () => {
    const issue = validateSemiStocktake({ 明细: lines });
    if (issue) {
      notify(issue, "err");
      return null;
    }
    return {
      日期: form.日期 || today(),
      仓库: WAREHOUSE,
      备注: form.备注.trim() || undefined,
      明细: lines
        .filter((x) => x.配件编号.trim())
        .map((x) => ({
          配件编号: x.配件编号,
          客户: x.客户,
          产品货号: x.产品货号,
          产品名称: x.产品名称,
          产品装配名称: x.产品装配名称,
          系统数量: Number(x.系统数量 || 0),
          盘点数量: Number(x.盘点数量 || 0),
          备注: x.备注,
        })),
    };
  };

  const save = async () => {
    const body = buildPayload();
    if (!body || readOnly) return;
    setBusy(true);
    try {
      const no = 单号
        ? (await semiStocktakeApi.update(单号, body), 单号)
        : (await semiStocktakeApi.create(body)).单号;
      applyDetail(await semiStocktakeApi.get(no));
      notify("半成品盘点单已保存", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-stocktake"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "保存失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const audit = async (reverse: boolean) => {
    if (!单号) return;
    setBusy(true);
    try {
      if (reverse) await semiStocktakeApi.unapprove(单号);
      else await semiStocktakeApi.approve(单号);
      applyDetail(await semiStocktakeApi.get(单号));
      notify(reverse ? "已反审核" : "已审核", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-stocktake"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || (reverse ? "反审核失败" : "审核失败"), "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!单号) return;
    setBusy(true);
    try {
      await semiStocktakeApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-stocktake"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const move = async (next: boolean) => {
    if (!单号) return;
    setBusy(true);
    try {
      const d = await semiStocktakeApi.adjacent(单号, next);
      if (!d) notify(next ? "已经是最后一张单据" : "已经是第一张单据", "err");
      else applyDetail(d);
    } catch (e) {
      notify(errMsg(e) || "切换单据失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!opened) return;
    setOpened(null);
    setFormState((f) => ({ ...f, 日期: today() }));
    notify("已复制为未保存新单", "ok");
  };

  const updateLine = (key: number, patch: Partial<SemiStkDraftLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const totals = useMemo(
    () =>
      lines.reduce(
        (a, x) => ({
          sys: a.sys + Number(x.系统数量 || 0),
          cnt: a.cnt + Number(x.盘点数量 || 0),
          diff: a.diff + (Number(x.盘点数量 || 0) - Number(x.系统数量 || 0)),
        }),
        { sys: 0, cnt: 0, diff: 0 },
      ),
    [lines],
  );

  const listQuery = useQuery({
    queryKey: ["semi-stocktake", "list", page, keyword],
    queryFn: () => semiStocktakeApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printSemiDoc(
      `半成品盘点单 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 仓库: WAREHOUSE, 操作员: header?.操作员 ?? currentUser() } as Record<string, unknown>,
        明细: lines
          .filter((l) => l.配件编号.trim())
          .map((l) => ({ ...l, 盈亏数量: Number(l.盘点数量 || 0) - Number(l.系统数量 || 0) }) as unknown as Record<string, unknown>),
      },
      PRINT_CFG,
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly, disabledTitle: audited ? "单据已审核" : !canSave ? "无保存权限" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
    { key: "copy", label: "复制单", icon: Copy, perm: "保存", disabled: !opened || !canSave || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: copy },
    { key: "refresh", label: "刷新", disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => 单号 && void openDoc(单号) },
    { key: "prev", label: "前单", icon: CaretLeft, disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => void move(false) },
    { key: "next", label: "后单", icon: CaretRight, disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => void move(true) },
  ];
  const auditActions: DocAction[] = [
    { key: "audit", label: "审核", icon: CheckCircle, perm: "审核", success: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => void audit(false) },
    { key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true, disabled: !opened || !audited || busy, disabledTitle: !opened ? "先打开单据" : "单据未审核", onClick: () => void audit(true) },
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
            description="缺少「半成品盘点·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          半成品盘点单
          {tab === "doc" && (单号 ? ` · ${单号}` : "(新建)")}
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
              { key: "doc" as const, label: "半成品盘点单" },
              { key: "query" as const, label: "半成品盘点查询" },
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
        <SemiDocQueryPanel cfg={STK_QUERY_CFG} onOpenDoc={(no) => void openDoc(no)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={auditActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={tailActions} menuKey={MENU} />
            <button
              type="button"
              className="f-btn h-9 px-3.5 text-sm"
              disabled={readOnly}
              onClick={() => setProductOpen(true)}
            >
              资料
            </button>
          </div>

          {/* 单头表单(对照老系统 Form:日期/电脑单号/操作员/备注/审核状态) */}
          <div className="f-panel p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4 lg:grid-cols-5">
              <FormField label="日期">
                <Input
                  type="date"
                  className={inputCls}
                  aria-label="日期"
                  disabled={readOnly}
                  value={form.日期}
                  onChange={(e) => setFormState((f) => ({ ...f, 日期: e.target.value }))}
                />
              </FormField>
              <FormField label="电脑单号">
                <Input className={inputCls} aria-label="电脑单号" readOnly placeholder="保存后生成" value={单号} />
              </FormField>
              <FormField label="操作员">
                <Input className={inputCls} aria-label="操作员" readOnly value={header?.操作员 ?? currentUser()} />
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

          {/* 明细(列序对照老系统:删除|配件编号|产品货号|产品名称|产品装配名称|系统数量|盘点数量|盈亏数量|备注) */}
          <div className="f-panel overflow-hidden">
            <div className="max-h-[46vh] overflow-auto">
              <table data-freeze className="w-full min-w-[1250px] text-[15px]">
                <thead>
                  <tr className="border-b border-black/8">
                    {["删除", "配件编号", "产品货号", "产品名称", "产品装配名称", "系统数量", "盘点数量", "盈亏数量", "备注"].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                          ["系统数量", "盘点数量", "盈亏数量"].includes(h) && "text-right",
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
                    const diff = Number(l.盘点数量 || 0) - Number(l.系统数量 || 0);
                    return (
                      <tr key={l.key} className="border-b border-black/6 last:border-0">
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
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap font-semibold text-[#15803d]">{l.配件编号}</td>
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#1a2330]">{l.产品货号 ?? ""}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.产品名称 ?? ""}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.产品装配名称 ?? ""}</td>
                        <td className="f-mono px-3 py-1.5 text-right text-[#1a2330]">{l.系统数量}</td>
                        <td className="px-2 py-1.5">
                          {readOnly ? (
                            <span className="f-mono block text-right text-[#1a2330]">{l.盘点数量}</span>
                          ) : (
                            <input
                              className={cn(cellInputCls, "f-mono text-right")}
                              aria-label="盘点数量"
                              type="number"
                              min={0}
                              value={l.盘点数量}
                              onChange={(e) => updateLine(l.key, { 盘点数量: Number(e.target.value || 0) })}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">{diffText(diff)}</td>
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
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-disabled">
                        点上方「资料」选产品加行(新行带出系统数量)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 合计(对照老系统 Statistic:系统数量/盘点数量/盈亏数量) */}
            <div className="flex gap-10 border-t border-black/8 px-4 py-3">
              <span className="text-sm text-[#5f6b7d]">
                系统数量:<span className="f-mono text-base font-bold text-[#1a2330]">{totals.sys}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                盘点数量:<span className="f-mono text-base font-bold text-[#1a2330]">{totals.cnt}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                盈亏数量:
                <span
                  className={cn(
                    "f-mono text-base font-bold",
                    totals.diff < 0 ? "text-[#dc2626]" : totals.diff > 0 ? "text-[#15803d]" : "text-[#1a2330]",
                  )}
                >
                  {totals.diff}
                </span>
              </span>
            </div>
          </div>
        </>
      )}

      {/* 打开单据(对照老系统 OpenList:关键字搜 电脑单号/仓库) */}
      <OpenDocDialog
        title="打开半成品盘点单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="电脑单号 / 仓库"
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

      <SemiProductPickerDialog
        open={productOpen}
        permMenu={MENU}
        goodsTitle="共用产品货号"
        nameTitle="共用产品名称"
        loadProducts={(q) => semiStocktakeApi.products(q)}
        onPick={(rows) => {
          setProductOpen(false);
          setLines((cur) => mergeSemiStocktakeLines(cur, rows, (code) => sysQtyMap.get(code.trim()) ?? 0));
        }}
        onClose={() => setProductOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除当前盘点单？"
        description={单号 ? `半成品盘点单 ${单号} 删除后不可恢复` : undefined}
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
