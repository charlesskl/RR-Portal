// 塑胶报废单(/plastic-scraps;单级审核=出库存过账)。
// 对照老系统 web/src/App.tsx:278(DocQueryTabs 单据+查询双页签)
// + PlasticSupplierDocFormPage.tsx(cfg=plastic-scraps:仓库为手填文本;出库单号可录;选入仓单带出)
// + PlasticScrapQueryPage.tsx(查询页签走共享 PlasticDocQueryPanel)。
// 权限菜单=塑胶报废单(MenuCatalog.cs:52 实证:塑胶仓储组);查询页签=塑胶报废查询(L63)。
// 与塑胶退仓单的差异:老系统报废单无批量审核(保持 parity);仓库手填不下拉;多出库单号字段。
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "react-router";
import {
  ArrowCounterClockwise,
  CheckCircle,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Plus,
  Printer,
  Trash,
} from "@phosphor-icons/react";
import {
  plasticMaterialSettingsApi,
  plasticReceiptApi,
  plasticScrapApi,
} from "@/api/endpoints";
import type {
  PlasticMaterialRow,
  PlasticReceiptHeader,
  ProductionTrackingRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { prefillDefaultWarehouse } from "@/lib/plasticIssue";
import {
  printPlasticDoc,
  receiptLineToScrapLine,
  sumScrapAmount,
  sumScrapQty,
  toSubmitScrapLine,
  validScrapLines,
  type PlasticDocPrintCfg,
  type ScrapEditLine,
} from "@/lib/plasticDocs";
import { usePerms } from "@/hooks/usePerms";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocHeaderCard, type HeaderField } from "@/components/doc/DocHeaderCard";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { DocToast } from "@/components/doc/DocToast";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { SupplierPickerDialog } from "@/components/doc/SupplierPickerDialog";
import { PlasticMaterialPickerDialog } from "@/components/doc/PlasticMaterialPickerDialog";
import { ProductionPickerDialog } from "@/components/doc/ProductionPickerDialog";
import {
  PlasticDocQueryPanel,
  type PlasticDocQueryCfg,
  type PlasticQueryCol,
} from "./PlasticDocQueryPanel";

const MENU = "塑胶报废单";
const QUERY_MENU = "塑胶报废查询";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const today = () => new Date().toISOString().slice(0, 10); // ISO:后端 DateTime 反序列化要求

let rowSeq = 1;
const uid = () => rowSeq++;

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

// 打印规格(对照老系统塑胶报废表单页 window.print() 口径;新系统开新窗口渲染)
const PRINT_CFG = (hidePrice: boolean): PlasticDocPrintCfg => ({
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["供应商", "供应商名称"],
    ["仓库", "仓库"],
    ["出库单号", "出库单号"],
    ["入库单号", "入仓单号"],
    ["电脑单号", "电脑单号"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["生产单号", "生产单号"],
    ["款号", "款号"],
    ["物料编号", "物料编号"],
    ["物料名称", "物料名称"],
    ["颜色", "颜色"],
    ["塑胶货号", "塑胶货号"],
    ["单位", "单位"],
    ["数量", "数量"],
    ...(hidePrice ? [] : ([["单价", "单价"], ["金额", "金额"]] as [string, string][])),
    ["备注", "备注"],
  ],
});

// 查询页签配置(列序逐字对照老系统 PlasticScrapQueryPage)
const QUERY_CFG: PlasticDocQueryCfg = {
  queryKey: "plastic-scrap-query",
  menu: QUERY_MENU,
  title: "塑胶报废查询",
  keywordPlaceholder: "物料编号/名称/生产单号/款号",
  fetchDetail: (q) => plasticScrapApi.queryDetail(q) as Promise<Record<string, unknown>[]>,
  fetchSummary: (q) => plasticScrapApi.querySummary(q) as Promise<Record<string, unknown>[]>,
  detailCols: (priceHidden) => [
    { title: "日期", key: "日期", kind: "date", size: 8 },
    { title: "单号", key: "单号", kind: "doc", size: 9 },
    { title: "生产单号", key: "生产单号", kind: "mono", size: 9 },
    { title: "款号", key: "款号", size: 7 },
    { title: "报废部门", key: "报废部门", size: 8 },
    { title: "报废人", key: "报废人", size: 6 },
    { title: "物料编号", key: "物料编号", kind: "mono", size: 8 },
    { title: "物料名称", key: "物料名称", size: 11 },
    { title: "颜色", key: "颜色", size: 7 },
    { title: "塑胶货号", key: "塑胶货号", size: 7 },
    { title: "共用物料", key: "共用物料", size: 8 },
    { title: "共用货号", key: "共用货号", size: 7 },
    { title: "单位", key: "单位", size: 4 },
    { title: "数量", key: "数量", kind: "num", size: 6 },
    ...(priceHidden
      ? []
      : ([
          { title: "单价", key: "单价", kind: "num", size: 6 },
          { title: "金额", key: "金额", kind: "money", size: 7 },
        ] as PlasticQueryCol[])),
    { title: "备注", key: "备注", size: 9 },
    { title: "审核", key: "审核", kind: "audit", size: 6 },
  ],
  summaryCols: (priceHidden) => [
    { title: "物料编号", key: "物料编号", kind: "mono", size: 9 },
    { title: "物料名称", key: "物料名称", size: 12 },
    { title: "颜色", key: "颜色", size: 8 },
    { title: "塑胶货号", key: "塑胶货号", size: 8 },
    { title: "共用物料", key: "共用物料", size: 9 },
    { title: "共用货号", key: "共用货号", size: 8 },
    { title: "单位", key: "单位", size: 5 },
    { title: "数量", key: "数量", kind: "num", size: 8 },
    ...(priceHidden
      ? []
      : ([
          { title: "单价", key: "单价", kind: "num", size: 7 },
          { title: "金额", key: "金额", kind: "money", size: 9 },
        ] as PlasticQueryCol[])),
  ],
  drawerTitle: "塑胶报废单",
  fetchDoc: (单号) => plasticScrapApi.get(单号),
  drawerHead: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["报废部门", "报废部门"],
    ["报废人", "报废人"],
    ["审核", "审核"],
  ],
  drawerCols: (priceHidden) => [
    { title: "物料编号", key: "物料编号", kind: "mono" },
    { title: "物料名称", key: "物料名称" },
    { title: "规格", key: "规格" },
    { title: "颜色", key: "颜色" },
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

// ---------- 单头表单状态 ----------
interface HeaderFormState {
  供应商编号: string;
  供应商名称: string;
  出库单号: string;
  入仓单号: string; // 老表单「入仓单号」字段(可选入仓单带出)
  仓库: string;
  备注: string;
}
const emptyHeader = (): HeaderFormState => ({
  供应商编号: "",
  供应商名称: "",
  出库单号: "",
  入仓单号: "",
  仓库: "",
  备注: "",
});

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- 单据列表弹窗列 ----------
const openCol = createColumnHelper<PlasticReceiptHeader>();
const listColumns: ColumnDef<PlasticReceiptHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 22,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("供应商名称", { header: "供应商", size: 26 }),
  openCol.accessor("仓库", { header: "仓库", size: 14 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 12,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 14,
    cell: (c) => fmtDate(c.getValue()),
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

export default function PlasticScrapPage() {
  const qc = useQueryClient();
  const currentUser = getUser() || "用户";
  const { can } = usePerms();
  const priceHidden = !can(MENU, "单价");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [rows, setRows] = useState<ScrapEditLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptKw, setReceiptKw] = useState("");
  const [receiptPage, setReceiptPage] = useState(1);
  const [materialPickFor, setMaterialPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 首次进入自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: ["plastic-scrap", "first"],
    queryFn: () => plasticScrapApi.list(1, 1),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  const detailQuery = useQuery({
    queryKey: ["plastic-scrap", "detail", 单号],
    queryFn: () => plasticScrapApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["plastic-scrap", "list", page, keyword],
    queryFn: () => plasticScrapApi.list(page, 10, keyword || undefined),
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  // 选入仓单弹窗数据源(塑胶入仓单列表;对照老系统 PlasticReceiptPicker)
  const receiptsQuery = useQuery({
    queryKey: ["plastic-scrap", "receipts", receiptPage, receiptKw],
    queryFn: () => plasticReceiptApi.list(receiptPage, 10, receiptKw || undefined),
    enabled: receiptOpen,
  });
  const receiptTotalPages = receiptsQuery.data
    ? Math.max(1, Math.ceil(receiptsQuery.data.total / 10))
    : 1;

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = header?.审核 === "1";
  const viewLines = useMemo(
    () =>
      (detail?.明细 ?? []).map((l, i) => ({
        key: i + 1,
        生产单号: l.生产单号,
        款号: l.款号,
        物料编号: l.物料编号,
        物料名称: l.物料名称,
        规格: l.规格,
        颜色: l.颜色,
        塑胶货号: l.塑胶货号,
        仓位号: l.仓位号,
        单位: l.单位,
        数量: String(l.数量 ?? 0),
        单价: l.单价 != null ? String(l.单价) : "",
        备注: l.备注,
      })),
    [detail],
  );

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));
  const patchRow = (key: number, patch: Partial<ScrapEditLine>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const reset = () => {
    setMode("new");
    set单号(null);
    setFormState(emptyHeader());
    setRows([]);
  };

  // 选物料:回填名称/规格/颜色/仓位号/单位;另按塑胶物料设置预填表头默认仓库(不覆盖已填)
  const fillFromMaterial = (m: PlasticMaterialRow) => {
    if (materialPickFor === null) return;
    patchRow(materialPickFor, {
      物料编号: m.物料编号 ?? "",
      物料名称: m.物料名称 ?? "",
      规格: m.规格 ?? undefined,
      颜色: m.颜色 ?? undefined,
      仓位号: m.仓位号 ?? undefined,
      单位: m.单位 ?? undefined,
    });
    setMaterialPickFor(null);
    const code = (m.物料编号 ?? "").trim();
    if (code) {
      plasticMaterialSettingsApi
        .lookup(code)
        .then((s) => {
          const wh = prefillDefaultWarehouse(form.仓库, s?.默认仓库);
          if (wh) setForm({ 仓库: wh });
        })
        .catch(() => {
          /* 未设置/不可达则不预填 */
        });
    }
  };

  const fillFromProduction = (p: ProductionTrackingRow) => {
    if (prodPickFor === null) return;
    patchRow(prodPickFor, { 生产单号: p.生产单号 ?? undefined, 款号: p.款号 ?? undefined });
    setProdPickFor(null);
  };

  // 选入仓单带出:表头 入仓单号/供应商 + 明细整单带出(对照老系统 bringFromReceipt)
  const bringFromReceipt = async (no: string) => {
    try {
      const d = await plasticReceiptApi.get(no);
      const h = d.单头;
      setForm({
        入仓单号: no,
        供应商编号: h?.供应商编号 ?? "",
        供应商名称: h?.供应商名称 ?? "",
      });
      setRows((d.明细 ?? []).map((l) => receiptLineToScrapLine(l, uid())));
      setToast({ text: `已带出入仓单 ${no} 的明细`, tone: "ok" });
      setReceiptOpen(false);
    } catch (e) {
      setToast({ text: errMsg(e) || "带出入仓单明细失败", tone: "err" });
    }
  };

  // URL ?单号= 直开(消费后清参数)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const no = searchParams.get("单号");
    if (!no) return;
    setSearchParams({}, { replace: true });
    setTab("doc");
    setMode("view");
    set单号(no);
    void qc.invalidateQueries({ queryKey: ["plastic-scrap", "detail", no] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  // ---------- 保存(只新建;塑胶报废单保存后不可改,后端无 PUT) ----------
  const doSave = async () => {
    if (!form.供应商编号.trim() && !form.供应商名称.trim()) {
      setToast({ text: "请选供应商", tone: "err" });
      return;
    }
    if (!form.仓库.trim()) {
      setToast({ text: "请填仓库", tone: "err" });
      return;
    }
    const ok = validScrapLines(rows);
    if (ok.length === 0) {
      setToast({ text: "请至少录入一行有效物料明细(物料编号+数量)", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const t = (s: string) => (s.trim() !== "" ? s.trim() : undefined);
      const r = await plasticScrapApi.create({
        供应商编号: t(form.供应商编号),
        供应商名称: t(form.供应商名称),
        仓库: form.仓库.trim(),
        出库单号: t(form.出库单号),
        入仓单号: t(form.入仓单号),
        备注: t(form.备注),
        明细: ok.map(toSubmitScrapLine),
      });
      setToast({ text: `塑胶报废单已创建:${r.单号}`, tone: "ok" });
      setMode("view");
      set单号(r.单号);
      void qc.invalidateQueries({ queryKey: ["plastic-scrap"] });
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "创建失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 审核(=报废出库存)/反审核/删除
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      const r = (await fn()) as { 警告?: string } | undefined;
      if (r?.警告) setToast({ text: r.警告, tone: "err" });
      else setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        setMode("view");
        set单号(null);
        void qc.invalidateQueries({ queryKey: ["plastic-scrap"] });
      } else {
        await detailQuery.refetch();
        void qc.invalidateQueries({ queryKey: ["plastic-scrap", "list"] });
        void qc.invalidateQueries({ queryKey: ["plastic-scrap", "first"] });
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // ---------- 工具条 ----------
  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, onClick: () => setDialogOpen(true) },
    ...(mode === "new"
      ? [
          {
            key: "save",
            label: "保存",
            icon: FloppyDisk,
            perm: "保存" as const,
            primary: true,
            disabled: saving,
            onClick: () => void doSave(),
          },
        ]
      : []),
    ...(isView && !isAudited
      ? [
          {
            key: "del",
            label: "删除",
            icon: Trash,
            perm: "删除" as const,
            danger: true,
            onClick: () => setDeleteOpen(true),
          },
        ]
      : []),
  ];
  const auditActions: DocAction[] = [
    ...(isView && !isAudited
      ? [
          {
            key: "audit",
            label: "审核(报废)",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => plasticScrapApi.approve(单号!), "已审核(报废)", "reload"),
          },
        ]
      : []),
    ...(isView && isAudited
      ? [
          {
            key: "unaudit",
            label: "反审核",
            icon: ArrowCounterClockwise,
            perm: "反审核" as const,
            danger: true,
            onClick: () => void act(() => plasticScrapApi.unapprove(单号!), "已反审核", "reload"),
          },
        ]
      : []),
  ];

  const doPrint = () => {
    if (!detail?.单头) return;
    printPlasticDoc(`塑胶报废单 ${单号 ?? ""}`, detail, PRINT_CFG(priceHidden));
  };
  const printActions: DocAction[] = isView
    ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint }]
    : [];

  // ---------- 查看态单头卡 ----------
  const mainFields: HeaderField[] = header
    ? [
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        { label: "供应商", value: txt(header.供应商名称), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "仓库", value: txt(header.仓库), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "金额", value: priceHidden ? "***" : String(header.金额 ?? "-"), mono: true },
        { label: "出库单号", value: txt(header.出库单号), mono: true },
        { label: "入库单号", value: txt(header.入仓单号), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "电脑单号", value: txt(header.电脑单号), mono: true },
        { label: "供应商编号", value: txt(header.供应商编号), mono: true },
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];

  // 明细(列序保真老系统 PlasticSupplierDocLineTable:生产单号|款号|物料编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注)
  const lineRows = mode === "new" ? rows : viewLines;
  const readOnly = mode !== "new";

  const lineTable = (
    <div className="f-panel overflow-auto">
      <div className="p-4">
      <table data-freeze className="w-full min-w-[1250px] text-[15px]">
        <thead>
          <tr>
            {[
              "生产单号",
              "款号",
              "物料编号",
              "物料名称",
              "颜色",
              "塑胶货号",
              "单位",
              "数量",
              ...(priceHidden ? [] : ["单价", "金额"]),
              "备注",
              ...(readOnly ? [] : [""]),
            ].map((h) => (
              <th
                key={h}
                className={cn(
                  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                  (h === "数量" || h === "单价" || h === "金额") && "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineRows.map((l) => {
            const amt = (Number(l.数量) || 0) * (Number(l.单价) || 0);
            return (
              <tr key={l.key} className="border-b border-black/6 last:border-0">
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="f-mono text-[#3d4a5c]">{l.生产单号 ?? ""}</span>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        className={cellInputCls}
                        aria-label="生产单号"
                        value={l.生产单号 ?? ""}
                        onChange={(e) => patchRow(l.key, { 生产单号: e.target.value })}
                      />
                      <button
                        type="button"
                        className="f-btn h-8 shrink-0 px-2 text-xs"
                        onClick={() => setProdPickFor(l.key)}
                      >
                        选
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="f-mono text-[#3d4a5c]">{l.款号 ?? ""}</span>
                  ) : (
                    <input
                      className={cellInputCls}
                      aria-label="款号"
                      value={l.款号 ?? ""}
                      onChange={(e) => patchRow(l.key, { 款号: e.target.value })}
                    />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="f-mono font-semibold text-[#1a2330]">{l.物料编号 ?? ""}</span>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        className={cellInputCls}
                        aria-label="物料编号"
                        value={l.物料编号 ?? ""}
                        onChange={(e) => patchRow(l.key, { 物料编号: e.target.value })}
                      />
                      <button
                        type="button"
                        className="f-btn h-8 shrink-0 px-2 text-xs"
                        onClick={() => setMaterialPickFor(l.key)}
                      >
                        选
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-[#3d4a5c]">{l.物料名称 ?? ""}</td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="text-[#3d4a5c]">{l.颜色 ?? ""}</span>
                  ) : (
                    <input
                      className={cellInputCls}
                      aria-label="颜色"
                      value={l.颜色 ?? ""}
                      onChange={(e) => patchRow(l.key, { 颜色: e.target.value })}
                    />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="text-[#3d4a5c]">{l.塑胶货号 ?? ""}</span>
                  ) : (
                    <input
                      className={cellInputCls}
                      aria-label="塑胶货号"
                      value={l.塑胶货号 ?? ""}
                      onChange={(e) => patchRow(l.key, { 塑胶货号: e.target.value })}
                    />
                  )}
                </td>
                <td className="px-3 py-1.5 text-[#3d4a5c]">{l.单位 ?? ""}</td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="f-mono block text-right text-[#1a2330]">{l.数量}</span>
                  ) : (
                    <input
                      className={cn(cellInputCls, "text-right")}
                      aria-label="数量"
                      type="number"
                      min={0}
                      value={l.数量}
                      onChange={(e) => patchRow(l.key, { 数量: e.target.value })}
                    />
                  )}
                </td>
                {!priceHidden && (
                  <>
                    <td className="px-2 py-1.5">
                      {readOnly ? (
                        <span className="f-mono block text-right text-[#1a2330]">{l.单价}</span>
                      ) : (
                        <input
                          className={cn(cellInputCls, "text-right")}
                          aria-label="单价"
                          type="number"
                          min={0}
                          value={l.单价}
                          onChange={(e) => patchRow(l.key, { 单价: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">
                      {amt ? amt.toFixed(2) : "0.00"}
                    </td>
                  </>
                )}
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="text-[#3d4a5c]">{l.备注 ?? ""}</span>
                  ) : (
                    <input
                      className={cellInputCls}
                      aria-label="备注"
                      value={l.备注 ?? ""}
                      onChange={(e) => patchRow(l.key, { 备注: e.target.value })}
                    />
                  )}
                </td>
                {!readOnly && (
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      className="text-sm text-[#dc2626] hover:underline"
                      onClick={() => removeRow(l.key)}
                    >
                      删除
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {lineRows.length === 0 && (
            <tr>
              <td colSpan={priceHidden ? 10 : 12} className="px-3 py-6 text-center text-sm text-disabled">
                {readOnly ? "无明细" : "还没有明细行,点下方「加行」手选物料,或从入仓单带出"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          className="f-btn mt-3 h-9 px-4 text-sm"
          onClick={() => setRows((rs) => [...rs, { key: uid(), 数量: "0", 单价: "" }])}
        >
          <Plus className="h-4 w-4" />
          加行
        </button>
      )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签(对照老系统 DocQueryTabs) */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          塑胶报废单
          {tab === "doc" && (isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : "")}
        </h1>
        {tab === "doc" && isView && (
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold",
              isAudited
                ? "border-[#16a34a]/60 bg-[#16a34a]/10 text-[#15803d]"
                : "border-black/10 bg-black/5 text-[#5f6b7d]",
            )}
          >
            {isAudited ? "已审核" : "未审核"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {[
              { key: "doc" as const, label: "塑胶报废单" },
              { key: "query" as const, label: "塑胶报废查询" },
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
          {tab === "doc" && <FlowSteps steps={["开单", "审核报废"]} current={isAudited ? 1 : 0} />}
        </div>
      </div>

      {tab === "query" ? (
        <PlasticDocQueryPanel cfg={QUERY_CFG} />
      ) : (
        <>
          {/* 操作栏:编辑 / 审核 / 打印(老系统报废单无批量审核,保持 parity) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            {auditActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={auditActions} menuKey={MENU} />
              </>
            )}
            {printActions.length > 0 && (
              <>
                <span className="mx-1 h-8 w-px bg-black/10" />
                <DocToolbar actions={printActions} menuKey={MENU} />
              </>
            )}
          </div>

          {/* 单头:新建 = 表单;查看 = 只读单头卡(保存后不可改,后端无 PUT) */}
          {mode === "new" ? (
            <div className="f-panel p-6">
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
                <FormField label="供应商">
                  <div className="relative flex gap-2">
                    <Input
                      className={inputCls}
                      readOnly
                      placeholder="点「选择」挑供应商"
                      aria-label="供应商"
                      value={form.供应商名称}
                    />
                    <button
                      type="button"
                      className="f-btn h-10 shrink-0 px-3.5 text-sm"
                      onClick={() => setSupplierOpen(true)}
                    >
                      选择
                    </button>
                    <span className="absolute top-1/2 right-16 -translate-y-1/2 text-[#dc2626]">
                      *
                    </span>
                  </div>
                </FormField>
                <FormField label="日期">
                  <Input className={inputCls} aria-label="日期" value={today()} disabled />
                </FormField>
                <FormField label="出库单号">
                  <Input
                    className={inputCls}
                    aria-label="出库单号"
                    value={form.出库单号}
                    onChange={(e) => setForm({ 出库单号: e.target.value })}
                  />
                </FormField>
                <FormField label="入仓单号">
                  <div className="flex gap-2">
                    <Input
                      className={inputCls}
                      aria-label="入仓单号"
                      readOnly
                      placeholder="点「选择」选入仓单带出"
                      value={form.入仓单号}
                    />
                    <button
                      type="button"
                      className="f-btn h-10 shrink-0 px-3.5 text-sm"
                      onClick={() => {
                        setReceiptKw("");
                        setReceiptPage(1);
                        setReceiptOpen(true);
                      }}
                    >
                      选择
                    </button>
                  </div>
                </FormField>
                <FormField label="仓库">
                  <div className="relative">
                    <Input
                      className={inputCls}
                      aria-label="仓库"
                      value={form.仓库}
                      onChange={(e) => setForm({ 仓库: e.target.value })}
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">
                      *
                    </span>
                  </div>
                </FormField>
                <FormField label="电脑单号">
                  <Input className={inputCls} value="" disabled placeholder="保存后自动生成" />
                </FormField>
                <FormField label="操作员">
                  <Input className={inputCls} aria-label="操作员" value={currentUser} disabled />
                </FormField>
              </div>
              <div className="mt-4">
                <FormField label="备注">
                  <textarea
                    className={cn(inputCls, "h-auto min-h-16 w-full rounded-md border px-3 py-2")}
                    rows={2}
                    aria-label="备注"
                    value={form.备注}
                    onChange={(e) => setForm({ 备注: e.target.value })}
                  />
                </FormField>
              </div>
            </div>
          ) : !header && !detailQuery.isLoading ? (
            <div className="f-panel p-6">
              <DocEmpty
                icon={<FolderOpen className="h-5 w-5" />}
                title="尚未打开单据"
                description="点击上方「打开」选择一张塑胶报废单,或点「新建」开一张新单"
                action={
                  <button
                    type="button"
                    className="f-btn f-btn-cyan px-5"
                    onClick={() => setDialogOpen(true)}
                  >
                    打开单据
                  </button>
                }
              />
            </div>
          ) : (
            <DocHeaderCard fields={mainFields} extra={extraFields} />
          )}

          {/* 明细 */}
          {lineTable}

          {/* 合计(对照老系统 Statistic 数量合计/金额合计/制单人) */}
          <div className="f-panel flex flex-wrap gap-10 px-6 py-4">
            <div>
              <div className="f-label">数量合计</div>
              <div className="f-mono mt-1 text-xl font-bold text-[#1a2330]">
                {sumScrapQty(lineRows)}
              </div>
            </div>
            {!priceHidden && (
              <div>
                <div className="f-label">金额合计</div>
                <div className="f-mono mt-1 text-xl font-bold text-[#1a2330]">
                  {sumScrapAmount(lineRows).toFixed(2)}
                </div>
              </div>
            )}
            <div>
              <div className="f-label">制单人</div>
              <div className="mt-1 text-xl font-bold text-[#1a2330]">{currentUser}</div>
            </div>
          </div>
        </>
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开塑胶报废单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号/供应商"
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        loading={listQuery.isLoading}
        onPick={(r) => {
          if (!r.单号) return;
          setDialogOpen(false);
          setMode("view");
          set单号(r.单号);
        }}
        footer={
          <>
            <span>共 {listQuery.data?.total ?? 0} 张</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="f-btn h-8 px-3 text-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
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
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </span>
          </>
        }
      />

      {/* 选入仓单带出(塑胶入仓单列表,点行带出明细) */}
      <OpenDocDialog
        title="选择塑胶入仓单(点行带出明细)"
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        columns={listColumns}
        rows={receiptsQuery.data?.items ?? []}
        searchPlaceholder="单号/供应商"
        onSearch={(kw) => {
          setReceiptPage(1);
          setReceiptKw(kw);
        }}
        loading={receiptsQuery.isLoading}
        onPick={(r) => r.单号 && void bringFromReceipt(r.单号)}
        footer={
          <>
            <span>共 {receiptsQuery.data?.total ?? 0} 张</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="f-btn h-8 px-3 text-sm"
                disabled={receiptPage <= 1}
                onClick={() => setReceiptPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>
                {receiptPage} / {receiptTotalPages}
              </span>
              <button
                type="button"
                className="f-btn h-8 px-3 text-sm"
                disabled={receiptPage >= receiptTotalPages}
                onClick={() => setReceiptPage((p) => p + 1)}
              >
                下一页
              </button>
            </span>
          </>
        }
      />

      <SupplierPickerDialog
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        onPick={(s) =>
          setForm({ 供应商编号: s.供应商编号 ?? "", 供应商名称: s.供应商名称 ?? "" })
        }
      />
      <PlasticMaterialPickerDialog
        open={materialPickFor !== null}
        onClose={() => setMaterialPickFor(null)}
        onPick={fillFromMaterial}
      />
      <ProductionPickerDialog
        open={prodPickFor !== null}
        onClose={() => setProdPickFor(null)}
        onPick={fillFromProduction}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该单据?"
        description={`塑胶报废单 ${单号 ?? ""} 删除后不可恢复`}
        confirmLabel="删除"
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => plasticScrapApi.remove(单号!), "已删除", "reset");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
