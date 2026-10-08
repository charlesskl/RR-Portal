// 半成品出库单(/semi-issues;单据+查询双页签)。对照老系统:
// web/src/pages/warehouse/SemiIssuePage.tsx + SemiIssueQueryPage.tsx。
// 三级流转:开单 -> 主管审核 -> 经理审核 -> 审核(出库过账);反审核回退。
// 单据页签:新建/打开/保存(新建 POST,已开未审核 PUT)/删除/刷新/资料(产品多选)/前单/后单/复制单/
// 主管审核/经理审核/审核/反审核/打印/关闭;领料人/拉长/收件人/制单人 走人事档案选择器;
// 右侧库存参考(半成品仓现存量按配件编号汇总;对照老系统 stockMap/stockRows)。
// 查询页签:半成品出库查询(汇总按领料备注/物料查询;明细 制单人+审核情况;领料备注下拉两页签共用);
// 30s 轮询+聚焦刷新(对照老系统 useAutoReload);双击明细行回单据页签(=旧版 ?open= 跳入)。
// 权限菜单:单据与查询同为「半成品领料」(MenuCatalog.cs:30 实证;老系统两页同 MENU=半成品领料)。
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
import { semiInventoryApi, semiIssueApi } from "@/api/endpoints";
import type { SemiProductRow, SIDetail, SIHeader } from "@/api/types";
import {
  mergeSemiDraftLines,
  printSemiDoc,
  validateSemiDraft,
  type SemiDocPrintCfg,
  type SemiDraftLine,
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
import { SearchSelect } from "@/components/doc/SearchSelect";
import { SemiProductPickerDialog } from "@/components/doc/SemiProductPickerDialog";
import { EmployeePickerDialog } from "@/components/doc/EmployeePickerDialog";
import { SemiDocQueryPanel, type SemiDocQueryCfg, type SemiQueryCol } from "./SemiDocQueryPanel";

const MENU = "半成品领料";
const WAREHOUSE = "半成品仓";
const 领料备注选项 = ["生产领料", "补料", "返工领料"];

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

// ---------- 查询页签配置(列序逐字对照老系统 SemiIssueQueryPage) ----------

const ISSUE_SUMMARY_COLS: SemiQueryCol[] = [
  { title: "领料备注", key: "领料备注", size: 8 },
  { title: "装配采购", key: "装配采购", kind: "mono", size: 10 },
  { title: "配件编号", key: "配件编号", kind: "doc", size: 9 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 11 },
  { title: "产品名称", key: "产品名称", size: 12 },
  { title: "产品装配名称", key: "产品装配名称", size: 14 },
  { title: "领料数量", key: "领料数量", kind: "num", size: 8 },
  { title: "备注", key: "备注", size: 9 },
];
const ISSUE_DETAIL_COLS: SemiQueryCol[] = [
  { title: "领料备注", key: "领料备注", size: 8 },
  { title: "装配采购", key: "装配采购", kind: "mono", size: 10 },
  { title: "日期", key: "日期", kind: "date", size: 8 },
  { title: "单号", key: "单号", kind: "doc", size: 10 },
  { title: "领料人", key: "领料人", size: 9 },
  { title: "生产单号", key: "生产单号", kind: "mono", size: 10 },
  { title: "配件编号", key: "配件编号", kind: "mono", size: 8 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 11 },
  { title: "产品名称", key: "产品名称", size: 11 },
  { title: "产品装配名称", key: "产品装配名称", size: 13 },
  { title: "数量", key: "数量", kind: "num", size: 7 },
  { title: "备注", key: "备注", size: 8 },
  { title: "制单人", key: "制单人", size: 7 },
  { title: "审核", key: "审核", kind: "audit", size: 6 },
];

const ISSUE_QUERY_CFG: SemiDocQueryCfg = {
  queryKey: "semi-issue-query",
  menu: MENU,
  title: "半成品出库查询",
  docTitle: "半成品出库单",
  fields: ["产品装配名称", "产品货号", "产品名称", "配件编号", "客户"],
  defaultField: "产品装配名称",
  fetchSummary: (q) => semiIssueApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchDetail: (q) => semiIssueApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: ISSUE_SUMMARY_COLS,
  detailCols: ISSUE_DETAIL_COLS,
  exportSummary: {
    name: "半成品出库查询_汇总",
    cols: ["领料备注", "装配采购", "配件编号", "产品货号", "产品名称", "产品装配名称", "领料数量", "备注"],
  },
  exportDetail: {
    name: "半成品出库查询_明细",
    cols: ["领料备注", "装配采购", "日期", "单号", "领料人", "生产单号", "配件编号", "产品货号", "产品名称", "产品装配名称", "数量", "备注", "制单人", "审核"],
  },
  materialOnlyLabel: "物料查询",
  materialOnlyScope: "always",
  summaryBy: { key: "byIssueRemark", label: "汇总按领料备注", defaultOn: true },
  remarkFilter: true,
  makerFilter: true,
  totalKey: "领料数量",
  totalLabel: "总合计",
  autoReload: true,
};

// ---------- 打印规格 ----------

const PRINT_CFG: SemiDocPrintCfg = {
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["部门", "部门"],
    ["领料人", "领料人"],
    ["拉长", "拉长"],
    ["收件人", "收件人"],
    ["领料备注", "领料备注"],
    ["制单人", "制单人"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["配件编号", "配件编号"],
    ["客户", "客户"],
    ["产品货号", "产品货号"],
    ["产品名称", "产品名称"],
    ["产品装配名称", "产品装配名称"],
    ["生产单号", "生产单号"],
    ["数量", "数量"],
    ["备注", "备注"],
  ],
};

// ---------- 审核状态徽章(四级:未审核/主管已审/经理已审/已审核) ----------

function IssueAuditBadge({ header }: { header?: SIHeader | null }) {
  const audited = header?.审核 === "1";
  const mgr = header?.经理审核 === "1";
  const sup = header?.主管审核 === "1";
  const [cls, text] = audited
    ? ["border-[#16a34a]/60 bg-[#16a34a]/10 text-[#15803d]", "已审核"]
    : mgr
      ? ["border-[#2563eb]/50 bg-[#2563eb]/10 text-[#2563eb]", "经理已审"]
      : sup
        ? ["border-[#b45309]/40 bg-[#b45309]/10 text-[#b45309]", "主管已审"]
        : ["border-black/10 bg-black/5 text-[#5f6b7d]", "未审核"];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold", cls)}>
      {text}
    </span>
  );
}

// ---------- 打开单据弹窗列 ----------

const openCol = createColumnHelper<SIHeader>();
const listColumns: ColumnDef<SIHeader, any>[] = [
  openCol.accessor("单号", {
    header: "电脑单号",
    size: 20,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 14,
    cell: (c) => fmtDate(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("部门", { header: "部门", size: 14 }),
  openCol.accessor("领料人", { header: "领料人", size: 12 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 10,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.display({
    id: "状态",
    header: "状态",
    size: 14,
    cell: (c) => <IssueAuditBadge header={c.row.original} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

interface HeaderFormState {
  部门: string;
  日期: string;
  领料人: string;
  拉长: string;
  收件人: string;
  领料备注: string;
  件数: string;
  卡板数: string;
  制单人: string;
  备注: string;
}
const emptyHeader = (): HeaderFormState => ({
  部门: "",
  日期: today(),
  领料人: "",
  拉长: "",
  收件人: "",
  领料备注: 领料备注选项[0],
  件数: "",
  卡板数: "",
  制单人: currentUser(),
  备注: "",
});

type EmpField = "领料人" | "拉长" | "收件人" | "制单人";

export default function SemiIssuePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [opened, setOpened] = useState<SIDetail | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [lines, setLines] = useState<SemiDraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [productOpen, setProductOpen] = useState(false);
  const [empField, setEmpField] = useState<EmpField | null>(null);
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
  const 主管已审 = header?.主管审核 === "1";
  const 经理已审 = header?.经理审核 === "1";
  const readOnly = audited || !canSave || busy;
  const 单号 = header?.单号 ?? "";

  // 库存参考:半成品仓现存量按配件编号汇总(对照老系统 stockMap;打开单据后重取)
  const stockQuery = useQuery({
    queryKey: ["semi-issue", "stock", 单号],
    queryFn: () => semiInventoryApi.list(WAREHOUSE),
    enabled: canOpen && !permsLoading,
  });
  const stockMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of stockQuery.data ?? [])
      m[(r.物料编号 ?? "").trim()] = (m[(r.物料编号 ?? "").trim()] ?? 0) + Number(r.库存 ?? 0);
    return m;
  }, [stockQuery.data]);
  const stockRows = useMemo(
    () =>
      lines.map((l, i) => ({
        key: l.key,
        序号: i + 1,
        配件编号: l.配件编号,
        产品装配名称: l.产品装配名称 ?? "",
        发料数量: Number(l.数量 || 0),
        库存数量: stockMap[l.配件编号.trim()] ?? 0,
      })),
    [lines, stockMap],
  );

  const applyDetail = useCallback((d: SIDetail) => {
    const h = d.单头 ?? ({} as SIHeader);
    setFormState({
      部门: h.部门 ?? "",
      日期: date10(h.日期) || today(),
      领料人: h.领料人 ?? "",
      拉长: h.拉长 ?? "",
      收件人: h.收件人 ?? "",
      领料备注: h.领料备注 ?? 领料备注选项[0],
      件数: h.件数 == null ? "" : String(h.件数),
      卡板数: h.卡板数 == null ? "" : String(h.卡板数),
      制单人: h.制单人 ?? currentUser(),
      备注: h.备注 ?? "",
    });
    const loaded: SemiDraftLine[] = (d.明细 ?? []).map((x, i) => ({
      key: i + 1,
      配件编号: x.配件编号 ?? "",
      客户: x.客户,
      产品货号: x.产品货号,
      产品名称: x.产品名称,
      产品装配名称: x.产品装配名称,
      生产单号: x.生产单号,
      数量: Number(x.数量 ?? 0),
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
        applyDetail(await semiIssueApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开出库单失败", "err");
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
    setFormState(emptyHeader());
    setOpened(null);
    setLines([]);
  };

  const buildPayload = () => {
    const issue = validateSemiDraft({ 明细: lines }, "出库");
    if (issue) {
      notify(issue, "err");
      return null;
    }
    return {
      日期: form.日期 || today(),
      仓库: WAREHOUSE,
      部门: form.部门 || undefined,
      领料人: form.领料人 || undefined,
      拉长: form.拉长 || undefined,
      收件人: form.收件人 || undefined,
      领料备注: form.领料备注 || undefined,
      件数: form.件数 === "" ? null : Number(form.件数),
      卡板数: form.卡板数 === "" ? null : Number(form.卡板数),
      制单人: form.制单人 || undefined,
      备注: form.备注.trim() || undefined,
      明细: lines
        .filter((x) => x.配件编号.trim() && Number(x.数量) > 0)
        .map((x) => ({
          配件编号: x.配件编号,
          客户: x.客户,
          产品货号: x.产品货号,
          产品名称: x.产品名称,
          产品装配名称: x.产品装配名称,
          生产单号: x.生产单号,
          数量: Number(x.数量),
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
        ? (await semiIssueApi.update(单号, body), 单号)
        : (await semiIssueApi.create(body)).单号;
      applyDetail(await semiIssueApi.get(no));
      notify("半成品出库单已保存", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-issue"] });
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
      if (reverse) await semiIssueApi.unapprove(单号);
      else await semiIssueApi.approve(单号);
      applyDetail(await semiIssueApi.get(单号));
      notify(reverse ? "已反审核" : "已审核", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-issue"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || (reverse ? "反审核失败" : "审核失败"), "err");
    } finally {
      setBusy(false);
    }
  };

  const chainAct = async (kind: "supervisor" | "manager") => {
    if (!单号) return;
    setBusy(true);
    try {
      if (kind === "supervisor") await semiIssueApi.supervisorApprove(单号);
      else await semiIssueApi.managerApprove(单号);
      applyDetail(await semiIssueApi.get(单号));
      notify(kind === "supervisor" ? "主管已审核" : "经理已审核", "ok");
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
      await semiIssueApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-issue"] });
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
      const d = await semiIssueApi.adjacent(单号, next);
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

  const updateLine = (key: number, patch: Partial<SemiDraftLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const pickProducts = (rows: SemiProductRow[]) =>
    setLines((cur) => mergeSemiDraftLines(cur, rows));

  const totalQty = useMemo(() => lines.reduce((a, x) => a + Number(x.数量 || 0), 0), [lines]);

  const listQuery = useQuery({
    queryKey: ["semi-issue", "list", page, keyword],
    queryFn: () => semiIssueApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printSemiDoc(
      `半成品出库单 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 操作员: header?.操作员 ?? currentUser() } as Record<string, unknown>,
        明细: lines.filter((l) => l.配件编号.trim()) as unknown as Record<string, unknown>[],
      },
      PRINT_CFG,
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly, disabledTitle: audited ? "单据已审核" : !canSave ? "无保存权限" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
    { key: "refresh", label: "刷新", disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => 单号 && void openDoc(单号) },
    { key: "prev", label: "前单", icon: CaretLeft, disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => void move(false) },
    { key: "next", label: "后单", icon: CaretRight, disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => void move(true) },
    { key: "copy", label: "复制单", icon: Copy, perm: "保存", disabled: !opened || !canSave || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: copy },
  ];
  const auditActions: DocAction[] = [
    { key: "sup", label: "主管审核", icon: CheckCircle, perm: "审核", disabled: !opened || audited || 主管已审 || busy, disabledTitle: !opened ? "先打开单据" : audited || 主管已审 ? "已审核" : undefined, onClick: () => void chainAct("supervisor") },
    { key: "mgr", label: "经理审核", icon: CheckCircle, perm: "审核", disabled: !opened || audited || !主管已审 || 经理已审 || busy, disabledTitle: !opened ? "先打开单据" : !主管已审 ? "待主管审核" : audited || 经理已审 ? "已审核" : undefined, onClick: () => void chainAct("manager") },
    {
      key: "audit",
      label: "审核",
      icon: CheckCircle,
      perm: "审核",
      success: true,
      disabled: !opened || audited || !经理已审 || busy,
      disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : !经理已审 ? "待经理审核" : undefined,
      onClick: () => void audit(false),
    },
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
            description="缺少「半成品领料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          半成品出库单
          {tab === "doc" && (单号 ? ` · ${单号}` : "(新建)")}
        </h1>
        {tab === "doc" && opened && <IssueAuditBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: "半成品出库单" },
              { key: "query" as const, label: "半成品出库查询" },
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
          {tab === "doc" && (
            <FlowSteps
              steps={["开单", "主管审核", "经理审核", "审核出库"]}
              current={audited ? 3 : 经理已审 ? 2 : 主管已审 ? 1 : 0}
            />
          )}
        </div>
      </div>

      {tab === "query" ? (
        <SemiDocQueryPanel cfg={ISSUE_QUERY_CFG} onOpenDoc={(no) => void openDoc(no)} />
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

          {/* 单头表单(对照老系统 Form 栅格) */}
          <div className="f-panel p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4 lg:grid-cols-6">
              <FormField label="部门">
                <Input
                  className={inputCls}
                  aria-label="部门"
                  disabled={readOnly}
                  value={form.部门}
                  onChange={(e) => setFormState((f) => ({ ...f, 部门: e.target.value }))}
                />
              </FormField>
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
              <FormField label="审核日期">
                <Input className={inputCls} aria-label="审核日期" readOnly value={date10(header?.审核日期)} />
              </FormField>
              {(["领料人", "拉长", "收件人", "制单人"] as EmpField[]).map((f) => (
                <FormField key={f} label={f}>
                  <div className="flex gap-2">
                    <Input className={inputCls} aria-label={f} readOnly value={form[f]} />
                    <button
                      type="button"
                      className="f-btn h-10 shrink-0 px-3 text-sm"
                      aria-label={`${f}选择`}
                      disabled={readOnly}
                      onClick={() => setEmpField(f)}
                    >
                      选
                    </button>
                  </div>
                </FormField>
              ))}
              <FormField label="电脑单号">
                <Input className={inputCls} aria-label="电脑单号" readOnly placeholder="保存后生成" value={单号} />
              </FormField>
              <FormField label="领料备注">
                <SearchSelect
                  ariaLabel="领料备注"
                  className={cn(inputCls, "rounded-md border")}
                  disabled={readOnly}
                  value={form.领料备注}
                  options={领料备注选项.map((v) => ({ value: v, label: v }))}
                  onChange={(v) => setFormState((f) => ({ ...f, 领料备注: v }))}
                />
              </FormField>
              <FormField label="件数">
                <Input
                  type="number"
                  min={0}
                  className={inputCls}
                  aria-label="件数"
                  disabled={readOnly}
                  value={form.件数}
                  onChange={(e) => setFormState((f) => ({ ...f, 件数: e.target.value }))}
                />
              </FormField>
              <FormField label="卡板数">
                <Input
                  type="number"
                  min={0}
                  className={inputCls}
                  aria-label="卡板数"
                  disabled={readOnly}
                  value={form.卡板数}
                  onChange={(e) => setFormState((f) => ({ ...f, 卡板数: e.target.value }))}
                />
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
              <FormField label="操作员">
                <Input className={inputCls} aria-label="操作员" readOnly value={header?.操作员 ?? currentUser()} />
              </FormField>
            </div>
          </div>

          {/* 明细 + 库存参考(对照老系统 17/7 栅格) */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
            <div className="f-panel overflow-hidden">
              <div className="max-h-[46vh] overflow-auto">
                <table data-freeze className="w-full min-w-[1350px] text-[15px]">
                  <thead>
                    <tr className="border-b border-black/8">
                      {["删除", "装配采购", "配件编号", "客户", "产品货号", "产品名称", "产品装配名称", "生产单号", "数量", "备注"].map((h) => (
                        <th
                          key={h}
                          className={cn(
                            "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                            h === "数量" && "text-right",
                            h === "删除" && "text-center",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
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
                        <td className="px-3 py-1.5" />
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap font-semibold text-[#15803d]">{l.配件编号}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.客户 ?? ""}</td>
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#1a2330]">{l.产品货号 ?? ""}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.产品名称 ?? ""}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.产品装配名称 ?? ""}</td>
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">{l.生产单号 ?? ""}</td>
                        <td className="px-2 py-1.5">
                          {readOnly ? (
                            <span className="f-mono block text-right text-[#1a2330]">{l.数量}</span>
                          ) : (
                            <input
                              className={cn(cellInputCls, "f-mono text-right")}
                              aria-label="数量"
                              type="number"
                              min={0}
                              value={l.数量}
                              onChange={(e) => updateLine(l.key, { 数量: Number(e.target.value || 0) })}
                            />
                          )}
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
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-sm text-disabled">
                          点上方「资料」选产品加行
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-10 border-t border-black/8 px-4 py-3">
                <span className="text-sm text-[#5f6b7d]">
                  数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{totalQty}</span>
                </span>
              </div>
            </div>
            {/* 库存参考(对照老系统 stockCols:序号/配件编号/产品装配名称/发料数量/库存数量) */}
            <div className="f-panel overflow-hidden">
              <div className="border-b border-black/8 px-4 py-2.5 text-sm font-semibold text-[#1a2330]">
                库存参考
              </div>
              <div className="max-h-[46vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/8">
                      {["序号", "配件编号", "产品装配名称", "发料数量", "库存数量"].map((h) => (
                        <th
                          key={h}
                          className={cn(
                            "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                            (h === "发料数量" || h === "库存数量") && "text-right",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stockRows.map((s) => (
                      <tr key={s.key} className="border-b border-black/6 last:border-0">
                        <td className="px-3 py-2 text-disabled">{s.序号}</td>
                        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{s.配件编号}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{s.产品装配名称}</td>
                        <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{s.发料数量}</td>
                        <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{s.库存数量}</td>
                      </tr>
                    ))}
                    {stockRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-sm text-disabled">
                          暂无明细
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 打开单据(对照老系统 OpenList:关键字搜 电脑单号/仓库/领料人,双击行打开) */}
      <OpenDocDialog
        title="打开半成品出库单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="电脑单号 / 仓库 / 领料人"
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
        loadProducts={(q) => semiIssueApi.products(q)}
        onPick={(rows) => {
          setProductOpen(false);
          pickProducts(rows);
        }}
        onClose={() => setProductOpen(false)}
      />
      <EmployeePickerDialog
        open={empField !== null}
        onPick={(name) => {
          if (empField) setFormState((f) => ({ ...f, [empField]: name }));
          setEmpField(null);
        }}
        onClose={() => setEmpField(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除当前出库单？"
        description={单号 ? `半成品出库单 ${单号} 删除后不可恢复` : undefined}
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
