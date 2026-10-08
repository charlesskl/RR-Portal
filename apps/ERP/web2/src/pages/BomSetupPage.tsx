// BOM物料设置(工程部;老系统 web/src/pages/styles/BomSetupPage.tsx 的 BOM 入口重写):
// 单头(客户/货号/日期/单位/默认单价/类型/备注) + 物料明细网格 + MA/实单双版本 +
// 半成品设置 + 尺寸图片备注(模块=BOM) + 导入/复制单 + BOM台头审核/反审核申请审批流。
// 实单版明细=「关联MA + 选半成品」勾选该 MA 的半成品 +「选物料」勾入该货号的物料(包材等,
// 物料资料/塑胶物料资料按货号前缀过滤,用量/备注行内可改),保存时两类行都入库。
// 排期「去建 BOM」跳入参数:?款号=&品名=&客户名称=&po=&return=;po 保存时作 待绑定PO号 随台头提交,
// 后端审核后自动绑定该 PO(前端只负责传递)。
// 装配模式(Batch 2):路由 /assembly-material-setup 复用本组件(isAssembly)。
// 2026-09-30 改版=「装配BOM」:台头=BOM 式共用字段+类别+数量(扩展段 需求用量;配件编号等老字段
// 不再渲染但随保存原样回传不丢数据),明细=「关联MA + 选半成品」勾选该 MA 的半成品
// (装配领料按 半成品设置明细 展开领组成物料),+ 调整审核(POST /styles/{款号}/audit|reverse-audit);
// 扩展/报价只在装配模式持久化,且仅当响应已带该段或用户编辑过;报价网格已下线(存量报价随保存回传保留)。
// BOM 入口永不持久化 扩展/报价。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Check,
  Copy,
  FilePlus,
  FolderOpen,
  MagnifyingGlass,
  Plus,
  Printer,
  Prohibit,
  SealCheck,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import {
  customersApi,
  masterDataApi,
  plasticMaterialMasterApi,
  schedulingApi,
  semiSetupApi,
  stylesApi,
} from "@/api/endpoints";
import type {
  BomHeaderOption,
  BomSave,
  CustomerRow,
  MasterRow,
  PlasticMaterialRow,
  ScheduleRow,
  SemiOption,
  SemiSetupDef,
  StyleListItem,
  StyleMaterial,
} from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { getUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { pickedMaDefRows } from "@/lib/maPick";
import { buildCloseTarget } from "@/lib/bomSetup";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { DocToast } from "@/components/doc/DocToast";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { ImageNotesPanel } from "@/components/doc/ImageNotesPanel";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { MaterialMasterPickDialog } from "@/components/doc/MaterialMasterPickDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { CELL_CAP_CH, colWidthCh, visualLen } from "@/lib/cellWidth";
import { CellInput } from "@/components/doc/CellInput";
import { QtyInput } from "@/components/doc/QtyInput";
import { formatQty } from "@/lib/fraction";
import { 货号前缀, matchPrefix } from "@/lib/materialMatch";
import { Checkbox } from "@/components/ui/checkbox";
import BomSetupSemiPanel from "./BomSetupSemiPanel";
import BomSetupImportDialog, { type BomImportApplyRow } from "./BomSetupImportDialog";

const MENU = "款号资料"; // MenuCatalog 实证:src/ErpApi/Features/Admin/MenuCatalog.cs 基础资料组

interface MatRow {
  key: number;
  物料编号: string;
  物料名称: string;
  工模编号: string;
  规格: string;
  材料: string;
  颜色: string;
  单位: string;
  用量?: number;
  备注: string;
}

interface HeaderState {
  客户编号: string;
  客户名称: string;
  产品货号: string;
  产品名称: string;
  日期: string;
  单位: string;
  默认单价: string;
  类型: string;
  操作员: string;
  备注: string;
  // 装配入口台头 PO号(区分同货号不同实单;保存落 款号物料总表.待绑定PO号,BOM 入口保存时原样回传)
  PO号: string;
  // 装配模式扩展段(仅 /assembly-material-setup;BOM 入口不显示不持久化)
  配件编号: string;
  共用物料编号: string;
  装配方式: string;
  产品装配名称: string;
  类别: string;
  库存单价HK?: number;
  其他成本HK?: number;
  需求用量?: number;
  半成品计算库存: boolean;
}

// 报价行(装配模式 报价 网格;持久化时映射为 AssemblyMaterialQuote)
interface QuoteRow {
  key: number;
  ID?: number;
  物料编号?: string;
  物料名称?: string;
  类型: "本厂" | "加工厂" | "供应商";
  编号: string;
  名称: string;
  报价日期: string;
  货币: string;
  单价?: number;
  港币?: number;
  对比相差?: number;
  相差比例?: number;
  默认?: boolean;
  备注?: string;
}

let quoteSeq = 1;
const qid = () => quoteSeq++;
const newQuoteRow = (patch: Partial<QuoteRow> = {}, defaultCurrency = "HK$"): QuoteRow => ({
  key: qid(),
  类型: "供应商",
  编号: "",
  名称: "",
  报价日期: today(),
  货币: defaultCurrency,
  ...patch,
});

// 单位下拉选项;旧数据若存了选项外的值(如 PCS/盒),加载时并入选项顶部原样显示
const UNIT_OPTIONS = ["个"];
const unitOptions = (current: string) =>
  current && !UNIT_OPTIONS.includes(current) ? [current, ...UNIT_OPTIONS] : UNIT_OPTIONS;

// 内容视觉宽度/列宽/单元格输入框:见 @/components/doc/CellInput(列宽封顶 CELL_CAP_CH,超长点击显示)

let rowSeq = 1;
const uid = () => rowSeq++;
const newRow = (): MatRow => ({
  key: uid(),
  物料编号: "",
  物料名称: "",
  工模编号: "",
  规格: "",
  材料: "",
  颜色: "",
  单位: "个",
  用量: undefined,
  备注: "",
});
const blankRows = (count = 8) => Array.from({ length: count }, () => newRow());

const today = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// 物料选择器行(物料档案或已有 BOM 行归一化后的形状)
interface MaterialPick {
  款号?: string;
  塑胶货号?: string;
  物料编号?: string;
  物料名称?: string;
  工模编号?: string;
  规格?: string;
  物料类别?: string;
  材料?: string;
  颜色?: string;
  单位?: string;
  使用数量?: number | null;
  用量?: number | null;
  备注?: string;
}

const tdCls = "border-t border-black/6 px-1.5 py-1";

export default function BomSetupPage({ assemblyMode = false }: { assemblyMode?: boolean }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canAudit = can(MENU, "审核");
  const canReverseAudit = can(MENU, "反审核");
  const canEditPrices = can(MENU, "单价");

  const [sp] = useSearchParams();
  const navigate = useNavigate();
  // 装配模式:/assembly-material-setup 由包装页(AssemblyMaterialSetupPage)传 prop 开启;
  // 不用 useLocation 判定:keep-alive 下同模块两实例共享当前路由,隐藏的 BOM 实例会被误切(对照老系统按路由判定)
  const isAssembly = assemblyMode;
  const pageTitle = isAssembly ? "装配物料设置" : "BOM物料设置";
  const 款号Param = sp.get("款号");
  const returnTo = sp.get("return");
  // 排期「去建 BOM」跳转带入:品名→产品名称,客户名称→按名称匹配客户资料回填客户编号
  const 品名Param = sp.get("品名");
  const 客户Param = sp.get("客户名称");
  // 排期「去建 BOM」跳入带的 PO 号:保存时随台头提交(待绑定PO号),后端审核后自动绑定该 PO
  const poParam = sp.get("po");
  // 排期行 MA 规则字段:实单跳入时自动切实单版 + 预选关联 MA(排期 SQL 口径,比前缀猜准)
  const 单类型Param = sp.get("单类型");
  const 关联MAParam = sp.get("关联MA货号");

  const currentUser = getUser() || "用户";
  const blankHeader = (): HeaderState => ({
    客户编号: "",
    客户名称: "",
    产品货号: "",
    产品名称: "",
    日期: today(),
    单位: "个",
    默认单价: "",
    类型: "明细",
    操作员: currentUser,
    备注: "",
    PO号: "",
    // 装配扩展段默认值(对照老系统 reset:类别=未包装半成品,库存单价HK=0,需求用量=1)
    配件编号: "",
    共用物料编号: "",
    装配方式: "",
    产品装配名称: "",
    类别: "未包装半成品",
    库存单价HK: 0,
    其他成本HK: undefined,
    需求用量: 1,
    半成品计算库存: false,
  });
  const [header, setHeader] = useState<HeaderState>(blankHeader);
  const [loaded款号, setLoaded款号] = useState("");
  const [rows, setRows] = useState<MatRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [bomAudited, setBomAudited] = useState(false);
  // BOM 反审核申请(申请-审批流,经理在消息中心批准):申请人,null=无待批申请
  const [bomRevApplicant, setBomRevApplicant] = useState<string | null>(null);

  // ---------- 装配模式(扩展段 + 报价 + 调整审核) ----------
  const [quoteRows, setQuoteRows] = useState<QuoteRow[]>([]);
  // 持久化门槛(对照老系统 bomSetupAssemblyPersistence):响应带该段或用户编辑过才随保存提交
  const [hasExtensionData, setHasExtensionData] = useState(false);
  const [hasQuoteData, setHasQuoteData] = useState(false);
  // 调整审核(装配扩展段.调整审核):已审核后整页只读,反审核后可改
  const [audited, setAudited] = useState(false);
  const readOnly = isAssembly && audited;

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [styles, setStyles] = useState<StyleListItem[]>([]);
  const [bomHeaders, setBomHeaders] = useState<BomHeaderOption[]>([]);
  const [quoteCategories, setQuoteCategories] = useState<string[]>([]);
  const [semiOptions, setSemiOptions] = useState<SemiOption[]>([]);

  // MA/实单 双版本:MA=模板自由编辑+半成品设置;实单=只能从关联 MA 勾选半成品
  // (装配模式无实单版,对照老系统 isOrderMode = !isAssembly && mode === "实单")
  const [mode, setMode] = useState<"MA" | "实单">("MA");
  const [maNo, setMaNo] = useState(""); // 关联的 MA 货号(实单版/装配入口保存时持久化到 款号物料总表.MA货号;MA 版仅作选半成品依据)
  const isOrderMode = !isAssembly && mode === "实单";
  // MA货号持久化口径:实单版与装配入口随台头落库;MA 版存 null(否则重开会被当成实单版)
  const persistMaNo = isOrderMode || isAssembly;

  // 「设置半成品」面板同步过来的定义:BOM 明细行命中半成品名称时,行可点击展开组成物料
  const [semiDefs, setSemiDefs] = useState<SemiSetupDef[]>([]);
  const [expandedSemi, setExpandedSemi] = useState<number[]>([]);

  const [tab, setTab] = useState<"mat" | "img">("mat");
  const [openDlg, setOpenDlg] = useState(false);
  const [openKw, setOpenKw] = useState("");
  const [openRows, setOpenRows] = useState<StyleListItem[]>([]);
  const [openLoading, setOpenLoading] = useState(false);

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState("");
  const [copyOverwrite, setCopyOverwrite] = useState(false); // 409 后的覆盖确认
  const [copying, setCopying] = useState(false);

  const [delOpen, setDelOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [warnList, setWarnList] = useState<string[] | null>(null); // 保存后的重复扣料风险提示
  const [bomRevOpen, setBomRevOpen] = useState(false);
  const [bomRevReason, setBomRevReason] = useState("");

  // 物料/半成品选择器
  const [pickRowKey, setPickRowKey] = useState<number | null>(null);
  const [pickRows, setPickRows] = useState<MaterialPick[]>([]);
  const [pickKw, setPickKw] = useState("");
  const [pickTab, setPickTab] = useState<"material" | "semi">("material");
  const [pickSelected, setPickSelected] = useState<number[]>([]); // pickRows 下标
  const [pickLoading, setPickLoading] = useState(false);

  // 实单版:从关联 MA 勾选半成品定义
  const [maPickOpen, setMaPickOpen] = useState(false);
  const [maPickKeys, setMaPickKeys] = useState<string[]>([]);
  // 实单版「选物料」弹窗(包材等:物料资料+塑胶物料资料,按货号前缀过滤)
  const [matPickOpen, setMatPickOpen] = useState(false);

  // 产品货号自动补全下拉
  const [prodOpen, setProdOpen] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const loadVersion = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const patchHeader = (p: Partial<HeaderState>) => setHeader((h) => ({ ...h, ...p }));
  const patch = (key: number, p: Partial<MatRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  // 装配扩展段字段编辑后激活持久化(对照老系统 onValuesChange 标记 hasExtensionData)
  const patchExtension = (p: Partial<HeaderState>) => {
    if (isAssembly) setHasExtensionData(true);
    patchHeader(p);
  };

  const reset = useCallback(() => {
    loadVersion.current += 1;
    setLoaded款号("");
    setBomAudited(false);
    setBomRevApplicant(null);
    setAudited(false);
    setHasExtensionData(false);
    setHasQuoteData(false);
    setQuoteRows([]);
    setHeader(blankHeader());
    setRows(blankRows());
    setMode("MA");
    setMaNo("");
    setSemiDefs([]);
    setExpandedSemi([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // 基础数据:客户/款号列表/BOM 单头(货号按客户过滤用)/报价类别/半成品选项;失败逐项降级
  useEffect(() => {
    if (!canOpen) return;
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          customersApi.list(1, 500, ""),
          stylesApi.list("", 1, 500),
        ]);
        setCustomers(c.items);
        setStyles(s.items);
        stylesApi.bomHeaders().then(setBomHeaders).catch(() => {});
      } catch (e) {
        setToast({ text: errMsg(e, "加载客户/产品货号资料失败"), tone: "err" });
      }
      try {
        const r = await masterDataApi("quote-categories").list(1, 1000, "");
        const names = r.items
          .map((x) => String(x.类别 ?? x.名称 ?? "").trim())
          .filter(Boolean);
        setQuoteCategories([...new Set(names)]);
      } catch {
        /* 类别加载失败时保持空选项 */
      }
    })();
    stylesApi
      .semiOptions()
      .then((list) => setSemiOptions(list ?? []))
      .catch(() => {});
  }, [canOpen]);

  // 半成品判定集(与后端一致):编号在 半成品共用物料设置.产品货号 中即为半成品行(兜底判定)
  const semiSet = useMemo(() => new Set(semiOptions.map((s) => s.款号)), [semiOptions]);
  const semiDefOf = (r: MatRow) =>
    semiDefs.find(
      (d) =>
        d.类型 === "半成品" &&
        (d.名称 === r.物料编号.trim() || d.名称 === r.物料名称.trim()),
    );
  // 实单版只认半成品行:材料列=半成品(勾入时写入) 或命中 MA 半成品定义
  const isSemiRow = (r: MatRow) =>
    r.材料 === "半成品" || semiDefOf(r) != null;
  // 实单版保留行:半成品行 + 物料行(包材等,「选物料」从物料资料/塑胶物料资料勾入,带物料编号);
  // 网格显示与保存同口径(实单需采购包材,不再剔除物料行)
  const keepOrderRow = (r: MatRow) => isSemiRow(r) || !!r.物料编号.trim();

  // 半成品保存成功后追加一行进 BOM 明细(编号/名称=半成品名称,材料列标记"半成品",用量取定义上的半成品用量),保存 BOM 后落库
  const appendSemiRow = (名称: string) => {
    const 用量 = semiDefs.find((d) => d.类型 === "半成品" && d.名称 === 名称)?.用量 ?? 1;
    setRows((rs) => {
      if (rs.some((r) => r.物料编号.trim() === 名称 || r.物料名称.trim() === 名称)) return rs;
      return [
        ...rs,
        { ...newRow(), 物料编号: 名称, 物料名称: 名称, 材料: "半成品", 单位: "个", 用量 },
      ];
    });
    setToast({ text: `已把半成品「${名称}」加入 BOM 明细,保存 BOM 后生效`, tone: "ok" });
  };

  // 半成品定义的用量改动时,同步 BOM 明细里同名半成品行的用量(成品用量与定义保持一致)
  const syncSemiUsage = (名称: string, 用量: number) =>
    setRows((rs) =>
      rs.map((r) =>
        r.物料编号.trim() === 名称 || r.物料名称.trim() === 名称 ? { ...r, 用量 } : r,
      ),
    );

  // 实单版 关联MA 下拉:只列 -MA 结尾且已建 BOM 的货号
  const maOptions = useMemo(
    () =>
      bomHeaders
        .map((b) => (b.款号 ?? "").trim())
        .filter((no) => /-ma$/i.test(no)),
    [bomHeaders],
  );

  // 选中关联 MA 后拉取其半成品定义(写进 semiDefs,供「选半成品」与明细行链接展开组成物料)
  useEffect(() => {
    if (!maNo) return;
    let dead = false;
    void (async () => {
      try {
        const defs = await semiSetupApi.list(maNo);
        if (!dead) setSemiDefs(defs);
      } catch (e) {
        if (!dead) setToast({ text: errMsg(e, "加载关联 MA 货号资料失败"), tone: "err" });
      }
    })();
    return () => {
      dead = true;
    };
  }, [maNo]);

  // 排期实单「去建 BOM」跳入(单类型=实单):新建态自动切实单版页签 + 预选关联 MA;
  // 关联MA 只在其已建 BOM(选项里存在)时预选,不覆盖用户已选;载入已有 BOM 时 loadDoc 的自动切换会覆盖本效果
  useEffect(() => {
    if (isAssembly || 单类型Param !== "实单") return;
    setMode("实单");
    const ma = 关联MAParam?.trim();
    if (ma && maOptions.some((o) => o === ma)) setMaNo((prev) => prev || ma);
  }, [isAssembly, 单类型Param, 关联MAParam, maOptions]);

  // 未选 MA 时按系列前缀猜一个(92125-S005-MTS/92125A-S001 → 92125-MA;
  // 数字开头取前导数字串,92125A/92125H 等后缀只是区分国家),选项里存在则预选;
  // 打开的就是 MA 货号本身时关联自身(该 MA 的半成品=自身定义,MA 版/装配入口都按此预选)
  useEffect(() => {
    if (maNo) return;
    const no = loaded款号.trim();
    if (!no) return;
    const series = /^\d+/.exec(no)?.[0] ?? no.split("-")[0];
    const guess = `${series}-MA`;
    if (maOptions.some((o) => o === guess)) setMaNo(guess);
  }, [maNo, loaded款号, maOptions]);

  // 装配入口:该货号的排期实单(PO号 选项来源 + 选中 PO 时 数量 按接单数量自动带出)
  const [schedRows, setSchedRows] = useState<ScheduleRow[]>([]);
  useEffect(() => {
    if (!isAssembly) return;
    const no = (loaded款号 || header.产品货号).trim();
    if (!no) {
      setSchedRows([]);
      return;
    }
    let dead = false;
    void (async () => {
      try {
        const r = await schedulingApi.list({ page: 1, size: 1000, keyword: no });
        if (dead) return;
        setSchedRows(
          (r.items ?? []).filter(
            (x) => (x.货号 ?? "").trim() === no && x.状态 !== "已取消" && (x.PO号 ?? "").trim(),
          ),
        );
      } catch {
        if (!dead) setSchedRows([]);
      }
    })();
    return () => {
      dead = true;
    };
  }, [isAssembly, loaded款号, header.产品货号]);

  // PO号 → 接单数量合计(同 PO 同货号多行合计,与生产通知单 prefill排期数量 同口径)
  const poOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const x of schedRows) {
      const po = (x.PO号 ?? "").trim();
      if (!po) continue;
      map.set(po, (map.get(po) ?? 0) + (Number(x.数量) || 0));
    }
    return [...map.entries()].map(([po, qty]) => ({ po, qty }));
  }, [schedRows]);

  // 选 PO:台头 PO号 落台(保存=待绑定PO号),数量 按该 PO 接单数量带出(可再手改;
  // patchExtension 标记扩展段需持久化,数量才随保存落 半成品共用物料设置.需求用量)
  const onPoChange = (po: string) => {
    const hit = poOptions.find((o) => o.po === po);
    patchExtension({ PO号: po, ...(po && hit ? { 需求用量: hit.qty } : {}) });
  };

  const productOptions = useMemo(() => {
    // 选中客户后,下拉只列该客户的款号(按 BOM 单头客户编号判断);未建过 BOM 的款号不限客户
    const list = header.客户编号
      ? styles.filter((s) => {
          const h = bomHeaders.find((b) => b.款号 === s.款号);
          return !h || !h.客户编号 || h.客户编号 === header.客户编号;
        })
      : styles;
    return list.filter((s) => s.款号);
  }, [styles, bomHeaders, header.客户编号]);

  const loadDoc = useCallback(
    async (productNo: string, preserveCustomer = false) => {
      const key = productNo.trim();
      if (!key) return;
      const requestVersion = ++loadVersion.current;
      try {
        const full = await stylesApi.materials(key);
        if (requestVersion !== loadVersion.current) return;
        const first = full.物料?.[0];
        const head = full.单头 ?? null;
        // 装配模式:扩展/报价段是否随响应持久化(缺段=清空;有段=水合;对照老系统 loadDoc)
        const hasExtension =
          isAssembly &&
          Object.prototype.hasOwnProperty.call(full, "扩展") &&
          full.扩展 != null;
        const hasQuotes =
          isAssembly &&
          Object.prototype.hasOwnProperty.call(full, "报价") &&
          Array.isArray(full.报价);
        const extension = full.扩展;
        setLoaded款号(key);
        setBomAudited(head?.审核 === "1");
        setBomRevApplicant(head?.反审核申请 === "1" ? (head.反审核申请人 ?? "") : null);
        setHasExtensionData(hasExtension);
        setHasQuoteData(hasQuotes);
        setAudited(hasExtension && Boolean(extension?.调整审核));
        // MA/实单自动切换:-MA 结尾(不分大小写)=模板 MA 版;单头带 MA货号=实单版(回填关联 MA)
        // (装配模式不切换,恒 MA 版口径;对照老系统 if (!isAssembly))
        if (!isAssembly) {
          const linked = (head?.MA货号 ?? "").trim();
          if (/-ma$/i.test(key)) {
            setMode("MA");
            setMaNo("");
          } else if (linked) {
            setMode("实单");
            setMaNo(linked);
          } else {
            setMode("MA");
            setMaNo("");
          }
        } else {
          // 装配入口:回填台头持久化的关联 MA(无则留空,由系列前缀猜测效果补)
          setMaNo((head?.MA货号 ?? "").trim());
        }
        setHeader((h) => ({
          ...h,
          客户编号: preserveCustomer
            ? h.客户编号
            : (head?.客户编号 ?? first?.客户编号 ?? h.客户编号 ?? ""),
          客户名称: preserveCustomer
            ? h.客户名称
            : (head?.客户名称 ?? first?.客户名称 ?? h.客户名称 ?? ""),
          产品货号: key,
          产品名称: String(full.款式 ?? ""),
          日期: (head?.日期 ?? first?.日期 ?? h.日期 ?? today()).slice(0, 10),
          单位: hasExtension
            ? (extension?.单位 ?? head?.单位 ?? first?.单位 ?? "个")
            : (head?.单位 ?? first?.单位 ?? "个"),
          默认单价: head?.默认单价 ?? "",
          类型: head?.类型 ?? "明细",
          备注: hasExtension ? (extension?.备注内容 ?? "") : (head?.备注 ?? ""),
          操作员: h.操作员 || currentUser,
          // 有效 PO(待绑定优先,审核绑定后回落最近绑定);装配入口可改,BOM 入口原样回传
          PO号: (head?.PO号 ?? "").trim(),
          // 装配扩展段:有段水合,无段清空(对照老系统 form.setFieldsValue 各字段 hasExtension 三元)
          配件编号: hasExtension ? (extension?.配件编号 ?? "") : "",
          共用物料编号: hasExtension ? (extension?.共用物料编号 ?? "") : "",
          装配方式: hasExtension ? (extension?.装配方式 ?? "") : "",
          产品装配名称: hasExtension ? (extension?.产品装配名称 ?? String(full.款式 ?? "")) : "",
          类别: hasExtension ? (extension?.类别 ?? "未包装半成品") : "未包装半成品",
          库存单价HK: hasExtension ? (extension?.库存单价HK ?? undefined) : undefined,
          其他成本HK: hasExtension ? (extension?.其他成本HK ?? undefined) : undefined,
          需求用量: hasExtension ? (extension?.需求用量 ?? 1) : 1,
          半成品计算库存: hasExtension ? (extension?.半成品计算库存 ?? false) : false,
        }));
        const list: MatRow[] = (full.物料 ?? []).map((m) => ({
          key: uid(),
          物料编号: m.物料编号 ?? "",
          物料名称: m.物料名称 ?? "",
          工模编号: m.工模编号 ?? "",
          规格: m.规格 ?? "",
          材料: m.物料类别 ?? "",
          颜色: m.颜色 ?? "",
          单位: m.单位 ?? "",
          用量: m.使用数量 ?? undefined,
          备注: m.备注 ?? "",
        }));
        setRows(list.length ? [...list, newRow()] : blankRows());
        // 报价段水合(仅装配模式且响应带 报价 数组;对照老系统 loadDoc 报价映射)
        if (hasQuotes) {
          setQuoteRows(
            (full.报价 ?? []).map((q) =>
              newQuoteRow({
                ID: q.ID ?? undefined,
                物料编号: q.物料编号 ?? undefined,
                物料名称: q.物料名称 ?? undefined,
                类型:
                  q.合作方类型 === "加工厂"
                    ? "加工厂"
                    : q.合作方类型 === "本厂"
                      ? "本厂"
                      : "供应商",
                编号: q.合作方编号 ?? "",
                名称: q.合作方名称 ?? "",
                报价日期: q.报价日期 ? String(q.报价日期).slice(0, 10) : "",
                货币: q.货币 ?? "HK$",
                单价: q.单价 ?? undefined,
                港币: q.港币价 ?? undefined,
                对比相差: q.对比相差 ?? undefined,
                相差比例: q.相差比例 ?? undefined,
                默认: q.是否默认 ?? false,
                备注: q.备注 ?? "",
              }),
            ),
          );
        } else {
          setQuoteRows([]);
        }
        setExpandedSemi([]);
        setOpenDlg(false);
      } catch (e) {
        if (requestVersion !== loadVersion.current) return;
        if (e instanceof Error && "status" in e && (e as { status: number }).status === 404) {
          // 货号尚未建 BOM(排期页「去建 BOM」跳转/手输新款号):预填已知信息,录入物料后直接保存即建档
          patchHeader({ 产品货号: key, 产品名称: 品名Param || "" });
          setLoaded款号("");
          setAudited(false);
          setHasExtensionData(false);
          setHasQuoteData(false);
          setQuoteRows([]);
          setRows(blankRows());
          // 实单版跳入(单类型=实单):不自动带料——实单采购的是包材,MA 的物料/半成品与实单无关,
          // 明细从空开始,由「选物料」手动勾选该货号的包材
          if (!isAssembly && 单类型Param === "实单") {
            setToast({
              text: `货号 ${key} 尚未建 BOM;点「选物料」勾选 ${货号前缀(key)} 的包材物料,保存即建档`,
              tone: "ok",
            });
            return;
          }
          // 新建态(MA 版/装配入口):按「货号-物料名」前缀约定从物料资料自动带出(如 92125-MA → 92125-*),
          // 塑胶仓物料按 款号(塑胶货号,支持 92119/92125 分词)一并带出;用量留空待填
          try {
            const base = 货号前缀(key);
            const [ms, plasticRows] = await Promise.all([
              masterDataApi("materials").list(1, 1000, base),
              fetchPlasticPrefix(base),
            ]);
            if (requestVersion !== loadVersion.current) return;
            const matched = [...(ms.items as MaterialPick[]), ...plasticRows].filter((m) =>
              matchPrefix(m, key),
            );
            if (matched.length > 0) {
              setRows([
                ...matched.map((m) => ({
                  key: uid(),
                  物料编号: m.物料编号 ?? "",
                  物料名称: m.物料名称 ?? "",
                  工模编号: m.工模编号 ?? "",
                  规格: m.规格 ?? "",
                  ...split材料(m),
                  颜色: m.颜色 ?? "",
                  单位: m.单位 ?? "",
                  用量: undefined,
                })),
                newRow(),
              ]);
              setToast({
                text: `货号 ${key} 尚未建 BOM;已按前缀「${货号前缀(key)}-」带出 ${matched.length} 条物料,补用量后保存即建档`,
                tone: "ok",
              });
            } else {
              setToast({ text: `货号 ${key} 尚未建 BOM,录入物料后直接保存即可建档`, tone: "ok" });
            }
          } catch {
            setToast({ text: `货号 ${key} 尚未建 BOM,录入物料后直接保存即可建档`, tone: "ok" });
          }
        } else {
          setToast({ text: errMsg(e, "产品货号不存在或加载失败"), tone: "err" });
        }
      }
    },
    [currentUser, 品名Param, isAssembly, 单类型Param],
  );

  useEffect(() => {
    if (款号Param) void loadDoc(款号Param);
    else reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [款号Param]);

  // 排期「去建 BOM」带入的客户名称:客户资料加载后按名称/编号匹配,回填客户编号
  useEffect(() => {
    const name = 客户Param?.trim();
    if (!name || header.客户编号) return;
    const hit = customers.find((c) => c.客户名称 === name || c.客户编号 === name);
    if (hit) patchHeader({ 客户编号: hit.客户编号 ?? "", 客户名称: hit.客户名称 ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, 客户Param]);

  // 客户独立赋值,不再清空货号/明细(与老系统一致)
  const onCustomerChange = (customerNo: string) => {
    const picked = customers.find((c) => c.客户编号 === customerNo);
    patchHeader({ 客户编号: customerNo, 客户名称: picked?.客户名称 ?? "" });
  };

  // 清空产品货号 → 回到新建态
  const clearProduct = () => {
    loadVersion.current += 1;
    patchHeader({ 产品货号: "", 产品名称: "", PO号: "" });
    setLoaded款号("");
    setRows(blankRows());
    setQuoteRows([]);
    setHasExtensionData(false);
    setHasQuoteData(false);
    setAudited(false);
    setBomAudited(false);
    setBomRevApplicant(null);
    setMode("MA");
    setMaNo("");
  };

  // 选中款号(下拉选择/手输确认):款式从款号总表带出到产品名称,再按现有逻辑载入该货号 BOM
  const pickProduct = async (productNo: string) => {
    const key = productNo.trim();
    if (!key) {
      clearProduct();
      return;
    }
    const matched = styles.find((s) => s.款号 === key);
    if (matched) patchHeader({ 产品名称: matched.款式 ?? "" });
    await loadDoc(key);
  };

  // 手输货号失焦时确认载入(与当前已载货号相同则不重复请求)
  const onProductBlur = () => {
    // 延迟让下拉选项的 mousedown 先触发
    setTimeout(() => {
      setProdOpen(false);
      const v = header.产品货号.trim();
      if (!v) return;
      if (v !== loaded款号) void pickProduct(v);
    }, 150);
  };

  const loadOpenList = useCallback(async (kw: string) => {
    setOpenLoading(true);
    try {
      const r = await stylesApi.list(kw, 1, 200);
      setOpenRows(r.items);
    } catch (e) {
      setToast({ text: errMsg(e, "加载产品货号列表失败"), tone: "err" });
    } finally {
      setOpenLoading(false);
    }
  }, []);

  // ---------- 物料/半成品选择器 ----------

  // 备注前缀「材料:X」拆到网格 材料 列(物料资料 Excel 的 材料 列导入时打包进备注的约定);
  // 无此前缀时 材料 维持 材料/物料类别 兜底,备注原样
  const split材料 = (m: MaterialPick): { 材料: string; 备注: string } => {
    const remark = (m.备注 ?? "").trim();
    const hit = /^材料[:：](.+)$/.exec(remark);
    if (!hit) return { 材料: m.材料 ?? m.物料类别 ?? "", 备注: remark };
    const [mat, ...rest] = hit[1].split(/[;；]/);
    return { 材料: mat.trim(), 备注: rest.join(";").trim() };
  };

  // 货号前缀/前缀匹配规则已抽至 @/lib/materialMatch(选料弹窗按货号过滤复用)
  // 塑胶物料资料行 → MaterialPick(塑胶货号=款号)
  const plasticToPick = (p: PlasticMaterialRow): MaterialPick => ({
    塑胶货号: p.款号 ?? "",
    物料编号: p.物料编号 ?? "",
    物料名称: p.物料名称 ?? "",
    工模编号: p.工模编号 ?? "",
    规格: p.规格 ?? "",
    物料类别: p.物料类别 ?? "",
    颜色: p.颜色 ?? "",
    单位: p.单位 ?? "个",
    备注: p.备注 ?? "",
  });
  // 塑胶仓前缀物料(按款号模糊,服务端过滤)
  const fetchPlasticPrefix = (base: string) =>
    plasticMaterialMasterApi.list(undefined, undefined, 1, 1000, undefined, undefined, base)
      .then((r) => r.items.map(plasticToPick))
      .catch(() => [] as MaterialPick[]);

  const loadPickList = useCallback(
    async (kw: string) => {
      const productNo = header.产品货号.trim();
      if (!productNo) {
        setToast({ text: "请先选择产品货号", tone: "err" });
        return;
      }
      setPickLoading(true);
      try {
        const base = 货号前缀(productNo);
        const [masterRows, bom, plasticRows] = await Promise.all([
          // 关键字用货号前缀(物料按「92125-吊卡」命名,整号 92125-MA 搜不到)
          masterDataApi("materials").list(1, 1000, base),
          stylesApi.materials(productNo).catch(() => null),
          fetchPlasticPrefix(base),
        ]);
        const keyword = kw.trim().toLowerCase();
        const matchKeyword = (m: MaterialPick) => {
          const hit = `${m.物料编号 ?? ""} ${m.物料名称 ?? ""} ${m.规格 ?? ""} ${m.颜色 ?? ""} ${m.工模编号 ?? ""}`;
          return !keyword || hit.toLowerCase().includes(keyword);
        };
        const fromMaster = [...(masterRows.items as MaterialPick[]), ...plasticRows]
          .filter((m) => matchPrefix(m, productNo))
          .filter(matchKeyword);
        const fromBom = ((bom?.物料 ?? []) as MaterialPick[]).filter(matchKeyword);
        const source = fromMaster.length ? fromMaster : fromBom;
        const dedup = new Map<string, MaterialPick>();
        for (const m of source)
          dedup.set(`${m.物料编号 ?? ""}|${m.物料名称 ?? ""}|${m.规格 ?? ""}`, m);
        setPickRows([...dedup.values()]);
        setPickSelected([]);
      } catch (e) {
        setToast({ text: errMsg(e, "加载该货号物料失败"), tone: "err" });
      } finally {
        setPickLoading(false);
      }
    },
    [header.产品货号],
  );

  const openPicker = (rowKey: number) => {
    if (!header.产品货号.trim()) {
      setToast({ text: "请先选择产品货号", tone: "err" });
      return;
    }
    setPickRowKey(rowKey);
    setPickKw("");
    setPickTab("material");
    setPickSelected([]);
    void loadPickList("");
  };

  const ensureTrailingBlank = (prev: MatRow[]) =>
    prev.some((r) => !r.物料编号 && !r.物料名称) ? prev : [...prev, newRow()];

  const choosePick = (m: MaterialPick) => {
    if (pickRowKey == null) return;
    patch(pickRowKey, {
      物料编号: m.物料编号 ?? "",
      物料名称: m.物料名称 ?? "",
      工模编号: m.工模编号 ?? "",
      规格: m.规格 ?? "",
      ...split材料(m),
      颜色: m.颜色 ?? "",
      单位: m.单位 ?? "",
      用量: m.使用数量 ?? m.用量 ?? undefined,
    });
    setRows(ensureTrailingBlank);
    setPickRowKey(null);
    setPickSelected([]);
  };

  // 多选加入:按勾选顺序一次性把多个物料加入明细;字段映射与单行加入一致,但用量留空待填
  const choosePickMulti = () => {
    if (pickRowKey == null || !pickSelected.length) return;
    const picked = pickRows.filter((_, i) => pickSelected.includes(i));
    if (!picked.length) {
      setToast({ text: "请先勾选要加入的物料", tone: "err" });
      return;
    }
    const added: MatRow[] = picked.map((m) => ({
      key: uid(),
      物料编号: m.物料编号 ?? "",
      物料名称: m.物料名称 ?? "",
      工模编号: m.工模编号 ?? "",
      规格: m.规格 ?? "",
      ...split材料(m),
      颜色: m.颜色 ?? "",
      单位: m.单位 ?? "",
      用量: undefined,
    }));
    setRows((prev) => {
      const next = [...prev];
      const idx = next.findIndex((r) => r.key === pickRowKey);
      // 触发行(点放大镜的行)为空时用它承载第一条勾选物料,其余插到其后;否则整体追加到末尾
      if (idx >= 0 && !next[idx].物料编号 && !next[idx].物料名称) {
        next.splice(idx, 1, ...added);
      } else {
        next.push(...added);
      }
      return ensureTrailingBlank(next);
    });
    setToast({ text: `已加入 ${added.length} 行物料`, tone: "ok" });
    setPickRowKey(null);
    setPickSelected([]);
  };

  // 调入下级半成品:行内存款号,用量默认取半成品的需求用量(可手工改);半成品无需选供应商
  const chooseSemi = (s: SemiOption) => {
    if (pickRowKey == null) return;
    patch(pickRowKey, {
      物料编号: s.款号,
      物料名称: s.款式 ?? "",
      工模编号: "",
      规格: "",
      材料: s.类别 ?? "半成品",
      颜色: "",
      单位: s.单位 ?? "",
      用量: s.需求用量 ?? 1,
      备注: "",
    });
    setRows(ensureTrailingBlank);
    setPickRowKey(null);
  };

  const filteredSemiOptions = useMemo(() => {
    const kw = pickKw.trim().toLowerCase();
    if (!kw) return semiOptions;
    return semiOptions.filter((s) =>
      `${s.款号} ${s.款式 ?? ""} ${s.类别 ?? ""}`.toLowerCase().includes(kw),
    );
  }, [semiOptions, pickKw]);

  // ---------- 实单版:从关联 MA 勾选半成品 ----------

  const openMaPick = () => {
    setMaPickKeys([]);
    setMaPickOpen(true);
  };

  const confirmMaPick = () => {
    const picked = semiDefs.filter((d) => d.类型 === "半成品" && maPickKeys.includes(d.名称));
    const added = pickedMaDefRows(rows, picked);
    if (!added.length) {
      setToast({ text: "勾选的内容已全部在 BOM 明细中", tone: "ok" });
    } else {
      setRows((rs) => {
        const next = [
          ...rs.filter((r) => r.物料编号.trim() || r.物料名称.trim()),
          ...added.map((r) => ({ ...r, key: uid() })),
        ];
        // 实单版明细不保留空白尾行(行内字段只读,物料行仅用量/备注可改);装配/MA 版保留空白尾行便于继续录入
        return isOrderMode ? next : ensureTrailingBlank(next);
      });
      setToast({ text: `已加入 ${added.length} 行`, tone: "ok" });
    }
    setMaPickOpen(false);
    setMaPickKeys([]);
  };

  // ---------- 实单版:选物料(包材等;物料资料+塑胶物料资料,按货号前缀过滤,多选一次入行;同编号已在明细则跳过) ----------

  const chooseOrderMaterials = (ms: MasterRow[]) => {
    const exist = new Set(rows.flatMap((r) => [r.物料编号.trim(), r.物料名称.trim()]).filter(Boolean));
    const added = ms
      .map((m) => ({ m, code: String(m.物料编号 ?? "").trim() }))
      .filter(({ code }) => code && !exist.has(code))
      .map(({ m, code }) => ({
        key: uid(),
        物料编号: code,
        物料名称: String(m.物料名称 ?? ""),
        工模编号: String(m.工模编号 ?? ""),
        规格: String(m.规格 ?? ""),
        材料: String(m.物料类别 ?? ""),
        颜色: String(m.颜色 ?? ""),
        单位: String(m.单位 ?? "") || "个",
        用量: 1,
        备注: "",
      }));
    if (added.length === 0) {
      setToast({ text: "勾选的物料已全部在 BOM 明细中", tone: "err" });
      return;
    }
    setRows((rs) => [...rs.filter((r) => r.物料编号.trim() || r.物料名称.trim()), ...added]);
    setToast({
      text: `已加入 ${added.length} 行物料${added.length < ms.length ? "(已在明细中的已跳过)" : ""},用量默认 1 可直接改`,
      tone: "ok",
    });
  };

  // ---------- 行操作 ----------

  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  // 在当前行下方(index+1 处)插入一行空行
  const insertRow = (index: number) =>
    setRows((rs) => {
      const next = [...rs];
      next.splice(index + 1, 0, newRow());
      return next;
    });

  // ---------- 保存/删除/复制/审核 ----------

  const buildBody = (): BomSave => {
    const body: BomSave = {
      客户编号: header.客户编号 || undefined,
      客户名称: header.客户名称 || undefined,
      日期: header.日期 || undefined,
      单位: header.单位 || undefined,
      默认单价: header.默认单价 || undefined,
      类型: header.类型 || "明细",
      款式: header.产品名称 || undefined, // 新款号自动建档用
      // 实单版/装配入口持久化关联 MA 货号(MA 版存 null;装配领料按它找半成品定义展开组成物料)
      MA货号: persistMaNo ? maNo || undefined : undefined,
      // 实单版保存半成品行+物料行(包材);MA 版全量保存
      明细: (isOrderMode ? rows.filter(keepOrderRow) : rows)
        .filter((r) => r.物料编号.trim() || r.物料名称.trim())
        .map(
          (r): StyleMaterial => ({
            物料编号: r.物料编号.trim() || null,
            物料名称: r.物料名称.trim() || null,
            物料类别: r.材料.trim() || null,
            规格: r.规格.trim() || null,
            颜色: r.颜色.trim() || null,
            单位: r.单位.trim() || null,
            使用数量: r.用量 ?? null,
            工模编号: r.工模编号.trim() || null,
            备注: r.备注.trim() || null,
          }),
        ),
    };
    // 装配模式:扩展段只在响应已带或用户编辑过时持久化;价格字段无「单价」位强制 null(对照老系统 buildBody)
    if (hasExtensionData) {
      body.扩展 = {
        产品装配名称: header.产品装配名称 || undefined,
        配件编号: header.配件编号 || undefined,
        共用物料编号: header.共用物料编号 || undefined,
        装配方式: header.装配方式 || undefined,
        类别: header.类别 || undefined,
        库存单价HK: canEditPrices ? (header.库存单价HK ?? null) : null,
        其他成本HK: canEditPrices ? (header.其他成本HK ?? null) : null,
        需求用量: header.需求用量 ?? null,
        单位: header.单位 || undefined,
        半成品计算库存: !!header.半成品计算库存,
        备注内容: header.备注 || undefined,
      };
    }
    if (hasQuoteData) {
      body.报价 = quoteRows
        .filter((q) => q.物料编号 || q.物料名称 || q.编号.trim() || q.名称.trim() || q.类型 === "本厂")
        .map((q, i) => ({
          ID: q.ID ?? null,
          物料编号: q.物料编号 || null,
          物料名称: q.物料名称 || null,
          合作方类型: q.类型,
          合作方编号: q.类型 === "本厂" ? null : q.编号.trim() || null,
          合作方名称: q.类型 === "本厂" ? null : q.名称.trim() || null,
          报价日期: q.报价日期 || null,
          货币: q.货币 || null,
          单价: canEditPrices ? (q.单价 ?? null) : null,
          港币价: canEditPrices ? (q.港币 ?? null) : null,
          对比相差: canEditPrices ? (q.对比相差 ?? null) : null,
          相差比例: canEditPrices ? (q.相差比例 ?? null) : null,
          是否默认: !!q.默认,
          顺序: i + 1,
          备注: q.备注 || null,
        }));
    }
    // PO号:装配入口取台头选择;BOM 入口优先排期「去建 BOM」跳入的 po 参数,其次台头载入值
    // (原样回传,避免普通保存把待绑定PO号 清掉;后端审核后自动绑定该 PO)
    const po号 = (isAssembly ? header.PO号 : poParam || header.PO号).trim();
    if (po号) body.待绑定PO号 = po号;
    return body;
  };

  const save = async () => {
    if (readOnly) return;
    const key = header.产品货号.trim();
    if (!key) {
      setToast({ text: "请先选择产品货号", tone: "err" });
      return;
    }
    const body = buildBody();
    if (body.明细.length === 0) {
      setToast({
        text: isOrderMode ? "请先「选半成品」或「选物料」加入至少 1 行" : "请至少选择一行物料",
        tone: "err",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await stylesApi.saveMaterials(key, body);
      setToast({ text: `${pageTitle}已保存`, tone: "ok" });
      // 后端警告(既调半成品又直接列其组成物料 → 重复扣料风险):提示但不阻止
      if (Array.isArray(res?.警告) && res.警告.length > 0) setWarnList(res.警告);
      await loadDoc(key, true);
    } catch (e) {
      setToast({ text: errMsg(e, "保存失败,请重试"), tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 真删除整张 BOM(台头+明细):后端校验 未审核 + 未被生产通知单引用;已审核需先反审核
  const del = async () => {
    if (readOnly || bomAudited) return;
    const key = loaded款号 || header.产品货号.trim();
    if (!key) return;
    try {
      await stylesApi.deleteBom(key);
      setToast({ text: `款号 ${key} 的 BOM 已删除`, tone: "ok" });
      reset();
    } catch (e) {
      setToast({ text: errMsg(e, "删除失败"), tone: "err" });
    }
  };

  const doCopy = async (覆盖 = false) => {
    const source = loaded款号.trim();
    const target = copyTarget.trim();
    if (!source) {
      setToast({ text: "请先打开要复制的产品货号", tone: "err" });
      return;
    }
    if (!target) {
      setToast({ text: "请选择目标产品货号", tone: "err" });
      return;
    }
    if (target === source) {
      setToast({ text: "目标产品货号不能与源货号相同", tone: "err" });
      return;
    }
    setCopying(true);
    try {
      await stylesApi.copyBom(source, { 目标款号: target, 覆盖 });
      setToast({ text: `已复制到 ${target}`, tone: "ok" });
      setCopyOpen(false);
      setCopyOverwrite(false);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const msg = errMsg(e, "复制失败,请重试");
      if (status === 409 && msg.includes("已有 BOM")) {
        // 目标货号已有 BOM:弹覆盖确认
        setCopyOverwrite(true);
      } else {
        setToast({ text: msg, tone: "err" });
      }
    } finally {
      setCopying(false);
    }
  };

  // BOM 台头审核(款号物料总表.审核)
  const changeBomAudit = async () => {
    const key = loaded款号 || header.产品货号.trim();
    if (!key || !canAudit) return;
    setSaving(true);
    try {
      await stylesApi.bomAudit(key);
      setToast({ text: "已审核", tone: "ok" });
      await loadDoc(key, true);
    } catch (e) {
      setToast({ text: errMsg(e, "BOM审核失败"), tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 提交 BOM 反审核申请:必填原因,经理在消息中心批准后一步到位回未审核
  const submitBomReverseRequest = async () => {
    const key = loaded款号 || header.产品货号.trim();
    if (!key) return;
    if (!bomRevReason.trim()) {
      setToast({ text: "请填写反审核原因", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      await stylesApi.requestBomReverseAudit(key, bomRevReason.trim());
      setToast({ text: "已提交反审核申请,待经理批准", tone: "ok" });
      setBomRevOpen(false);
      await loadDoc(key, true);
    } catch (e) {
      setToast({ text: errMsg(e, "BOM反审核申请失败"), tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 装配模式 调整审核/反审核(翻转 装配扩展段.调整审核;POST /styles/{款号}/audit|reverse-audit,
  // URL 照抄老系统 BomSetupPage changeAudit;区别于 BOM 入口的 bomAudit 台头审核)
  const changeAssemblyAudit = async () => {
    if (!isAssembly) return;
    const key = loaded款号 || header.产品货号.trim();
    if (!key || (audited ? !canReverseAudit : !canAudit)) return;
    setSaving(true);
    try {
      if (audited) await stylesApi.assemblyReverseAudit(key);
      else await stylesApi.assemblyAudit(key);
      setToast({ text: audited ? "已反审核" : "已审核", tone: "ok" });
      await loadDoc(key, true);
    } catch (e) {
      setToast({ text: errMsg(e, audited ? "反审核失败" : "审核失败"), tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (returnTo) navigate(buildCloseTarget(returnTo));
    else navigate(buildCloseTarget(null));
  };

  const applyImport = (imported: BomImportApplyRow[], importMode: "append" | "replace") => {
    const newRows: MatRow[] = imported.map((r) => ({ ...newRow(), ...r }));
    setRows((prev) => {
      const base =
        importMode === "replace"
          ? []
          : prev.filter((r) => r.物料编号.trim() || r.物料名称.trim());
      return ensureTrailingBlank([...base, ...newRows]);
    });
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title={`无权访问 ${pageTitle}`}
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", disabled: readOnly, disabledTitle: readOnly ? "BOM已审核" : undefined, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, onClick: () => { setOpenKw(""); setOpenDlg(true); void loadOpenList(""); } },
    { key: "save", label: "保存", icon: SealCheck, perm: "保存", primary: true, disabled: saving || readOnly, disabledTitle: readOnly ? "BOM已审核" : undefined, onClick: () => void save() },
    {
      key: "import",
      label: "导入",
      icon: UploadSimple,
      perm: "保存",
      disabled: readOnly || !loaded款号 || isOrderMode,
      disabledTitle: readOnly ? "BOM已审核" : !loaded款号 ? "先打开货号" : isOrderMode ? "订单模式不可导入" : undefined,
      onClick: () => setImportOpen(true),
    },
    {
      key: "copy",
      label: "复制单",
      icon: Copy,
      perm: "保存",
      disabled: !loaded款号,
      disabledTitle: !loaded款号 ? "先打开货号" : undefined,
      onClick: () => {
        setCopyTarget("");
        setCopyOverwrite(false);
        setCopyOpen(true);
      },
    },
  ];
  const dangerActions: DocAction[] = [
    {
      key: "del",
      label: "删除",
      icon: Trash,
      perm: "删除",
      danger: true,
      disabled: readOnly || !loaded款号 || bomAudited,
      disabledTitle: !loaded款号 ? "先打开货号" : readOnly || bomAudited ? "BOM已审核" : undefined,
      onClick: () => setDelOpen(true),
    },
  ];
  // 审核动作:BOM 入口=BOM台头审核/申请BOM反审核;装配入口=调整审核 审核/反审核(对照老系统 toolbar 条件)
  const auditActions: DocAction[] = isAssembly
    ? !audited
      ? [
          {
            key: "asm-audit",
            label: "审核",
            icon: Check,
            perm: "审核",
            disabled: !loaded款号 || saving,
            disabledTitle: !loaded款号 ? "先打开货号" : undefined,
            onClick: () => void changeAssemblyAudit(),
          },
        ]
      : [
          {
            key: "asm-rev",
            label: "反审核",
            icon: X,
            perm: "反审核",
            disabled: saving,
            onClick: () => void changeAssemblyAudit(),
          },
        ]
    : !bomAudited
      ? [
          {
            key: "bom-audit",
            label: "BOM审核",
            icon: SealCheck,
            perm: "审核",
            disabled: !loaded款号 || saving,
            disabledTitle: !loaded款号 ? "先打开货号" : undefined,
            onClick: () => void changeBomAudit(),
          },
        ]
      : bomRevApplicant === null
        ? [
            {
              key: "bom-rev",
              label: "申请BOM反审核",
              icon: X,
              perm: "反审核",
              disabled: saving,
              onClick: () => {
                setBomRevReason("");
                setBomRevOpen(true);
              },
            },
          ]
        : [];
  const navActions: DocAction[] = [
    { key: "print", label: "打印", icon: Printer, onClick: () => window.print() },
    { key: "close", label: "关闭", icon: X, onClick: close },
  ];

  const gridRows = isOrderMode ? rows.filter(keepOrderRow) : rows;

  // 每列统一宽度 = 该列最长内容的视觉宽度(+3 余量),各行对齐不参差;
  // 封顶 CELL_CAP_CH:超过的字段截断显示,点击(聚焦)浮层完整展示
  // (不用 useMemo:无权限早退在上方,钩子不能放在其后;网格行数小,直算开销可忽略)
  const colCh: Record<string, number> = {
    物料编号: colWidthCh(gridRows.map((r) => r.物料编号)),
    物料名称: colWidthCh(gridRows.map((r) => r.物料名称 || "点右侧放大镜选择该货号物料")),
    工模编号: colWidthCh(gridRows.map((r) => r.工模编号)),
    规格: colWidthCh(gridRows.map((r) => r.规格)),
    材料: colWidthCh(gridRows.map((r) => r.材料)),
    颜色: colWidthCh(gridRows.map((r) => r.颜色)),
    备注: colWidthCh(gridRows.map((r) => r.备注)),
    单位: Math.min(Math.max(8, ...gridRows.map((r) => visualLen(r.单位))) + 6, CELL_CAP_CH),
  };

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      {/* 页头:标题 + 操作栏 */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          {pageTitle}
          {loaded款号 ? ` · ${loaded款号}` : "(新建)"}
        </h1>
        {isAssembly && audited && (
          <span className="rounded-full bg-[#059669]/10 px-3 py-1 text-sm font-medium text-[#059669]">
            已审核
          </span>
        )}
        {!isAssembly && bomAudited && bomRevApplicant !== null && (
          <span className="rounded-full bg-[#d97706]/10 px-3 py-1 text-sm font-medium text-[#d97706]">
            BOM反审核申请中{bomRevApplicant ? `(${bomRevApplicant})` : ""},待经理批准
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <DocToolbar actions={editActions} menuKey={MENU} />
          <DocToolbar actions={dangerActions} menuKey={MENU} />
          <DocToolbar actions={auditActions} menuKey={MENU} />
          <DocToolbar actions={navActions} menuKey={MENU} />
        </div>
      </div>

      {/* MA/实单 双版本切换(仅 BOM 入口;装配入口维持原单版,对照老系统 !isAssembly) */}
      {!isAssembly && (
        <div className="flex gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1 sm:w-fit">
          {(
            [
              ["MA", "MA 版(模板)"],
              ["实单", "实单版(关联 MA 勾选)"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                mode === v
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 单头卡 */}
      <div className="f-panel p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          <label className="block">
            <span className="f-label">客户</span>
            <div className="mt-1.5">
              <SearchSelect
                ariaLabel="客户"
                value={header.客户编号}
                options={customers
                  .filter((c) => c.客户编号)
                  .map((c) => ({ value: c.客户编号!, label: c.客户名称 ?? c.客户编号! }))}
                placeholder="选择客户(可选)"
                clearLabel="选择客户(可选)"
                disabled={readOnly}
                onChange={onCustomerChange}
              />
            </div>
          </label>
          <label className="relative block">
            <span className="f-label">产品货号</span>
            <input
              aria-label="产品货号"
              className="f-input f-input-slim mt-1.5"
              placeholder="直接录入或选择产品货号"
              value={header.产品货号}
              disabled={readOnly}
              onChange={(e) => {
                patchHeader({ 产品货号: e.target.value });
                setProdOpen(true);
              }}
              onFocus={() => setProdOpen(true)}
              onBlur={onProductBlur}
            />
            {prodOpen && productOptions.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
                {productOptions
                  .filter(
                    (s) =>
                      !header.产品货号.trim() ||
                      `${s.款号} ${s.款式 ?? ""}`
                        .toLowerCase()
                        .includes(header.产品货号.trim().toLowerCase()),
                  )
                  .slice(0, 50)
                  .map((s) => (
                    <button
                      key={s.款号}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.04]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setProdOpen(false);
                        void pickProduct(s.款号!);
                      }}
                    >
                      <span className="f-mono font-semibold">{s.款号}</span>
                      <span className="ml-2 text-[#5f6b7d]">{s.款式 ?? ""}</span>
                    </button>
                  ))}
              </div>
            )}
          </label>
          {isAssembly && (
            <label className="block">
              <span className="f-label">PO号</span>
              <SearchSelect
                ariaLabel="PO号"
                className="mt-1.5"
                value={header.PO号}
                options={poOptions.map((o) => ({ value: o.po, label: `${o.po}(${o.qty})` }))}
                placeholder="选择实单 PO 号(可选)"
                clearLabel="选择实单 PO 号(可选)"
                disabled={readOnly}
                onChange={onPoChange}
              />
            </label>
          )}
          <label className="block">
            <span className="f-label">产品名称</span>
            <input
              aria-label="产品名称"
              className="f-input f-input-slim mt-1.5"
              placeholder="由产品货号带出"
              maxLength={50}
              value={header.产品名称}
              disabled={readOnly}
              onChange={(e) => patchHeader({ 产品名称: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="f-label">日期</span>
            <input
              aria-label="日期"
              type="date"
              className="f-input f-input-slim mt-1.5"
              value={header.日期}
              disabled={readOnly}
              onChange={(e) => patchHeader({ 日期: e.target.value })}
            />
          </label>
          {isAssembly && (
            <label className="block">
              <span className="f-label">类别</span>
              <SearchSelect
                ariaLabel="类别"
                className="mt-1.5"
                value={header.类别}
                options={["未包装半成品", "半成品", "成品"].map((v) => ({ value: v, label: v }))}
                disabled={readOnly}
                onChange={(v) => patchExtension({ 类别: v })}
              />
            </label>
          )}
          {isAssembly && (
            <label className="block">
              <span className="f-label">数量</span>
              <input
                aria-label="数量"
                type="number"
                min={0}
                className="f-input f-input-slim mt-1.5"
                value={header.需求用量 ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  patchExtension({
                    需求用量: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          )}
          <label className="block">
            <span className="f-label">单位</span>
            <SearchSelect
              ariaLabel="单位"
              className="mt-1.5"
              value={header.单位}
              options={unitOptions(header.单位).map((u) => ({ value: u, label: u }))}
              disabled={readOnly}
              onChange={(v) =>
                // 装配模式单位属于扩展段(参与 hasExtensionData 标记;对照老系统 onValuesChange 名单)
                isAssembly ? patchExtension({ 单位: v }) : patchHeader({ 单位: v })
              }
            />
          </label>
          <label className="block">
            <span className="f-label">操作员</span>
            <input
              aria-label="操作员"
              className="f-input f-input-slim mt-1.5"
              value={header.操作员}
              disabled
            />
          </label>
          <label className="block">
            <span className="f-label">默认单价</span>
            <SearchSelect
              ariaLabel="默认单价"
              className="mt-1.5"
              value={header.默认单价}
              options={quoteCategories.map((c) => ({ value: c, label: c }))}
              placeholder="默认单价(HK)"
              clearLabel="默认单价(HK)"
              disabled={readOnly}
              onChange={(v) => patchHeader({ 默认单价: v })}
            />
          </label>
          <label className="block">
            <span className="f-label">类型</span>
            <SearchSelect
              ariaLabel="类型"
              className="mt-1.5"
              value={header.类型}
              options={[
                { value: "明细", label: "明细" },
                { value: "汇总", label: "汇总" },
              ]}
              disabled={readOnly}
              onChange={(v) => patchHeader({ 类型: v })}
            />
          </label>
          {/* 审核状态:BOM 入口=台头审核;装配入口=调整审核(页头徽标同源) */}
          <div>
            <span className="f-label">审核状态</span>
            <div className="mt-2.5">
              {(isAssembly ? audited : bomAudited) ? (
                <span className="rounded-full bg-[#059669]/10 px-3 py-1 text-sm font-medium text-[#059669]">
                  已审核
                </span>
              ) : (
                <span className="rounded-full bg-black/6 px-3 py-1 text-sm font-medium text-[#5f6b7d]">
                  未审核
                </span>
              )}
            </div>
          </div>
          <label className="col-span-2 block md:col-span-3">
            <span className="f-label">备注</span>
            <input
              aria-label="备注"
              className="f-input f-input-slim mt-1.5"
              value={header.备注}
              disabled={readOnly}
              onChange={(e) =>
                // 装配模式备注=扩展段 备注内容(对照老系统 onValuesChange 名单)
                isAssembly
                  ? patchExtension({ 备注: e.target.value })
                  : patchHeader({ 备注: e.target.value })
              }
            />
          </label>
        </div>
      </div>

      {/* 页签:物料明细 / 尺寸图片备注 */}
      <div className="flex gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1 sm:w-fit">
        {(
          [
            ["mat", "物料明细"],
            ["img", "尺寸图片备注"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={cn(
              "h-9 rounded-lg px-4 text-sm transition-colors",
              tab === v
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#5f6b7d] hover:text-[#3d4a5c]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "img" ? (
        <ImageNotesPanel
          模块="BOM"
          单号={loaded款号}
          canEdit={canSave}
          emptyHint="请先打开一个产品货号"
        />
      ) : (
        <div className="f-panel p-4">
          {/* 先选关联 MA 货号,再从它的半成品定义勾选进明细(MA 版/实单版/装配入口同位置;
              MA 版仅作勾半成品的依据,不随台头持久化 MA货号) */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="f-label">关联MA</span>
            <SearchSelect
              ariaLabel="关联MA"
              className="w-72"
              value={maNo}
              options={maOptions.map((no) => ({
                value: no,
                label: [no, bomHeaders.find((b) => (b.款号 ?? "").trim() === no)?.款式 ?? ""]
                  .filter(Boolean)
                  .join(" "),
              }))}
              placeholder="选择关联的 MA 货号(-MA 结尾且已建 BOM)"
              clearLabel="选择关联的 MA 货号(-MA 结尾且已建 BOM)"
              disabled={readOnly}
              onChange={setMaNo}
            />
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              disabled={readOnly || !maNo}
              onClick={openMaPick}
            >
              选半成品
            </button>
            {isOrderMode && (
              <button
                type="button"
                className="f-btn h-9 px-4 text-sm"
                disabled={readOnly}
                onClick={() => setMatPickOpen(true)}
              >
                选物料
              </button>
            )}
          </div>

          <div className="max-h-[52vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 1240 }}>
              <thead>
                <tr>
                  <th className={cn(pickerThCls)} style={{ width: 88 }}></th>
                  <th className={pickerThCls} style={{ width: 48 }}>
                    序号
                  </th>
                  {["物料编号", "物料名称", "工模编号", "规格", "材料", "颜色", "单位", "用量", "备注", ""].map(
                    (h, i) => (
                      <th key={i} className={pickerThCls}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((r, i) => {
                  const def = semiDefOf(r);
                  const expanded = expandedSemi.includes(r.key);
                  return [
                    <tr key={r.key} className="hover:bg-black/[0.02]">
                      <td className={cn(tdCls, "whitespace-nowrap")}>
                        {isOrderMode ? (
                          <span className="px-1 text-disabled">插入</span>
                        ) : (
                          <button
                            type="button"
                            className="px-1 text-[#1d4ed8] hover:underline"
                            disabled={readOnly}
                            onClick={() => insertRow(i)}
                          >
                            插入
                          </button>
                        )}
                        <button
                          type="button"
                          className="px-1 text-[#dc2626] hover:underline"
                          disabled={readOnly}
                          onClick={() => removeRow(r.key)}
                        >
                          删
                        </button>
                      </td>
                      <td className={cn(tdCls, "f-mono px-3")}>{i + 1}</td>
                      <td className={tdCls}>
                        <CellInput
                          ariaLabel={`行${i + 1} 物料编号`}
                          disabled={isOrderMode || readOnly}
                          value={r.物料编号}
                          widthCh={colCh.物料编号}
                          onChange={(v) => patch(r.key, { 物料编号: v })}
                        />
                      </td>
                      <td className={tdCls}>
                        {def ? (
                          // 半成品行:名称为链接,点击展开/收起该定义的组成物料
                          <button
                            type="button"
                            className="px-2 text-left font-medium text-[#1d4ed8] hover:underline"
                            onClick={() =>
                              setExpandedSemi((ks) =>
                                ks.includes(r.key)
                                  ? ks.filter((k) => k !== r.key)
                                  : [...ks, r.key],
                              )
                            }
                          >
                            {def.名称}
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="shrink-0">
                              <CellInput
                                ariaLabel={`行${i + 1} 物料名称`}
                                disabled={isOrderMode || readOnly}
                                placeholder="点右侧放大镜选择该货号物料"
                                value={r.物料名称}
                                widthCh={colCh.物料名称}
                                onChange={(v) => patch(r.key, { 物料名称: v })}
                              />
                            </div>
                            {!isOrderMode && (
                              <button
                                type="button"
                                aria-label={`行${i + 1} 选择物料`}
                                className="shrink-0 rounded-md p-1.5 text-[#5f6b7d] hover:bg-black/6"
                                onClick={() => openPicker(r.key)}
                              >
                                <MagnifyingGlass className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      {(
                        [
                          ["工模编号", "工模编号"],
                          ["规格", "规格"],
                          ["材料", "材料"],
                          ["颜色", "颜色"],
                        ] as const
                      ).map(([f, label]) => (
                        <td key={f} className={tdCls}>
                          <CellInput
                            ariaLabel={`行${i + 1} ${label}`}
                            disabled={isOrderMode || readOnly}
                            value={r[f]}
                            widthCh={colCh[f]}
                            onChange={(v) => patch(r.key, { [f]: v })}
                          />
                        </td>
                      ))}
                      <td className={tdCls}>
                        <SearchSelect
                          ariaLabel={`行${i + 1} 单位`}
                          style={{ width: `${colCh.单位}ch` }}
                          disabled={isOrderMode || readOnly}
                          value={r.单位}
                          options={unitOptions(r.单位).map((u) => ({ value: u, label: u }))}
                          placeholder=""
                          onChange={(v) => patch(r.key, { 单位: v })}
                        />
                      </td>                      <td className={tdCls}>
                        {/* 实单版:半成品行用量随定义只读;物料行(包材)用量可改 */}
                        <QtyInput
                          ariaLabel={`行${i + 1} 用量`}
                          disabled={readOnly || (isOrderMode && isSemiRow(r))}
                          value={r.用量}
                          onChange={(v) => patch(r.key, { 用量: v })}
                        />
                      </td>
                      <td className={tdCls}>
                        <CellInput
                          ariaLabel={`行${i + 1} 备注`}
                          disabled={readOnly || (isOrderMode && isSemiRow(r))}
                          value={r.备注}
                          widthCh={colCh.备注}
                          onChange={(v) => patch(r.key, { 备注: v })}
                        />
                      </td>
                      <td className={cn(tdCls, "px-2 whitespace-nowrap")}>
                        {/* 命中半成品定义的行标类型徽标(蓝);兜底半成品款号判定集 */}
                        {def ? (
                          <span className="rounded-full bg-[#2563eb]/10 px-2 py-0.5 text-xs font-medium text-[#2563eb]">
                            {def.类型}
                          </span>
                        ) : r.物料编号.trim() && semiSet.has(r.物料编号.trim()) ? (
                          <span className="rounded-full bg-[#2563eb]/10 px-2 py-0.5 text-xs font-medium text-[#2563eb]">
                            半成品
                          </span>
                        ) : null}
                      </td>
                    </tr>,
                    def && expanded ? (
                      <tr key={`${r.key}-x`}>
                        <td colSpan={12} className="border-t border-black/6 bg-black/[0.02] p-3">
                          <table className="w-full text-sm">
                            <thead>
                              <tr>
                                {["物料编号", "物料名称", "规格", "颜色", "单位", "使用数量"].map(
                                  (h) => (
                                    <th
                                      key={h}
                                      className="f-label px-2 py-1.5 text-left font-medium normal-case"
                                    >
                                      {h}
                                    </th>
                                  ),
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {def.明细.map((l, li) => (
                                <tr key={li} className="border-t border-black/6">
                                  <td className="f-mono px-2 py-1.5">{l.物料编号}</td>
                                  <td className="px-2 py-1.5">{l.物料名称 ?? ""}</td>
                                  <td className="px-2 py-1.5">{l.规格 ?? ""}</td>
                                  <td className="px-2 py-1.5">{l.颜色 ?? ""}</td>
                                  <td className="px-2 py-1.5">{l.单位 ?? ""}</td>
                                  <td className="f-mono px-2 py-1.5 text-right">
                                    {l.使用数量 ?? ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
          {!isOrderMode && (
            <button
              type="button"
              className="f-btn mt-3 h-9 px-4 text-sm"
              disabled={readOnly}
              onClick={addRow}
            >
              <Plus className="h-4 w-4" />
              添加行
            </button>
          )}
        </div>
      )}

      {/* 半成品设置:仅 BOM 入口 MA 版显示(实单版只能从关联 MA 勾选;装配入口只做勾选,不定义半成品);新建未保存时也显示 */}
      {!isOrderMode && !isAssembly && tab === "mat" && (loaded款号 || header.产品货号.trim()) && (
        <BomSetupSemiPanel
          货号={loaded款号 || header.产品货号.trim()}
          物料行={rows}
          canEdit={canSave}
          onDefsChange={setSemiDefs}
          onSemiSaved={appendSemiRow}
          onSemiUsage={syncSemiUsage}
        />
      )}

      {/* 打开产品货号 */}
      <PickerDialog
        open={openDlg}
        onClose={() => setOpenDlg(false)}
        title="打开产品货号"
        width="sm:max-w-[680px]"
      >
        <div className="mb-3 flex gap-2">
          <input
            aria-label="搜索产品货号"
            className="f-input f-input-slim"
            placeholder="搜索产品货号/产品名称"
            value={openKw}
            onChange={(e) => setOpenKw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void loadOpenList(openKw)}
          />
          <button
            type="button"
            className="f-btn h-9 shrink-0 px-4 text-sm"
            onClick={() => void loadOpenList(openKw)}
          >
            搜索
          </button>
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={pickerThCls}>产品货号</th>
                <th className={pickerThCls}>产品名称</th>
              </tr>
            </thead>
            <tbody>
              {openRows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-8 text-center text-disabled">
                    {openLoading ? "加载中..." : "暂无数据"}
                  </td>
                </tr>
              ) : (
                openRows.map((r) => (
                  <tr
                    key={r.id ?? r.ID ?? r.款号}
                    className="cursor-pointer border-b border-black/6 hover:bg-black/[0.04]"
                    onClick={() => r.款号 && void loadDoc(r.款号)}
                  >
                    <td className="f-mono px-3 py-2 font-semibold text-[#1d4ed8]">{r.款号}</td>
                    <td className="px-3 py-2">{r.款式 ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PickerDialog>

      {/* 复制单 */}
      <PickerDialog
        open={copyOpen}
        onClose={() => {
          setCopyOpen(false);
          setCopyOverwrite(false);
        }}
        title={`复制单 · ${loaded款号}`}
        width="sm:max-w-[480px]"
        footer={
          <>
            <button
              type="button"
              className="f-btn h-10 px-4"
              onClick={() => {
                setCopyOpen(false);
                setCopyOverwrite(false);
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={copying || !copyTarget.trim()}
              onClick={() => void doCopy(false)}
            >
              复制
            </button>
          </>
        }
      >
        <label className="block">
          <span className="f-label">目标产品货号</span>
          <SearchSelect
            ariaLabel="目标产品货号"
            className="mt-1.5"
            value={copyTarget}
            options={productOptions
              .filter((s) => s.款号 && s.款号 !== loaded款号)
              .map((s) => ({
                value: s.款号 as string,
                label: [s.款号, s.款式 ?? ""].filter(Boolean).join(" "),
              }))}
            placeholder="选择目标产品货号"
            clearLabel="选择目标产品货号"
            onChange={setCopyTarget}
          />
        </label>
      </PickerDialog>

      {/* 目标已有 BOM 的覆盖确认(409) */}
      <ConfirmDialog
        open={copyOverwrite}
        onClose={() => setCopyOverwrite(false)}
        title="目标货号已有 BOM"
        description={`${copyTarget} 已有 BOM 物料明细,确认覆盖?`}
        confirmLabel="覆盖"
        onConfirm={() => {
          setCopyOverwrite(false);
          void doCopy(true);
        }}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={`确认删除产品货号 ${loaded款号 || header.产品货号} 的整张 BOM(台头+明细)?`}
        description={bomAudited ? "BOM 已审核,请先反审核再删除" : undefined}
        onConfirm={() => {
          setDelOpen(false);
          void del();
        }}
      />

      {/* 保存后的重复扣料风险提示(不阻止) */}
      <PickerDialog
        open={warnList !== null}
        onClose={() => setWarnList(null)}
        title="已保存,但存在重复扣料风险"
        width="sm:max-w-[520px]"
        footer={
          <button type="button" className="f-btn f-btn-cyan h-10 px-4" onClick={() => setWarnList(null)}>
            知道了
          </button>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-[15px] text-[#3d4a5c]">
          {(warnList ?? []).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </PickerDialog>

      {/* 申请BOM反审核:必填原因,经理在消息中心批准/拒绝 */}
      <PickerDialog
        open={bomRevOpen}
        onClose={() => setBomRevOpen(false)}
        title={`申请BOM反审核 ${loaded款号 || header.产品货号}`}
        width="sm:max-w-[520px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setBomRevOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={saving || !bomRevReason.trim()}
              onClick={() => void submitBomReverseRequest()}
            >
              提交申请
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-[#5f6b7d]">
          BOM反审核需经理批准后才能生效,批准后 BOM 一步到位回到未审核状态,可修改后重新审核。
        </p>
        <textarea
          aria-label="反审核原因"
          rows={3}
          className="f-input h-auto w-full py-2"
          placeholder="请填写反审核原因(必填)"
          value={bomRevReason}
          onChange={(e) => setBomRevReason(e.target.value)}
        />
      </PickerDialog>

      {/* 选择该货号的物料/下级半成品 */}
      <PickerDialog
        open={pickRowKey != null}
        onClose={() => {
          setPickRowKey(null);
          setPickSelected([]);
        }}
        title="选择该货号的物料/下级半成品"
        width="sm:max-w-[980px]"
        footer={
          pickTab === "material" ? (
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={!pickSelected.length}
              onClick={choosePickMulti}
            >
              多选加入{pickSelected.length ? `(${pickSelected.length})` : ""}
            </button>
          ) : undefined
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            aria-label="搜索物料"
            className="f-input f-input-slim w-80"
            placeholder="搜索物料编号/物料名称/规格"
            value={pickKw}
            onChange={(e) => setPickKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pickTab === "material") void loadPickList(pickKw);
            }}
          />
          {pickTab === "material" && (
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              onClick={() => void loadPickList(pickKw)}
            >
              搜索
            </button>
          )}
          <div className="ml-auto flex gap-1 rounded-lg border border-black/8 bg-black/[0.03] p-0.5">
            {(
              [
                ["material", "物料"],
                ["semi", "半成品"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setPickTab(v)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm transition-colors",
                  pickTab === v
                    ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                    : "text-[#5f6b7d]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          {pickTab === "material" ? (
            <table className="w-full text-sm" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th className={pickerThCls} style={{ width: 40 }}></th>
                  {["款号", "物料编号", "工模编号", "物料名称", "规格", "材料", "颜色", "单位", "用量", "备注"].map(
                    (h) => (
                      <th key={h} className={pickerThCls}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pickRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-disabled">
                      {pickLoading ? "加载中..." : "该货号暂无物料档案/ BOM 物料"}
                    </td>
                  </tr>
                ) : (
                  pickRows.map((m, i) => (
                    <tr
                      key={`${m.物料编号 ?? ""}|${m.物料名称 ?? ""}|${m.规格 ?? ""}`}
                      className="cursor-pointer border-b border-black/6 hover:bg-black/[0.04]"
                      onClick={() => choosePick(m)}
                    >
                      <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`勾选 ${m.物料编号 ?? i}`}
                          className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                          checked={pickSelected.includes(i)}
                          onCheckedChange={(v) =>
                            setPickSelected((xs) =>
                              v === true ? [...xs, i] : xs.filter((x) => x !== i),
                            )
                          }
                        />
                      </td>
                      <td className="f-mono px-2 py-1.5">{m.款号 ?? ""}</td>
                      <td className="f-mono px-2 py-1.5 font-semibold text-[#1d4ed8]">
                        {m.物料编号 ?? ""}
                      </td>
                      <td className="px-2 py-1.5">{m.工模编号 ?? ""}</td>
                      <td className="px-2 py-1.5">{m.物料名称 ?? ""}</td>
                      <td className="px-2 py-1.5">{m.规格 ?? ""}</td>
                      <td className="px-2 py-1.5">{m.材料 ?? m.物料类别 ?? ""}</td>
                      <td className="px-2 py-1.5">{m.颜色 ?? ""}</td>
                      <td className="px-2 py-1.5">{m.单位 ?? ""}</td>
                      <td className="f-mono px-2 py-1.5 text-right">
                        {formatQty(m.使用数量 ?? m.用量 ?? null)}
                      </td>
                      <td className="px-2 py-1.5">{m.备注 ?? ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["半成品款号", "产品名称", "类别", "需求用量", "单位"].map((h) => (
                    <th key={h} className={pickerThCls}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSemiOptions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-disabled">
                      尚无已设置的半成品款号
                    </td>
                  </tr>
                ) : (
                  filteredSemiOptions.map((s) => (
                    <tr
                      key={s.款号}
                      className="cursor-pointer border-b border-black/6 hover:bg-black/[0.04]"
                      onClick={() => chooseSemi(s)}
                    >
                      <td className="f-mono px-3 py-2 font-semibold text-[#1d4ed8]">{s.款号}</td>
                      <td className="px-3 py-2">{s.款式 ?? ""}</td>
                      <td className="px-3 py-2">
                        {s.类别 ? (
                          <span className="rounded-full bg-[#2563eb]/10 px-2 py-0.5 text-xs font-medium text-[#2563eb]">
                            {s.类别}
                          </span>
                        ) : null}
                      </td>
                      <td className="f-mono px-3 py-2 text-right">{s.需求用量 ?? ""}</td>
                      <td className="px-3 py-2">{s.单位 ?? ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </PickerDialog>

      {/* 实单版:从关联 MA 勾选半成品定义 */}
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
              onClick={confirmMaPick}
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

      {/* 实单版:选物料(包材等;物料资料+塑胶物料资料,按货号前缀过滤含共用料;多选一次入行) */}
      <MaterialMasterPickDialog
        open={matPickOpen}
        multi
        货号={货号前缀(maNo || header.产品货号)}
        onPickMany={chooseOrderMaterials}
        onClose={() => setMatPickOpen(false)}
      />

      <BomSetupImportDialog
        open={importOpen}
        款号={loaded款号}
        onClose={() => setImportOpen(false)}
        onApply={applyImport}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
