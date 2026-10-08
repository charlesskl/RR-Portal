// 原料生产需求表(/plastic-raw-material-demand)。对照老系统
// web/src/pages/plastics/PlasticRawMaterialDemandPage.tsx + PlasticRawMaterialDemandLineTable.tsx:
// 新建/打开(OpenDocDialog)/保存(POST create)/审核/反审核/删除/打印;打开后为查看模式(老系统无 PUT);
// 制单人走人事档案选择器(必填);领料备注下拉 生产领料/样品领料/维修领料;
// 明细行:原料编号(可手输+选原料)/原料名称只读/每包重量/单位/需求数量(KG)/需求数量(包)/备注;
// 保存校验:至少一行有效明细(原料编号+需求数量KG或包>0)。
// 权限菜单=原料生产需求表(MenuCatalog.cs:67 实证:原料仓库组)。
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
import { rawMaterialDemandApi } from "@/api/endpoints";
import type { PlasticRawMaterialRow, RMDHeader, RMDLine } from "@/api/types";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import {
  ISSUE_REMARKS,
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
import { EmployeePickerDialog } from "@/components/doc/EmployeePickerDialog";
import { RawMaterialPickerDialog } from "@/components/doc/RawMaterialPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "原料生产需求表";
const currentUser = () => getUser() || "admin";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

// 编辑行(带稳定 key)
interface EditLine extends RMDLine {
  key: number;
}

const PRINT_CFG: RawDocPrintCfg = {
  headItems: [
    ["单号", "单号"],
    ["开单日期", "开单日期"],
    ["啤机生产单号", "啤机生产单号"],
    ["生产车间", "生产车间"],
    ["领料备注", "领料备注"],
    ["制单人", "制单人"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["原料编号", "原料编号"],
    ["原料名称", "原料名称"],
    ["每包重量", "每包重量"],
    ["单位", "单位"],
    ["需求数量(KG)", "需求数量KG"],
    ["需求数量(包)", "需求数量包"],
    ["备注", "备注"],
  ],
};

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- 打开单据弹窗列(对照老系统 listColumns) ----------

const openCol = createColumnHelper<RMDHeader>();
const listColumns: ColumnDef<RMDHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 20,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("啤机生产单号", {
    header: "啤机生产单号",
    size: 16,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("制单人", { header: "制单人", size: 10 }),
  openCol.accessor("生产车间", { header: "生产车间", size: 12 }),
  openCol.accessor("数量KG", {
    header: "数量KG",
    size: 9,
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("数量包", {
    header: "数量包",
    size: 9,
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("开单日期", {
    header: "日期",
    size: 11,
    cell: (c) => date10(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
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

export default function PlasticRawMaterialDemandPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");

  const [opened, setOpened] = useState<{ 单头?: RMDHeader; 明细: RMDLine[] } | null>(null);
  const [form, setFormState] = useState({
    啤机生产单号: "",
    制单人: "",
    领料备注: "生产领料",
    生产车间: "",
    备注: "",
  });
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [empOpen, setEmpOpen] = useState(false);
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
  // 查看模式:已打开单据即只读(老系统 readOnly = opened !== null;无整单更新接口)
  const readOnly = opened !== null;
  const 单号 = header?.单号 ?? "";

  const applyDetail = useCallback((d: { 单头?: RMDHeader; 明细: RMDLine[] }) => {
    const h = d.单头 ?? ({} as RMDHeader);
    setFormState({
      啤机生产单号: h.啤机生产单号 ?? "",
      制单人: h.制单人 ?? "",
      领料备注: h.领料备注 ?? "生产领料",
      生产车间: h.生产车间 ?? "",
      备注: h.备注 ?? "",
    });
    setLines((d.明细 ?? []).map((x) => ({ ...x, key: nextRowKey() })));
    setOpened(d);
  }, []);

  const openDoc = useCallback(
    async (no: string) => {
      setBusy(true);
      try {
        applyDetail(await rawMaterialDemandApi.get(no));
      } catch (e) {
        notify(errMsg(e) || "打开原料生产需求表失败", "err");
      } finally {
        setBusy(false);
      }
    },
    [applyDetail, notify],
  );

  // ?open=<单号> 直开(进度/汇总页跳入)
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
    setFormState({ 啤机生产单号: "", 制单人: "", 领料备注: "生产领料", 生产车间: "", 备注: "" });
    setOpened(null);
    setLines([]);
  };

  const save = async () => {
    if (readOnly || busy) return;
    if (!form.制单人.trim()) {
      notify("请选制单人", "err");
      return;
    }
    const ok = lines.filter(
      (l) => l.原料编号 && (Number(l.需求数量KG ?? 0) > 0 || Number(l.需求数量包 ?? 0) > 0),
    );
    if (ok.length === 0) {
      notify("请至少录入一行有效明细(原料编号+需求数量)", "err");
      return;
    }
    setBusy(true);
    try {
      await rawMaterialDemandApi.create({
        ...form,
        开单日期: today(),
        操作员: currentUser(),
        明细: ok.map(({ key: _key, ...l }) => l),
      });
      notify("原料生产需求表已创建", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["raw-demand"] });
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
      applyDetail(await rawMaterialDemandApi.get(单号));
      void qc.invalidateQueries({ queryKey: ["raw-demand"] });
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
      await rawMaterialDemandApi.remove(单号);
      reset();
      notify("已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["raw-demand"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (key: number, patch: Partial<EditLine>) =>
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const 合计KG = lines.reduce((s, l) => s + Number(l.需求数量KG ?? 0), 0);
  const 合计包 = lines.reduce((s, l) => s + Number(l.需求数量包 ?? 0), 0);

  const listQuery = useQuery({
    queryKey: ["raw-demand", "list", page, keyword],
    queryFn: () => rawMaterialDemandApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printRawDoc(
      `原料生产需求表 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 开单日期: header?.开单日期 ?? today(), 操作员: header?.操作员 ?? currentUser() },
        明细: lines as unknown as Record<string, unknown>[],
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
    { key: "audit", label: "审核", icon: CheckCircle, perm: "审核", success: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => void act(() => rawMaterialDemandApi.approve(单号), "已审核") },
    { key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true, disabled: !opened || !audited || busy, disabledTitle: !opened ? "先打开单据" : "单据未审核", onClick: () => void act(() => rawMaterialDemandApi.unapprove(单号), "已反审核") },
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
            description="缺少「原料生产需求表·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          原料生产需求表{readOnly ? ` · ${单号}` : "(新建)"}
        </h1>
        {opened && (
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
        <div className="ml-auto">{<FlowSteps steps={["开单", "审核"]} current={audited ? 1 : 0} />}</div>
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
          <FormField label="啤机生产单号">
            <Input
              className={inputCls}
              aria-label="啤机生产单号"
              disabled={readOnly}
              value={form.啤机生产单号}
              onChange={(e) => setFormState((f) => ({ ...f, 啤机生产单号: e.target.value }))}
            />
          </FormField>
          <FormField label="开单日期">
            <Input className={inputCls} aria-label="开单日期" disabled value={date10(header?.开单日期) || today()} />
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
          <FormField label="操作员">
            <Input className={inputCls} aria-label="操作员" disabled value={header?.操作员 ?? currentUser()} />
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
          <FormField label="生产车间">
            <Input
              className={inputCls}
              aria-label="生产车间"
              disabled={readOnly}
              value={form.生产车间}
              onChange={(e) => setFormState((f) => ({ ...f, 生产车间: e.target.value }))}
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
        </div>
      </div>

      {/* 明细(对照老系统 PlasticRawMaterialDemandLineTable 列序) */}
      <div className="f-panel overflow-hidden">
        <div className="border-b border-black/8 px-4 py-2.5">
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={readOnly}
            onClick={() => setLines((v) => [...v, { key: nextRowKey(), 需求数量KG: 0, 需求数量包: 0 }])}
          >
            <Plus className="h-4 w-4" />
            加一行
          </button>
        </div>
        <div className="max-h-[40vh] overflow-auto">
          <table data-freeze className="w-full min-w-[1100px] text-[15px]">
            <thead>
              <tr className="border-b border-black/8">
                {["原料编号", "原料名称", "每包重量", "单位", "需求数量(KG)", "需求数量(包)", "备注", "删除"].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                      ["每包重量", "需求数量(KG)", "需求数量(包)"].includes(h) && "text-right",
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
                      <span className="f-mono block text-right text-[#1a2330]">{l.每包重量 ?? ""}</span>
                    ) : (
                      <input
                        className={cn(cellInputCls, "f-mono text-right")}
                        aria-label="每包重量"
                        type="number"
                        min={0}
                        value={l.每包重量 ?? 0}
                        onChange={(e) => updateLine(l.key, { 每包重量: Number(e.target.value || 0) })}
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
                      <span className="f-mono block text-right text-[#1a2330]">{l.需求数量KG ?? 0}</span>
                    ) : (
                      <input
                        className={cn(cellInputCls, "f-mono text-right")}
                        aria-label="需求数量(KG)"
                        type="number"
                        min={0}
                        value={l.需求数量KG ?? 0}
                        onChange={(e) => updateLine(l.key, { 需求数量KG: Number(e.target.value || 0) })}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {readOnly ? (
                      <span className="f-mono block text-right text-[#1a2330]">{l.需求数量包 ?? 0}</span>
                    ) : (
                      <input
                        className={cn(cellInputCls, "f-mono text-right")}
                        aria-label="需求数量(包)"
                        type="number"
                        min={0}
                        value={l.需求数量包 ?? 0}
                        onChange={(e) => updateLine(l.key, { 需求数量包: Number(e.target.value || 0) })}
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
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-disabled">
                    点「加一行」录入明细,原料编号可手输或点「选」从原料资料带出
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* 合计(对照老系统 Statistic) */}
        <div className="flex gap-10 border-t border-black/8 px-4 py-3">
          <span className="text-sm text-[#5f6b7d]">
            需求数量(KG)合计:<span className="f-mono text-base font-bold text-[#1a2330]">{合计KG.toFixed(2)}</span>
          </span>
          <span className="text-sm text-[#5f6b7d]">
            需求数量(包)合计:<span className="f-mono text-base font-bold text-[#1a2330]">{合计包.toFixed(2)}</span>
          </span>
          <span className="text-sm text-[#5f6b7d]">
            制单人:<span className="text-base font-bold text-[#1a2330]">{form.制单人 || currentUser()}</span>
          </span>
        </div>
      </div>

      <OpenDocDialog
        title="打开原料生产需求表"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 啤机生产单号"
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
            单位: row.单位 ?? undefined,
          });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该原料生产需求表?"
        description={单号 ? `原料生产需求表 ${单号} 删除后不可恢复` : undefined}
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
