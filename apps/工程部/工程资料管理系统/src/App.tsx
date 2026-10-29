import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { api, type EditorLease } from "@/lib/api";
import { CoreAccountControl, EpmsAccountProvider } from "@/components/EpmsAccount";
import { useEpmsAccess } from "@/lib/epms-access";
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
import { Menu, X, FolderPlus, HardDriveDownload } from "lucide-react";
import { StitchIcon } from "@/components/StitchIcon";

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
      { icon: "inventory", label: "回收站", view: "trash" },
      { icon: "search", label: "全盘搜索", view: "search" },
      { icon: "update", label: "最近更新", view: "recent" },
    ],
  },
];

function EngineeringApp() {
  const { session, revision } = useEpmsAccess();
  const [editorLease, setEditorLease] = useState<EditorLease | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [view, setView] = useState<View>({ type: "dashboard" });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const refreshKey = refreshCount + revision;
  const [searchQ, setSearchQ] = useState("");
  const [searchRequest, setSearchRequest] = useState({ text: "", id: 0 });
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeNav = useCallback(() => { setNavOpen(false); menuRef.current?.focus(); }, []);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeNav(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, closeNav]);

  const refresh = useCallback(() => setRefreshCount((k) => k + 1), []);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e) => setConfigError(e.message));
  }, []);

  const navigate = useCallback((v: View) => { setEditorLease(null); setView(v); }, []);
  const goPath = useCallback((path: string) => { setEditorLease(null); setView({ type: "explorer", path }); }, []);

  // 进入编辑器前的视图，用于「返回」
  const editorBackRef = useRef<View>({ type: "dashboard" });
  const openEditor = useCallback((path: string, name: string, lease?: EditorLease) => {
    setEditorLease(lease || null);
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
          <DocEditor path={view.path} name={view.name} lease={editorLease} onClose={() => setView(editorBackRef.current)} onSaved={refresh} />
        ) : (
          <div className="h-full overflow-y-auto">
            <WorkbenchView key={view.client + "/" + view.year + "/" + view.project} initialLease={editorLease} client={view.client} year={view.year} project={view.project} onNavigate={navigate} onOpenEditor={openEditor} />
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
      {navOpen && <button type="button" aria-label="关闭导航" onClick={closeNav} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}
      <aside id="engineering-navigation" aria-label="主导航" className={[(navOpen ? "flex" : "hidden"), "lg:flex fixed left-0 top-0 h-full w-72 max-w-[calc(100vw-2rem)] bg-surface-container-low z-50 flex-col shadow-[0_1px_8px_rgba(0,0,0,0.04)]"].join(" ")}>
        <div className="h-14 px-space-xl flex items-center justify-between bg-surface-container-lowest">
          <div className="flex items-center gap-space-sm">
            <StitchIcon name="tune" className="text-secondary text-[20px]" />
            <span className="font-label-lg text-label-lg text-primary tracking-wide">ENGINEERING PDM</span>
          </div>
          <button type="button" aria-label="关闭导航" onClick={closeNav} className="lg:hidden min-h-11 min-w-11"><X className="h-5 w-5" /></button>
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
                    <button type="button"
                      key={it.label}
                      className={`w-full min-h-11 lg:min-h-0 text-left flex items-center gap-space-md px-space-md py-space-sm rounded transition-colors font-body-md text-body-md cursor-pointer ${cls}`}
                      onClick={() => {
                        if (it.soon) { toast.info(`「${it.label}」模块规划中，后续上线`); return; }
                        if (it.view) { navigate({ type: it.view } as View); setNavOpen(false); }
                      }}
                    >
                      <StitchIcon name={it.icon} className="text-[18px]" />
                      <span>{it.label}</span>{it.soon && <small className="ml-auto whitespace-nowrap">规划中</small>}
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
        <div className="p-space-md bg-surface-container-lowest flex items-center justify-between text-on-surface-variant">
          <div className="flex items-center gap-space-sm font-label-sm text-label-sm">
            <span className="inline-block w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
            <span>{config ? (config.mounted ? "资料目录已连接" : "资料目录不可用") : "正在连接资料目录"}</span>
          </div>
          <span className="font-label-sm text-label-sm text-primary">{config?.root?.split("/").pop()}</span>
        </div>
      </aside>

      <div className="lg:pl-72 h-full min-w-0 flex flex-col">
        {/* ── 顶栏（Stitch 设计稿原样） ── */}
        <header className="min-h-14 shrink-0 bg-surface-container-low/95 shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-30 px-3 sm:px-gutter py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button ref={menuRef} type="button" aria-label="打开主导航" aria-expanded={navOpen} aria-controls="engineering-navigation" onClick={() => setNavOpen(true)} className="lg:hidden min-h-11 min-w-11"><Menu className="h-5 w-5" /></button>
            <div className="flex min-w-0 flex-col">
              <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight leading-none">EPMS 工程放产协同中枢</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Engineering Production Release Matrix</span>
            </div>
          </div>
          <div className="flex w-full sm:w-auto min-w-0 flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-space-lg">
            <form role="search" className="relative min-w-0 basis-full sm:basis-auto flex-1 flex items-center" onSubmit={(event) => { event.preventDefault(); if (searchQ.trim()) { setSearchRequest((previous) => ({ text: searchQ.trim(), id: previous.id + 1 })); navigate({ type: "search" }); } }}>
              <StitchIcon name="search" className="absolute left-space-md text-[16px] text-on-surface-variant pointer-events-none" />
              <input
                className="w-full sm:w-56 min-h-11 sm:min-h-0 min-w-0 pl-8 pr-space-md py-[5px] bg-surface-container-highest text-on-surface font-body-sm text-body-sm rounded placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-1 focus:ring-secondary"
                placeholder="搜索料号/资料/项目..."
                type="search"
                aria-label="搜索工程资料"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </form>
            <CoreAccountControl />
            <button
              disabled={!session?.canEdit}
              className="min-h-11 sm:min-h-0 flex items-center gap-space-xs px-space-md py-[5px] bg-secondary text-on-secondary font-label-md text-label-md rounded font-semibold hover:bg-secondary-fixed transition-colors"
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

        <main className="relative min-h-0 flex-1 overflow-y-auto w-full min-w-0 px-3 sm:px-gutter bg-surface">
          <div className={view.type === "dashboard" ? "" : "legacy-surface min-h-full"}>
          {view.type === "dashboard" && <DashboardView onNavigate={navigate} refreshKey={refreshKey} />}
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
          {view.type === "search" && <SearchView request={searchRequest} onNavigate={navigate} onOpenDialog={setDialog} onOpenEditor={openEditor} />}
          {view.type === "recent" && <RecentView onNavigate={navigate} onOpenDialog={setDialog} onOpenEditor={openEditor} />}
          {view.type === "trash" && <TrashView refreshKey={refreshKey} onChanged={refresh} />}
          </div>
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

export default function App() {
  return <EpmsAccountProvider><EngineeringApp /></EpmsAccountProvider>;
}
