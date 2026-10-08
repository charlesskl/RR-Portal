// 原料采购订单(/plastic-raw-material-purchase-order)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialPurchaseOrderPage.tsx + PlasticRawMaterialPurchaseOrderLineTable.tsx:
// 新建/打开/保存(POST create)/删除/打印;打开后查看模式(无整单更新);
// 三级流转:主管审核 -> 经理审核 -> 审核(下发) -> 反审核(对照老系统 listColumns 操作列);
// 明细行:原料编号(可手输+选原料)/原料名称只读/规格/单位/单价类型(含税/未税)/订货数量/单价/金额/备注;
// 无「单价」位不出 单价/金额 列与金额合计。
// 权限菜单=原料采购订单(MenuCatalog.cs:69 实证:原料仓库组)。
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
import { rawPurchaseOrderApi } from "@/api/endpoints";
import type { PlasticRawMaterialRow, RMPOHeader, RMPOLine, SupplierRow } from "@/api/types";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  LINE_PRICE_TYPES,
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
import { SupplierPickerDialog } from "@/components/doc/SupplierPickerDialog";
import { RawMaterialPickerDialog } from "@/components/doc/RawMaterialPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "原料采购订单";
const currentUser = () => getUser() || "admin";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

interface EditLine extends RMPOLine {
  key: number;
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// 三级流转徽章(对照老系统 statusTag)
function StatusBadge({ header }: { header: RMPOHeader }) {
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

// ---------- 打开单据弹窗列(对照老系统 listColumns) ----------

const openCol = createColumnHelper<RMPOHeader>();
const listColumns: ColumnDef<RMPOHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 22,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("供应商名称", { header: "供应商", size: 22 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 12,
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("订购日期", {
    header: "订购日期",
    size: 14,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("交货日期", {
    header: "交货日期",
    size: 14,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor((r) => tripleAuditLabel(r), {
    id: "状态",
    header: "状态",
    size: 16,
    cell: (c) => <StatusBadge header={c.row.original} />,
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

export default function PlasticRawMaterialPurchaseOrderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");

  const [opened, setOpened] = useState<{ 单头?: RMPOHeader; 明细: RMPOLine[] } | null>(null);
  const [form, setFormState] = useState({
    供应商编号: "",
    供应商名称: "",
    交货日期: "",
    备注: "",
  });
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supOpen, setSupOpen] = useState(false);
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
  const stage = header ? tripleAuditStage(header) : 0;
  const readOnly = opened !== null;
  const 单号 = header?.单号 ?? "";

  const applyDetail = useCallback((d: { 单头?: RMPOHeader; 明细: RMPOLine[] }) => {
    const h = d.单头 ?? ({} as RMPOHeader);
    setFormState({
      供应商编号: h.供应商编号 ?? "",
      供应商名称: h.供应商名称 ?? "",
      交货日期: date10(h.交货日期),
      备注: h.备注 ?? "",
    });
    setLines((d.明细 ?? []).map((x) => ({ ...x, key: nextRowKey() })));
    setOpened(d);
  }, []);

  const openDoc = useCallback(
    async (no: string) => {
      setBusy(true);
      try {
        applyDetail(await rawPurchaseOrderApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开原料采购订单失败", "err");
      } finally {
        setBusy(false);
      }
    },
    [applyDetail, notify],
  );

  // ?open=<单号> 直开(原料采购进度表跳入)
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
    setFormState({ 供应商编号: "", 供应商名称: "", 交货日期: "", 备注: "" });
    setOpened(null);
    setLines([]);
  };

  const save = async () => {
    if (readOnly || busy) return;
    if (!form.供应商名称.trim()) {
      notify("请选供应商", "err");
      return;
    }
    const ok = lines.filter((l) => l.原料编号 && Number(l.订货数量 ?? 0) > 0);
    if (ok.length === 0) {
      notify("请至少录入一行有效明细(原料编号+订货数量)", "err");
      return;
    }
    setBusy(true);
    try {
      await rawPurchaseOrderApi.create({
        ...form,
        交货日期: form.交货日期 || null,
        订购日期: today(),
        操作员: currentUser(),
        明细: ok.map(({ key: _key, ...l }) => l),
      });
      notify("原料采购订单已创建", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["raw-purchase-order"] });
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
      applyDetail(await rawPurchaseOrderApi.get(单号));
      void qc.invalidateQueries({ queryKey: ["raw-purchase-order"] });
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
      await rawPurchaseOrderApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["raw-purchase-order"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (key: number, patch: Partial<EditLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const 数量合计 = lines.reduce((s, l) => s + Number(l.订货数量 ?? 0), 0);
  const 金额合计 = lines.reduce((s, l) => s + Number(l.订货数量 ?? 0) * Number(l.单价 ?? 0), 0);

  const listQuery = useQuery({
    queryKey: ["raw-purchase-order", "list", page, keyword],
    queryFn: () => rawPurchaseOrderApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    const cols: [string, string][] = [
      ["原料编号", "原料编号"],
      ["原料名称", "原料名称"],
      ["规格", "规格"],
      ["单位", "单位"],
      ["单价类型", "单价类型"],
      ["订货数量", "订货数量"],
      ...(priceHidden ? [] : ([["单价", "单价"], ["金额", "金额"]] as [string, string][])),
      ["备注", "备注"],
    ];
    const cfg: RawDocPrintCfg = {
      headItems: [
        ["单号", "单号"],
        ["订购日期", "订购日期"],
        ["交货日期", "交货日期"],
        ["供应商", "供应商名称"],
        ["操作员", "操作员"],
        ["备注", "备注"],
      ],
      lineCols: cols,
    };
    printRawDoc(
      `原料采购订单 ${单号 || "未保存"}`,
      {
        单头: {
          单号,
          ...form,
          订购日期: header?.订购日期 ?? today(),
          操作员: header?.操作员 ?? currentUser(),
        },
        明细: lines.map((l) => ({
          ...l,
          金额: (Number(l.订货数量 ?? 0) * Number(l.单价 ?? 0)).toFixed(2),
        })) as unknown as Record<string, unknown>[],
      },
      cfg,
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly || busy, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened || stage === 3 || busy, disabledTitle: !opened ? "先打开单据" : stage === 3 ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
  ];
  // 三级流转动作(对照老系统操作列可见性;三级同挂「审核」位)
  const auditActions: DocAction[] = [
    {
      key: "sup", label: "主管审核", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 0 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 0 ? "不在主管审核环节" : undefined,
      onClick: () => void act(() => rawPurchaseOrderApi.supervisorApprove(单号), "主管已审核"),
    },
    {
      key: "mgr", label: "经理审核", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 1 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 1 ? "不在经理审核环节" : undefined,
      onClick: () => void act(() => rawPurchaseOrderApi.managerApprove(单号), "经理已审核"),
    },
    {
      key: "audit", label: "审核(下发)", icon: CheckCircle, perm: "审核", success: true,
      disabled: !opened || stage !== 2 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 2 ? "不在审核下发环节" : undefined,
      onClick: () => void act(() => rawPurchaseOrderApi.approve(单号), "已审核"),
    },
    {
      key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true,
      disabled: !opened || stage !== 3 || busy,
      disabledTitle: !opened ? "先打开单据" : stage !== 3 ? "单据未审核下发" : undefined,
      onClick: () => void act(() => rawPurchaseOrderApi.unapprove(单号), "已反审核"),
    },
  ];
  const tailActions: DocAction[] = [
    { key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint },
    { key: "close", label: "关闭", icon: X, danger: true, disabled: busy, onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")) },
  ];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「原料采购订单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const lineAmt = (l: EditLine) => (Number(l.订货数量 ?? 0) * Number(l.单价 ?? 0)).toFixed(2);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          原料采购订单{readOnly ? ` · ${单号}` : "(新建)"}
        </h1>
        {header && <StatusBadge header={header} />}
        <div className="ml-auto">
          <FlowSteps steps={["开单", "主管审核", "经理审核", "审核下发"]} current={stage} />
        </div>
      </div>

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
          <FormField label="订购日期">
            <Input className={inputCls} aria-label="订购日期" disabled value={date10(header?.订购日期) || today()} />
          </FormField>
          <FormField label="交货日期">
            <Input
              type="date"
              className={inputCls}
              aria-label="交货日期"
              disabled={readOnly}
              value={form.交货日期}
              onChange={(e) => setFormState((f) => ({ ...f, 交货日期: e.target.value }))}
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

      {/* 明细(对照老系统 PlasticRawMaterialPurchaseOrderLineTable 列序) */}
      <div className="f-panel overflow-hidden">
        <div className="border-b border-black/8 px-4 py-2.5">
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={readOnly}
            onClick={() => setLines((v) => [...v, { key: nextRowKey(), 订货数量: 0, 单价类型: "含税" }])}
          >
            <Plus className="h-4 w-4" />
            加一行
          </button>
        </div>
        <div className="max-h-[40vh] overflow-auto">
          <table data-freeze className="w-full min-w-[1200px] text-[15px]">
            <thead>
              <tr className="border-b border-black/8">
                {[
                  "原料编号",
                  "原料名称",
                  "规格",
                  "单位",
                  "单价类型",
                  "订货数量",
                  ...(priceHidden ? [] : ["单价", "金额"]),
                  "备注",
                  "删除",
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                      ["订货数量", "单价", "金额"].includes(h) && "text-right",
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
                      <span className="text-[#3d4a5c]">{l.规格 ?? ""}</span>
                    ) : (
                      <input
                        className={cellInputCls}
                        aria-label="规格"
                        value={l.规格 ?? ""}
                        onChange={(e) => updateLine(l.key, { 规格: e.target.value })}
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
                      <span className="text-[#3d4a5c]">{l.单价类型 ?? ""}</span>
                    ) : (
                      <SearchSelect
                        ariaLabel="单价类型"
                        className="h-8 rounded-md border border-black/10 bg-black/[0.04] text-sm text-[#1a2330]"
                        value={l.单价类型 ?? "含税"}
                        options={LINE_PRICE_TYPES.map((v) => ({ value: v, label: v }))}
                        onChange={(v) => updateLine(l.key, { 单价类型: v })}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {readOnly ? (
                      <span className="f-mono block text-right text-[#1a2330]">{l.订货数量 ?? 0}</span>
                    ) : (
                      <input
                        className={cn(cellInputCls, "f-mono text-right")}
                        aria-label="订货数量"
                        type="number"
                        min={0}
                        value={l.订货数量 ?? 0}
                        onChange={(e) => updateLine(l.key, { 订货数量: Number(e.target.value || 0) })}
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
                  <td colSpan={priceHidden ? 8 : 10} className="px-3 py-6 text-center text-sm text-disabled">
                    点「加一行」录入明细,原料编号可手输或点「选」从原料资料带出
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* 合计(对照老系统 Statistic;无「单价」位不出金额合计) */}
        <div className="flex gap-10 border-t border-black/8 px-4 py-3">
          <span className="text-sm text-[#5f6b7d]">
            数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{数量合计}</span>
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

      <OpenDocDialog
        title="打开原料采购订单"
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
            规格: row.规格 ?? undefined,
            单位: row.单位 ?? undefined,
            单价: row.单价 ?? undefined,
          });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该原料采购订单?"
        description={单号 ? `原料采购订单 ${单号} 删除后不可恢复` : undefined}
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
