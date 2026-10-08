// 塑胶采购订单(/plastic-purchase-orders;塑胶仓,三级流转:主管审核 -> 经理审核 -> 审核=下发)。
// 对照老系统 web/src/pages/plastics/PlasticPurchaseOrderPage.tsx + PlasticPurchaseOrderLineTable.tsx:
// 单头(供应商选择/日期/交货日期/客户/交货地点/编号/加工类型/加工内容/备注)+ 明细编辑网格(保真列序)
// + 物料清单(合并) + 数量合计;喷油供应商(名称含「喷油」)只下印喷类物料且 加工内容 必填;
// 一次加工(不选加工内容)=啤机订单,二次加工必须选工序;保存时同模啤数不齐弹堵模提示(可补齐);
// 打印按次数/工序区分:啤机单 -> 啤机部生产啤货表,选了工序的加工单 -> 委托加工合同;
// 已审核单只读,未审核可整单更新;已审核单可「下推入仓」(/plastic-receipts?ppo=,MENU_PATHS 裁决);?单号= 直开。
// 权限菜单=塑胶采购订单(MenuCatalog.cs:46 实证:塑胶采购组)。
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowCounterClockwise,
  ArrowRight,
  CheckCircle,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Plus,
  Printer,
  Trash,
} from "@phosphor-icons/react";
import { plasticPurchaseOrderApi } from "@/api/endpoints";
import type {
  PlasticMaterialRow,
  PlasticPurchaseOrderHeader,
  ProductionTrackingRow,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { MENU_PATHS } from "@/nav/menu";
import {
  applyMoldBalance,
  detailToLine,
  filterSubmitLines,
  display加工类型,
  is喷油供应商,
  lineRawKg,
  mergeLines,
  mergeProcessContents,
  mergeRawMaterials,
  moldGroups,
  owedStatus,
  shotsOf,
  toSubmitLine,
  type MoldGroup,
  type PpoEditLine,
} from "@/lib/plasticPurchase";
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
import { MoldGroupPanel } from "@/components/doc/MoldGroupPanel";
import { SearchSelect } from "@/components/doc/SearchSelect";
import PlasticPurchaseOrderDrawer from "./PlasticPurchaseOrderDrawer";

const MENU = "塑胶采购订单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const today = () => new Date().toISOString().slice(0, 10); // ISO:后端 DateTime 反序列化要求

let rowSeq = 1;
const uid = () => rowSeq++;

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";
// 只读格(物料名称/啤数/加工内容/已入仓/欠数等)与输入框同高同距同边框 —— 整行每格都是框,Excel 一样齐
// overflow-hidden:内容超宽裁剪在框内(配 truncate),不外溢盖住相邻列
const cellBoxCls =
  "flex h-8 w-full items-center overflow-hidden rounded-md border border-black/10 bg-black/[0.02] px-2 text-sm text-[#3d4a5c]";

// ---------- 单头表单状态 ----------
interface HeaderFormState {
  供应商编号: string;
  供应商名称: string;
  交货日期: string;
  客户名称: string;
  交货地点: string;
  编号: string; // PO号(客户合同号)
  加工类型: string;
  加工内容: string;
  备注: string;
}
const emptyHeader = (): HeaderFormState => ({
  供应商编号: "",
  供应商名称: "",
  交货日期: "",
  客户名称: "",
  交货地点: "",
  编号: "",
  加工类型: "一次加工",
  加工内容: "",
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

// 欠数状态单元格(对照老系统 owedStatus:欠 N 红/超收 N 橙/已完成 绿;无数据留空)
// whitespace-nowrap:「欠 100000」必须一行显示,列窄也不折行
function OwedCell({ v }: { v?: number | null }) {
  const s = owedStatus(v);
  if (!s) return null;
  if (s.kind === "欠")
    return <span className="f-mono font-bold whitespace-nowrap text-[#dc2626]">欠&nbsp;{s.value}</span>;
  if (s.kind === "超收")
    return <span className="f-mono font-bold whitespace-nowrap text-[#b45309]">超收&nbsp;{s.value}</span>;
  return <span className="f-mono font-bold whitespace-nowrap text-[#15803d]">已完成</span>;
}

// 原料扣减单元格(啤机下单自动扣原料):用量KG=数量×单件克重/1000,后缀原料名称;无原料关联留空
// min-w-0:内容超宽时允许收缩,让原料名称 truncate 生效;否则整体向左溢出盖住前一列(实测溢出 34px)
function RawKgCell({ l }: { l: PpoEditLine }) {
  const kg = lineRawKg(l);
  if (kg == null || !l.原料编号) return null;
  const tip = `${l.原料名称 ?? l.原料编号} · 单件 ${l.单件克重 ?? "?"}g${
    l.原料库存 != null ? ` · 原料库存 ${fmtNum(l.原料库存, 2)}KG` : ""
  }`;
  return (
    <span title={tip} className="flex min-w-0 items-baseline justify-end gap-1 whitespace-nowrap">
      <span className="f-mono shrink-0 text-[#1a2330]">{kg.toFixed(2)}</span>
      <span className="min-w-0 truncate text-xs font-normal text-[#5f6b7d]">{l.原料名称 ?? ""}</span>
    </span>
  );
}

// 啤数单元格(同模分组·堵模):啤数=ceil(数量/出模数);同模需求不齐时标「N啤后堵」橙徽标
function ShotsCell({ l, block }: { l: PpoEditLine; block?: { 啤数: number; 共啤数: number } }) {
  const shots = shotsOf(l.数量, l.出模数);
  if (shots == null) return null;
  return (
    <span className="flex items-center justify-end gap-1 whitespace-nowrap">
      {block && (
        <span
          title={`与同模其他配件需求不齐:本件第 ${block.啤数} 啤先啤够,之后堵模;全模共 ${block.共啤数} 啤`}
          className="shrink-0 rounded-full bg-[#d97706]/10 px-1.5 py-0.5 text-xs font-medium text-[#d97706]"
        >
          {block.啤数}啤后堵
        </span>
      )}
      <span className="f-mono text-[#1a2330]">{shots}</span>
    </span>
  );
}

// ---------- 单据列表弹窗列(对照老系统 listColumns) ----------
const openCol = createColumnHelper<PlasticPurchaseOrderHeader>();

function statusTag(row: PlasticPurchaseOrderHeader) {
  if (row.审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
        已审核
      </span>
    );
  if (row.经理审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#2563eb]/50 bg-[#2563eb]/10 px-2.5 py-1 text-xs font-semibold text-[#2563eb]">
        经理已审{row.经理审核人 ? `(${row.经理审核人})` : ""}
      </span>
    );
  if (row.主管审核 === "1")
    return (
      <span className="inline-flex rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2.5 py-1 text-xs font-semibold text-[#b45309]">
        主管已审{row.主管审核人 ? `(${row.主管审核人})` : ""}
      </span>
    );
  return (
    <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
      未审核
    </span>
  );
}

const listColumns: ColumnDef<PlasticPurchaseOrderHeader, any>[] = [
  openCol.accessor("单号", {
    header: "单号",
    size: 19,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  openCol.accessor("供应商名称", { header: "供应商", size: 14 }),
  openCol.accessor("加工内容", {
    header: "加工内容",
    size: 9,
    cell: (c) => c.getValue() ?? "",
  }),
  openCol.accessor("加工类型", {
    header: "加工类型",
    size: 12,
    cell: (c) => {
      const v = display加工类型(c.getValue(), c.row.original.加工内容);
      return v === "二次加工" ? (
        <span className="inline-flex rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2.5 py-1 text-xs font-semibold text-[#b45309]">
          二次加工
        </span>
      ) : (
        v
      );
    },
  }),
  openCol.accessor("客户名称", { header: "客户", size: 12 }),
  openCol.accessor("数量", {
    header: "数量",
    size: 14,
    cell: (c) => fmtNum(c.getValue(), 0),
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
  }),
  openCol.accessor("日期", {
    header: "日期",
    size: 15,
    cell: (c) => fmtDate(c.getValue()),
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
  }),
  openCol.display({
    id: "状态",
    header: "状态",
    size: 14,
    cell: (c) => statusTag(c.row.original),
    meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
  }),
];

export default function PlasticPurchaseOrderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currentUser = getUser() || "用户";

  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [openedAudit, setOpenedAudit] = useState(false); // 打开的单据是否已审核(已审核只读)
  const [form, setFormState] = useState<HeaderFormState>(emptyHeader);
  const [lines, setLines] = useState<PpoEditLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);
  const [materialPickFor, setMaterialPickFor] = useState<number | null>(null);
  const [secondOpen, setSecondOpen] = useState(false); // 二次加工下单抽屉(按库存选料)
  // 保存时同模需求不齐(堵模)提示:取消=允许堵模直接保存;确认=按同模最大啤数补齐后保存
  const [moldFixGroups, setMoldFixGroups] = useState<MoldGroup[] | null>(null);
  // 堵模弹窗「确认」路径已自行保存,弹窗关闭时 onClose 不再重复提交
  const moldConfirmed = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 加工内容下拉选项(接口值并上固定集合;对照老系统)
  const contentsQuery = useQuery({
    queryKey: ["ppo", "processing-contents"],
    queryFn: () => plasticPurchaseOrderApi.processingContents(),
  });
  const 加工内容选项 = mergeProcessContents(contentsQuery.data ?? []);

  // 首次进入自动打开最新一单
  const firstQuery = useQuery({
    queryKey: ["ppo", "first"],
    queryFn: () => plasticPurchaseOrderApi.list(1, 1, ""),
  });
  useFirstDoc(firstQuery.data, firstQuery.data?.items[0]?.单号, mode === "view" && !单号, set单号);

  const detailQuery = useQuery({
    queryKey: ["ppo", "detail", 单号],
    queryFn: () => plasticPurchaseOrderApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["ppo", "list", page, keyword],
    queryFn: () => plasticPurchaseOrderApi.list(page, 10, keyword || undefined),
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 10)) : 1;

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const readOnly = isView && openedAudit;

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));
  const patchRow = (key: number, patch: Partial<PpoEditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeRow = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));

  const reset = () => {
    setMode("new");
    set单号(null);
    setOpenedAudit(false);
    setFormState(emptyHeader());
    setLines([]);
  };

  // 打开单据填入表单(查看/编辑态;对照老系统 openDoc)
  const fillFromDetail = (h: PlasticPurchaseOrderHeader) => {
    setFormState({
      供应商编号: h.供应商编号 ?? "",
      供应商名称: h.供应商名称 ?? "",
      交货日期: h.交货日期 ? String(h.交货日期).slice(0, 10) : "",
      客户名称: h.客户名称 ?? "",
      交货地点: h.交货地点 ?? "",
      编号: h.编号 ?? "",
      加工类型: h.加工类型 ?? "一次加工",
      加工内容: h.加工内容 ?? "",
      备注: h.备注 ?? "",
    });
  };
  useEffect(() => {
    if (mode !== "view" || !detail?.单头) return;
    fillFromDetail(detail.单头);
    setLines((detail.明细 ?? []).map((l, i) => detailToLine(l, i + 1)));
    setOpenedAudit(detail.单头.审核 === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, mode]);

  // URL ?单号= 直开(塑胶订单进度表/双击跳单入口;消费后清参数)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const no = searchParams.get("单号");
    if (!no) return;
    setSearchParams({}, { replace: true });
    setMode("view");
    set单号(no);
    void qc.invalidateQueries({ queryKey: ["ppo", "detail", no] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  // 喷油下单(供应商名含「喷油」):单头 加工内容 必填
  const 喷油供应商 = is喷油供应商(form.供应商名称);
  // 啤机单(未选加工内容的一次加工)才消耗原料:原料用量KG列+原料扣减汇总面板只在啤机单显示
  const 啤机单 = display加工类型(form.加工类型, form.加工内容) === "啤机";

  // ---------- 保存(新建=POST;已打开未审核=PUT 整单更新;已审核只读) ----------
  // doSave=校验+堵模检查;submitSave=过滤+提交(linesToSave 可能被堵模弹窗补齐过)
  const submitSave = async (linesToSave: PpoEditLine[]) => {
    const 二次加工单 = form.加工类型 === "二次加工";
    const { kept, dropped喷油, dropped加工 } = filterSubmitLines(linesToSave, {
      喷油单: 喷油供应商,
      加工内容: form.加工内容,
      二次加工: 二次加工单,
    });
    if (dropped喷油 > 0)
      setToast({
        text: `喷油部只收印喷类物料:已剔除 ${dropped喷油} 行加工内容不含「喷/印」的明细`,
        tone: "err",
      });
    if (dropped加工 > 0)
      setToast({
        text: `已剔除 ${dropped加工} 行加工内容不是「${form.加工内容}」的明细`,
        tone: "err",
      });
    if (kept.length === 0) {
      setToast({
        text: 喷油供应商
          ? "喷油部订单没有可下单的印喷类物料(塑胶物料资料.加工内容 未标「喷油/移印」)"
          : "请至少录入一行有效物料明细(物料编号+数量)",
        tone: "err",
      });
      return;
    }
    const body = {
      供应商编号: form.供应商编号.trim() || undefined,
      供应商名称: form.供应商名称.trim() || undefined,
      客户名称: form.客户名称.trim() || undefined,
      交货地点: form.交货地点.trim() || undefined,
      交货日期: form.交货日期 || null,
      编号: form.编号.trim() || undefined,
      备注: form.备注.trim() || undefined,
      加工内容: form.加工内容 || undefined,
      加工类型: form.加工类型,
      明细: kept.map((l) =>
        toSubmitLine(
          // 二次加工:行级没有加工内容,把单头选的工序落到每行,入仓后工序快照有据可查
          二次加工单 ? { ...l, 加工内容: form.加工内容 || l.加工内容 } : l,
        ),
      ),
    };
    setSaving(true);
    try {
      if (单号 && mode === "view") {
        await plasticPurchaseOrderApi.update(单号, body);
        setToast({ text: "已保存修改", tone: "ok" });
        void qc.invalidateQueries({ queryKey: ["ppo"] });
      } else {
        const r = await plasticPurchaseOrderApi.create(body);
        setToast({ text: `塑胶采购订单已创建:${r.单号}`, tone: "ok" });
        setMode("view");
        set单号(r.单号);
        void qc.invalidateQueries({ queryKey: ["ppo"] });
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const doSave = async () => {
    if (readOnly) {
      setToast({ text: "已审核单据为只读:请先「反审核」再修改", tone: "err" });
      return;
    }
    if (!form.供应商名称.trim()) {
      setToast({ text: "请选供应商", tone: "err" });
      return;
    }
    if (喷油供应商 && !form.加工内容) {
      setToast({ text: "喷油加工订单必须选择加工内容", tone: "err" });
      return;
    }
    // 一次加工(不选加工内容)=啤机订单;选二次加工必须同时选工序(喷油/印喷/电镀等)
    if (form.加工类型 === "二次加工" && !form.加工内容) {
      setToast({ text: "二次加工必须选择加工内容(喷油/印喷等工序)", tone: "err" });
      return;
    }
    // 堵模检查(仅啤机单):同模配件啤数不齐 → 弹窗选「允许堵模直接保存」或「按最大啤数补齐并保存」
    if (啤机单) {
      const ub = moldGroups(lines).filter((g) => g.不平衡);
      if (ub.length > 0) {
        setMoldFixGroups(ub);
        return;
      }
    }
    await submitSave(lines);
  };

  // ---------- 审核流转(主管 -> 经理 -> 审核=下发) / 反审核 / 删除 ----------
  // 审核/反审核返回 {警告}(如排产推送失败)时用警告提示,否则维持原成功提示
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      const r = (await fn()) as { 警告?: string } | undefined;
      if (r?.警告) setToast({ text: r.警告, tone: "err" });
      else setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        setMode("view");
        void qc.invalidateQueries({ queryKey: ["ppo"] });
      } else {
        await detailQuery.refetch();
        void qc.invalidateQueries({ queryKey: ["ppo", "list"] });
        void qc.invalidateQueries({ queryKey: ["ppo", "first"] });
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  // ---------- 打印:系统内打印预览页(标签页打开;模板按次数/工序裁决:啤机单→啤货表,选了工序的加工单→委托加工合同) ----------
  const doPrint = () => {
    if (!单号) {
      setToast({ text: "请先打开或保存一张塑胶采购订单再打印", tone: "err" });
      return;
    }
    // doc 而不是 单号:单据页(keep-alive 挂载)会消费并清掉 ?单号=,独立参数名防误吃
    navigate(`/plastic-purchase-order-print?doc=${encodeURIComponent(单号)}`);
  };

  // 下推入仓(已审核):跳塑胶入仓单 ?ppo=(MENU_PATHS 裁决,不静默断链)
  const pushReceipt = () => {
    if (!单号) return;
    if (!MENU_PATHS.has("/plastic-receipts")) {
      setToast({ text: `塑胶入仓单页未注册,请记下采购单号:${单号}`, tone: "err" });
      return;
    }
    navigate(`/plastic-receipts?ppo=${encodeURIComponent(单号)}`);
  };

  // ---------- 工具条 ----------
  const isAudited = header?.审核 === "1";
  const 主管已审 = header?.主管审核 === "1";
  const 经理已审 = header?.经理审核 === "1";

  // 加工下单按钮:打开啤机单(未选加工内容)→一次加工下单;打开一次加工单→二次加工下单
  // (一次加工完且物料入仓后才有可二次加工库存);打开二次加工单→不再往下;新建态默认一次加工下单
  const opened加工类型 = isView && header ? display加工类型(header.加工类型, header.加工内容) : null;
  const 下单类型 = opened加工类型 === "一次加工" ? "二次加工" : "一次加工";
  const show加工下单 = !isView || opened加工类型 !== "二次加工";

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, onClick: () => setDialogOpen(true) },
    ...(!readOnly
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
    ...(show加工下单
      ? [{ key: "second", label: `${下单类型}下单`, icon: Plus, onClick: () => setSecondOpen(true) }]
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
    ...(isView && !isAudited && !主管已审
      ? [
          {
            key: "sup",
            label: "主管审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(() => plasticPurchaseOrderApi.supervisorApprove(单号!), "主管已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && 主管已审 && !经理已审
      ? [
          {
            key: "mgr",
            label: "经理审核",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () =>
              void act(() => plasticPurchaseOrderApi.managerApprove(单号!), "经理已审核", "reload"),
          },
        ]
      : []),
    ...(isView && !isAudited && 经理已审
      ? [
          {
            key: "audit",
            label: "审核(下发)",
            icon: CheckCircle,
            perm: "审核" as const,
            success: true,
            onClick: () => void act(() => plasticPurchaseOrderApi.approve(单号!), "已审核", "reload"),
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
            onClick: () => void act(() => plasticPurchaseOrderApi.unapprove(单号!), "已反审核", "reload"),
          },
          {
            key: "push",
            label: "下推入仓",
            icon: ArrowRight,
            success: true as const,
            onClick: pushReceipt,
          },
        ]
      : []),
  ];
  const printActions: DocAction[] =
    isView || 单号
      ? [{ key: "print", label: "打印", icon: Printer, perm: "打印", onClick: () => void doPrint() }]
      : [];

  // ---------- 查看态单头卡 ----------
  const mainFields: HeaderField[] = header
    ? [
        { label: "单号", value: txt(header.单号), mono: true, strong: true },
        { label: "供应商", value: txt(header.供应商名称), mono: true },
        { label: "日期", value: fmtDate(header.日期), mono: true },
        { label: "交货日期", value: fmtDate(header.交货日期), mono: true },
        { label: "数量", value: fmtNum(header.数量, 0), mono: true, strong: true },
        { label: "加工类型", value: txt(display加工类型(header.加工类型, header.加工内容)), mono: true },
        { label: "加工内容", value: txt(header.加工内容), mono: true },
        { label: "编号", value: txt(header.编号), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "客户名称", value: txt(header.客户名称), mono: true },
        { label: "交货地点", value: txt(header.交货地点), mono: true },
        { label: "供应商编号", value: txt(header.供应商编号), mono: true },
        { label: "主管审核人", value: txt(header.主管审核人), mono: true },
        { label: "经理审核人", value: txt(header.经理审核人), mono: true },
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "操作员", value: txt(header.操作员), mono: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];

  const 数量合计 = lines.reduce((s, l) => s + (Number(l.数量) || 0), 0);
  const mergeRows = mergeLines(lines);
  // 原料扣减汇总(啤机下单自动扣原料):按原料编号合并,扣后剩余=原料实时库存−扣减KG
  const rawSumRows = mergeRawMaterials(lines);
  // 同模分组(堵模):按模具编号分组算啤数;blockedByKey=先啤够要堵模的行(啤数<同模共啤数)
  const moldGroupRows = moldGroups(lines);
  const blockedByKey = new Map<number, { 啤数: number; 共啤数: number }>();
  for (const g of moldGroupRows)
    if (g.不平衡 && g.共啤数 != null)
      for (const gl of g.lines)
        if (gl.啤数 != null && gl.啤数 < g.共啤数)
          blockedByKey.set(gl.key, { 啤数: gl.啤数, 共啤数: g.共啤数 });

  // 三级流转步骤:未审核 -> 主管已审 -> 经理已审 -> 已审核(已下发)
  const flowCurrent = isAudited ? 3 : 经理已审 ? 2 : 主管已审 ? 1 : 0;

  // 明细列(保真列序:生产单号|款号|物料编号|物料名称|模具编号|用量|套数|数量|啤数|颜色|色粉号|用料名称|原料用量KG(仅啤机单)|加工内容|备注|已入仓|欠数|删除)
  // table-fixed 固定列宽:w-full 输入框无固有宽度,自动布局会把列压到表头文字宽导致内容截断;
  // 每列给足宽度,表头与单元格严格对齐,超宽走面板横向滚动
  const headCells: { label: string; w: number; num?: boolean }[] = [
    { label: "生产单号", w: 200 },
    { label: "款号", w: 120 },
    { label: "物料编号", w: 200 },
    { label: "物料名称", w: 150 },
    { label: "模具编号", w: 150 },
    { label: "用量", w: 80, num: true },
    { label: "套数", w: 80, num: true },
    { label: "数量", w: 110, num: true },
    { label: "啤数", w: 110, num: true },
    { label: "颜色", w: 150 },
    { label: "色粉号", w: 90 },
    { label: "用料名称", w: 150 },
    ...(啤机单 ? [{ label: "原料用量KG", w: 140, num: true }] : []),
    { label: "加工内容", w: 100 },
    { label: "备注", w: 140 },
    { label: "已入仓", w: 90, num: true },
    { label: "欠数", w: 110, num: true },
    ...(readOnly ? [] : [{ label: "", w: 64 }]),
  ];
  const gridWidth = headCells.reduce((a, c) => a + c.w, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          塑胶采购订单
          {isView ? (readOnly ? ` · ${header?.单号}(查看)` : ` · ${header?.单号}(编辑)`) : "(新建)"}
        </h1>
        {isView && statusTag(header!)}
        <div className="ml-auto">
          <FlowSteps
            steps={["开单", "主管审核", "经理审核", "审核下发"]}
            current={flowCurrent}
          />
        </div>
      </div>

      {/* 操作栏 */}
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

      {/* 单头:可编辑表单(已审核只读) */}
      {isView && readOnly ? (
        <DocHeaderCard fields={mainFields} extra={extraFields} />
      ) : (
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
                <span className="absolute top-1/2 right-16 -translate-y-1/2 text-[#dc2626]">*</span>
              </div>
            </FormField>
            <FormField label="日期">
              <Input
                className={inputCls}
                aria-label="日期"
                value={isView && header?.日期 ? fmtDate(header.日期) : today()}
                disabled
              />
            </FormField>
            <FormField label="交货日期">
              <input
                type="date"
                aria-label="交货日期"
                className="f-input w-full"
                value={form.交货日期}
                onChange={(e) => setForm({ 交货日期: e.target.value })}
              />
            </FormField>
            <FormField label="客户名称">
              <Input
                className={inputCls}
                aria-label="客户名称"
                value={form.客户名称}
                onChange={(e) => setForm({ 客户名称: e.target.value })}
              />
            </FormField>
            <FormField label="交货地点">
              <Input
                className={inputCls}
                aria-label="交货地点"
                value={form.交货地点}
                onChange={(e) => setForm({ 交货地点: e.target.value })}
              />
            </FormField>
            <FormField label="编号">
              <Input
                className={inputCls}
                aria-label="编号"
                value={form.编号}
                onChange={(e) => setForm({ 编号: e.target.value })}
              />
            </FormField>
            <FormField label="加工类型">
              <SearchSelect
                ariaLabel="加工类型"
                className={cn(inputCls, "rounded-md border")}
                value={form.加工类型}
                options={["一次加工", "二次加工"].map((v) => ({ value: v, label: v }))}
                onChange={(v) => setForm({ 加工类型: v })}
              />
            </FormField>
            <FormField label={`加工内容${喷油供应商 || form.加工类型 === "二次加工" ? " *" : ""}`}>
              <SearchSelect
                ariaLabel="加工内容"
                className={cn(inputCls, "rounded-md border")}
                value={form.加工内容}
                options={加工内容选项.map((v) => ({ value: v, label: v }))}
                placeholder="请选择"
                clearLabel="请选择"
                onChange={(v) => setForm({ 加工内容: v })}
              />
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
      )}

      {/* 明细编辑网格(已审核只读);限高纵向滚动,横向滚动条常驻可见(行多不再沉底)。
          滚动口不留 padding(避免吸顶表头/冻结列上方透出滚过的行),间距由内层承担 */}
      <div className="f-panel max-h-[60vh] overflow-auto">
        <div className="p-4">
        <table data-freeze className="w-full table-fixed text-[15px]" style={{ width: gridWidth }}>
          <thead>
            <tr>
              {headCells.map((c, i) => (
                <th
                  key={c.label + i}
                  style={{ width: c.w }}
                  className={cn(
                    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                    c.num && "text-right",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-black/6 last:border-0">
                <td className="px-2 py-1.5">
                  {/* 生产单号:调入/导入带出的行只读(本来就是生产单带出来的,不用选);
                      只有手动加行的空行才给输入+选 */}
                  {readOnly || l.生产单号 ? (
                    <div className={cellBoxCls}>
                      <span className="f-mono truncate">{l.生产单号 ?? ""}</span>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        className={cn(cellInputCls, "min-w-0 flex-1")}
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
                    <div className={cellBoxCls}>
                      <span className="f-mono truncate">{l.款号 ?? ""}</span>
                    </div>
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
                    <div className={cellBoxCls}>
                      <span className="f-mono truncate font-semibold text-[#1a2330]">
                        {l.物料编号 ?? ""}
                      </span>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        className={cn(cellInputCls, "min-w-0 flex-1")}
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
                <td className="px-2 py-1.5">
                  <div className={cellBoxCls} title={l.物料名称 ?? ""}>
                    <span className="truncate">{l.物料名称 ?? ""}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <div className={cellBoxCls}>
                      <span className="f-mono truncate">{l.模具编号 ?? ""}</span>
                    </div>
                  ) : (
                    <input
                      className={cellInputCls}
                      aria-label="模具编号"
                      value={l.模具编号 ?? ""}
                      onChange={(e) => patchRow(l.key, { 模具编号: e.target.value })}
                    />
                  )}
                </td>
                {(["用量", "套数", "数量"] as const).map((k) => (
                  <td key={k} className="px-2 py-1.5">
                    {readOnly ? (
                      <div className={cn(cellBoxCls, "justify-end")}>
                        <span className="f-mono text-[#1a2330]">{l[k]}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {k === "数量" && Number(l.损耗率) > 0 && (
                          <span
                            title={`损耗率 ${l.损耗率}%:默认数量=计划数量×用量×(1+损耗率),可手改`}
                            className="shrink-0 rounded-full bg-[#d97706]/10 px-1.5 py-0.5 text-xs font-medium text-[#d97706]"
                          >
                            损{l.损耗率}%
                          </span>
                        )}
                        <input
                          className={cn(cellInputCls, "min-w-0 flex-1 text-right")}
                          aria-label={k}
                          type="number"
                          min={0}
                          value={l[k]}
                          onChange={(e) => patchRow(l.key, { [k]: e.target.value })}
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <div className={cn(cellBoxCls, "justify-end")}>
                    <ShotsCell l={l} block={blockedByKey.get(l.key)} />
                  </div>
                </td>
                {(["颜色", "色粉号", "用料名称"] as const).map((k) => (
                  <td key={k} className="px-2 py-1.5">
                    {readOnly ? (
                      <div className={cellBoxCls}>
                        <span className="truncate">{l[k] ?? ""}</span>
                      </div>
                    ) : (
                      <input
                        className={cellInputCls}
                        aria-label={k}
                        value={l[k] ?? ""}
                        onChange={(e) => patchRow(l.key, { [k]: e.target.value })}
                      />
                    )}
                  </td>
                ))}
                {啤机单 && (
                  <td className="px-2 py-1.5">
                    <div className={cn(cellBoxCls, "justify-end")}>
                      <RawKgCell l={l} />
                    </div>
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <div className={cellBoxCls} title={l.加工内容 ?? ""}>
                    <span className="truncate">{l.加工内容 ?? ""}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <div className={cellBoxCls}>
                      <span className="truncate">{l.备注 ?? ""}</span>
                    </div>
                  ) : (
                    <input
                      className={cellInputCls}
                      aria-label="备注"
                      value={l.备注 ?? ""}
                      onChange={(e) => patchRow(l.key, { 备注: e.target.value })}
                    />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className={cn(cellBoxCls, "justify-end")}>
                    <span className="f-mono">{l.入仓数量 ?? ""}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className={cn(cellBoxCls, "justify-end")}>
                    <OwedCell v={l.欠数} />
                  </div>
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
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={headCells.length} className="px-3 py-6 text-center text-sm text-disabled">
                  还没有明细行,点下方「加行」手选物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!readOnly && (
          <button
            type="button"
            className="f-btn mt-3 h-9 px-4 text-sm"
            onClick={() => setLines((ls) => [...ls, { key: uid(), 数量: "0", 用量: "", 套数: "" }])}
          >
            <Plus className="h-4 w-4" />
            加行
          </button>
        )}
        </div>
      </div>

      {/* 物料清单(合并)(对照老系统 mergeRows) */}
      <div className="f-panel overflow-auto p-4">
        <div className="mb-2 text-sm font-semibold text-[#1a2330]">物料清单(合并)</div>
        <table className="w-full min-w-[720px] text-[15px]">
          <thead>
            <tr>
              {["序号", "物料编号", "物料名称", "数量合计", "已入仓", "欠数"].map((h) => (
                <th
                  key={h}
                  className={cn(
                    "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                    (h === "数量合计" || h === "已入仓" || h === "欠数") && "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mergeRows.map((r) => (
              <tr key={r.物料编号} className="border-b border-black/6 last:border-0">
                <td className="f-mono px-3 py-2 text-[#5f6b7d]">{r.序号}</td>
                <td className="f-mono px-3 py-2 font-semibold text-[#1a2330]">{r.物料编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{Math.round(r.数量合计)}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                  {r.入仓合计 != null ? Math.round(r.入仓合计) : ""}
                </td>
                <td className="px-3 py-2 text-right">
                  <OwedCell v={r.欠数合计} />
                </td>
              </tr>
            ))}
            {mergeRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-disabled">
                  无物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 原料扣减汇总(按原料合并):仅啤机单(未选加工内容的一次加工)扣原料,扣后剩余<0 红色=原料不够 */}
      {啤机单 && rawSumRows.length > 0 && (
        <div className="f-panel overflow-auto p-4">
          <div className="mb-2 text-sm font-semibold text-[#1a2330]">原料扣减汇总(按原料合并)</div>
          <table className="w-full min-w-[560px] text-[15px]">
            <thead>
              <tr>
                {["原料编号", "原料名称", "扣减KG", "原料库存KG", "扣后剩余KG"].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                      (h === "扣减KG" || h === "原料库存KG" || h === "扣后剩余KG") && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawSumRows.map((r) => (
                <tr key={r.原料编号} className="border-b border-black/6 last:border-0">
                  <td className="f-mono px-3 py-2 font-semibold text-[#1a2330]">{r.原料编号}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{r.原料名称 ?? ""}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{r.扣减KG.toFixed(2)}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                    {r.库存KG != null ? fmtNum(r.库存KG, 2) : ""}
                  </td>
                  <td
                    className={cn(
                      "f-mono px-3 py-2 text-right font-bold",
                      r.剩余KG != null && r.剩余KG < 0 ? "text-[#dc2626]" : "text-[#15803d]",
                    )}
                  >
                    {r.剩余KG != null ? r.剩余KG.toFixed(2) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 同模分组(一套模明细·啤数/堵模):一套模出多个配件,啤数=ceil(数量/出模数),不齐时先啤够的腔要堵掉 */}
      <MoldGroupPanel groups={moldGroupRows} />

      {/* 合计(对照老系统 Statistic 数量合计/制单人) */}
      <div className="f-panel flex flex-wrap gap-10 px-6 py-4">
        <div>
          <div className="f-label">数量合计</div>
          <div className="f-mono mt-1 text-xl font-bold text-[#1a2330]">{Math.round(数量合计)}</div>
        </div>
        <div>
          <div className="f-label">制单人</div>
          <div className="mt-1 text-xl font-bold text-[#1a2330]">{currentUser}</div>
        </div>
      </div>

      {/* 打开单据 */}
      <OpenDocDialog
        title="打开塑胶采购订单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={listColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="单号/供应商/客户"
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

      <SupplierPickerDialog
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        onPick={(s) => setForm({ 供应商编号: s.供应商编号 ?? "", 供应商名称: s.供应商名称 ?? "" })}
      />
      <ProductionPickerDialog
        open={prodPickFor !== null}
        onClose={() => setProdPickFor(null)}
        onPick={(p: ProductionTrackingRow) => {
          if (prodPickFor === null) return;
          patchRow(prodPickFor, { 生产单号: p.生产单号 ?? undefined, 款号: p.款号 ?? undefined });
          setProdPickFor(null);
        }}
      />
      <PlasticMaterialPickerDialog
        open={materialPickFor !== null}
        onClose={() => setMaterialPickFor(null)}
        onPick={(m: PlasticMaterialRow) => {
          if (materialPickFor === null) return;
          patchRow(materialPickFor, {
            物料编号: m.物料编号 ?? "",
            物料名称: m.物料名称 ?? "",
            颜色: m.颜色 ?? "",
          });
          setMaterialPickFor(null);
        }}
      />

      {/* 加工下单抽屉:打开的单带生产单号时直接按单带料(不看库存,一次/二次都能下,更快);
          新建态/无生产单号时按库存选料(一次加工取啤机单入仓产出,二次加工取一次加工入仓产出) */}
      <PlasticPurchaseOrderDrawer
        open={secondOpen}
        生产单号={
          isView ? detail?.明细?.find((l) => (l.生产单号 ?? "").trim())?.生产单号 : undefined
        }
        initial加工类型={下单类型}
        库存加工
        onClose={() => setSecondOpen(false)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["ppo"] });
          invalidateCrossPage(qc);
        }}
      />

      {/* 堵模提示(保存时触发,仅啤机单):取消=允许堵模按原数量直接保存;确认=按同模最大啤数补齐后保存 */}
      <ConfirmDialog
        open={moldFixGroups != null}
        onClose={() => {
          if (moldConfirmed.current) {
            moldConfirmed.current = false;
            return; // 确认路径已保存过,关窗不再提交
          }
          setMoldFixGroups(null);
          void submitSave(lines); // 允许堵模,按原数量保存
        }}
        title="同模配件需求不齐(堵模)"
        description={
          <div className="space-y-2">
            {moldFixGroups?.map((g) => (
              <div key={g.模具编号}>
                <span className="f-mono font-semibold">{g.模具编号}</span>:全模共 {g.共啤数} 啤,
                {g.lines
                  .filter((l) => l.啤数 != null && g.共啤数 != null && l.啤数 < g.共啤数)
                  .map((l) => `${l.物料名称 ?? l.物料编号}(${l.啤数}啤)`)
                  .join("、")}
                先啤够,之后要堵模
              </div>
            ))}
            <div>
              「取消」保持原数量直接保存(允许堵模);「按最大啤数补齐并保存」把啤数小的配件数量补足到同模一致(多出的件进库存)。
            </div>
          </div>
        }
        confirmLabel="按最大啤数补齐并保存"
        onConfirm={() => {
          moldConfirmed.current = true;
          const r = applyMoldBalance(lines);
          setLines(r.lines);
          setMoldFixGroups(null);
          void submitSave(r.lines);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该单据?"
        description={`塑胶采购订单 ${单号 ?? ""} 删除后不可恢复`}
        confirmLabel="删除"
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => plasticPurchaseOrderApi.remove(单号!), "已删除", "reset");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
      {detailQuery.isError && mode === "view" && 单号 && (
        <div className="f-panel p-6">
          <DocEmpty title="单据加载失败" description="请重试或重新打开" />
        </div>
      )}
    </div>
  );
}
