// 塑胶加工采购订单(/plastic-process-purchase-orders;权限菜单=塑胶加工采购单,MenuCatalog.cs:20 实证:发外加工组)。
// 对照老系统 web/src/pages/plastics/PlasticProcessPurchaseOrderPage.tsx + PlasticProcessPurchaseOrderLineTable.tsx:
// 单头(加工厂选择器带出厂类别/日期/交货日期/客户/收货仓库/收货人/操作员/备注) + 可编辑明细
// (按厂类别过滤显示,清单完整保留;二次加工 BOM 行展开 第一次/第二次) + 下方单据列表
// (点单号查看=只读;行内 主管审核/经理审核/审核(下发)/反审核/删除 三级流转)。
// ?单号= 直开指定单(装配加工采购单「下加工单」创建后跳入,消费后清参)。
// 打印:老系统 window.print() 打整页,新版开新窗口渲染单头+明细(与半成品单据同口径)。
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  CaretLeft,
  CaretRight,
  FilePlus,
  FloppyDisk,
  Printer,
  Prohibit,
  X,
} from "@phosphor-icons/react";
import { plasticProcessPurchaseOrderApi } from "@/api/endpoints";
import type { FactoryRow, PPPOLine, PPPOHeader } from "@/api/types";
import { getUser } from "@/lib/auth";
import {
  chainBadge,
  expandProcessBasis,
  matchCount,
  mergeShownEdit,
  PPPO_PRINT_CFG,
  printProcessDoc,
  processLineVisible,
  validateProcessPurchaseLines,
  validProcessPurchaseLines,
} from "@/lib/processDocs";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { FactoryPickerDialog } from "@/components/doc/FactoryPickerDialog";
import { ProductionPickerDialog } from "@/components/doc/ProductionPickerDialog";
import { PlasticMaterialPickerDialog } from "@/components/doc/PlasticMaterialPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import type { ProductionTrackingRow } from "@/api/types";

const MENU = "塑胶加工采购单";
const LIST_SIZE = 10; // 单据列表每页 10 行(对照老系统 pagination.pageSize;一次取 50 行客户端分页)
const FETCH_SIZE = 50;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const today = () => new Date().toISOString().slice(0, 10); // ISO 格式:后端 DateTime 反序列化要求
const currentUser = () => getUser() ?? "";
const d10 = (v?: string) => (v ? v.slice(0, 10) : "");

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
// 表头四律:sticky + 不透明白底 + z-10 + nowrap(本页为自定义表格:可编辑明细+行内操作)
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
const cellCls = "px-2 py-1.5";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

interface HeaderForm {
  加工厂编号: string;
  加工厂名称: string;
  日期: string;
  交货日期: string;
  客户名称: string;
  收货仓库: string;
  收货人: string;
  操作员: string;
  备注: string;
}

const emptyHeader = (): HeaderForm => ({
  加工厂编号: "",
  加工厂名称: "",
  日期: today(),
  交货日期: "",
  客户名称: "",
  收货仓库: "",
  收货人: "",
  操作员: currentUser(),
  备注: "",
});

export default function PlasticProcessPurchaseOrderPage() {
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");

  const [form, setForm] = useState<HeaderForm>(emptyHeader);
  const [lines, setLines] = useState<PPPOLine[]>([]);
  const [rows, setRows] = useState<PPPOHeader[]>([]);
  const [listPage, setListPage] = useState(1);
  const [opened, setOpened] = useState<string | null>(null);
  const [openedHeader, setOpenedHeader] = useState<PPPOHeader | null>(null);
  const [saving, setSaving] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [factoryCat, setFactoryCat] = useState<string | undefined>(); // 已选加工厂的类别(决定明细显示过滤)
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  const readOnly = opened !== null;

  // 明细可见性:lines=完整清单(不销毁);表格只显示可见行,编辑结果按下标位置合并回完整清单
  const visible = useCallback((l: PPPOLine) => processLineVisible(l, factoryCat), [factoryCat]);
  const shownLines = lines.filter(visible);
  const syncShown: Dispatch<SetStateAction<PPPOLine[]>> = (updater) => {
    setLines((prev) => {
      const shown = prev.filter(visible);
      const next = typeof updater === "function" ? updater(shown) : updater;
      return mergeShownEdit(prev, visible, next);
    });
  };

  const loadRows = useCallback(async () => {
    try {
      setRows((await plasticProcessPurchaseOrderApi.list(1, FETCH_SIZE, "")).items);
    } catch (e) {
      notify(errMsg(e) || "加载单据失败", "err");
    }
  }, [notify]);
  useEffect(() => {
    if (canOpen) void loadRows();
  }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    setForm(emptyHeader());
    setLines([]);
    setOpened(null);
    setOpenedHeader(null);
    setFactoryCat(undefined);
  }, []);

  const openDoc = useCallback(
    async (单号: string) => {
      try {
        const d = await plasticProcessPurchaseOrderApi.get(单号);
        const h = d.单头 ?? ({} as PPPOHeader);
        setForm({
          加工厂编号: h.加工厂编号 ?? "",
          加工厂名称: h.加工厂名称 ?? "",
          日期: d10(h.日期) || today(),
          交货日期: d10(h.交货日期),
          客户名称: h.客户名称 ?? "",
          收货仓库: h.收货仓库 ?? "",
          收货人: h.收货人 ?? "",
          操作员: h.操作员 ?? "",
          备注: h.备注 ?? "",
        });
        setLines(d.明细 ?? []);
        setOpened(单号);
        setOpenedHeader(h);
        setFactoryCat(undefined);
      } catch (e) {
        notify(errMsg(e) || "打开单据失败", "err");
      }
    },
    [notify],
  );

  // ?单号= 直开(装配加工采购单「下加工单」创建后跳入;消费后清参,keep-alive 下再带参仍生效)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const no = searchParams.get("单号");
    if (!no) return;
    setSearchParams({}, { replace: true });
    void openDoc(no);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  // 调入加工清单:二次加工行展开 第一次/第二次;清单完整保留,表格按厂类别过滤显示
  const bringFromProduction = async (生产单号: string) => {
    if (!生产单号) return;
    try {
      const bom = await plasticProcessPurchaseOrderApi.basis(生产单号);
      const ls = expandProcessBasis(bom);
      setLines(ls);
      const n = matchCount(ls, factoryCat);
      notify(
        factoryCat
          ? `已调入生产单 ${生产单号} 的加工清单 ${ls.length} 行,其中与厂类别[${factoryCat}]一致 ${n} 行`
          : `已调入生产单 ${生产单号} 的加工清单 ${ls.length} 行`,
        "ok",
      );
    } catch (e) {
      notify(errMsg(e) || "调入清单失败", "err");
    }
  };

  const onPickFactory = (row: FactoryRow) => {
    setForm((f) => ({
      ...f,
      加工厂编号: row.加工厂编号 ?? "",
      加工厂名称: row.加工厂名称 ?? "",
    }));
    setFactoryCat(row.加工厂类别);
    // 清单不销毁,按厂类别过滤显示;无一致物料则明细为空
    if (lines.length > 0 && row.加工厂类别) {
      const n = matchCount(lines, row.加工厂类别);
      if (n === 0) notify(`清单中没有与厂类别[${row.加工厂类别}]一致的物料,明细不显示`, "err");
      else notify(`按厂类别[${row.加工厂类别}]显示 ${n} 行明细(清单共 ${lines.length} 行)`, "ok");
    }
  };

  const save = async () => {
    if (readOnly) {
      notify("查看模式:请先「新建」再录入", "err");
      return;
    }
    if (!form.加工厂名称.trim()) {
      notify("请选加工厂", "err");
      return;
    }
    const issue = validateProcessPurchaseLines(shownLines, factoryCat);
    if (issue) {
      notify(issue, "err");
      return;
    }
    setSaving(true);
    try {
      await plasticProcessPurchaseOrderApi.create({
        加工厂编号: form.加工厂编号 || undefined,
        加工厂名称: form.加工厂名称 || undefined,
        客户名称: form.客户名称 || undefined,
        收货仓库: form.收货仓库 || undefined,
        收货人: form.收货人 || undefined,
        备注: form.备注 || undefined,
        操作员: form.操作员 || undefined,
        日期: form.日期 || undefined,
        交货日期: form.交货日期 || null,
        明细: validProcessPurchaseLines(shownLines),
      });
      notify("塑胶加工采购单已创建", "ok");
      reset();
      void loadRows();
    } catch (e) {
      notify(errMsg(e) || "创建失败", "err");
    } finally {
      setSaving(false);
    }
  };

  // 列表行内流转操作(对照老系统 act:成功 toast + 重载列表)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok, "ok");
      void loadRows();
    } catch (e) {
      notify(errMsg(e) || "操作失败", "err");
    }
  };

  const doPrint = () => {
    printProcessDoc(
      `塑胶加工采购单${opened ? ` ${opened}` : ""}`,
      {
        单头: {
          ...form,
          单号: opened ?? "",
          交货日期: d10(form.交货日期),
        } as Record<string, unknown>,
        明细: shownLines
          .filter((l) => l.物料编号)
          .map((l) => ({
            ...l,
            金额: (Number(l.数量 ?? 0) * Number(l.单价 ?? 0)).toFixed(2),
          })) as unknown as Record<string, unknown>[],
      },
      PPPO_PRINT_CFG(priceHidden),
    );
  };

  const 数量合计 = shownLines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);
  const 金额合计 = shownLines.reduce((s, l) => s + Number(l.数量 ?? 0) * Number(l.单价 ?? 0), 0);

  // ---------- 明细编辑 ----------
  const setLine = (i: number, patch: Partial<PPPOLine>) =>
    syncShown((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);

  // ---------- 单据列表(客户端分页 10/页) ----------
  const listTotalPages = Math.max(1, Math.ceil(rows.length / LIST_SIZE));
  const listRows = rows.slice((listPage - 1) * LIST_SIZE, listPage * LIST_SIZE);

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, success: true, onClick: reset },
    {
      key: "save",
      label: "保存",
      icon: FloppyDisk,
      perm: "保存",
      primary: true,
      disabled: readOnly || saving,
      disabledTitle: readOnly ? "打开的单据为查看态" : undefined,
      onClick: () => void save(),
    },
    {
      key: "bring",
      label: "调入加工清单",
      disabled: readOnly,
      disabledTitle: readOnly ? "打开的单据为查看态" : undefined,
      onClick: () => setProdOpen(true),
    },
    { key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint },
    {
      key: "close",
      label: "关闭",
      icon: X,
      danger: true,
      onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")),
    },
  ];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶加工采购单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-4 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          塑胶加工采购订单{opened ? `(查看 ${opened})` : "(新建)"}
        </h1>
        {opened && openedHeader && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
              chainBadge(openedHeader)[0],
            )}
          >
            {chainBadge(openedHeader)[1]}
          </span>
        )}
        <div className="ml-auto">
          <FlowSteps
            steps={["开单", "主管审核", "经理审核", "审核下发"]}
            current={
              openedHeader?.审核 === "1"
                ? 3
                : openedHeader?.经理审核 === "1"
                  ? 2
                  : openedHeader?.主管审核 === "1"
                    ? 1
                    : 0
            }
          />
        </div>
      </div>

      <DocToolbar actions={editActions} menuKey={MENU} />

      {/* 单头表单(对照老系统 Form 栅格) */}
      <div className="f-panel p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3 lg:grid-cols-5">
          <FormField label="加工厂">
            <div className="flex gap-2">
              <Input
                className={inputCls}
                aria-label="加工厂"
                readOnly
                placeholder="点「选」选加工厂"
                value={form.加工厂名称}
              />
              <button
                type="button"
                className="f-btn h-10 shrink-0 px-3 text-sm"
                aria-label="选择加工厂"
                disabled={readOnly}
                onClick={() => setFactoryOpen(true)}
              >
                选
              </button>
            </div>
          </FormField>
          <FormField label="日期">
            <Input className={inputCls} aria-label="日期" disabled value={form.日期} />
          </FormField>
          <FormField label="交货日期">
            <Input
              type="date"
              className={inputCls}
              aria-label="交货日期"
              disabled={readOnly}
              value={form.交货日期}
              onChange={(e) => setForm((f) => ({ ...f, 交货日期: e.target.value }))}
            />
          </FormField>
          <FormField label="客户名称">
            <Input
              className={inputCls}
              aria-label="客户名称"
              disabled={readOnly}
              value={form.客户名称}
              onChange={(e) => setForm((f) => ({ ...f, 客户名称: e.target.value }))}
            />
          </FormField>
          <FormField label="收货仓库">
            <Input
              className={inputCls}
              aria-label="收货仓库"
              disabled={readOnly}
              value={form.收货仓库}
              onChange={(e) => setForm((f) => ({ ...f, 收货仓库: e.target.value }))}
            />
          </FormField>
          <FormField label="收货人">
            <Input
              className={inputCls}
              aria-label="收货人"
              disabled={readOnly}
              value={form.收货人}
              onChange={(e) => setForm((f) => ({ ...f, 收货人: e.target.value }))}
            />
          </FormField>
          <FormField label="操作员">
            <Input className={inputCls} aria-label="操作员" disabled value={form.操作员} />
          </FormField>
          <div className="col-span-2 md:col-span-3">
            <FormField label="备注">
              <Input
                className={inputCls}
                aria-label="备注"
                disabled={readOnly}
                value={form.备注}
                onChange={(e) => setForm((f) => ({ ...f, 备注: e.target.value }))}
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* 明细网格(列序对照老系统 PlasticProcessPurchaseOrderLineTable;按厂类别过滤显示) */}
      <div className="f-panel overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "44vh" }}>
          <table data-freeze className="w-full min-w-[1500px] text-[15px]">
            <thead>
              <tr>
                {[
                  "生产单号",
                  "款号",
                  "模具编号",
                  "物料编号",
                  "物料名称",
                  "用料名称",
                  "颜色",
                  "加工内容",
                  "加工次序",
                  "加工字母",
                  "数量",
                  ...(priceHidden ? [] : ["单价", "金额"]),
                  "备注",
                  ...(readOnly ? [] : [""]),
                ].map((h, i) => (
                  <th
                    key={i}
                    className={cn(
                      thCls,
                      (h === "数量" || h === "单价" || h === "金额") && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownLines.length === 0 ? (
                <tr>
                  <td
                    colSpan={(priceHidden ? 12 : 14) + (readOnly ? 0 : 1)}
                    className="px-3 py-6 text-center text-sm text-disabled"
                  >
                    {factoryCat
                      ? `按厂类别[${factoryCat}]过滤后无明细;点「调入加工清单」或「加一行」手录`
                      : "点「调入加工清单」按生产单带入,或「加一行」手录"}
                  </td>
                </tr>
              ) : (
                shownLines.map((l, i) => (
                  <tr key={i} className="border-b border-black/6 last:border-0">
                    <td className={cellCls}>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                          aria-label={`生产单号 ${i + 1}`}
                          disabled={readOnly}
                          value={l.生产单号 ?? ""}
                          onChange={(e) => setLine(i, { 生产单号: e.target.value })}
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            className="f-btn h-8 shrink-0 px-2 text-xs"
                            aria-label={`选生产单 ${i + 1}`}
                            onClick={() => setProdPickFor(i)}
                          >
                            选
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-24 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`款号 ${i + 1}`}
                        disabled={readOnly}
                        value={l.款号 ?? ""}
                        onChange={(e) => setLine(i, { 款号: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-24 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`模具编号 ${i + 1}`}
                        disabled={readOnly}
                        value={l.模具编号 ?? ""}
                        onChange={(e) => setLine(i, { 模具编号: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                          aria-label={`物料编号 ${i + 1}`}
                          disabled={readOnly}
                          value={l.物料编号 ?? ""}
                          onChange={(e) => setLine(i, { 物料编号: e.target.value })}
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            className="f-btn h-8 shrink-0 px-2 text-xs"
                            aria-label={`选物料 ${i + 1}`}
                            onClick={() => setMatPickFor(i)}
                          >
                            选
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{l.物料名称 ?? ""}</td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`用料名称 ${i + 1}`}
                        disabled={readOnly}
                        value={l.用料名称 ?? ""}
                        onChange={(e) => setLine(i, { 用料名称: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-16 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`颜色 ${i + 1}`}
                        disabled={readOnly}
                        value={l.颜色 ?? ""}
                        onChange={(e) => setLine(i, { 颜色: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`加工内容 ${i + 1}`}
                        disabled={readOnly}
                        value={l.加工内容 ?? ""}
                        onChange={(e) => setLine(i, { 加工内容: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <SearchSelect
                        ariaLabel={`加工次序 ${i + 1}`}
                        className="h-8 w-20 rounded-md border border-black/10 bg-black/[0.04] text-sm text-[#1a2330]"
                        disabled={readOnly}
                        value={l.加工次序 ?? ""}
                        options={["第一次", "第二次"].map((v) => ({ value: v, label: v }))}
                        placeholder=""
                        onChange={(v) => setLine(i, { 加工次序: v || undefined })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-14 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`加工字母 ${i + 1}`}
                        disabled={readOnly}
                        value={l.加工字母 ?? ""}
                        onChange={(e) => setLine(i, { 加工字母: e.target.value })}
                      />
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-20 border-black/10 bg-black/[0.04] text-right text-sm"
                        aria-label={`数量 ${i + 1}`}
                        disabled={readOnly}
                        value={l.数量 ?? 0}
                        onChange={(e) => setLine(i, { 数量: Number(e.target.value) })}
                      />
                    </td>
                    {!priceHidden && (
                      <>
                        <td className={cn(cellCls, "text-right")}>
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-20 border-black/10 bg-black/[0.04] text-right text-sm"
                            aria-label={`单价 ${i + 1}`}
                            disabled={readOnly}
                            value={l.单价 ?? 0}
                            onChange={(e) => setLine(i, { 单价: Number(e.target.value) })}
                          />
                        </td>
                        <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">
                          {(Number(l.数量 ?? 0) * Number(l.单价 ?? 0)).toFixed(2)}
                        </td>
                      </>
                    )}
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`备注 ${i + 1}`}
                        disabled={readOnly}
                        value={l.备注 ?? ""}
                        onChange={(e) => setLine(i, { 备注: e.target.value })}
                      />
                    </td>
                    {!readOnly && (
                      <td className={cn(cellCls, "text-center")}>
                        <button
                          type="button"
                          className="text-sm text-[#dc2626] hover:underline"
                          aria-label={`删除行 ${i + 1}`}
                          onClick={() => syncShown((prev) => prev.filter((_, j) => j !== i))}
                        >
                          删除
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="border-t border-black/8 px-4 py-3">
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              onClick={() => syncShown((prev) => [...prev, { 数量: 0 }])}
            >
              加一行
            </button>
          </div>
        )}
        <div className="f-mono flex shrink-0 items-center gap-8 border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>
            数量合计 <b className="text-[#1a2330]">{数量合计}</b>
          </span>
          {!priceHidden && (
            <span>
              金额合计 <b className="text-[#1a2330]">{金额合计.toFixed(2)}</b>
            </span>
          )}
          <span>
            制单人 <b className="text-[#1a2330]">{currentUser()}</b>
          </span>
        </div>
      </div>

      {/* 单据列表(对照老系统下方 Table:点单号查看;行内三级流转操作) */}
      <div className="f-panel overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "40vh" }}>
          <table data-freeze className="w-full min-w-[1000px] text-[15px]">
            <thead>
              <tr>
                {["单号", "加工厂", "客户", "数量", "日期", "状态", "操作"].map((h) => (
                  <th key={h} className={cn(thCls, h === "数量" && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-disabled">
                    暂无单据
                  </td>
                </tr>
              ) : (
                listRows.map((row) => {
                  const [badgeCls, badgeText] = chainBadge(row);
                  return (
                    <tr key={row.id ?? row.单号} className="border-b border-black/6 last:border-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="f-mono font-semibold whitespace-nowrap text-[#15803d] hover:underline"
                          onClick={() => void openDoc(row.单号!)}
                        >
                          {row.单号}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{row.加工厂名称 ?? ""}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{row.客户名称 ?? ""}</td>
                      <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                        {row.数量 ?? ""}
                      </td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {d10(row.日期)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                            badgeCls,
                          )}
                        >
                          {badgeText}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-wrap gap-3 text-sm">
                          {row.审核 !== "1" && row.主管审核 !== "1" && can(MENU, "审核") && (
                            <button
                              type="button"
                              className="text-[#15803d] hover:underline"
                              onClick={() =>
                                void act(
                                  () => plasticProcessPurchaseOrderApi.supervisorApprove(row.单号!),
                                  "主管已审核",
                                )
                              }
                            >
                              主管审核
                            </button>
                          )}
                          {row.审核 !== "1" &&
                            row.主管审核 === "1" &&
                            row.经理审核 !== "1" &&
                            can(MENU, "审核") && (
                              <button
                                type="button"
                                className="text-[#15803d] hover:underline"
                                onClick={() =>
                                  void act(
                                    () => plasticProcessPurchaseOrderApi.managerApprove(row.单号!),
                                    "经理已审核",
                                  )
                                }
                              >
                                经理审核
                              </button>
                            )}
                          {row.审核 !== "1" && row.经理审核 === "1" && can(MENU, "审核") && (
                            <button
                              type="button"
                              className="text-[#15803d] hover:underline"
                              onClick={() =>
                                void act(
                                  () => plasticProcessPurchaseOrderApi.approve(row.单号!),
                                  "已审核",
                                )
                              }
                            >
                              审核(下发)
                            </button>
                          )}
                          {row.审核 === "1" && can(MENU, "反审核") && (
                            <button
                              type="button"
                              className="text-[#dc2626] hover:underline"
                              onClick={() =>
                                void act(
                                  () => plasticProcessPurchaseOrderApi.unapprove(row.单号!),
                                  "已反审核",
                                )
                              }
                            >
                              反审核
                            </button>
                          )}
                          {row.审核 !== "1" && can(MENU, "删除") && (
                            <button
                              type="button"
                              className="text-[#dc2626] hover:underline"
                              onClick={() => setDeleteFor(row.单号!)}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {rows.length} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={listPage <= 1}
              onClick={() => setListPage((p) => p - 1)}
            >
              <CaretLeft className="h-4 w-4" />
              上一页
            </button>
            <span>
              {listPage} / {listTotalPages}
            </span>
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={listPage >= listTotalPages}
              onClick={() => setListPage((p) => p + 1)}
            >
              下一页
              <CaretRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      </div>

      <FactoryPickerDialog open={factoryOpen} onPick={onPickFactory} onClose={() => setFactoryOpen(false)} />
      <ProductionPickerDialog
        open={prodOpen}
        onPick={(row: ProductionTrackingRow) => void bringFromProduction(row.生产单号 ?? "")}
        onClose={() => setProdOpen(false)}
      />
      <PlasticMaterialPickerDialog
        open={matPickFor !== null}
        onPick={(m) => {
          if (matPickFor !== null)
            setLine(matPickFor, {
              物料编号: m.物料编号 ?? undefined,
              物料名称: m.物料名称 ?? undefined,
              颜色: m.颜色 ?? undefined,
            });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ProductionPickerDialog
        open={prodPickFor !== null}
        onPick={(row) => {
          if (prodPickFor !== null)
            setLine(prodPickFor, {
              生产单号: row.生产单号 ?? undefined,
              款号: row.款号 ?? undefined,
            });
        }}
        onClose={() => setProdPickFor(null)}
      />
      <ConfirmDialog
        open={deleteFor !== null}
        onClose={() => setDeleteFor(null)}
        title="确认删除该单据?"
        confirmLabel="删除"
        onConfirm={() => {
          const no = deleteFor;
          setDeleteFor(null);
          if (no) void act(() => plasticProcessPurchaseOrderApi.remove(no), "已删除");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
