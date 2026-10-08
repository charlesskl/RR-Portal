// 半成品标签单(/semi-finished-label-orders;单据+查询双页签)。
// 对照老系统 web/src/pages/semi/SemiFinishedLabelOrderPage.tsx + SemiFinishedLabelOrderPicker.tsx
// + SemiFinishedLabelPrintPreview.tsx + warehouse/SemiLabelQueryPage.tsx。
// 单据页签:新建/打开/保存/删除/复制单/前单/后单/审核/反审核/打印/标识贴/关闭;
// 明细行 数量/每箱数量 改动重算 预计标签数(=ceil(数量/每箱)),实需标签数手改后不再跟随;
// 打印/标识贴 先校验(打印级:每箱数量必填>0)再开预览弹窗,按实需标签数展开标签卡。
// 查询页签:半成品标签查询(汇总/明细),双击明细行回本页签打开整单(=旧版 ?open= 跳入)。
// 权限菜单:单据与查询同为「半成品标签单」(MenuCatalog.cs:32 实证;老系统两页同 MENU)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { semiLabelOrderApi } from "@/api/endpoints";
import type { SemiLabelOrder, SemiProductRow } from "@/api/types";
import {
  buildSemiPrintLabels,
  makeBlankLabelLine,
  markActualLabelsEdited,
  mergeSelectedLabelProducts,
  recalculateLabelLine,
  validateSemiLabelOrder,
  validateSemiLabelOrderForPrint,
  type SemiLabelLine,
} from "@/lib/semiLabelOrder";
import { esc, openPrintWindow } from "@/lib/printContract";
import { fmtNum } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { SemiProductPickerDialog } from "@/components/doc/SemiProductPickerDialog";
import { SemiDocQueryPanel, type SemiDocQueryCfg, type SemiQueryCol } from "./SemiDocQueryPanel";

const MENU = "半成品标签单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const currentUser = () => getUser() || "";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- 查询页签配置(列序逐字对照老系统 SemiLabelQueryPage) ----------

const LABEL_SUMMARY_COLS: SemiQueryCol[] = [
  { title: "配件编号", key: "配件编号", kind: "doc", size: 10 },
  { title: "客户", key: "客户", size: 8 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 11 },
  { title: "产品名称", key: "产品名称", size: 13 },
  { title: "产品装配名称", key: "产品装配名称", size: 14 },
  { title: "数量", key: "数量", kind: "num", size: 7 },
  { title: "每箱数量", key: "每箱数量", kind: "num", size: 7 },
  { title: "预计标签数", key: "预计标签数", kind: "num", size: 8 },
  { title: "实需标签数", key: "实需标签数", kind: "num", size: 8 },
];
const LABEL_DETAIL_COLS: SemiQueryCol[] = [
  { title: "日期", key: "日期", kind: "date", size: 8 },
  { title: "单号", key: "单号", kind: "doc", size: 10 },
  { title: "配件编号", key: "配件编号", kind: "mono", size: 9 },
  { title: "客户", key: "客户", size: 8 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 11 },
  { title: "产品名称", key: "产品名称", size: 12 },
  { title: "产品装配名称", key: "产品装配名称", size: 13 },
  { title: "数量", key: "数量", kind: "num", size: 7 },
  { title: "每箱数量", key: "每箱数量", kind: "num", size: 7 },
  { title: "预计标签数", key: "预计标签数", kind: "num", size: 8 },
  { title: "实需标签数", key: "实需标签数", kind: "num", size: 8 },
  { title: "备注", key: "备注", size: 10 },
  { title: "审核", key: "审核", kind: "audit", size: 6 },
];

const LABEL_QUERY_CFG: SemiDocQueryCfg = {
  queryKey: "semi-label-query",
  menu: MENU,
  title: "半成品标签查询",
  docTitle: "半成品标签单",
  fields: ["产品货号", "产品名称", "配件编号", "客户", "产品装配名称"],
  defaultField: "产品货号",
  fetchSummary: (q) => semiLabelOrderApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchDetail: (q) => semiLabelOrderApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: LABEL_SUMMARY_COLS,
  detailCols: LABEL_DETAIL_COLS,
  exportSummary: {
    name: "半成品标签查询_汇总",
    cols: ["配件编号", "客户", "产品货号", "产品名称", "产品装配名称", "数量", "每箱数量", "预计标签数", "实需标签数"],
  },
  exportDetail: {
    name: "半成品标签查询_明细",
    cols: ["日期", "单号", "配件编号", "客户", "产品货号", "产品名称", "产品装配名称", "数量", "每箱数量", "预计标签数", "实需标签数", "备注", "审核"],
  },
};

// ---------- 打开单据弹窗(对照老系统 SemiFinishedLabelOrderPicker) ----------

function OrderPickDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (电脑单号: string) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["semi-label", "list", page, kw],
    queryFn: () => semiLabelOrderApi.list(page, 30, kw),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / 30)) : 1;

  return (
    <PickerDialog open={open} onClose={onClose} title="打开半成品标签单" width="sm:max-w-[820px]">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setKw(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="电脑单号/操作员/备注"
          aria-label="单据搜索"
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
        />
        <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
          查询
        </button>
      </form>
      <table className="w-full text-[15px]">
        <thead>
          <tr>
            {["电脑单号", "日期", "操作员", "审核状态"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(query.data?.items ?? []).map((r) => (
            <tr
              key={r.电脑单号}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(r.电脑单号);
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">{r.电脑单号}</td>
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{date10(r.日期)}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{r.操作员}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{r.审核 === "1" ? "已审核" : "未审核"}</td>
            </tr>
          ))}
          {query.isSuccess && (query.data?.items.length ?? 0) === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的半成品标签单
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="f-mono mt-3 flex items-center justify-between text-sm text-[#5f6b7d]">
        <span>
          共 {query.data?.total ?? 0} 条,第 {page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          <button type="button" className="f-btn h-9 px-3.5 text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </PickerDialog>
  );
}

// ---------- 标签打印预览(对照老系统 SemiFinishedLabelPrintPreview:按实需标签数展开卡片) ----------

function labelCardsHtml(labels: ReturnType<typeof buildSemiPrintLabels>, documentNo?: string, documentDate?: string) {
  const cards = labels
    .map(
      (l) => `<article class="card">
  <header><strong>${esc(l.产品货号 || "-")}</strong><span>${l.标签序号}/${l.标签总数}</span></header>
  <dl>
    <div><dt>产品名称</dt><dd>${esc(l.产品名称 || "-")}</dd></div>
    <div><dt>产品装配名称</dt><dd>${esc(l.产品装配名称 || "-")}</dd></div>
    <div><dt>配件编号</dt><dd>${esc(l.配件编号 || "-")}</dd></div>
    <div><dt>客户</dt><dd>${esc(l.客户 || "-")}</dd></div>
    <div><dt>单据</dt><dd>${esc(documentNo || "未保存")}</dd></div>
    <div><dt>日期</dt><dd>${esc(documentDate || "-")}</dd></div>
  </dl>
</article>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>半成品标签打印</title>
<style>
  @page{size:A4;margin:0}
  body{font-family:"Microsoft YaHei",sans-serif;margin:16px;color:#000}
  @media print{body{margin:0;padding:10mm}}
  .grid{display:flex;flex-wrap:wrap;gap:10px}
  .card{border:1px solid #000;width:300px;padding:8px 10px;page-break-inside:avoid}
  .card header{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}
  .card dl{margin:0;font-size:12px}
  .card dl div{display:flex;gap:8px;line-height:1.7}
  .card dt{color:#444;min-width:60px}
  .card dd{margin:0}
  @media print{body{margin:6mm}}
</style></head>
<body><div class="grid">${cards}</div></body></html>`;
}

function LabelPrintPreview({
  open,
  documentNo,
  documentDate,
  lines,
  onClose,
}: {
  open: boolean;
  documentNo?: string;
  documentDate?: string;
  lines: SemiLabelLine[];
  onClose: () => void;
}) {
  const invalid = lines.some(
    (l) => !Number.isFinite(l.实需标签数) || !Number.isInteger(l.实需标签数) || l.实需标签数 < 0,
  );
  const labels = invalid ? [] : buildSemiPrintLabels(lines);
  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title="半成品标签打印预览"
      width="sm:max-w-[980px]"
      footer={
        <>
          <button type="button" className="f-btn px-5" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="f-btn f-btn-cyan px-5"
            disabled={invalid || labels.length === 0}
            onClick={() => openPrintWindow(labelCardsHtml(labels, documentNo, documentDate))}
          >
            <Printer className="h-4.5 w-4.5" />
            打印
          </button>
        </>
      }
    >
      {invalid ? (
        <div className="rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/5 px-4 py-3 text-sm text-[#dc2626]">
          实需标签数必须是非负整数
        </div>
      ) : labels.length === 0 ? (
        <div className="py-6 text-center text-sm text-disabled">没有需要打印的标签</div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {labels.map((l, i) => (
            <article key={`${l.配件编号}-${i}`} className="w-72 rounded-xl border border-black/15 p-3">
              <header className="mb-2 flex items-center justify-between">
                <strong className="f-mono text-[#1a2330]">{l.产品货号 || "-"}</strong>
                <span className="f-mono text-sm text-[#5f6b7d]">
                  {l.标签序号}/{l.标签总数}
                </span>
              </header>
              <dl className="space-y-1 text-sm">
                {(
                  [
                    ["产品名称", l.产品名称],
                    ["产品装配名称", l.产品装配名称],
                    ["配件编号", l.配件编号],
                    ["客户", l.客户],
                    ["单据", documentNo || "未保存"],
                    ["日期", documentDate],
                  ] as [string, string | null | undefined][]
                ).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-16 shrink-0 text-[#5f6b7d]">{k}</dt>
                    <dd className="min-w-0 truncate text-[#1a2330]">{v || "-"}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </PickerDialog>
  );
}

// ---------- 页面 ----------

export default function SemiLabelOrderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [form, setFormState] = useState({ 日期: today(), 备注一: "", 备注二: "" });
  const [lines, setLines] = useState<SemiLabelLine[]>([makeBlankLabelLine(1)]);
  const [opened, setOpened] = useState<SemiLabelOrder | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | "audit" | "reverse" | null>(null);
  const [productPickOpen, setProductPickOpen] = useState(false);
  const [orderPickOpen, setOrderPickOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [invalidLineKey, setInvalidLineKey] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  const audited = opened?.审核 === "1";
  const readOnly = !canSave || audited;
  const mutating = busy !== null;

  const applyOrder = useCallback((order: SemiLabelOrder) => {
    setFormState({
      日期: date10(order.日期) || today(),
      备注一: order.备注一 ?? "",
      备注二: order.备注二 ?? "",
    });
    const loaded = (order.明细 ?? []).map((line, index) => ({
      ...makeBlankLabelLine(index + 1),
      ...line,
      key: index + 1,
      序号: index + 1,
    }));
    setLines(loaded.length ? loaded : [makeBlankLabelLine(1)]);
    setOpened(order);
    setTab("doc");
  }, []);

  const openOrder = useCallback(
    async (orderNo: string) => {
      try {
        applyOrder(await semiLabelOrderApi.get(orderNo));
      } catch (e) {
        notify(errMsg(e) || "打开半成品标签单失败", "err");
      }
    },
    [applyOrder, notify],
  );

  // 从查询报表双击跳入:URL ?open=<电脑单号> 自动打开(仅首次;渲染期消费,同 MaterialLabelOrderPage)
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const [openNo, setOpenNo] = useState<string | null>(null);
  if (openParam && openParam !== openNo) setOpenNo(openParam);
  useEffect(() => {
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("open");
    setSearchParams(next, { replace: true });
  }, [openParam, searchParams, setSearchParams]);
  const openQuery = useQuery({
    queryKey: ["semi-label", "open", openNo],
    queryFn: () => semiLabelOrderApi.get(openNo!),
    enabled: !!openNo,
  });
  const [appliedOpen, setAppliedOpen] = useState<SemiLabelOrder | undefined>(undefined);
  if (openQuery.data && openQuery.data !== appliedOpen) {
    setAppliedOpen(openQuery.data);
    applyOrder(openQuery.data);
  }

  const reset = useCallback(() => {
    setFormState({ 日期: today(), 备注一: "", 备注二: "" });
    setLines([makeBlankLabelLine(1)]);
    setOpened(null);
    setInvalidLineKey(null);
  }, []);

  const save = async () => {
    if (readOnly || !canSave || mutating) return;
    const payload = {
      日期: form.日期 || today(),
      备注一: form.备注一,
      备注二: form.备注二,
      明细: lines
        .filter((l) => l.配件编号.trim() || l.产品货号.trim())
        .map((l, index) => ({ ...l, 序号: index + 1 })),
    };
    const issues = validateSemiLabelOrder(payload);
    if (issues.length) {
      notify(issues[0]?.消息 ?? "请检查标签单明细", "err");
      return;
    }
    setBusy("save");
    try {
      if (opened?.电脑单号) {
        applyOrder(await semiLabelOrderApi.update(opened.电脑单号, payload as never));
      } else {
        const created = await semiLabelOrderApi.create(payload as never);
        applyOrder(await semiLabelOrderApi.get(created.电脑单号));
      }
      notify("半成品标签单已保存", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-label"] });
    } catch (e) {
      notify(errMsg(e) || "保存半成品标签单失败", "err");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!opened?.电脑单号 || audited || mutating) return;
    setBusy("delete");
    try {
      await semiLabelOrderApi.remove(opened.电脑单号);
      notify("半成品标签单已删除", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["semi-label"] });
    } catch (e) {
      notify(errMsg(e) || "删除半成品标签单失败", "err");
    } finally {
      setBusy(null);
    }
  };

  const copyDoc = () => {
    if (!opened || !canSave || mutating) return;
    setOpened(null);
    setLines((cur) => cur.map((l, i) => ({ ...l, ID: undefined, key: i + 1, 序号: i + 1 })));
    notify("已复制为未保存新单", "ok");
  };

  const moveAdjacent = async (direction: "previous" | "next") => {
    if (!opened?.电脑单号 || mutating) return;
    try {
      const order = await semiLabelOrderApi.adjacent(opened.电脑单号, direction);
      if (!order) {
        notify(direction === "previous" ? "已经是第一张单据" : "已经是最后一张单据", "err");
        return;
      }
      applyOrder(order);
    } catch (e) {
      notify(errMsg(e) || "切换相邻单据失败", "err");
    }
  };

  const changeAudit = async (reverse = false) => {
    if (!opened?.电脑单号 || mutating) return;
    const orderNo = opened.电脑单号;
    setBusy(reverse ? "reverse" : "audit");
    try {
      if (reverse) await semiLabelOrderApi.reverseAudit(orderNo);
      else await semiLabelOrderApi.audit(orderNo);
      applyOrder(await semiLabelOrderApi.get(orderNo));
      notify(reverse ? "已反审核" : "已审核", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-label"] });
    } catch (e) {
      notify(errMsg(e) || (reverse ? "反审核失败" : "审核失败"), "err");
    } finally {
      setBusy(null);
    }
  };

  // 打印/标识贴:打印级校验(每箱数量必填>0),首个问题行高亮(对照老系统 openPrintPreview)
  const openPrintPreview = () => {
    const printable = lines.filter((l) => l.配件编号.trim() || l.产品货号.trim());
    const issues = validateSemiLabelOrderForPrint({ 明细: printable });
    if (issues.length) {
      const first = issues[0];
      const lineIndex = Number(first?.字段.match(/^明细\[(\d+)\]/)?.[1] ?? -1);
      const line = lineIndex >= 0 ? printable[lineIndex] : undefined;
      setInvalidLineKey(line?.key ?? null);
      notify(`${line ? `第${lineIndex + 1}行：` : ""}${first?.消息 ?? "请检查标签单明细"}`, "err");
      return;
    }
    setInvalidLineKey(null);
    setPrintOpen(true);
  };

  const updateLine = (key: number, patch: Partial<SemiLabelLine>, recalculate = false) => {
    if (readOnly || mutating) return;
    setLines((cur) =>
      cur.map((l) => {
        if (l.key !== key) return l;
        const next = recalculate ? recalculateLabelLine(l, patch) : { ...l, ...patch };
        return { ...next, key: l.key };
      }),
    );
  };

  // 选产品合并(按配件编号大小写不敏感去重,数量累加;末尾补空行)
  const pickProducts = (products: SemiProductRow[]) => {
    if (readOnly || mutating) return;
    setLines((cur) => {
      const existing = cur.filter((l) => l.配件编号.trim());
      const merged = mergeSelectedLabelProducts(existing, products);
      return [
        ...merged.map((l, i) => ({ ...l, key: i + 1, 序号: i + 1 })),
        makeBlankLabelLine(merged.length + 1),
      ];
    });
  };

  const removeLine = (key: number) => {
    if (readOnly || mutating) return;
    setLines((cur) => {
      const next = cur.filter((l) => l.key !== key).map((l, i) => ({ ...l, key: i + 1, 序号: i + 1 }));
      return next.length ? next : [makeBlankLabelLine(1)];
    });
  };

  const totals = useMemo(
    () =>
      lines.reduce(
        (t, l) => ({
          数量: t.数量 + Number(l.数量 || 0),
          预计标签数: t.预计标签数 + Number(l.预计标签数 || 0),
          实需标签数: t.实需标签数 + Number(l.实需标签数 || 0),
        }),
        { 数量: 0, 预计标签数: 0, 实需标签数: 0 },
      ),
    [lines],
  );

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: mutating, onClick: () => { if (!mutating) reset(); } },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: mutating, onClick: () => setOrderPickOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly || mutating, disabledTitle: audited ? "单据已审核" : !canSave ? "无保存权限" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !opened?.电脑单号 || audited || mutating, disabledTitle: !opened?.电脑单号 ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
    { key: "copy", label: "复制单", icon: Copy, perm: "保存", disabled: !opened || mutating, disabledTitle: !opened ? "先打开单据" : undefined, onClick: copyDoc },
    { key: "prev", label: "前单", icon: CaretLeft, disabled: !opened?.电脑单号 || mutating, disabledTitle: !opened?.电脑单号 ? "先打开单据" : undefined, onClick: () => void moveAdjacent("previous") },
    { key: "next", label: "后单", icon: CaretRight, disabled: !opened?.电脑单号 || mutating, disabledTitle: !opened?.电脑单号 ? "先打开单据" : undefined, onClick: () => void moveAdjacent("next") },
  ];
  const auditActions: DocAction[] = [
    { key: "audit", label: "审核", icon: CheckCircle, perm: "审核", success: true, disabled: !opened?.电脑单号 || audited || mutating, disabledTitle: !opened?.电脑单号 ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => void changeAudit() },
    { key: "unaudit", label: "反审核", icon: ArrowCounterClockwise, perm: "反审核", danger: true, disabled: !opened?.电脑单号 || !audited || mutating, disabledTitle: !opened?.电脑单号 ? "先打开单据" : "单据未审核", onClick: () => void changeAudit(true) },
  ];
  const tailActions: DocAction[] = [
    { key: "print", label: "打印", icon: Printer, perm: "打印", disabled: mutating, onClick: openPrintPreview },
    { key: "sticker", label: "标识贴", perm: "打印", disabled: mutating, onClick: openPrintPreview },
    { key: "close", label: "关闭", icon: X, danger: true, disabled: mutating, onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")) },
  ];

  if (!permsLoading && !canOpen && tab === "doc") {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「半成品标签单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签(对照老系统 DocQueryTabs) */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          半成品标签单
          {tab === "doc" && opened?.电脑单号 ? ` · ${opened.电脑单号}` : ""}
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
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { key: "doc" as const, label: "半成品标签单" },
            { key: "query" as const, label: "半成品标签查询" },
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
      </div>

      {tab === "query" ? (
        <SemiDocQueryPanel cfg={LABEL_QUERY_CFG} onOpenDoc={(no) => void openOrder(no)} />
      ) : (
        <>
          {/* 操作栏:编辑 / 审核 / 打印关闭 三组 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={auditActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={tailActions} menuKey={MENU} />
          </div>

          {/* 单头(对照老系统 Form:电脑单号/日期/操作员/审核状态/备注一/备注二) */}
          <div className="f-panel p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3 lg:grid-cols-6">
              <FormField label="电脑单号">
                <Input className={inputCls} aria-label="电脑单号" readOnly placeholder="保存后自动生成" value={opened?.电脑单号 ?? ""} />
              </FormField>
              <FormField label="日期">
                <Input
                  type="date"
                  className={inputCls}
                  aria-label="日期"
                  disabled={readOnly || mutating}
                  value={form.日期}
                  onChange={(e) => setFormState((f) => ({ ...f, 日期: e.target.value }))}
                />
              </FormField>
              <FormField label="操作员">
                <Input className={inputCls} aria-label="操作员" readOnly value={opened?.操作员 ?? currentUser()} />
              </FormField>
              <FormField label="备注一">
                <Input
                  className={inputCls}
                  aria-label="备注一"
                  disabled={readOnly || mutating}
                  value={form.备注一}
                  onChange={(e) => setFormState((f) => ({ ...f, 备注一: e.target.value }))}
                />
              </FormField>
              <FormField label="备注二">
                <Input
                  className={inputCls}
                  aria-label="备注二"
                  disabled={readOnly || mutating}
                  value={form.备注二}
                  onChange={(e) => setFormState((f) => ({ ...f, 备注二: e.target.value }))}
                />
              </FormField>
            </div>
          </div>

          {/* 明细编辑网格(列序对照老系统:删除|序号|配件编号|客户|产品货号|产品名称|产品装配名称|数量|每箱数量|预计标签数|实需标签数|备注) */}
          <div className="f-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={readOnly || mutating}
                onClick={() => setProductPickOpen(true)}
              >
                选产品加行
              </button>
              <span className="text-sm text-[#5f6b7d]">点明细行「配件编号/产品货号」也可打开产品选择</span>
            </div>
            <div className="max-h-[46vh] overflow-auto">
              <table data-freeze className="w-full min-w-[1500px] text-[15px]">
                <thead>
                  <tr className="border-b border-black/8">
                    {["删除", "序号", "配件编号", "客户", "产品货号", "产品名称", "产品装配名称", "数量", "每箱数量", "预计标签数", "实需标签数", "备注"].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          pickerThCls,
                          ["数量", "每箱数量", "预计标签数", "实需标签数"].includes(h) && "text-right",
                          h === "删除" && "text-center",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((r, i) => (
                    <tr
                      key={r.key}
                      className={cn(
                        "border-b border-black/6 last:border-0",
                        invalidLineKey === r.key && "bg-[#dc2626]/6",
                      )}
                    >
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          aria-label="删除明细行"
                          disabled={readOnly || mutating}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#dc2626] transition-colors hover:bg-[#dc2626]/10"
                          onClick={() => removeLine(r.key)}
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-disabled">{r.序号 ?? i + 1}</td>
                      <td className="px-3 py-2">
                        <Input
                          className={cn(inputCls, "h-9 w-32")}
                          aria-label="配件编号"
                          value={r.配件编号}
                          readOnly
                          disabled={readOnly || mutating}
                          onClick={() => !(readOnly || mutating) && setProductPickOpen(true)}
                        />
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.客户 ?? ""}</td>
                      <td className="px-3 py-2">
                        <Input
                          className={cn(inputCls, "h-9 w-32")}
                          aria-label="产品货号"
                          value={r.产品货号}
                          readOnly
                          disabled={readOnly || mutating}
                          onClick={() => !(readOnly || mutating) && setProductPickOpen(true)}
                        />
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.产品名称 ?? ""}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.产品装配名称 ?? ""}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          aria-label="数量"
                          className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                          disabled={readOnly || mutating}
                          value={r.数量}
                          onChange={(e) => updateLine(r.key, { 数量: Number(e.target.value || 0) }, true)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          aria-label="每箱数量"
                          className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                          disabled={readOnly || mutating}
                          value={r.每箱数量 ?? ""}
                          onChange={(e) =>
                            updateLine(
                              r.key,
                              { 每箱数量: e.target.value === "" ? undefined : Number(e.target.value) },
                              true,
                            )
                          }
                        />
                      </td>
                      <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{r.预计标签数}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          aria-label="实需标签数"
                          className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                          disabled={readOnly || mutating}
                          value={r.实需标签数}
                          onChange={(e) =>
                            updateLine(r.key, markActualLabelsEdited(r, Number(e.target.value || 0)))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          className={cn(inputCls, "h-9 w-36")}
                          aria-label="行备注"
                          disabled={readOnly || mutating}
                          value={r.备注 ?? ""}
                          onChange={(e) => updateLine(r.key, { 备注: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 合计(对照老系统 Statistic:数量/预计标签数/实需标签数) */}
            <div className="flex gap-10 border-t border-black/8 px-4 py-3">
              <span className="text-sm text-[#5f6b7d]">
                数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{fmtNum(totals.数量, 2)}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                预计标签数合计:<span className="f-mono text-base font-bold text-[#1a2330]">{totals.预计标签数}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                实需标签数合计:<span className="f-mono text-base font-bold text-[#1a2330]">{totals.实需标签数}</span>
              </span>
            </div>
          </div>
        </>
      )}

      <SemiProductPickerDialog
        open={productPickOpen}
        permMenu={MENU}
        loadProducts={(q) => semiLabelOrderApi.products(q)}
        onPick={(rows) => pickProducts(rows)}
        onClose={() => setProductPickOpen(false)}
      />
      <OrderPickDialog open={orderPickOpen} onPick={(no) => void openOrder(no)} onClose={() => setOrderPickOpen(false)} />
      <LabelPrintPreview
        open={printOpen}
        documentNo={opened?.电脑单号 ?? undefined}
        documentDate={form.日期}
        lines={lines.filter((l) => l.配件编号.trim() || l.产品货号.trim())}
        onClose={() => setPrintOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该半成品标签单?"
        description={opened?.电脑单号 ? `单号:${opened.电脑单号}` : undefined}
        onConfirm={() => {
          setDeleteOpen(false);
          void remove();
        }}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
