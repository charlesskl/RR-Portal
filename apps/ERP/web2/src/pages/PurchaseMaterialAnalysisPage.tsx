// 采购物料分析(/purchase-material-analysis;来料仓采购管理;权限菜单=生产制单,MenuCatalog.cs:15 实证:业务单据组)。
// 单据式双模式(对照采购订单):
//   列表模式——生产单列表(服务端分页 50,关键字 生产单号/款号/客户),「分析审核」列=采购分析审核(独立层);
//   详情模式(?mo=生产单号)——单据式表头卡 + 可编辑明细(未审核时可改 需订数量/供应商,保存走 PUT);
//     审核(生产制单·审核)/反审核(反审核位,可审可反) 在工具条;已审核才能「下采购订单」;
//     「按供应商下单」分组 chips:一键跳采购订单(只带该供应商+未绑定物料),未绑定组进页面手选供应商。
// 生产单号列点击跳生产通知单(/production?mo=);价格列按「单价」位裁剪。
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  FloppyDisk,
  MagnifyingGlass,
  Prohibit,
  SealCheck,
  ShoppingCart,
  X,
} from "@phosphor-icons/react";
import { productionApi, productionReportApi, suppliersApi } from "@/api/endpoints";
import type { PurchaseAnalysisRow, SupplierRow } from "@/api/types";
import { MENU_PATHS } from "@/nav/menu";
import { usePerms } from "@/hooks/usePerms";
import { errMsg } from "@/lib/rawDocs";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocHeaderCard, type HeaderField } from "@/components/doc/DocHeaderCard";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { DensitySwitch } from "@/components/doc/QueryTable";

const MENU = "生产制单";
const PAGE_SIZE = 50;

const d10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
const num = (v?: number | null) => (v === null || v === undefined ? "" : v);

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
// 表头四律:sticky + 不透明白底 + z-10 + nowrap
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

// 详情页可编辑行:需订数量/供应商可改,orig* 为水合时的原值(脏判定)
interface AnalysisEditRow {
  ID: number;
  物料编号: string;
  物料名称: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  总数量?: number | null;
  可用库存?: number | null;
  预算单价?: number | null;
  金额?: number | null;
  需订数量: string;
  orig需订数量: string;
  供应商编号: string;
  供应商名称: string;
  orig供应商编号: string;
  orig供应商名称: string;
  勾选: boolean; // 下单行选择:库存不足默认勾;库存够可手勾(防库存时点误差);已下满默认不勾,可手勾追加下单
  锁定: boolean; // 库存为 0=必须订:锁定勾选不可取消
  已订数量: number; // 该生产单下此物料已累计下单数量(已订≥需订−实时可用库存=已下满,显示「已下单」徽标;订单同时进行,可手勾追加下单)
}

// 下满判定：已订数量 ≥ 需订数量 − 实时可用库存。
// 需订数量是制单时点快照（按当时库存算出）；之后到货的库存应能冲抵需求，
// 与采购下单页「库存够默认不勾选」的实时口径一致——否则按实时缺口下单后，
// 分析页会一直误报「需订」。
const coveredByOrdersAndStock = (需订: number, 可用: number, 已订: number) => 已订 >= 需订 - 可用;

const toEditRow = (r: PurchaseAnalysisRow): AnalysisEditRow => {
  const q = r.需订数量 != null ? String(Math.round(Number(r.需订数量))) : "";
  const s = (r.供应商编号 ?? "").trim();
  const 可用 = Number(r.可用库存 ?? 0);
  const 需订 = Number(r.需订数量 ?? 0);
  const 已订 = Number(r.已订数量 ?? 0);
  const 下满 = coveredByOrdersAndStock(需订, 可用, 已订);
  const 锁定 = !下满 && 需订 > 0 && 可用 <= 0;
  return {
    ID: r.ID,
    物料编号: r.物料编号 ?? "",
    物料名称: r.物料名称 ?? "",
    规格: r.规格,
    颜色: r.颜色,
    单位: r.单位,
    总数量: r.总数量,
    可用库存: r.可用库存,
    预算单价: r.预算单价,
    金额: r.金额,
    需订数量: q,
    orig需订数量: q,
    供应商编号: s,
    供应商名称: (r.供应商名称 ?? "").trim(),
    orig供应商编号: s,
    orig供应商名称: (r.供应商名称 ?? "").trim(),
    勾选: !下满 && (锁定 || 需订 > 可用),
    锁定,
    已订数量: 已订,
  };
};

export default function PurchaseMaterialAnalysisPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  // 路径门:keep-alive 隐藏页仍挂载在同一路由上,不在本页路径时不认 mo(防与其他页的同名参数互踩)
  const moParam = location.pathname === "/purchase-material-analysis" ? (sp.get("mo") ?? "").trim() : "";
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const canAudit = can(MENU, "审核");
  const canUnaudit = can(MENU, "反审核");
  const maskPrice = !can(MENU, "单价");

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- 列表模式 ----------
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const listQuery = useQuery({
    queryKey: ["purchase-material-analysis", page, keyword],
    queryFn: () => productionApi.list(page, PAGE_SIZE, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !moParam,
  });
  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const search = () => {
    setPage(1);
    setKeyword(kwInput.trim());
  };

  // 生产单号列:跳生产通知单(未审核可编辑修改);MENU_PATHS 裁决
  const goProduction = (mo: string) => {
    if (!MENU_PATHS.has("/production")) {
      setToast({ text: "生产通知单页未注册,请联系管理员", tone: "err" });
      return;
    }
    navigate(`/production?mo=${encodeURIComponent(mo)}`);
  };

  // ---------- 详情模式(?mo=) ----------
  const headerQuery = useQuery({
    queryKey: ["pma-header", moParam],
    queryFn: () => productionApi.get(moParam),
    enabled: canOpen && !permsLoading && !!moParam,
  });
  const header = headerQuery.data?.单头 ?? null;

  const rowsQuery = useQuery({
    queryKey: ["pma-detail", moParam],
    queryFn: () => productionReportApi.purchaseAnalysis(moParam),
    enabled: canOpen && !permsLoading && !!moParam,
  });

  // 可编辑明细:查询数据到达时水合(渲染期按引用比对);审核/保存后 refetch 会重新水合
  const [editRows, setEditRows] = useState<AnalysisEditRow[]>([]);
  const [hydratedSrc, setHydratedSrc] = useState<PurchaseAnalysisRow[] | null>(null);
  const detailData = rowsQuery.data;
  if (moParam && detailData && detailData !== hydratedSrc) {
    setHydratedSrc(detailData);
    setEditRows(detailData.map(toEditRow));
  }

  const editable = !!header && header.采购分析审核 !== "1";
  const dirty = editRows.some(
    (r) => r.需订数量 !== r.orig需订数量 || r.供应商编号 !== r.orig供应商编号,
  );

  const patchEditRow = (id: number, patch: Partial<AnalysisEditRow>) =>
    setEditRows((rs) => rs.map((r) => (r.ID === id ? { ...r, ...patch } : r)));

  // 明细合计(编辑实时反映)
  const totals = useMemo(
    () => ({
      行数: editRows.length,
      总数量: editRows.reduce((s, r) => s + Number(r.总数量 ?? 0), 0),
      需订数量: editRows.reduce((s, r) => s + (Number(r.需订数量) || 0), 0),
      金额: editRows.reduce((s, r) => s + Number(r.金额 ?? 0), 0),
    }),
    [editRows],
  );

  // 按供应商分组(一键下单入口):已绑定供应商的各一组,未绑定的归一组放最后
  const supplierGroups = useMemo(() => {
    const m = new Map<string, { 编号: string; 名称: string; rows: AnalysisEditRow[] }>();
    for (const r of editRows) {
      const k = r.供应商编号;
      const g = m.get(k) ?? { 编号: k, 名称: r.供应商名称, rows: [] };
      g.rows.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) =>
      a.编号 === "" ? 1 : b.编号 === "" ? -1 : a.名称.localeCompare(b.名称, "zh"),
    );
  }, [editRows]);

  // 保存明细(仅未审核可改):需订数量/供应商 回写 BOM 需求快照
  const [saving, setSaving] = useState(false);
  const saveAnalysis = async () => {
    if (!moParam || saving || !dirty) return;
    setSaving(true);
    try {
      const r = await productionReportApi.savePurchaseAnalysis({
        生产单号: moParam,
        明细: editRows.map((x) => ({
          ID: x.ID,
          需订数量: Number(x.需订数量) || 0,
          供应商编号: x.供应商编号 || undefined,
        })),
      });
      setToast({ text: `采购分析已保存(更新 ${r.更新行数} 行)`, tone: "ok" });
      await rowsQuery.refetch();
    } catch (e) {
      setToast({ text: errMsg(e) || "采购分析保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 审核/反审核(生产制单·审核/反审核 位)
  const [auditing, setAuditing] = useState(false);
  const auditAnalysis = async () => {
    if (!moParam || auditing) return;
    setAuditing(true);
    try {
      await productionApi.purchaseAnalysisAudit(moParam);
      setToast({ text: `采购分析单 ${moParam} 已审核`, tone: "ok" });
      await headerQuery.refetch();
    } catch (e) {
      setToast({ text: errMsg(e) || "采购分析审核失败", tone: "err" });
    } finally {
      setAuditing(false);
    }
  };
  const unauditAnalysis = async () => {
    if (!moParam || auditing) return;
    setAuditing(true);
    try {
      await productionApi.purchaseAnalysisUnaudit(moParam);
      setToast({ text: `采购分析单 ${moParam} 已反审核，可修改明细后重新审核`, tone: "ok" });
      await headerQuery.refetch();
    } catch (e) {
      setToast({ text: errMsg(e) || "采购分析反审核失败", tone: "err" });
    } finally {
      setAuditing(false);
    }
  };

  // 下采购订单:双门(生产通知单已审核 + 采购分析已审核) + 必须勾选了行;
  // 勾选的行按 ID 随「行」参数带入采购订单(那边只勾这些);supp=按供应商分组跳入
  const openOrder = (supp?: { 编号: string; 名称: string }) => {
    if (!header?.生产单号) return;
    const chosen = editRows.filter((r) => r.勾选);
    if (chosen.length === 0) {
      setToast({ text: "请勾选要订购的物料行", tone: "err" });
      return;
    }
    if (dirty) {
      setToast({ text: "明细有未保存的修改，请先保存", tone: "err" });
      return;
    }
    if (header.审核 !== "1") {
      setToast({ text: `生产通知单 ${header.生产单号} 未审核，审核后才能采购下单`, tone: "err" });
      return;
    }
    if (header.采购分析审核 !== "1") {
      setToast({ text: `采购分析单 ${header.生产单号} 未审核，请先点「审核」`, tone: "err" });
      return;
    }
    const target = "/purchase-orders";
    if (!MENU_PATHS.has(target)) {
      setToast({ text: "采购订单页未注册,请联系管理员", tone: "err" });
      return;
    }
    const params = new URLSearchParams({ basis: header.生产单号 });
    params.set("行", chosen.map((r) => r.ID).join(","));
    if (supp?.编号) {
      params.set("供应商编号", supp.编号);
      params.set("供应商名称", supp.名称);
    }
    navigate(`${target}?${params.toString()}`);
  };

  // 供应商选择器(给某一行绑定/解绑供应商;选定即自动保存单行,绑定时同步为物料默认供应商)
  const [supplierRowId, setSupplierRowId] = useState<number | null>(null);
  const [supplierKw, setSupplierKw] = useState("");
  const suppliersQuery = useQuery({
    queryKey: ["pma-suppliers", supplierKw],
    queryFn: () => suppliersApi.list(1, 500, supplierKw),
    placeholderData: keepPreviousData,
    enabled: supplierRowId !== null,
  });

  // 单行供应商变更即时落库;失败回滚该行显示
  const autoSaveRow = async (row: AnalysisEditRow) => {
    if (!moParam) return;
    setSaving(true);
    try {
      await productionReportApi.savePurchaseAnalysis({
        生产单号: moParam,
        同步物料默认供应商: !!row.供应商编号,
        明细: [
          {
            ID: row.ID,
            需订数量: Number(row.需订数量) || 0,
            供应商编号: row.供应商编号 || undefined,
          },
        ],
      });
      setEditRows((rs) =>
        rs.map((r) =>
          r.ID === row.ID
            ? { ...r, orig供应商编号: r.供应商编号, orig供应商名称: r.供应商名称 }
            : r,
        ),
      );
      setToast({
        text: row.供应商编号
          ? `已绑定供应商 ${row.供应商名称 || row.供应商编号}（已记为该物料的默认供应商，日后新单自动带出）`
          : "已解绑供应商",
        tone: "ok",
      });
    } catch (e) {
      setEditRows((rs) =>
        rs.map((r) =>
          r.ID === row.ID
            ? { ...r, 供应商编号: row.orig供应商编号, 供应商名称: row.orig供应商名称 }
            : r,
        ),
      );
      setToast({ text: errMsg(e) || "保存供应商失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const pickSupplier = (s: SupplierRow) => {
    const target = supplierRowId === null ? null : editRows.find((r) => r.ID === supplierRowId);
    setSupplierRowId(null);
    setSupplierKw("");
    if (!target) return;
    const next = {
      ...target,
      供应商编号: (s.供应商编号 ?? "").trim(),
      供应商名称: (s.供应商名称 ?? "").trim(),
    };
    setEditRows((rs) => rs.map((r) => (r.ID === next.ID ? next : r)));
    void autoSaveRow(next);
  };

  const unbindSupplier = (r: AnalysisEditRow) => {
    const next = { ...r, 供应商编号: "", 供应商名称: "" };
    setEditRows((rs) => rs.map((x) => (x.ID === r.ID ? next : x)));
    void autoSaveRow(next);
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  // ---------- 详情模式渲染 ----------
  if (moParam) {
    const headerFields: HeaderField[] = header
      ? [
          { label: "生产单号", value: header.生产单号 ?? "", mono: true, strong: true },
          { label: "款号", value: header.款号 ?? "", mono: true },
          { label: "款式", value: header.款式 ?? "" },
          { label: "客户", value: header.客户名称 ?? "" },
          { label: "合同号", value: header.合同号 ?? "", mono: true },
          { label: "制单日期", value: d10(header.日期), mono: true },
          { label: "交货日期", value: d10(header.交货日期), mono: true },
          { label: "计划数量", value: header.计划数量 ?? "", mono: true },
        ]
      : [];
    const headerExtra: HeaderField[] = header
      ? [
          { label: "客户款号", value: header.客户款号 ?? "", mono: true },
          { label: "制单人", value: header.制单人 ?? "" },
          {
            label: "生产单审核",
            value:
              header.审核 === "1" ? (
                <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-0.5 text-xs font-semibold text-[#15803d]">
                  已审核
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-black/6 px-2.5 py-0.5 text-xs font-semibold text-[#5f6b7d]">
                  未审核
                </span>
              ),
          },
          {
            label: "采购分析审核",
            value:
              header.采购分析审核 === "1" ? (
                <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-0.5 text-xs font-semibold text-[#15803d]">
                  已审核{header.采购分析审核人 ? `（${header.采购分析审核人}）` : ""}
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-black/6 px-2.5 py-0.5 text-xs font-semibold text-[#b26a00]">
                  未审核
                </span>
              ),
          },
        ]
      : [];

    return (
      <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3 px-1">
          <h1 className="text-2xl font-bold text-[#1a2330]">
            采购分析单{header?.生产单号 ? ` · ${header.生产单号}` : ""}
            {header?.款号 ? `(${header.款号})` : ""}
          </h1>
          {header?.采购分析审核 === "1" ? (
            <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
              分析已审核
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#b26a00]">
              分析未审核
            </span>
          )}
        </div>

        {/* 工具条(对照采购订单):返回 / 保存 / 审核·反审核 / 下采购订单 */}
        <div className="f-panel flex flex-wrap items-center gap-2.5 p-4">
          <button type="button" className="f-btn px-4" onClick={() => setSp({})}>
            <ArrowLeft className="h-4.5 w-4.5" />
            返回列表
          </button>
          <button
            type="button"
            className="f-btn f-btn-cyan px-4"
            disabled={!editable || !dirty || saving || !canSave}
            title={
              !editable
                ? "已审核的采购分析不能修改，请先反审核"
                : !canSave
                  ? "缺少「生产制单·保存」权限"
                  : undefined
            }
            onClick={saveAnalysis}
          >
            <FloppyDisk className="h-4.5 w-4.5" />
            {saving ? "保存中..." : "保存"}
          </button>
          {header?.采购分析审核 === "1"
            ? canUnaudit && (
                <button
                  type="button"
                  className="f-btn px-4 font-semibold text-[#dc2626]"
                  disabled={auditing}
                  title="反审核后回到未审核状态,可修改明细"
                  onClick={unauditAnalysis}
                >
                  {auditing ? "处理中..." : "反审核"}
                </button>
              )
            : canAudit && (
                <button
                  type="button"
                  className="f-btn px-4 font-semibold text-[#15803d]"
                  disabled={auditing || dirty || header?.审核 !== "1"}
                  title={
                    dirty
                      ? "明细有未保存的修改，请先保存"
                      : header?.审核 !== "1"
                        ? "生产通知单未审核，审核后才能审核采购分析"
                        : "确认明细无误后审核采购分析单"
                  }
                  onClick={auditAnalysis}
                >
                  <SealCheck className="h-4.5 w-4.5" />
                  {auditing ? "审核中..." : "审核"}
                </button>
              )}
          <button
            type="button"
            className="f-btn f-btn-cyan px-4"
            onClick={() => openOrder()}
          >
            <ShoppingCart className="h-4.5 w-4.5" />
            下采购订单
          </button>
          {!editable && (
            <span className="text-xs text-[#b26a00]">已审核的分析单为只读，修改请先「反审核」</span>
          )}
        </div>

        {headerQuery.isLoading ? (
          <div className="f-panel p-6 text-sm text-[#8a94a6]">加载中…</div>
        ) : headerQuery.isError || !header ? (
          <div className="f-panel p-6">
            <DocEmpty title="生产通知单不存在或加载失败" description="请返回列表重新进入" />
          </div>
        ) : (
          <DocHeaderCard fields={headerFields} extra={headerExtra} />
        )}

        {/* 按供应商分组一键下单:每组一个 chip,点击直接带该供应商的物料进采购订单;已下满组不禁用,可勾选行追加下单 */}
        {supplierGroups.length > 0 && (
          <div className="f-panel flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="text-xs font-semibold text-[#8a94a6]">按供应商下单:</span>
            {supplierGroups.map((g) => {
              // 需订合计只算未下满的行（扣实时库存与已订后的剩余量）;已下满组不禁用——订单同时进行,勾选要追加的行后点 chip 追加下单(采购订单保存时再确认)
              const 未下满行 = g.rows.filter(
                (r) =>
                  !coveredByOrdersAndStock(
                    Number(r.需订数量) || 0,
                    Number(r.可用库存) || 0,
                    r.已订数量,
                  ),
              );
              const 需订合计 = 未下满行.reduce(
                (s, r) =>
                  s +
                  Math.max(
                    0,
                    (Number(r.需订数量) || 0) - (Number(r.可用库存) || 0) - r.已订数量,
                  ),
                0,
              );
              const 全下满 = 未下满行.length === 0;
              return (
                <button
                  key={g.编号 || "_none"}
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    全下满
                      ? "border-black/15 bg-black/[0.04] text-[#5f6b7d] hover:bg-black/[0.08]"
                      : g.编号
                        ? "border-[#16a34a]/40 bg-[#16a34a]/8 text-[#15803d] hover:bg-[#16a34a]/15"
                        : "border-[#b26a00]/40 bg-[#fdf3e7] text-[#b26a00] hover:bg-[#f9e8d4]"
                  }`}
                  title={
                    全下满
                      ? "该供应商的物料已全部下过单;勾选要追加的行后点此追加下单(保存时会再确认防重复采购)"
                      : g.编号
                        ? `下 ${g.名称 || g.编号} 的采购订单(只带该供应商+未绑定的物料)`
                        : "这些物料未绑定供应商,进入采购订单后手动选择供应商"
                  }
                  onClick={() => openOrder(g)}
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {g.编号 ? g.名称 || g.编号 : "未绑定供应商"} · {g.rows.length} 行
                  {全下满 ? " · 已全部下单·可追加" : ` · 需订${Math.round(需订合计)}`}
                </button>
              );
            })}
          </div>
        )}

        {/* 明细(未审核可编辑 需订数量/供应商) */}
        <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto">
            <table data-freeze className="w-full min-w-[1080px] text-[15px]">
              <thead>
                <tr>
                  {[
                    "订购",
                    "物料编号",
                    "物料名称",
                    "规格",
                    "颜色",
                    "单位",
                    "总数量",
                    "可用库存",
                    "需订数量",
                    ...(maskPrice ? [] : ["预算单价", "金额"]),
                    "供应商",
                  ].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        thCls,
                        h === "订购" && "text-center",
                        ["总数量", "可用库存", "需订数量", "预算单价", "金额"].includes(h) &&
                          "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsQuery.isLoading ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                      加载中...
                    </td>
                  </tr>
                ) : rowsQuery.isError ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-sm text-[#dc2626]">
                      加载采购分析明细失败
                    </td>
                  </tr>
                ) : editRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-sm text-disabled">
                      暂无采购分析明细
                    </td>
                  </tr>
                ) : (
                  editRows.map((r) => {
                    const enough =
                      r.可用库存 != null &&
                      Number(r.可用库存) >= (Number(r.需订数量) || 0);
                    const 下满 = coveredByOrdersAndStock(
                      Number(r.需订数量) || 0,
                      Number(r.可用库存) || 0,
                      r.已订数量,
                    );
                    return (
                      <tr key={r.ID} className="border-b border-black/6 last:border-0">
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              aria-label={`订购 ${r.物料编号}`}
                              className="h-4 w-4 accent-[#16a34a]"
                              checked={r.勾选}
                              disabled={r.锁定}
                              title={
                                r.锁定
                                  ? "库存为 0，必须订购"
                                  : 下满
                                    ? "已下满(已订+实时库存已覆盖需订);订单同时进行,勾选=追加下单,采购订单保存时会再确认防重复采购"
                                    : enough
                                      ? "库存已够需求;为避免库存时点误差也可勾选下单"
                                      : "库存不足，按需勾选"
                              }
                              onChange={(e) =>
                                !r.锁定 && patchEditRow(r.ID, { 勾选: e.target.checked })
                              }
                            />
                            {下满 && r.已订数量 > 0 ? (
                              <span
                                className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#15803d]"
                                title={`已订 ${r.已订数量} + 实时库存 ${Number(r.可用库存) || 0} 已覆盖需订 ${r.需订数量};勾选左侧框可追加下单`}
                              >
                                已下单
                              </span>
                            ) : (
                              !下满 &&
                              r.已订数量 > 0 && (
                                <span
                                  className="text-[10px] font-semibold text-[#b26a00]"
                                  title={`已下单 ${r.已订数量},还需 ${Math.max(0, (Number(r.需订数量) || 0) - (Number(r.可用库存) || 0) - r.已订数量)}`}
                                >
                                  已订{r.已订数量}
                                </span>
                              )
                            )}
                          </span>
                        </td>
                        <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">
                          {r.物料编号}
                        </td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.规格}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色}</td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{r.单位}</td>
                        <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                          {num(r.总数量)}
                        </td>
                        <td
                          className="f-mono px-3 py-2 text-right"
                          title={enough ? "实时库存已够需求,下单时默认不勾选" : undefined}
                        >
                          <span
                            className={enough ? "font-semibold text-[#16a34a]" : "text-[#3d4a5c]"}
                          >
                            {num(r.可用库存)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            aria-label={`需订数量 ${r.物料编号}`}
                            className="f-mono h-8 w-24 rounded-md border border-black/10 bg-black/[0.04] px-2 text-right text-[#1a2330] disabled:bg-transparent disabled:text-[#3d4a5c]"
                            value={r.需订数量}
                            disabled={!editable}
                            min={0}
                            onChange={(e) =>
                              patchEditRow(r.ID, { 需订数量: e.target.value })
                            }
                          />
                        </td>
                        {!maskPrice && (
                          <>
                            <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                              {num(r.预算单价)}
                            </td>
                            <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                              {num(r.金额)}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                          <span className="inline-flex items-center gap-1.5">
                            {r.供应商编号 ? (
                              <span title={r.供应商编号}>{r.供应商名称 || r.供应商编号}</span>
                            ) : (
                              <span className="text-[#b26a00]">未绑定</span>
                            )}
                            {editable && canSave && (
                              <>
                                <button
                                  type="button"
                                  className="rounded border border-black/15 px-1.5 py-0.5 text-xs font-semibold text-[#15803d] hover:bg-[#16a34a]/10"
                                  disabled={saving}
                                  onClick={() => setSupplierRowId(r.ID)}
                                >
                                  选
                                </button>
                                {r.供应商编号 && (
                                  <button
                                    type="button"
                                    aria-label={`解绑供应商 ${r.物料编号}`}
                                    className="rounded border border-black/15 px-1.5 py-0.5 text-xs text-[#8a94a6] hover:bg-black/5"
                                    title="解绑供应商"
                                    disabled={saving}
                                    onClick={() => unbindSupplier(r)}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* 单据式合计表尾 */}
          {editRows.length > 0 && (
            <div className="f-mono flex shrink-0 flex-wrap items-center gap-x-5 border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
              <span>
                共 {totals.行数} 行,已勾选{" "}
                <b className="text-[#15803d]">{editRows.filter((r) => r.勾选).length}</b> 行
              </span>
              <span>
                总数量合计 <b className="text-[#1a2330]">{Math.round(totals.总数量)}</b>
              </span>
              <span>
                需订数量合计 <b className="text-[#1a2330]">{Math.round(totals.需订数量)}</b>
              </span>
              {!maskPrice && (
                <span>
                  金额合计 <b className="text-[#1a2330]">{totals.金额.toFixed(2)}</b>
                </span>
              )}
            </div>
          )}
        </div>

        {/* 供应商选择器(绑定到行) */}
        <PickerDialog
          open={supplierRowId !== null}
          onClose={() => setSupplierRowId(null)}
          title="选择供应商"
          width="sm:max-w-[640px]"
        >
          <div className="mb-3">
            <Input
              aria-label="供应商关键字"
              className={inputCls}
              placeholder="编号 / 名称"
              value={supplierKw}
              onChange={(e) => setSupplierKw(e.target.value)}
            />
          </div>
          <table data-freeze className="w-full text-[15px]">
            <thead>
              <tr>
                <th className={thCls}>供应商编号</th>
                <th className={thCls}>供应商名称</th>
              </tr>
            </thead>
            <tbody>
              {(suppliersQuery.data?.items ?? []).map((s, i) => (
                <tr
                  key={s.供应商编号 ?? i}
                  className="cursor-pointer border-b border-black/6 last:border-0 hover:bg-black/[0.04]"
                  onClick={() => pickSupplier(s)}
                >
                  <td className="f-mono px-3 py-2 text-[#1a2330]">{s.供应商编号}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{s.供应商名称}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PickerDialog>

        {toast && <DocToast text={toast.text} tone={toast.tone} />}
      </div>
    );
  }

  // ---------- 列表模式渲染 ----------
  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">采购物料分析</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-center gap-3 p-5">
        <div className="w-80">
          <Input
            aria-label="关键字"
            className={inputCls}
            placeholder="生产单号 / 款号 / 客户"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
      </div>

      {/* 生产单列表(点行进采购分析详情页) */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table data-freeze className="w-full min-w-[1180px] text-[15px]">
            <thead>
              <tr>
                {[
                  "制单日期",
                  "交货日期",
                  "生产单号",
                  "款号",
                  "款式",
                  "客户款号",
                  "合同号",
                  "计划数量",
                  "制单人",
                  "分析审核",
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      thCls,
                      h === "计划数量" && "text-right",
                      h === "分析审核" && "text-center",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : listQuery.isError ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-[#dc2626]">
                    加载生产单列表失败
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-disabled">
                    暂无数据
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.ID ?? r.id ?? r.生产单号}
                    className="cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                    onClick={() => r.生产单号 && setSp({ mo: r.生产单号 })}
                    title="点击打开采购分析详情"
                  >
                    <td className="f-mono px-3 py-2.5 whitespace-nowrap text-[#3d4a5c]">
                      {d10(r.日期)}
                    </td>
                    <td className="f-mono px-3 py-2.5 whitespace-nowrap text-[#3d4a5c]">
                      {d10(r.交货日期)}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="f-mono font-semibold whitespace-nowrap text-[#15803d] hover:underline"
                        title="打开生产通知单(未审核可编辑修改)"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (r.生产单号) goProduction(r.生产单号);
                        }}
                      >
                        {r.生产单号}
                      </button>
                    </td>
                    <td className="f-mono px-3 py-2.5 text-[#3d4a5c]">{r.款号}</td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.款式}</td>
                    <td className="f-mono px-3 py-2.5 text-[#3d4a5c]">{r.客户款号}</td>
                    <td className="f-mono px-3 py-2.5 text-[#3d4a5c]">{r.合同号}</td>
                    <td className="f-mono px-3 py-2.5 text-right text-[#1a2330]">
                      {r.计划数量 ?? ""}
                    </td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.制单人}</td>
                    <td className="px-3 py-2.5 text-center" title="采购分析审核状态(≠生产通知单审核)">
                      {r.采购分析审核 === "1" ? (
                        <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
                          已审核
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
                          未审核
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {total} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <CaretLeft className="h-4 w-4" />
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
              <CaretRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      </div>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
