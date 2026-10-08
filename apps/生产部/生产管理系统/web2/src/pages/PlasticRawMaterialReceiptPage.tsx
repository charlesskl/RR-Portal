// 原料入仓单(/plastic-raw-material-receipt;单据+查询双页签)。对照老系统:
// web/src/pages/plastics/PlasticRawMaterialReceiptPage.tsx(单据)
// + PlasticRawMaterialReceiptQueryPage.tsx(查询,默认汇总页签)
// + PlasticRawMaterialReceiptQueryDetailDrawer.tsx(双击明细行弹单据详情)。
// 单据:新建/打开/保存(POST create)/审核(=入库存)/反审核/删除/打印;打开后查看模式;
// 「订单调入」弹已审核原料采购订单,点单号把明细带入(数量=订货数量)并回填 订单单号;
// 无「单价」位不出 单价/金额 列与金额合计。
// 权限菜单:单据「原料入仓单」/查询「原料入仓查询」(MenuCatalog.cs:70/83 实证)。
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
  rawPurchaseOrderApi,
  rawReceiptApi,
} from "@/api/endpoints";
import type { PlasticRawMaterialRow, RMPOHeader, RMRHeader, RMRLine, SupplierRow } from "@/api/types";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  LINE_PRICE_TYPES,
  RECEIPT_PRICE_TYPES,
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
import { Checkbox } from "@/components/ui/checkbox";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { SupplierPickerDialog } from "@/components/doc/SupplierPickerDialog";
import { RawMaterialPickerDialog } from "@/components/doc/RawMaterialPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { PlasticDocQueryPanel, type PlasticDocQueryCfg, type PlasticQueryCol } from "./PlasticDocQueryPanel";

const MENU = "原料入仓单";
const currentUser = () => getUser() || "admin";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

interface EditLine extends RMRLine {
  key: number;
}

// ---------- 查询页签配置(列序逐字对照老系统 ReceiptQueryPage + DetailDrawer) ----------

const QUERY_CFG: PlasticDocQueryCfg = {
  queryKey: "raw-receipt-query",
  menu: "原料入仓查询",
  title: "原料入仓查询",
  keywordPlaceholder: "原料编号/名称/单号/供应商",
  defaultTab: "summary",
  fetchCategories: () => plasticRawMaterialMasterApi.categories(),
  fetchDetail: (q) => rawReceiptApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchSummary: (q) => rawReceiptApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: (priceHidden): PlasticQueryCol[] => [
    { title: "原料编号", key: "原料编号", kind: "doc", size: 10 },
    { title: "原料名称", key: "原料名称", size: 16 },
    { title: "产地", key: "产地", size: 9 },
    { title: "单位", key: "单位", size: 6 },
    { title: "入仓数量", key: "入仓数量", kind: "num", size: 8 },
    ...(priceHidden ? [] : [{ title: "金额", key: "金额", kind: "money", size: 8 } as PlasticQueryCol]),
  ],
  detailCols: (priceHidden): PlasticQueryCol[] => [
    { title: "日期", key: "日期", kind: "date", size: 8 },
    { title: "单号", key: "单号", kind: "doc", size: 9 },
    { title: "入库单号", key: "入库单号", kind: "mono", size: 9 },
    { title: "订单单号", key: "订单单号", kind: "mono", size: 9 },
    { title: "供应商编号", key: "供应商编号", kind: "mono", size: 8 },
    { title: "供应商名称", key: "供应商名称", size: 11 },
    { title: "原料编号", key: "原料编号", kind: "doc", size: 8 },
    { title: "原料名称", key: "原料名称", size: 13 },
    { title: "产地", key: "产地", size: 7 },
    { title: "单价类型", key: "单价类型", size: 6 },
    { title: "单位", key: "单位", size: 5 },
    { title: "数量", key: "数量", kind: "num", size: 7 },
    ...(priceHidden
      ? []
      : ([
          { title: "单价", key: "单价", kind: "num", size: 6 },
          { title: "金额", key: "金额", kind: "money", size: 7 },
        ] as PlasticQueryCol[])),
    { title: "备注", key: "备注", size: 9 },
    { title: "审核", key: "审核", kind: "audit", size: 6 },
  ],
  drawerTitle: "原料入仓单",
  fetchDoc: (单号) => rawReceiptApi.get(单号) as never,
  drawerHead: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["供应商名称", "供应商名称"],
    ["电脑单号", "电脑单号"],
    ["订单单号", "订单单号"],
    ["审核", "审核"],
  ],
  drawerCols: (priceHidden): PlasticQueryCol[] => [
    { title: "原料编号", key: "原料编号", kind: "mono" },
    { title: "原料名称", key: "原料名称" },
    { title: "产地", key: "产地" },
    { title: "每包重量", key: "每包重量", kind: "num" },
    { title: "单价类型", key: "单价类型" },
    { title: "单位", key: "单位" },
    { title: "数量", key: "数量", kind: "num" },
    ...(priceHidden
      ? []
      : ([
          { title: "单价", key: "单价", kind: "num" },
          { title: "金额", key: "金额", kind: "money" },
        ] as PlasticQueryCol[])),
    { title: "备注", key: "备注" },
  ],
};

// ---------- 打印规格 ----------

const printCfg = (priceHidden: boolean): RawDocPrintCfg => ({
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["供应商", "供应商名称"],
    ["电脑单号", "电脑单号"],
    ["订单单号", "订单单号"],
    ["单价类型", "单价类型"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["原料编号", "原料编号"],
    ["原料名称", "原料名称"],
    ["产地", "产地"],
    ["每包重量", "每包重量"],
    ["单价类型", "单价类型"],
    ["单位", "单位"],
    ["数量", "数量"],
    ...(priceHidden ? [] : ([["单价", "单价"], ["金额", "金额"]] as [string, string][])),
    ["备注", "备注"],
  ],
});

// ---------- 打开单据弹窗列(对照老系统 listColumns) ----------

const openCol = createColumnHelper<RMRHeader>();
const listColumns: ColumnDef<RMRHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 20,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("供应商名称", { header: "供应商", size: 22 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 11,
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 13,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("订单单号", {
    header: "订单单号",
    size: 16,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
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

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export default function PlasticRawMaterialReceiptPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [opened, setOpened] = useState<{ 单头?: RMRHeader; 明细: RMRLine[] } | null>(null);
  const [form, setFormState] = useState({
    供应商编号: "",
    供应商名称: "",
    电脑单号: "",
    订单单号: "",
    单价类型: "格式HK$/Lb",
    备注: "",
  });
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supOpen, setSupOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orders, setOrders] = useState<RMPOHeader[]>([]);
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

  const applyDetail = useCallback((d: { 单头?: RMRHeader; 明细: RMRLine[] }) => {
    const h = d.单头 ?? ({} as RMRHeader);
    setFormState({
      供应商编号: h.供应商编号 ?? "",
      供应商名称: h.供应商名称 ?? "",
      电脑单号: h.电脑单号 ?? "",
      订单单号: h.订单单号 ?? "",
      单价类型: h.单价类型 ?? "格式HK$/Lb",
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
        applyDetail(await rawReceiptApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开原料入仓单失败", "err");
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
    setFormState({
      供应商编号: "",
      供应商名称: "",
      电脑单号: "",
      订单单号: "",
      单价类型: "格式HK$/Lb",
      备注: "",
    });
    setOpened(null);
    setLines([]);
  };

  // 订单调入:弹已审核原料采购订单列表,点单号调入明细(数量=订货数量;对照老系统 pickOrder)
  const openOrderPicker = async () => {
    try {
      const res = await rawPurchaseOrderApi.list(1, 50, "");
      setOrders(res.items.filter((o) => o.审核 === "1"));
      setOrderOpen(true);
    } catch (e) {
      notify(errMsg(e) || "加载原料采购订单失败", "err");
    }
  };
  const pickOrder = async (no: string) => {
    try {
      const d = await rawPurchaseOrderApi.get(no);
      const imported: EditLine[] = (d.明细 ?? []).map((l) => ({
        key: nextRowKey(),
        原料编号: l.原料编号,
        原料名称: l.原料名称,
        单位: l.单位,
        单价类型: l.单价类型,
        数量: Number(l.订货数量 ?? 0),
        单价: l.单价 ?? undefined,
        备注: l.备注,
      }));
      setLines(imported);
      setFormState((f) => ({ ...f, 订单单号: no }));
      setOrderOpen(false);
      notify(`已调入采购订单 ${no} 的 ${imported.length} 行明细`, "ok");
    } catch (e) {
      notify(errMsg(e) || "调入采购订单失败", "err");
    }
  };

  const save = async () => {
    if (readOnly || busy) return;
    if (!form.供应商名称.trim()) {
      notify("请选供应商", "err");
      return;
    }
    const ok = lines.filter((l) => l.原料编号 && Number(l.数量 ?? 0) > 0);
    if (ok.length === 0) {
      notify("请至少录入一行有效明细(原料编号+数量)", "err");
      return;
    }
    setBusy(true);
    try {
      await rawReceiptApi.create({
        ...form,
        日期: today(),
        操作员: currentUser(),
        明细: ok.map(({ key: _key, ...l }) => l),
      });
      notify("原料入仓单已创建", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["raw-receipt"] });
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
      applyDetail(await rawReceiptApi.get(单号));
      void qc.invalidateQueries({ queryKey: ["raw-receipt"] });
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
      await rawReceiptApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["raw-receipt"] });
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
  const 金额合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0) * Number(l.单价 ?? 0), 0);

  const listQuery = useQuery({
    queryKey: ["raw-receipt", "list", page, keyword],
    queryFn: () => rawReceiptApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printRawDoc(
      `原料入仓单 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 日期: header?.日期 ?? today(), 操作员: header?.操作员 ?? currentUser() },
        明细: lines.map((l) => ({
          ...l,
          金额: (Number(l.数量 ?? 0) * Number(l.单价 ?? 0)).toFixed(2),
        })) as unknown as Record<string, unknown>[],
      },
      printCfg(priceHidden),
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
    { key: "import", label: "订单调入", icon: FolderOpen, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void openOrderPicker() },
  ];
  const auditActions: DocAction[] = [
    { key: "audit", label: "审核", icon: CheckCircle, perm: "审核", success: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => void act(() => rawReceiptApi.approve(单号), "已审核") },
    { key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true, disabled: !opened || !audited || busy, disabledTitle: !opened ? "先打开单据" : "单据未审核", onClick: () => void act(() => rawReceiptApi.unapprove(单号), "已反审核") },
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
            description="缺少「原料入仓单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const lineAmt = (l: EditLine) => (Number(l.数量 ?? 0) * Number(l.单价 ?? 0)).toFixed(2);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签(对照老系统 DocQueryTabs) */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          原料入仓单{tab === "doc" && (readOnly ? ` · ${单号}` : "(新建)")}
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
              { key: "doc" as const, label: "原料入仓单" },
              { key: "query" as const, label: "原料入仓查询" },
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
          {tab === "doc" && <FlowSteps steps={["开单", "审核入仓"]} current={audited ? 1 : 0} />}
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4 lg:grid-cols-6">
              <FormField label="供应商">
                <div className="relative flex gap-2">
                  <Input
                    className={inputCls}
                    aria-label="供应商"
                    readOnly
                    placeholder="点「选择」挑供应商"
                    value={form.供应商名称}
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      className="f-btn h-10 shrink-0 px-3.5 text-sm"
                      onClick={() => setSupOpen(true)}
                    >
                      选择
                    </button>
                  )}
                </div>
              </FormField>
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
              <FormField label="订单单号">
                <div className="relative flex gap-2">
                  <Input
                    className={inputCls}
                    aria-label="订单单号"
                    readOnly
                    placeholder="点「调入」选采购订单"
                    value={form.订单单号}
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      className="f-btn h-10 shrink-0 px-3.5 text-sm"
                      onClick={() => void openOrderPicker()}
                    >
                      调入
                    </button>
                  )}
                </div>
              </FormField>
              <FormField label="单价类型">
                <SearchSelect
                  ariaLabel="单价类型"
                  className={cn(inputCls, "rounded-md border")}
                  disabled={readOnly}
                  value={form.单价类型}
                  options={RECEIPT_PRICE_TYPES.map((v) => ({ value: v, label: v }))}
                  onChange={(v) => setFormState((f) => ({ ...f, 单价类型: v }))}
                />
              </FormField>
              <FormField label="操作员">
                <Input className={inputCls} aria-label="操作员" disabled value={header?.操作员 ?? currentUser()} />
              </FormField>
            </div>
            <div className="mt-4">
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

          {/* 明细(对照老系统 PlasticRawMaterialReceiptLineTable 列序) */}
          <div className="f-panel overflow-hidden">
            <div className="border-b border-black/8 px-4 py-2.5">
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={readOnly}
                onClick={() => setLines((v) => [...v, { key: nextRowKey(), 数量: 0, 单价类型: "含税" }])}
              >
                <Plus className="h-4 w-4" />
                加一行
              </button>
            </div>
            <div className="max-h-[40vh] overflow-auto">
              <table data-freeze className="w-full min-w-[1300px] text-[15px]">
                <thead>
                  <tr className="border-b border-black/8">
                    {[
                      "原料编号",
                      "原料名称",
                      "产地",
                      "每包重量",
                      "单价类型",
                      "单位",
                      "数量",
                      "备品",
                      ...(priceHidden ? [] : ["单价", "金额"]),
                      "备注",
                      "删除",
                    ].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                          ["每包重量", "数量", "单价", "金额"].includes(h) && "text-right",
                          (h === "删除" || h === "备品") && "text-center",
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
                          <span className="text-[#3d4a5c]">{l.单价类型 ?? ""}</span>
                        ) : (
                          <SearchSelect
                            ariaLabel="行单价类型"
                            className={cellInputCls}
                            value={l.单价类型 ?? "含税"}
                            options={LINE_PRICE_TYPES.map((v) => ({ value: v, label: v }))}
                            onChange={(v) => updateLine(l.key, { 单价类型: v })}
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
                      <td className="px-2 py-1.5 text-center">
                        {/* 供应商多送的备品:勾选后允许超订单数量入库,不占订单欠数 */}
                        {readOnly ? (
                          l.备品 === "1" ? (
                            <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-medium text-[#15803d]">
                              备品
                            </span>
                          ) : (
                            ""
                          )
                        ) : (
                          <Checkbox
                            aria-label="备品"
                            title="供应商多送的备品:允许超订单数量入库,不占订单欠数"
                            className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                            checked={l.备品 === "1"}
                            onCheckedChange={(v) => updateLine(l.key, { 备品: v === true ? "1" : undefined })}
                          />
                        )}
                      </td>
                      {!priceHidden && (
                        <td className="px-2 py-1.5">
                          {readOnly ? (
                            <span className="f-mono block text-right text-[#1a2330]">{l.单价 ?? ""}</span>
                          ) : (
                            <input
                              className={cn(cellInputCls, "f-mono text-right")}
                              aria-label="单价"
                              type="number"
                              min={0}
                              value={l.单价 ?? 0}
                              onChange={(e) => updateLine(l.key, { 单价: Number(e.target.value || 0) })}
                            />
                          )}
                        </td>
                      )}
                      {!priceHidden && (
                        <td className="f-mono px-3 py-1.5 text-right text-[#1a2330]">{lineAmt(l)}</td>
                      )}
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
                      <td
                        colSpan={priceHidden ? 9 : 11}
                        className="px-3 py-6 text-center text-sm text-disabled"
                      >
                        点「加一行」录入,或「订单调入」从已审核采购订单带入明细
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 合计(对照老系统 Statistic) */}
            <div className="flex gap-10 border-t border-black/8 px-4 py-3">
              <span className="text-sm text-[#5f6b7d]">
                数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{数量合计.toFixed(2)}</span>
              </span>
              {!priceHidden && (
                <span className="text-sm text-[#5f6b7d]">
                  金额合计:<span className="f-mono text-base font-bold text-[#1a2330]">{金额合计.toFixed(2)}</span>
                </span>
              )}
              <span className="text-sm text-[#5f6b7d]">
                制单人:<span className="text-base font-bold text-[#1a2330]">{header?.操作员 ?? currentUser()}</span>
              </span>
            </div>
          </div>
        </>
      )}

      <OpenDocDialog
        title="打开原料入仓单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 供应商"
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

      {/* 订单调入:已审核原料采购订单(对照老系统选择弹窗) */}
      <PickerDialog
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        title="选择已审核原料采购订单调入明细"
        width="sm:max-w-[720px]"
      >
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["单号", "供应商", "数量", "订购日期"].map((h) => (
                <th key={h} className={pickerThCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-disabled">
                  没有已审核的原料采购订单
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr
                  key={o.单号}
                  className="cursor-pointer border-b border-black/6 last:border-0 hover:bg-black/[0.04]"
                  onClick={() => o.单号 && void pickOrder(o.单号)}
                >
                  <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">
                    {o.单号}
                  </td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{o.供应商名称}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{o.数量 ?? ""}</td>
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                    {date10(o.订购日期)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </PickerDialog>

      <SupplierPickerDialog
        open={supOpen}
        onPick={(row: SupplierRow) =>
          setFormState((f) => ({ ...f, 供应商编号: row.供应商编号 ?? "", 供应商名称: row.供应商名称 ?? "" }))
        }
        onClose={() => setSupOpen(false)}
      />
      <RawMaterialPickerDialog
        open={matPickFor !== null}
        onPick={(row: PlasticRawMaterialRow) => {
          if (matPickFor === null) return;
          updateLine(matPickFor, {
            原料编号: row.物料编号 ?? undefined,
            原料名称: row.物料名称 ?? undefined,
            单位: row.单位 ?? undefined,
            单价: row.单价 ?? undefined,
          });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该原料入仓单?"
        description={单号 ? `原料入仓单 ${单号} 删除后不可恢复` : undefined}
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
