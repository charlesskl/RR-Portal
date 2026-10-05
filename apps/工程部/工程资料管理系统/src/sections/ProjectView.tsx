import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CircleDashed,
  Download,
  ExternalLink,
  FilePlus2,
  Files,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DocTypeItem, View } from "@/types";
import type { DialogState } from "@/sections/Dialogs";
import ExplorerView from "@/sections/ExplorerView";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  client: string;
  year: string;
  project: string;
  onNavigate: (v: View) => void;
  onOpenDialog: (d: DialogState) => void;
  onOpenEditor: (path: string, name: string) => void;
  refreshKey: number;
  onChanged: () => void;
}

/** 项目「做资料」工作台：资料清单 + 从模板新建 + 状态跟踪 */
export default function ProjectView({
  client,
  year,
  project,
  onNavigate,
  onOpenDialog,
  onOpenEditor,
  refreshKey,
  onChanged,
}: Props) {
  const projPath = `${client}/${year}/${project}`;
  const [tab, setTab] = useState<"docs" | "files">("docs");
  const [items, setItems] = useState<DocTypeItem[] | null>(null);
  const [templatesDir, setTemplatesDir] = useState("系统模板库");
  const [error, setError] = useState("");
  const [busyRow, setBusyRow] = useState("");
  const uploadRowRef = useRef<DocTypeItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setItems(null);
    setError("");
    api
      .doctypes(projPath)
      .then((r) => {
        setItems(r.items);
        setTemplatesDir(r.templatesDir);
      })
      .catch((e) => setError(e.message));
  }, [projPath]);

  useEffect(load, [load, refreshKey]);

  /** 项目编号：取项目名称开头的数字（如 71172大脑 → 71172），没有则用全名 */
  const projectNo = project.match(/^\d+/)?.[0] ?? project;

  const createFromTemplate = async (dt: DocTypeItem) => {
    if (!dt.template) return;
    setBusyRow(dt.name);
    try {
      const r = await api.copyTemplate(dt.template, `${projPath}/${dt.dir}`, `${projectNo}-${dt.name}`);
      toast.success(`已新建：${r.path}`);
      load();
      onChanged();
      // 新建后直接在网页编辑器里打开（在各自电脑的浏览器里做资料）
      onOpenEditor(r.path, `${projectNo}-${dt.name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyRow("");
    }
  };

  const pickUpload = (dt: DocTypeItem) => {
    uploadRowRef.current = dt;
    fileInputRef.current?.click();
  };

  const onUploadChosen = async (files: FileList | null) => {
    const dt = uploadRowRef.current;
    if (!dt || !files?.length) return;
    setBusyRow(dt.name);
    try {
      for (const f of Array.from(files)) {
        await api.upload(`${projPath}/${dt.dir}`, f);
      }
      toast.success(`已上传到 ${dt.dir}`);
      load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyRow("");
      uploadRowRef.current = null;
    }
  };

  const doneCount = items?.filter((i) => i.existing).length ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => onNavigate({ type: "client", client })}
            title={`返回 ${client}`}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <button className="hover:text-blue-600" onClick={() => onNavigate({ type: "client", client })}>
                {client}
              </button>
              <span>/</span>
              <span>{year}</span>
            </div>
            <h2 className="truncate text-base font-bold">{project}</h2>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab("docs")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
              tab === "docs" ? "bg-blue-600 font-medium text-white" : "text-slate-600 hover:bg-slate-200/70",
            )}
          >
            <BadgeCheck className="h-4 w-4" /> 做资料
            {items && (
              <span className={cn("text-xs", tab === "docs" ? "text-blue-100" : "text-slate-400")}>
                {doneCount}/{items.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("files")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
              tab === "files" ? "bg-blue-600 font-medium text-white" : "text-slate-600 hover:bg-slate-200/70",
            )}
          >
            <Files className="h-4 w-4" /> 全部文件
          </button>
          <Button size="sm" variant="ghost" onClick={load} title="重新扫描">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {tab === "files" ? (
        <div className="min-h-0 flex-1">
          <ExplorerView
            path={projPath}
            onNavigate={onNavigate}
            onOpenDialog={onOpenDialog}
            onOpenEditor={onOpenEditor}
            refreshKey={refreshKey}
            onChanged={() => {
              onChanged();
              load();
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 p-6">
            {error ? (
              <div className="p-8 text-center text-sm text-red-600">{error}</div>
            ) : items === null ? (
              <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" /> 正在扫描项目资料…
              </div>
            ) : (
              <>
                {/* 资料清单 */}
                <Card>
                  <CardContent className="divide-y p-0">
                    {items.map((dt) => {
                      const done = !!dt.existing;
                      const existingFull = dt.existing ? `${projPath}/${dt.existing}` : "";
                      return (
                        <div key={dt.name} className="flex items-center gap-3 px-4 py-3">
                          {done ? (
                            <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-500" />
                          ) : (
                            <CircleDashed className="h-5 w-5 shrink-0 text-slate-300" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{dt.name}</span>
                              <Badge
                                variant={done ? "default" : "secondary"}
                                className={cn(done && "bg-emerald-600 hover:bg-emerald-600")}
                              >
                                {done ? "已完成" : "待做"}
                              </Badge>
                              <span className="text-xs text-slate-400">→ {dt.dir}</span>
                            </div>
                            {done && (
                              <p className="mt-0.5 truncate text-xs text-slate-400">{dt.existing}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {busyRow === dt.name && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                            {done ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  asChild
                                >
                                  <a href={api.fileUrl(existingFull, true)} download>
                                    <Download className="mr-1 h-3.5 w-3.5" /> 下载
                                  </a>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onOpenEditor(existingFull, dt.name)}
                                >
                                  <ExternalLink className="mr-1 h-3.5 w-3.5" /> 打开编辑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    onNavigate({
                                      type: "explorer",
                                      path: existingFull.split("/").slice(0, -1).join("/"),
                                    })
                                  }
                                >
                                  <FolderOpen className="mr-1 h-3.5 w-3.5" /> 定位
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => createFromTemplate(dt)}
                                  disabled={!dt.template || busyRow === dt.name}
                                  title={dt.template ? `以「${dt.template}」为模板新建` : `模板库中还没有「${dt.name}」模板`}
                                >
                                  <FilePlus2 className="mr-1 h-3.5 w-3.5" /> 从模板新建
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => pickUpload(dt)}
                                  disabled={busyRow === dt.name}
                                >
                                  <UploadCloud className="mr-1 h-3.5 w-3.5" /> 上传
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* 模板库提示 */}
                <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-800">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">模板库使用方法</p>
                    <p className="mt-1 leading-relaxed text-blue-700/90">
                      把空白模板文件放到资料库根目录的
                      <button
                        className="mx-1 font-medium underline underline-offset-2"
                        onClick={() => onNavigate({ type: "explorer", path: templatesDir })}
                      >
                        「{templatesDir}」
                      </button>
                      文件夹里，文件名带上资料名（如「作业指导书模板.xlsx」），上面的「从模板新建」就能一键生成
                      「{projectNo}-资料名」并自动打开编辑。做好的资料保存后点右上角刷新，状态会自动变绿。
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onUploadChosen(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
