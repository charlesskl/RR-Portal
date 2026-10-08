// 客户排期表:各客户 Excel 排期数据的统一查询页(筛选/分页/导入/批次管理)
// 照抄老系统 web/src/pages/scheduling/SchedulingPage.tsx:
//  - 筛选:排期客户/状态/走货期区间/关键字(PO/货号/品名/客户);分页 20/页
//  - 视图切换:按排期行 / 按排期表(文件);顶部状态统计(在排/已走货/已取消 行数)
//  - 行展开:整行原始数据(原表头->原值),万全兜底
//  - 「生产下单」按排期行预填生成生产通知单(权限:生产制单·保存),成功后跳 /production?mo= 打开新单
//  - 「导入排期」(权限:生产排期·保存) / 「批次」管理(删除权限:生产排期·删除)
// 不在本任务范围:老系统点货号弹 BOM 物料下采购单(StyleMaterialsDrawer),货号列新版为纯文本(见 task-10 报告)
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  FileArrowUp,
  FolderOpen,
  Plus,
  PushPin,
  PushPinSlash,
} from "@phosphor-icons/react";
import { schedulingApi } from "@/api/endpoints";
import type { ScheduleRow, ScheduleRowSave } from "@/api/types";
import { fmtNum, txt } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { usePerms } from "@/hooks/usePerms";
import { useColumnFreeze, type ColumnFreeze } from "@/hooks/useColumnFreeze";
import ScheduleImportDialog, { StatusTag } from "./ScheduleImportDialog";
import ScheduleBatchesDialog from "./ScheduleBatchesDialog";
import ScheduleFilesView from "./ScheduleFilesView";
import ScheduleRowEditDialog from "./ScheduleRowEditDialog";
import ScheduleStatusReviewDialog from "./ScheduleStatusReviewDialog";
import ScheduleProductionDialog, {
  type ScheduleProductionCtx,
} from "./ScheduleProductionDialog";

// 权限菜单名:与后端 SchedulingController Menu 常量一致(实证 grep MenuCatalog/Controller,非菜单 label)
const MENU = "生产排期";
// 「生产下单」按老系统取「生产制单·保存」位
const PROD_MENU = "生产制单";

const fmtDate = (v?: string) => (v ? v.slice(0, 10) : "-");

// 行展开:整行原始数据(原表头->原值),万全兜底,任何客户任何表头都不丢
function RawDataPanel({ json }: { json?: string }) {
  if (!json) return <span className="text-sm text-disabled">无原始数据</span>;
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(json);
  } catch {
    return <span className="text-sm text-[#3d4a5c]">{json}</span>;
  }
  const entries = Object.entries(obj);
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-black/8">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            <th className="f-label sticky top-0 z-10 w-56 bg-[#f7faf8] px-3 py-2 text-left font-medium whitespace-nowrap">
              原表头
            </th>
            <th className="f-label sticky top-0 z-10 bg-[#f7faf8] px-3 py-2 text-left font-medium whitespace-nowrap">
              原值
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-black/6 last:border-0">
              <td className="px-3 py-1.5 text-[#5f6b7d]">{k}</td>
              <td className="px-3 py-1.5 break-all text-[#3d4a5c]">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COLUMNS: { key: string; label: string; num?: boolean }[] = [
  { key: "货号", label: "货号" },
  { key: "品名", label: "品名" },
  { key: "状态", label: "状态" },
  { key: "排期客户", label: "排期客户" },
  { key: "接单日期", label: "接单日期" },
  { key: "客户名称", label: "客户名称" },
  { key: "国家", label: "国家" },
  { key: "PO号", label: "PO号" },
  { key: "客PO", label: "客PO" },
  { key: "数量", label: "数量", num: true },
  { key: "总箱数", label: "总箱数", num: true },
  { key: "走货期", label: "走货期" },
  { key: "验货期", label: "验货期" },
  { key: "车间", label: "车间" },
  { key: "来源工作表", label: "来源工作表" },
  { key: "备注", label: "备注" },
];

function cellValue(r: ScheduleRow, key: string): string {
  switch (key) {
    case "货号": return txt(r.货号);
    case "品名": return txt(r.品名);
    case "排期客户": return txt(r.排期客户);
    case "接单日期": return fmtDate(r.接单日期);
    case "客户名称": return txt(r.客户名称);
    case "国家": return txt(r.国家);
    case "PO号": return txt(r.PO号);
    case "客PO": return txt(r.客PO);
    case "数量": return fmtNum(r.数量, 0);
    case "总箱数": return fmtNum(r.总箱数, 0);
    case "走货期": return fmtDate(r.走货期);
    case "验货期": return fmtDate(r.验货期);
    case "车间": return txt(r.车间);
    case "来源工作表": return txt(r.来源工作表);
    case "备注": return txt(r.备注);
    default: return "-";
  }
}

export default function SchedulingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePerms();
  const canImport = can(MENU, "保存");
  const canProduce = can(PROD_MENU, "保存");
  const canDelete = can(MENU, "删除");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [排期客户, set排期客户] = useState("");
  const [状态, set状态] = useState("");
  const [单类型, set单类型] = useState(""); // MA单/实单(空=全部):-MA 结尾=MA单,实单关联同客户 MA 单
  const [走货期从, set走货期从] = useState("");
  const [走货期至, set走货期至] = useState("");
  const [view, setView] = useState<"rows" | "files">("rows");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [showBatches, setShowBatches] = useState(false);
  const [prodCtx, setProdCtx] = useState<ScheduleProductionCtx | null>(null);
  // 手工 CRUD:editOpen+editRow(null=新增);delRow 待删除行;toast 操作反馈
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<ScheduleRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [delRow, setDelRow] = useState<ScheduleRow | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const listQuery = useQuery({
    queryKey: ["scheduling-list", page, pageSize, keyword, 排期客户, 状态, 单类型, 走货期从, 走货期至],
    queryFn: () =>
      schedulingApi.list({
        page,
        size: pageSize,
        keyword: keyword || undefined,
        排期客户: 排期客户 || undefined,
        状态: 状态 || undefined,
        单类型: 单类型 || undefined,
        走货期从: 走货期从 || undefined,
        走货期至: 走货期至 || undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const customersQuery = useQuery({
    queryKey: ["scheduling-customers"],
    queryFn: () => schedulingApi.customers(),
    staleTime: 5 * 60_000,
  });
  const summaryQuery = useQuery({
    queryKey: ["scheduling-summary"],
    queryFn: () => schedulingApi.summary(),
  });
  // 状态变更待审数 + 当前用户是否经理(审核弹窗只读/可审 判定)
  const pendingQuery = useQuery({
    queryKey: ["scheduling-status-pending"],
    queryFn: () => schedulingApi.statusPending(),
  });
  const 待审数 = pendingQuery.data?.待审数 ?? 0;
  const isManager = pendingQuery.data?.是否经理 ?? false;

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 操作列:生产下单(生产制单·保存)/编辑(生产排期·保存)/删除(生产排期·删除) 任一可见即渲染
  const hasOps = canProduce || canImport || canDelete;
  // 冻结列(类 Excel 冻结窗格):表头钉按钮选冻结列,横拉时冻结列固定左侧不动;选择持久化
  const tableRef = useRef<HTMLTableElement>(null);
  const fz = useColumnFreeze(tableRef, [rows.length, hasOps], "web2.freeze.scheduling");
  const customers = customersQuery.data ?? [];

  // 顶部统计:当前选中客户(或全部)的 在排/已走货/已取消 行数(照抄老系统 stat())
  const stat = (st: string) =>
    (summaryQuery.data ?? [])
      .filter((s) => s.状态 === st && (!排期客户 || s.排期客户 === 排期客户))
      .reduce((a, s) => a + s.行数, 0);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["scheduling-list"] });
    void qc.invalidateQueries({ queryKey: ["scheduling-summary"] });
    void qc.invalidateQueries({ queryKey: ["scheduling-customers"] });
    void qc.invalidateQueries({ queryKey: ["scheduling-files"] });
    void qc.invalidateQueries({ queryKey: ["scheduling-status-pending"] });
    void qc.invalidateQueries({ queryKey: ["scheduling-status-changes"] });
  };

  const openCreate = () => {
    setEditRow(null);
    setEditOpen(true);
  };
  const openEdit = (r: ScheduleRow) => {
    setEditRow(r);
    setEditOpen(true);
  };

  const onSaveRow = async (body: ScheduleRowSave) => {
    setSaving(true);
    try {
      // 编辑时后端返回 状态待审核:改了状态且非经理 → 状态挂起等经理审核
      const res = editRow ? await schedulingApi.update(editRow.ID, body) : null;
      if (!editRow) await schedulingApi.create(body);
      setToast({
        text: res?.状态待审核 ? "已保存,状态修改待经理审核" : "已保存",
        tone: "ok",
      });
      setEditOpen(false);
      refreshAll();
    } catch (e) {
      setToast({
        text: e instanceof ApiError ? e.message : "保存失败,请检查网络后重试",
        tone: "err",
      });
    } finally {
      setSaving(false);
    }
  };

  const onDeleteRow = async (r: ScheduleRow) => {
    try {
      await schedulingApi.remove(r.ID);
      setToast({ text: "已删除", tone: "ok" });
      refreshAll();
    } catch (e) {
      setToast({
        text: e instanceof ApiError ? e.message : "删除失败,请检查网络后重试",
        tone: "err",
      });
    }
  };

  // 生产下单 -> 按排期行预填生成生产通知单(照抄老系统 pick生产)
  const pick生产 = (r: ScheduleRow) =>
    r.货号 &&
    setProdCtx({
      货号: r.货号,
      品名: r.品名,
      数量: r.数量,
      排期客户: r.排期客户,
      客户名称: r.客户名称,
      PO号: r.PO号,
      客PO: r.客PO,
      SKU: r.SKU,
      走货期: r.走货期,
      接单日期: r.接单日期,
      总箱数: r.总箱数,
      单类型: r.单类型,
      关联MA货号: r.关联MA货号,
    });

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* 页头 + 操作 */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-xl font-bold text-[#1a2330]">客户排期表</h1>
        <div className="ml-auto flex items-center gap-2.5">
          {canImport && (
            <button type="button" className="f-btn h-9 px-3.5" onClick={openCreate}>
              <Plus className="h-4.5 w-4.5" />
              新增
            </button>
          )}
          <button type="button" className="f-btn h-9 px-3.5" onClick={() => setShowBatches(true)}>
            <FolderOpen className="h-4.5 w-4.5" />
            批次
          </button>
          <button
            type="button"
            className="f-btn relative h-9 px-3.5"
            onClick={() => setShowReview(true)}
          >
            状态审核
            {待审数 > 0 && (
              <span className="f-mono absolute -top-2 -right-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dc2626] px-1 text-xs font-semibold text-white">
                {待审数 > 99 ? "99+" : 待审数}
              </span>
            )}
          </button>
          {canImport && (
            <button
              type="button"
              className="f-btn f-btn-cyan h-9 px-3.5"
              onClick={() => setImporting(true)}
            >
              <FileArrowUp className="h-4.5 w-4.5" />
              导入排期
            </button>
          )}
        </div>
      </div>

      {/* 筛选栏(紧凑单行,省纵向空间给表格) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-2.5 p-3">
        <div className="w-36 space-y-1">
          <label className="f-label block">排期客户</label>
          <SearchSelect
            ariaLabel="排期客户"
            className="h-9"
            value={排期客户}
            options={customers.map((c) => ({ value: c, label: c }))}
            placeholder="全部"
            clearLabel="全部"
            onChange={(v) => {
              setPage(1);
              set排期客户(v);
            }}
          />
        </div>
        <div className="w-28 space-y-1">
          <label className="f-label block">状态</label>
          <SearchSelect
            ariaLabel="状态"
            className="h-9"
            value={状态}
            options={["在排", "已走货", "已取消"].map((s) => ({ value: s, label: s }))}
            placeholder="全部"
            clearLabel="全部"
            onChange={(v) => {
              setPage(1);
              set状态(v);
            }}
          />
        </div>
        <div className="w-28 space-y-1">
          <label className="f-label block">单类型</label>
          <SearchSelect
            ariaLabel="单类型"
            className="h-9"
            value={单类型}
            options={["MA单", "实单"].map((s) => ({ value: s, label: s }))}
            placeholder="全部"
            clearLabel="全部"
            onChange={(v) => {
              setPage(1);
              set单类型(v);
            }}
          />
        </div>
        <div className="w-36 space-y-1">
          <label className="f-label block" htmlFor="sch-from">走货期从</label>
          <input
            id="sch-from"
            type="date"
            className="f-input h-9"
            value={走货期从}
            onChange={(e) => {
              setPage(1);
              set走货期从(e.target.value);
            }}
          />
        </div>
        <div className="w-36 space-y-1">
          <label className="f-label block" htmlFor="sch-to">走货期至</label>
          <input
            id="sch-to"
            type="date"
            className="f-input h-9"
            value={走货期至}
            onChange={(e) => {
              setPage(1);
              set走货期至(e.target.value);
            }}
          />
        </div>
        <div className="w-56 space-y-1">
          <label className="f-label block" htmlFor="sch-kw">关键字</label>
          <input
            id="sch-kw"
            className="f-input h-9"
            placeholder="搜索 PO/货号/品名/客户"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                setKeyword(keywordInput.trim());
              }
            }}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan h-9 px-4"
          onClick={() => {
            setPage(1);
            setKeyword(keywordInput.trim());
          }}
        >
          查询
        </button>
        {/* 视图切换与状态统计(并入筛选栏,省一行纵向空间) */}
        <div className="ml-auto flex flex-wrap items-center gap-2 self-center">
          <div className="flex items-center gap-1 rounded-lg border border-black/8 bg-black/[0.03] p-0.5">
            {(
              [
                { key: "rows", label: "按排期行" },
                { key: "files", label: "按排期表" },
              ] as const
            ).map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={cn(
                  "h-7 rounded-md px-3 text-sm transition-colors",
                  view === v.key
                    ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                    : "text-[#5f6b7d] hover:text-[#3d4a5c]",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* 状态统计胶囊:点击=按该状态筛选(再点取消),与「状态」下拉同一份状态 */}
          {(
            [
              { s: "在排", cls: "border-info/50 bg-info/10 text-info-foreground" },
              { s: "已走货", cls: "border-[#16a34a]/50 bg-[#16a34a]/10 text-[#15803d]" },
              { s: "已取消", cls: "border-[#dc2626]/50 bg-[#dc2626]/10 text-[#dc2626]" },
            ] as const
          ).map(({ s, cls }) => (
            <button
              key={s}
              type="button"
              title={`点击筛选「${s}」`}
              onClick={() => {
                setPage(1);
                set状态((cur) => (cur === s ? "" : s));
              }}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-shadow",
                cls,
                状态 === s && "ring-2 ring-current",
              )}
            >
              {s} <span className="f-mono">{stat(s)}</span>
            </button>
          ))}
          <span className="text-xs text-[#5f6b7d]">「生产下单」生成生产通知单</span>
        </div>
      </div>

      {view === "files" ? (
        <ScheduleFilesView customers={customers} />
      ) : (
        /* 排期行表(横向滚动;点行展开原始数据) */
        <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto">
            <table ref={tableRef} className="w-full min-w-[1500px] text-[15px]">
              <thead>
                <tr className="border-b border-black/8 bg-black/[0.03]">
                  <th
                    className={cn(
                      "w-10 px-3 py-2",
                      fz.frozen(0) && "bg-[#f7faf8]",
                      fz.boundary(0) && "shadow-[inset_-2px_0_0_#dfe7e1]",
                    )}
                    style={fz.head(0)}
                  />
                  {COLUMNS.map((c, i) => (
                    <th
                      key={c.key}
                      className={cn(
                        "f-label group/th sticky top-0 z-10 bg-[#f7faf8] px-4 py-2 text-left font-medium whitespace-nowrap",
                        c.num && "text-right",
                        fz.boundary(i + 1) && "shadow-[inset_-2px_0_0_#dfe7e1]",
                      )}
                      style={fz.head(i + 1)}
                    >
                      {c.label}
                      <button
                        type="button"
                        tabIndex={-1}
                        title={
                          fz.boundary(i + 1)
                            ? "取消冻结列"
                            : `冻结到「${c.label}」列(横拉时左侧各列固定不动)`
                        }
                        aria-label={`冻结到 ${c.label} 列`}
                        onClick={(e) => {
                          e.stopPropagation();
                          fz.toggle(i + 1);
                        }}
                        className={cn(
                          "ml-1.5 inline-flex align-middle transition-opacity",
                          fz.boundary(i + 1)
                            ? "text-[#15803d] opacity-100"
                            : "text-[#9aa5b1] opacity-0 group-hover/th:opacity-60 hover:!text-[#15803d]",
                        )}
                      >
                        {fz.boundary(i + 1) ? (
                          <PushPinSlash className="h-3.5 w-3.5" weight="fill" />
                        ) : (
                          <PushPin className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </th>
                  ))}
                  {hasOps && (
                    <th
                      className={cn(
                        "f-label sticky top-0 z-10 bg-[#f7faf8] px-4 py-2 text-left font-medium whitespace-nowrap",
                        fz.boundary(COLUMNS.length + 1) && "shadow-[inset_-2px_0_0_#dfe7e1]",
                      )}
                      style={fz.head(COLUMNS.length + 1)}
                    >
                      操作
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1 + (hasOps ? 1 : 0)} className="p-4">
                      <div className="space-y-2">
                        {Array.from({ length: 12 }).map((_, i) => (
                          <Skeleton key={i} className="h-8 w-full bg-black/5" />
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : listQuery.isError ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1 + (hasOps ? 1 : 0)} className="px-4 py-16 text-center">
                      <div className="text-sm font-medium text-[#dc2626]">加载排期列表失败</div>
                      <button
                        type="button"
                        className="f-btn mt-3 h-10 px-4 text-sm"
                        onClick={() => listQuery.refetch()}
                      >
                        重试
                      </button>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={COLUMNS.length + 1 + (hasOps ? 1 : 0)}
                      className="px-4 py-16 text-center text-sm text-disabled"
                    >
                      暂无排期数据,点右上角「新增」或「导入排期」添加排期行
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <ScheduleRowTr
                      key={r.ID}
                      row={r}
                      fz={fz}
                      expanded={expandedId === r.ID}
                      canProduce={canProduce}
                      canEdit={canImport}
                      canDelete={canDelete}
                      onToggle={() =>
                        setExpandedId((id) => (id === r.ID ? null : r.ID))
                      }
                      on生产={() => pick生产(r)}
                      on编辑={() => openEdit(r)}
                      on删除={() => setDelRow(r)}
                      on搜关联MA={(ma) => {
                        setPage(1);
                        setKeywordInput(ma);
                        setKeyword(ma);
                      }}
                      on打开BOM={(row) => {
                        // 已建 BOM → 直接查看;未建 → 带 品名/客户/PO/单类型/关联MA 跳 BOM物料设置 建档(与生产下单同口径)
                        if (row.BOM款号) {
                          navigate(`/bom-setup?款号=${encodeURIComponent(row.BOM款号)}`);
                        } else {
                          navigate(
                            `/bom-setup?款号=${encodeURIComponent(row.货号 ?? "")}` +
                              `&品名=${encodeURIComponent(row.品名 ?? "")}` +
                              `&客户名称=${encodeURIComponent(row.排期客户 ?? row.客户名称 ?? "")}` +
                              `&return=${encodeURIComponent("/scheduling")}` +
                              (row.PO号 ? `&po=${encodeURIComponent(row.PO号)}` : "") +
                              // 实单跳入:BOM 页自动切实单版 + 预选关联 MA
                              (row.单类型 ? `&单类型=${encodeURIComponent(row.单类型)}` : "") +
                              (row.关联MA货号 ? `&关联MA货号=${encodeURIComponent(row.关联MA货号)}` : ""),
                          );
                        }
                      }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* 分页底栏 */}
          <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-1.5 text-sm text-[#5f6b7d]">
            <div className="flex items-center gap-3">
              <span>共 {total} 条</span>
              <SearchSelect
                ariaLabel="每页条数"
                className="h-8 w-28 text-sm"
                value={String(pageSize)}
                options={[50, 100, 200, 500].map((s) => ({
                  value: String(s),
                  label: `每页 ${s} 条`,
                }))}
                onChange={(v) => {
                  setPage(1);
                  setPageSize(Number(v));
                }}
              />
            </div>
            <div className="flex items-center gap-2">
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
                第 {page} / {totalPages} 页
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
            </div>
          </div>
        </div>
      )}

      <ScheduleImportDialog
        open={importing}
        onImport={(cust, fn, rs) => schedulingApi.import(cust, fn, rs)}
        onClose={() => setImporting(false)}
        onDone={refreshAll}
      />
      <ScheduleBatchesDialog
        open={showBatches}
        onClose={() => setShowBatches(false)}
        onChanged={refreshAll}
      />
      <ScheduleProductionDialog ctx={prodCtx} onClose={() => setProdCtx(null)} />
      <ScheduleStatusReviewDialog
        open={showReview}
        isManager={isManager}
        onClose={() => setShowReview(false)}
      />
      <ScheduleRowEditDialog
        key={editOpen ? `open-${editRow?.ID ?? "new"}` : "closed"}
        open={editOpen}
        row={editRow}
        customers={customers}
        saving={saving}
        onClose={() => setEditOpen(false)}
        onSave={(b) => void onSaveRow(b)}
      />
      <ConfirmDialog
        open={delRow !== null}
        onClose={() => setDelRow(null)}
        title={`确认删除排期行 [${delRow ? delRow.货号 || delRow.PO号 || delRow.ID : ""}]?`}
        onConfirm={() => {
          const r = delRow;
          setDelRow(null);
          if (r) void onDeleteRow(r);
        }}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}

function ScheduleRowTr({
  row: r,
  fz,
  expanded,
  canProduce,
  canEdit,
  canDelete,
  onToggle,
  on生产,
  on编辑,
  on删除,
  on搜关联MA,
  on打开BOM,
}: {
  row: ScheduleRow;
  fz: ColumnFreeze;
  expanded: boolean;
  canProduce: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onToggle: () => void;
  on生产: () => void;
  on编辑: () => void;
  on删除: () => void;
  on搜关联MA?: (ma货号: string) => void;
  on打开BOM?: (r: ScheduleRow) => void;
}) {
  return (
    <>
      <tr
        className="group cursor-pointer border-b border-black/6 transition-colors hover:bg-black/[0.04]"
        onClick={onToggle}
        onDoubleClick={canEdit ? on编辑 : undefined}
        title={canEdit ? "单击展开原始数据,双击编辑" : "单击展开原始数据"}
      >
        <td
          className={cn(
            "px-3 py-1.5 text-disabled",
            fz.frozen(0) && "bg-white group-hover:bg-[#f2f4f3]",
            fz.boundary(0) && "shadow-[inset_-2px_0_0_#dfe7e1]",
          )}
          style={fz.cell(0)}
        >
          {expanded ? <CaretDown className="h-4 w-4" /> : <CaretRight className="h-4 w-4" />}
        </td>
        {COLUMNS.map((c, i) => (
          <td
            key={c.key}
            className={cn(
              "max-w-44 truncate px-4 py-1.5 text-[#3d4a5c]",
              c.num && "f-mono text-right",
              ["货号", "PO号", "客PO", "接单日期", "走货期", "验货期"].includes(c.key) && "f-mono",
              c.key === "货号" && "font-semibold text-[#1a2330]",
              fz.frozen(i + 1) && "bg-white group-hover:bg-[#f2f4f3]",
              fz.boundary(i + 1) && "shadow-[inset_-2px_0_0_#dfe7e1]",
            )}
            style={fz.cell(i + 1)}
          >
            {c.key === "状态" ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <StatusTag 状态={r.状态} />
                {r.待审新状态 && (
                  <span
                    className="inline-flex items-center rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2 py-0.5 text-xs font-semibold text-[#b45309]"
                    title="状态修改已提交,待经理审核"
                  >
                    →{r.待审新状态}·待审
                  </span>
                )}
              </span>
            ) : c.key === "货号" ? (
              /* 单类型徽标:-MA 结尾=MA单(全部物料下单做半成品);实单→关联同客户 MA 单,点击按 MA 货号查 */
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {txt(r.货号)}
                {r.单类型 === "MA单" ? (
                  <span
                    className="inline-flex items-center rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#15803d]"
                    title="MA单:对里面所有物料下单,做成半成品"
                  >
                    MA单
                  </span>
                ) : r.关联MA货号 ? (
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-shadow hover:ring-2 hover:ring-current",
                      r.关联MA状态
                        ? "border-[#1d4ed8]/50 bg-[#1d4ed8]/10 text-[#1d4ed8]"
                        : "border-black/20 bg-black/[0.04] text-[#5f6b7d]",
                    )}
                    title={
                      r.关联MA状态
                        ? `关联MA单 ${r.关联MA货号}(${r.关联MA状态}):实单用半成品做成成品,点击查看该 MA 单`
                        : `关联MA单 ${r.关联MA货号} 尚未在排期中,点击按货号查`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      on搜关联MA?.(r.关联MA货号!);
                    }}
                  >
                    →{r.关联MA货号}
                    {r.关联MA状态 ? `·${r.关联MA状态}` : "·未排期"}
                  </button>
                ) : null}
                {/* BOM 关联徽标:BOM 业务键=货号(一个 BOM 可供多单用);未建→去建,已建→查看 */}
                {r.BOM款号 ? (
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-shadow hover:ring-2 hover:ring-current",
                      r.已绑本PO
                        ? "border-[#16a34a]/50 bg-[#16a34a]/10 text-[#15803d]"
                        : "border-[#0891b2]/50 bg-[#0891b2]/10 text-[#0e7490]",
                    )}
                    title={
                      r.已绑本PO
                        ? `BOM 已绑定本 PO(${r.PO号 ?? ""}),共绑 ${r.绑定PO数 ?? 0} 个 PO,点击查看 BOM`
                        : `已有 BOM(共绑 ${r.绑定PO数 ?? 0} 个 PO,未绑本 PO,生产下单时自动绑定),点击查看 BOM`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      on打开BOM?.(r);
                    }}
                  >
                    BOM{r.已绑本PO ? "·已绑PO" : ""}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2 py-0.5 text-xs font-semibold text-[#b45309] transition-shadow hover:ring-2 hover:ring-current"
                    title="该货号还没建 BOM,点击去 BOM物料设置 建档(带上本行 PO)"
                    onClick={(e) => {
                      e.stopPropagation();
                      on打开BOM?.(r);
                    }}
                  >
                    未建BOM
                  </button>
                )}
              </span>
            ) : (
              cellValue(r, c.key)
            )}
          </td>
        ))}
        {(canProduce || canEdit || canDelete) && (
          <td
            className={cn(
              "px-4 py-1.5",
              fz.frozen(COLUMNS.length + 1) && "bg-white group-hover:bg-[#f2f4f3]",
              fz.boundary(COLUMNS.length + 1) && "shadow-[inset_-2px_0_0_#dfe7e1]",
            )}
            style={fz.cell(COLUMNS.length + 1)}
          >
            <div className="flex items-center gap-3 whitespace-nowrap">
              {canProduce && r.货号 && (
                <button
                  type="button"
                  className="text-sm font-medium text-[#15803d] hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    on生产();
                  }}
                >
                  生产下单
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="text-sm font-medium text-[#1d4ed8] hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    on编辑();
                  }}
                >
                  编辑
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="text-sm font-medium text-[#dc2626] hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    on删除();
                  }}
                >
                  删除
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="border-b border-black/6">
          <td
            colSpan={COLUMNS.length + 1 + (canProduce || canEdit || canDelete ? 1 : 0)}
            className="bg-black/[0.02] p-3"
          >
            <RawDataPanel json={r.原始数据} />
          </td>
        </tr>
      )}
    </>
  );
}
