// 半成品入仓单(/semi-receipts;单据+查询双页签)。对照老系统:
// web/src/pages/warehouse/SemiReceiptPage.tsx + SemiReceiptQueryPage.tsx + SemiReceiptOrderPicker.tsx。
// 单据页签:新建/打开/保存(新建 POST,已开未审核单 PUT 更新)/删除/复制单/刷新/前单/后单/审核/反审核/打印/关闭;
// 供应商选择带出编号+名称;订单单号(合同号)必填;收货仓库 半成品仓/成品仓;
// 明细行点「配件编号」开产品多选(按 配件编号|产品货号 去重合并);右侧 入仓数量汇总侧表;
// ?open=<单号> 查询页签双击跳入;?mo=<生产单号> 从生产单跟踪跳入:带出合同号+按货号精确查产品展开明细。
// 查询页签:半成品入仓查询(汇总可按供应商/物料查询(共用物料);明细审核情况),双击回单据页签。
// 权限菜单:单据与查询同为「半成品入仓」(MenuCatalog.cs:30 实证;老系统两页同 MENU)。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { productionApi, semiReceiptApi } from "@/api/endpoints";
import type { SemiProductRow, SRDetail, SRHeader, SRKitLine, SRKitResult } from "@/api/types";
import {
  mergeSemiReceiptProducts,
  printSemiDoc,
  summarizeSemiReceiptLines,
  validateSemiReceipt,
  type SemiDocPrintCfg,
  type SemiReceiptEditLine,
} from "@/lib/semiDocs";
import { fmtDate, fmtNum } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { SupplierPickerDialog } from "@/components/doc/SupplierPickerDialog";
import { SemiProductPickerDialog } from "@/components/doc/SemiProductPickerDialog";
import { SemiDocQueryPanel, type SemiDocQueryCfg, type SemiQueryCol } from "./SemiDocQueryPanel";

const MENU = "半成品入仓";
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
const uid = () => rowSeq++;
const blankLine = (): SemiReceiptEditLine => ({ key: uid(), 配件编号: "", 产品货号: "", 数量: 0, 单位: "个" });

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- 查询页签配置(列序逐字对照老系统 SemiReceiptQueryPage) ----------

const RECEIPT_SUMMARY_COLS: SemiQueryCol[] = [
  { title: "配件编号", key: "配件编号", kind: "doc", size: 10 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 12 },
  { title: "产品名称", key: "产品名称", size: 14 },
  { title: "产品装配名称", key: "产品装配名称", size: 15 },
  { title: "入仓数量", key: "入仓数量", kind: "num", size: 9 },
];
const RECEIPT_DETAIL_COLS: SemiQueryCol[] = [
  { title: "日期", key: "日期", kind: "date", size: 8 },
  { title: "单号", key: "单号", kind: "doc", size: 10 },
  { title: "入库单号", key: "入库单号", kind: "mono", size: 9 },
  { title: "订单单号", key: "订单单号", kind: "mono", size: 10 },
  { title: "供应商编号", key: "供应商编号", kind: "mono", size: 8 },
  { title: "供应商名称", key: "供应商名称", size: 11 },
  { title: "生产单号", key: "生产单号", kind: "mono", size: 9 },
  { title: "配件编号", key: "配件编号", kind: "mono", size: 9 },
  { title: "产品货号", key: "产品货号", kind: "mono", size: 11 },
  { title: "产品名称", key: "产品名称", size: 12 },
  { title: "产品装配名称", key: "产品装配名称", size: 13 },
  { title: "数量", key: "数量", kind: "num", size: 7 },
  { title: "备注", key: "备注", size: 9 },
  { title: "审核", key: "审核", kind: "audit", size: 6 },
];

const RECEIPT_QUERY_CFG: SemiDocQueryCfg = {
  queryKey: "semi-receipt-query",
  menu: MENU,
  title: "半成品入仓查询",
  docTitle: "半成品入仓单",
  fields: ["产品装配名称", "产品货号", "产品名称", "配件编号", "客户"],
  defaultField: "产品装配名称",
  fetchSummary: (q) => semiReceiptApi.querySummary(q) as unknown as Promise<Record<string, unknown>[]>,
  fetchDetail: (q) => semiReceiptApi.queryDetail(q) as unknown as Promise<Record<string, unknown>[]>,
  summaryCols: RECEIPT_SUMMARY_COLS,
  detailCols: RECEIPT_DETAIL_COLS,
  exportSummary: {
    name: "半成品入仓查询_汇总",
    cols: ["配件编号", "供应商名称", "产品货号", "产品名称", "产品装配名称", "入仓数量"],
  },
  exportDetail: {
    name: "半成品入仓查询_明细",
    cols: ["日期", "单号", "入库单号", "订单单号", "供应商编号", "供应商名称", "生产单号", "配件编号", "产品货号", "产品名称", "产品装配名称", "数量", "备注", "审核"],
  },
  summaryBy: {
    key: "bySupplier",
    label: "汇总按供应商",
    extraCol: { title: "供应商", key: "供应商名称", size: 12 },
  },
  totalKey: "入仓数量",
  totalLabel: "总合计",
};

// ---------- 打印规格(老系统 window.print() 打印整页;新系统开新窗口渲染单头+明细) ----------

const PRINT_CFG = (hidePrice: boolean): SemiDocPrintCfg => ({
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["订单单号", "订单单号"],
    ["供应商", "供应商名称"],
    ["仓库", "仓库"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["订单单号", "订单单号"],
    ["配件编号", "配件编号"],
    ["客户", "客户"],
    ["产品货号", "产品货号"],
    ["产品名称", "产品名称"],
    ["产品装配名称", "产品装配名称"],
    ["生产单号", "生产单号"],
    ["数量", "数量"],
    ...(hidePrice ? [] : ([["单价", "单价"]] as [string, string][])),
    ["备注", "备注"],
  ],
});

// ---------- 打开单据弹窗列 ----------

const openCol = createColumnHelper<SRHeader>();
const listColumns: ColumnDef<SRHeader, any>[] = [
  openCol.accessor("单号", {
    header: "电脑单号",
    size: 18,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 12,
    cell: (c) => fmtDate(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.accessor("订单单号", { header: "订单单号", size: 16, meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" } }),
  openCol.accessor("供应商名称", { header: "供应商", size: 20 }),
  openCol.accessor("仓库", { header: "仓库", size: 12 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 10,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
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

interface HeaderFormState {
  供应商编号: string;
  供应商名称: string;
  日期: string;
  订单单号: string;
  仓库: string;
  备注: string;
  打印合并表格: boolean;
}
const emptyHeader = (): HeaderFormState => ({
  供应商编号: "",
  供应商名称: "",
  日期: today(),
  订单单号: "",
  仓库: WAREHOUSE,
  备注: "",
  打印合并表格: true,
});

export default function SemiReceiptPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const priceHidden = !can(MENU, "单价");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [opened, setOpened] = useState<SRDetail | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [lines, setLines] = useState<SemiReceiptEditLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  // 齐套检查:行key → 组成物料状态;kitConfirm = 保存前欠缺确认( body 暂存待确认后继续)
  const [kits, setKits] = useState<Record<number, SRKitResult>>({});
  const [kitConfirm, setKitConfirm] = useState<{
    body: NonNullable<ReturnType<typeof buildPayload>>;
    lacking: { label: string; lacks: SRKitLine[] }[];
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  // 齐套检查:行填了 配件编号+生产单号+数量>0 后自动拉组成物料状态(防抖 400ms;失败不阻塞录入)
  const kitSig = lines
    .filter((l) => l.配件编号.trim() && l.生产单号?.trim() && l.数量 > 0)
    .map((l) => `${l.key}|${l.配件编号.trim()}|${l.产品货号.trim()}|${l.生产单号!.trim()}|${l.数量}`)
    .join(";");
  useEffect(() => {
    const valid = lines.filter((l) => l.配件编号.trim() && l.生产单号?.trim() && l.数量 > 0);
    const t = setTimeout(() => {
      void (async () => {
        const next: Record<number, SRKitResult> = {};
        await Promise.all(
          valid.map(async (l) => {
            try {
              next[l.key] = await semiReceiptApi.kitCheck({
                半成品: l.配件编号.trim(),
                货号: l.产品货号.trim() || undefined,
                生产单号: l.生产单号!.trim(),
                数量: l.数量,
              });
            } catch {
              /* 网络失败不阻塞录入 */
            }
          }),
        );
        setKits(next);
      })();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitSig]);

  const audited = opened?.单头?.审核 === "1";
  const readOnly = audited || !canSave || busy;
  const 单号 = opened?.单头?.单号 ?? "";

  const applyDetail = useCallback((detail: SRDetail) => {
    const h = detail.单头;
    setFormState({
      供应商编号: h?.供应商编号 ?? "",
      供应商名称: h?.供应商名称 ?? "",
      日期: date10(h?.日期) || today(),
      订单单号: h?.订单单号 ?? "",
      仓库: h?.仓库 ?? WAREHOUSE,
      备注: h?.备注 ?? "",
      打印合并表格: true,
    });
    const loaded: SemiReceiptEditLine[] = (detail.明细 ?? []).map((line, index) => ({
      key: index + 1,
      订单单号: line.订单单号 ?? "",
      配件编号: line.配件编号 ?? line.物料编号 ?? "",
      客户: line.客户 ?? "",
      产品货号: line.产品货号 ?? "",
      产品名称: line.产品名称 ?? "",
      产品装配名称: line.产品装配名称 ?? line.物料名称 ?? "",
      生产单号: line.生产单号 ?? "",
      单位: line.单位 ?? "个",
      数量: Number(line.数量 ?? 0),
      单价: line.单价 ?? 0,
      备注: line.备注 ?? "",
    }));
    rowSeq = Math.max(rowSeq, loaded.length + 1);
    setLines([...loaded, { ...blankLine(), key: loaded.length + 1 }]);
    setOpened(detail);
    setTab("doc");
  }, []);

  const openDocument = useCallback(
    async (documentNo: string) => {
      setBusy(true);
      try {
        applyDetail(await semiReceiptApi.get(documentNo));
      } catch (e) {
        notify(errMsg(e) || "打开半成品入仓单失败", "err");
      } finally {
        setBusy(false);
      }
    },
    [applyDetail, notify],
  );

  // ?open=<单号> 查询页签双击跳入(仅首次;对照老系统 autoOpenedRef)
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const moParam = searchParams.get("mo");
  const consumedRef = useRef<{ open?: string; mo?: string }>({});
  useEffect(() => {
    if (openParam && consumedRef.current.open !== openParam) {
      consumedRef.current.open = openParam;
      const next = new URLSearchParams(searchParams);
      next.delete("open");
      setSearchParams(next, { replace: true });
      void openDocument(openParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam]);

  // ?mo=<生产单号> 从「查询生产单」跳入:带出合同号(订单单号)+按货号精确查产品展开明细(对照老系统 mo 处理)
  useEffect(() => {
    if (!moParam || consumedRef.current.mo === moParam) return;
    consumedRef.current.mo = moParam;
    const next = new URLSearchParams(searchParams);
    next.delete("mo");
    setSearchParams(next, { replace: true });
    const mo = moParam;
    if (opened?.单头?.单号) return;
    void (async () => {
      let po = "";
      let 客户 = "";
      let goods: { 货号?: string | null; 款号名称?: string | null; 数量?: number | null }[] = [];
      try {
        const d = await productionApi.get(mo);
        po = d.单头?.合同号 ?? "";
        客户 = d.单头?.客户名称 ?? "";
        goods = (d.货号明细 ?? []).filter((g) => g.货号);
      } catch {
        /* 生产单不存在则只带生产单号 */
      }
      if (po) setFormState((f) => ({ ...f, 订单单号: po }));
      if (goods.length === 0) {
        setLines([{ key: 1, 订单单号: po, 生产单号: mo, 配件编号: "", 产品货号: "", 数量: 0, 单位: "个" }]);
        notify(`已带入生产单号 ${mo}，请完善明细后保存`, "ok");
        return;
      }
      const newLines: SemiReceiptEditLine[] = [];
      for (const g of goods) {
        let products: SemiProductRow[] = [];
        try {
          products = (await semiReceiptApi.products({ field: "产品货号", keyword: g.货号 ?? undefined, exact: true, page: 1, size: 50 })).items;
        } catch {
          /* 查不到则只带货号 */
        }
        if (products.length > 0)
          for (const p of products)
            newLines.push({
              key: newLines.length + 1,
              订单单号: po,
              配件编号: p.配件编号 ?? "",
              客户: p.客户 ?? 客户,
              产品货号: p.产品货号 ?? g.货号 ?? "",
              产品名称: p.产品名称 ?? g.款号名称 ?? "",
              产品装配名称: p.产品装配名称 ?? "",
              生产单号: mo,
              数量: Number(g.数量 ?? 0),
              单位: "个",
            });
        else
          newLines.push({
            key: newLines.length + 1,
            订单单号: po,
            配件编号: "",
            客户,
            产品货号: g.货号 ?? "",
            产品名称: g.款号名称 ?? "",
            生产单号: mo,
            数量: Number(g.数量 ?? 0),
            单位: "个",
          });
      }
      rowSeq = Math.max(rowSeq, newLines.length + 2);
      setLines([...newLines, { ...blankLine(), key: newLines.length + 1 }]);
      notify(`已带入生产单号 ${mo} 的 ${newLines.length} 行明细，请核对数量后保存`, "ok");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moParam]);

  const reset = () => {
    setFormState(emptyHeader());
    setLines([blankLine()]);
    setOpened(null);
  };

  const buildPayload = () => {
    if (!form.订单单号.trim()) {
      notify("请填写订单单号（合同号）：从生产单带入会自动带出，手工开单需手填", "err");
      return null;
    }
    const actual = lines.filter((l) => l.配件编号.trim() || l.产品货号.trim());
    const issue = validateSemiReceipt({ 供应商名称: form.供应商名称, 仓库: form.仓库, 明细: actual });
    if (issue) {
      notify(issue, "err");
      return null;
    }
    return {
      日期: form.日期 || today(),
      订单单号: form.订单单号.trim(),
      仓库: form.仓库,
      供应商编号: form.供应商编号.trim() || undefined,
      供应商名称: form.供应商名称.trim() || undefined,
      备注: form.备注.trim() || undefined,
      明细: actual.map((l) => ({
        ...l,
        客户: l.客户 ?? "",
        产品名称: l.产品名称 ?? "",
        产品装配名称: l.产品装配名称 ?? "",
        单价: l.单价 ?? 0,
        物料编号: l.配件编号,
        物料名称: l.产品装配名称 ?? "",
      })),
    };
  };

  const doSave = async (body: NonNullable<ReturnType<typeof buildPayload>>) => {
    setBusy(true);
    try {
      if (单号) applyDetail(await semiReceiptApi.update(单号, body));
      else {
        const created = await semiReceiptApi.create(body);
        applyDetail(await semiReceiptApi.get(created.单号));
      }
      notify("半成品入仓单已保存", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-receipt"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "保存半成品入仓单失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const body = buildPayload();
    if (!body || readOnly) return;
    // 齐套拦截:半成品组成物料有欠缺的行先列出来,确认后才继续保存(外发未回齐防止半个半成品入仓)
    const lacking = lines
      .map((l, i) => ({ l, i, kit: kits[l.key] }))
      .filter((x) => x.kit?.有定义 && !x.kit.齐套)
      .map((x) => ({
        label: `行${x.i + 1}「${x.l.配件编号}」`,
        lacks: x.kit!.组成.filter((g) => g.还差 > 0),
      }));
    if (lacking.length > 0) {
      setKitConfirm({ body, lacking });
      return;
    }
    void doSave(body);
  };

  const remove = async () => {
    if (!单号) return;
    setBusy(true);
    try {
      await semiReceiptApi.remove(单号);
      reset();
      notify("半成品入仓单已删除", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-receipt"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || "删除失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const audit = async (reverse = false) => {
    if (!单号) return;
    setBusy(true);
    try {
      if (reverse) await semiReceiptApi.unapprove(单号);
      else await semiReceiptApi.approve(单号);
      applyDetail(await semiReceiptApi.get(单号));
      notify(reverse ? "已反审核" : "已审核", "ok");
      void qc.invalidateQueries({ queryKey: ["semi-receipt"] });
      invalidateCrossPage(qc);
    } catch (e) {
      notify(errMsg(e) || (reverse ? "反审核失败" : "审核失败"), "err");
    } finally {
      setBusy(false);
    }
  };

  const adjacent = async (direction: "previous" | "next") => {
    if (!单号) return;
    setBusy(true);
    try {
      const detail = await semiReceiptApi.adjacent(单号, direction);
      if (detail) applyDetail(detail);
      else notify(direction === "previous" ? "已经是第一张单据" : "已经是最后一张单据", "err");
    } catch (e) {
      notify(errMsg(e) || "切换相邻单据失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    setOpened(null);
    setFormState((f) => ({ ...f, 日期: today() }));
    setLines((cur) => cur.map((l, i) => ({ ...l, key: i + 1 })));
    notify("已复制为新单", "ok");
  };

  const updateLine = (key: number, patch: Partial<SemiReceiptEditLine>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) =>
    setLines((cur) => {
      const next = cur.filter((l) => l.key !== key).map((l, i) => ({ ...l, key: i + 1 }));
      return next.length ? next : [blankLine()];
    });
  const pickProducts = (products: SemiProductRow[]) =>
    setLines((cur) => {
      const actual = cur.filter((l) => l.配件编号.trim());
      const merged = mergeSemiReceiptProducts(actual, products);
      return [...merged, { ...blankLine(), key: merged.length + 1 }];
    });

  const summary = useMemo(() => summarizeSemiReceiptLines(lines), [lines]);
  const totals = useMemo(
    () =>
      lines.reduce(
        (t, l) => ({ qty: t.qty + Number(l.数量 || 0), amount: t.amount + Number(l.数量 || 0) * Number(l.单价 || 0) }),
        { qty: 0, amount: 0 },
      ),
    [lines],
  );

  const listQuery = useQuery({
    queryKey: ["semi-receipt", "list", page, keyword],
    queryFn: () => semiReceiptApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const doPrint = () => {
    printSemiDoc(
      `半成品入仓单 ${单号 || "未保存"}`,
      {
        单头: { 单号, ...form, 操作员: opened?.单头?.操作员 ?? currentUser() } as Record<string, unknown>,
        明细: lines.filter((l) => l.配件编号.trim() || l.产品货号.trim()) as unknown as Record<string, unknown>[],
      },
      PRINT_CFG(priceHidden),
    );
  };

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: busy, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: busy, onClick: () => setDialogOpen(true) },
    { key: "save", label: "保存", icon: FloppyDisk, perm: "保存", primary: true, disabled: readOnly, disabledTitle: audited ? "单据已审核" : !canSave ? "无保存权限" : undefined, onClick: () => void save() },
    { key: "del", label: "删除", icon: Trash, perm: "删除", danger: true, disabled: !单号 || audited || busy, disabledTitle: !单号 ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => setDeleteOpen(true) },
    { key: "copy", label: "复制单", icon: Copy, perm: "保存", disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: copy },
    { key: "refresh", label: "刷新", disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => 单号 && void openDocument(单号) },
    { key: "prev", label: "前单", icon: CaretLeft, disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => void adjacent("previous") },
    { key: "next", label: "后单", icon: CaretRight, disabled: !opened || busy, disabledTitle: !opened ? "先打开单据" : undefined, onClick: () => void adjacent("next") },
  ];
  const auditActions: DocAction[] = [
    { key: "audit", label: "审核", icon: CheckCircle, perm: "审核", success: true, disabled: !opened || audited || busy, disabledTitle: !opened ? "先打开单据" : audited ? "单据已审核" : undefined, onClick: () => void audit() },
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
            description="缺少「半成品入仓·打开」权限,请联系管理员开通"
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
          半成品入仓单
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
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { key: "doc" as const, label: "半成品入仓单" },
            { key: "query" as const, label: "半成品入仓查询" },
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
        <SemiDocQueryPanel cfg={RECEIPT_QUERY_CFG} onOpenDoc={(no) => void openDocument(no)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <DocToolbar actions={editActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={auditActions} menuKey={MENU} />
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={tailActions} menuKey={MENU} />
          </div>

          {/* 单头表单(对照老系统 Form 栅格;已审核/无保存位只读) */}
          <div className="f-panel p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4 lg:grid-cols-6">
              <FormField label="供应商">
                <div className="relative flex gap-2">
                  <Input className={inputCls} aria-label="供应商" readOnly placeholder="请选择供应商" value={form.供应商名称} />
                  <button
                    type="button"
                    className="f-btn h-10 shrink-0 px-3.5 text-sm"
                    disabled={readOnly}
                    onClick={() => setSupplierOpen(true)}
                  >
                    选择
                  </button>
                  <span className="absolute top-1/2 right-16 -translate-y-1/2 text-[#dc2626]">*</span>
                </div>
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
              <FormField label="订单单号（合同号）">
                <div className="relative">
                  <Input
                    className={inputCls}
                    aria-label="订单单号"
                    disabled={readOnly}
                    placeholder="从生产单带入自动带出"
                    value={form.订单单号}
                    onChange={(e) => setFormState((f) => ({ ...f, 订单单号: e.target.value }))}
                  />
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[#dc2626]">*</span>
                </div>
              </FormField>
              <FormField label="电脑单号">
                <Input className={inputCls} aria-label="电脑单号" readOnly placeholder="保存后生成" value={单号} />
              </FormField>
              <FormField label="收货仓库">
                <SearchSelect
                  ariaLabel="收货仓库"
                  className={cn(inputCls, "rounded-md border")}
                  disabled={readOnly}
                  value={form.仓库}
                  options={["半成品仓", "成品仓"].map((v) => ({ value: v, label: v }))}
                  onChange={(v) => setFormState((f) => ({ ...f, 仓库: v }))}
                />
              </FormField>
              <FormField label="操作员">
                <Input className={inputCls} aria-label="操作员" readOnly value={opened?.单头?.操作员 ?? currentUser()} />
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
              <FormField label="入库单号">
                <Input className={inputCls} aria-label="入库单号" readOnly placeholder="保存后生成" value={单号} />
              </FormField>
              <label className="flex items-end gap-2 pb-2 text-sm text-[#3d4a5c]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#16a34a]"
                  aria-label="打印合并表格"
                  disabled={readOnly}
                  checked={form.打印合并表格}
                  onChange={(e) => setFormState((f) => ({ ...f, 打印合并表格: e.target.checked }))}
                />
                打印合并表格
              </label>
            </div>
          </div>

          {/* 明细 + 右侧入仓数量汇总(对照老系统 17/7 栅格) */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
            <div className="f-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
                <button
                  type="button"
                  className="f-btn h-9 px-3.5 text-sm"
                  disabled={readOnly}
                  onClick={() => setProductOpen(true)}
                >
                  选产品加行
                </button>
                <button
                  type="button"
                  className="f-btn h-9 px-3.5 text-sm"
                  disabled={readOnly}
                  onClick={() =>
                    setLines((cur) => {
                      const actual = cur.filter((l) => l.配件编号.trim());
                      return [...actual, { ...blankLine(), key: actual.length + 1 }];
                    })
                  }
                >
                  删除空白行
                </button>
              </div>
              <div className="max-h-[46vh] overflow-auto">
                <table data-freeze className="w-full min-w-[1450px] text-[15px]">
                  <thead>
                    <tr className="border-b border-black/8">
                      {["删除", "订单单号", "配件编号", "客户", "产品货号", "产品名称", "产品装配名称", "生产单号", "数量", "备注"].map((h) => (
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
                            onClick={() => removeLine(l.key)}
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={cellInputCls}
                            aria-label="行订单单号"
                            disabled={readOnly}
                            value={l.订单单号 ?? ""}
                            onChange={(e) => updateLine(l.key, { 订单单号: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={cn(cellInputCls, "f-mono font-semibold")}
                            aria-label="配件编号"
                            readOnly
                            disabled={readOnly}
                            value={l.配件编号}
                            onClick={() => !readOnly && setProductOpen(true)}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.客户 ?? ""}</td>
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#1a2330]">{l.产品货号}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.产品名称 ?? ""}</td>
                        <td className="px-3 py-1.5 text-[#3d4a5c]">{l.产品装配名称 ?? ""}</td>
                        <td className="px-2 py-1.5">
                          <input
                            className={cellInputCls}
                            aria-label="行生产单号"
                            disabled={readOnly}
                            value={l.生产单号 ?? ""}
                            onChange={(e) => updateLine(l.key, { 生产单号: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={cn(cellInputCls, "f-mono text-right")}
                            aria-label="数量"
                            type="number"
                            min={0}
                            disabled={readOnly}
                            value={l.数量}
                            onChange={(e) => updateLine(l.key, { 数量: Number(e.target.value || 0) })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={cellInputCls}
                            aria-label="行备注"
                            disabled={readOnly}
                            value={l.备注 ?? ""}
                            onChange={(e) => updateLine(l.key, { 备注: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* 入仓数量汇总侧表(对照老系统 summarizeSemiReceiptLines) */}
            <div className="f-panel overflow-hidden">
              <div className="border-b border-black/8 px-4 py-2.5 text-sm font-semibold text-[#1a2330]">
                入仓数量汇总
              </div>
              <div className="max-h-[46vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/8">
                      {["序号", "配件编号", "产品装配名称", "入仓数量"].map((h) => (
                        <th
                          key={h}
                          className={cn(
                            "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                            h === "入仓数量" && "text-right",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s) => (
                      <tr key={s.key} className="border-b border-black/6 last:border-0">
                        <td className="px-3 py-2 text-disabled">{s.序号}</td>
                        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{s.配件编号}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{s.产品装配名称}</td>
                        <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{s.入仓数量}</td>
                      </tr>
                    ))}
                    {summary.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-sm text-disabled">
                          暂无明细
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 半成品组成齐套检查:填了 配件编号+生产单号+数量 的行自动列出组成物料 需要/已回/还差 */}
          {lines.some((l) => kits[l.key]?.有定义) && (
            <div className="f-panel overflow-hidden">
              <div className="border-b border-black/8 px-4 py-2.5 text-sm font-semibold text-[#1a2330]">
                半成品组成齐套检查
              </div>
              {lines.map((l, i) => {
                const kit = kits[l.key];
                if (!kit?.有定义) return null;
                return (
                  <div key={l.key} className="border-b border-black/6 px-4 py-3 last:border-0">
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <span className="f-mono font-medium text-[#1a2330]">
                        行{i + 1}「{l.配件编号}」× {l.数量} 套
                      </span>
                      {kit.齐套 ? (
                        <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-medium text-[#15803d]">
                          已齐套
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#dc2626]/10 px-2 py-0.5 text-xs font-medium text-[#dc2626]">
                          组成未齐
                        </span>
                      )}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-black/8">
                          {["物料编号", "物料名称", "单位", "每套用量", "需要", "已回", "还差"].map((h) => (
                            <th
                              key={h}
                              className={cn(
                                "f-label px-2 py-1.5 text-left font-medium normal-case",
                                ["每套用量", "需要", "已回", "还差"].includes(h) && "text-right",
                              )}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {kit.组成.map((g) => (
                          <tr key={g.物料编号} className="border-b border-black/6 last:border-0">
                            <td className="f-mono px-2 py-1.5 whitespace-nowrap">{g.物料编号}</td>
                            <td className="px-2 py-1.5">{g.物料名称}</td>
                            <td className="px-2 py-1.5">{g.单位}</td>
                            <td className="f-mono px-2 py-1.5 text-right">{g.每件用量}</td>
                            <td className="f-mono px-2 py-1.5 text-right">{g.需要}</td>
                            <td className="f-mono px-2 py-1.5 text-right">{g.已回}</td>
                            <td
                              className={cn(
                                "f-mono px-2 py-1.5 text-right font-semibold",
                                g.还差 > 0 ? "text-[#dc2626]" : "text-[#15803d]",
                              )}
                            >
                              {g.还差}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {/* 合计(对照老系统 Statistic 数量/金额;金额按「单价」位遮蔽) */}
          <div className="f-panel flex flex-wrap gap-10 px-6 py-4">
            <div>
              <div className="f-label">数量</div>
              <div className="f-mono mt-1 text-xl font-bold text-[#1a2330]">{totals.qty}</div>
            </div>
            <div>
              <div className="f-label">金额</div>
              <div className="f-mono mt-1 text-xl font-bold text-[#1a2330]">
                {priceHidden ? "***" : totals.amount.toFixed(2)}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 打开单据(对照老系统 SemiReceiptOrderPicker:关键字搜 单号/订单单号/供应商,双击行打开) */}
      <OpenDocDialog
        title="打开半成品入仓单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 订单单号 / 供应商"
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        loading={listQuery.isLoading}
        onPick={(r) => {
          if (!r.单号) return;
          setDialogOpen(false);
          void openDocument(r.单号);
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
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        onPick={(s) => setFormState((f) => ({ ...f, 供应商编号: s.供应商编号 ?? "", 供应商名称: s.供应商名称 ?? "" }))}
      />
      <SemiProductPickerDialog
        open={productOpen}
        permMenu={MENU}
        loadProducts={(q) => semiReceiptApi.products(q)}
        onPick={pickProducts}
        onClose={() => setProductOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除当前单据？"
        description={单号 ? `半成品入仓单 ${单号} 删除后不可恢复` : undefined}
        confirmLabel="删除"
        onConfirm={() => {
          setDeleteOpen(false);
          void remove();
        }}
      />
      <ConfirmDialog
        open={kitConfirm !== null}
        onClose={() => setKitConfirm(null)}
        title="半成品组成物料未齐，仍要保存吗？"
        description={
          kitConfirm
            ? kitConfirm.lacking
                .map(
                  (x) =>
                    `${x.label} 欠缺:${x.lacks.map((g) => `${g.物料编号} ${g.物料名称 ?? ""} 还差 ${g.还差}`).join(";")}`,
                )
                .join("\n")
            : undefined
        }
        confirmLabel="仍要保存"
        onConfirm={() => {
          const p = kitConfirm;
          setKitConfirm(null);
          if (p) void doSave(p.body);
        }}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
