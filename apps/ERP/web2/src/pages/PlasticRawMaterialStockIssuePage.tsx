// 原料出库表(/plastic-raw-material-stock-issue;单据+查询双页签)。对照老系统:
// web/src/pages/plastics/PlasticRawMaterialStockIssuePage.tsx(单据)
// + PlasticRawMaterialStockIssueQueryPage.tsx(查询,默认汇总;多 领料备注/制单人 过滤)
// + PlasticRawMaterialStockIssueQueryDetailDrawer.tsx(双击明细行弹单据详情)。
// 单据:新建/打开/保存(POST create)/删除/打印;三级流转 主管审核->经理审核->审核(下发)->反审核;
// 「调入清单」弹已审核原料生产需求表,点单号把明细带入(数量=需求数量包,带出 啤机生产单号/开单日期)
// 并回填 生产车间/领料备注;制单人走人事档案选择器(必填)。
// 权限菜单:单据「原料出库表」/查询「原料出库查询」(MenuCatalog.cs:73/85 实证)。
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
import {
  plasticRawMaterialMasterApi,
  rawMaterialDemandApi,
  rawStockIssueApi,
} from "@/api/endpoints";
import type { PlasticRawMaterialRow, RMDHeader, RSIHeader, RSILine } from "@/api/types";
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
  const [demands, setDemands] = useState<RMDHeader[]>([]);
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null); // 明细行选生产制单(联动)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  const header = opened?.单头 ?? null;
  const stage = header ? tripleAuditStage(header) : 0;
  const readOnly = opened !== null;
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
      setBusy(true);
      try {
        applyDetail(await rawStockIssueApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开原料出库单失败", "err");
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
    setFormState({ 生产车间: "", 制单人: "", 电脑单号: "", 领料备注: "生产领料", 备注: "" });
    setOpened(null);
    setLines([]);
  };

  // 调入清单:弹已审核原料生产需求表,点单号调入明细(数量=需求数量包;对照老系统 pickDemand)
  const openDemandPicker = async () => {
    try {
      const res = await rawMaterialDemandApi.list(1, 50, "");
      setDemands(res.items.filter((o) => o.审核 === "1"));
      setDemandOpen(true);
    } catch (e) {
      notify(errMsg(e) || "加载原料生产需求表失败", "err");
    }
  };
  const pickDemand = async (no: string) => {
    try {
      const d = await rawMaterialDemandApi.get(no);
      const h = d.单头 ?? ({} as RMDHeader);
      const imported: EditLine[] = (d.明细 ?? []).map((l) => ({
        key: nextRowKey(),
        啤机生产单号: h.啤机生产单号,
        开单日期: date10(h.开单日期) || undefined,
        啤机外发单号: undefined,
        原料编号: l.原料编号,
        原料名称: l.原料名称,
        每包重量: l.每包重量 ?? undefined,
        单位: l.单位,
        数量: Number(l.需求数量包 ?? 0),
      }));
      setLines(imported);
      setFormState((f) => ({ ...f, 生产车间: h.生产车间 ?? "", 领料备注: h.领料备注 ?? "生产领料" }));
      setDemandOpen(false);
      notify(`已调入需求表 ${no} 的 ${imported.length} 行明细`, "ok");
    } catch (e) {
      notify(errMsg(e) || "调入需求表失败", "err");
    }
  };

  const save = async () => {
    if (readOnly || busy) return;
    if (!form.制单人.trim()) {
      notify("请选制单人", "err");
      return;
    }
    const ok = lines.filter((l) => l.原料编号 && Number(l.数量 ?? 0) > 0);
    if (ok.length === 0) {
      notify("请至少录入一行有效明细(原料编号+数量)", "err");
      return;
    }
    setBusy(true);
    try {
      await rawStockIssueApi.create({
        ...form,
        日期: today(),
        操作员: currentUser(),
        明细: ok.map(({ key: _key, ...l }) => l),
      });
      notify("原料出库单已创建", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["raw-stock-issue"] });
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
      applyDetail(await rawStockIssueApi.get(单号));
      void qc.invalidateQueries({ queryKey: ["raw-stock-issue"] });
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

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);

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
    { key: "import", label: "调入清单", icon: FolderOpen, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void openDemandPicker() },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || stage === 3 || busy, disabledTitle: !opened ? "先打开单据" : stage === 3 ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
  ];
  // 三级流转动作(对照老系统操作列可见性)
  const auditActions: DocAction[] = [
    {
      key: "sup", label: "主管审核", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 0 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 0 ? "不在主管审核环节" : undefined,
      onClick: () => void act(() => rawStockIssueApi.supervisorApprove(单号), "主管已审核"),
    },
    {
      key: "mgr", label: "经理审核", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 1 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 1 ? "不在经理审核环节" : undefined,
      onClick: () => void act(() => rawStockIssueApi.managerApprove(单号), "经理已审核"),
    },
    {
      key: "audit", label: "审核(下发)", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 2 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 2 ? "不在审核下发环节" : undefined,
      onClick: () => void act(() => rawStockIssueApi.approve(单号), "已审核"),
    },
    {
      key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true,
      disabled: !opened || stage !== 3 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 3 ? "单据未审核下发" : undefined,
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
            <FlowSteps steps={["开单", "主管审核", "经理审核", "审核下发"]} current={stage} />
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
                    {["啤机生产单号", "生产单号", "开单日期", "啤机外发单号", "原料编号", "原料名称", "产地", "每包重量", "单位", "数量", "备注", "删除"].map(
                      (h) => (
                        <th
                          key={h}
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
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono text-[#3d4a5c]">{l.啤机外发单号 ?? ""}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono")}
                            aria-label="啤机外发单号"
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
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="f-mono block text-right text-[#1a2330]">{l.每包重量 ?? ""}</span>
                        ) : (
                          <input
                            className={cn(cellInputCls, "f-mono text-right")}
                            aria-label="每包重量"
                            type="number"
                            min={0}
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
                      <td colSpan={11} className="px-3 py-6 text-center text-sm text-disabled">
                        点「加一行」录入,或「调入清单」从已审核生产需求表带入明细
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

      {/* 调入清单:已审核原料生产需求表(对照老系统选择弹窗) */}
      <PickerDialog
        open={demandOpen}
        onClose={() => setDemandOpen(false)}
        title="选择已审核原料生产需求表调入明细"
        width="sm:max-w-[720px]"
      >
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["单号", "啤机生产单号", "生产车间", "数量KG"].map((h) => (
                <th key={h} className={pickerThCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {demands.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-disabled">
                  没有已审核的原料生产需求表
                </td>
              </tr>
            ) : (
              demands.map((d) => (
                <tr
                  key={d.单号}
                  className="cursor-pointer border-b border-black/6 last:border-0 hover:bg-black/[0.04]"
                  onClick={() => d.单号 && void pickDemand(d.单号)}
                >
                  <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">
                    {d.单号}
                  </td>
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                    {d.啤机生产单号}
                  </td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{d.生产车间}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{d.数量KG ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </PickerDialog>

      <EmployeePickerDialog
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
