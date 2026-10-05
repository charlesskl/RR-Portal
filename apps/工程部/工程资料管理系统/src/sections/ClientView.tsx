import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  FolderOpen,
  FolderPlus,
  ListChecks,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DirEntry, ProjectInfo, View } from "@/types";
import type { DialogState } from "@/sections/Dialogs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface Props {
  client: string;
  onNavigate: (v: View) => void;
  onOpenDialog: (d: DialogState) => void;
  refreshKey: number;
}

/** 标准资料目录（新建项目时自动生成的那套） */
const STANDARD_DIRS = ["工程放产资料", "模具图", "包装印刷最终文件"];

/** 客户工作区：年份 → 项目 → 点进项目做资料 */
export default function ClientView({ client, onNavigate, onOpenDialog, refreshKey }: Props) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState("");
  const [year, setYear] = useState<string>("");
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [projError, setProjError] = useState("");
  const [localKey, setLocalKey] = useState(0);
  // 批量管理
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // 加载客户根目录：分出年份目录和其他目录
  useEffect(() => {
    setEntries(null);
    setError("");
    api
      .list(client)
      .then((r) => {
        const dirs = r.entries.filter((e) => e.kind === "dir");
        setEntries(dirs);
        const years = dirs
          .filter((d) => /^\d{4}$/.test(d.name))
          .map((d) => d.name)
          .sort()
          .reverse();
        setYear((y) => (years.includes(y) ? y : (years[0] ?? "")));
      })
      .catch((e) => setError(e.message));
  }, [client, refreshKey, localKey]);

  // 加载选中年份下的项目
  useEffect(() => {
    if (!year) {
      setProjects(null);
      return;
    }
    setProjects(null);
    setProjError("");
    api
      .projects(client, year)
      .then((r) => setProjects(r.projects))
      .catch((e) => setProjError(e.message));
  }, [client, year, refreshKey, localKey]);

  const years = useMemo(
    () =>
      (entries ?? [])
        .filter((d) => /^\d{4}$/.test(d.name))
        .map((d) => d.name)
        .sort()
        .reverse(),
    [entries],
  );
  const otherDirs = useMemo(() => (entries ?? []).filter((d) => !/^\d{4}$/.test(d.name)), [entries]);

  const toggle = (path: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(path);
      else n.delete(path);
      return n;
    });

  const exitManage = () => {
    setManageMode(false);
    setSelected(new Set());
  };

  const doBatchDelete = async () => {
    setBatchBusy(true);
    try {
      const r = await api.batchDelete(Array.from(selected));
      if (r.failed.length) {
        toast.error(`已删除 ${r.deleted} 个项目，${r.failed.length} 个失败：${r.failed[0].error}`);
      } else {
        toast.success(`已将 ${r.deleted} 个项目移入回收站`);
      }
      setConfirmBatch(false);
      exitManage();
      setLocalKey((k) => k + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBatchBusy(false);
    }
  };

  if (error) {
    return <div className="p-8 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-6xl p-6 pb-24">
      {/* 头部 */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => onNavigate({ type: "clients" })} title="返回客户列表">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{client}</h2>
            <p className="text-xs text-slate-500">选择项目，进入后即可上传、查看、整理资料</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {projects && projects.length > 0 && (
            <Button variant={manageMode ? "secondary" : "outline"} onClick={() => (manageMode ? exitManage() : setManageMode(true))}>
              <ListChecks className="mr-1.5 h-4 w-4" /> {manageMode ? "退出管理" : "批量管理"}
            </Button>
          )}
          <Button onClick={() => onOpenDialog({ type: "newProject", client })}>
            <FolderPlus className="mr-1.5 h-4 w-4" /> 新建项目
          </Button>
        </div>
      </div>

      {entries === null ? (
        <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> 正在读取…
        </div>
      ) : (
        <>
          {/* 年份切换 */}
          {years.length > 0 && (
            <div className="mb-4 flex items-center gap-1 border-b">
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={cn(
                    "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                    y === year
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-800",
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          {/* 项目卡片 */}
          {projError ? (
            <div className="p-8 text-center text-sm text-red-600">{projError}</div>
          ) : year && projects === null ? (
            <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> 正在扫描项目…
            </div>
          ) : projects && projects.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => {
                const checked = selected.has(p.path);
                return (
                  <Card
                    key={p.path}
                    className={cn(
                      "group relative cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md",
                      manageMode && checked && "border-red-400 ring-2 ring-red-300",
                    )}
                    onClick={() =>
                      manageMode
                        ? toggle(p.path, !checked)
                        : onNavigate({ type: "project", client, year, project: p.name })
                    }
                  >
                    {manageMode && (
                      <span
                        className={cn(
                          "absolute -left-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-white text-xs font-bold",
                          checked ? "border-red-500 bg-red-500 text-white" : "border-slate-300 text-transparent",
                        )}
                      >
                        ✓
                      </span>
                    )}
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="h-5 w-5 shrink-0 text-amber-500" />
                          <span className="truncate font-semibold group-hover:text-blue-700">{p.name}</span>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {p.fileCount} 个文件
                        </Badge>
                      </div>
                      {/* 标准目录齐套情况 */}
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                        {STANDARD_DIRS.map((sd) => {
                          const has = p.subdirs.includes(sd);
                          return (
                            <span
                              key={sd}
                              className={cn(
                                "flex items-center gap-1 text-xs",
                                has ? "text-emerald-600" : "text-slate-400",
                              )}
                            >
                              {has ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                              {sd}
                            </span>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : year ? (
            <div className="rounded-lg border border-dashed bg-white p-12 text-center">
              <p className="text-sm text-slate-500">{year} 年还没有项目</p>
              <Button className="mt-3" onClick={() => onOpenDialog({ type: "newProject", client })}>
                <FolderPlus className="mr-1.5 h-4 w-4" /> 新建第一个项目
              </Button>
            </div>
          ) : null}

          {/* 其他目录 */}
          {otherDirs.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 text-sm font-semibold text-slate-500">其他目录</h3>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                {otherDirs.map((d) => (
                  <button
                    key={d.name}
                    className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-left text-sm transition-colors hover:border-blue-300 hover:text-blue-700"
                    onClick={() => onNavigate({ type: "explorer", path: `${client}/${d.name}` })}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="truncate">{d.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 批量管理底部操作栏 */}
      {manageMode && (
        <div className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-white px-5 py-2.5 shadow-lg">
          <span className="text-sm text-slate-600">已选 {selected.size} 个项目</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSelected(
                selected.size === (projects?.length ?? 0)
                  ? new Set()
                  : new Set((projects ?? []).map((p) => p.path)),
              )
            }
          >
            {selected.size === (projects?.length ?? 0) ? "取消全选" : "全选"}
          </Button>
          <Button size="sm" variant="destructive" disabled={selected.size === 0} onClick={() => setConfirmBatch(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" /> 移入回收站
          </Button>
          <Button size="sm" variant="outline" onClick={exitManage}>
            完成
          </Button>
        </div>
      )}

      {/* 批量删除确认 */}
      <AlertDialog open={confirmBatch} onOpenChange={setConfirmBatch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              选中的 {selected.size} 个项目（含里面的所有文件）将被移入资料库根目录下的回收站，可随时还原。
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
    </div>
  );
}
