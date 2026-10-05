import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { api } from "@/lib/api";
import type { AppConfig, View } from "@/types";
import ClientsView from "@/sections/ClientsView";
import ClientView from "@/sections/ClientView";
import ProjectView from "@/sections/ProjectView";
import ExplorerView from "@/sections/ExplorerView";
import DocEditor from "@/sections/DocEditor";
import SearchView from "@/sections/SearchView";
import RecentView from "@/sections/RecentView";
import TrashView from "@/sections/TrashView";
import {
  ConfirmDeleteDialog,
  NewFolderDialog,
  NewProjectDialog,
  OpenWithDialog,
  PreviewDialog,
  RenameDialog,
  type DialogState,
} from "@/sections/Dialogs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Clock3, FolderPlus, HardDriveDownload, LayoutGrid, Search, Trash2 } from "lucide-react";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [view, setView] = useState<View>({ type: "clients" });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e) => setConfigError(e.message));
  }, []);

  const navigate = useCallback((v: View) => setView(v), []);
  const goPath = useCallback((path: string) => setView({ type: "explorer", path }), []);

  // 进入编辑器前的视图，用于「返回」
  const editorBackRef = useRef<View>({ type: "clients" });
  const openEditor = useCallback(
    (path: string, name: string) => {
      setView((cur) => {
        if (cur.type !== "editor") editorBackRef.current = cur;
        return { type: "editor", path, name };
      });
    },
    [],
  );

  if (configError) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <HardDriveDownload className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <p className="font-medium text-slate-700">无法连接本地资料服务</p>
          <p className="mt-1 text-sm text-slate-500">{configError}</p>
        </div>
      </div>
    );
  }

  const navBtn = (
    icon: React.ReactNode,
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
        active ? "bg-blue-600 font-medium text-white" : "text-slate-600 hover:bg-slate-200/70",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* 顶部导航栏 */}
      <header className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-bold tracking-tight">工程资料管理系统</h1>
          <span className="hidden max-w-72 truncate text-xs text-slate-400 lg:inline" title={config?.root}>
            {config?.root}
          </span>
        </div>
        <nav className="ml-4 flex items-center gap-1">
          {navBtn(<LayoutGrid className="h-4 w-4" />, "客户", view.type === "clients" || view.type === "client", () =>
            navigate({ type: "clients" }),
          )}
          {navBtn(<Search className="h-4 w-4" />, "全盘搜索", view.type === "search", () =>
            navigate({ type: "search" }),
          )}
          {navBtn(<Clock3 className="h-4 w-4" />, "最近更新", view.type === "recent", () =>
            navigate({ type: "recent" }),
          )}
          {navBtn(<Trash2 className="h-4 w-4" />, "回收站", view.type === "trash", () =>
            navigate({ type: "trash" }),
          )}
        </nav>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setDialog({ type: "newProject" })}>
            <FolderPlus className="mr-1.5 h-4 w-4" /> 新建项目
          </Button>
        </div>
      </header>

      {!config?.mounted && config && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ⚠️ 资料存储目录不可用：{config.root}（请联系管理员检查服务器）
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {view.type === "editor" ? (
          <DocEditor
            path={view.path}
            name={view.name}
            onClose={() => setView(editorBackRef.current)}
            onSaved={refresh}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            {view.type === "clients" && <ClientsView onNavigate={navigate} refreshKey={refreshKey} />}
            {view.type === "client" && (
              <ClientView
                client={view.client}
                onNavigate={navigate}
                onOpenDialog={setDialog}
                refreshKey={refreshKey}
              />
            )}
            {view.type === "project" && (
              <ProjectView
                client={view.client}
                year={view.year}
                project={view.project}
                onNavigate={navigate}
                onOpenDialog={setDialog}
                onOpenEditor={openEditor}
                refreshKey={refreshKey}
                onChanged={refresh}
              />
            )}
            {view.type === "explorer" && (
              <ExplorerView
                path={view.path}
                onNavigate={navigate}
                onOpenDialog={setDialog}
                onOpenEditor={openEditor}
                refreshKey={refreshKey}
                onChanged={refresh}
              />
            )}
            {view.type === "search" && (
              <SearchView onNavigate={navigate} onOpenDialog={setDialog} onOpenEditor={openEditor} />
            )}
            {view.type === "recent" && (
              <RecentView onNavigate={navigate} onOpenDialog={setDialog} onOpenEditor={openEditor} />
            )}
            {view.type === "trash" && <TrashView refreshKey={refreshKey} onChanged={refresh} />}
          </div>
        )}
      </main>

      {/* 全局对话框 */}
      <NewProjectDialog
        open={dialog?.type === "newProject"}
        presetClient={dialog?.type === "newProject" ? dialog.client : undefined}
        onClose={() => setDialog(null)}
        onCreated={(path) => {
          setDialog(null);
          refresh();
          toast.success("项目已创建，资料目录结构已生成");
          const seg = path.split("/");
          if (seg.length === 3) {
            setView({ type: "project", client: seg[0], year: seg[1], project: seg[2] });
          } else {
            goPath(path);
          }
        }}
      />
      <NewFolderDialog
        state={dialog?.type === "newFolder" ? dialog : null}
        onClose={() => setDialog(null)}
        onCreated={() => {
          setDialog(null);
          refresh();
          toast.success("文件夹已创建");
        }}
      />
      <RenameDialog
        state={dialog?.type === "rename" ? dialog : null}
        onClose={() => setDialog(null)}
        onRenamed={() => {
          setDialog(null);
          refresh();
          toast.success("已重命名");
        }}
      />
      <ConfirmDeleteDialog
        state={dialog?.type === "confirmDelete" ? dialog : null}
        onClose={() => setDialog(null)}
        onDeleted={() => {
          setDialog(null);
          refresh();
          toast.success("已移入回收站");
        }}
      />
      <PreviewDialog state={dialog?.type === "preview" ? dialog : null} onClose={() => setDialog(null)} />
      <OpenWithDialog state={dialog?.type === "openWith" ? dialog : null} onClose={() => setDialog(null)} />

      <Toaster richColors position="top-center" />
    </div>
  );
}
