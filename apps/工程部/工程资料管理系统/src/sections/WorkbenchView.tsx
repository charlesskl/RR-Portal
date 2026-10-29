import { StitchIcon } from "@/components/StitchIcon";
/**
 * EPMS 制单台 — 按 Stitch 设计稿(_7)逐块移植，数据与逻辑全部真实。
 * 草稿/锁/审核流存于项目目录 .epms/<单据>.json。
 */
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Plus, Trash2, Loader2, UploadCloud, FileImage } from "lucide-react";
import { toast } from "sonner";
import { api, type EpmsRecordPublic, type EditorLease } from "@/lib/api";
import { CoreAccountControl } from "@/components/EpmsAccount";
import { useEpmsAccess } from "@/lib/epms-access";
import type { DocTypeItem, View } from "@/types";

const FIELD_INPUT =
  "w-full bg-surface-container-highest border border-outline-variant/60 rounded px-2 py-1 text-xs font-mono font-bold text-secondary focus:border-secondary focus:ring-0 focus:outline-none disabled:opacity-50";
const CELL_INPUT =
  "w-full bg-surface-container-highest border border-outline-variant/50 rounded px-2 py-1 text-xs text-on-surface focus:border-secondary focus:ring-0 focus:outline-none disabled:opacity-50";

interface Props {
  client: string;
  year: string;
  project: string;
  onNavigate: (v: View) => void;
  onOpenEditor: (path: string, name: string, lease?: EditorLease) => void;
  initialLease?: EditorLease | null;
}

interface CavityRow { cavity: string; partName: string; partNo: string; gate: string; eject: string; note: string }
interface PaiMoForm {
  moldNo: string; cavities: string; tonnage: string; material: string;
  shrinkage: string; cycle: string; weight: string;
  rows: CavityRow[];
}
const emptyForm: PaiMoForm = {
  moldNo: "", cavities: "", tonnage: "", material: "", shrinkage: "", cycle: "", weight: "",
  rows: [{ cavity: "A1", partName: "", partNo: "", gate: "", eject: "", note: "" }],
};

type DocTab = "排模表" | "排模图" | "外购件清单" | "作业指导书";
const TABS: { key: DocTab; label: string; icon: string }[] = [
  { key: "排模表", label: "【1. 排模表】", icon: "grid_on" },
  { key: "排模图", label: "【2. 排模图 (图纸上传与受控图)】", icon: "image" },
  { key: "外购件清单", label: "【3. 外购件清单】", icon: "list_alt" },
  { key: "作业指导书", label: "【4. 作业指导书 (SOP)】", icon: "menu_book" },
];

const STATUS_TEXT: Record<string, string> = {
  none: "未开始", draft: "制单中(待提交审核)", pending: "审核中", approved: "审核记录已确认",
};

export default function WorkbenchView({ client, year, project, onNavigate, onOpenEditor, initialLease }: Props) {
  const projPath = `${client}/${year}/${project}`;
  const [tab, setTab] = useState<DocTab>((initialLease?.projectPath === projPath ? initialLease.doc as DocTab : null) || "排模表");
  const { session } = useEpmsAccess();
  const [rec, setRec] = useState<EpmsRecordPublic | null>(null);
  const [form, setForm] = useState<PaiMoForm>(() => structuredClone(emptyForm));
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(""), [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0), [now, setNow] = useState(Date.now());
  const [docItems, setDocItems] = useState<DocTypeItem[]>([]);
  const [token, setToken] = useState("");
  const tokenRef = useRef(""), handoffRef = useRef(false), scopeRef = useRef("");
  const generationRef = useRef(0);
  const scope = projPath + "::" + tab + "::" + (session?.id || "");
  const draft = rec?.status === "draft" || rec?.status === "none";
  const readOnly = loading || busy || !session?.canEdit || !draft || !token;
  const lockedByOther = rec?.lock && !token ? rec.lock : null;
  const lockRemain = rec?.lock ? Math.max(0, (rec.lockTtl || 900000) - (now - rec.lock.at)) : 0;
  const mm = String(Math.floor(lockRemain / 60000)).padStart(2, "0"), ss = String(Math.floor((lockRemain % 60000) / 1000)).padStart(2, "0");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    let alive = true;
    const generations = generationRef;
    const generation = ++generations.current;
    const current = () => alive && generations.current === generation;
    let timer: ReturnType<typeof setInterval> | undefined;
    scopeRef.current = scope; handoffRef.current = false; tokenRef.current = "";
    setToken(""); setRec(null); setForm(structuredClone(emptyForm)); setLoading(true); setMessage(""); setDirty(false); setBusy(false);
    const accept = (value: EpmsRecordPublic, includeForm: boolean) => {
      if (!current()) return;
      setRec((previous) => previous && previous.version > value.version ? previous : value);
      if (includeForm && tab === "排模表") setForm({ ...structuredClone(emptyForm), ...(value.data as Partial<PaiMoForm> || {}) });
    };
    if (!session?.canRead) { setLoading(false); return () => { alive = false; }; }
    void (async () => {
      try {
        const value = await api.epmsGet(projPath, tab);
        if (!current()) return;
        accept(value, true);
        const mayLock = ((value.status === "draft" || value.status === "none") && session.canEdit)
          || (value.status === "pending" && session.canReview);
        if (!mayLock) return;
        const inherited = initialLease?.projectPath === projPath && initialLease.doc === tab ? initialLease.token : undefined;
        const locked = await api.epmsLock(projPath, tab, inherited);
        if (!current()) { if (locked.lockToken) void api.epmsUnlock(projPath, tab, locked.lockToken).catch(() => {}); return; }
        accept(locked, true); tokenRef.current = locked.lockToken || ""; setToken(tokenRef.current);
        if (!tokenRef.current) { setMessage("未取得编辑凭据，当前只读"); return; }
        timer = setInterval(() => {
          const owned = tokenRef.current;
          if (!owned) return;
          api.epmsLock(projPath, tab, owned).then((renewed) => {
            if (current()) accept(renewed, false);
          }).catch((cause) => {
            if (!current()) return;
            generations.current++; tokenRef.current = ""; setToken(""); setMessage("操作锁已失效，当前输入已保留；请重新打开单据后核对：" + cause.message);
          });
        }, 60000);
      } catch (cause) { if (current()) setMessage((cause as Error).message); }
      finally { if (current()) setLoading(false); }
    })();
    return () => {
      alive = false; if (generations.current === generation) generations.current++; if (timer) clearInterval(timer);
      const owned = tokenRef.current; tokenRef.current = "";
      if (owned && !handoffRef.current) void api.epmsUnlock(projPath, tab, owned).catch(() => {});
    };
  }, [scope, projPath, tab, session?.canRead, session?.canEdit, session?.canReview, initialLease, reloadKey]);
  useEffect(() => {
    let alive = true;
    api.doctypes(projPath).then((value) => { if (alive) setDocItems(value.items); }).catch(() => {});
    return () => { alive = false; };
  }, [projPath]);
  const setField = (key: keyof PaiMoForm, value: string) => { setDirty(true); setForm((old) => ({ ...old, [key]: value })); };
  const setRow = (index: number, key: keyof CavityRow, value: string) => {
    setDirty(true); setForm((old) => ({ ...old, rows: old.rows.map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  };
  const mayLeave = () => !dirty || window.confirm("尚有未保存的输入，确认放弃这些输入？");
  const act = async (fn: (owned: string, version: number, observedSave: (value: EpmsRecordPublic) => void) => Promise<EpmsRecordPublic>, ok: string) => {
    if (!tokenRef.current || !rec) { toast.error("尚未取得本单据的操作凭据"); return; }
    const requestScope = scope; const requestGeneration = generationRef.current; setBusy(true); setMessage("");
    try {
      const value = await fn(tokenRef.current, rec.version, (saved) => {
        if (scopeRef.current === requestScope && generationRef.current === requestGeneration) {
          setRec((previous) => previous && previous.version > saved.version ? previous : saved);
          setDirty(false);
        }
      });
      if (scopeRef.current !== requestScope || generationRef.current !== requestGeneration) return;
      setRec((previous) => previous && previous.version > value.version ? previous : value); setDirty(false); tokenRef.current = value.lockToken || ""; setToken(tokenRef.current);
      toast.success(ok); if (!value.lockToken) setReloadKey((key) => key + 1);
    } catch (cause) {
      if (scopeRef.current === requestScope && generationRef.current === requestGeneration) setMessage("操作未完成，当前输入已保留：" + (cause as Error).message);
    } finally { if (scopeRef.current === requestScope && generationRef.current === requestGeneration) setBusy(false); }
  };
  const releaseForLogout = async () => {
    if (!mayLeave()) throw new Error("请先保存草稿再退出");
    if (tokenRef.current) await api.epmsUnlock(projPath, tab, tokenRef.current);
    tokenRef.current = ""; setToken("");
  };
  const openFile = (path: string, name: string) => {
    if (!mayLeave()) return;
    handoffRef.current = Boolean(tokenRef.current);
    onOpenEditor(path, name, { projectPath: projPath, doc: tab, token: tokenRef.current, readOnly });
  };
  const docItemsByName = Object.fromEntries(docItems.map((item) => [item.name === "外购清单" ? "外购件清单" : item.name, item]));
  const workflowNote = loading ? "正在读取单据状态…"
    : rec?.status === "approved" ? "审核记录已确认，当前资料只读；请同时查看文件完整性提示。"
    : rec?.status === "pending" ? (token && session?.canReview
      ? "内容已锁定为只读；已持有操作锁，可审核通过或驳回。"
      : "内容已锁定为只读，等待有审核权限的账号取得操作锁后处理。")
    : lockedByOther ? "当前由[" + lockedByOther.by + "]持有操作锁，你为只读模式。"
    : readOnly ? "当前为只读模式，无法修改或保存草稿。"
    : "已持有操作锁；修改后请点击保存草稿，未保存的输入不会自动同步。";

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col">
      {/* ── 顶部紧凑导航栏 ── */}
      <header className="sticky top-0 z-50 bg-surface-container-low border-b border-surface-container-highest px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => { if (mayLeave()) onNavigate({ type: "project", client, year, project }); }}
            className="w-8 h-8 rounded bg-secondary/15 flex items-center justify-center text-secondary border border-secondary/30 hover:bg-secondary/25 transition"
            title="返回项目">
            <StitchIcon name="table_chart" className="text-[20px]" />
          </button>
          <div>
            <h1 className="text-base font-bold text-on-surface tracking-tight leading-tight">工程部放产资料管理</h1>
            <p className="text-[11px] text-on-surface-variant leading-none">Engineering Production Release Workbench</p>
          </div>
        </div>

        {/* 上下文信息 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-surface-container border border-surface-container-highest rounded px-2 py-1 text-xs">
            <span className="text-on-surface-variant mr-1">客户:</span>
            <span className="text-secondary font-medium">{client}</span>
          </div>
          <div className="flex items-center bg-surface-container border border-surface-container-highest rounded px-2 py-1 text-xs">
            <span className="text-on-surface-variant mr-1">模号 / 机型:</span>
            <span className="text-on-surface font-mono font-medium">{project}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container border border-surface-container-highest text-xs font-mono">
            <span className="text-on-surface-variant text-[11px]">唯一受控编号:</span>
            <span className="text-secondary font-bold">{rec?.docNo || "保存后生成"}</span>
          </div>
          {rec?.lock && !lockedByOther && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/80 text-emerald-300 text-xs font-medium border border-emerald-500/40">
              <StitchIcon name="lock" className="text-[14px] text-emerald-400" />
              <span>独占操作锁已持有</span>
              <span className="font-mono text-[10px] text-emerald-400/80 ml-0.5">(倒计时 {mm}:{ss})</span>
            </div>
          )}
          <CoreAccountControl beforeLogout={releaseForLogout} />
        </div>

        {/* 动作按钮区 */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button
            className="min-h-11 sm:min-h-0 flex items-center gap-1 px-3 py-1.5 rounded bg-surface-container-highest hover:bg-surface-bright text-xs text-on-surface border border-surface-container-highest transition disabled:opacity-40"
            disabled={busy || readOnly || tab !== "排模表"}
            onClick={() => act((owned, version) => api.epmsSave(projPath, tab, form, owned, version), "草稿已保存")}>
            <StitchIcon name="save" className="text-[16px]" />
            <span>保存草稿</span>
          </button>
          <button
            className="min-h-11 sm:min-h-0 flex items-center gap-1 px-3 py-1.5 rounded bg-secondary-container hover:bg-secondary text-xs text-on-secondary-container font-semibold transition shadow-sm disabled:opacity-40"
            disabled={busy || readOnly || (rec?.status !== "draft" && rec?.status !== "none")}
            onClick={() => act(async (owned, version, observedSave) => {
              const saved = tab === "排模表" ? await api.epmsSave(projPath, tab, form, owned, version) : rec!;
              observedSave(saved);
              return api.epmsStatus(projPath, tab, "submit", owned, saved.version);
            }, "已提交工程师审核")}>
            <StitchIcon name="send" className="text-[16px]" />
            <span>提交工程师审核</span>
          </button>
          <button
            className="min-h-11 sm:min-h-0 flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-semibold transition shadow-sm disabled:opacity-40"
            disabled={busy || loading || !session?.canReview || !token || rec?.status !== "pending"}
            onClick={() => act((owned, version) => api.epmsStatus(projPath, tab, "approve", owned, version), "审核通过，已归档")}>
            <StitchIcon name="verified" className="text-[16px]" />
            <span>审核通过并归档</span>
          </button>
          <button
            className="min-h-11 sm:min-h-0 flex items-center gap-1 px-3 py-1.5 rounded bg-surface-container-highest hover:bg-error-container/40 text-xs text-error border border-surface-container-highest transition disabled:opacity-40"
            disabled={busy || loading || !session?.canReview || !token || rec?.status !== "pending"}
            onClick={() => act((owned, version) => api.epmsStatus(projPath, tab, "return", owned, version), "已驳回，退回制单")}>
            <StitchIcon name="undo" className="text-[16px]" />
            <span>驳回</span>
          </button>
        </div>
      </header>

      {!session?.canRead && <div role="status" className="m-4 rounded border border-tertiary p-3 text-tertiary">请使用核心系统个人账号登录；姓名和权限由服务端验证。</div>}
      {message && <div role="alert" className="m-4 rounded border border-error p-3 text-error">{message}</div>}
      {rec?.status === "approved" && rec.integrityStatus !== "verified" && <div role="alert" className="m-4 rounded border border-error p-3 text-error">
        {rec.integrityStatus === "changed" ? "当前文件与审核时记录不一致，不能视为已批准文件。" : "当前无法核验文件与审核记录是否一致，不能视为已批准文件。"}
      </div>}
      {/* ── 主工作区 ── */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 flex flex-col gap-4">
        {/* Tab 切换栏 + 锁定提示徽章 */}
        <div className="bg-surface-container-low border border-surface-container-highest rounded px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="flex max-w-full min-w-0 items-center gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} aria-pressed={tab === t.key} onClick={() => {
                if (tab === t.key || !mayLeave()) return;
                generationRef.current++;
                const owned = tokenRef.current; tokenRef.current = "";
                if (owned) void api.epmsUnlock(projPath, tab, owned).catch(() => {});
                setToken(""); setRec(null); setForm(structuredClone(emptyForm)); setLoading(true); setDirty(false); setTab(t.key);
              }}
                className={tab === t.key
                  ? "flex items-center gap-1.5 px-4 py-1.5 rounded bg-secondary text-on-secondary font-bold text-xs shadow-sm"
                  : "flex items-center gap-1.5 px-3 py-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container text-xs transition"}>
                <StitchIcon name={t.icon} className="text-[16px]" />
                <span>{t.label}</span>
                {tab === t.key && <span className="text-[10px] bg-on-secondary/20 px-1 rounded ml-1">当前</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-surface-container-lowest border border-tertiary/40 text-xs">
            <StitchIcon name="shield_lock" className="text-[15px] text-tertiary" />
            <span className="text-tertiary font-medium">服务器并发防串机制生效中</span>
            <span className="text-outline-variant">·</span>
            <span className="text-on-surface-variant text-[11px]">
              {workflowNote}
            </span>
          </div>
        </div>

        {/* 内容 + 侧边信息布局 */}
        <div className="grid grid-cols-12 gap-4 items-start">
          <div className="col-span-12 xl:col-span-9 flex flex-col gap-4">
            {tab === "排模表" ? (
              <section className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm overflow-hidden">
                {/* 表格头部说明栏 */}
                <div className="bg-surface-container px-4 py-2.5 border-b border-surface-container-highest flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-secondary/15 text-secondary px-1.5 py-0.5 rounded font-bold border border-secondary/30">FORM-TPL-01</span>
                    <h2 className="text-sm font-bold text-on-surface">模具排模规格与排产基准表 (Die & Cavity Layout Sheet)</h2>
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono">
                    状态: <span className="text-secondary font-semibold">{STATUS_TEXT[rec?.status || "none"]}</span> | 填报人: {rec?.by || session?.name || "-"}
                  </div>
                </div>

                {/* 基础信息 */}
                <div className="p-3 bg-surface-container-lowest border-b border-surface-container-highest">
                  <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                    <StitchIcon name="tune" className="text-[15px]" />
                    <span>一、模具基础参数设定 (基础字段)</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                    <FieldBox label="模具编号">
                      <input className={FIELD_INPUT} type="text" placeholder="MOLD-2026-088" disabled={readOnly}
                        value={form.moldNo} onChange={(e) => setField("moldNo", e.target.value)} />
                    </FieldBox>
                    <FieldBox label="模具穴数">
                      <input className={FIELD_INPUT} type="text" placeholder="1*4 穴 (平衡)" disabled={readOnly}
                        value={form.cavities} onChange={(e) => setField("cavities", e.target.value)} />
                    </FieldBox>
                    <FieldBox label="机台吨位">
                      <input className={FIELD_INPUT} type="text" placeholder="250 T" disabled={readOnly}
                        value={form.tonnage} onChange={(e) => setField("tonnage", e.target.value)} />
                    </FieldBox>
                    <FieldBox label="胶件材质">
                      <input className={FIELD_INPUT} type="text" placeholder="ABS + PC (阻燃V0)" disabled={readOnly}
                        value={form.material} onChange={(e) => setField("material", e.target.value)} />
                    </FieldBox>
                    <FieldBox label="材料缩水率" suffix="%">
                      <input className={FIELD_INPUT + " rounded-l rounded-none"} type="text" placeholder="0.5" disabled={readOnly}
                        value={form.shrinkage} onChange={(e) => setField("shrinkage", e.target.value)} />
                    </FieldBox>
                    <FieldBox label="成型周期" suffix="s">
                      <input className={FIELD_INPUT + " rounded-l rounded-none"} type="text" placeholder="28.0" disabled={readOnly}
                        value={form.cycle} onChange={(e) => setField("cycle", e.target.value)} />
                    </FieldBox>
                    <FieldBox label="产品单重" suffix="g">
                      <input className={FIELD_INPUT + " rounded-l rounded-none"} type="text" placeholder="45.2" disabled={readOnly}
                        value={form.weight} onChange={(e) => setField("weight", e.target.value)} />
                    </FieldBox>
                  </div>
                </div>

                {/* 穴位与模仁排位细表 */}
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-secondary flex items-center gap-1">
                      <StitchIcon name="apps" className="text-[15px]" />
                      <span>二、穴位与模仁排位细表 (表头格式严格锁定)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-surface-container-highest">共 {form.rows.length} 个受控排穴位</span>
                      <button className="flex items-center gap-1 text-[11px] text-secondary hover:text-secondary-fixed disabled:opacity-40"
                        disabled={readOnly}
                        onClick={() => { setDirty(true); setForm((f) => ({ ...f, rows: [...f.rows, { cavity: "", partName: "", partNo: "", gate: "", eject: "", note: "" }] })); }}>
                        <Plus className="h-3.5 w-3.5" /> 添加穴位
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-surface-container-highest rounded">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-surface-container text-on-surface font-semibold border-b border-surface-container-highest">
                          <th className="py-2 px-3 w-12 text-center text-on-surface-variant">序号</th>
                          <th className="py-2 px-3 w-28 text-secondary">模穴编号 (Cavity)</th>
                          <th className="py-2 px-3 w-44">对应零件名称</th>
                          <th className="py-2 px-3 w-40 font-mono">零件料号 (P/N)</th>
                          <th className="py-2 px-3 w-32">浇口类型</th>
                          <th className="py-2 px-3 w-32">顶出方式</th>
                          <th className="py-2 px-3">模仁状态 / 工艺备注</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-container-highest bg-surface-container-low/70">
                        {form.rows.map((r, i) => (
                          <tr key={i} className="hover:bg-surface-container/60 transition">
                            <td className="py-2 px-3 text-center font-mono text-on-surface-variant">{String(i + 1).padStart(2, "0")}</td>
                            <td className="py-2 px-3"><input className={CELL_INPUT + " font-bold text-secondary"} placeholder="A1" disabled={readOnly} aria-label={"cavity 第 " + (i + 1) + " 行"} value={r.cavity} onChange={(e) => setRow(i, "cavity", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT} placeholder="零件名称" disabled={readOnly} aria-label={"partName 第 " + (i + 1) + " 行"} value={r.partName} onChange={(e) => setRow(i, "partName", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT + " font-mono"} placeholder="P/N" disabled={readOnly} aria-label={"partNo 第 " + (i + 1) + " 行"} value={r.partNo} onChange={(e) => setRow(i, "partNo", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT} placeholder="热咀直浇口" disabled={readOnly} aria-label={"gate 第 " + (i + 1) + " 行"} value={r.gate} onChange={(e) => setRow(i, "gate", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT} placeholder="圆顶针+扁顶针" disabled={readOnly} aria-label={"eject 第 " + (i + 1) + " 行"} value={r.eject} onChange={(e) => setRow(i, "eject", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT + " text-on-surface-variant"} placeholder="718H钢材淬火 / 咬花等级" disabled={readOnly} aria-label={"note 第 " + (i + 1) + " 行"} value={r.note} onChange={(e) => setRow(i, "note", e.target.value)} /></td>
                            <td className="py-2 px-1 text-center">
                              <button aria-label={"删除第 " + (i + 1) + " 行"} className="text-error hover:text-error/80 disabled:opacity-30" disabled={readOnly || form.rows.length <= 1}
                                onClick={() => { setDirty(true); setForm((f) => ({ ...f, rows: f.rows.filter((_, j) => j !== i) })); }}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : (
              <DocTabPanel key={tab} tab={tab} projPath={projPath} item={docItemsByName[tab]} onOpenEditor={openFile} readOnly={readOnly} lockToken={token}
                onChanged={() => api.doctypes(projPath).then((d) => setDocItems(d.items))} />
            )}
          </div>

          {/* ── 右侧信息栏 ── */}
          <div className="col-span-12 xl:col-span-3 flex flex-col gap-4">
            <div className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                <StitchIcon name="group" className="text-[15px]" />
                <span>协同防串与操作锁状态</span>
              </div>
              <div className="space-y-1.5 text-[11px] text-on-surface-variant">
                <div className="flex justify-between"><span>当前锁持有者:</span><span className="text-on-surface font-medium">{rec?.lock ? rec.lock.by : "空闲"}</span></div>
                <div className="flex justify-between"><span>最近操作:</span><span className="text-on-surface font-medium">{rec?.by || "-"}</span></div>
                <div className="flex justify-between"><span>锁规则:</span><span>独占 15 分钟自动释放</span></div>
                <div className="flex justify-between"><span>单据状态:</span><span className="text-secondary font-medium">{STATUS_TEXT[rec?.status || "none"]}</span></div>
              </div>
            </div>

            <div className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                <StitchIcon name="folder_open" className="text-[15px]" />
                <span>归档客户库信息</span>
              </div>
              <div className="rounded bg-surface-container-lowest border border-surface-container-highest p-2 font-mono text-[11px] text-on-surface-variant leading-relaxed">
                📁 {client}<br />└ 📁 {year}<br /> └ 📁 {project}<br />  └ 📁 工程放产资料
              </div>
            </div>

            <div className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                <StitchIcon name="fact_check" className="text-[15px]" />
                <span>工程师审核链 (3步极简流程)</span>
              </div>
              {[
                { n: 1, t: "制单人填报", on: true, cur: rec?.status === "draft" || !rec || rec.status === "none" },
                { n: 2, t: "工程师审核", on: rec?.status === "pending" || rec?.status === "approved", cur: rec?.status === "pending" },
                { n: 3, t: "审核记录已确认", on: rec?.status === "approved", cur: rec?.status === "approved" },
              ].map((s) => (
                <div key={s.n} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${s.on ? "border-secondary text-secondary" : "border-surface-container-highest text-on-surface-variant"}`}>{s.n}</span>
                  <span className={s.on ? "text-on-surface" : "text-on-surface-variant"}>{s.t}</span>
                  {s.cur && <span className="text-[10px] text-tertiary bg-tertiary-container px-1 rounded">当前</span>}
                </div>
              ))}
              {rec?.history?.length ? (
                <div className="mt-2 border-t border-surface-container-highest pt-2 space-y-1 text-[10px] text-on-surface-variant">
                  <div>最近 4 条操作（共 {rec.history.length} 条记录）</div>
                  {rec.history.slice(-4).reverse().map((h, i) => (
                    <div key={i}>{h.action} · {h.by} · {new Date(h.at).toLocaleString("zh-CN")}</div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="bg-surface-container-low border border-tertiary/30 rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-tertiary mb-1.5 flex items-center gap-1">
                <StitchIcon name="tips_and_updates" className="text-[15px]" />
                <span>制单与防呆提醒</span>
              </div>
              <ul className="text-[10px] text-on-surface-variant space-y-1 list-disc pl-4">
                <li>单据按「项目+资料类型」锁定，他人打开自动只读</li>
                <li>{workflowNote}</li>
                <li>提交审核后锁定编辑，驳回后退回制单人</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FieldBox({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string; "aria-label"?: string }>, { id, "aria-label": label }) : children;
  return (
    <div className="bg-surface-container p-2 rounded border border-surface-container-highest">
      <label htmlFor={id} className="text-[11px] text-on-surface-variant block mb-1">{label}</label>
      {suffix ? (
        <div className="flex items-center">
          {control}
          <span className="bg-surface-container-highest border-y border-r border-outline-variant/60 text-xs px-1.5 py-1 text-on-surface-variant rounded-r">{suffix}</span>
        </div>
      ) : control}
    </div>
  );
}

/* ── 排模图 / 外购清单 / 作业指导书 页签 ── */
function DocTabPanel({ tab, projPath, item, onOpenEditor, onChanged, readOnly, lockToken }: {
  tab: DocTab; projPath: string; item?: DocTypeItem; readOnly: boolean; lockToken: string;
  onOpenEditor: (path: string, name: string) => void; onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const existingFull = item?.existing ? `${projPath}/${item.existing}` : null;
  const isXlsx = existingFull ? /\.xlsx?$/i.test(existingFull) : false;

  const doUpload = async (f: File) => {
    if (readOnly || !lockToken) return;
    if (!f.name.includes(tab) && !(tab === "外购件清单" && f.name.includes("外购清单"))) {
      toast.error("文件名需包含资料类型（" + tab + "），以便归入正确单据"); return;
    }
    setUploading(true);
    try {
      await api.upload(projPath + "/" + (item?.dir || "工程放产资料"), f, undefined, { lockToken });
      toast.success("上传成功");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setUploading(false);
  };

  return (
    <section className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm p-6">
      <div className="text-sm font-bold text-on-surface mb-4">{tab}</div>
      {existingFull ? (
        <div className="space-y-3">
          <div className="rounded bg-surface-container-lowest border border-surface-container-highest p-3 text-xs font-mono text-secondary">{item!.existing}</div>
          <div className="flex gap-2">
            {isXlsx ? (
              <button className="min-h-11 sm:min-h-0 flex items-center gap-1 px-3 py-1.5 rounded bg-secondary-container hover:bg-secondary text-xs text-on-secondary-container font-semibold transition"
                onClick={() => onOpenEditor(existingFull, tab)}>
                <StitchIcon name="edit_document" className="text-[16px]" /> {readOnly ? "只读查看表格" : "打开网页编辑"}
              </button>
            ) : (
              <a className="min-h-11 sm:min-h-0 flex items-center gap-1 px-3 py-1.5 rounded bg-secondary-container hover:bg-secondary text-xs text-on-secondary-container font-semibold transition"
                href={api.fileUrl(existingFull, true)} download>
                <StitchIcon name="download" className="text-[16px]" /> 下载查看
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-xs text-on-surface-variant">
          <p>该资料还没有文件。{tab === "排模图" ? "可以上传图纸/图片/PDF：" : "可以上传做好的表格："}</p>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded border border-dashed border-surface-container-highest text-on-surface hover:border-secondary transition disabled:opacity-40"
            disabled={uploading || readOnly} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "排模图" ? <FileImage className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
            上传{tab}文件
          </button>
          <p className="text-[10px]">上传后回到项目页也可以用「从模板新建」生成空白表格在线填写。</p>
        </div>
      )}
      <input ref={fileRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ""; }} />
    </section>
  );
}
