import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  PaperPlaneRight,
  Plus,
  Printer,
  Prohibit,
  Rocket,
  Trash,
} from "@phosphor-icons/react";
import { productionApi, schedulingApi, stylesApi } from "@/api/endpoints";
import type {
  MoLine,
  ProductionGoodsLine,
  ProductionGoodsRow,
  ProductionHeader,
  ProductionMatRow,
  ProductionNoticeCreate,
  ProductionProcRow,
  ProductionSemiNeed,
  StyleBomLine,
} from "@/api/types";
import { fmtDate, fmtNum, txt } from "@/lib/format";
import { formatQty } from "@/lib/fraction";
import { getUser } from "@/lib/auth";
import { invalidateCrossPage } from "@/lib/crossPage";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocHeaderCard, type HeaderField } from "@/components/doc/DocHeaderCard";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocError } from "@/components/doc/DocError";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { ImageNotesPanel } from "@/components/doc/ImageNotesPanel";
import { SearchSelect } from "@/components/doc/SearchSelect";
import ProductionStartupDialog from "@/pages/ProductionStartupDialog";
import { usePerms } from "@/hooks/usePerms";

// 权限菜单名:与后端 MenuCatalog / 老系统 web 的 MENU 常量一致(不是菜单树叶子 label)
const MENU = "生产制单";

const approved = (h?: ProductionHeader | null) => h?.审核 === "1";

// 价格脱敏:无「单价」权限(或后端已剥离为 null)时显示 ***
const money = (v: number | string | null | undefined, hidden: boolean) =>
  hidden || v === null || v === undefined || v === "" ? "***" : String(v);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

let rowSeq = 1;
const uid = () => rowSeq++;

// ---------- 编辑态类型 ----------

interface HeaderFormState {
  生产单号: string;
  订单类型: string;
  客户款号: string;
  客户编号: string;
  客户名称: string;
  交货日期: string;
  标识: string;
  接单数量: string;
  装箱方式: string;
  订单总箱数: string;
  下单日期: string;
  跟单员: string;
  默认单价: string;
  合同号: string;
  备注: string;
}

const emptyForm = (): HeaderFormState => ({
  生产单号: "",
  订单类型: "",
  客户款号: "",
  客户编号: "",
  客户名称: "",
  交货日期: "",
  标识: "正单",
  接单数量: "",
  装箱方式: "",
  订单总箱数: "",
  下单日期: new Date().toISOString().slice(0, 10),
  跟单员: "",
  默认单价: "",
  合同号: "",
  备注: "",
});

interface QtyEditLine {
  key: number;
  颜色: string;
  尺码: string;
  数量: string;
}

interface GoodsEditRow {
  key: number;
  货号: string;
  BOM款号: string;
  款号名称: string;
  比例: string;
  分析: boolean;
  数量明细: QtyEditLine[];
}

const newGoodsRow = (): GoodsEditRow => ({
  key: uid(),
  货号: "",
  BOM款号: "",
  款号名称: "",
  比例: "",
  分析: false,
  数量明细: [],
});

const numOr = (s: string): number | undefined =>
  s.trim() === "" ? undefined : Number(s);

const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");

// ---------- 审核徽章 ----------

function AuditBadge({ header }: { header?: ProductionHeader | null }) {
  return approved(header) ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/60 bg-[#16a34a]/10 px-4 py-1.5 text-sm font-semibold text-[#15803d] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_12px_-2px_rgb(22_163_74/0.35)]">
      <span className="f-pulse h-2 w-2 rounded-full bg-[#16a34a]" />
      已审核
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/5 px-4 py-1.5 text-sm font-semibold text-[#5f6b7d]">
      未审核
    </span>
  );
}

// ---------- 表头表单(新建态 / 未审核查看态可改) ----------

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function HeaderForm({
  form,
  setForm,
  isView,
  制单日期,
  制单人,
  合计数量,
  on合同号Blur,
}: {
  form: HeaderFormState;
  setForm: (patch: Partial<HeaderFormState>) => void;
  isView: boolean; // 查看态(已打开单据):生产单号不可改
  制单日期: string;
  制单人: string;
  合计数量: number;
  // 新建态专用:合同号离焦后按排期实单给无数量的货号行带数量
  on合同号Blur?: () => void;
}) {
  const bind = (k: keyof HeaderFormState) => ({
    value: form[k],
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => setForm({ [k]: e.target.value }),
  });
  return (
    <div className="f-panel p-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        <FormField label="生产单号">
          <Input
            className={inputCls}
            disabled={isView}
            placeholder={isView ? "" : "留空保存后自动生成"}
            {...bind("生产单号")}
          />
        </FormField>
        <FormField label="订单类型">
          <SearchSelect
            ariaLabel="订单类型"
            className={cn(inputCls, "rounded-md border")}
            value={form.订单类型}
            options={["正式单", "样品单", "返单"].map((v) => ({ value: v, label: v }))}
            placeholder="(未选)"
            clearLabel="(未选)"
            onChange={(v) => setForm({ 订单类型: v })}
          />
        </FormField>
        <FormField label="客户款号">
          <Input className={inputCls} {...bind("客户款号")} />
        </FormField>
        <FormField label="制单日期">
          <Input className={inputCls} value={制单日期} disabled />
        </FormField>
        <FormField label="客户编号">
          <Input className={inputCls} {...bind("客户编号")} />
        </FormField>
        <FormField label="客户名称">
          <Input className={inputCls} {...bind("客户名称")} />
        </FormField>
        <FormField label="交货日期">
          <Input type="date" className={inputCls} {...bind("交货日期")} />
        </FormField>
        <FormField label="标识">
          <Input className={inputCls} {...bind("标识")} />
        </FormField>
        <FormField label="接单数量">
          <Input
            type="number"
            min={0}
            className={inputCls}
            placeholder={isView ? "" : `默认同明细合计 ${合计数量}`}
            {...bind("接单数量")}
          />
        </FormField>
        <FormField label="装箱方式">
          <Input className={inputCls} placeholder="PCS/CTN" {...bind("装箱方式")} />
        </FormField>
        <FormField label="订单总箱数">
          <Input type="number" min={0} className={inputCls} {...bind("订单总箱数")} />
        </FormField>
        <FormField label="下单日期">
          <Input type="date" className={inputCls} {...bind("下单日期")} />
        </FormField>
        <FormField label="跟单员">
          <Input className={inputCls} {...bind("跟单员")} />
        </FormField>
        <FormField label="默认单价">
          <Input className={inputCls} placeholder="HK LCL" {...bind("默认单价")} />
        </FormField>
        <FormField label="制单人">
          <Input className={inputCls} value={制单人} disabled />
        </FormField>
        <FormField label="合同号">
          <Input className={inputCls} {...bind("合同号")} onBlur={on合同号Blur} />
        </FormField>
      </div>
      <div className="mt-4">
        <FormField label="订单备注">
          <textarea
            className={cn(inputCls, "h-auto min-h-16 w-full rounded-md border px-3 py-2")}
            rows={2}
            {...bind("备注")}
          />
        </FormField>
      </div>
    </div>
  );
}

// ---------- 货号明细:查看态(只读 + 行选择 + 选中行色码数量) ----------

const col = createColumnHelper<ProductionGoodsRow>();

function GoodsViewTable({
  rows,
  selected货号,
  onSelect,
}: {
  rows: ProductionGoodsRow[];
  selected货号: string | null;
  onSelect: (货号: string) => void;
}) {
  const columns = useMemo(
    () => [
      col.display({
        id: "seq",
        header: "序号",
        size: 56,
        cell: (c) => <span className="text-disabled">{c.row.index + 1}</span>,
      }),
      col.accessor("货号", {
        header: "货号",
        size: 190,
        cell: (c) => (
          <span className="f-mono font-semibold text-[#1a2330]">{txt(c.getValue())}</span>
        ),
      }),
      col.accessor("BOM款号", {
        header: "BOM款号",
        size: 170,
        cell: (c) => <span className="f-mono">{txt(c.getValue())}</span>,
      }),
      col.accessor("款号名称", {
        header: "款号名称",
        size: 280,
        cell: (c) => txt(c.getValue()),
      }),
      col.accessor("数量", {
        header: "数量",
        size: 130,
        cell: (c) => (
          <span className="f-mono block text-right text-[20px] font-bold text-[#1a2330]">
            {fmtNum(c.getValue(), 0)}
          </span>
        ),
      }),
      col.accessor("比例", {
        header: "比例",
        size: 100,
        cell: (c) => (
          <span className="f-mono block text-right">{fmtNum(c.getValue(), 2)}</span>
        ),
      }),
      col.accessor("分析", {
        header: "分析",
        size: 80,
        cell: (c) =>
          c.getValue() ? (
            <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-medium text-[#5f6b7d]">
              参与
            </span>
          ) : (
            <span className="text-disabled">-</span>
          ),
      }),
    ],
    [],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const total = rows.reduce((s, r) => s + (r.数量 ?? 0), 0);

  return (
    <div className="f-panel overflow-hidden">
      <table className="w-full text-[15px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-black/8 bg-black/[0.03]">
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{ width: h.getSize() }}
                  className={cn(
                    "f-label px-4 py-3 text-left font-medium whitespace-nowrap normal-case",
                    (h.column.id === "数量" || h.column.id === "比例") && "text-right",
                  )}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => r.original.货号 && onSelect(r.original.货号)}
              className={cn(
                "h-12 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]",
                r.original.货号 === selected货号 && "bg-[#16a34a]/[0.07]",
              )}
            >
              {r.getVisibleCells().map((c) => (
                <td key={c.id} className="px-4 py-2 text-[#3d4a5c]">
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-black/[0.03]">
            <td colSpan={4} className="f-label px-4 py-3 font-medium">
              合计({rows.length} 行)
            </td>
            <td className="f-mono px-4 py-3 text-right text-[20px] font-bold text-[#15803d]">
              {fmtNum(total, 0)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// 色码数量表(只读):查看态选中货号的 颜色x尺码 数量明细
function QtyViewTable({
  货号,
  lines,
}: {
  货号: string;
  lines: { 颜色?: string; 尺码?: string; 数量?: number }[];
}) {
  return (
    <div className="f-panel overflow-hidden">
      <div className="border-b border-black/8 px-4 py-2.5 text-sm font-medium text-[#3d4a5c]">
        颜色x尺码数量(货号 {货号 || "-"})
      </div>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            <th className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap">颜色</th>
            <th className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap">尺码</th>
            <th className="f-label px-4 py-2.5 text-right font-medium whitespace-nowrap">数量</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-4 text-center text-sm text-disabled">
                该货号没有色码数量明细
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={`${l.颜色 ?? ""}|${l.尺码 ?? ""}`} className="border-b border-black/6 last:border-0">
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(l.尺码)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                  {fmtNum(l.数量, 0)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 货号明细:新建态编辑网格 ----------

interface StyleOpt {
  value: string;
  label: string;
  款号: string;
  款式?: string;
  客户编号?: string;
  客户名称?: string;
  默认单价?: string;
  待绑定PO号?: string;
}

function GoodsEditor({
  goods,
  selectedKey,
  styleOpts,
  onSelect,
  onPatch,
  onAdd,
  onRemove,
  on货号Change,
  onBomChange,
  onQtyInput,
}: {
  goods: GoodsEditRow[];
  selectedKey: number | null;
  styleOpts: StyleOpt[];
  onSelect: (key: number) => void;
  onPatch: (key: number, patch: Partial<GoodsEditRow>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
  on货号Change: (key: number, val: string) => void;
  onBomChange: (key: number, val: string) => void;
  onQtyInput: (key: number, val: string) => void;
}) {
  const goodsQty = (g: GoodsEditRow) =>
    g.数量明细.reduce((a, l) => a + (Number(l.数量) || 0), 0);
  // BOM款号 候选 = 与该行货号「同款式」的款号;货号未匹配到款式(手输新货号)时给全部候选
  const bomOptsFor = (r: GoodsEditRow) => {
    const mine = styleOpts.find((o) => o.value === r.货号);
    if (!mine?.款式) return styleOpts;
    return styleOpts.filter((o) => o.款式 === mine.款式);
  };

  return (
    <div className="space-y-4">
      <div className="f-panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-[15px]">
          <thead>
            <tr className="border-b border-black/8 bg-black/[0.03]">
              {["序号", "货号", "BOM款号", "款号名称", "数量", "比例", "分析", "操作"].map(
                (h) => (
                  <th
                    key={h}
                    className="f-label px-3 py-2.5 text-left font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {goods.map((g, i) => (
              <tr
                key={g.key}
                onClick={() => onSelect(g.key)}
                className={cn(
                  "cursor-pointer border-b border-black/6 last:border-0 hover:bg-black/[0.04]",
                  g.key === selectedKey && "bg-[#16a34a]/[0.07]",
                )}
              >
                <td className="px-3 py-2 text-disabled">{i + 1}</td>
                <td className="px-3 py-2">
                  <Input
                    className={cn(inputCls, "h-9 w-44")}
                    placeholder="选择或输入货号"
                    aria-label="货号"
                    list={`style-opts-${g.key}`}
                    value={g.货号}
                    onChange={(e) => on货号Change(g.key, e.target.value)}
                  />
                  <datalist id={`style-opts-${g.key}`}>
                    {styleOpts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                </td>
                <td className="px-3 py-2">
                  <Input
                    className={cn(inputCls, "h-9 w-44")}
                    placeholder="按货号选择BOM款号"
                    aria-label="BOM款号"
                    list={`bom-opts-${g.key}`}
                    value={g.BOM款号}
                    onChange={(e) => onBomChange(g.key, e.target.value)}
                  />
                  <datalist id={`bom-opts-${g.key}`}>
                    {bomOptsFor(g).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                </td>
                <td className="px-3 py-2">
                  <Input
                    className={cn(inputCls, "h-9 w-44")}
                    aria-label="款号名称"
                    value={g.款号名称}
                    onChange={(e) => onPatch(g.key, { 款号名称: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    aria-label="数量"
                    className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                    value={g.数量明细.length === 0 ? "" : String(goodsQty(g))}
                    onChange={(e) => onQtyInput(g.key, e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    aria-label="比例"
                    className={cn(inputCls, "f-mono h-9 w-20 text-right")}
                    value={g.比例}
                    onChange={(e) => onPatch(g.key, { 比例: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label="分析"
                    className="h-4 w-4 accent-[#16a34a]"
                    checked={g.分析}
                    onChange={(e) => onPatch(g.key, { 分析: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#dc2626] hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(g.key);
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-black/8 px-3 py-2.5">
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            onClick={onAdd}
          >
            <Plus className="h-4 w-4" />
            添加货号
          </button>
        </div>
      </div>

    </div>
  );
}

// 选中货号的色码数量编辑表(新建态;置于「制单内容」页签,对照老系统 qtyEditor)
function QtyLinesEditor({
  row,
  onPatchQty,
  onAddQty,
  onRemoveQty,
}: {
  row: GoodsEditRow;
  onPatchQty: (gkey: number, lkey: number, patch: Partial<QtyEditLine>) => void;
  onAddQty: (gkey: number) => void;
  onRemoveQty: (gkey: number, lkey: number) => void;
}) {
  return (
    <div className="f-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/8 px-4 py-2.5">
        <span className="text-sm font-medium text-[#3d4a5c]">
          颜色x尺码数量(货号 {row.货号 || row.BOM款号 || "-"})
        </span>
        <button
          type="button"
          className="f-btn h-8 px-3 text-sm"
          onClick={() => onAddQty(row.key)}
        >
          <Plus className="h-4 w-4" />
          添加色码行
        </button>
      </div>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            {["颜色", "尺码", "数量", "操作"].map((h) => (
              <th
                key={h}
                className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row.数量明细.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-4 text-center text-sm text-disabled">
                还没有色码行,可直接在上方数量列输入总数,或点「添加色码行」
              </td>
            </tr>
          ) : (
            row.数量明细.map((l) => (
              <tr key={l.key} className="border-b border-black/6 last:border-0">
                <td className="px-4 py-2">
                  <Input
                    className={cn(inputCls, "h-9 w-36")}
                    aria-label="颜色"
                    value={l.颜色}
                    onChange={(e) =>
                      onPatchQty(row.key, l.key, { 颜色: e.target.value })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    className={cn(inputCls, "h-9 w-28")}
                    aria-label="尺码"
                    value={l.尺码}
                    onChange={(e) =>
                      onPatchQty(row.key, l.key, { 尺码: e.target.value })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    type="number"
                    min={0}
                    aria-label="色码数量"
                    className={cn(inputCls, "f-mono h-9 w-24 text-right")}
                    value={l.数量}
                    onChange={(e) =>
                      onPatchQty(row.key, l.key, { 数量: e.target.value })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#dc2626] hover:underline"
                    onClick={() => onRemoveQty(row.key, l.key)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// 工序工费表(查看态;「制单内容」页签,按选中货号过滤。照抄老系统 procRows 表:null 单价显 ***)
function ProcViewTable({ rows }: { rows: ProductionProcRow[] }) {
  return (
    <div className="f-panel overflow-hidden">
      <div className="border-b border-black/8 px-4 py-2.5 text-sm font-medium text-[#3d4a5c]">
        工序工费({rows.length})
      </div>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            {["工序号", "工序名称", "单价", "工序类型"].map((h) => (
              <th
                key={h}
                className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-4 text-center text-sm text-disabled">
                该货号没有工序
              </td>
            </tr>
          ) : (
            rows.map((p, i) => (
              <tr key={p.工序号 ?? i} className="border-b border-black/6 last:border-0">
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(p.工序号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(p.工序名称)}</td>
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">
                  {p.单价 == null ? "***" : String(p.单价)}
                </td>
                <td className="px-4 py-2">
                  {p.工序类型 ? (
                    <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-medium text-[#5f6b7d]">
                      {p.工序类型}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// 物料清单表(「物料清单」页签;对照老系统 matRows 表)。
// 查看态=已展开快照(含库存/需订/价格列,价格列按「单价」位脱敏);新建态=BOM 实时预览(仅用量列)。
function MatTable({
  rows,
  priceHidden,
}: {
  rows: ProductionMatRow[];
  priceHidden: boolean;
}) {
  return (
    <div className="f-panel overflow-x-auto">
      <table className="w-full min-w-[900px] text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            {["物料编号", "物料名称", "规格", "颜色", "单位"].map((h) => (
              <th
                key={h}
                className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
            {["总数量", "库存数量", "需订数量"].map((h) => (
              <th
                key={h}
                className="f-label px-4 py-2.5 text-right font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
            {!priceHidden &&
              ["预算单价", "金额"].map((h) => (
                <th
                  key={h}
                  className="f-label px-4 py-2.5 text-right font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            <th className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap">
              供应商
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={priceHidden ? 9 : 11}
                className="px-4 py-4 text-center text-sm text-disabled"
              >
                该货号没有物料
              </td>
            </tr>
          ) : (
            rows.map((m) => (
              <tr key={`${m.物料编号 ?? ""}|${m.颜色 ?? ""}|${m.规格 ?? ""}`} className="border-b border-black/6 last:border-0">
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(m.物料编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                  {fmtNum(m.总数量, 0)}
                </td>
                <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                  {fmtNum(m.库存数量, 0)}
                </td>
                <td className="f-mono px-4 py-2 text-right">
                  {m.需订数量 != null && m.需订数量 > 0 ? (
                    <span className="font-semibold text-[#dc2626]">{m.需订数量}</span>
                  ) : (
                    <span className="text-[#3d4a5c]">{fmtNum(m.需订数量, 0)}</span>
                  )}
                </td>
                {!priceHidden && (
                  <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                    {m.预算单价 == null ? "***" : String(m.预算单价)}
                  </td>
                )}
                {!priceHidden && (
                  <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                    {m.金额 == null ? "***" : String(m.金额)}
                  </td>
                )}
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.供应商名称)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// 半成品需求表(查看态「物料清单」页签;实单版 BOM 的半成品行 用量×数量,
// 半成品由半成品仓/装配领料,不参与采购——故不进 生产BOM物料清单,只在详情展示)
function SemiNeedTable({ rows }: { rows: ProductionSemiNeed[] }) {
  return (
    <div className="f-panel overflow-x-auto">
      <div className="border-b border-black/8 px-4 py-2.5 text-sm font-medium text-[#3d4a5c]">
        半成品需求(由半成品仓/装配领料,不参与采购)
      </div>
      <table className="w-full min-w-[760px] text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            {["物料编号", "物料名称", "规格", "颜色", "单位"].map((h) => (
              <th key={h} className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
            {["用量", "总数量"].map((h) => (
              <th key={h} className="f-label px-4 py-2.5 text-right font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={`${m.物料编号 ?? ""}|${i}`} className="border-b border-black/6 last:border-0">
              <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(m.物料编号)}</td>
              <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.物料名称)}</td>
              <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.规格)}</td>
              <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.颜色)}</td>
              <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.单位)}</td>
              <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">{formatQty(m.用量)}</td>
              <td className="f-mono px-4 py-2 text-right text-[#1a2330]">{fmtNum(m.总数量, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// BOM 实时预览表(新建态「物料清单」页签;照抄老系统 bomPreview 列:编号/名称/规格/颜色/单位/用量)
function BomPreviewTable({ rows }: { rows: StyleBomLine[] }) {
  return (
    <div className="f-panel overflow-x-auto">
      <div className="border-b border-black/8 px-4 py-2.5 text-sm font-medium text-[#3d4a5c]">
        BOM 预览({rows.length} 项 · 保存后按数量展开)
      </div>
      <table className="w-full min-w-[720px] text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            {["物料编号", "物料名称", "规格", "颜色", "单位"].map((h) => (
              <th
                key={h}
                className="f-label px-4 py-2.5 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
            <th className="f-label px-4 py-2.5 text-right font-medium whitespace-nowrap">
              BOM用量
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-4 text-center text-sm text-disabled">
                该款号没有 BOM 物料
              </td>
            </tr>
          ) : (
            rows.map((m) => (
              <tr key={`${m.物料编号 ?? ""}|${m.颜色 ?? ""}|${m.规格 ?? ""}`} className="border-b border-black/6 last:border-0">
                <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(m.物料编号)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.物料名称)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.规格)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.颜色)}</td>
                <td className="px-4 py-2 text-[#3d4a5c]">{txt(m.单位)}</td>
                <td className="f-mono px-4 py-2 text-right text-[#3d4a5c]">
                  {m.使用数量 ?? ""}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- MO单录入(独立于主单据保存;仅在已载入生产单号时可编辑/保存。照抄老系统 moTab) ----------

interface MoEditRow {
  key: number;
  接单日期: string;
  正单合同号: string;
  产品货号: string;
  产品名称: string;
  接单数量: string;
  装箱方式: string;
  订单总箱数: string;
  验货日期: string;
  备注: string;
}

const newMoRow = (): MoEditRow => ({
  key: uid(),
  接单日期: "",
  正单合同号: "",
  产品货号: "",
  产品名称: "",
  接单数量: "",
  装箱方式: "",
  订单总箱数: "",
  验货日期: "",
  备注: "",
});

function MoGrid({
  rows,
  onPatch,
  onRemove,
}: {
  rows: MoEditRow[];
  onPatch: (key: number, patch: Partial<MoEditRow>) => void;
  onRemove: (key: number) => void;
}) {
  const cell = (r: MoEditRow, k: keyof MoEditRow, w: string, type?: string) => (
    <Input
      type={type ?? "text"}
      min={type === "number" ? 0 : undefined}
      aria-label={k}
      className={cn(inputCls, "h-9", w, (type === "number" || type === "date") && "f-mono")}
      value={r[k]}
      onChange={(e) => onPatch(r.key, { [k]: e.target.value })}
    />
  );
  return (
    <div className="f-panel overflow-x-auto">
      <table data-freeze className="w-full min-w-[1200px] text-[15px]">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.03]">
            {[
              "序号", "接单日期", "正单合同号", "产品货号", "产品名称",
              "接单数量", "装箱方式", "订单总箱数", "验货日期", "备注", "操作",
            ].map((h) => (
              <th
                key={h}
                className="f-label px-3 py-2.5 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-4 text-center text-sm text-disabled">
                还没有 MO 单行,点上方「添加行」
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r.key} className="border-b border-black/6 last:border-0">
                <td className="px-3 py-2 text-disabled">{i + 1}</td>
                <td className="px-3 py-2">{cell(r, "接单日期", "w-36", "date")}</td>
                <td className="px-3 py-2">{cell(r, "正单合同号", "w-36")}</td>
                <td className="px-3 py-2">{cell(r, "产品货号", "w-36")}</td>
                <td className="px-3 py-2">{cell(r, "产品名称", "w-40")}</td>
                <td className="px-3 py-2">{cell(r, "接单数量", "w-24", "number")}</td>
                <td className="px-3 py-2">{cell(r, "装箱方式", "w-28")}</td>
                <td className="px-3 py-2">{cell(r, "订单总箱数", "w-24", "number")}</td>
                <td className="px-3 py-2">{cell(r, "验货日期", "w-36", "date")}</td>
                <td className="px-3 py-2">{cell(r, "备注", "w-40")}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#dc2626] hover:underline"
                    onClick={() => onRemove(r.key)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 打开单据弹窗的列定义(列宽按百分比,合计 100) ----------

const openCol = createColumnHelper<ProductionHeader>();

function useOpenColumns() {
  return useMemo<ColumnDef<ProductionHeader, any>[]>(
    () => [
      openCol.accessor("生产单号", {
        header: "生产单号",
        size: 23,
        cell: (c) => txt(c.getValue()),
        meta: {
          tdClass:
            "f-mono truncate px-3 py-2 font-semibold whitespace-nowrap text-[#15803d]",
        },
      }),
      openCol.accessor("客户款号", {
        header: "客户款号",
        size: 15,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      openCol.accessor("客户名称", {
        header: "客户名称",
        size: 22,
        cell: (c) => txt(c.getValue()),
        meta: { tdClass: "truncate px-3 py-2 text-[#3d4a5c]", tooltip: true },
      }),
      openCol.accessor("交货日期", {
        header: "交货日期",
        size: 13,
        cell: (c) => fmtDate(c.getValue()),
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
      openCol.accessor("接单数量", {
        header: "接单数量",
        size: 12,
        cell: (c) => fmtNum(c.getValue(), 0),
        meta: {
          align: "right",
          tdClass:
            "f-mono px-3 py-2 text-right text-[16px] font-semibold whitespace-nowrap text-[#1a2330]",
        },
      }),
      openCol.display({
        id: "状态",
        header: "状态",
        size: 15,
        cell: (c) =>
          approved(c.row.original) ? (
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
    ],
    [],
  );
}

// ---------- 页面 ----------

export default function ProductionPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePerms();
  const priceHidden = !can(MENU, "单价");
  const currentUser = getUser() || "用户";

  const [mode, setMode] = useState<"view" | "new">("view");
  const [单号, set单号] = useState<string | null>(null);
  const [form, setFormState] = useState<HeaderFormState>(emptyForm);
  const [goods, setGoods] = useState<GoodsEditRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [viewSelected货号, setViewSelected货号] = useState<string | null>(null);

  // 页签:制单内容 / 物料清单 / MO单录入 / 图片备注(对照老系统 Tabs)
  const [tab, setTab] = useState<"content" | "material" | "mo" | "img">("content");
  const [startupOpen, setStartupOpen] = useState(false); // 一键启动面板

  // MO单录入(独立于主单据保存;仅在已载入生产单号时可编辑/保存)
  const [moRows, setMoRows] = useState<MoEditRow[]>([]);
  const [savingMo, setSavingMo] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unapproveOpen, setUnapproveOpen] = useState(false);
  const [unapproveReason, setUnapproveReason] = useState("");
  const [unapproveWithBom, setUnapproveWithBom] = useState(true);
  const [poBind, setPoBind] = useState<{
    rowKey: number;
    款号: string;
    po: string;
    others: string[];
  } | null>(null);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // URL 带 ?mo=生产单号(排期页「生产下单」成功后跳入)时直接打开该单;
  // 消费后清参(仅进入/参数变化时执行一次,keep-alive 下再次跳入也能直开)。
  // 渲染期派生 mode/单号(同下方水合的 render-adjust 惯例),effect 只做路由清参。
  // 路径门:keep-alive 隐藏页仍挂载在同一路由上,不在本页路径时不得消费 mo(防吃掉别的页的参数)
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const moParam = location.pathname === "/production" ? searchParams.get("mo") : null;
  if (moParam && (mode !== "view" || 单号 !== moParam)) {
    setMode("view");
    set单号(moParam);
  }
  useEffect(() => {
    if (!moParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("mo");
    setSearchParams(next, { replace: true });
  }, [moParam, searchParams, setSearchParams]);

  // 货号选择:已做 BOM 物料设置的款号(选中带出 款号名称/BOM款号/客户/默认单价)
  const [styleOpts, setStyleOpts] = useState<StyleOpt[]>([]);
  useEffect(() => {
    stylesApi
      .bomHeaders()
      .then((r) =>
        setStyleOpts(
          r
            .filter((s) => !!s.款号)
            .map((s) => ({
              value: s.款号!,
              label: `${s.款号}${s.款式 ? ` ${s.款式}` : ""}${s.客户名称 ? ` (${s.客户名称})` : ""}`,
              款号: s.款号!,
              款式: s.款式,
              客户编号: s.客户编号,
              客户名称: s.客户名称,
              默认单价: s.默认单价,
              待绑定PO号: s.待绑定PO号,
            })),
        ),
      )
      .catch(() => setStyleOpts([]));
  }, []);

  // 首次进入自动打开最新一单(查看态)
  const firstQuery = useQuery({
    queryKey: ["production-first"],
    queryFn: () => productionApi.list(1, 1),
  });
  useEffect(() => {
    const first = firstQuery.data?.items[0]?.生产单号;
    if (mode === "view" && !单号 && first) set单号(first);
  }, [firstQuery.data, mode, 单号]);

  const detailQuery = useQuery({
    queryKey: ["production-detail", 单号],
    queryFn: () => productionApi.get(单号!),
    enabled: mode === "view" && !!单号,
  });

  const listQuery = useQuery({
    queryKey: ["production-list", page, keyword],
    queryFn: () => productionApi.list(page, 10, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: dialogOpen,
  });
  const totalPages = listQuery.data
    ? Math.max(1, Math.ceil(listQuery.data.total / 10))
    : 1;

  const detail = detailQuery.data;
  const header = mode === "view" ? (detail?.单头 ?? null) : null;
  const isView = header != null;
  const audited = approved(header);
  const openColumns = useOpenColumns();
  const 生产单号 = header?.生产单号 ?? "";

  // MO单录入:打开单据时载入(独立接口);refetchOnWindowFocus=false 防聚焦覆盖在录内容
  const moQuery = useQuery({
    queryKey: ["production-mo", 单号],
    queryFn: () => productionApi.getMo(单号!),
    enabled: mode === "view" && !!单号,
    refetchOnWindowFocus: false,
  });
  const [moHydrated, setMoHydrated] = useState<typeof moQuery.data>(undefined);
  if (mode === "view" && moQuery.data && moQuery.data !== moHydrated) {
    setMoHydrated(moQuery.data);
    setMoRows(
      moQuery.data.map((m) => ({
        key: uid(),
        接单日期: date10(m.接单日期),
        正单合同号: m.正单合同号 ?? "",
        产品货号: m.产品货号 ?? "",
        产品名称: m.产品名称 ?? "",
        接单数量: m.接单数量 == null ? "" : String(m.接单数量),
        装箱方式: m.装箱方式 ?? "",
        订单总箱数: m.订单总箱数 == null ? "" : String(m.订单总箱数),
        验货日期: date10(m.验货日期),
        备注: m.备注 ?? "",
      })),
    );
  }
  if (mode === "new" && moHydrated !== undefined) {
    setMoHydrated(undefined);
    setMoRows([]);
  }

  // 新建态 BOM 实时预览:选中货号行后实时拉其 BOM 物料(选完即见,不用等保存);
  // 查看态仍用已展开快照。预览款号:货号本身是已建BOM的款号→用货号;否则回落 BOM款号。
  const editSelected = goods.find((g) => g.key === selectedKey) ?? null;
  const editSelected货号 = editSelected?.货号 ?? "";
  const editSelectedBOM款号 = editSelected?.BOM款号 ?? "";
  const [bomPreview, setBomPreview] = useState<StyleBomLine[] | null>(null);
  useEffect(() => {
    if (mode !== "new" || !editSelected) {
      setBomPreview(null);
      return;
    }
    const hh = editSelected货号.trim();
    const k = hh && styleOpts.some((o) => o.value === hh) ? hh : editSelectedBOM款号.trim();
    if (!k) {
      setBomPreview(null);
      return;
    }
    let dead = false;
    stylesApi
      .materials(k)
      .then((v) => {
        if (!dead)
          setBomPreview((v.物料 ?? []).filter((l) => (l.物料编号 ?? "").trim() !== ""));
      })
      .catch(() => {
        if (!dead) setBomPreview([]);
      });
    return () => {
      dead = true;
    };
    // editSelected 仅取 货号/BOM款号 两个标量参与,避免每次 patch 都重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editSelected货号, editSelectedBOM款号, styleOpts]);

  // 查看态:把后端单头水合到表单(渲染期按引用比对调整,新数据到达时执行一次;
  // 未审核可改后保存修改,refetch 回来的新引用会重新水合)
  const [hydrated, setHydrated] = useState<typeof detail>(undefined);
  if (mode === "view" && detail?.单头 && detail !== hydrated) {
    const h = detail.单头;
    setHydrated(detail);
    setFormState({
      生产单号: h.生产单号 ?? "",
      订单类型: h.订单类型 ?? "",
      客户款号: h.客户款号 ?? "",
      客户编号: h.客户编号 ?? "",
      客户名称: h.客户名称 ?? "",
      交货日期: date10(h.交货日期),
      标识: h.标识 ?? "",
      接单数量: h.接单数量 == null ? "" : String(h.接单数量),
      装箱方式: h.装箱方式 ?? "",
      订单总箱数: h.订单总箱数 == null ? "" : String(h.订单总箱数),
      下单日期: date10(h.下单日期 ?? h.日期),
      跟单员: h.跟单员 ?? "",
      默认单价: h.默认单价 ?? "",
      合同号: h.合同号 ?? "",
      备注: h.备注 ?? "",
    });
    setViewSelected货号(detail.货号明细[0]?.货号 ?? null);
  }

  const setForm = (patch: Partial<HeaderFormState>) =>
    setFormState((f) => ({ ...f, ...patch }));

  // ---------- 新建 ----------
  const reset = () => {
    setMode("new");
    set单号(null);
    setHydrated(undefined);
    setFormState(emptyForm());
    const first = newGoodsRow();
    setGoods([first]);
    setSelectedKey(first.key);
    setPoBind(null);
  };

  // ---------- 货号网格操作(仅新建态) ----------
  const patchGoods = (key: number, patch: Partial<GoodsEditRow>) =>
    setGoods((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  // 数量按排期实单带出:单头合同号 + 货号 精确命中生产排期行(排除已取消),同 PO 同货号多行按数量合计;
  // 该行已有数量不覆盖(手改优先),查不到/查询失败不阻塞(仍可手输)。poOverride=合同号刚带出还没进 state 时用。返回是否带出。
  const prefill排期数量 = async (key: number, 货号: string, poOverride?: string): Promise<boolean> => {
    const po = (poOverride ?? form.合同号).trim();
    const no = 货号.trim();
    if (!po || !no) return false;
    try {
      const r = await schedulingApi.list({ page: 1, size: 200, keyword: po });
      const qty = (r.items ?? [])
        .filter(
          (x) =>
            (x.PO号 ?? "").trim() === po &&
            (x.货号 ?? "").trim() === no &&
            x.状态 !== "已取消",
        )
        .reduce((a, x) => a + (Number(x.数量) || 0), 0);
      if (qty <= 0) return false;
      let filled = false;
      setGoods((gs) => {
        const g = gs.find((x) => x.key === key);
        if (!g || g.数量明细.some((l) => (Number(l.数量) || 0) > 0)) return gs;
        filled = true;
        return gs.map((x) =>
          x.key === key
            ? { ...x, 数量明细: [{ key: uid(), 颜色: "", 尺码: "", 数量: String(qty) }] }
            : x,
        );
      });
      return filled;
    } catch {
      return false;
    }
  };

  // 合同号填好后离焦:给所有还没填数量的货号行按排期实单带数量(一行成功才提示)
  const on合同号Blur = () => {
    if (!form.合同号.trim()) return;
    void (async () => {
      let n = 0;
      for (const g of goods)
        if (g.货号.trim() && (await prefill排期数量(g.key, g.货号))) n++;
      if (n > 0)
        setToast({
          text: `已按排期实单(PO=${form.合同号.trim()})带出 ${n} 行货号的数量,可手改`,
          tone: "ok",
        });
    })();
  };

  const addGoods = () => {
    const r = newGoodsRow();
    setGoods((gs) => [...gs, r]);
    setSelectedKey(r.key);
  };

  const removeGoods = (key: number) =>
    setGoods((gs) => {
      const removed = gs.find((g) => g.key === key);
      const next = gs.filter((g) => g.key !== key);
      if (selectedKey === key) setSelectedKey(next[0]?.key ?? null);
      // 删除货号行时,其带入的表头信息一并清掉(仅清与该货号选项一致的值,手改过的不动)
      if (removed?.货号) {
        const st = styleOpts.find((o) => o.value === removed.货号);
        const patch: Partial<HeaderFormState> = {};
        if (st && form.客户编号 === (st.客户编号 ?? "")) patch.客户编号 = "";
        if (st && form.客户名称 === (st.客户名称 ?? "")) patch.客户名称 = "";
        if (st && form.默认单价 === (st.默认单价 ?? "")) patch.默认单价 = "";
        if (form.客户款号 === removed.货号) patch.客户款号 = "";
        if (Object.keys(patch).length) setForm(patch);
      }
      return next;
    });

  // 选中货号:以其为准回填 款号名称/BOM款号(货号自身)/分析,并把单头信息回填到表头
  const on货号Change = (key: number, val: string) => {
    const st = styleOpts.find((o) => o.value === val);
    if (!st) {
      patchGoods(key, { 货号: val });
      return;
    }
    patchGoods(key, {
      货号: val,
      款号名称: st.款式 ?? "",
      BOM款号: val,
      分析: true, // 旧系统:选货号后分析默认打勾
    });
    setForm({
      客户编号: st.客户编号 ?? "",
      客户名称: st.客户名称 ?? "",
      默认单价: st.默认单价 ?? "",
      客户款号: val,
    });
    // 合同号未填:BOM 从排期建时带过 PO(已审核→绑定列表取最新一条;未审核→台头 待绑定PO号)→ 自动带出合同号;
    // 再按 合同号+货号 把排期实单数量带出,免手输
    void (async () => {
      let po = form.合同号.trim();
      let po带出 = false;
      if (!po) {
        try {
          const bindings = await stylesApi.poBindings(val);
          po = bindings[bindings.length - 1]?.PO号?.trim() ?? "";
        } catch {
          // 绑定查询失败不阻塞,继续试 待绑定PO号
        }
        if (!po) po = (st.待绑定PO号 ?? "").trim();
        if (po) {
          setForm({ 合同号: po });
          po带出 = true;
        }
      }
      const 数量带出 = await prefill排期数量(key, val, po || undefined);
      if (po带出 || 数量带出)
        setToast({
          text:
            [po带出 ? `合同号已按 BOM 绑定 PO=${po} 带出` : null, 数量带出 ? "数量已按排期实单带出" : null]
              .filter(Boolean)
              .join("；") + ",可手改",
          tone: "ok",
        });
    })();
  };

  // BOM款号 选择:单头合同号非空时,若该 BOM 已绑定别的 PO,确认(继续使用)后才采用
  const onBomChange = (key: number, val: string) => {
    const opt = styleOpts.find((o) => o.value === val);
    const po = form.合同号.trim();
    if (!opt || !po) {
      patchGoods(key, { BOM款号: val });
      return;
    }
    void (async () => {
      let others: string[];
      try {
        const bindings = await stylesApi.poBindings(val);
        others = bindings.map((b) => b.PO号).filter((p) => p && p !== po);
      } catch {
        patchGoods(key, { BOM款号: val }); // 绑定查询失败不阻塞下单流程
        return;
      }
      if (others.length === 0) patchGoods(key, { BOM款号: val });
      else setPoBind({ rowKey: key, 款号: val, po, others });
    })();
  };

  // 手输数量 = 生成一条无色码的数量行(在下方色码表里加行后,数量自动变回色码合计)
  const onQtyInput = (key: number, val: string) =>
    patchGoods(key, {
      数量明细: [{ key: uid(), 颜色: "", 尺码: "", 数量: val }],
    });

  const patchQtyLine = (gkey: number, lkey: number, patch: Partial<QtyEditLine>) =>
    setGoods((gs) =>
      gs.map((g) =>
        g.key === gkey
          ? {
              ...g,
              数量明细: g.数量明细.map((l) =>
                l.key === lkey ? { ...l, ...patch } : l,
              ),
            }
          : g,
      ),
    );
  const addQtyLine = (gkey: number) =>
    setGoods((gs) =>
      gs.map((g) =>
        g.key === gkey
          ? {
              ...g,
              数量明细: [
                ...g.数量明细,
                { key: uid(), 颜色: "", 尺码: "", 数量: "" },
              ],
            }
          : g,
      ),
    );
  const removeQtyLine = (gkey: number, lkey: number) =>
    setGoods((gs) =>
      gs.map((g) =>
        g.key === gkey
          ? { ...g, 数量明细: g.数量明细.filter((l) => l.key !== lkey) }
          : g,
      ),
    );

  const goodsQty = (g: GoodsEditRow) =>
    g.数量明细.reduce((a, l) => a + (Number(l.数量) || 0), 0);
  const 合计数量 = goods.reduce((a, g) => a + goodsQty(g), 0);

  // ---------- MO单录入(仅已载入生产单号时可编辑/保存;独立保存。照抄老系统 saveMo) ----------
  const patchMo = (key: number, patch: Partial<MoEditRow>) =>
    setMoRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addMo = () => setMoRows((rs) => [...rs, newMoRow()]);
  const removeMo = (key: number) => setMoRows((rs) => rs.filter((r) => r.key !== key));

  const moQty = moRows.reduce((a, r) => a + (Number(r.接单数量) || 0), 0);
  const mo剩余数量 = (Number(header?.计划数量) || 0) - moQty;

  const saveMo = async () => {
    if (!生产单号) return;
    const lines: MoLine[] = moRows.map((r) => ({
      接单日期: r.接单日期 || undefined,
      正单合同号: r.正单合同号.trim() || undefined,
      产品货号: r.产品货号.trim() || undefined,
      产品名称: r.产品名称.trim() || undefined,
      接单数量: numOr(r.接单数量),
      装箱方式: r.装箱方式.trim() || undefined,
      订单总箱数: numOr(r.订单总箱数),
      验货日期: r.验货日期 || undefined,
      备注: r.备注.trim() || undefined,
    }));
    setSavingMo(true);
    try {
      await productionApi.saveMo(生产单号, lines);
      setToast({ text: "MO单已保存", tone: "ok" });
    } catch (e) {
      setToast({ text: errMsg(e) || "MO单保存失败", tone: "err" });
    } finally {
      setSavingMo(false);
    }
  };

  // ---------- 保存(新建) ----------
  const [saving, setSaving] = useState(false);
  const buildLines = (): ProductionGoodsLine[] | null => {
    const lines: ProductionGoodsLine[] = goods.map((g) => ({
      货号: g.货号.trim() || g.BOM款号.trim(),
      BOM款号: g.BOM款号.trim(),
      款号名称: g.款号名称.trim() || undefined,
      比例: numOr(g.比例),
      分析: g.分析,
      数量明细: g.数量明细
        .filter((l) => (Number(l.数量) || 0) > 0)
        .map((l) => ({
          颜色: l.颜色.trim() || undefined,
          尺码: l.尺码.trim() || undefined,
          数量: Number(l.数量),
        })),
    }));
    if (lines.length === 0) {
      setToast({ text: "请至少添加一行货号", tone: "err" });
      return null;
    }
    if (lines.some((l) => !l.BOM款号)) {
      setToast({ text: "每行货号必须填写 BOM款号", tone: "err" });
      return null;
    }
    if (lines.some((l) => l.数量明细.length === 0)) {
      setToast({
        text: "每个货号必须填写数量:填好合同号后可按排期实单自动带出,或在货号行「数量」列直接输入(色码可空)",
        tone: "err",
      });
      return null;
    }
    return lines;
  };

  const headerBody = (接单数量: number | undefined): ProductionNoticeCreate => ({
    生产单号: form.生产单号.trim() || undefined,
    接单数量,
    订单类型: form.订单类型 || undefined,
    标识: form.标识 || undefined,
    装箱方式: form.装箱方式 || undefined,
    订单总箱数: numOr(form.订单总箱数),
    默认单价: form.默认单价 || undefined,
    客户编号: form.客户编号 || undefined,
    客户名称: form.客户名称 || undefined,
    客户款号: form.客户款号 || undefined,
    合同号: form.合同号 || undefined,
    跟单员: form.跟单员 || undefined,
    备注: form.备注 || undefined,
    交货日期: form.交货日期 || undefined,
    下单日期: form.下单日期 || undefined,
    货号明细: [],
  });

  const save = async () => {
    const lines = buildLines();
    if (!lines) return;
    const body: ProductionNoticeCreate = {
      ...headerBody(numOr(form.接单数量) ?? 合计数量), // 手输优先;留空回落为明细合计
      货号明细: lines,
    };
    setSaving(true);
    try {
      const r = await productionApi.create(body);
      setToast({
        text: `生产通知单已创建:${r.生产单号}(工序/物料已自动展开)`,
        tone: "ok",
      });
      setMode("view");
      set单号(r.生产单号);
      void qc.invalidateQueries({ queryKey: ["production-first"] });
      void qc.invalidateQueries({ queryKey: ["production-list"] });
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // ---------- 保存修改(查看态未审核,仅表头) ----------
  const saveHeader = async () => {
    if (!单号) return;
    setSaving(true);
    try {
      await productionApi.update(单号, headerBody(numOr(form.接单数量)));
      setToast({ text: "表头已保存", tone: "ok" });
      await detailQuery.refetch();
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // ---------- 审核 / 申请反审核 / 删除 ----------
  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "reset") => {
    try {
      await fn();
      setToast({ text: ok, tone: "ok" });
      if (after === "reset") {
        reset();
        void qc.invalidateQueries({ queryKey: ["production-first"] });
        void qc.invalidateQueries({ queryKey: ["production-list"] });
      } else {
        await detailQuery.refetch();
      }
      invalidateCrossPage(qc);
    } catch (e) {
      setToast({ text: errMsg(e) || "操作失败", tone: "err" });
    }
  };

  const submitUnapprove = () => {
    if (!unapproveReason.trim()) {
      setToast({ text: "请填写反审核原因", tone: "err" });
      return;
    }
    setUnapproveOpen(false);
    void act(
      () => productionApi.requestUnapprove(单号!, unapproveReason.trim(), unapproveWithBom),
      "已提交反审核申请,待经理批准",
      "reload",
    );
  };

  // ---------- 工具条(三组;权限菜单名「生产制单」与后端一致) ----------
  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, perm: "保存", success: true, onClick: reset },
    { key: "open", label: "打开", icon: FolderOpen, primary: true, onClick: () => setDialogOpen(true) },
    ...(mode === "new"
      ? [{ key: "save", label: "保存", icon: FloppyDisk, perm: "保存" as const, primary: true, disabled: saving, onClick: () => void save() }]
      : []),
    ...(isView && !audited
      ? [
          { key: "saveHeader", label: "保存修改", icon: FloppyDisk, perm: "保存" as const, primary: true, disabled: saving, onClick: () => void saveHeader() },
          { key: "del", label: "删除", icon: Trash, perm: "删除" as const, danger: true, onClick: () => setDeleteOpen(true) },
        ]
      : []),
  ];
  const auditActions: DocAction[] = [
    ...(isView && !audited
      ? [{ key: "audit", label: "审核", icon: CheckCircle, perm: "审核" as const, success: true, onClick: () => void act(() => productionApi.approve(单号!), "已审核", "reload") }]
      : []),
    ...(isView && audited && header?.反审核申请 !== "1"
      ? [{
          key: "unaudit",
          label: "申请反审核",
          icon: ArrowCounterClockwise,
          perm: "反审核" as const,
          danger: true,
          onClick: () => {
            setUnapproveReason("");
            setUnapproveWithBom(true);
            setUnapproveOpen(true);
          },
        }]
      : []),
  ];
  // 流转外操作:一键启动 + 下推领料(仅查看态;老系统不设权限位,照抄)
  const flowActions: DocAction[] = isView
    ? [
        { key: "startup", label: "一键启动", icon: Rocket, primary: true, onClick: () => setStartupOpen(true) },
        {
          key: "pushMat",
          label: "下推领料(来料仓)",
          icon: PaperPlaneRight,
          onClick: () => navigate(`/material-issues?basis=${encodeURIComponent(生产单号)}`),
        },
        {
          key: "pushPlastic",
          label: "下推领料(塑胶仓)",
          icon: PaperPlaneRight,
          onClick: () => navigate(`/plastic-issues?basis=${encodeURIComponent(生产单号)}`),
        },
      ]
    : [];
  const printActions: DocAction[] = [
    { key: "print", label: "打印", icon: Printer, onClick: () => window.print() },
  ];

  // ---------- 查看态单头卡字段(已审核只读;价格位按权限脱敏) ----------
  const masked = (v: number | string | null | undefined) => money(v, priceHidden);
  const mainFields: HeaderField[] = header
    ? [
        { label: "生产单号", value: txt(header.生产单号), mono: true, strong: true },
        { label: "客户款号", value: txt(header.客户款号), mono: true },
        { label: "客户名称", value: txt(header.客户名称), mono: true },
        { label: "合同号", value: txt(header.合同号), mono: true },
        { label: "交货日期", value: fmtDate(header.交货日期), mono: true },
        { label: "接单数量", value: fmtNum(header.接单数量, 0), mono: true, strong: true },
        { label: "订单类型", value: txt(header.订单类型), mono: true },
        { label: "标识", value: txt(header.标识), mono: true },
        { label: "默认单价", value: masked(header.默认单价), mono: true },
        { label: "制单人", value: txt(header.制单人), mono: true },
        { label: "下单日期", value: fmtDate(header.下单日期), mono: true },
      ]
    : [];
  const extraFields: HeaderField[] = header
    ? [
        { label: "客户编号", value: txt(header.客户编号), mono: true },
        { label: "加工厂名称", value: txt(header.加工厂名称), mono: true },
        { label: "装箱方式", value: txt(header.装箱方式), mono: true },
        { label: "订单总箱数", value: fmtNum(header.订单总箱数, 0), mono: true },
        { label: "跟单员", value: txt(header.跟单员), mono: true },
        { label: "计划数量", value: fmtNum(header.计划数量, 0), mono: true },
        { label: "工序单价", value: masked(header.工序单价), mono: true },
        { label: "物料金额", value: masked(header.物料金额), mono: true },
        { label: "出货单价", value: masked(header.出货单价), mono: true },
        { label: "入半成品数量", value: fmtNum(header.入半成品数量, 0), mono: true },
        { label: "入成品数量", value: fmtNum(header.入成品数量, 0), mono: true },
        { label: "审核人", value: txt(header.审核人), mono: true },
        { label: "备注", value: txt(header.备注), mono: true },
      ]
    : [];

  const viewGoods = detail?.货号明细 ?? [];
  const viewQtyLines = (detail?.数量 ?? []).filter(
    (q) => q.货号 === viewSelected货号,
  );
  // 工序/物料快照按选中货号过滤(对照老系统 procRows/matRows)
  const viewProcRows = (detail?.工序 ?? []).filter(
    (p) => p.货号 === viewSelected货号,
  );
  const viewMatRows = (detail?.物料 ?? []).filter(
    (m) => m.货号 === viewSelected货号,
  );
  // 半成品需求(实单版 BOM 才有):同样按选中货号过滤
  const viewSemiNeeds = (detail?.半成品需求 ?? []).filter(
    (s) => s.货号 === viewSelected货号,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-7">
      {/* 页头 */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          生产通知单{isView ? ` · ${header?.生产单号}` : mode === "new" ? "(新建)" : ""}
        </h1>
        {isView && <AuditBadge header={header} />}
        <div className="ml-auto">
          <FlowSteps
            steps={["开单", "主管审核", "经理审核", "审核出库"]}
            current={audited ? 1 : 0}
          />
        </div>
      </div>

      {/* 操作栏:编辑 / 审核流转 / 一键启动与下推 / 打印 四组,组间分隔线 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <DocToolbar actions={editActions} menuKey={MENU} />
        <span className="mx-1 h-8 w-px bg-black/10" />
        <DocToolbar actions={auditActions} menuKey={MENU} />
        {isView && audited && header?.反审核申请 === "1" && (
          <span className="inline-flex items-center rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-3 py-1.5 text-sm font-semibold text-[var(--warning,#d97706)]">
            反审核申请中{header.反审核申请人 ? `(${header.反审核申请人})` : ""},待经理批准
          </span>
        )}
        {flowActions.length > 0 && (
          <>
            <span className="mx-1 h-8 w-px bg-black/10" />
            <DocToolbar actions={flowActions} menuKey={MENU} />
          </>
        )}
        <span className="mx-1 h-8 w-px bg-black/10" />
        <DocToolbar actions={printActions} menuKey={MENU} />
      </div>

      {/* 单头:新建态/未审核查看态 = 表单;已审核 = 只读玻璃卡 */}
      {mode === "new" ? (
        <HeaderForm
          form={form}
          setForm={setForm}
          isView={false}
          制单日期={new Date().toISOString().slice(0, 10)}
          制单人={currentUser}
          合计数量={合计数量}
          on合同号Blur={on合同号Blur}
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
          <DocError
            message="单据加载失败,请重试或重新打开"
            onRetry={() => detailQuery.refetch()}
          />
        </div>
      ) : !header ? (
        <div className="f-panel p-6">
          <DocEmpty
            icon={<FolderOpen className="h-5 w-5" />}
            title="尚未打开单据"
            description="点击上方「打开」选择一张生产通知单,或点「新建」开一张新单"
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
      ) : audited ? (
        <DocHeaderCard fields={mainFields} extra={extraFields} />
      ) : (
        <HeaderForm
          form={form}
          setForm={setForm}
          isView
          制单日期={date10(header.日期) || new Date().toISOString().slice(0, 10)}
          制单人={txt(header.制单人)}
          合计数量={合计数量}
        />
      )}

      {/* 货号明细 */}
      {mode === "new" ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1a2330]">货号明细</h2>
            <span className="f-mono text-sm text-[#5f6b7d]">{goods.length} 个货号</span>
          </div>
          <GoodsEditor
            goods={goods}
            selectedKey={selectedKey}
            styleOpts={styleOpts}
            onSelect={setSelectedKey}
            onPatch={patchGoods}
            onAdd={addGoods}
            onRemove={removeGoods}
            on货号Change={on货号Change}
            onBomChange={onBomChange}
            onQtyInput={onQtyInput}
          />
        </div>
      ) : (
        header &&
        !detailQuery.isLoading &&
        !detailQuery.isError && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1a2330]">货号明细</h2>
              <span className="f-mono text-sm text-[#5f6b7d]">
                {viewGoods.length} 个货号
              </span>
            </div>
            {viewGoods.length === 0 ? (
              <div className="f-panel">
                <DocEmpty
                  icon={<Prohibit className="h-5 w-5" />}
                  title="暂无货号明细"
                  description="该单据还没有录入货号"
                />
              </div>
            ) : (
              <GoodsViewTable
                rows={viewGoods}
                selected货号={viewSelected货号}
                onSelect={setViewSelected货号}
              />
            )}
          </div>
        )
      )}

      {/* 页签:制单内容 / 物料清单 / MO单录入 / 图片备注(对照老系统 Tabs;四个面板常驻挂载仅隐藏,切页签不丢在录内容) */}
      {(mode === "new" || header) && (
        <div className="space-y-3">
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {(
              [
                { key: "content", label: "制单内容" },
                { key: "material", label: "物料清单" },
                { key: "mo", label: "MO单录入" },
                { key: "img", label: "图片备注" },
              ] as const
            ).map((t) => (
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

          {/* 制单内容:新建态=色码数量编辑;查看态=色码数量 + 工序工费(按选中货号过滤) */}
          <div className={cn("space-y-4", tab !== "content" && "hidden")}>
            {mode === "new" ? (
              editSelected ? (
                <QtyLinesEditor
                  row={editSelected}
                  onPatchQty={patchQtyLine}
                  onAddQty={addQtyLine}
                  onRemoveQty={removeQtyLine}
                />
              ) : (
                <div className="f-panel">
                  <DocEmpty title="先在上方选择一行货号" />
                </div>
              )
            ) : (
              <>
                {viewGoods.length > 0 && (
                  <QtyViewTable 货号={viewSelected货号 ?? ""} lines={viewQtyLines} />
                )}
                <ProcViewTable rows={viewProcRows} />
              </>
            )}
          </div>

          {/* 物料清单:查看态=已展开快照;新建态=选中货号的 BOM 实时预览 */}
          <div data-testid="tab-material" className={cn(tab !== "material" && "hidden")}>
            {mode === "new" ? (
              bomPreview ? (
                <BomPreviewTable rows={bomPreview} />
              ) : (
                <div className="f-panel">
                  <DocEmpty title="选中已建 BOM 的货号后实时预览物料" />
                </div>
              )
            ) : (
              <div className="space-y-3">
                <MatTable rows={viewMatRows} priceHidden={priceHidden} />
                {viewSemiNeeds.length > 0 && <SemiNeedTable rows={viewSemiNeeds} />}
              </div>
            )}
          </div>

          {/* MO单录入 */}
          <div className={cn("space-y-3", tab !== "mo" && "hidden")}>
            {!生产单号 ? (
              <div className="f-panel">
                <DocEmpty title="保存生产通知单后录入MO单" />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button type="button" className="f-btn h-9 px-3.5 text-sm" onClick={addMo}>
                    <Plus className="h-4 w-4" />
                    添加行
                  </button>
                  {can(MENU, "保存") && (
                    <button
                      type="button"
                      className="f-btn f-btn-cyan h-9 px-3.5 text-sm"
                      disabled={savingMo}
                      onClick={() => void saveMo()}
                    >
                      <FloppyDisk className="h-4 w-4" />
                      保存MO单
                    </button>
                  )}
                </div>
                <MoGrid rows={moRows} onPatch={patchMo} onRemove={removeMo} />
                <div className="text-right font-semibold text-[#1a2330]">
                  MO单剩余数量:{mo剩余数量}
                </div>
              </>
            )}
          </div>

          {/* 图片备注 */}
          <div className={cn(tab !== "img" && "hidden")}>
            <ImageNotesPanel
              模块="生产单"
              单号={生产单号}
              canEdit={can(MENU, "保存")}
              emptyHint="请先打开一个生产通知单"
            />
          </div>
        </div>
      )}

      <ProductionStartupDialog
        open={startupOpen}
        生产单号={生产单号}
        onClose={() => setStartupOpen(false)}
      />

      <OpenDocDialog
        title="打开生产通知单"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        columns={openColumns}
        rows={listQuery.data?.items ?? []}
        searchPlaceholder="生产单号 / 客户款号 / 客户名称"
        onPick={(h) => {
          if (h.生产单号) {
            setMode("view");
            set单号(h.生产单号);
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
        description="按单号、客户款号或客户名称搜索,点击一行打开"
        loading={listQuery.isLoading}
        error={listQuery.isError ? "列表加载失败,请重试" : null}
        onRetry={() => listQuery.refetch()}
        onSearch={(kw) => {
          setPage(1);
          setKeyword(kw);
        }}
        emptyHint="没有匹配的生产通知单,换个关键字试试"
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除该生产单?"
        description={`${单号} 删除后不可恢复`}
        onConfirm={() => {
          setDeleteOpen(false);
          void act(() => productionApi.remove(单号!), "已删除", "reset");
        }}
      />

      {/* 申请反审核:必填原因 + 方式(整步含BOM/单个),提交后经理在消息中心批准/拒绝 */}
      <Dialog open={unapproveOpen} onOpenChange={setUnapproveOpen}>
        <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>申请反审核 {单号}</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              反审核需经理批准后才能生效,批准后单据回到未审核状态,可修改后重新审核。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[#3d4a5c]">
              <input
                type="radio"
                name="unapprove-mode"
                className="h-4 w-4 accent-[#16a34a]"
                checked={unapproveWithBom}
                onChange={() => setUnapproveWithBom(true)}
              />
              整步反审核(生产单 + 绑定BOM 一起)
            </label>
            <label className="flex items-center gap-2 text-sm text-[#3d4a5c]">
              <input
                type="radio"
                name="unapprove-mode"
                className="h-4 w-4 accent-[#16a34a]"
                checked={!unapproveWithBom}
                onChange={() => setUnapproveWithBom(false)}
              />
              单个反审核(仅生产单,不动BOM)
            </label>
          </div>
          <textarea
            className={cn(inputCls, "h-auto min-h-20 w-full rounded-md border px-3 py-2")}
            rows={3}
            placeholder="请填写反审核原因(必填)"
            value={unapproveReason}
            onChange={(e) => setUnapproveReason(e.target.value)}
          />
          <DialogFooter>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setUnapproveOpen(false)}>
              取消
            </button>
            <button type="button" className="f-btn f-btn-cyan h-10 px-4" onClick={submitUnapprove}>
              提交申请
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BOM 按 PO 号绑定确认:已绑别的 PO 时列出 PO 号,「继续使用」= 与当前 PO 一并绑定(双绑) */}
      <Dialog open={poBind != null} onOpenChange={(v) => !v && setPoBind(null)}>
        <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>款号 {poBind?.款号} 的 BOM 已绑定其他 PO</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              该 BOM 已绑定以下 PO 号:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-6 text-[15px] text-[#3d4a5c]">
            {poBind?.others.map((p) => (
              <li key={p} className="f-mono">
                {p}
              </li>
            ))}
          </ul>
          <p className="text-sm text-[#3d4a5c]">
            已绑定 PO：{poBind?.others.join("、")}，是否继续使用？
          </p>
          <p className="text-sm text-[#5f6b7d]">
            继续使用该 BOM 会把它与当前 PO({poBind?.po})一并绑定。
          </p>
          <DialogFooter>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setPoBind(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              onClick={() => {
                if (poBind) patchGoods(poBind.rowKey, { BOM款号: poBind.款号 });
                setPoBind(null);
              }}
            >
              继续使用
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
