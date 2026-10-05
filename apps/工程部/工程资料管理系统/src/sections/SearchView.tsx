import { useState } from "react";
import { Download, ExternalLink, Eye, Loader2, Search as SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { canPreview, CATEGORY_STYLE, fileCategory, formatSize, formatTime } from "@/lib/file-utils";
import type { View, WalkItem } from "@/types";
import type { DialogState } from "@/sections/Dialogs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

/** 搜索结果 / 最近更新共用的文件结果表 */
export function FileResultList({
  items,
  loading,
  emptyText,
  onNavigate,
  onOpenDialog,
  onOpenEditor,
}: {
  items: WalkItem[];
  loading: boolean;
  emptyText: string;
  onNavigate: (v: View) => void;
  onOpenDialog: (d: DialogState) => void;
  onOpenEditor: (path: string, name: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> 正在扫描资料库…
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="p-16 text-center text-sm text-slate-400">{emptyText}</div>;
  }
  return (
    <div className="divide-y bg-white">
      {items.map((f) => {
        const cat = CATEGORY_STYLE[fileCategory(f.ext)];
        const dir = f.rel.split("/").slice(0, -1).join("/");
        return (
          <div key={f.rel} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                cat.className,
              )}
            >
              {f.ext.replace(".", "").slice(0, 4).toUpperCase() || "?"}
            </span>
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => onNavigate({ type: "explorer", path: dir })}
              title="打开所在目录"
            >
              <span className="block truncate text-sm font-medium text-slate-800 hover:text-blue-700">
                {f.name}
              </span>
              <span className="block truncate text-xs text-slate-400">{f.rel}</span>
            </button>
            <span className="w-20 shrink-0 text-right text-xs text-slate-400">{formatSize(f.size)}</span>
            <span className="w-32 shrink-0 text-right text-xs text-slate-500">{formatTime(f.mtime)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canPreview(f.ext) && (
                  <DropdownMenuItem
                    onClick={() => onOpenDialog({ type: "preview", path: f.rel, name: f.name, ext: f.ext })}
                  >
                    <Eye className="mr-2 h-4 w-4" /> 预览
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    if (f.ext === ".xlsx" || f.ext === ".xls") onOpenEditor(f.rel, f.name);
                    else onOpenDialog({ type: "openWith", path: f.rel, name: f.name });
                  }}
                >
                  <ExternalLink className="mr-2 h-4 w-4" /> 打开编辑
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(api.fileUrl(f.rel, true), "_blank")}>
                  <Download className="mr-2 h-4 w-4" /> 下载
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 全盘搜索 ---------- */

export default function SearchView({
  onNavigate,
  onOpenDialog,
  onOpenEditor,
}: {
  onNavigate: (v: View) => void;
  onOpenDialog: (d: DialogState) => void;
  onOpenEditor: (path: string, name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WalkItem[] | null>(null);
  const [searched, setSearched] = useState("");

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setSearched(query);
    try {
      const r = await api.search(query);
      setItems(r.results);
    } catch (e) {
      toast.error((e as Error).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-white px-6 py-5">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Input
            placeholder="输入文件名关键词，在整个资料库中搜索…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            autoFocus
          />
          <Button onClick={run} disabled={loading || !q.trim()}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <SearchIcon className="mr-1.5 h-4 w-4" />}
            搜索
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items !== null && !loading && (
          <p className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-500">
            「{searched}」共找到 {items.length} 个文件{items.length >= 200 ? "（已截断，仅显示前 200 条）" : ""}
          </p>
        )}
        {items === null && !loading ? (
          <div className="p-16 text-center text-sm text-slate-400">输入关键词后按回车开始搜索</div>
        ) : (
          <FileResultList
            items={items ?? []}
            loading={loading}
            emptyText="没有找到匹配的文件"
            onNavigate={onNavigate}
            onOpenDialog={onOpenDialog}
            onOpenEditor={onOpenEditor}
          />
        )}
      </div>
    </div>
  );
}
