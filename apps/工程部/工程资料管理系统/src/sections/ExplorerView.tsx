import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FilePenLine,
  FolderOpen,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { canPreview, CATEGORY_STYLE, fileCategory, formatSize, formatTime } from "@/lib/file-utils";
import type { DirEntry, View } from "@/types";
import type { DialogState } from "@/sections/Dialogs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MoreHorizontal } from "lucide-react";

interface UploadTask {
  id: number;
  name: string;
  pct: number;
  error?: string;
}

interface Props {
  path: string;
  onNavigate: (v: View) => void;
  onOpenDialog: (d: DialogState) => void;
  onOpenEditor: (path: string, name: string) => void;
  refreshKey: number;
  onChanged: () => void;
}

export default function ExplorerView({ path, onNavigate, onOpenDialog, onOpenEditor, refreshKey, onChanged }: Props) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taskId = useRef(0);

  const load = useCallback(() => {
    setEntries(null);
    setError("");
    setSelected(new Set());
    api
      .list(path)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e.message));
  }, [path]);

  useEffect(load, [load, refreshKey]);

  const doUpload = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const id = ++taskId.current;
        setUploads((u) => [...u, { id, name: file.name, pct: 0 }]);
        try {
          await api.upload(path, file, (pct) =>
            setUploads((u) => u.map((t) => (t.id === id ? { ...t, pct } : t))),
          );
          setUploads((u) => u.filter((t) => t.id !== id));
          toast.success(`已上传：${file.name}`);
        } catch (e) {
          const msg = (e as Error).message;
          setUploads((u) => u.map((t) => (t.id === id ? { ...t, error: msg } : t)));
          toast.error(`上传失败：${file.name} — ${msg}`);
          setTimeout(() => setUploads((u) => u.filter((t) => t.id !== id)), 5000);
        }
      }
      onChanged();
      load();
    },
    [path, load, onChanged],
  );

  const toggle = (name: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(name);
      else n.delete(name);
      return n;
    });

  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set((entries ?? []).map((e) => e.name)) : new Set());

  const doBatchDelete = async () => {
    if (!entries) return;
    setBatchBusy(true);
    const paths = entries
      .filter((e) => selected.has(e.name))
      .map((e) => (path ? `${path}/${e.name}` : e.name));
    try {
      const r = await api.batchDelete(paths);
      if (r.failed.length) {
        toast.error(`${r.deleted} 项已移入回收站，${r.failed.length} 项失败：${r.failed[0].error}`);
      } else {
        toast.success(`已将 ${r.deleted} 项移入回收站`);
      }
      setSelected(new Set());
      setConfirmBatch(false);
      onChanged();
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBatchBusy(false);
    }
  };

  const crumbs = path ? path.split("/") : [];

  const openEntry = (e: DirEntry) => {
    const full = path ? `${path}/${e.name}` : e.name;
    if (e.kind === "dir") {
      onNavigate({ type: "explorer", path: full });
    } else if (e.ext === ".xlsx" || e.ext === ".xls") {
      onOpenEditor(full, e.name);
    } else if (canPreview(e.ext)) {
      onOpenDialog({ type: "preview", path: full, name: e.name, ext: e.ext });
    } else {
      window.open(api.fileUrl(full), "_blank");
    }
  };

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
      }}
    >
      {/* 面包屑 + 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-2.5">
        <nav className="flex min-w-0 items-center gap-0.5 text-sm">
          <button
            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100"
            onClick={() => onNavigate({ type: "clients" })}
          >
            客户首页
          </button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join("/");
            const last = i === crumbs.length - 1;
            return (
              <span key={p} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <button
                  className={cn(
                    "truncate rounded px-1.5 py-0.5 hover:bg-slate-100",
                    last ? "font-semibold text-slate-900" : "text-slate-600",
                  )}
                  onClick={() => {
                    if (last) return;
                    if (i === 0) onNavigate({ type: "client", client: c });
                    else onNavigate({ type: "explorer", path: p });
                  }}
                >
                  {c}
                </button>
              </span>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setConfirmBatch(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" /> 移入回收站 ({selected.size})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud className="mr-1.5 h-4 w-4" /> 上传文件
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenDialog({ type: "newFolder", parentPath: path })}
          >
            <FolderOpen className="mr-1.5 h-4 w-4" /> 新建文件夹
          </Button>
          <Button size="sm" variant="ghost" onClick={load} title="刷新">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) doUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* 上传进度 */}
      {uploads.length > 0 && (
        <div className="space-y-1.5 border-b bg-blue-50/60 px-4 py-2">
          {uploads.map((t) => (
            <div key={t.id} className="flex items-center gap-3 text-xs">
              <span className="w-56 truncate font-medium">{t.name}</span>
              {t.error ? (
                <span className="text-red-600">{t.error}</span>
              ) : (
                <>
                  <Progress value={t.pct} className="h-1.5 flex-1" />
                  <span className="w-10 text-right text-slate-500">{t.pct}%</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 文件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {error ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : entries === null ? (
          <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> 正在读取目录…
          </div>
        ) : entries.length === 0 ? (
          <div className="p-16 text-center">
            <UploadCloud className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">此目录为空，拖拽文件到此处即可上传</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={entries.length > 0 && selected.size === entries.length}
                    onCheckedChange={(v) => toggleAll(!!v)}
                    aria-label="全选"
                  />
                </TableHead>
                <TableHead className="w-[45%]">名称</TableHead>
                <TableHead className="w-24">类型</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-40">修改时间</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const full = path ? `${path}/${e.name}` : e.name;
                const cat = e.kind === "dir" ? null : CATEGORY_STYLE[fileCategory(e.ext)];
                const checked = selected.has(e.name);
                return (
                  <TableRow
                    key={e.name}
                    className={cn("cursor-pointer", checked && "bg-blue-50/60")}
                    onDoubleClick={() => openEntry(e)}
                    onClick={() => (e.kind === "dir" ? openEntry(e) : toggle(e.name, !checked))}
                  >
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggle(e.name, !!v)}
                        aria-label={`选择 ${e.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {e.kind === "dir" ? (
                          <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                        ) : (
                          <span
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                              cat?.className,
                            )}
                          >
                            {e.ext.replace(".", "").slice(0, 4).toUpperCase() || "?"}
                          </span>
                        )}
                        <span className="truncate font-medium">{e.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {e.kind === "dir" ? (
                        <Badge variant="secondary">文件夹</Badge>
                      ) : (
                        <span className={cn("rounded px-1.5 py-0.5 text-xs", cat?.className)}>{cat?.label}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {e.kind === "dir" ? "—" : formatSize(e.size)}
                    </TableCell>
                    <TableCell className="text-slate-500">{formatTime(e.mtime)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {e.kind === "file" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="下载"
                            asChild
                          >
                            <a
                              href={api.fileUrl(full, true)}
                              download
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(ev) => ev.stopPropagation()}>
                          {e.kind === "file" && canPreview(e.ext) && (
                            <DropdownMenuItem
                              onClick={() => onOpenDialog({ type: "preview", path: full, name: e.name, ext: e.ext })}
                            >
                              <Eye className="mr-2 h-4 w-4" /> 预览
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              if (e.kind === "file" && (e.ext === ".xlsx" || e.ext === ".xls")) {
                                onOpenEditor(full, e.name);
                              } else {
                                onOpenDialog({ type: "openWith", path: full, name: e.name });
                              }
                            }}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" /> 打开编辑
                          </DropdownMenuItem>
                          {e.kind === "file" && (
                            <DropdownMenuItem onClick={() => window.open(api.fileUrl(full, true), "_blank")}>
                              <Download className="mr-2 h-4 w-4" /> 下载
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => onOpenDialog({ type: "rename", path: full, name: e.name })}
                          >
                            <FilePenLine className="mr-2 h-4 w-4" /> 重命名
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => onOpenDialog({ type: "confirmDelete", path: full, name: e.name })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> 移入回收站
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 批量删除确认 */}
      <AlertDialog open={confirmBatch} onOpenChange={setConfirmBatch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量移入回收站？</AlertDialogTitle>
            <AlertDialogDescription>
              选中的 {selected.size} 个项目将被移入资料库根目录下的回收站，可随时还原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doBatchDelete} disabled={batchBusy} className="bg-red-600 hover:bg-red-700">
              {batchBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} 移入回收站
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 拖拽提示遮罩 */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-4 border-dashed border-blue-400 bg-blue-50/80">
          <div className="text-center">
            <UploadCloud className="mx-auto mb-2 h-12 w-12 text-blue-500" />
            <p className="font-medium text-blue-700">松开鼠标，上传到当前目录</p>
          </div>
        </div>
      )}
    </div>
  );
}
