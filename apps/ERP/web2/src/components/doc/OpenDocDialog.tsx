import { useMemo, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { FolderOpen, MagnifyingGlass } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DocEmpty } from "./DocEmpty";
import { DocError } from "./DocError";

declare module "@tanstack/react-table" {
  // 骨架扩展的列元数据:
  // align 控制表头对齐;tdClass 整体覆盖 td 类名;tooltip 让纯文本单元格自带 title;
  // noTruncate 关闭 QueryTable 超长字符串单元格的默认截断+点击看全文
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    tdClass?: string;
    tooltip?: boolean;
    noTruncate?: boolean;
  }
}

// 多选模式(Task 0B 批量审核):传入后首列渲染勾选框(表头=当前行全选),
// 行点击变为勾选切换,onPick 不再触发;批量动作按钮由 footer 注入。
export interface OpenDocSelection<T> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  rowId: (row: T) => string;
}

// 打开单据弹窗(三段式:头部标题+搜索固定 / 列表区表头 sticky 行可滚 / 底部固定)。
// 数据由调用方传入(columns + rows),弹窗不自带数据源。
// 列的 size 按百分比解释(table-fixed + colgroup),各列合计应为 100。
export interface OpenDocDialogProps<T> {
  title: string;
  open: boolean;
  onClose: () => void;
  columns: ColumnDef<T>[];
  rows: T[];
  searchPlaceholder: string;
  onPick: (row: T) => void;
  footer?: ReactNode;
  // 以下为需求书签名之外的可选扩展,用于状态展示与服务端查询:
  description?: string; // 标题下说明文字
  loading?: boolean; // 数据加载中,显示骨架行
  error?: string | null; // 加载失败消息,显示错误态
  onRetry?: () => void; // 错误态的重试回调
  onSearch?: (kw: string) => void; // 传入则查询交给调用方(服务端);否则在当前 rows 内前端过滤
  emptyHint?: string; // 空态描述
  selection?: OpenDocSelection<T>; // 多选模式(批量审核),不传为单选打开
}

export function OpenDocDialog<T>({
  title,
  open,
  onClose,
  columns,
  rows,
  searchPlaceholder,
  onPick,
  footer,
  description,
  loading,
  error,
  onRetry,
  onSearch,
  emptyHint,
  selection,
}: OpenDocDialogProps<T>) {
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    if (onSearch || !keyword) return rows;
    return rows.filter((r) => JSON.stringify(r).includes(keyword));
  }, [rows, keyword, onSearch]);

  // 多选切换:单行进/出 selected;全选只作用于当前可见行(filtered)
  const toggleOne = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const toggleAll = () => {
    if (!selection) return;
    const ids = filtered.map((r) => selection.rowId(r));
    const next = new Set(selection.selected);
    if (ids.length > 0 && ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    selection.onChange(next);
  };

  // 多选模式首列勾选框;其余列为调用方原列(每次渲染重建,10 行级列表开销可忽略)
  const cols: ColumnDef<T>[] = (() => {
    if (!selection) return columns;
    const selCol: ColumnDef<T> = {
      id: "_sel",
      size: 5,
      header: () => {
        const ids = filtered.map((r) => selection.rowId(r));
        const n = ids.filter((id) => selection.selected.has(id)).length;
        return (
          <Checkbox
            aria-label="全选本页"
            checked={n === 0 ? false : n === ids.length ? true : "indeterminate"}
            onCheckedChange={toggleAll}
          />
        );
      },
      cell: (c) => {
        const id = selection.rowId(c.row.original);
        return (
          <Checkbox
            aria-label={`选择 ${id}`}
            checked={selection.selected.has(id)}
            onCheckedChange={() => toggleOne(id)}
            onClick={(e) => e.stopPropagation()}
          />
        );
      },
      meta: { tdClass: "px-3 py-2 text-center" },
    };
    return [selCol, ...columns];
  })();

  // defaultColumn.minSize=0:列 size 按百分比解释,小于默认 minSize(20)的百分比不应被钳制
  // React Compiler 对 TanStack Table 的已知提示(与 GoodsTable 等处同款),非实际问题
  // oxlint-disable-next-line react/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns: cols,
    defaultColumn: { minSize: 0 },
    getCoreRowModel: getCoreRowModel(),
  });

  // colgroup 宽按 size 占比归一化:多选模式加的勾选列会把合计顶超 100,归一化保持相对比例
  const leafCols = table.getAllLeafColumns();
  const totalSize = leafCols.reduce((s, c) => s + c.getSize(), 0) || 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden border-black/10 bg-[#ffffff] p-0 text-[#1a2330] sm:max-w-[920px]">
        {/* 头部:标题 + 搜索,固定不滚 */}
        <div className="shrink-0 border-b border-black/8 px-6 pt-5 pb-4">
          <DialogHeader>
            <DialogTitle className="text-lg text-[#1a2330]">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="text-sm text-[#5f6b7d]">
                {description}
              </DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{title}</DialogDescription>
            )}
          </DialogHeader>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const kw = input.trim();
              if (onSearch) onSearch(kw);
              else setKeyword(kw);
            }}
          >
            <Input
              className="h-11 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-[#5f6b7d]"
              placeholder={searchPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              className="h-11 shrink-0 border-black/10 bg-black/[0.05] px-4 text-[15px] text-[#3d4a5c] hover:bg-black/10 hover:text-[#1a2330]"
            >
              <MagnifyingGlass className="h-4.5 w-4.5" />
              查询
            </Button>
          </form>
        </div>

        {/* 列表区:表头固定,行可滚(sticky 加在 th 上:thead 的 z-index 层叠在表格盒模型里不可靠) */}
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-3">
          {loading ? (
            <div className="space-y-2 py-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full bg-black/5" />
              ))}
            </div>
          ) : error ? (
            <DocError message={error} onRetry={onRetry} />
          ) : filtered.length === 0 ? (
            <DocEmpty
              icon={<FolderOpen className="h-5 w-5" />}
              title="暂无数据"
              description={emptyHint ?? "没有匹配的数据,换个关键字试试"}
            />
          ) : (
            <table className="w-full table-fixed text-[15px]">
              <colgroup>
                {leafCols.map((c) => (
                  <col key={c.id} style={{ width: `${(c.getSize() / totalSize) * 100}%` }} />
                ))}
              </colgroup>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={cn(
                          "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case",
                          h.column.columnDef.meta?.align === "right" && "text-right",
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
                    className="h-12 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                    onClick={() =>
                      selection ? toggleOne(selection.rowId(r.original)) : onPick(r.original)
                    }
                  >
                    {r.getVisibleCells().map((c) => {
                      const content = flexRender(c.column.columnDef.cell, c.getContext());
                      // truncate(table-fixed 防溢出):不换行内容(如 3,600,000)超列宽会压到右列,截断+悬停 title 兜底
                      return (
                        <td
                          key={c.id}
                          className={cn(c.column.columnDef.meta?.tdClass ?? "px-3 py-2", "truncate")}
                          title={
                            typeof content === "string" && content !== ""
                              ? content
                              : typeof content === "number"
                                ? String(content)
                                : undefined
                          }
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 底部:调用方注入(如分页),固定可见 */}
        {footer != null && (
          <div className="flex shrink-0 items-center justify-between border-t border-black/8 px-6 py-3 text-sm text-[#5f6b7d]">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
