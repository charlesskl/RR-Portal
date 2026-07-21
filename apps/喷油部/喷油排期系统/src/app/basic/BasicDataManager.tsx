"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { lineLabel } from "@/lib/line";

type Line = { id: number; name: string; workshop: string; leaderName: string | null; craftType: string; isActive: boolean; dailyCapacityLimit: number };
type Machine = { id: number; machineNo: string; lineId: number; lineName: string; machineType: string; isUV: boolean; isActive: boolean; equipmentKind: string };
type Holiday = { id: number; date: string; type: string; remark: string | null };
// 工序对照表：alias=工序小类，category=大类（手喷/移印/自动喷/UV）
type CraftAlias = { id: number; alias: string; category: string };

const INPUT = "border border-app-border rounded-btn px-3 py-2 text-sm";
const BTN = "bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold";
const LINK = "text-mint-700 hover:underline";   // 编辑/保存等正向操作
const DANGER = "text-rose hover:underline";      // 停用/删除

// 工艺类型固定 4 项（贴在拉别上，整条拉一种工艺；机台继承拉别工艺）
const CRAFTS = ["手喷", "移印", "自动喷", "UV"];
// 机台种类固定 4 项（普通/炒货机/胭脂机/贴片机）
const EQUIPMENT_KINDS = ["普通", "炒货机", "胭脂机", "贴片机"];
// 每工艺默认产能上限参考值（单位：万件），取业务方真实标准（与 setup-line-capacity.ts 一致）。新建拉选工艺时预填，可当场改。
const CAP_WAN_BY_CRAFT: Record<string, number> = { 手喷: 20, 移印: 30, 自动喷: 30, UV: 40 };
const wanToPieces = (wan: string) => Math.round(Number(wan || "0") * 10000);  // 万 → 件（存库单位）
const piecesToWan = (pieces: number) => (pieces / 10000).toString();           // 件 → 万（显示单位）

export default function BasicDataManager({ lines, machines, holidays, craftAliases }: { lines: Line[]; machines: Machine[]; holidays: Holiday[]; craftAliases: CraftAlias[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"lines" | "machines" | "holidays" | "craftAliases">("lines");
  const [err, setErr] = useState("");

  // —— 拉别：新增 + 行内编辑 ——
  const [newLine, setNewLine] = useState({ name: "", workshop: "兴信A", leaderName: "", craftType: "移印", capWan: "30" });
  const [editLineId, setEditLineId] = useState<number | null>(null);
  const [editLine, setEditLine] = useState({ name: "", workshop: "兴信A", leaderName: "", craftType: "移印", capWan: "" });

  // —— 机台：批量录入 + 行内编辑 ——
  const [batch, setBatch] = useState<{ lineId: number | ""; text: string }>({ lineId: lines[0]?.id ?? "", text: "" });
  const [batchResult, setBatchResult] = useState<{ created: number; skipped: string[] } | null>(null);
  const [editMachineId, setEditMachineId] = useState<number | null>(null);
  const [editMachine, setEditMachine] = useState<{ machineNo: string; lineId: number; equipmentKind: string }>({ machineNo: "", lineId: 0, equipmentKind: "普通" });
  const [machineLineFilter, setMachineLineFilter] = useState<number | "all">("all");   // 机台列表按拉别筛选

  // —— 节假日：新增 + 行内编辑 + 月份筛选 ——
  const [newHoliday, setNewHoliday] = useState<{ date: string; type: string; remark: string }>({ date: "", type: "holiday", remark: "" });
  const [holidayMonth, setHolidayMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [editHolidayId, setEditHolidayId] = useState<number | null>(null);
  const [editHoliday, setEditHoliday] = useState<{ date: string; type: string; remark: string }>({ date: "", type: "holiday", remark: "" });

  // —— 工序对照表：新建 + 行内编辑 ——
  const [newCraftAlias, setNewCraftAlias] = useState<{ alias: string; category: string }>({ alias: "", category: "手喷" });
  const [editCraftAliasId, setEditCraftAliasId] = useState<number | null>(null);
  const [editCraftAlias, setEditCraftAlias] = useState<{ alias: string; category: string }>({ alias: "", category: "手喷" });

  // 通用：发请求，失败把后端 error 文案显示出来，成功刷新数据
  async function send(url: string, method: string, body?: unknown) {
    setErr("");
    const res = await apiFetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || "操作失败"); return null; }
    return res.json().catch(() => ({}));
  }

  // ---- 拉别操作 ----
  async function addLine() {
    // capWan(万) 换算成件 dailyCapacityLimit 再提交，capWan 本身不发后端
    const body = { name: newLine.name, workshop: newLine.workshop, leaderName: newLine.leaderName,
      craftType: newLine.craftType, dailyCapacityLimit: wanToPieces(newLine.capWan) };
    if (await send("/api/lines", "POST", body)) { setNewLine({ name: "", workshop: "兴信A", leaderName: "", craftType: "移印", capWan: "30" }); router.refresh(); }
  }
  function startEditLine(l: Line) {
    setEditLineId(l.id);
    setEditLine({ name: l.name, workshop: l.workshop, leaderName: l.leaderName ?? "", craftType: l.craftType, capWan: piecesToWan(l.dailyCapacityLimit) });
  }
  async function saveLine(id: number) {
    const body = { name: editLine.name, workshop: editLine.workshop, leaderName: editLine.leaderName,
      craftType: editLine.craftType, dailyCapacityLimit: wanToPieces(editLine.capWan) };
    if (await send(`/api/lines/${id}`, "PATCH", body)) { setEditLineId(null); router.refresh(); }
  }
  async function removeLine(id: number) {
    if (!confirm("停用该拉别？（停用后不在排期中可选）")) return;
    if (await send(`/api/lines/${id}`, "DELETE")) router.refresh();
  }

  // ---- 机台操作 ----
  async function batchAddMachines() {
    if (!batch.lineId) { setErr("请先选择所属拉别"); return; }
    if (!batch.text.trim()) { setErr("请输入机台号"); return; }
    const r = await send("/api/machines/batch", "POST", { lineId: batch.lineId, text: batch.text });
    if (r) { setBatchResult({ created: r.created, skipped: r.skippedExisting ?? [] }); setBatch({ ...batch, text: "" }); router.refresh(); }
  }
  function startEditMachine(m: Machine) {
    setEditMachineId(m.id);
    setEditMachine({ machineNo: m.machineNo, lineId: m.lineId, equipmentKind: m.equipmentKind });
  }
  async function saveMachine(id: number) {
    if (await send(`/api/machines/${id}`, "PATCH", editMachine)) { setEditMachineId(null); router.refresh(); }
  }
  async function removeMachine(id: number, no: string) {
    if (!confirm(`删除机台 ${no}？此操作不可撤销。`)) return;
    if (await send(`/api/machines/${id}`, "DELETE")) router.refresh();
  }

  // ---- 节假日操作 ----
  async function addHoliday() {
    if (!newHoliday.date) { setErr("请选择日期"); return; }
    if (await send("/api/holidays", "POST", newHoliday)) { setNewHoliday({ date: "", type: "holiday", remark: "" }); router.refresh(); }
  }
  function startEditHoliday(h: Holiday) {
    setEditHolidayId(h.id);
    setEditHoliday({ date: h.date, type: h.type, remark: h.remark ?? "" });
  }
  async function saveHoliday(id: number) {
    if (await send(`/api/holidays/${id}`, "PATCH", editHoliday)) { setEditHolidayId(null); router.refresh(); }
  }
  async function removeHoliday(id: number) {
    if (!confirm("删除该节假日记录？")) return;
    if (await send(`/api/holidays/${id}`, "DELETE")) router.refresh();
  }

  // ---- 工序对照表操作 ----
  async function addCraftAlias() {
    if (!newCraftAlias.alias.trim()) { setErr("请输入工序小类名称"); return; }
    if (await send("/api/craft-aliases", "POST", newCraftAlias)) {
      setNewCraftAlias({ alias: "", category: "手喷" });
      router.refresh();
    }
  }
  function startEditCraftAlias(c: CraftAlias) {
    setEditCraftAliasId(c.id);
    setEditCraftAlias({ alias: c.alias, category: c.category });
  }
  async function saveCraftAlias(id: number) {
    if (await send(`/api/craft-aliases/${id}`, "PATCH", editCraftAlias)) { setEditCraftAliasId(null); router.refresh(); }
  }
  async function removeCraftAlias(id: number, alias: string) {
    if (!confirm(`删除工序小类「${alias}」？此操作不可撤销。`)) return;
    if (await send(`/api/craft-aliases/${id}`, "DELETE")) router.refresh();
  }

  const TH = "px-3 py-2 text-left";
  const THC = "px-3 py-2 text-center";
  const filteredHolidays = holidays.filter((h) => !holidayMonth || h.date.slice(0, 7) === holidayMonth);
  const filteredMachines = machines.filter((m) => machineLineFilter === "all" || m.lineId === machineLineFilter);

  return (
    <div className="bg-white rounded-card border border-app-border p-6">
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab("lines")} className={`px-4 py-2 rounded-btn text-sm ${tab === "lines" ? "bg-mint-50 text-mint-700 font-semibold" : "text-text-secondary"}`}>拉别（{lines.length}）</button>
        <button onClick={() => setTab("machines")} className={`px-4 py-2 rounded-btn text-sm ${tab === "machines" ? "bg-mint-50 text-mint-700 font-semibold" : "text-text-secondary"}`}>机台（{machines.length}）</button>
        <button onClick={() => setTab("holidays")} className={`px-4 py-2 rounded-btn text-sm ${tab === "holidays" ? "bg-mint-50 text-mint-700 font-semibold" : "text-text-secondary"}`}>节假日（{holidays.length}）</button>
        <button onClick={() => setTab("craftAliases")} className={`px-4 py-2 rounded-btn text-sm ${tab === "craftAliases" ? "bg-mint-50 text-mint-700 font-semibold" : "text-text-secondary"}`}>工序对照表（{craftAliases.length}）</button>
      </div>
      {err && <p className="text-rose text-sm mb-3">{err}</p>}

      {tab === "lines" ? (
        <>
          {/* 新增拉别：含工艺类型下拉 */}
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <input className={INPUT} placeholder="拉别名（如 A拉：自动喷）" value={newLine.name} onChange={(e) => setNewLine({ ...newLine, name: e.target.value })} />
            <select className={INPUT} value={newLine.workshop} onChange={(e) => setNewLine({ ...newLine, workshop: e.target.value })}>
              <option value="兴信A">兴信A</option>
              <option value="华登A">华登A</option>
            </select>
            <input className={INPUT} placeholder="拉长名（选填）" value={newLine.leaderName} onChange={(e) => setNewLine({ ...newLine, leaderName: e.target.value })} />
            <select className={INPUT} value={newLine.craftType} onChange={(e) => {
              const craft = e.target.value;
              // 选工艺时把上限(万)预填成该工艺参考值，可当场改
              setNewLine({ ...newLine, craftType: craft, capWan: String(CAP_WAN_BY_CRAFT[craft] ?? "") });
            }}>
              {CRAFTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className={`${INPUT} w-28`} type="number" min="0" step="0.1" placeholder="上限(万)"
              value={newLine.capWan} onChange={(e) => setNewLine({ ...newLine, capWan: e.target.value })} />
            <button onClick={addLine} className={BTN}>+ 新增拉别</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
              <tr><th className={TH}>拉别</th><th className={TH}>车间</th><th className={TH}>拉长</th><th className={TH}>工艺</th><th className={TH}>日产能上限</th><th className={THC}>状态</th><th className={THC}>操作</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => editLineId === l.id ? (
                // 行内编辑态
                <tr key={l.id} className="bg-mint-50">
                  <td className="px-3 py-2"><input className={`${INPUT} w-40`} value={editLine.name} onChange={(e) => setEditLine({ ...editLine, name: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <select className={INPUT} value={editLine.workshop} onChange={(e) => setEditLine({ ...editLine, workshop: e.target.value })}>
                      <option value="兴信A">兴信A</option><option value="华登A">华登A</option>
                    </select>
                  </td>
                  <td className="px-3 py-2"><input className={`${INPUT} w-24`} value={editLine.leaderName} onChange={(e) => setEditLine({ ...editLine, leaderName: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <select className={INPUT} value={editLine.craftType} onChange={(e) => setEditLine({ ...editLine, craftType: e.target.value })}>
                      {CRAFTS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input className={`${INPUT} w-24`} type="number" min="0" step="0.1" placeholder="上限(万)"
                      value={editLine.capWan} onChange={(e) => setEditLine({ ...editLine, capWan: e.target.value })} />
                  </td>
                  <td className={THC}>{l.isActive ? "启用" : "停用"}</td>
                  <td className={THC}>
                    <button onClick={() => saveLine(l.id)} className={LINK}>保存</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => setEditLineId(null)} className="text-text-secondary hover:underline">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={l.id} className={i % 2 ? "bg-[#fafdfb]" : ""}>
                  <td className="px-3 py-2 font-semibold">{l.name}</td>
                  <td className="px-3 py-2">{l.workshop}</td>
                  <td className="px-3 py-2">{l.leaderName || "—"}</td>
                  <td className="px-3 py-2">{l.craftType}</td>
                  <td className="px-3 py-2">{l.dailyCapacityLimit ? `${piecesToWan(l.dailyCapacityLimit)} 万` : "—"}</td>
                  <td className={THC}>{l.isActive ? "启用" : "停用"}</td>
                  <td className={THC}>
                    <button onClick={() => startEditLine(l)} className={LINK}>编辑</button>
                    {l.isActive && <><span className="text-app-border mx-1">|</span><button onClick={() => removeLine(l.id)} className={DANGER}>停用</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : tab === "machines" ? (
        <>
          {/* 批量录入：选一条拉，一次贴一串机台号 */}
          <div className="border border-app-border rounded-card p-4 mb-4 bg-[#fafdfb]">
            <p className="text-sm font-semibold text-text mb-2">批量录入机台</p>
            <div className="flex gap-2 mb-2 flex-wrap items-start">
              <select className={INPUT} value={batch.lineId} onChange={(e) => { setBatch({ ...batch, lineId: Number(e.target.value) }); setBatchResult(null); }}>
                {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
              </select>
              <textarea className={`${INPUT} flex-1 min-w-[280px] h-20`} placeholder="把机台号一串贴进来，用逗号或换行分隔（机台名可含空格）。如：1 号机（世通），2 号机（世通），3#，4#" value={batch.text} onChange={(e) => setBatch({ ...batch, text: e.target.value })} />
              <button onClick={batchAddMachines} className={BTN}>批量录入</button>
            </div>
            <p className="text-xs text-text-secondary">机台工艺自动取所选拉别的工艺；该拉别下已存在的机台号会自动跳过。</p>
            {batchResult && (
              <p className="text-sm mt-2 text-mint-700">
                ✅ 新建 {batchResult.created} 台
                {batchResult.skipped.length > 0 && <span className="text-text-secondary">；跳过已存在 {batchResult.skipped.length} 个：{batchResult.skipped.join("、")}</span>}
              </p>
            )}
          </div>
          {/* 按拉别筛选机台列表 */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-text-secondary">筛选拉别：</span>
            <select className={INPUT} value={machineLineFilter} onChange={(e) => setMachineLineFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">全部（{machines.length}）</option>
              {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}（{machines.filter((m) => m.lineId === l.id).length}）</option>)}
            </select>
            {machineLineFilter !== "all" && <span className="text-xs text-text-secondary">共 {filteredMachines.length} 台</span>}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
              <tr><th className={TH}>机台号</th><th className={TH}>所属拉别</th><th className={TH}>工艺</th><th className={TH}>种类</th><th className={THC}>状态</th><th className={THC}>操作</th></tr>
            </thead>
            <tbody>
              {filteredMachines.map((m, i) => editMachineId === m.id ? (
                <tr key={m.id} className="bg-mint-50">
                  <td className="px-3 py-2"><input className={`${INPUT} w-24 font-mono`} value={editMachine.machineNo} onChange={(e) => setEditMachine({ ...editMachine, machineNo: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <select className={INPUT} value={editMachine.lineId} onChange={(e) => setEditMachine({ ...editMachine, lineId: Number(e.target.value) })}>
                      {lines.map((l) => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs">（跟随拉别）</td>
                  <td className="px-3 py-2">
                    <select className={`${INPUT} w-24`} value={editMachine.equipmentKind} onChange={(e) => setEditMachine({ ...editMachine, equipmentKind: e.target.value })}>
                      {EQUIPMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td className={THC}>{m.isActive ? "启用" : "停用"}</td>
                  <td className={THC}>
                    <button onClick={() => saveMachine(m.id)} className={LINK}>保存</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => setEditMachineId(null)} className="text-text-secondary hover:underline">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={m.id} className={i % 2 ? "bg-[#fafdfb]" : ""}>
                  <td className="px-3 py-2 font-mono font-semibold">{m.machineNo}</td>
                  <td className="px-3 py-2">{m.lineName}</td>
                  <td className="px-3 py-2">{m.machineType}</td>
                  <td className="px-3 py-2">{m.equipmentKind}</td>
                  <td className={THC}>{m.isActive ? "启用" : "停用"}</td>
                  <td className={THC}>
                    <button onClick={() => startEditMachine(m)} className={LINK}>编辑</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => removeMachine(m.id, m.machineNo)} className={DANGER}>删除</button>
                  </td>
                </tr>
              ))}
              {filteredMachines.length === 0 && <tr><td colSpan={6} className="text-center text-text-secondary py-4">{machines.length === 0 ? "还没有机台，用上方批量录入添加" : "该拉别下暂无机台"}</td></tr>}
            </tbody>
          </table>
        </>
      ) : tab === "holidays" ? (
        <>
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <input className={INPUT} type="date" value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} />
            <select className={INPUT} value={newHoliday.type} onChange={(e) => setNewHoliday({ ...newHoliday, type: e.target.value })}>
              <option value="holiday">休息（不排产）</option>
              <option value="workday">补班（周末上班）</option>
            </select>
            <input className={INPUT} placeholder="备注（如 春节）" value={newHoliday.remark} onChange={(e) => setNewHoliday({ ...newHoliday, remark: e.target.value })} />
            <button onClick={addHoliday} className={BTN}>+ 新增</button>
          </div>
          <p className="text-xs text-text-secondary mb-3">月排会跳过「休息」日；「补班」表示该周末要上班、可排产。⚠️ 法定节假日以国务院公布为准，每年初核对一次。</p>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-text-secondary">查看月份：</span>
            <input className={INPUT} type="month" value={holidayMonth} onChange={(e) => setHolidayMonth(e.target.value)} />
            <span className="text-xs text-text-secondary">（默认当月；清空可看全部）</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
              <tr><th className={TH}>日期</th><th className={TH}>类型</th><th className={TH}>备注</th><th className={THC}>操作</th></tr>
            </thead>
            <tbody>
              {filteredHolidays.map((h, i) => editHolidayId === h.id ? (
                <tr key={h.id} className="bg-mint-50">
                  <td className="px-3 py-2"><input className={INPUT} type="date" value={editHoliday.date} onChange={(e) => setEditHoliday({ ...editHoliday, date: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <select className={INPUT} value={editHoliday.type} onChange={(e) => setEditHoliday({ ...editHoliday, type: e.target.value })}>
                      <option value="holiday">休息</option><option value="workday">补班</option>
                    </select>
                  </td>
                  <td className="px-3 py-2"><input className={INPUT} value={editHoliday.remark} onChange={(e) => setEditHoliday({ ...editHoliday, remark: e.target.value })} /></td>
                  <td className={THC}>
                    <button onClick={() => saveHoliday(h.id)} className={LINK}>保存</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => setEditHolidayId(null)} className="text-text-secondary hover:underline">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={h.id} className={i % 2 ? "bg-[#fafdfb]" : ""}>
                  <td className="px-3 py-2 font-mono">{h.date}</td>
                  <td className="px-3 py-2">{h.type === "workday" ? "补班" : "休息"}</td>
                  <td className="px-3 py-2">{h.remark || "—"}</td>
                  <td className={THC}>
                    <button onClick={() => startEditHoliday(h)} className={LINK}>编辑</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => removeHoliday(h.id)} className={DANGER}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredHolidays.length === 0 && <p className="text-sm text-text-secondary text-center py-4">该月份没有节假日记录</p>}
        </>
      ) : (
        /* ---- 工序对照表 tab：工序小类 ↔ 大类映射维护 ---- */
        <>
          {/* 新建行：输入小类名 + 选大类 + 按钮 */}
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <input
              className={INPUT}
              placeholder="工序小类名（如 喷油、移印）"
              value={newCraftAlias.alias}
              onChange={(e) => setNewCraftAlias({ ...newCraftAlias, alias: e.target.value })}
            />
            <select
              className={INPUT}
              value={newCraftAlias.category}
              onChange={(e) => setNewCraftAlias({ ...newCraftAlias, category: e.target.value })}
            >
              {CRAFTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={addCraftAlias} className={BTN}>+ 新建</button>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            此表用于 Excel 核价表导入时，自动将工序小类（如「喷油」「PP水」）归并到系统四大类（手喷/移印/自动喷/UV）。小类名须与核价表中完全一致。
          </p>
          <table className="w-full text-sm">
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
              <tr>
                <th className={TH}>小类（核价表原文）</th>
                <th className={TH}>大类</th>
                <th className={THC}>操作</th>
              </tr>
            </thead>
            <tbody>
              {craftAliases.map((c, i) => editCraftAliasId === c.id ? (
                /* 行内编辑态 */
                <tr key={c.id} className="bg-mint-50">
                  <td className="px-3 py-2">
                    <input
                      className={`${INPUT} w-40`}
                      value={editCraftAlias.alias}
                      onChange={(e) => setEditCraftAlias({ ...editCraftAlias, alias: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className={INPUT}
                      value={editCraftAlias.category}
                      onChange={(e) => setEditCraftAlias({ ...editCraftAlias, category: e.target.value })}
                    >
                      {CRAFTS.map((cr) => <option key={cr} value={cr}>{cr}</option>)}
                    </select>
                  </td>
                  <td className={THC}>
                    <button onClick={() => saveCraftAlias(c.id)} className={LINK}>保存</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => setEditCraftAliasId(null)} className="text-text-secondary hover:underline">取消</button>
                  </td>
                </tr>
              ) : (
                /* 只读行 */
                <tr key={c.id} className={i % 2 ? "bg-[#fafdfb]" : ""}>
                  <td className="px-3 py-2 font-semibold">{c.alias}</td>
                  <td className="px-3 py-2">{c.category}</td>
                  <td className={THC}>
                    <button onClick={() => startEditCraftAlias(c)} className={LINK}>编辑</button>
                    <span className="text-app-border mx-1">|</span>
                    <button onClick={() => removeCraftAlias(c.id, c.alias)} className={DANGER}>删除</button>
                  </td>
                </tr>
              ))}
              {craftAliases.length === 0 && (
                <tr><td colSpan={3} className="text-center text-text-secondary py-4">暂无工序对照记录，用上方「新建」添加</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
