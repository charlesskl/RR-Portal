/**
 * EPMS 制单台（工程部放产资料管理工作台）
 * 按 Stitch 设计稿实现：客户/项目上下文、防串单编辑锁、保存草稿、提交审核、审核归档。
 * 数据存在项目目录 .epms/<单据>.json，与 xlsx 资料互不干扰。
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Lock, LockOpen, Save, Send, BadgeCheck, Undo2, Plus, Trash2,
  UploadCloud, FileImage, Loader2, Users, FolderArchive, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { api, type EpmsRecordPublic, type EditorLease } from "@/lib/api";
import { CoreAccountControl } from "@/components/EpmsAccount";
import { useEpmsAccess } from "@/lib/epms-access";
import type { DocTypeItem, View } from "@/types";

/* ---------- 样式常量（暗色受控风格） ---------- */
const BG = "min-h-screen bg-[#0b1220] text-slate-200";
const CARD = "rounded-lg border border-[#1e2d4a] bg-[#111c30]";
const INPUT =
  "w-full rounded border border-[#26375a] bg-[#0d1729] px-2 py-1.5 text-sm text-cyan-100 outline-none focus:border-cyan-500 disabled:opacity-50";
const LABEL = "mb-1 block text-xs text-slate-400";
const BTN = "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition disabled:opacity-40";

interface Props {
  client: string;
  year: string;
  project: string;
  onNavigate: (v: View) => void;
  onOpenEditor: (path: string, name: string, lease?: EditorLease) => void;
  initialLease?: EditorLease | null;
}

interface CavityRow {
  cavity: string; partName: string; partNo: string; gate: string; eject: string; note: string;
}
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
const TABS: { key: DocTab; label: string }[] = [
  { key: "排模表", label: "【1. 排模表】" },
  { key: "排模图", label: "【2. 排模图(图纸)】" },
  { key: "外购件清单", label: "【3. 外购件清单】" },
  { key: "作业指导书", label: "【4. 作业指导书(SOP)】" },
];

const STATUS_TEXT: Record<string, { text: string; cls: string }> = {
  none: { text: "未开始", cls: "text-slate-400" },
  draft: { text: "制单中（待提交审核）", cls: "text-amber-400" },
  pending: { text: "审核中", cls: "text-cyan-400" },
  approved: { text: "审核记录已确认", cls: "text-emerald-400" },
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

  const st = STATUS_TEXT[rec?.status || "none"];

  return (
    <div className={BG}>
      {/* 顶栏 */}
      <div className="border-b border-[#1e2d4a] bg-[#0d1628] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { if (mayLeave()) onNavigate({ type: "project", client, year, project }); }}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-cyan-300">
            <ArrowLeft className="h-4 w-4" /> 返回
          </button>
          <div className="text-base font-bold text-slate-100">工程部放产资料管理 · 制单台</div>
          <span className="rounded border border-[#26375a] px-2 py-0.5 text-xs text-cyan-300">
            客户：{client} / {project}
          </span>
          <span className="rounded border border-[#26375a] px-2 py-0.5 text-xs text-cyan-300">
            唯一受控编号：{rec?.docNo || "保存后生成"}
          </span>
          {rec?.lock && !lockedByOther && (
            <span className="flex items-center gap-1 rounded border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400">
              <Lock className="h-3 w-3" /> 独占操作锁已持有（倒计时 {mm}:{ss}）
            </span>
          )}
          {lockedByOther && (
            <span className="flex items-center gap-1 rounded border border-amber-700 bg-amber-900/30 px-2 py-0.5 text-xs text-amber-400">
              <LockOpen className="h-3 w-3" /> {lockedByOther.by} 正在编辑，你为只读
            </span>
          )}
          <div className="ml-auto"><CoreAccountControl beforeLogout={releaseForLogout} /></div>
        </div>
        {/* 操作按钮 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button className={`${BTN} border border-[#26375a] text-slate-300 hover:border-cyan-500`}
            disabled={busy || readOnly || tab !== "排模表"}
            onClick={() => act((owned, version) => api.epmsSave(projPath, tab, form, owned, version), "草稿已保存")}>
            <Save className="h-4 w-4" /> 保存草稿
          </button>
          <button className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`}
            disabled={busy || readOnly || (rec?.status !== "draft" && rec?.status !== "none")}
            onClick={() => act(async (owned, version, observedSave) => { const saved = tab === "排模表" ? await api.epmsSave(projPath, tab, form, owned, version) : rec!; observedSave(saved); return api.epmsStatus(projPath, tab, "submit", owned, saved.version); }, "已提交工程师审核")}>
            <Send className="h-4 w-4" /> 提交工程师审核
          </button>
          <button className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-500`}
            disabled={busy || loading || !session?.canReview || !token || rec?.status !== "pending"}
            onClick={() => act((owned, version) => api.epmsStatus(projPath, tab, "approve", owned, version), "审核通过，已归档")}>
            <BadgeCheck className="h-4 w-4" /> 审核通过并归档
          </button>
          <button className={`${BTN} border border-red-800 text-red-400 hover:bg-red-900/30`}
            disabled={busy || loading || !session?.canReview || !token || rec?.status !== "pending"}
            onClick={() => act((owned, version) => api.epmsStatus(projPath, tab, "return", owned, version), "已驳回，退回制单")}>
            <Undo2 className="h-4 w-4" /> 驳回
          </button>
          <span className={`text-sm ${st.cls}`}>资料编制状态：{st.text}</span>
        </div>
      </div>

      {!session?.canRead && <div role="status" className="mx-4 mt-3 rounded border border-amber-700 p-3 text-sm text-amber-300">请使用门户个人账号登录；姓名和权限以服务端验证为准。</div>}
      {message && <div role="alert" className="mx-4 mt-3 rounded border border-red-700 p-3 text-sm text-red-300">{message}</div>}
      {rec?.status === "approved" && rec.integrityStatus !== "verified" && <div role="alert" className="mx-4 mt-3 rounded border border-red-700 p-3 text-sm text-red-300">
        {rec.integrityStatus === "changed" ? "当前文件与审核时记录不一致，不能视为已批准文件。" : "当前无法核验文件与审核记录是否一致，不能视为已批准文件。"}
      </div>}
      <p className="px-4 py-2 text-xs text-slate-400">{workflowNote}</p>
      {/* 页签 */}
      <div className="flex gap-1 border-b border-[#1e2d4a] bg-[#0d1628] px-4 pt-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => {
                if (tab === t.key || !mayLeave()) return;
                generationRef.current++;
                const owned = tokenRef.current; tokenRef.current = "";
                if (owned) void api.epmsUnlock(projPath, tab, owned).catch(() => {});
                setToken(""); setRec(null); setForm(structuredClone(emptyForm)); setLoading(true); setDirty(false); setTab(t.key);
              }}
            className={`rounded-t px-3 py-1.5 text-sm ${tab === t.key ? "bg-[#16233d] text-cyan-300 border border-b-0 border-[#26375a]" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {lockedByOther && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded border border-amber-700/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
          <Users className="h-4 w-4" />
          {workflowNote}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[1fr_320px]">
        {/* 主区 */}
        <div>
          {tab === "排模表" && (
            <div className={CARD + " p-4"}>
              <div className="mb-3 flex items-center justify-between border-b border-[#1e2d4a] pb-2">
                <div className="text-sm font-semibold text-slate-100">
                  <span className="mr-2 rounded bg-[#16233d] px-2 py-0.5 text-xs text-cyan-300">FORM-TPL-01</span>
                  模具排模规格与排产基准表 (Die & Cavity Layout Sheet)
                </div>
                <div className="text-xs text-slate-400">填报人：{rec?.by || session?.name || "-"}</div>
              </div>

              <div className="mb-1 text-xs font-semibold text-cyan-400">一、模具基础参数设定（基础字段）</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {([
                  ["moldNo", "模具编号", "MOLD-2026-088"],
                  ["cavities", "模具穴数", "1*4 穴（平衡）"],
                  ["tonnage", "机台吨位", "250 T"],
                  ["material", "胶件材质", "ABS + PC"],
                  ["shrinkage", "材料缩水率 %", "0.5"],
                  ["cycle", "成型周期 s", "28.0"],
                  ["weight", "产品单重 g", "45.2"],
                ] as [keyof PaiMoForm, string, string][]).map(([k, label, ph]) => (
                  <div key={k}>
                    <label className={LABEL}>{label}</label>
                    <input className={INPUT} placeholder={ph} disabled={readOnly}
                      aria-label={label} value={form[k] as string} onChange={(e) => setField(k, e.target.value)} />
                  </div>
                ))}
              </div>

              <div className="mb-1 mt-5 flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-400">二、穴位与模仁排位细表</span>
                <button className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                  disabled={readOnly}
                  onClick={() => { setDirty(true); setForm((f) => ({ ...f, rows: [...f.rows, { cavity: "", partName: "", partNo: "", gate: "", eject: "", note: "" }] })); }}>
                  <Plus className="h-3.5 w-3.5" /> 添加穴位
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#26375a] text-left text-xs text-slate-400">
                      <th className="py-1.5 pr-2">序号</th><th className="pr-2">模穴编号</th><th className="pr-2">对应零件名称</th>
                      <th className="pr-2">零件料号</th><th className="pr-2">浇口类型</th><th className="pr-2">顶出方式</th>
                      <th className="pr-2">模仁状态/工艺备注</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.rows.map((r, i) => (
                      <tr key={i} className="border-b border-[#1a2947]">
                        <td className="py-1 pr-2 text-slate-400">{String(i + 1).padStart(2, "0")}</td>
                        {(["cavity", "partName", "partNo", "gate", "eject", "note"] as (keyof CavityRow)[]).map((k) => (
                          <td key={k} className="pr-2 py-1">
                            <input className={INPUT} disabled={readOnly} aria-label={String(k) + " 第 " + (i + 1) + " 行"} value={r[k]}
                              onChange={(e) => setRow(i, k, e.target.value)} />
                          </td>
                        ))}
                        <td>
                          <button aria-label={"删除第 " + (i + 1) + " 行"} className="text-red-400 hover:text-red-300 disabled:opacity-30" disabled={readOnly || form.rows.length <= 1}
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
          )}

          {tab !== "排模表" && <DocTabPanel key={tab} tab={tab} projPath={projPath} item={docItemsByName[tab]} onOpenEditor={openFile} readOnly={readOnly} lockToken={token} onChanged={() => api.doctypes(projPath).then((d) => setDocItems(d.items))} />}
        </div>

        {/* 右栏 */}
        <div className="space-y-4">
          <div className={CARD + " p-3"}>
            <div className="mb-2 text-xs font-semibold text-cyan-400">协同防串与操作锁状态</div>
            <div className="space-y-1 text-xs text-slate-300">
              <div>当前锁持有者：<span className="text-cyan-300">{rec?.lock ? rec.lock.by : "空闲"}</span></div>
              <div>最近操作：<span className="text-cyan-300">{rec?.by || "-"}</span> {rec?.updatedAt ? new Date(rec.updatedAt).toLocaleString("zh-CN") : ""}</div>
              <div>锁规则：独占 15 分钟，无操作自动释放</div>
            </div>
          </div>
          <div className={CARD + " p-3"}>
            <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-cyan-400"><FolderArchive className="h-3.5 w-3.5" /> 归档客户库信息</div>
            <div className="rounded bg-[#0d1729] p-2 font-mono text-xs text-slate-300">
              📁 {client}<br />└ 📁 {year}<br /> └ 📁 {project}
            </div>
          </div>
          <div className={CARD + " p-3"}>
            <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-cyan-400"><ClipboardList className="h-3.5 w-3.5" /> 工程师审核链（3 步极简流程）</div>
            {[
              { n: 1, t: "制单人填报", on: true },
              { n: 2, t: "工程师审核", on: rec?.status === "pending" || rec?.status === "approved" },
              { n: 3, t: "审核记录已确认", on: rec?.status === "approved" },
            ].map((s) => (
              <div key={s.n} className="flex items-center gap-2 py-1.5 text-xs">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${s.on ? "border-emerald-500 text-emerald-400" : "border-[#26375a] text-slate-500"}`}>{s.n}</span>
                <span className={s.on ? "text-slate-200" : "text-slate-500"}>{s.t}</span>
              </div>
            ))}
            {rec?.history?.length ? (
              <div className="mt-2 border-t border-[#1e2d4a] pt-2 text-xs text-slate-400">
                {rec.history.slice(-4).reverse().map((h, i) => (
                  <div key={i}>{h.action} · {h.by} · {new Date(h.at).toLocaleString("zh-CN")}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 排模图 / 外购清单 / 作业指导书 页签 ---------- */
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
    if (!f.name.includes(tab) && !(tab === "外购件清单" && f.name.includes("外购清单"))) { toast.error("文件名需包含资料类型（" + tab + "）"); return; }
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
    <div className={CARD + " p-6"}>
      <div className="mb-4 text-sm font-semibold text-slate-100">{tab}</div>
      {existingFull ? (
        <div className="space-y-3">
          <div className="rounded bg-[#0d1729] p-3 text-sm text-cyan-200">{item!.existing}</div>
          <div className="flex gap-2">
            {isXlsx ? (
              <button className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`} onClick={() => onOpenEditor(existingFull, tab)}>
                {readOnly ? "只读查看表格" : "打开网页编辑"}
              </button>
            ) : (
              <a className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`} href={api.fileUrl(existingFull, true)} download>
                下载查看
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-400">
          <p>该资料还没有文件。{tab === "排模图" ? "可以上传图纸/图片/PDF：" : "可以上传做好的表格："}</p>
          <button className={`${BTN} border border-dashed border-[#26375a] text-slate-300 hover:border-cyan-500`}
            disabled={uploading || readOnly} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "排模图" ? <FileImage className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
            上传{tab}文件
          </button>
          <p className="text-xs text-slate-500">上传后回到项目页也可以用「从模板新建」生成空白表格在线填写。</p>
        </div>
      )}
      <input ref={fileRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ""; }} />
    </div>
  );
}
