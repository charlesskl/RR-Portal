import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { api } from "@/lib/api";
import type { AppConfig, View } from "@/types";
import ClientsView from "@/sections/ClientsView";
import ClientView from "@/sections/ClientView";
import ProjectView from "@/sections/ProjectView";
import ExplorerView from "@/sections/ExplorerView";
import DocEditor from "@/sections/DocEditor";
import WorkbenchView from "@/sections/WorkbenchView";
import SearchView from "@/sections/SearchView";
import RecentView from "@/sections/RecentView";
import TrashView from "@/sections/TrashView";
import DashboardView from "@/sections/DashboardView";
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
import { Clock3, FolderPlus, Gauge, HardDriveDownload, LayoutGrid, Search, Trash2 } from "lucide-react";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [view, setView] = useState<View>({ type: "dashboard" });
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
      <div className="flex h-screen items-center justify-center bg-[#0d1628]">
        <div className="rounded-xl border bg-[#111c30] p-8 text-center shadow-sm">
          <HardDriveDownload className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <p className="font-medium text-slate-200">无法连接本地资料服务</p>
          <p className="mt-1 text-sm text-slate-500">{configError}</p>
        </div>
      </div>
    );
  }

  const navItem = (
    icon: React.ReactNode,
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-[#16233d] font-medium text-cyan-300" : "text-slate-400 hover:bg-[#131f36] hover:text-slate-200",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b1220] text-slate-200">
      {/* 左侧导航（EPMS 暗色受控风格） */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-[#1e2d4a] bg-[#0d1628]">
        <div className="border-b border-[#1e2d4a] px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-cyan-600/20 text-cyan-400">
              <LayoutGrid className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">EPMS</div>
              <div className="text-[10px] text-slate-500">工程部放产资料管理</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-300">核心驾驶舱</div>
          {navItem(<Gauge className="h-4 w-4" />, "放产态势大盘", view.type === "dashboard", () =>
            navigate({ type: "dashboard" }),
          )}
          <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-300">在线工程资料库</div>
          {navItem(<LayoutGrid className="h-4 w-4" />, "客户资料库", view.type === "clients" || view.type === "client" || view.type === "project", () =>
            navigate({ type: "clients" }),
          )}
          {navItem(<Search className="h-4 w-4" />, "全盘搜索", view.type === "search", () =>
            navigate({ type: "search" }),
          )}
          {navItem(<Clock3 className="h-4 w-4" />, "最近更新", view.type === "recent", () =>
            navigate({ type: "recent" }),
          )}
          <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-300">底座与设置</div>
          {navItem(<Trash2 className="h-4 w-4" />, "回收站", view.type === "trash", () =>
            navigate({ type: "trash" }),
          )}
        </nav>
        <div className="border-t border-[#1e2d4a] p-3">
          <Button size="sm" className="w-full bg-cyan-600 text-[#0b1220] hover:bg-cyan-500" onClick={() => setDialog({ type: "newProject" })}>
            <FolderPlus className="mr-1.5 h-4 w-4" /> 新建项目
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!config?.mounted && config && (
          <div className="shrink-0 border-b border-amber-800/50 bg-amber-900/20 px-4 py-2 text-sm text-amber-300">
            ⚠️ 资料存储目录不可用：{config.root}（请联系管理员检查服务器）
          </div>
        )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {view.type === "workbench" ? (
          <div className="h-full overflow-y-auto">
            <WorkbenchView
              client={view.client}
              year={view.year}
              project={view.project}
              onNavigate={navigate}
              onOpenEditor={openEditor}
            />
          </div>
        ) : view.type === "editor" ? (
          <DocEditor
            path={view.path}
            name={view.name}
            onClose={() => setView(editorBackRef.current)}
            onSaved={refresh}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            {view.type === "dashboard" && <DashboardView onNavigate={navigate} />}
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
      </div>

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
