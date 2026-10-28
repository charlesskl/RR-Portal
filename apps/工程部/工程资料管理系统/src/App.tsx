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
import { FolderPlus, HardDriveDownload } from "lucide-react";

/** 侧边导航项（Stitch 设计稿结构；尚无对应模块的显示"规划中"） */
const NAV: { group: string; badge?: string; items: { icon: string; label: string; view?: View["type"]; soon?: boolean }[] }[] = [
  {
    group: "核心驾驶舱",
    items: [{ icon: "space_dashboard", label: "放产态势大盘", view: "dashboard" }],
  },
  {
    group: "在线工程资料库",
    badge: "CORE",
    items: [
      { icon: "dataset", label: "工程资料在线工作台", view: "clients" },
      { icon: "account_tree", label: "BOM 结构与替代料库", soon: true },
      { icon: "developer_board", label: "数字化工序 SOP 卡编排", soon: true },
      { icon: "precision_manufacturing", label: "工装夹具与检验标准", soon: true },
    ],
  },
  {
    group: "受控放行与审批",
    items: [
      { icon: "verified", label: "多方放产会签评审", soon: true },
      { icon: "difference", label: "工程变更与版本差异 (ECN)", soon: true },
    ],
  },
  {
    group: "底座与设置",
    items: [
      { icon: "inventory", label: "受控归档分发与水印", view: "trash" },
      { icon: "search", label: "全盘搜索", view: "search" },
      { icon: "update", label: "最近更新", view: "recent" },
    ],
  },
];

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [view, setView] = useState<View>({ type: "dashboard" });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQ, setSearchQ] = useState("");

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
  const editorBackRef = useRef<View>({ type: "dashboard" });
  const openEditor = useCallback((path: string, name: string) => {
    setView((cur) => {
      if (cur.type !== "editor") editorBackRef.current = cur;
      return { type: "editor", path, name };
    });
  }, []);

  if (configError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <HardDriveDownload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">无法连接本地资料服务</p>
          <p className="mt-1 text-sm text-muted-foreground">{configError}</p>
        </div>
      </div>
    );
  }

  // 编辑器 / 制单台：全屏不带壳
  if (view.type === "editor" || view.type === "workbench") {
    return (
      <div className="h-screen overflow-hidden bg-background text-foreground">
        {view.type === "editor" ? (
          <DocEditor path={view.path} name={view.name} onClose={() => setView(editorBackRef.current)} onSaved={refresh} />
        ) : (
          <div className="h-full overflow-y-auto">
            <WorkbenchView client={view.client} year={view.year} project={view.project} onNavigate={navigate} onOpenEditor={openEditor} />
          </div>
        )}
        <Toaster richColors position="top-center" />
      </div>
    );
  }

  const isClientsFamily = view.type === "clients" || view.type === "client" || view.type === "project" || view.type === "explorer";

  return (
    <div className="bg-background font-body-md text-on-surface antialiased h-screen overflow-hidden">
      {/* ── 侧边栏（Stitch 设计稿原样） ── */}
      <aside className="fixed left-0 top-0 h-full w-72 bg-surface-container-low z-50 flex flex-col shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-14 px-space-xl flex items-center justify-between bg-surface-container-lowest">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-secondary text-[20px]">tune</span>
            <span className="font-label-lg text-label-lg text-primary tracking-wide">ENGINEERING PDM</span>
          </div>
          <span className="font-label-sm text-label-sm text-secondary px-space-xs py-[2px] bg-surface-container-high rounded">V3.8</span>
        </div>
        <div className="flex-1 overflow-y-auto px-space-md py-space-lg space-y-space-xl">
          {NAV.map((g) => (
            <div className="space-y-space-xs" key={g.group}>
              <div className="px-space-sm py-space-xs flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                <span>{g.group}</span>
                {g.badge && (
                  <span className="font-label-sm text-label-sm text-tertiary bg-tertiary-container px-space-xs py-[1px] rounded">{g.badge}</span>
                )}
              </div>
              <nav className="space-y-[2px]">
                {g.items.map((it) => {
                  const active =
                    (it.view === "dashboard" && view.type === "dashboard") ||
                    (it.view === "clients" && isClientsFamily) ||
                    (it.view && view.type === it.view);
                  const cls = active
                    ? "bg-surface-container-high text-secondary border-l-2 border-secondary font-semibold"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface";
                  return (
                    <a
                      key={it.label}
                      className={`flex items-center gap-space-md px-space-md py-space-sm rounded transition-colors font-body-md text-body-md cursor-pointer ${cls}`}
                      onClick={() => {
                        if (it.soon) { toast.info(`「${it.label}」模块规划中，后续上线`); return; }
                        if (it.view) navigate({ type: it.view } as View);
                      }}
                    >
                      <span className="material-symbols-outlined text-[18px]">{it.icon}</span>
                      <span>{it.label}</span>
                    </a>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
        <div className="p-space-md bg-surface-container-lowest flex items-center justify-between text-on-surface-variant">
          <div className="flex items-center gap-space-sm font-label-sm text-label-sm">
            <span className="inline-block w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
            <span>资料库连接正常</span>
          </div>
          <span className="font-label-sm text-label-sm text-primary">{config?.root?.split("/").pop()}</span>
        </div>
      </aside>

      <div className="pl-72 h-full flex flex-col">
        {/* ── 顶栏（Stitch 设计稿原样） ── */}
        <header className="h-14 shrink-0 bg-surface-container-low/95 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 px-gutter flex items-center justify-between">
          <div className="flex items-center gap-gutter">
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight leading-none">EPMS 工程放产协同中枢</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Engineering Production Release Matrix</span>
            </div>
          </div>
          <div className="flex items-center gap-space-lg">
            <div className="relative flex items-center">
              <span className="material-symbols-outlined absolute left-space-md text-[16px] text-on-surface-variant pointer-events-none">search</span>
              <input
                className="w-56 pl-8 pr-space-md py-[5px] bg-surface-container-highest text-on-surface font-body-sm text-body-sm rounded placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-1 focus:ring-secondary"
                placeholder="搜索料号/资料/项目..."
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchQ.trim()) navigate({ type: "search" });
                }}
                onFocus={() => navigate({ type: "search" })}
              />
            </div>
            <button
              className="flex items-center gap-space-xs px-space-md py-[5px] bg-secondary text-on-secondary font-label-md text-label-md rounded font-semibold hover:bg-secondary-fixed transition-colors"
              onClick={() => setDialog({ type: "newProject" })}
            >
              <FolderPlus className="h-4 w-4" />
              <span>新建项目</span>
            </button>
          </div>
        </header>

        {!config?.mounted && config && (
          <div className="shrink-0 border-b border-tertiary-container bg-tertiary-container/30 px-gutter py-2 font-body-sm text-body-sm text-tertiary">
            ⚠️ 资料存储目录不可用：{config.root}（请联系管理员检查服务器）
          </div>
        )}

        <main className="relative flex-1 overflow-y-auto w-full px-gutter bg-surface">
          {view.type === "dashboard" && <DashboardView onNavigate={navigate} />}
          {view.type === "clients" && <ClientsView onNavigate={navigate} refreshKey={refreshKey} />}
          {view.type === "client" && (
            <ClientView client={view.client} onNavigate={navigate} onOpenDialog={setDialog} refreshKey={refreshKey} />
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
          {view.type === "search" && <SearchView onNavigate={navigate} onOpenDialog={setDialog} onOpenEditor={openEditor} />}
          {view.type === "recent" && <RecentView onNavigate={navigate} onOpenDialog={setDialog} onOpenEditor={openEditor} />}
          {view.type === "trash" && <TrashView refreshKey={refreshKey} onChanged={refresh} />}
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
