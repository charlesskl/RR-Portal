// 委托加工单(原「装配加工采购单」,发外加工;数据表/路由沿用旧名)。
// 新流程:无产品明细——生产明细行直接「选物料/半成品」(物料资料+塑胶物料资料双源多选入行,货号/名称可改),
// 或放大镜绑定生产通知单(未审核也可绑);明细表(原辅料表)纯手工维护,保存为物料明细快照。
// 权限:页面门 = 款号资料·打开(老系统 MENU 常量);单据操作位 = 委托加工单(后端 MenuCatalog)。
// 展示件在 AssemblyPurchaseHeader.tsx;明细网格在 AssemblyPurchaseTables.tsx。
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Printer,
  Prohibit,
  Trash,
} from "@phosphor-icons/react";
import {
  assemblyPurchaseOrderApi,
  assemblyPurchaseQueryApi,
  customersApi,
  factoriesApi,
  processingPriceApi,
  productionReportApi,
  semiSetupApi,
  stylesApi,
  suppliersApi,
} from "@/api/endpoints";
import type {
  AssemblyPurchaseOrderHeader,
  AssemblyPurchaseOrderHeaderRow,
  AssemblyPurchaseOrderSave,
  FactoryRow,
  MasterRow,
  ProductionTrackingRow,
  SemiSetupDef,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { printAssemblyContract } from "@/lib/printAssemblyContract";
import {
  adjacentDocNo,
  accessoryLineToEdit,
  collectMaterialLines,
  collectProductionLines,
  emptyHeader,
  productionLineToEdit,
  totalQtyOf,
  type AccessoryEditLine,
  type HeaderFormState,
  type ProductionEditLine,
} from "@/lib/assemblyPurchase";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { usePerms } from "@/hooks/usePerms";
import {
  AccessoriesEditor,
  AccessoriesView,
  gridInputCls,
  ProductionEditor,
  ProductionView,
} from "@/pages/AssemblyPurchaseTables";
import { HeaderForm, inputCls, StatusPill } from "@/pages/AssemblyPurchaseHeader";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { MaterialMasterPickDialog } from "@/components/doc/MaterialMasterPickDialog";
import { useFirstDoc } from "@/hooks/useFirstDoc";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

// 权限菜单名:页面门 = 款号资料(与后端 StyleController/master 一致);单据操作 = 委托加工单
const MENU = "款号资料";
const DOC_MENU = "委托加工单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const date10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

let rowSeq = 1;
const nextKey = () => rowSeq++;

const blankProduction = (): ProductionEditLine[] =>
  Array.from({ length: 12 }, () => ({ key: nextKey() }));
const blankAccessories = (): AccessoryEditLine[] =>
  Array.from({ length: 10 }, (_, i) => ({ key: nextKey(), 序号: i + 1 }));

// 打开单据弹窗列(列宽按百分比,合计 100)
const openCol = createColumnHelper<AssemblyPurchaseOrderHeaderRow>();

// ---------- 页面 ----------

export default function AssemblyPurchasePage() {
  const qc = useQueryClient();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const currentUser = getUser() || "用户";

  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(() => emptyHeader(today()));
  const [productionLines, setProductionLines] = useState<ProductionEditLine[]>(blankProduction);
  const [accessoryLines, setAccessoryLines] = useState<AccessoryEditLine[]>(blankAccessories);
  // 明细页签(BOM物料设置同款):生产明细(半成品)/明细表(物料),两个一起下在同一张委托加工单
  const [detailTab, setDetailTab] = useState<"prodn" | "acc">("prodn");
  const [saving, setSaving] = useState(false);

  // 弹窗开关
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerTab, setPartnerTab] = useState<"supplier" | "factory">("supplier");
  const [partnerKw, setPartnerKw] = useState("");
  // 新建/行头「绑生产单」时弹「选择生产通知单」:选中带出 客户/关联MA/单号记忆,选料入行自动沿用
  const [pickForNew, setPickForNew] = useState(false);
  const [prodKw, setProdKw] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 关联MA + 选半成品/选物料(BOM 实单版同款行头):选半成品勾 MA 的半成品定义入行,选物料按 MA 前缀勾包材/塑胶件
  const [maNo, setMaNo] = useState("");
  const [semiDefs, setSemiDefs] = useState<SemiSetupDef[]>([]);
  const [maPickOpen, setMaPickOpen] = useState(false);
  const [maPickKeys, setMaPickKeys] = useState<string[]>([]);
  // 选物料弹窗(多选;prodn=入生产明细,acc=入明细表)
  const [matPickFor, setMatPickFor] = useState<"prodn" | "acc" | null>(null);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 首次进入自动打开最新一单(查看态)。渲染期按引用比对调整(规避 effect 内同步 setState)
  const firstQuery = useQuery({
    queryKey: ["asm-po", "first"],
    queryFn: () => assemblyPurchaseOrderApi.list(1, 1),
    enabled: !permsLoading && canOpen,
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  // 打开单据:优先读已落库的委托加工单(辅料表=快照);取不到再按旧的实时展开逻辑打开(虚拟单)
  const detailQuery = useQuery({
    queryKey: ["asm-po", "detail", 单号],
    queryFn: async () => {
      try {
        return { doc: await assemblyPurchaseOrderApi.get(单号!), persisted: true };
      } catch {
        return { doc: await assemblyPurchaseQueryApi.get(单号!), persisted: false };
      }
    },
    enabled: mode === "view" && !!单号 && canOpen,
  });

  const listQuery = useQuery({
    queryKey: ["asm-po", "list", page, keyword],
    queryFn: () => assemblyPurchaseOrderApi.list(page, 10, keyword),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  // 单头客户 datalist 数据源
  const customersQuery = useQuery({
    queryKey: ["asm-po", "customers"],
    queryFn: () => customersApi.list(1, 500, ""),
    enabled: !permsLoading && canOpen,
  });
  const customers = useMemo(() => customersQuery.data?.items ?? [], [customersQuery.data]);

  // 关联MA 下拉数据源:只列 -MA 结尾且已建 BOM 的货号(BOM 实单版同口径)
  const bomHeadersQuery = useQuery({
    queryKey: ["asm-po", "bom-headers"],
    queryFn: () => stylesApi.bomHeaders(),
    enabled: !permsLoading && canOpen,
  });
  const bomHeaders = useMemo(() => bomHeadersQuery.data ?? [], [bomHeadersQuery.data]);
  const maOptions = useMemo(
    () =>
      bomHeaders
        .map((b) => (b.款号 ?? "").trim())
        .filter((no) => /-ma$/i.test(no)),
    [bomHeaders],
  );

  // 选中关联 MA 后拉取其半成品定义(供「选半成品」勾选)
  useEffect(() => {
    if (!maNo) {
      setSemiDefs([]);
      return;
    }
    let dead = false;
    void (async () => {
      try {
        const defs = await semiSetupApi.list(maNo);
        if (!dead) setSemiDefs(defs);
      } catch (e) {
        if (!dead) setToast({ text: errMsg(e) || "加载关联 MA 半成品定义失败", tone: "err" });
      }
    })();
    return () => {
      dead = true;
    };
  }, [maNo]);

  // 供应商/加工厂选择(单头供应商可为二者之一)
  const partnersQuery = useQuery({
    queryKey: ["asm-po", "partners", partnerTab, partnerKw],
    queryFn: async () => {
      const r =
        partnerTab === "factory"
          ? await factoriesApi.list(1, 300, partnerKw)
          : await suppliersApi.list(1, 300, partnerKw);
      return r.items.map((x) => ({
        编号: (x as FactoryRow).加工厂编号 ?? (x as { 供应商编号?: string }).供应商编号 ?? "",
        名称: (x as FactoryRow).加工厂名称 ?? (x as { 供应商名称?: string }).供应商名称 ?? "",
      }));
    },
    placeholderData: keepPreviousData,
    enabled: partnerOpen,
  });

  // 生产通知单选择器:列全部,未审核也可绑定(生产通知单即生产制单表;复用生产单跟踪表端点)
  const prodQuery = useQuery({
    queryKey: ["asm-po", "productions", prodKw],
    queryFn: () => productionReportApi.tracking(prodKw || undefined),
    placeholderData: keepPreviousData,
    enabled: pickForNew,
  });

  const detailWrap = detailQuery.data;
  const detail = detailWrap?.doc;
  // 虚拟单(实时展开,未落库)保存时走新建;删除/审核/前后单仅落库单可用
  const persisted = detailWrap?.persisted ?? true;
  const docNo = mode === "view" && !!单号 && persisted ? 单号 : null;
  const header: AssemblyPurchaseOrderHeader | null =
    mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const isAudited = header?.审核 === "1";
  // 编辑态 = 新建 或 未审核的查看单(回填后可改);已审核 = 只读查看态
  const editing = mode === "new" || (isView && !isAudited);
  const openColumns = useMemo<ColumnDef<AssemblyPurchaseOrderHeaderRow, any>[]>(
    () => [
      openCol.accessor("日期", {
        header: "开单日期",
        size: 12,
        cell: (c) => fmtDate(c.getValue()),
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      openCol.accessor("单号", {
        header: "单号",
        size: 18,
        cell: (c) => txt(c.getValue()),
        meta: {
          tdClass: "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]",
        },
      }),
      openCol.accessor("供应商名称", {
        header: "供应商名称",
        size: 20,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      openCol.accessor("客户名称", {
        header: "客户名称",
        size: 16,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      openCol.accessor("收货仓库", {
        header: "收货仓库",
        size: 10,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      openCol.accessor("数量", {
        header: "数量",
        size: 8,
        cell: (c) => fmtNum(c.getValue(), 0),
        meta: {
          align: "right",
          tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]",
        },
      }),
      openCol.accessor("金额", {
        header: "金额",
        size: 9,
        cell: (c) => fmtNum(c.getValue(), 2),
        meta: {
          align: "right",
          tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#1a2330]",
        },
      }),
      openCol.display({
        id: "状态",
        header: "状态",
        size: 7,
        cell: (c) => <StatusPill h={c.row.original} />,
        meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
      }),
    ],
    [],
  );

  const totalQty = totalQtyOf(productionLines);

  // lastProd:最近绑定过的生产通知单(新建选单/行头「绑生产单」/打开旧单水合都会写入)——
  // 之后选半成品/物料入行自动沿用 单号/接单日期,半成品 加工数量=订单数量×用量
  const [lastProd, setLastProd] = useState<{
    生产单号?: string;
    接单日期: string;
    计划数量?: number;
  } | null>(null);

  // 查看态:把后端单据水合到表单/两个明细(渲染期按引用比对,新数据到达时执行一次);
  // 已审核单也水合——单头卡=同一张表单的 readOnly 态(BOM 同款),数据得在
  const [hydrated, setHydrated] = useState<typeof detailWrap>(undefined);
  if (mode === "view" && detail && detailWrap !== hydrated) {
    setHydrated(detailWrap);
    const h = detail.单头;
    setFormState({
      供应商编号: h?.供应商编号 ?? "",
      供应商名称: h?.供应商名称 ?? "",
      // 单头客户为 "编号，名称" 合串;客户编号不拆回下拉(照抄老系统 openGeneratedDoc)
      客户编号: "",
      客户名称: h?.客户 ?? "",
      出单日期: date10(h?.出单日期) || today(),
      收货仓库: h?.收货仓库 ?? "半成品仓",
      电脑单号: h?.电脑单号 ?? h?.单号 ?? "",
      备注: h?.备注 ?? "",
      开始交货日期: date10(h?.开始交货日期) || today(),
      每天交货: h?.每天交货 != null ? String(h.每天交货) : "",
      完成日期: date10(h?.完成日期) || today(),
      收货人: h?.收货人 ?? "",
    });
    const prods = detail.生产明细.map((r) => productionLineToEdit(r, nextKey()));
    setProductionLines([
      ...prods,
      ...blankProduction().slice(0, Math.max(0, 8 - prods.length)),
    ]);
    setAccessoryLines(detail.辅料表.map((r) => accessoryLineToEdit(r, nextKey())));
    // 旧单:lastProd 从首个已绑行带出(选料入行沿用单号/徽标显示;订单数量无源,半成品数量手补)
    const firstBound = prods.find((r) => (r.生产单号 ?? "").trim());
    setLastProd(
      firstBound
        ? { 生产单号: firstBound.生产单号, 接单日期: firstBound.接单日期 ?? "" }
        : null,
    );
  }

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));

  const patchProduction = (key: number, patch: Partial<ProductionEditLine>) => {
    setProductionLines((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        const n = { ...r, ...patch };
        n.金额 = Number(n.加工数量 ?? 0) * Number(n.单价 ?? 0);
        return n;
      }),
    );
  };

  // ---------- 行操作(BOM 物料明细同款:插入/删/添加行) ----------
  const insertRowAt = <T extends { key: number }>(rows: T[], idx: number, blank: T): T[] => [
    ...rows.slice(0, idx + 1),
    blank,
    ...rows.slice(idx + 1),
  ];
  const insertProductionRow = (idx: number) =>
    setProductionLines((rows) => insertRowAt(rows, idx, { key: nextKey() }));
  const removeProductionRow = (key: number) =>
    setProductionLines((rows) => rows.filter((r) => r.key !== key));
  const addProductionRow = () => setProductionLines((rows) => [...rows, { key: nextKey() }]);

  // 辅料行 序号保持=行序(aria 标签/展示都按它)
  const renumberAcc = (rows: AccessoryEditLine[]) => rows.map((r, i) => ({ ...r, 序号: i + 1 }));
  const insertAccRow = (idx: number) =>
    setAccessoryLines((rows) => renumberAcc(insertRowAt(rows, idx, { key: nextKey(), 序号: 0 })));
  const removeAccRow = (key: number) =>
    setAccessoryLines((rows) => renumberAcc(rows.filter((r) => r.key !== key)));
  const addAccRow = () =>
    setAccessoryLines((rows) => renumberAcc([...rows, { key: nextKey(), 序号: 0 }]));

  // ---------- 新建 ----------
  const reset = () => {
    setMode("new");
    set单号(null);
    setHydrated(undefined);
    setFormState(emptyHeader(today()));
    setProductionLines(blankProduction());
    setAccessoryLines(blankAccessories());
    setMaNo("");
    setSemiDefs([]);
    setLastProd(null);
    setPickForNew(false);
  };

  // 单头客户变更(只写单头;行级客户已随产品明细移除,保存时行级为空后端回落单头)
  const onHeaderCustomer = (v: string) => {
    if (v !== "" && !customers.some((c) => c.客户编号 === v)) {
      setForm({ 客户编号: v });
      return;
    }
    const picked = customers.find((c) => c.客户编号 === v);
    setForm({ 客户编号: v, 客户名称: picked?.客户名称 ?? "" });
  };

  // 生产通知单选择(新建自动弹 / 行头「绑生产单」):带出 客户/关联MA/单号记忆(lastProd,含 订单数量
  // 供半成品数量自动算);之后选半成品/物料入行自动沿用该单号,半成品 加工数量=订单数量×用量
  const onProductionPick = (row: ProductionTrackingRow) => {
    if (!pickForNew) return;
    const 接单日期 = date10(row.日期 ?? row.交货日期);
    setLastProd({
      生产单号: row.生产单号,
      接单日期,
      计划数量: Number(row.计划数量 ?? row.未完成数 ?? 0) || undefined,
    });
    setForm({
      客户编号: (row.客户编号 ?? "").trim(),
      客户名称: (row.客户名称 ?? "").trim(),
    });
    const 款号 = (row.款号 ?? "").trim();
    if (款号 && maOptions.includes(款号)) setMaNo(款号);
    // 已有内容但未绑单的行:补挂该单号/接单日期(货号/数量不动)
    setProductionLines((rows) =>
      rows.map((r) =>
        (r.产品货号 ?? "").trim() && !(r.生产单号 ?? "").trim()
          ? { ...r, 生产单号: row.生产单号, 接单日期 }
          : r,
      ),
    );
    setPickForNew(false);
    setToast({
      text: `已绑定 ${row.生产单号}:客户/关联MA已带出,可直接选半成品/物料(自动沿用该单号)`,
      tone: "ok",
    });
  };

  // 单价记忆:按货号批量取最近单价(保存单据时后端按货号自动记录);取价失败不挡流程,手补
  const fetchPriceMemory = async (货号s: string[]): Promise<Map<string, number>> => {
    try {
      const { prices } = await processingPriceApi.get(货号s.filter(Boolean));
      return new Map(Object.entries(prices ?? {}));
    } catch {
      return new Map();
    }
  };

  // 勾入行进生产明细:优先填空行(无 生产单号/产品货号),不够再追加;单价取单价记忆;
  // 绑过生产通知单后新行自动沿用其 生产单号/接单日期;半成品行带算好的 加工数量
  const fillLines = (
    lines: { 产品货号: string; 产品名称: string; 加工数量?: number }[],
    prices: Map<string, number> = new Map(),
  ) => {
    setProductionLines((rows) => {
      const next = [...rows];
      let from = 0;
      for (const l of lines) {
        const price = prices.get(l.产品货号);
        const line = {
          ...l,
          生产单号: lastProd?.生产单号,
          接单日期: lastProd?.接单日期,
          单价: price,
          金额: (l.加工数量 ?? 0) * (price ?? 0),
        };
        const bi = next.findIndex((r, i) => i >= from && !r.生产单号 && !r.产品货号);
        if (bi >= 0) {
          next[bi] = { ...next[bi], ...line };
          from = bi + 1;
        } else {
          next.push({ key: nextKey(), ...line });
        }
      }
      return next;
    });
  };
  const existing货号 = () =>
    new Set(productionLines.map((r) => (r.产品货号 ?? "").trim()).filter(Boolean));

  // 当前绑定的生产单号:lastProd 优先,回落明细行里已有的(打开旧单时徽标也能显示)
  const boundMo =
    lastProd?.生产单号 ?? productionLines.find((r) => (r.生产单号 ?? "").trim())?.生产单号;

  // 选物料入行:货号=物料编号,名称=物料名称;已在明细的编号跳过;单价按记忆带出
  const pickMaterials = async (picked: MasterRow[]) => {
    const existing = existing货号();
    const fresh = picked.filter((m) => !existing.has(String(m.物料编号 ?? "").trim()));
    if (fresh.length === 0) {
      setToast({ text: "勾选的物料已在生产明细中", tone: "err" });
      return;
    }
    const prices = await fetchPriceMemory(fresh.map((m) => String(m.物料编号 ?? "").trim()));
    fillLines(
      fresh.map((m) => ({
        产品货号: String(m.物料编号 ?? ""),
        产品名称: String(m.物料名称 ?? ""),
      })),
      prices,
    );
    setToast({ text: `已加入 ${fresh.length} 行物料,请补加工数量`, tone: "ok" });
  };

  // 选物料入行(明细表):编号/名称带入,需求数手补;已在明细表的编号跳过(填空行优先)
  const pickAccessories = (picked: MasterRow[]) => {
    const existing = new Set(
      accessoryLines.map((r) => (r.辅料编号 ?? "").trim()).filter(Boolean),
    );
    const fresh = picked.filter((m) => !existing.has(String(m.物料编号 ?? "").trim()));
    if (fresh.length === 0) {
      setToast({ text: "勾选的物料已在明细表中", tone: "err" });
      return;
    }
    setAccessoryLines((rows) => {
      const next = [...rows];
      let from = 0;
      for (const m of fresh) {
        const line = {
          辅料编号: String(m.物料编号 ?? ""),
          辅料名称: String(m.物料名称 ?? ""),
        };
        const bi = next.findIndex((r, i) => i >= from && !r.辅料编号);
        if (bi >= 0) {
          next[bi] = { ...next[bi], ...line };
          from = bi + 1;
        } else {
          next.push({ key: nextKey(), 序号: 0, ...line });
        }
      }
      return renumberAcc(next);
    });
    setToast({ text: `已加入 ${fresh.length} 行物料,请补需求数`, tone: "ok" });
  };

  // 选半成品入行:货号/名称=半成品定义名称(BOM appendSemiRow 同口径);已在明细则跳过;单价按记忆带出;
  // 加工数量=绑定生产单的订单数量×半成品用量(未绑单/无用量则留空手补)
  const confirmSemiPick = async () => {
    const picked = semiDefs.filter((d) => d.类型 === "半成品" && maPickKeys.includes(d.名称));
    const existing = existing货号();
    const fresh = picked.filter((d) => !existing.has(d.名称.trim()));
    if (fresh.length === 0) {
      setToast({ text: "勾选的半成品已在生产明细中", tone: "err" });
    } else {
      const prices = await fetchPriceMemory(fresh.map((d) => d.名称.trim()));
      fillLines(
        fresh.map((d) => {
          const 用量 = Number(d.用量 ?? 0);
          const 加工数量 =
            lastProd?.计划数量 != null && 用量 > 0
              ? Math.round(lastProd.计划数量 * 用量)
              : undefined;
          return { 产品货号: d.名称, 产品名称: d.名称, 加工数量 };
        }),
        prices,
      );
      setToast({
        text:
          lastProd?.计划数量 != null
            ? `已加入 ${fresh.length} 行半成品(加工数量=订单数量${lastProd.计划数量}×用量)`
            : `已加入 ${fresh.length} 行半成品,请补加工数量`,
        tone: "ok",
      });
    }
    setMaPickOpen(false);
    setMaPickKeys([]);
  };

  // ---------- 保存 ----------
  const collectPayload = (): AssemblyPurchaseOrderSave => ({
    供应商编号: form.供应商编号.trim() || undefined,
    供应商名称: form.供应商名称.trim() || undefined,
    客户编号: form.客户编号.trim() || undefined,
    客户名称: form.客户名称.trim() || undefined,
    出单日期: form.出单日期 || undefined,
    收货仓库: form.收货仓库 || undefined,
    电脑单号: form.电脑单号.trim() || undefined,
    开始交货日期: form.开始交货日期 || undefined,
    每天交货: form.每天交货.trim() ? Number(form.每天交货) : undefined,
    完成日期: form.完成日期 || undefined,
    收货人: form.收货人.trim() || undefined,
    备注: form.备注.trim() || undefined,
    生产明细: collectProductionLines(productionLines),
    物料明细: collectMaterialLines(accessoryLines),
  });

  const save = async () => {
    const payload = collectPayload();
    if (payload.生产明细.length === 0 && payload.物料明细.length === 0) {
      setToast({ text: "请先在明细中加入物料/半成品，再保存", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      if (docNo) {
        await assemblyPurchaseOrderApi.update(docNo, payload);
        setToast({ text: `委托加工单 ${docNo} 已保存`, tone: "ok" });
        await detailQuery.refetch();
      } else {
        const { 单号: created } = await assemblyPurchaseOrderApi.create(payload);
        setToast({ text: `已保存，单号 ${created}`, tone: "ok" });
        setMode("view");
        set单号(created);
        void qc.invalidateQueries({ queryKey: ["asm-po", "first"] });
        void qc.invalidateQueries({ queryKey: ["asm-po", "list"] });
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存委托加工单失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // ---------- 审核 / 反审核 / 删除 ----------
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      await fn();
      setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        void qc.invalidateQueries({ queryKey: ["asm-po", "first"] });
        void qc.invalidateQueries({ queryKey: ["asm-po", "list"] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // 前单/后单:按单号升序定位相邻单(口径见 lib/assemblyPurchase adjacentDocNo)
  const move = async (next: boolean) => {
    if (!docNo) return;
    setSaving(true);
    try {
      const result = await assemblyPurchaseOrderApi.list(1, 1000, "");
      const target = adjacentDocNo(
        result.items.map((row) => row.单号),
        docNo,
        next,
      );
      if (!target) {
        setToast({ text: next ? "已经是最后一张单据" : "已经是第一张单据", tone: "ok" });
      } else {
        set单号(target);
        void qc.invalidateQueries({ queryKey: ["asm-po", "detail", target] });
      }
    } catch (e) {
      setToast({ text: errMsg(e) || "切换单据失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const fillLastNo = async () => {
    try {
      const result = await assemblyPurchaseOrderApi.list(1, 1, "");
      setForm({ 电脑单号: result.items[0]?.单号 ?? "" });
    } catch (e) {
      setToast({ text: errMsg(e) || "读取最后号码失败", tone: "err" });
    }
  };

  // ---------- 打印:取最新单详情按「委托加工合同」格式开新窗口打印(模式A) ----------
  const doPrint = async () => {
    if (!单号) {
      setToast({ text: "请先保存或打开一张委托加工单再打印", tone: "err" });
      return;
    }
    try {
      const doc = await assemblyPurchaseOrderApi.get(单号);
      printAssemblyContract(doc);
    } catch (e) {
      setToast({ text: errMsg(e) || "打印失败", tone: "err" });
    }
  };

  // URL 参数:?单号= 直开指定单(外部入口),消费后清掉(keep-alive 下再次带参导航仍可生效)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const no = searchParams.get("单号");
    if (!no) return;
    setSearchParams({}, { replace: true });
    setMode("view");
    set单号(no);
    void qc.invalidateQueries({ queryKey: ["asm-po", "detail", no] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  if (!canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问委托加工单"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  // ---------- 工具条 ----------
  const editActions: DocAction[] = [
    {
      key: "new",
      label: "新建",
      icon: FilePlus,
      perm: "保存",
      success: true,
      // 新建后自动弹「选择生产通知单」:选中带出 客户/关联MA/首行;不选点 X 走空白单
      onClick: () => {
        reset();
        setPickForNew(true);
      },
    },
    {
      key: "open",
      label: "打开",
      icon: FolderOpen,
      primary: true,
      onClick: () => setDialogOpen(true),
    },
    ...(editing
      ? [
          {
            key: "save",
            label: mode === "new" ? "保存" : "保存修改",
            icon: FloppyDisk,
            perm: "保存" as const,
            primary: true,
            disabled: saving,
            onClick: () => void save(),
          },
        ]
      : []),
    ...(isView && !isAudited && docNo
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
  const navActions: DocAction[] = [
    {
      key: "prev",
      label: "前单",
      icon: CaretLeft,
      disabled: !docNo || saving,
      disabledTitle: !docNo ? "先打开单据" : undefined,
      onClick: () => void move(false),
    },
    {
      key: "next",
      label: "后单",
      icon: CaretRight,
      disabled: !docNo || saving,
      disabledTitle: !docNo ? "先打开单据" : undefined,
      onClick: () => void move(true),
    },
  ];
  const auditActions: DocAction[] = [
    ...(isView && !isAudited && docNo && header?.主管审核 !== "1"
      ? [
          {
            key: "sup",
            label: "主管审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(() => assemblyPurchaseOrderApi.supervisorApprove(docNo), "主管已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && docNo && header?.主管审核 === "1" && header?.经理审核 !== "1"
      ? [
          {
            key: "mgr",
            label: "经理审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(() => assemblyPurchaseOrderApi.managerApprove(docNo), "经理已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && docNo && header?.经理审核 === "1"
      ? [
          {
            key: "audit",
            label: "审核(下发)",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => assemblyPurchaseOrderApi.approve(docNo), "已审核", "reload"),
          },
        ]
      : []),
    ...(isView && isAudited && docNo
      ? [
          {
            key: "unaudit",
            label: "反审核",
            icon: ArrowCounterClockwise,
            perm: "反审核" as const,
            danger: true,
            onClick: () =>
              void act(() => assemblyPurchaseOrderApi.unapprove(docNo), "已反审核", "reload"),
          },
        ]
      : []),
  ];
  const printActions: DocAction[] = docNo
    ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: () => void doPrint() }]
    : [];

  // ---------- 只读态网格行(已审核):从详情映射 ----------
  const viewProduction = (detail?.生产明细 ?? []).map((r) => productionLineToEdit(r, nextKey()));
  const viewAccessories = (detail?.辅料表 ?? []).map((r) => accessoryLineToEdit(r, nextKey()));

  // 明细页签条(BOM物料设置「物料明细/尺寸图片备注」同款样式)
  const detailTabs = (
    <div className="flex gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1 sm:w-fit">
      {(
        [
          ["prodn", "生产明细"],
          ["acc", "明细表"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => setDetailTab(v)}
          className={cn(
            "h-9 rounded-lg px-4 text-sm transition-colors",
            detailTab === v
              ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
              : "text-[#5f6b7d] hover:text-[#3d4a5c]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      {/* 页头:标题 + 审核徽标(BOM 同款),操作栏整体右置 */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          委托加工单{isView ? ` · ${header?.单号}` : mode === "new" ? "(新建)" : ""}
        </h1>
        {isAudited && (
          <span className="rounded-full bg-[#059669]/10 px-3 py-1 text-sm font-medium text-[#059669]">
            已审核
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <DocToolbar actions={editActions} menuKey={DOC_MENU} />
          <DocToolbar actions={navActions} menuKey={DOC_MENU} />
          <DocToolbar actions={auditActions} menuKey={DOC_MENU} />
          <DocToolbar actions={printActions} menuKey={DOC_MENU} />
        </div>
      </div>

      {/* 单头:新建/未审核 = 可编辑表单;已审核 = 同一张表单的只读态(BOM 同款) */}
      {mode === "new" ? (
        <HeaderForm
          form={form}
          setForm={setForm}
          单号={null}
          操作员={currentUser}
          customers={customers}
          onCustomer={onHeaderCustomer}
          onPickPartner={() => setPartnerOpen(true)}
          onFillLastNo={() => void fillLastNo()}
        />
      ) : detailQuery.isLoading ? (
        <div className="f-panel p-6">
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-black/5" />
            ))}
          </div>
        </div>
      ) : detailQuery.isError ? (
        <div className="f-panel p-6">
          <DocError message="单据加载失败,请重试或重新打开" onRetry={() => detailQuery.refetch()} />
        </div>
      ) : !header ? (
        <div className="f-panel p-6">
          <DocEmpty
            icon={<FolderOpen className="h-5 w-5" />}
            title="尚未打开单据"
            description="点击上方「打开」选择一张委托加工单,或点「新建」开一张新单"
            action={
              <button
                type="button"
                className="f-btn f-btn-cyan px-5"
                onClick={() => setDialogOpen(true)}
              >
                <FolderOpen className="h-5 w-5" />
                打开单据
              </button>
            }
          />
        </div>
      ) : (
        <HeaderForm
          form={form}
          setForm={setForm}
          单号={单号}
          操作员={txt(header.操作员)}
          customers={customers}
          onCustomer={onHeaderCustomer}
          onPickPartner={() => setPartnerOpen(true)}
          onFillLastNo={() => void fillLastNo()}
          readOnly={isAudited}
          audit={header}
        />
      )}

      {/* 明细:页签切换 生产明细/辅料表(BOM物料设置同款) */}
      {editing ? (
        <>
          {detailTabs}
          {detailTab === "prodn" && (
            <ProductionEditor
              actions={
                <>
                  <button
                    type="button"
                    className="f-btn h-9 px-4 text-sm"
                    title="绑定生产通知单:带出客户/关联MA;选料入行自动沿用单号,半成品 加工数量=订单数量×用量"
                    onClick={() => setPickForNew(true)}
                  >
                    绑生产单
                  </button>
                  {boundMo && (
                    <span
                      className="rounded-full border border-[#16a34a]/40 bg-[#16a34a]/8 px-2.5 py-1 text-xs font-semibold text-[#15803d]"
                      title="当前绑定;选半成品/物料入行自动沿用该单号"
                    >
                      {boundMo}
                    </span>
                  )}
                  <span className="f-label">关联MA</span>
                  <SearchSelect
                    ariaLabel="关联MA"
                    className="w-72"
                    value={maNo}
                    options={maOptions.map((no) => ({
                      value: no,
                      label: [
                        no,
                        bomHeaders.find((b) => (b.款号 ?? "").trim() === no)?.款式 ?? "",
                      ]
                        .filter(Boolean)
                        .join(" "),
                    }))}
                    placeholder="选择关联的 MA 货号(-MA 结尾且已建 BOM)"
                    clearLabel="选择关联的 MA 货号(-MA 结尾且已建 BOM)"
                    onChange={setMaNo}
                  />
                  <button
                    type="button"
                    className="f-btn h-9 px-4 text-sm"
                    disabled={!maNo}
                    onClick={() => {
                      setMaPickKeys([]);
                      setMaPickOpen(true);
                    }}
                  >
                    选半成品
                  </button>
                  <button
                    type="button"
                    className="f-btn h-9 px-4 text-sm"
                    onClick={() => setMatPickFor("prodn")}
                  >
                    选物料
                  </button>
                </>
              }
              hint="「绑生产单」绑一次,之后选半成品/物料入行自动沿用;半成品 加工数量=订单数量×用量;货号/名称/数量/单价均可改"
              rows={productionLines}
              onPatch={patchProduction}
              onRemove={removeProductionRow}
              onInsert={insertProductionRow}
              onAdd={addProductionRow}
            />
          )}
          {detailTab === "acc" && (
            <AccessoriesEditor
              actions={
                <button
                  type="button"
                  className="f-btn h-9 px-4 text-sm"
                  onClick={() => setMatPickFor("acc")}
                >
                  选物料
                </button>
              }
              hint="和生产明细的半成品一起下在当前委托加工单"
              rows={accessoryLines}
              onPatch={(key, patch) =>
                setAccessoryLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
              }
              onInsert={insertAccRow}
              onRemove={removeAccRow}
              onAdd={addAccRow}
            />
          )}
          <div className="flex items-center gap-8 px-1">
            <span className="text-lg font-bold text-[#15803d]">数 量：</span>
            <span className="f-mono text-lg font-bold text-info-foreground">
              {totalQty.toLocaleString()}
            </span>
          </div>
        </>
      ) : (
        header &&
        !detailQuery.isLoading &&
        !detailQuery.isError && (
          <>
            {detailTabs}
            {detailTab === "prodn" && <ProductionView rows={viewProduction} />}
            {detailTab === "acc" &&
              (viewAccessories.length === 0 ? (
                <div className="f-panel p-4">
                  <DocEmpty
                    icon={<Prohibit className="h-5 w-5" />}
                    title="暂无明细"
                    description="该单据还没有物料明细快照行"
                  />
                </div>
              ) : (
                <AccessoriesView rows={viewAccessories} />
              ))}
          </>
        )
      )}

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开委托加工单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号 / 供应商 / 客户"
        onPick={(h) => {
          if (h.单号) {
            setMode("view");
            set单号(h.单号);
          }
          setDialogOpen(false);
        }}
        footer={
          <>
            <span className="f-mono">
              共 {listQuery.data?.total ?? 0} 单,第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="f-btn h-10 px-3.5 text-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <CaretLeft className="h-4 w-4" />
                上一页
              </button>
              <button
                type="button"
                className="f-btn h-10 px-3.5 text-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
                <CaretRight className="h-4 w-4" />
              </button>
            </div>
          </>
        }
        description="按单号、供应商或客户搜索,点击一行打开"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="没有匹配的委托加工单,换个关键字试试"
      />

      {/* 选择供应商/加工厂 */}
      <PickerDialog
        open={partnerOpen}
        onClose={() => setPartnerOpen(false)}
        title="选择供应商/加工厂"
        width="sm:max-w-[620px]"
      >
        <div className="mb-3 flex gap-2">
          <SearchSelect
            ariaLabel="合作方类型"
            className={cn(gridInputCls, "h-10 w-32 rounded-md border")}
            value={partnerTab}
            options={[
              { value: "supplier", label: "供应商" },
              { value: "factory", label: "加工厂" },
            ]}
            onChange={(v) => setPartnerTab(v as "supplier" | "factory")}
          />
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPartnerKw(
                (e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim(),
              );
            }}
          >
            <Input name="kw" className={inputCls} placeholder="编号/名称" aria-label="合作方搜索" />
            <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
              查询
            </button>
          </form>
        </div>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              <th className={pickerThCls}>
                {partnerTab === "factory" ? "加工厂编号" : "供应商编号"}
              </th>
              <th className={pickerThCls}>
                {partnerTab === "factory" ? "加工厂名称" : "供应商名称"}
              </th>
            </tr>
          </thead>
          <tbody>
            {(partnersQuery.data ?? []).map((p, i) => (
              <tr
                key={p.编号 || i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => {
                  setForm({ 供应商编号: p.编号, 供应商名称: p.名称 });
                  setPartnerOpen(false);
                }}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{p.编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{p.名称}</td>
              </tr>
            ))}
            {partnersQuery.isSuccess && (partnersQuery.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-sm text-disabled">
                  {partnerTab === "factory" ? "没有匹配的加工厂" : "没有匹配的供应商"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 选择生产通知单(全部状态,未审核也可绑定;新建自动弹出 / 行头「绑生产单」) */}
      <PickerDialog
        open={pickForNew}
        onClose={() => setPickForNew(false)}
        title="选择生产通知单(带出客户/关联MA)"
        width="sm:max-w-[960px]"
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setProdKw((e.currentTarget.elements.namedItem("kw") as HTMLInputElement).value.trim());
          }}
        >
          <Input
            name="kw"
            className={inputCls}
            placeholder="生产单号/款号/款式/客户"
            aria-label="生产通知单搜索"
          />
          <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
            查询
          </button>
        </form>
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["生产单号", "款号", "款式", "客户名称", "计划数量", "未完成", "交货日期", "状态"].map((h) => (
                <th
                  key={h}
                  className={cn(pickerThCls, (h === "计划数量" || h === "未完成") && "text-right")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(prodQuery.data ?? []).map((r, i) => (
              <tr
                key={r.生产单号 ?? i}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => onProductionPick(r)}
              >
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.生产单号}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.款号 ?? ""}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.款式 ?? ""}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.客户名称 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.计划数量 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.未完成数 ?? ""}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                  {date10(r.交货日期)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.审核 === "1" ? (
                    <span className="rounded-full bg-[#15803d]/10 px-2 py-0.5 text-xs font-medium text-[#15803d]">
                      已审核
                    </span>
                  ) : (
                    <span className="rounded-full bg-black/8 px-2 py-0.5 text-xs font-medium text-[#3d4a5c]">
                      未审核
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {prodQuery.isSuccess && (prodQuery.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的生产通知单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PickerDialog>

      {/* 选半成品:从关联 MA 勾选半成品定义(BOM 实单版同款弹窗) */}
      <PickerDialog
        open={maPickOpen}
        onClose={() => {
          setMaPickOpen(false);
          setMaPickKeys([]);
        }}
        title={`选半成品 · ${maNo}`}
        width="sm:max-w-[720px]"
        footer={
          <>
            <button
              type="button"
              className="f-btn h-10 px-4"
              onClick={() => {
                setMaPickOpen(false);
                setMaPickKeys([]);
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={!maPickKeys.length}
              onClick={confirmSemiPick}
            >
              确定
            </button>
          </>
        }
      >
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={pickerThCls} style={{ width: 40 }}></th>
                <th className={pickerThCls}>名称</th>
                <th className={pickerThCls}>物料数</th>
              </tr>
            </thead>
            <tbody>
              {semiDefs.filter((d) => d.类型 === "半成品").length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-disabled">
                    该 MA 货号尚无半成品定义
                  </td>
                </tr>
              ) : (
                semiDefs
                  .filter((d) => d.类型 === "半成品")
                  .map((d) => (
                    <tr key={d.名称} className="border-b border-black/6">
                      <td className="px-3 py-1.5">
                        <Checkbox
                          aria-label={`勾选 ${d.名称}`}
                          className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                          checked={maPickKeys.includes(d.名称)}
                          onCheckedChange={(v) =>
                            setMaPickKeys((ks) =>
                              v === true ? [...ks, d.名称] : ks.filter((k) => k !== d.名称),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-1.5">{d.名称}</td>
                      <td className="f-mono px-3 py-1.5 text-right">{d.明细.length}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </PickerDialog>

      {/* 选物料(多选入行;prodn=生产明细,acc=明细表;关联 MA 后按 MA 货号过滤:该 MA 塑胶件
          (塑胶货号精确命中) + 「92125-」前缀/共用料(名称分词命中);未关联可切双源) */}
      <MaterialMasterPickDialog
        open={matPickFor !== null}
        multi
        货号={maNo || undefined}
        含塑胶半成品
        onPickMany={(ms) => (matPickFor === "acc" ? pickAccessories(ms) : pickMaterials(ms))}
        onClose={() => setMatPickFor(null)}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="删除委托加工单"
        description={`确定删除单号 ${docNo}？删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => assemblyPurchaseOrderApi.remove(docNo!), "已删除", "reset");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
