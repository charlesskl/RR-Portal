// 共享查询表(报表/查询页标准件,Batch 0E 落地,后续批次全部用它):
// TanStack Table + 虚拟滚动 + 密度三档内置(接 useTableDensity,切档后
// virtualizer.measure() 清缓存行高重算) + sticky 表头四律内置
// (sticky + 不透明白底 + z-10 + border-b) + 加载骨架/错误重试/空态/底栏。
// 字符串单元格超过 TRUNC_LEN(30)字符默认截断成省略号,点击弹层显示全文
// (列 meta.noTruncate 可关闭;截断只影响显示,数据不截)。
// 列的 size 按宽度权重解释(flex 比例分配,minWidth 撑出横向滚动)。
// jsdom/首帧无可视高度时 getVirtualItems() 为空,自动回落全量静态行(行为等价不裁剪)。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Package } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { TABLE_DENSITIES, useTableDensity } from "@/hooks/useTableDensity";
import { Skeleton } from "@/components/ui/skeleton";
import { DocEmpty } from "./DocEmpty";
import { DocError } from "./DocError";

// 密度三档切换(分段控件;useTableDensity 全站共用,localStorage 持久化)
export function DensitySwitch({ className }: { className?: string }) {
  const { density, setDensity } = useTableDensity();
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1",
        className,
      )}
    >
      {TABLE_DENSITIES.map((x) => (
        <button
          key={x.key}
          type="button"
          onClick={() => setDensity(x.key)}
          className={cn(
            "h-9 rounded-lg px-4 text-sm transition-colors",
            density === x.key
              ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
              : "text-[#5f6b7d] hover:text-[#3d4a5c]",
          )}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

// 字符串单元格截断阈值:超过则省略号截断,点击弹层显示全文(列 meta.noTruncate 关闭)
const TRUNC_LEN = 30;

// 超长字符串单元格:CSS truncate 截断(不改数据),点击浮层完整展示
// (portal 到 body 不被虚拟滚动容器裁剪;点任意处/Esc/滚动关闭;样式同 CellInput 浮层)
function TruncCell({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);

  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [rect]);

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        className="block w-full cursor-pointer truncate"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          setRect({ top: r.top, left: r.left, width: r.width, up: r.top > 140 });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") ref.current?.click();
        }}
      >
        {text}
      </span>
      {rect &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 max-w-96 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm break-all whitespace-pre-wrap text-[#1a2330] shadow-[0_8px_24px_-6px_rgb(26_35_48/0.25)]"
            style={{
              left: rect.left,
              width: Math.max(rect.width, 180),
              ...(rect.up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.top + 34 }),
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface QueryTableProps<T> {
  columns: ColumnDef<T, any>[]; // accessor 列值类型各异(string/number 混合),TValue 放宽
  rows: T[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  errorMessage?: string;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  // 行交互:双击打开整单(明细行),rowTitle 给行 tooltip
  onRowDoubleClick?: (row: T) => void;
  rowTitle?: (row: T) => string | undefined;
  footer?: ReactNode; // 底栏(加载成功且非空时渲染)
  fill?: boolean; // true=撑满父容器高(库存查询页);false=表体 maxHeight 限高
  maxHeight?: string; // 非 fill 模式表体限高,默认 52vh
  minWidth?: number; // 表格最小宽(px),容器不足时横向滚动
  skeletonRows?: number; // 骨架行数,默认 8
  defaultTdClass?: string; // 单元格默认类(meta.tdClass 可逐列覆盖)
  className?: string; // 外层 f-panel 追加类
}

export function QueryTable<T>({
  columns,
  rows,
  isLoading,
  isError,
  onRetry,
  errorMessage,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  onRowDoubleClick,
  rowTitle,
  footer,
  fill,
  maxHeight,
  minWidth,
  skeletonRows,
  defaultTdClass,
  className,
}: QueryTableProps<T>) {
  const { density } = useTableDensity();
  const d = TABLE_DENSITIES.find((x) => x.key === density)!;

  // React Compiler 对 TanStack Table 的已知提示(与 OpenDocDialog 同款),非实际问题
  // oxlint-disable-next-line react/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    defaultColumn: { minSize: 0 },
    getCoreRowModel: getCoreRowModel(),
  });
  const tableRows = table.getRowModel().rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => d.rowH,
    overscan: 12,
  });

  // 切换密度后清掉已缓存的行高测量,按新 estimateSize 重算
  useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const vItems = virtualizer.getVirtualItems();
  // 无可视高度(jsdom/首帧)时虚拟列表为空:回落全量静态行,保证内容一定渲染
  const virtualized = vItems.length > 0;

  const colFlex = (size: number): CSSProperties => ({ flex: `${size} 1 0%`, minWidth: 0 });

  const renderRow = (row: Row<T>, style: CSSProperties, last: boolean) => (
    <tr
      key={row.id}
      className={cn(
        "w-full transition-colors hover:bg-black/[0.04]",
        !last && "border-b border-black/6",
        onRowDoubleClick && "cursor-pointer",
      )}
      style={{ display: "flex", ...style }}
      title={rowTitle?.(row.original)}
      onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row.original) : undefined}
    >
      {row.getVisibleCells().map((c) => {
        const content = flexRender(c.column.columnDef.cell, c.getContext());
        // 字符串超过 TRUNC_LEN 默认截断 + 点击看全文;列 meta.noTruncate 显式关闭
        const trunc =
          typeof content === "string" &&
          content.length > TRUNC_LEN &&
          !c.column.columnDef.meta?.noTruncate;
        return (
          <td
            key={c.id}
            style={colFlex(c.column.getSize())}
            className={
              c.column.columnDef.meta?.tdClass ?? defaultTdClass ?? "px-3 py-2 text-[#3d4a5c]"
            }
            title={
              c.column.columnDef.meta?.tooltip && typeof content === "string"
                ? content
                : undefined
            }
          >
            {trunc ? <TruncCell text={content} /> : content}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div
      className={cn("f-panel overflow-hidden", fill && "flex min-h-0 flex-1 flex-col", className)}
    >
      {isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: skeletonRows ?? 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full bg-black/5" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-6">
          <DocError message={errorMessage ?? "加载失败,请重试"} onRetry={onRetry} />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6">
          <DocEmpty
            icon={emptyIcon ?? <Package className="h-5 w-5" />}
            title={emptyTitle ?? "暂无数据"}
            description={emptyDescription}
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={cn("overflow-auto", fill && "min-h-0 flex-1")}
          style={fill ? undefined : { maxHeight: maxHeight ?? "52vh" }}
        >
          <table className={cn("w-full", d.text)} style={{ display: "grid", minWidth }}>
            {/* sticky 表头四律:sticky + 不透明白底 + z-10 + border-b(加在 thead 整体上) */}
            <thead
              className="sticky top-0 z-10 border-b border-black/8 bg-white"
              style={{ display: "grid" }}
            >
              <tr style={{ display: "flex" }}>
                {headers.map((h) => (
                  <th
                    key={h.id}
                    style={colFlex(h.column.getSize())}
                    className={cn(
                      "f-label px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                      h.column.columnDef.meta?.align === "right" && "text-right",
                    )}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              style={{
                display: "grid",
                position: "relative",
                height: virtualized ? virtualizer.getTotalSize() : undefined,
              }}
            >
              {virtualized
                ? vItems.map((vi) =>
                    renderRow(
                      tableRows[vi.index],
                      {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        height: vi.size,
                        transform: `translateY(${vi.start}px)`,
                      },
                      vi.index === tableRows.length - 1,
                    ),
                  )
                : tableRows.map((row, i) =>
                    renderRow(row, { height: d.rowH }, i === tableRows.length - 1),
                  )}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && !isError && rows.length > 0 && footer != null && (
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          {footer}
        </div>
      )}
    </div>
  );
}
