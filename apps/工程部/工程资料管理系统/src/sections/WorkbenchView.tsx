/**
 * EPMS 制单台 — 按 Stitch 设计稿(_7)逐块移植，数据与逻辑全部真实。
 * 草稿/锁/审核流存于项目目录 .epms/<单据>.json。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Loader2, UploadCloud, FileImage } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DocTypeItem, EpmsRecordPublic, View } from "@/types";

const FIELD_INPUT =
  "w-full bg-surface-container-highest border border-outline-variant/60 rounded px-2 py-1 text-xs font-mono font-bold text-secondary focus:border-secondary focus:ring-0 focus:outline-none disabled:opacity-50";
const CELL_INPUT =
  "w-full bg-surface-container-highest border border-outline-variant/50 rounded px-2 py-1 text-xs text-on-surface focus:border-secondary focus:ring-0 focus:outline-none disabled:opacity-50";

interface Props {
  client: string;
  year: string;
  project: string;
  onNavigate: (v: View) => void;
  onOpenEditor: (path: string, name: string) => void;
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

type DocTab = "排模表" | "排模图" | "外购清单" | "作业指导书";
const TABS: { key: DocTab; label: string; icon: string }[] = [
  { key: "排模表", label: "【1. 排模表】", icon: "grid_on" },
  { key: "排模图", label: "【2. 排模图 (图纸上传与受控图)】", icon: "image" },
  { key: "外购清单", label: "【3. 外购清单】", icon: "list_alt" },
  { key: "作业指导书", label: "【4. 作业指导书 (SOP)】", icon: "menu_book" },
];

const STATUS_TEXT: Record<string, string> = {
  none: "未开始", draft: "制单中(待提交审核)", pending: "审核中", approved: "已归档",
};

export default function WorkbenchView({ client, year, project, onNavigate, onOpenEditor }: Props) {
  const projPath = `${client}/${year}/${project}`;
  const [tab, setTab] = useState<DocTab>("排模表");
  const [by, setBy] = useState(() => localStorage.getItem("epms-user") || "");
  const [rec, setRec] = useState<EpmsRecordPublic | null>(null);
  const [form, setForm] = useState<PaiMoForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [docItems, setDocItems] = useState<DocTypeItem[]>([]);
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const lockedByOther = rec?.lock && rec.lock.by !== by ? rec.lock : null;
  const readOnly = !!lockedByOther || rec?.status === "approved";
  const lockRemain = rec?.lock ? Math.max(0, (rec.lockTtl || 900000) - (now - rec.lock.at)) : 0;
  const mm = String(Math.floor(lockRemain / 60000)).padStart(2, "0");
  const ss = String(Math.floor((lockRemain % 60000) / 1000)).padStart(2, "0");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!by) return;
    try {
      const r = await api.epmsGet(projPath, tab);
      setRec(r);
      if (tab === "排模表" && r.data) setForm({ ...emptyForm, ...(r.data as PaiMoForm) });
      if (tab === "排模表" && !r.data) setForm(emptyForm);
    } catch { setRec(null); }
  }, [projPath, tab, by]);

  useEffect(() => {
    if (!by) return;
    let alive = true;
    (async () => {
      try {
        const r = await api.epmsLock(projPath, tab, by);
        if (!alive) return;
        setRec(r);
        if (tab === "排模表" && r.data) setForm({ ...emptyForm, ...(r.data as PaiMoForm) });
      } catch (e) {
        await load();
        if (alive) toast.warning((e as Error).message);
      }
    })();
    lockTimer.current = setInterval(() => {
      api.epmsLock(projPath, tab, by).then(setRec).catch(() => {});
    }, 60000);
    return () => {
      alive = false;
      if (lockTimer.current) clearInterval(lockTimer.current);
      api.epmsUnlock(projPath, tab, by).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projPath, tab, by]);

  useEffect(() => {
    api.doctypes(projPath).then((d) => setDocItems(d.items)).catch(() => {});
  }, [projPath]);

  const setField = (k: keyof PaiMoForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (i: number, k: keyof CavityRow, v: string) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

  const act = async (fn: () => Promise<EpmsRecordPublic>, okMsg: string) => {
    if (!by) { toast.error("请先填写右上角的操作人姓名"); return; }
    setBusy(true);
    try {
      const r = await fn();
      setRec(r);
      toast.success(okMsg);
    } catch (e) {
      toast.error((e as Error).message);
      load();
    }
    setBusy(false);
  };

  const docItemsByName = Object.fromEntries(docItems.map((d) => [d.name, d]));

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col">
      {/* ── 顶部紧凑导航栏 ── */}
      <header className="sticky top-0 z-50 bg-surface-container-low border-b border-surface-container-highest px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate({ type: "project", client, year, project })}
            className="w-8 h-8 rounded bg-secondary/15 flex items-center justify-center text-secondary border border-secondary/30 hover:bg-secondary/25 transition"
            title="返回项目">
            <span className="material-symbols-outlined text-[20px]">table_chart</span>
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
              <span className="material-symbols-outlined text-[14px] text-emerald-400">lock</span>
              <span>独占编辑锁已持有</span>
              <span className="font-mono text-[10px] text-emerald-400/80 ml-0.5">(倒计时 {mm}:{ss})</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-surface-container border border-surface-container-highest rounded px-2 py-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-on-surface-variant text-[11px]">操作人:</span>
            <input
              className="w-24 bg-transparent text-emerald-400 font-medium text-[11px] focus:outline-none border-0 p-0"
              placeholder="如 PE-张三"
              value={by}
              onChange={(e) => { setBy(e.target.value); localStorage.setItem("epms-user", e.target.value); }}
            />
          </div>
        </div>

        {/* 动作按钮区 */}
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-surface-container-highest hover:bg-surface-bright text-xs text-on-surface border border-surface-container-highest transition disabled:opacity-40"
            disabled={busy || readOnly || tab !== "排模表"}
            onClick={() => act(() => api.epmsSave(projPath, tab, form, by), "草稿已保存")}>
            <span className="material-symbols-outlined text-[16px]">save</span>
            <span>保存草稿</span>
          </button>
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-secondary-container hover:bg-secondary text-xs text-on-secondary-container font-semibold transition shadow-sm disabled:opacity-40"
            disabled={busy || readOnly || (rec?.status !== "draft" && rec?.status !== "none")}
            onClick={() => act(async () => {
              await api.epmsSave(projPath, tab, tab === "排模表" ? form : rec?.data, by);
              return api.epmsStatus(projPath, tab, "submit", by);
            }, "已提交工程师审核")}>
            <span className="material-symbols-outlined text-[16px]">send</span>
            <span>提交工程师审核</span>
          </button>
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-semibold transition shadow-sm disabled:opacity-40"
            disabled={busy || readOnly || rec?.status !== "pending"}
            onClick={() => act(() => api.epmsStatus(projPath, tab, "approve", by), "审核通过，已归档")}>
            <span className="material-symbols-outlined text-[16px]">verified</span>
            <span>审核通过并归档</span>
          </button>
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-surface-container-highest hover:bg-error-container/40 text-xs text-error border border-surface-container-highest transition disabled:opacity-40"
            disabled={busy || readOnly || rec?.status !== "pending"}
            onClick={() => act(() => api.epmsStatus(projPath, tab, "return", by), "已驳回，退回制单")}>
            <span className="material-symbols-outlined text-[16px]">undo</span>
            <span>驳回</span>
          </button>
        </div>
      </header>

      {/* ── 主工作区 ── */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 flex flex-col gap-4">
        {/* Tab 切换栏 + 锁定提示徽章 */}
        <div className="bg-surface-container-low border border-surface-container-highest rounded px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={tab === t.key
                  ? "flex items-center gap-1.5 px-4 py-1.5 rounded bg-secondary text-on-secondary font-bold text-xs shadow-sm"
                  : "flex items-center gap-1.5 px-3 py-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container text-xs transition"}>
                <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                <span>{t.label}</span>
                {tab === t.key && <span className="text-[10px] bg-on-secondary/20 px-1 rounded ml-1">当前</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-surface-container-lowest border border-tertiary/40 text-xs">
            <span className="material-symbols-outlined text-[15px] text-tertiary">shield_lock</span>
            <span className="text-tertiary font-medium">服务器并发防串机制生效中</span>
            <span className="text-outline-variant">·</span>
            <span className="text-on-surface-variant text-[11px]">
              {lockedByOther
                ? `当前由[${lockedByOther.by}]锁定编辑，你已自动切换为只读隔离模式`
                : rec?.lock
                  ? `当前由[${rec.lock.by}]锁定编辑，其他工程师自动切换为只读隔离模式；修改即时同步服务端草稿`
                  : "单据空闲，进入即自动加锁；修改即时同步服务端草稿"}
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
                    状态: <span className="text-secondary font-semibold">{STATUS_TEXT[rec?.status || "none"]}</span> | 填报人: {rec?.by || by || "-"}
                  </div>
                </div>

                {/* 基础信息 */}
                <div className="p-3 bg-surface-container-lowest border-b border-surface-container-highest">
                  <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px]">tune</span>
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
                      <span className="material-symbols-outlined text-[15px]">apps</span>
                      <span>二、穴位与模仁排位细表 (表头格式严格锁定)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-surface-container-highest">共 {form.rows.length} 个受控排穴位</span>
                      <button className="flex items-center gap-1 text-[11px] text-secondary hover:text-secondary-fixed disabled:opacity-40"
                        disabled={readOnly}
                        onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { cavity: "", partName: "", partNo: "", gate: "", eject: "", note: "" }] }))}>
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
                            <td className="py-2 px-3"><input className={CELL_INPUT + " font-bold text-secondary"} placeholder="A1" disabled={readOnly} value={r.cavity} onChange={(e) => setRow(i, "cavity", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT} placeholder="零件名称" disabled={readOnly} value={r.partName} onChange={(e) => setRow(i, "partName", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT + " font-mono"} placeholder="P/N" disabled={readOnly} value={r.partNo} onChange={(e) => setRow(i, "partNo", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT} placeholder="热咀直浇口" disabled={readOnly} value={r.gate} onChange={(e) => setRow(i, "gate", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT} placeholder="圆顶针+扁顶针" disabled={readOnly} value={r.eject} onChange={(e) => setRow(i, "eject", e.target.value)} /></td>
                            <td className="py-2 px-3"><input className={CELL_INPUT + " text-on-surface-variant"} placeholder="718H钢材淬火 / 咬花等级" disabled={readOnly} value={r.note} onChange={(e) => setRow(i, "note", e.target.value)} /></td>
                            <td className="py-2 px-1 text-center">
                              <button className="text-error hover:text-error/80 disabled:opacity-30" disabled={readOnly || form.rows.length <= 1}
                                onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, j) => j !== i) }))}>
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
              <DocTabPanel tab={tab} projPath={projPath} item={docItemsByName[tab]} onOpenEditor={onOpenEditor}
                onChanged={() => api.doctypes(projPath).then((d) => setDocItems(d.items))} />
            )}
          </div>

          {/* ── 右侧信息栏 ── */}
          <div className="col-span-12 xl:col-span-3 flex flex-col gap-4">
            <div className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">group</span>
                <span>协同防串与编辑锁状态</span>
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
                <span className="material-symbols-outlined text-[15px]">folder_open</span>
                <span>归档客户库信息</span>
              </div>
              <div className="rounded bg-surface-container-lowest border border-surface-container-highest p-2 font-mono text-[11px] text-on-surface-variant leading-relaxed">
                📁 {client}<br />└ 📁 {year}<br />　└ 📁 {project}<br />　　└ 📁 工程放产资料
              </div>
            </div>

            <div className="bg-surface-container-low border border-surface-container-highest rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">fact_check</span>
                <span>工程师审核链 (3步极简流程)</span>
              </div>
              {[
                { n: 1, t: "制单人填报", on: true, cur: rec?.status === "draft" || !rec || rec.status === "none" },
                { n: 2, t: "工程师审核", on: rec?.status === "pending" || rec?.status === "approved", cur: rec?.status === "pending" },
                { n: 3, t: "审核通过并受控归档", on: rec?.status === "approved", cur: rec?.status === "approved" },
              ].map((s) => (
                <div key={s.n} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${s.on ? "border-secondary text-secondary" : "border-surface-container-highest text-on-surface-variant"}`}>{s.n}</span>
                  <span className={s.on ? "text-on-surface" : "text-on-surface-variant"}>{s.t}</span>
                  {s.cur && <span className="text-[10px] text-tertiary bg-tertiary-container px-1 rounded">当前</span>}
                </div>
              ))}
              {rec?.history?.length ? (
                <div className="mt-2 border-t border-surface-container-highest pt-2 space-y-1 text-[10px] text-on-surface-variant">
                  {rec.history.slice(-4).reverse().map((h, i) => (
                    <div key={i}>{h.action} · {h.by} · {new Date(h.at).toLocaleString("zh-CN")}</div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="bg-surface-container-low border border-tertiary/30 rounded shadow-sm p-3">
              <div className="text-xs font-semibold text-tertiary mb-1.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">tips_and_updates</span>
                <span>制单与防呆提醒</span>
              </div>
              <ul className="text-[10px] text-on-surface-variant space-y-1 list-disc pl-4">
                <li>单据按「项目+资料类型」锁定，他人打开自动只读</li>
                <li>草稿即时保存服务端，断电/关页不丢</li>
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
  return (
    <div className="bg-surface-container p-2 rounded border border-surface-container-highest">
      <span className="text-[11px] text-on-surface-variant block mb-1">{label}</span>
      {suffix ? (
        <div className="flex items-center">
          {children}
          <span className="bg-surface-container-highest border-y border-r border-outline-variant/60 text-xs px-1.5 py-1 text-on-surface-variant rounded-r">{suffix}</span>
        </div>
      ) : children}
    </div>
  );
}

/* ── 排模图 / 外购清单 / 作业指导书 页签 ── */
function DocTabPanel({ tab, projPath, item, onOpenEditor, onChanged }: {
  tab: DocTab; projPath: string; item?: DocTypeItem;
  onOpenEditor: (path: string, name: string) => void; onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const existingFull = item?.existing ? `${projPath}/${item.existing}` : null;
  const isXlsx = existingFull?.endsWith(".xlsx");

  const doUpload = async (f: File) => {
    setUploading(true);
    try {
      await api.upload(`${projPath}/工程放产资料`, f);
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
              <button className="flex items-center gap-1 px-3 py-1.5 rounded bg-secondary-container hover:bg-secondary text-xs text-on-secondary-container font-semibold transition"
                onClick={() => onOpenEditor(existingFull, tab)}>
                <span className="material-symbols-outlined text-[16px]">edit_document</span> 打开网页编辑
              </button>
            ) : (
              <a className="flex items-center gap-1 px-3 py-1.5 rounded bg-secondary-container hover:bg-secondary text-xs text-on-secondary-container font-semibold transition"
                href={api.fileUrl(existingFull, true)} download>
                <span className="material-symbols-outlined text-[16px]">download</span> 下载查看
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-xs text-on-surface-variant">
          <p>该资料还没有文件。{tab === "排模图" ? "可以上传图纸/图片/PDF：" : "可以上传做好的表格："}</p>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded border border-dashed border-surface-container-highest text-on-surface hover:border-secondary transition disabled:opacity-40"
            disabled={uploading} onClick={() => fileRef.current?.click()}>
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
