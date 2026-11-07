import { usePageSearchParams } from "@/hooks/usePageSearchParams";
// 原料出库表(/plastic-raw-material-stock-issue;单据+查询双页签)。对照老系统:
// web/src/pages/plastics/PlasticRawMaterialStockIssuePage.tsx(单据)
// + PlasticRawMaterialStockIssueQueryPage.tsx(查询,默认汇总;多 领料备注/制单人 过滤)
// + PlasticRawMaterialStockIssueQueryDetailDrawer.tsx(双击明细行弹单据详情)。
// 单据:新建/打开/保存(POST create)/删除/打印;三级流转 主管审核->经理审核->审核(下发)->反审核;
// 按已审核啤机采购来源带入冻结剩余净量，数量与库存单位一致。
// 并回填 生产车间/领料备注;制单人走人事档案选择器(必填)。
// 权限菜单:单据「原料出库表」/查询「原料出库查询」(MenuCatalog.cs:73/85 实证)。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
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
import {
  plasticRawMaterialMasterApi,
  rawStockIssueApi,
} from "@/api/endpoints";
import type { PlasticRawMaterialRow, RSIHeader, RSILine } from "@/api/types";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  ISSUE_REMARKS,
  date10,
  errMsg,
  nextRowKey,
  printRawDoc,
  today,
  tripleAuditLabel,
  tripleAuditStage,
  type RawDocPrintCfg,
} from "@/lib/rawDocs";
import { usePerms } from "@/hooks/usePerms";
import { rawIssueQuantitySummary } from "@/lib/rawIssueQuantity";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { EmployeePickerDialog } from "@/components/doc/EmployeePickerDialog";
import { RawMaterialPickerDialog } from "@/components/doc/RawMaterialPickerDialog";
import { ProductionPickerDialog } from "@/components/doc/ProductionPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { PlasticDocQueryPanel, type PlasticDocQueryCfg, type PlasticQueryCol } from "./PlasticDocQueryPanel";

const MENU = "原料出库表";
const currentUser = () => getUser() || "admin";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

interface EditLine extends RSILine {
  key: number;
  sourceRemaining?: number;
}

// ---------- 查询页签配置(列序逐字对照老系统 StockIssueQueryPage + DetailDrawer) ----------

const QUERY_CFG: PlasticDocQueryCfg = {
  queryKey: "raw-stock-issue-query",
  menu: "原料出库查询",
  title: "原料出库查询",
  keywordPlaceholder: "原料/单号/生产单/外发单/车间",
  defaultTab: "summary",
  fetchCategories: () => plasticRawMaterialMasterApi.categories(),
  // 额外筛选(对照老系统:领料备注下拉 + 制单人输入)
  extras: {
    node: (vals, set) => (
      <>
        <div className="w-36 space-y-1.5">
          <label className="f-label block">
            领料备注
          </label>
          <SearchSelect
            ariaLabel="领料备注"
            value={vals.领料备注 ?? ""}
            options={ISSUE_REMARKS.map((v) => ({ value: v, label: v }))}
            placeholder="领料备注:全部"
            clearLabel="领料备注:全部"
            onChange={(v) => set("领料备注", v)}
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label htmlFor="rsiq-maker" className="f-label block">
            制单人
          </label>
          <input
            id="rsiq-maker"
            className="f-input"
            placeholder="制单人"
            value={vals.制单人 ?? ""}
            onChange={(e) => set("制单人", e.target.value)}
          />
        </div>
      </>
    ),
    params: (vals) => ({
      领料备注: vals.领料备注?.trim() || undefined,
      制单人: vals.制单人?.trim() || undefined,
    }),
  },
  fetchDetail: (q) =>
    rawStockIssueApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchSummary: (q) =>
    rawStockIssueApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: (): PlasticQueryCol[] => [
    { title: "领料备注", key: "领料备注", size: 8 },
    { title: "开单日期", key: "开单日期", kind: "date", size: 8 },
    { title: "啤机生产单号", key: "啤机生产单号", kind: "mono", size: 11 },
    { title: "啤机外发单号", key: "啤机外发单号", kind: "mono", size: 10 },
    { title: "原料编号", key: "原料编号", kind: "doc", size: 9 },
    { title: "原料名称", key: "原料名称", size: 14 },
    { title: "产地", key: "产地", size: 8 },
    { title: "单位", key: "单位", size: 5 },
    { title: "领料数量(包)", key: "领料数量包", kind: "num", size: 8 },
    { title: "备注", key: "备注", size: 9 },
  ],
  detailCols: (): PlasticQueryCol[] => [
    { title: "领料备注", key: "领料备注", size: 8 },
    { title: "开单日期", key: "开单日期", kind: "date", size: 8 },
    { title: "啤机生产单号", key: "啤机生产单号", kind: "mono", size: 10 },
    { title: "生产单号", key: "生产单号", kind: "mono", size: 10 },
    { title: "日期", key: "日期", kind: "date", size: 8 },
    { title: "审核日期", key: "审核日期", kind: "date", size: 8 },
    { title: "单号", key: "单号", kind: "doc", size: 9 },
    { title: "生产车间", key: "生产车间", size: 8 },
    { title: "啤机外发单号", key: "啤机外发单号", kind: "mono", size: 9 },
    { title: "原料编号", key: "原料编号", kind: "doc", size: 8 },
    { title: "原料名称", key: "原料名称", size: 13 },
    { title: "产地", key: "产地", size: 7 },
    { title: "单位", key: "单位", size: 5 },
    { title: "数量(包)", key: "数量包", kind: "num", size: 7 },
    { title: "备注", key: "备注", size: 9 },
    { title: "制单人", key: "制单人", size: 6 },
    { title: "审核", key: "审核", kind: "audit", size: 6 },
  ],
  drawerTitle: "原料出库单",
  fetchDoc: (单号) => rawStockIssueApi.get(单号) as never,
  drawerHead: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["生产车间", "生产车间"],
    ["领料备注", "领料备注"],
    ["制单人", "制单人"],
    ["审核", "审核"],
  ],
  drawerCols: (): PlasticQueryCol[] => [
    { title: "啤机生产单号", key: "啤机生产单号", kind: "mono" },
    { title: "生产单号", key: "生产单号", kind: "mono" },
    { title: "开单日期", key: "开单日期", kind: "date" },
    { title: "啤机外发单号", key: "啤机外发单号", kind: "mono" },
    { title: "原料编号", key: "原料编号", kind: "mono" },
    { title: "原料名称", key: "原料名称" },
    { title: "产地", key: "产地" },
    { title: "每包重量", key: "每包重量", kind: "num" },
    { title: "单位", key: "单位" },
    { title: "数量", key: "数量", kind: "num" },
    { title: "备注", key: "备注" },
  ],
};

// ---------- 打印规格 ----------

const PRINT_CFG: RawDocPrintCfg = {
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["生产车间", "生产车间"],
    ["领料备注", "领料备注"],
    ["制单人", "制单人"],
    ["电脑单号", "电脑单号"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["啤机生产单号", "啤机生产单号"],
    ["生产单号", "生产单号"],
    ["开单日期", "开单日期"],
    ["来源啤机采购单号", "来源啤机采购单号"],
    ["啤机外发单号", "啤机外发单号"],
    ["原料编号", "原料编号"],
    ["原料名称", "原料名称"],
    ["产地", "产地"],
    ["每包重量", "每包重量"],
    ["单位", "单位"],
    ["数量", "数量"],
    ["备注", "备注"],
  ],
};

// ---------- 打开单据弹窗列(对照老系统 listColumns) ----------

const openCol = createColumnHelper<RSIHeader>();
const listColumns: ColumnDef<RSIHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 20,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("生产车间", { header: "生产车间", size: 14 }),
  openCol.accessor("制单人", { header: "制单人", size: 10 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 10,
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 13,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor((r) => tripleAuditLabel(r), {
    id: "状态",
    header: "状态",
    size: 15,
    cell: (c) => tripleAuditLabel(c.row.original),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
];

// 三级流转徽章(对照老系统 statusTag)
function StatusBadge({ header }: { header: RSIHeader }) {
  const stage = tripleAuditStage(header);
  const cls =
    stage === 3
      ? "border-[#16a34a]/60 bg-[#16a34a]/10 text-[#15803d]"
      : stage === 2
        ? "border-[#2563eb]/50 bg-[#2563eb]/10 text-[#1d4ed8]"
        : stage === 1
          ? "border-[#d97706]/50 bg-[#d97706]/10 text-[#b45309]"
          : "border-black/10 bg-black/5 text-[#5f6b7d]";
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold", cls)}>
      {tripleAuditLabel(header)}
    </span>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export default function PlasticRawMaterialStockIssuePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const access = useQuery({ queryKey: ["raw-stock-issue", "access", getUser()], queryFn: rawStockIssueApi.access, enabled: !permsLoading && canOpen });

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [opened, setOpened] = useState<{ 单头?: RSIHeader; 明细: RSILine[] } | null>(null);
  const [form, setFormState] = useState({
    生产车间: "",
    制单人: "",
    电脑单号: "",
    领料备注: "生产领料",
    备注: "",
  });
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [empOpen, setEmpOpen] = useState(false);
  const [demandOpen, setDemandOpen] = useState(false);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceInput, setSourceInput] = useState("");
  const [sourceKeyword, setSourceKeyword] = useState("");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null); // 明细行选生产制单(联动)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const readGeneration = useRef(0);
  const consumedOpen = useRef<string | null>(null);
  useEffect(() => () => {
    readGeneration.current += 1;
    consumedOpen.current = null;
  }, []);
  useEffect(() => {
    if (!toast || toast.tone === "err") return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  const header = opened?.单头 ?? null;
  const stage = header ? tripleAuditStage(header) : 0;
  const readOnly = opened !== null || busy || !can(MENU, "保存");
  const 单号 = header?.单号 ?? "";

  const applyDetail = useCallback((d: { 单头?: RSIHeader; 明细: RSILine[] }) => {
    const h = d.单头 ?? ({} as RSIHeader);
    setFormState({
      生产车间: h.生产车间 ?? "",
      制单人: h.制单人 ?? "",
      电脑单号: h.电脑单号 ?? "",
      领料备注: h.领料备注 ?? "生产领料",
      备注: h.备注 ?? "",
    });
    setLines((d.明细 ?? []).map((x) => ({ ...x, key: nextRowKey() })));
    setOpened(d);
    setTab("doc");
  }, []);

  const openDoc = useCallback(
    async (no: string) => {
      const generation = ++readGeneration.current;
      setDemandOpen(false); setSelectedSource(null);
      setBusy(true);
      try {
        const detail = await rawStockIssueApi.get(no);
        if (generation === readGeneration.current) applyDetail(detail);
      } catch (e) {
        if (generation === readGeneration.current) notify(errMsg(e) || "打开原料出库单失败", "err");
      } finally {
        if (generation === readGeneration.current) setBusy(false);
      }
    },
    [applyDetail, notify],
  );

  // ?open=<单号> 直开
  const [searchParams, setSearchParams] = usePageSearchParams("/plastic-raw-material-stock-issue");
  const openParam = searchParams.get("open");
  useEffect(() => {
    if (!openParam) {
      consumedOpen.current = null;
      return;
    }
    if (openParam === consumedOpen.current) return;
    consumedOpen.current = openParam;
    void openDoc(openParam);
    const next = new URLSearchParams(searchParams);
    next.delete("open");
    setSearchParams(next, { replace: true });
  }, [openDoc, openParam, searchParams, setSearchParams]);

  const reset = () => {
    readGeneration.current += 1;
    setDemandOpen(false); setSelectedSource(null);
    setFormState({ 生产车间: "", 制单人: "", 电脑单号: "", 领料备注: "生产领料", 备注: "" });
    setOpened(null);
    setLines([]);
  };

  const sources = useQuery({
    queryKey: ["raw-stock-issue", "sources", sourcePage, sourceKeyword],
    queryFn: () => rawStockIssueApi.sources(sourcePage, 20, sourceKeyword),
    enabled: demandOpen && canOpen && !opened,
  });
  const sourceDetail = useQuery({
    queryKey: ["raw-stock-issue", "source", selectedSource],
    queryFn: () => rawStockIssueApi.source(selectedSource!),
    enabled: demandOpen && canOpen && !!selectedSource && !opened,
  });
  const openDemandPicker = () => {
    setSelectedSource(null); setDemandOpen(true);
  };
  const importSource = () => {
    const source = sourceDetail.data;
    if (readOnly || !source || source.单号 !== selectedSource || sourceDetail.isFetching) return;
    const imported: EditLine[] = source.明细.filter(l => l.可申请数量 > 0).map(l => ({
      key: nextRowKey(), 来源啤机采购单号: source.单号, 啤机外发单号: source.单号,
      原料编号: l.原料编号, 原料名称: l.原料名称 ?? undefined,
      每包重量: l.每库存单位KG, 单位: l.单位 ?? undefined,
      数量: l.可申请数量, sourceRemaining: l.可申请数量,
    }));
    setLines(current => {
      const existing = new Set(current.filter(l => l.来源啤机采购单号).map(l => `${l.来源啤机采购单号!.trim().toUpperCase()}\0${l.原料编号?.trim().toUpperCase()}`));
      return [...current, ...imported.filter(l => !existing.has(`${source.单号.trim().toUpperCase()}\0${l.原料编号?.trim().toUpperCase()}`))];
    });
    setDemandOpen(false); setSelectedSource(null);
    notify(`已带入 ${source.单号} 的可申请净量；已有来源原料行保持不变`, "ok");
  };

  const save = async () => {
    if (readOnly || busy) return;
    if (!form.制单人.trim()) {
      notify("请选制单人", "err");
      return;
    }
    const ok = lines.filter(l => l.原料编号?.trim() || Number(l.数量 ?? 0) !== 0);
    if (ok.some(l => !l.原料编号?.trim() || !Number.isFinite(Number(l.数量)) || Number(l.数量) <= 0)) { notify("每行须填写真实原料编号及大于 0 的数量", "err"); return; }
    if (ok.some(l => l.sourceRemaining != null && Number(l.数量) > l.sourceRemaining + 1e-8)) { notify("领料数量超过来源剩余净需求，请减少数量或重新调入来源", "err"); return; }
    if (ok.length === 0) {
      notify("请至少录入一行有效明细(原料编号+数量)", "err");
      return;
    }
    const generation = readGeneration.current;
    setBusy(true);
    try {
      const saved = await rawStockIssueApi.create({
        ...form,
        日期: today(),
        操作员: currentUser(),
        明细: ok.map(({ key: _key, sourceRemaining: _remaining, ...l }) => l),
      });
      if (generation !== readGeneration.current) return;
      applyDetail({ 单头: { id: 0, 单号: saved.单号, ...form, 日期: today() }, 明细: ok });
      void qc.invalidateQueries({ queryKey: ["raw-stock-issue"] });
      invalidateCrossPage(qc);
      try {
        const detail = await rawStockIssueApi.get(saved.单号);
        if (generation !== readGeneration.current) return;
        applyDetail(detail);
        notify(`原料出库单 ${saved.单号} 已创建，请继续审批`, "ok");
      } catch (e) {
        if (generation === readGeneration.current) notify(`原料出库单 ${saved.单号} 已创建，但读取失败，请重新打开该单：${errMsg(e)}`, "err");
      }
    } catch (e) {
      if (generation === readGeneration.current) notify(errMsg(e) || "创建失败", "err");
    } finally {
      if (generation === readGeneration.current) setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (!单号 || busy) return;
    const generation = readGeneration.current;
    setBusy(true);
    try {
      await fn();
      const detail = await rawStockIssueApi.get(单号);
      if (generation !== readGeneration.current) return;
      notify(ok, "ok");
      applyDetail(detail);
      void qc.invalidateQueries({ queryKey: ["raw-stock-issue"] });
      invalidateCrossPage(qc);
    } catch (e) {
      if (generation === readGeneration.current) notify(errMsg(e) || "操作失败", "err");
    } finally {
      if (generation === readGeneration.current) setBusy(false);
    }
  };

  const remove = async () => {
    if (!单号) return;
    setBusy(true);
    try {
      await rawStockIssueApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["raw-stock-issue"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (key: number, patch: Partial<EditLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const 数量合计 = rawIssueQuantitySummary(lines);

  const listQuery = useQuery({
    queryKey: ["raw-stock-issue", "list", page, keyword],
    queryFn: () => rawStockIssueApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printRawDoc(
      `原料出库表 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 日期: header?.日期 ?? today(), 操作员: header?.操作员 ?? currentUser() },
        明细: lines as unknown as Record<string, unknown>[],
      },
      PRINT_CFG,
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "import", label: "按啤机采购单领料", icon: FolderOpen, perm: "保存", disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void openDemandPicker() },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || stage === 3 || busy, disabledTitle: !opened ? "先打开单据" : stage === 3 ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
  ];
  // 三级流转动作(对照老系统操作列可见性)
  const auditActions: DocAction[] = [
    {
      key: "sup", label: "主管审核", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 0 || busy || access.data?.canSupervisor !== true,
      disabledTitle: !opened ? "先打开单据" : stage !== 0 ? "不在主管审核环节" : access.data?.canSupervisor !== true ? "当前原料岗位无此阶段操作权限" : undefined,
      onClick: () => void act(() => rawStockIssueApi.supervisorApprove(单号), "主管已审核"),
    },
    {
      key: "mgr", label: "经理审核", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 1 || busy || access.data?.canManager !== true,
      disabledTitle: !opened ? "先打开单据" : stage !== 1 ? "不在经理审核环节" : access.data?.canManager !== true ? "当前原料岗位无此阶段操作权限" : undefined,
      onClick: () => void act(() => rawStockIssueApi.managerApprove(单号), "啤机审核完成，已通知原料仓负责人确认出库"),
    },
    {
      key: "audit", label: "仓管确认出库", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 2 || busy || access.data?.canWarehousePost !== true,
      disabledTitle: !opened ? "先打开单据" : stage !== 2 ? "不在审核下发环节" : access.data?.canWarehousePost !== true ? "当前原料岗位无此阶段操作权限" : undefined,
      onClick: () => void act(() => rawStockIssueApi.approve(单号), "已确认出库，库存已扣减"),
    },
    {
      key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true,
      disabled: !opened || stage !== 3 || busy || access.data?.canReverse !== true,
      disabledTitle: !opened ? "先打开单据" : stage !== 3 ? "单据未审核下发" : access.data?.canReverse !== true ? "当前原料岗位无此阶段操作权限" : undefined,
      onClick: () => void act(() => rawStockIssueApi.unapprove(单号), "已反审核"),
    },
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
            description="缺少「原料出库表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          原料出库表{tab === "doc" && (readOnly ? ` · ${单号}` : "(新建)")}
        </h1>
        {tab === "doc" && header && <StatusBadge header={header} />}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: "原料出库表" },
              { key: "query" as const, label: "原料出库查询" },
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
            <FlowSteps steps={["领料申请", "主管审核", "啤机审核并通知", "仓管确认出库"]} current={stage} />
          )}
        </div>
      </div>

      {tab === "query" ? (
        <PlasticDocQueryPanel cfg={QUERY_CFG} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            {access.isError && <p role="alert" className="text-sm text-[#dc2626]">原料岗位权限加载失败，审核暂不可用。<button type="button" className="f-btn px-3" onClick={() => void access.refetch()}>重试</button></p>}
            <DocToolbar actions={auditActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={tailActions} menuKey={MENU} />
          </div>

          {/* 单头表单(对照老系统 Form) */}
          <div className="f-panel p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4 lg:grid-cols-5">
              <FormField label="生产车间">
                <Input
                  className={inputCls}
                  aria-label="生产车间"
                  disabled={readOnly}
                  value={form.生产车间}
                  onChange={(e) => setFormState((f) => ({ ...f, 生产车间: e.target.value }))}
                />
              </FormField>
              <FormField label="日期">
                <Input className={inputCls} aria-label="日期" disabled value={date10(header?.日期) || today()} />
              </FormField>
              <FormField label="制单人">
                <div className="relative flex gap-2">
                  <Input
                    className={inputCls}
                    aria-label="制单人"
                    readOnly
                    placeholder="点「选择」挑人"
                    value={form.制单人}
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      className="f-btn h-10 shrink-0 px-3.5 text-sm"
                      onClick={() => setEmpOpen(true)}
                    >
                      选择
                    </button>
                  )}
                </div>
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
              <FormField label="领料备注">
                <SearchSelect
                  ariaLabel="领料备注"
                  className={cn(inputCls, "rounded-md border")}
                  disabled={readOnly}
                  value={form.领料备注}
                  options={ISSUE_REMARKS.map((v) => ({ value: v, label: v }))}
                  onChange={(v) => setFormState((f) => ({ ...f, 领料备注: v }))}
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

          {/* 明细(对照老系统 PlasticRawMaterialStockIssueLineTable 列序) */}
          <div className="f-panel overflow-hidden">
            <div className="border-b border-black/8 px-4 py-2.5">
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={readOnly}
                onClick={() => setLines((v) => [...v, { key: nextRowKey(), 数量: 0 }])}
              >
                <Plus className="h-4 w-4" />
                加一行
              </button>
            </div>
            <div className="max-h-[40vh] overflow-auto">
              <table data-freeze className="w-full min-w-[1500px] text-[15px]">
                <thead>
                  <tr className="border-b border-black/8">
                    {["啤机生产单号", "生产单号", "开单日期", "来源啤机采购单号", "啤机外发单号", "原料编号", "原料名称", "产地", "每包重量", "单位", "数量", "备注", "删除"].map(
                      (h) => (
                        <th
                          key={h} data-column-key={h}
                          className={cn(
                            "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                            (h === "每包重量" || h === "数量") && "text-right",
                            h === "删除" && "text-center",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="border-b border-black/6 last:border-0">
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono text-[#3d4a5c]">{l.啤机生产单号 ?? ""}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono")}
                            aria-label="啤机生产单号"
                            disabled={!!l.来源啤机采购单号}
                            value={l.啤机生产单号 ?? ""}
                            onChange={(e) => updateLine(l.key, { 啤机生产单号: e.target.value })}
                          />
                        )}
                      </td>
                      {/* 联动生产制单:可手输,或点「选」从已审核生产制单里挑 */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          {readOnly ? (
                            <span className="f-mono text-[#3d4a5c]">{l.生产单号 ?? ""}</span>
                          ) : (
                            <>
                              <input
                                className={cn(cellInputCls, "f-mono")}
                                aria-label="生产单号"
                                value={l.生产单号 ?? ""}
                                onChange={(e) => updateLine(l.key, { 生产单号: e.target.value })}
                              />
                              <button
                                type="button"
                                aria-label="选生产单"
                                className="f-btn h-8 shrink-0 px-2 text-xs"
                                onClick={() => setProdPickFor(l.key)}
                              >
                                选
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono text-[#3d4a5c]">{date10(l.开单日期)}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono")}
                            aria-label="开单日期"
                            type="date"
                            value={date10(l.开单日期)}
                            onChange={(e) => updateLine(l.key, { 开单日期: e.target.value || undefined })}
                          />
                        )}
                      </td>
                      <td className="f-mono px-3 py-1.5 text-[#3d4a5c]">{l.来源啤机采购单号 ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono text-[#3d4a5c]">{l.啤机外发单号 ?? ""}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono")}
                            aria-label="啤机外发单号"
                            disabled={!!l.来源啤机采购单号}
                            value={l.啤机外发单号 ?? ""}
                            onChange={(e) => updateLine(l.key, { 啤机外发单号: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <input
                            className={cn(cellInputCls, "f-mono")}
                            aria-label="原料编号"
                            disabled={readOnly || !!l.来源啤机采购单号}
                            value={l.原料编号 ?? ""}
                            onChange={(e) => updateLine(l.key, { 原料编号: e.target.value })}
                          />
                          {!readOnly && !l.来源啤机采购单号 && (
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
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono block text-right text-[#1a2330]">{l.每包重量 ?? ""}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono text-right")}
                            aria-label="每包重量"
                            type="number"
                            min={0}
                            disabled={!!l.来源啤机采购单号}
                            value={l.每包重量 ?? ""}
                            onChange={(e) =>
                              updateLine(l.key, {
                                每包重量: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="text-[#3d4a5c]">{l.单位 ?? ""}</span>
                        ) : (
                          <input
                            className={cellInputCls}
                            aria-label="单位"
                            disabled={!!l.来源啤机采购单号}
                            value={l.单位 ?? ""}
                            onChange={(e) => updateLine(l.key, { 单位: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono block text-right text-[#1a2330]">{l.数量 ?? 0}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono text-right")}
                            aria-label="数量"
                            max={l.sourceRemaining}
                            title={l.sourceRemaining == null ? undefined : `来源可申请净量：${l.sourceRemaining} ${l.单位 ?? ""}`}
                            type="number"
                            min={0}
                            value={l.数量 ?? 0}
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
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-center text-sm text-disabled">
                        点「按啤机采购单领料」带入已审核来源的剩余净量；无来源手工领料可加行录入
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 合计(对照老系统 Statistic) */}
            <div className="flex gap-10 border-t border-black/8 px-4 py-3">
              <span className="text-sm text-[#5f6b7d]">
                数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{数量合计}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                制单人:<span className="text-base font-bold text-[#1a2330]">{form.制单人 || currentUser()}</span>
              </span>
            </div>
          </div>
        </>
      )}

      <OpenDocDialog
        title="打开原料出库单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 生产车间"
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

      <PickerDialog open={demandOpen} onClose={() => { setDemandOpen(false); setSelectedSource(null); }} title="按已审核啤机采购单领料" width="sm:max-w-[1050px]" footer={<><button className="f-btn px-4" onClick={() => { setDemandOpen(false); setSelectedSource(null); }}>取消</button><button className="f-btn f-btn-cyan px-4" disabled={readOnly || !sourceDetail.data || sourceDetail.isFetching || sourceDetail.data.单号 !== selectedSource || !sourceDetail.data.明细.some(l => l.可申请数量 > 0)} onClick={importSource}>带入剩余净量</button></>}>
        <p className="mb-3 text-sm text-[#5f6b7d]">仅按来源已保存的原料净量领料，扣除所有已保存申请；不带入采购备料包数或 0.5% 发料参考量。</p>
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setSourcePage(1); setSourceKeyword(sourceInput.trim()); setSelectedSource(null); }}><input className="f-input" aria-label="领料来源关键字" placeholder="啤机采购单号 / 供应商" value={sourceInput} onChange={e => setSourceInput(e.target.value)} /><button className="f-btn px-4" type="submit">查询来源</button></form>
        {sources.isLoading && <p role="status">正在读取已审核来源…</p>}
        {sources.isError && <div role="alert">来源列表加载失败。<button className="f-btn px-3" onClick={() => void sources.refetch()}>重试来源</button></div>}
        <div className="overflow-auto"><table className="w-full min-w-[650px] text-sm"><thead><tr>{["啤机采购单号", "订购日期", "供应商", "原料种数", "操作"].map(h => <th key={h} className={pickerThCls}>{h}</th>)}</tr></thead><tbody>{(sources.data?.items ?? []).map(d => <tr key={d.单号} className="border-b border-black/6"><td className="px-3 py-2">{d.单号}</td><td>{date10(d.订购日期)}</td><td>{d.供应商名称}</td><td>{d.原料种数}</td><td><button className="f-btn px-3" onClick={() => setSelectedSource(d.单号)}>查看净量</button></td></tr>)}</tbody></table></div>
        {!sources.isLoading && !sources.isError && sources.data?.items.length === 0 && <p className="py-4 text-sm">没有符合条件的已审核来源。</p>}
        <div className="my-3 flex items-center gap-3 text-sm"><span>共 {sources.data?.total ?? 0} 单</span><button className="f-btn px-3" disabled={sourcePage <= 1 || sources.isFetching} onClick={() => { setSourcePage(p => p - 1); setSelectedSource(null); }}>上一页</button><span>{sourcePage} / {Math.max(1, Math.ceil((sources.data?.total ?? 0) / 20))}</span><button className="f-btn px-3" disabled={sourcePage * 20 >= (sources.data?.total ?? 0) || sources.isFetching} onClick={() => { setSourcePage(p => p + 1); setSelectedSource(null); }}>下一页</button></div>
        {selectedSource && <h3 className="mt-4 font-semibold">{selectedSource} · 原料净量</h3>}
        {sourceDetail.isLoading && <p role="status">正在读取来源净量…</p>}
        {sourceDetail.isError && <div role="alert">来源净量读取失败。<button className="f-btn px-3" onClick={() => void sourceDetail.refetch()}>重试净量</button></div>}
        {sourceDetail.data && <div className="overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr>{["原料编号", "原料名称", "净需求（KG）", "单位", "总净量", "已申请", "可申请净量"].map(h => <th className={pickerThCls} key={h}>{h}</th>)}</tr></thead><tbody>{sourceDetail.data.明细.map(l => <tr key={l.原料编号} className="border-t border-black/8"><td className="px-3 py-2">{l.原料编号}</td><td>{l.原料名称}</td><td>{l.需求数量KG}</td><td>{l.单位}</td><td>{l.需求数量}</td><td>{l.已申请数量}</td><td>{l.可申请数量}</td></tr>)}</tbody></table></div>}
      </PickerDialog>

      <EmployeePickerDialog
        purpose="raw-issue-maker"
        open={empOpen}
        onPick={(姓名) => setFormState((f) => ({ ...f, 制单人: 姓名 }))}
        onClose={() => setEmpOpen(false)}
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
          });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ProductionPickerDialog
        open={prodPickFor !== null}
        onPick={(row) => {
          if (prodPickFor === null) return;
          updateLine(prodPickFor, { 生产单号: row.生产单号 ?? undefined });
        }}
        onClose={() => setProdPickFor(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该原料出库单?"
        description={单号 ? `原料出库单 ${单号} 删除后不可恢复` : undefined}
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
