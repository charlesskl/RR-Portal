// 来料标签单(/material-label-orders;来料仓)。对照老系统 web/src/pages/materials/
// MaterialLabelOrderPage.tsx + MaterialLabelQueryPage.tsx(单据+查询双页签,DocQueryTabs)。
// 单据页签:新建/打开/保存/删除/复制单/前单/后单/审核/反审核/打印标签/关闭,
// 打印把每行按「标签数」展开成多行标签(上限 2000)。
// 查询页签:明细/汇总 + 筛选 + 导出/打印,双击明细行回单据页签打开整单(=旧版 ?open= 跳入)。
// 权限菜单:单据=来料标签单,查询=来料标签查询(MenuCatalog 实证:物料管理组;
// 后端 MaterialLabelOrderController.cs:16/18;审核位=审核,反审核位=反审核)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
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
import { materialLabelOrderApi, materialMasterApi } from "@/api/endpoints";
import type {
  MaterialCategoryNode,
  MaterialLabelDetailRow,
  MaterialLabelMaterialRow,
  MaterialLabelOrder,
  MaterialLabelSummaryRow,
} from "@/api/types";
import { fmtNum } from "@/lib/format";
import {
  expandLabelRows,
  makeBlankLine,
  validateLabelLines,
  PRINT_ROW_LIMIT,
  type LabelLine,
} from "@/lib/materialLabel";
import { getUser } from "@/lib/auth";
import { ALL_APPROVAL, ALL_CAT, buildDocQuery, monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "来料标签单";
const QUERY_MENU = "来料标签查询";

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

// ---------- 物料选择弹窗(查 /material-label-orders/materials,点行返回该物料) ----------

function MaterialPickDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: MaterialLabelMaterialRow) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["material-label", "materials", page, kw],
    queryFn: () => materialLabelOrderApi.materials({ page, size: 50, keyword: kw || undefined }),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / 50)) : 1;

  return (
    <PickerDialog open={open} onClose={onClose} title="选择物料" width="sm:max-w-[860px]">
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
          placeholder="物料编号/名称/规格/颜色"
          aria-label="物料搜索"
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
            {["物料编号", "物料名称", "规格", "颜色", "单位"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(query.data?.items ?? []).map((m) => (
            <tr
              key={m.物料编号}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(m);
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{m.物料编号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.物料名称}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.规格}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.颜色}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.单位}</td>
            </tr>
          ))}
          {query.isSuccess && (query.data?.items.length ?? 0) === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的物料
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
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
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

// ---------- 单据选择弹窗(查 /material-label-orders 列表,点行返回电脑单号) ----------

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
    queryKey: ["material-label", "list", page, kw],
    queryFn: () => materialLabelOrderApi.list(page, 50, kw),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / 50)) : 1;

  return (
    <PickerDialog open={open} onClose={onClose} title="打开来料标签单" width="sm:max-w-[860px]">
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
            {["电脑单号", "日期", "操作员", "审核", "备注一"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(query.data?.items ?? []).map((r) => (
            <tr
              key={r.ID}
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
              <td className="max-w-48 truncate px-3 py-2 text-[#3d4a5c]" title={r.备注一 ?? ""}>
                {r.备注一}
              </td>
            </tr>
          ))}
          {query.isSuccess && (query.data?.items.length ?? 0) === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的来料标签单
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
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
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

// ---------- 查询页签(对照老系统 MaterialLabelQueryPage) ----------

const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const monoStrongCls = "f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const detCol = createColumnHelper<MaterialLabelDetailRow>();
const detailTableCols = [
  detCol.accessor("日期", { header: "日期", size: 9, cell: (c) => date10(c.getValue()), meta: { tdClass: monoCls } }),
  detCol.accessor("电脑单号", {
    header: "电脑单号",
    size: 11,
    meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]" },
  }),
  detCol.accessor("物料编号", { header: "物料编号", size: 10, meta: { tdClass: monoStrongCls } }),
  detCol.accessor("物料名称", { header: "物料名称", size: 13 }),
  detCol.accessor("规格", { header: "规格", size: 10 }),
  detCol.accessor("物料类别", { header: "材料", size: 7 }),
  detCol.accessor("颜色", { header: "颜色", size: 6 }),
  detCol.accessor("单位", { header: "单位", size: 5 }),
  detCol.accessor("数量", {
    header: "数量",
    size: 6,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  detCol.accessor("标签数", {
    header: "标签数",
    size: 6,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: numCls },
  }),
  detCol.accessor("备注", { header: "备注", size: 10 }),
  detCol.accessor("审核", {
    header: "审核",
    size: 6,
    cell: (c) => (c.getValue() === "1" ? "已审核" : "未审核"),
  }),
];

const sumCol = createColumnHelper<MaterialLabelSummaryRow>();
const summaryTableCols = [
  sumCol.accessor("物料编号", { header: "物料编号", size: 10, meta: { tdClass: monoStrongCls } }),
  sumCol.accessor("物料名称", { header: "物料名称", size: 14 }),
  sumCol.accessor("物料类别", { header: "材料", size: 8 }),
  sumCol.accessor("规格", { header: "规格", size: 10 }),
  sumCol.accessor("颜色", { header: "颜色", size: 7 }),
  sumCol.accessor("单位", { header: "单位", size: 5 }),
  sumCol.accessor("数量", {
    header: "数量",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]" },
  }),
  sumCol.accessor("标签数", {
    header: "标签数",
    size: 7,
    cell: (c) => c.getValue() ?? "",
    meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right font-semibold text-[#1a2330]" },
  }),
];

// 导出列(对照老系统 detailExportCols/summaryExportCols)
const detailExportCols: ExportCol[] = [
  { title: "日期", key: "日期", fmt: (v) => String(v ?? "").slice(0, 10) },
  { title: "电脑单号", key: "电脑单号" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "物料类别" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "数量", key: "数量" },
  { title: "标签数", key: "标签数" },
  { title: "备注", key: "备注" },
  { title: "审核", key: "审核", fmt: (v) => (v === "1" ? "已审核" : "未审核") },
];
const summaryExportCols: ExportCol[] = [
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "材料", key: "物料类别" },
  { title: "规格", key: "规格" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "数量", key: "数量" },
  { title: "标签数", key: "标签数" },
];

function LabelQueryPanel({ onOpenDoc }: { onOpenDoc: (电脑单号: string) => void }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(QUERY_MENU, "打开") && !permsLoading;

  const [sub, setSub] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);
  const [类别, set类别] = useState(ALL_CAT);
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");

  const catsQuery = useQuery({
    queryKey: ["material-categories"],
    queryFn: () => materialMasterApi.categories(),
    staleTime: 5 * 60_000,
    enabled: canOpen,
  });

  const params = buildDocQuery({ keyword: kw, 类别, 审核情况, 起: range.起, 止: range.止 });

  const detailQuery = useQuery({
    queryKey: ["material-label", "query-detail", params],
    queryFn: () => materialLabelOrderApi.labelQueryDetail(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && sub === "detail",
  });
  const summaryQuery = useQuery({
    queryKey: ["material-label", "query-summary", params],
    queryFn: () => materialLabelOrderApi.labelQuerySummary(params),
    placeholderData: keepPreviousData,
    enabled: canOpen && sub === "summary",
  });
  const active = sub === "detail" ? detailQuery : summaryQuery;
  const rowCount = (active.data ?? []).length;

  const exportTarget = () =>
    sub === "detail"
      ? {
          cols: detailExportCols,
          rows: (detailQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "来料标签明细",
        }
      : {
          cols: summaryExportCols,
          rows: (summaryQuery.data ?? []) as unknown as Record<string, unknown>[],
          name: "来料标签汇总",
        };

  if (!permsLoading && !canOpen) {
    return (
      <div className="f-panel p-6">
        <DocEmpty
          icon={<Prohibit className="h-5 w-5" />}
          title="无权访问来料标签查询"
          description="缺少「来料标签查询·打开」权限,请联系管理员开通"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="f-panel flex flex-wrap items-end gap-3 p-5">
        <div className="flex gap-1">
          {[
            { label: "上月", off: -1 },
            { label: "本月", off: 0 },
            { label: "下月", off: 1 },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              className="f-btn h-10 px-3.5 text-sm"
              onClick={() => setRange(monthRange(m.off))}
            >
              {m.label}
            </button>
          ))}
        </div>
        <FormField label="起">
          <Input
            type="date"
            className={inputCls}
            aria-label="起"
            value={range.起}
            onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
          />
        </FormField>
        <FormField label="止">
          <Input
            type="date"
            className={inputCls}
            aria-label="止"
            value={range.止}
            onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
          />
        </FormField>
        <FormField label="审核情况">
          <SearchSelect
            ariaLabel="审核情况"
            className={cn(inputCls, "w-28 rounded-md border")}
            value={审核情况}
            options={[ALL_APPROVAL, "已审核", "未审核"].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set审核情况(v)}
          />
        </FormField>
        <FormField label="物料类别">
          <SearchSelect
            ariaLabel="物料类别"
            className={cn(inputCls, "w-40 rounded-md border")}
            value={类别}
            options={[
              { value: ALL_CAT, label: "所有类别" },
              ...(catsQuery.data ?? [])
                .filter((c: MaterialCategoryNode) => c.类别)
                .map((c: MaterialCategoryNode) => ({ value: c.类别!, label: `${c.类别}(${c.数量})` })),
            ]}
            onChange={(v) => set类别(v)}
          />
        </FormField>
        <FormField label="关键字">
          <Input
            className={cn(inputCls, "w-60")}
            aria-label="关键字"
            placeholder="电脑单号/物料编号/名称/规格"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKw(kwInput.trim())}
          />
        </FormField>
        <button
          type="button"
          className="f-btn f-btn-cyan h-10 px-5 text-sm"
          onClick={() => setKw(kwInput.trim())}
        >
          查询
        </button>
        <button
          type="button"
          className="f-btn h-10 px-4 text-sm"
          onClick={() => {
            const { cols, rows, name } = exportTarget();
            if (!rows.length) return;
            downloadCsv(`${name}.csv`, cols, rows);
          }}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn h-10 px-4 text-sm"
          onClick={() => {
            const { cols, rows, name } = exportTarget();
            if (!rows.length) return;
            printTable(`${name}查询`, cols, rows);
          }}
        >
          <Printer className="h-4 w-4" />
          打印
        </button>
        <span className="text-sm text-[#5f6b7d]">提示:双击明细行可打开来料标签单</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { key: "detail" as const, label: "明细查询" },
            { key: "summary" as const, label: "汇总查询" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                sub === t.key
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <DensitySwitch className="ml-auto" />
      </div>

      {sub === "detail" ? (
        <QueryTable
          columns={detailTableCols}
          rows={detailQuery.data ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          onRetry={() => active.refetch()}
          errorMessage="加载来料标签查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={1500}
          onRowDoubleClick={(r) => r.电脑单号 && onOpenDoc(r.电脑单号)}
          rowTitle={(r) => `双击打开来料标签单 ${r.电脑单号 ?? ""}`}
          footer={`共 ${rowCount} 条,双击行打开来料标签单整单`}
        />
      ) : (
        <QueryTable
          columns={summaryTableCols}
          rows={summaryQuery.data ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          onRetry={() => active.refetch()}
          errorMessage="加载来料标签查询失败,请重试"
          emptyIcon={<Prohibit className="h-5 w-5" />}
          emptyDescription="当前筛选条件下没有记录,试试放宽日期区间或清空关键字"
          minWidth={900}
          footer={`共 ${rowCount} 条`}
        />
      )}
    </div>
  );
}

// ---------- 单据页签 ----------

export default function MaterialLabelOrderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");

  const [tab, setTab] = useState<"doc" | "query">("doc");
  const [form, setFormState] = useState({ 日期: today(), 备注一: "", 备注二: "" });
  const [lines, setLines] = useState<LabelLine[]>([makeBlankLine(1)]);
  const [opened, setOpened] = useState<MaterialLabelOrder | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | "audit" | "reverse" | null>(null);
  const [materialPickOpen, setMaterialPickOpen] = useState(false);
  const [orderPickOpen, setOrderPickOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const applyOrder = useCallback((order: MaterialLabelOrder) => {
    setFormState({
      日期: date10(order.日期) || today(),
      备注一: order.备注一 ?? "",
      备注二: order.备注二 ?? "",
    });
    const loaded = (order.明细 ?? []).map((line, index) => ({
      ...makeBlankLine(index + 1),
      ...line,
      key: index + 1,
      序号: index + 1,
    }));
    setLines(loaded.length ? loaded : [makeBlankLine(1)]);
    setOpened(order);
  }, []);

  const openOrder = useCallback(
    async (orderNo: string) => {
      try {
        const order = await materialLabelOrderApi.get(orderNo);
        applyOrder(order);
        setTab("doc");
      } catch (e) {
        notify(errMsg(e) || "打开来料标签单失败", "err");
      }
    },
    [applyOrder, notify],
  );

  // 从查询报表跳入:URL ?open=<电脑单号> 自动打开对应单据(仅首次;对照老系统)。
  // 渲染期消费参数(setState 引用比对模式,同 MaterialIssuePage ?doc=),effect 只清参数;
  // 取数走 openQuery(渲染期按引用套用,同 useFirstDoc)
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
    queryKey: ["material-label", "open", openNo],
    queryFn: () => materialLabelOrderApi.get(openNo!),
    enabled: !!openNo,
  });
  const [appliedOpen, setAppliedOpen] = useState<MaterialLabelOrder | undefined>(undefined);
  if (openQuery.data && openQuery.data !== appliedOpen) {
    setAppliedOpen(openQuery.data);
    applyOrder(openQuery.data);
    setTab("doc");
  }

  const reset = useCallback(() => {
    setFormState({ 日期: today(), 备注一: "", 备注二: "" });
    setLines([makeBlankLine(1)]);
    setOpened(null);
  }, []);

  const save = async () => {
    if (readOnly || !canSave || mutating) return;
    const issue = validateLabelLines(lines);
    if (issue) {
      notify(issue, "err");
      return;
    }
    setBusy("save");
    try {
      const printable = lines.filter((l) => l.物料编号.trim());
      const payload = {
        日期: form.日期 || today(),
        备注一: form.备注一,
        备注二: form.备注二,
        明细: printable.map((line, index) => ({
          物料编号: line.物料编号.trim(),
          物料名称: line.物料名称 ?? undefined,
          规格: line.规格 ?? undefined,
          颜色: line.颜色 ?? undefined,
          单位: line.单位 ?? undefined,
          数量: Number(line.数量),
          标签数: Number(line.标签数),
          备注: line.备注 ?? undefined,
          序号: index + 1,
        })),
      };
      if (opened?.电脑单号) {
        const saved = await materialLabelOrderApi.update(opened.电脑单号, payload as never);
        applyOrder(saved);
      } else {
        const saved = await materialLabelOrderApi.create(payload as never);
        const created = await materialLabelOrderApi.get(saved.电脑单号);
        applyOrder(created);
      }
      notify("来料标签单已保存", "ok");
      void qc.invalidateQueries({ queryKey: ["material-label"] });
    } catch (e) {
      notify(errMsg(e) || "保存来料标签单失败", "err");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!opened?.电脑单号 || audited || !can(MENU, "删除") || mutating) return;
    setBusy("delete");
    try {
      await materialLabelOrderApi.remove(opened.电脑单号);
      notify("来料标签单已删除", "ok");
      reset();
      void qc.invalidateQueries({ queryKey: ["material-label"] });
    } catch (e) {
      notify(errMsg(e) || "删除来料标签单失败", "err");
    } finally {
      setBusy(null);
    }
  };

  const copyDoc = () => {
    if (!opened || !canSave || mutating) return;
    setOpened(null);
    setLines((current) =>
      current.map((line, index) => ({ ...line, ID: undefined, key: index + 1, 序号: index + 1 })),
    );
    notify("已复制为未保存新单", "ok");
  };

  const moveAdjacent = async (direction: "previous" | "next") => {
    if (!opened?.电脑单号 || mutating) return;
    try {
      const order = await materialLabelOrderApi.adjacent(opened.电脑单号, direction);
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
      if (reverse) await materialLabelOrderApi.reverseAudit(orderNo);
      else await materialLabelOrderApi.audit(orderNo);
      applyOrder(await materialLabelOrderApi.get(orderNo));
      notify(reverse ? "已反审核" : "已审核", "ok");
      void qc.invalidateQueries({ queryKey: ["material-label"] });
    } catch (e) {
      notify(errMsg(e) || (reverse ? "反审核失败" : "审核失败"), "err");
    } finally {
      setBusy(null);
    }
  };

  // 打印标签:每行按 标签数 展开(对照老系统 print();总量上限 2000)
  const printLabels = () => {
    const printable = lines.filter((l) => l.物料编号.trim());
    if (!printable.length) {
      notify("没有可打印的明细", "err");
      return;
    }
    const totalLabels = printable.reduce(
      (sum, line) => sum + (Number.isInteger(line.标签数) ? line.标签数 : 0),
      0,
    );
    if (totalLabels <= 0) {
      notify("标签数合计为 0，无法打印", "err");
      return;
    }
    if (totalLabels > PRINT_ROW_LIMIT) {
      notify(`标签数合计 ${totalLabels} 超过 ${PRINT_ROW_LIMIT}，请分批打印`, "err");
      return;
    }
    printTable(
      `来料标签单 ${opened?.电脑单号 ?? "未保存"}`,
      [
        { title: "序号", key: "序号" },
        { title: "物料编号", key: "物料编号" },
        { title: "物料名称", key: "物料名称" },
        { title: "规格", key: "规格" },
        { title: "颜色", key: "颜色" },
        { title: "单位", key: "单位" },
        { title: "数量", key: "数量" },
        { title: "标签序号", key: "标签序号" },
      ],
      expandLabelRows(lines),
    );
  };

  const updateLine = (key: number, patch: Partial<LabelLine>) => {
    if (readOnly || mutating) return;
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch, key: l.key } : l)));
  };

  // 选物料回填:已存在同编号(大小写不敏感)则警告;否则合并到末尾并补一空行(对照老系统 pickMaterial)
  const pickMaterial = (material: MaterialLabelMaterialRow) => {
    if (readOnly || mutating) return;
    setLines((current) => {
      const code = material.物料编号.trim();
      if (current.some((l) => l.物料编号.trim().toLocaleLowerCase() === code.toLocaleLowerCase())) {
        notify(`物料 [${code}] 已在明细中`, "err");
        return current;
      }
      const newLine: LabelLine = {
        ...makeBlankLine(0),
        物料编号: code,
        物料名称: material.物料名称,
        规格: material.规格,
        颜色: material.颜色,
        单位: material.单位,
      };
      const existing = current.filter((l) => l.物料编号.trim());
      const merged = [...existing, newLine].map((l, index) => ({ ...l, key: index + 1, 序号: index + 1 }));
      return [...merged, makeBlankLine(merged.length + 1)];
    });
  };

  const removeLine = (key: number) => {
    if (readOnly || mutating) return;
    setLines((current) => {
      const next = current
        .filter((l) => l.key !== key)
        .map((l, index) => ({ ...l, key: index + 1, 序号: index + 1 }));
      return next.length ? next : [makeBlankLine(1)];
    });
  };

  const totals = useMemo(
    () =>
      lines.reduce(
        (total, line) => ({
          数量: total.数量 + Number(line.数量 || 0),
          标签数: total.标签数 + Number(line.标签数 || 0),
        }),
        { 数量: 0, 标签数: 0 },
      ),
    [lines],
  );

  // ---------- 工具条(对照老系统 extra 按钮组;perm 位显式声明) ----------
  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, disabled: mutating, onClick: () => { if (!mutating) reset(); } },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, disabled: mutating, onClick: () => setOrderPickOpen(true) },
    {
      key: "save",
      label: "保存",
      icon: FloppyDisk,
      perm: "保存",
      primary: true,
      disabled: readOnly || mutating,
      disabledTitle: audited ? "单据已审核" : !canSave ? "无保存权限" : undefined,
      onClick: () => void save(),
    },
    {
      key: "del",
      label: "删除",
      icon: Trash,
      perm: "删除",
      danger: true,
      disabled: !opened?.电脑单号 || audited || mutating,
      disabledTitle: !opened?.电脑单号 ? "先打开单据" : audited ? "单据已审核" : undefined,
      onClick: () => setDeleteOpen(true),
    },
    { key: "copy", label: "复制单", icon: Copy, perm: "保存", disabled: !opened || mutating, disabledTitle: !opened ? "先打开单据" : undefined, onClick: copyDoc },
    {
      key: "prev",
      label: "前单",
      icon: CaretLeft,
      disabled: !opened?.电脑单号 || mutating,
      disabledTitle: !opened?.电脑单号 ? "先打开单据" : undefined,
      onClick: () => void moveAdjacent("previous"),
    },
    {
      key: "next",
      label: "后单",
      icon: CaretRight,
      disabled: !opened?.电脑单号 || mutating,
      disabledTitle: !opened?.电脑单号 ? "先打开单据" : undefined,
      onClick: () => void moveAdjacent("next"),
    },
  ];
  const auditActions: DocAction[] = [
    {
      key: "audit",
      label: "审核",
      icon: CheckCircle,
      perm: "审核",
      success: true,
      disabled: !opened?.电脑单号 || audited || mutating,
      disabledTitle: !opened?.电脑单号 ? "先打开单据" : audited ? "单据已审核" : undefined,
      onClick: () => void changeAudit(),
    },
    {
      key: "unaudit",
      label: "反审核",
      icon: ArrowCounterClockwise,
      perm: "反审核",
      danger: true,
      disabled: !opened?.电脑单号 || !audited || mutating,
      disabledTitle: !opened?.电脑单号 ? "先打开单据" : "单据未审核",
      onClick: () => void changeAudit(true),
    },
  ];
  const tailActions: DocAction[] = [
    { key: "print", label: "打印标签", icon: Printer, perm: "打印", disabled: mutating, onClick: printLabels },
    {
      key: "close",
      label: "关闭",
      icon: X,
      danger: true,
      disabled: mutating,
      onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")),
    },
  ];

  if (!permsLoading && !canOpen && tab === "doc") {
    // 单据页签无「打开」位时整页提示(查询页签有自己的权限提示)
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「来料标签单·打开」权限,请联系管理员开通"
          />
          <div className="mt-3 text-center">
            <button type="button" className="f-btn px-5" onClick={() => setTab("query")}>
              前往来料标签查询
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 + 单据/查询页签 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          来料标签单
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
            { key: "doc" as const, label: "来料标签单" },
            { key: "query" as const, label: "来料标签查询" },
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
        <LabelQueryPanel onOpenDoc={(no) => void openOrder(no)} />
      ) : (
        <>
          {/* 操作栏:编辑 / 审核 / 打印关闭 三组,组间分隔线 */}
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

          {/* 明细编辑网格(对照老系统列:删除|序号|物料编号|物料名称|规格|颜色|单位|数量|标签数|备注) */}
          <div className="f-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
              <button
                type="button"
                className="f-btn h-9 px-3.5 text-sm"
                disabled={readOnly || mutating}
                onClick={() => setMaterialPickOpen(true)}
              >
                选物料加行
              </button>
              <span className="text-sm text-[#5f6b7d]">点明细行「物料编号」也可打开物料选择</span>
            </div>
            <div className="max-h-[46vh] overflow-auto">
              <table data-freeze className="w-full min-w-[1200px] text-[15px]">
                <thead>
                  <tr className="border-b border-black/8">
                    {["删除", "序号", "物料编号", "物料名称", "规格", "颜色", "单位", "数量", "标签数", "备注"].map(
                      (h) => (
                        <th
                          key={h}
                          className={cn(
                            pickerThCls,
                            (h === "数量" || h === "标签数") && "text-right",
                            h === "删除" && "text-center",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((r, i) => (
                    <tr key={r.key} className="border-b border-black/6 last:border-0">
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
                          className={cn(inputCls, "h-9 w-36")}
                          aria-label="物料编号"
                          value={r.物料编号}
                          readOnly
                          disabled={readOnly || mutating}
                          onClick={() => !(readOnly || mutating) && setMaterialPickOpen(true)}
                        />
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称 ?? ""}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.规格 ?? ""}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色 ?? ""}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.单位 ?? ""}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          aria-label="数量"
                          className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                          disabled={readOnly || mutating}
                          value={r.数量}
                          onChange={(e) => updateLine(r.key, { 数量: Number(e.target.value || 0) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          aria-label="标签数"
                          className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                          disabled={readOnly || mutating}
                          value={r.标签数}
                          onChange={(e) => updateLine(r.key, { 标签数: Number(e.target.value || 0) })}
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
            {/* 合计(对照老系统 Statistic:数量合计/标签数合计) */}
            <div className="flex gap-10 border-t border-black/8 px-4 py-3">
              <span className="text-sm text-[#5f6b7d]">
                数量合计:<span className="f-mono text-base font-bold text-[#1a2330]">{fmtNum(totals.数量, 2)}</span>
              </span>
              <span className="text-sm text-[#5f6b7d]">
                标签数合计:<span className="f-mono text-base font-bold text-[#1a2330]">{fmtNum(totals.标签数, 0)}</span>
              </span>
            </div>
          </div>
        </>
      )}

      <MaterialPickDialog open={materialPickOpen} onPick={pickMaterial} onClose={() => setMaterialPickOpen(false)} />
      <OrderPickDialog
        open={orderPickOpen}
        onPick={(no) => void openOrder(no)}
        onClose={() => setOrderPickOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该来料标签单?"
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
