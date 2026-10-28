/**
 * EPMS 制单台（工程部放产资料管理工作台）
 * 按 Stitch 设计稿实现：客户/项目上下文、防串单编辑锁、保存草稿、提交审核、审核归档。
 * 数据存在项目目录 .epms/<单据>.json，与 xlsx 资料互不干扰。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Lock, LockOpen, Save, Send, BadgeCheck, Undo2, Plus, Trash2,
  UploadCloud, FileImage, Loader2, Users, FolderArchive, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { EpmsRecordPublic } from "@/types";
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
  onOpenEditor: (path: string, name: string) => void;
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

type DocTab = "排模表" | "排模图" | "外购清单" | "作业指导书";
const TABS: { key: DocTab; label: string }[] = [
  { key: "排模表", label: "【1. 排模表】" },
  { key: "排模图", label: "【2. 排模图(图纸)】" },
  { key: "外购清单", label: "【3. 外购清单】" },
  { key: "作业指导书", label: "【4. 作业指导书(SOP)】" },
];

const STATUS_TEXT: Record<string, { text: string; cls: string }> = {
  none: { text: "未开始", cls: "text-slate-400" },
  draft: { text: "制单中（待提交审核）", cls: "text-amber-400" },
  pending: { text: "审核中", cls: "text-cyan-400" },
  approved: { text: "已归档", cls: "text-emerald-400" },
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

  /* 每 10 秒刷新锁倒计时 */
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
    } catch {
      setRec(null);
    }
  }, [projPath, tab, by]);

  /* 进入单据：加载 + 抢锁 + 每 60s 续锁；离开释放 */
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
        // 409：被他人锁定 → 只读
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

  /* 加载项目资料清单（供其它三个页签用） */
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

  const mm = String(Math.floor(lockRemain / 60000)).padStart(2, "0");
  const ss = String(Math.floor((lockRemain % 60000) / 1000)).padStart(2, "0");
  const st = STATUS_TEXT[rec?.status || "none"];
  const docItemsByName = useMemo(() => Object.fromEntries(docItems.map((d) => [d.name, d])), [docItems]);

  return (
    <div className={BG}>
      {/* 顶栏 */}
      <div className="border-b border-[#1e2d4a] bg-[#0d1628] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => onNavigate({ type: "project", client, year, project })}
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
              <Lock className="h-3 w-3" /> 独占编辑锁已持有（倒计时 {mm}:{ss}）
            </span>
          )}
          {lockedByOther && (
            <span className="flex items-center gap-1 rounded border border-amber-700 bg-amber-900/30 px-2 py-0.5 text-xs text-amber-400">
              <LockOpen className="h-3 w-3" /> {lockedByOther.by} 正在编辑，你为只读
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400">操作人:</span>
            <input
              className="w-24 rounded border border-[#26375a] bg-[#0d1729] px-2 py-1 text-xs text-cyan-100 outline-none focus:border-cyan-500"
              placeholder="如 PE-张三"
              value={by}
              onChange={(e) => { setBy(e.target.value); localStorage.setItem("epms-user", e.target.value); }}
            />
          </div>
        </div>
        {/* 操作按钮 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button className={`${BTN} border border-[#26375a] text-slate-300 hover:border-cyan-500`}
            disabled={busy || readOnly || tab !== "排模表"}
            onClick={() => act(() => api.epmsSave(projPath, tab, form, by), "草稿已保存")}>
            <Save className="h-4 w-4" /> 保存草稿
          </button>
          <button className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`}
            disabled={busy || readOnly || (rec?.status !== "draft" && rec?.status !== "none")}
            onClick={() => act(async () => { await api.epmsSave(projPath, tab, tab === "排模表" ? form : rec?.data, by); return api.epmsStatus(projPath, tab, "submit", by); }, "已提交工程师审核")}>
            <Send className="h-4 w-4" /> 提交工程师审核
          </button>
          <button className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-500`}
            disabled={busy || readOnly || rec?.status !== "pending"}
            onClick={() => act(() => api.epmsStatus(projPath, tab, "approve", by), "审核通过，已归档")}>
            <BadgeCheck className="h-4 w-4" /> 审核通过并归档
          </button>
          <button className={`${BTN} border border-red-800 text-red-400 hover:bg-red-900/30`}
            disabled={busy || readOnly || rec?.status !== "pending"}
            onClick={() => act(() => api.epmsStatus(projPath, tab, "return", by), "已驳回，退回制单")}>
            <Undo2 className="h-4 w-4" /> 驳回
          </button>
          <span className={`text-sm ${st.cls}`}>资料编制状态：{st.text}</span>
        </div>
      </div>

      {/* 页签 */}
      <div className="flex gap-1 border-b border-[#1e2d4a] bg-[#0d1628] px-4 pt-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-t px-3 py-1.5 text-sm ${tab === t.key ? "bg-[#16233d] text-cyan-300 border border-b-0 border-[#26375a]" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {lockedByOther && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded border border-amber-700/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
          <Users className="h-4 w-4" />
          服务器并发防串单机制生效中：当前由 [{lockedByOther.by}] 锁定编辑，你已自动切换为只读模式；对方释放或 15 分钟无操作后你可以接管。
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
                <div className="text-xs text-slate-400">填报人：{rec?.by || by || "-"}</div>
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
                      value={form[k] as string} onChange={(e) => setField(k, e.target.value)} />
                  </div>
                ))}
              </div>

              <div className="mb-1 mt-5 flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-400">二、穴位与模仁排位细表</span>
                <button className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                  disabled={readOnly}
                  onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { cavity: "", partName: "", partNo: "", gate: "", eject: "", note: "" }] }))}>
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
                            <input className={INPUT} disabled={readOnly} value={r[k]}
                              onChange={(e) => setRow(i, k, e.target.value)} />
                          </td>
                        ))}
                        <td>
                          <button className="text-red-400 hover:text-red-300 disabled:opacity-30" disabled={readOnly || form.rows.length <= 1}
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
          )}

          {tab !== "排模表" && <DocTabPanel tab={tab} projPath={projPath} item={docItemsByName[tab]} onOpenEditor={onOpenEditor} onChanged={() => api.doctypes(projPath).then((d) => setDocItems(d.items))} />}
        </div>

        {/* 右栏 */}
        <div className="space-y-4">
          <div className={CARD + " p-3"}>
            <div className="mb-2 text-xs font-semibold text-cyan-400">协同防串与编辑锁状态</div>
            <div className="space-y-1 text-xs text-slate-300">
              <div>当前锁持有者：<span className="text-cyan-300">{rec?.lock ? rec.lock.by : "空闲"}</span></div>
              <div>最近操作：<span className="text-cyan-300">{rec?.by || "-"}</span> {rec?.updatedAt ? new Date(rec.updatedAt).toLocaleString("zh-CN") : ""}</div>
              <div>锁规则：独占 15 分钟，无操作自动释放</div>
            </div>
          </div>
          <div className={CARD + " p-3"}>
            <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-cyan-400"><FolderArchive className="h-3.5 w-3.5" /> 归档客户库信息</div>
            <div className="rounded bg-[#0d1729] p-2 font-mono text-xs text-slate-300">
              📁 {client}<br />└ 📁 {year}<br />　└ 📁 {project}
            </div>
          </div>
          <div className={CARD + " p-3"}>
            <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-cyan-400"><ClipboardList className="h-3.5 w-3.5" /> 工程师审核链（3 步极简流程）</div>
            {[
              { n: 1, t: "制单人填报", on: true },
              { n: 2, t: "工程师审核", on: rec?.status === "pending" || rec?.status === "approved" },
              { n: 3, t: "审核通过并受控归档", on: rec?.status === "approved" },
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
    <div className={CARD + " p-6"}>
      <div className="mb-4 text-sm font-semibold text-slate-100">{tab}</div>
      {existingFull ? (
        <div className="space-y-3">
          <div className="rounded bg-[#0d1729] p-3 text-sm text-cyan-200">{item!.existing}</div>
          <div className="flex gap-2">
            {isXlsx ? (
              <button className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`} onClick={() => onOpenEditor(existingFull, tab)}>
                打开网页编辑
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
            disabled={uploading} onClick={() => fileRef.current?.click()}>
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
