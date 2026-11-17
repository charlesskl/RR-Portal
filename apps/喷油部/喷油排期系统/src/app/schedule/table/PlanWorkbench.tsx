"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { invalidateClientCache } from "@/lib/clientCache";
import { changed, draftOf, fields, pasteDrafts, shiftDraft, valuesOf, type Draft, type Field, type PlanValues, type WorkbenchBalance, type WorkbenchLine, type WorkbenchRow } from "@/lib/planWorkbench";

import AddPlanDialog, { type PlanOption } from "./AddPlanDialog";
import ExcessScheduleDetails, { type ExcessDetail } from "./ExcessScheduleDetails";

type Data = { rows: WorkbenchRow[]; lines: WorkbenchLine[] };
type Transfer = { sourcePlanId: number; sourceDate: string; targetPlanId: number; targetDate: string; quantity: number; orderNo: string; partName: string; stepNo: number };
type Preview = { adjustedPlans: number; allocationToken?: string; transfers?: Transfer[]; balances?: WorkbenchBalance[]; warnings: string[]; changes: { id: number; created?: boolean; orderNo?: string; partName?: string; automatic?: boolean; removed?: boolean; before: PlanValues; after: PlanValues }[] };
const labels: Record<Field, string> = { planDate: "日期", lineId: "拉别", machineNos: "机台", plannedQty: "计划数", workerCount: "人数", workHours: "工时", remark: "备注" };
const control = "rounded-md border border-app-border px-2 py-1.5 text-sm bg-white disabled:opacity-50";
const button = "rounded-btn border border-mint-400 bg-mint-50 text-mint-700 px-3 py-2 text-sm disabled:opacity-40";
function today() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date()); }
function weekEnd() { const date = new Date(`${today()}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 6); return date.toISOString().slice(0, 10); }

export default function PlanWorkbench({ orderId }: { orderId?: number }) {
  const [from, setFrom] = useState(today), [to, setTo] = useState(weekEnd);
  const [data, setData] = useState<Data>({ rows: [], lines: [] });
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [additions, setAdditions] = useState<Record<number, PlanOption>>({});
  const nextId = useRef(-1);
  const footer = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(150);
  const [selected, setSelected] = useState<number[]>([]);
  const [lineFilter, setLineFilter] = useState("");
  const [operation, setOperation] = useState("shift"), [bulk, setBulk] = useState("1");
  const [reason, setReason] = useState("");
  const [autoDeduct, setAutoDeduct] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [excessDetails, setExcessDetails] = useState<ExcessDetail[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const table = useRef<HTMLTableElement>(null);
  const dirty = data.rows.filter(row => row.id < 0 || changed(row, drafts[row.id]));
  const visible = data.rows.filter(row => !lineFilter || String(row.values.lineId) === lineFilter);
  const dirtyRef = useRef(false); dirtyRef.current = dirty.length > 0;
  const busyRef = useRef(false); busyRef.current = busy;

  const load = useCallback(async (start: string, end: string) => {
    const response = await apiFetch(`/api/plans/workbench?from=${start}&to=${end}${orderId ? `&orderId=${orderId}` : ""}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "排期读取失败");
    setData(body); setDrafts({}); setAdditions({}); setSelected([]); setPreview(null); setExcessDetails([]);
  }, [orderId]);
  useEffect(() => {
    let active = true; setBusy(true);
    // 页面首次加载，不因编辑日期筛选框而自动丢弃草稿。
    load(today(), weekEnd()).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || busyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      if (busyRef.current || (dirtyRef.current && !window.confirm("有未保存的排期草稿，确定离开并放弃修改吗？"))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, []);
  useEffect(() => {
    if (!footer.current) return;
    const observer = new ResizeObserver(entries => setFooterHeight(entries[0].contentRect.height));
    observer.observe(footer.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const last = Object.keys(additions).map(Number).sort((a, b) => a - b)[0];
    if (last != null) table.current?.querySelector<HTMLElement>(`[data-row="${last}"][data-field="plannedQty"]`)?.focus();
  }, [additions]);
  function add(option: PlanOption, values: PlanValues) {
    const id = nextId.current--;
    setData(current => ({ ...current, rows: [...current.rows, { id, token: "", orderId: option.orderId, orderNo: option.orderNo, productNo: option.productNo,
      partName: option.partName, stepNo: option.stepNo, craft: option.craft, demand: option.demand, goodQty: null, inboundQty: null, lockedReason: null,
      values: { ...values, plannedQty: 0 } }] }));
    setDrafts(current => ({ ...current, [id]: draftOf(values) })); setAdditions(current => ({ ...current, [id]: option }));
    setAddOpen(false); setLineFilter(""); edited();
  }
  function removeNew(id: number) {
    setData(current => ({ ...current, rows: current.rows.filter(r => r.id !== id) }));
    setAdditions(current => { const next = { ...current }; delete next[id]; return next; });
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setSelected(current => current.filter(selectedId => selectedId !== id)); edited();
  }
  function edited() { setPreview(null); setError(""); setNotice(""); setExcessDetails([]); }
  function edit(row: WorkbenchRow, field: Field, value: string) {
    edited(); setDrafts(previous => ({ ...previous, [row.id]: { ...(previous[row.id] ?? draftOf(row.values)), [field]: value,
      ...(field === "lineId" ? { machineNos: "" } : {}) } }));
  }
  function paste(event: ClipboardEvent<HTMLElement>, index: number, field: Field) {
    const text = event.clipboardData.getData("text/plain");
    if (!text || (field === "remark" && !text.includes("\t"))) return;
    event.preventDefault();
    try { const next = pasteDrafts(visible, drafts, index, field, text, data.lines); edited(); setDrafts(next); }
    catch (e) { setError(e instanceof Error ? e.message : "粘贴失败，草稿未变更"); }
  }
  function move(event: KeyboardEvent<HTMLElement>, index: number, field: Field) {
    if (event.key !== "Enter" || field === "remark") return;
    event.preventDefault(); const step = event.shiftKey ? -1 : 1;
    for (let i = index + step; i >= 0 && i < visible.length; i += step) {
      if (visible[i].lockedReason) continue;
      table.current?.querySelector<HTMLElement>(`[data-row="${visible[i].id}"][data-field="${field}"]`)?.focus(); break;
    }
  }
  function applyBulk() {
    try {
      const rows = visible.filter(row => selected.includes(row.id) && !row.lockedReason);
      if (!rows.length) throw new Error("请勾选要批量调整的未报工计划");
      const next = { ...drafts };
      rows.forEach(row => {
        let value = { ...(next[row.id] ?? draftOf(row.values)) };
        if (operation === "shift") value = shiftDraft(value, Number(bulk));
        else { value[operation as Field] = bulk; if (operation === "lineId") value.machineNos = ""; }
        valuesOf(value); next[row.id] = value;
      });
      edited(); setDrafts(next);
    } catch (e) { setError(e instanceof Error ? e.message : "批量调整失败"); }
  }
  async function reload() {
    if (dirty.length && !window.confirm("重新加载会放弃当前全部草稿，是否继续？")) return;
    setBusy(true); setError("");
    try { await load(from, to); setNotice(""); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败，草稿已保留"); }
    finally { setBusy(false); }
  }
  async function submit(checkOnly: boolean) {
    setBusy(true); setError(""); setNotice(""); setExcessDetails([]); setPreview(null);
    let committed = false;
    try {
      const changes = dirty.filter(row => row.id > 0).map(row => {
        try { return { id: row.id, token: row.token, values: valuesOf(drafts[row.id]) }; }
        catch (e) { throw new Error(`计划 #${row.id}：${e instanceof Error ? e.message : "输入无效"}`); }
      });
      const newPlans = dirty.filter(row => row.id < 0).map(row => ({ clientId: row.id, orderPartQtyId: additions[row.id].orderPartQtyId,
        stepNo: additions[row.id].stepNo, optionToken: additions[row.id].token, values: valuesOf(drafts[row.id]) }));
      const response = await apiFetch(newPlans.length ? "/api/plans/workbench/batch" : "/api/plans/workbench", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes, additions: newPlans, preview: checkOnly, reason, autoDeduct, allocationToken: checkOnly ? undefined : preview?.allocationToken }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && Array.isArray(body.excessDetails)) setExcessDetails(body.excessDetails);
      if (!response.ok) throw new Error(newPlans.length && response.status === 404 ? "新增排期接口尚未就绪，请更新后端后重试；草稿已保留" : body.error || "本批未保存，请稍后重试");
      if (checkOnly && newPlans.length && body.createdPlans !== newPlans.length) throw new Error("新增排期预览不完整，草稿已保留，请重新加载核对");
      if (checkOnly) { setPreview(body); return; }
      committed = true; setDrafts({}); setAdditions({}); setData(current => ({ ...current, rows: current.rows.filter(r => r.id > 0) })); setPreview(null);
      invalidateClientCache("/api/plans"); invalidateClientCache("/api/schedule"); invalidateClientCache("/api/orders"); invalidateClientCache("/api/dashboard");
      await load(from, to); setNotice(`已统一保存 ${body.adjustedPlans} 条计划，历史实绩和库存保持不变。`);
    } catch (e) { setError(`${committed ? "保存已成功，但页面刷新失败，请重新加载，勿重复提交。" : ""}${e instanceof Error ? e.message : "操作失败"}`); }
    finally { setBusy(false); }
  }
  const displayValue = (v: PlanValues, field: Field) => field === "lineId" ? data.lines.find(l => l.id === v.lineId)?.name ?? v.lineId
    : Array.isArray(v[field]) ? (v[field] as string[]).join("、") : String(v[field]);

  return <div className="mx-auto max-w-[1800px] p-5" style={{ paddingBottom: footerHeight + 50 }}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-bold text-mint-700">表格排期工作台</h1><Link href="/schedule" className="text-sm text-mint-700 underline">返回排期总览</Link></div>
    <p className="mb-3 text-sm text-text-secondary">新增或修改排期，支持 Tab 连续编辑、回车向下、从 Excel 粘贴。先检查改动，再统一保存。已报工和已有入库申请的行只读，不修改订单需求或库存。</p>
    <fieldset disabled={busy} className="mb-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">起始日期<input className={`${control} ml-2`} type="date" aria-label="表格起始日期" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="text-sm">结束日期<input className={`${control} ml-2`} type="date" aria-label="表格结束日期" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button className={button} onClick={reload}>加载排期</button>
      <label className="text-sm">筛选拉别<select className={`${control} ml-2`} value={lineFilter} onChange={e => { setLineFilter(e.target.value); setSelected([]); }}><option value="">全部拉别</option>{data.lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <button type="button" className={button} onClick={() => setAddOpen(true)}>＋ 增加排期</button>
      {orderId && <span className="text-sm text-text-secondary">当前限订单 #{orderId}</span>}
    </fieldset>
    <fieldset disabled={busy} className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-mint-50 p-3">
      <span className="text-sm">已选 {selected.length} 行</span>
      <select aria-label="批量操作" className={control} value={operation} onChange={e => { setOperation(e.target.value); setBulk(e.target.value === "shift" ? "1" : ""); }}>
        <option value="shift">顺延 / 提前（自然日）</option><option value="planDate">统一日期</option><option value="plannedQty">统一计划数</option><option value="workerCount">统一人数</option><option value="workHours">统一工时</option><option value="lineId">统一拉别</option><option value="remark">统一备注</option>
      </select>
      {operation === "lineId" ? <select aria-label="批量值" className={control} value={bulk} onChange={e => setBulk(e.target.value)}><option value="">选择拉别</option>{data.lines.filter(l => l.isActive).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        : <input aria-label="批量值" className={control} type={operation === "planDate" ? "date" : "text"} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={operation === "shift" ? "负数提前，正数顺延" : "填写统一值"} />}
      <button className={button} onClick={applyBulk}>应用到草稿</button>
      <button className={button} disabled={!dirty.length} onClick={() => { if (window.confirm("放弃全部未保存修改？")) { setDrafts({}); setAdditions({}); setData(current => ({ ...current, rows: current.rows.filter(r => r.id > 0) })); setSelected([]); edited(); } }}>放弃全部修改</button>
    </fieldset>
    <label className="mb-3 flex items-center gap-2 text-sm text-mint-700"><input type="checkbox" disabled={busy} checked={autoDeduct}
      onChange={e => { setAutoDeduct(e.target.checked); edited(); }} />增加计划数时，自动从后续未报工计划扣减（同订单、部位、工序，保持总量）</label>
    {error && <p role="alert" aria-label="排期工作台错误" className="mb-3 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {excessDetails.length > 0 && <ExcessScheduleDetails details={excessDetails} />}
    {notice && <p role="status" className="mb-3 rounded-lg bg-mint-50 p-3 text-sm text-mint-700">{notice}</p>}
    {busy && <p role="status" className="mb-2 text-sm text-text-secondary">处理中…</p>}
    <p className="mb-2 text-xs text-text-secondary">数量按同订单、部位、工序汇总本厂区全部日期及拉别，不跨工序相加。尚需补排 = max（订单总需求 − 累计已生产 − 未报工计划，0）。{preview?.balances ? "统计已计入本次检查的草稿和自动扣减，尚未保存。" : dirty.length ? "当前统计按已保存排期；请点击“检查改动”查看调整后数量。" : "当前统计按已保存排期。"}</p>
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-app-border bg-white">
      <table ref={table} className="w-full min-w-[2050px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-mint-50 text-mint-700"><tr>
          <th className="p-2"><input type="checkbox" aria-label="全选可编辑计划" disabled={busy} checked={visible.some(r => !r.lockedReason) && visible.filter(r => !r.lockedReason).every(r => selected.includes(r.id))}
            onChange={e => setSelected(e.target.checked ? visible.filter(r => !r.lockedReason).map(r => r.id) : [])} /></th>
          <th className="p-2 text-left">订单 / 款号 / 部位</th><th className="p-2">工序</th>
          {fields.map(f => <th key={f} className="p-2 text-left">{labels[f]}</th>)}
          <th className="p-2 whitespace-nowrap">订单总需求</th><th className="p-2 whitespace-nowrap">累计已生产</th><th className="p-2 whitespace-nowrap">未报工计划</th><th className="p-2 whitespace-nowrap">尚需补排</th><th className="p-2 whitespace-nowrap">已生产 / 入库（本行）</th><th className="p-2">状态</th>
        </tr></thead>
        <tbody>{visible.map((row, index) => {
          const value = drafts[row.id] ?? draftOf(row.values); const modified = row.id < 0 || changed(row, drafts[row.id]);
          const sameGroup = (b: WorkbenchBalance) => b.orderId === row.orderId && b.partName === row.partName && b.stepNo === row.stepNo;
          const balance = preview?.balances?.find(sameGroup) ?? row.balance ?? data.rows.find(r => r.balance && sameGroup(r.balance))?.balance;
          const statsLabel = row.id < 0 ? `新增排期 ${-row.id}` : `计划 #${row.id}`;
          return <tr key={row.id} className={`border-t border-app-border ${row.lockedReason ? "bg-gray-50 text-text-tertiary" : modified ? "bg-amber-50" : ""}`}>
            <td className="p-2"><input type="checkbox" aria-label={`选择计划 #${row.id}`} disabled={busy || !!row.lockedReason} checked={selected.includes(row.id)} onChange={e => setSelected(s => e.target.checked ? [...s, row.id] : s.filter(id => id !== row.id))} /></td>
            <td className="min-w-[190px] p-2"><div className="font-semibold">{row.orderNo}</div><div>{row.productNo} · {row.partName}</div><small>{row.id < 0 ? `新增排期 ${-row.id}` : `计划 #${row.id}`}</small></td>
            <td className="p-2 whitespace-nowrap">第{row.stepNo}道<br />{row.craft}</td>
            {fields.map(field => {
              const common = { "aria-label": `${row.id < 0 ? `新增排期 ${-row.id}` : `计划 #${row.id}`} ${labels[field]}`, "data-row": row.id, "data-field": field,
                disabled: busy || !!row.lockedReason, value: value[field], onChange: (e: { target: { value: string } }) => edit(row, field, e.target.value),
                onPaste: (e: ClipboardEvent<HTMLElement>) => paste(e, index, field), onKeyDown: (e: KeyboardEvent<HTMLElement>) => move(e, index, field) };
              return <td key={field} className="p-1 align-top">{field === "lineId" ? <select {...common} className={`${control} w-[140px]`}>
                {data.lines.filter(l => l.id === Number(value.lineId) || (l.isActive && l.craftType === data.lines.find(line => line.id === row.values.lineId)?.craftType)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                : field === "machineNos" ? <>
                  <input {...common} className={`${control} w-[140px]`} placeholder="输入或下方选择机台" />
                  {!row.lockedReason && <details className="mt-1 text-xs text-text-secondary"><summary className="cursor-pointer">可用机台（{data.lines.find(l => l.id === Number(value.lineId))?.machineNos.length ?? 0}）</summary>
                    <div className="max-h-40 w-[220px] overflow-auto rounded border border-app-border bg-white p-1">{(data.lines.find(l => l.id === Number(value.lineId))?.machineNos ?? []).map(no => <button key={no} type="button" disabled={busy} className="block w-full rounded p-1 text-left hover:bg-mint-50" onClick={() => {
                      const existing = value.machineNos.split(/[,，、;；\n]+/).map(n => n.trim()).filter(Boolean);
                      edit(row, "machineNos", Array.from(new Set([...existing, no])).join("、"));
                    }}>{no}</button>)}{!(data.lines.find(l => l.id === Number(value.lineId))?.machineNos.length) && <span>此拉别暂无启用机台</span>}</div>
                  </details>}
                </>
                : field === "remark" ? <textarea {...common} maxLength={2000} className={`${control} min-w-[160px]`} rows={2} />
                : <input {...common} className={`${control} ${field === "planDate" ? "w-[145px]" : "w-[95px]"}`} type={field === "planDate" ? "date" : "text"} inputMode={["plannedQty", "workerCount", "workHours"].includes(field) ? "decimal" : undefined} />}
              </td>;
            })}
            <td className="p-2" aria-label={`${statsLabel} 订单总需求`}>{row.demand.toLocaleString()}</td>
            <td className="p-2" aria-label={`${statsLabel} 累计已生产`}>{balance?.produced.toLocaleString() ?? "—"}{!!balance?.actualFallbackCount && <small className="block min-w-[140px] text-text-secondary">含 {balance.actualFallbackCount} 条历史报工未填良品数，按员工报数或原计划计入</small>}</td>
            <td className="p-2" aria-label={`${statsLabel} 未报工计划`}>{balance?.unreportedPlanned.toLocaleString() ?? "—"}</td>
            <td className="p-2 font-semibold text-amber-700" aria-label={`${statsLabel} 尚需补排`}>{balance?.remainingToSchedule.toLocaleString() ?? "—"}{!balance && <small className="block min-w-[140px] font-normal text-text-secondary">统计未加载，请重新加载或检查改动</small>}</td>
            <td className="p-2 whitespace-nowrap">{row.goodQty?.toLocaleString() ?? "—"} / {row.inboundQty?.toLocaleString() ?? "—"}</td>
            <td className="min-w-[100px] p-2 text-xs">{row.lockedReason ?? (row.id < 0 ? "新增待保存" : modified ? "待保存" : "未报工")}{modified && <button className="mt-1 block underline text-mint-700" disabled={busy} onClick={() => { if (row.id < 0) { removeNew(row.id); return; } setDrafts(s => { const next = { ...s }; delete next[row.id]; return next; }); edited(); }}>{row.id < 0 ? "移除新增" : "还原本行"}</button>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length && !busy && <p className="p-8 text-center text-text-tertiary">此范围没有排期，请调整日期或拉别筛选。</p>}
    </div>
    {preview && <section aria-label="统一保存预览" className="mt-4 rounded-lg border border-mint-400 bg-white p-4">
      <h2 className="mb-2 font-bold text-mint-700">统一保存预览 · {preview.adjustedPlans} 行</h2>
      {!!preview.transfers?.length && <div aria-label="自动扣减明细" className="mb-3 rounded bg-amber-50 p-3 text-sm">
        <p className="mb-1 font-semibold">以下后续排期会一起扣减（包含筛选范围外的日期）</p>
        {preview.transfers.map((transfer, index) => <p key={index}>{transfer.orderNo} / {transfer.partName} 第{transfer.stepNo}道：{transfer.sourceDate} 计划 #{transfer.sourcePlanId} 扣减 {transfer.quantity.toLocaleString()} 件 → {transfer.targetDate} 计划 #{transfer.targetPlanId}</p>)}
      </div>}
      {preview.warnings.map((warning, index) => <p key={index} className="mb-1 text-sm text-amber-800">⚠ {warning}</p>)}
      <ul className="my-3 max-h-48 overflow-auto text-sm">{preview.changes.map(change => <li key={change.id} className="border-b border-app-border py-2">{change.created ? `新增排期 ${-change.id} · ${change.orderNo ?? ""} / ${change.partName ?? ""} · ${change.after.planDate}` : `计划 #${change.id}`}{change.automatic ? "（自动扣减）" : ""}{change.removed ? "（扣至 0，撤销未报工计划）" : ""}：{change.created ? fields.map(f => `${labels[f]} ${displayValue(change.after, f) || "空"}`).join("；") : fields.filter(f => JSON.stringify(change.before[f]) !== JSON.stringify(change.after[f])).map(f => `${labels[f]} ${displayValue(change.before, f) || "空"} → ${displayValue(change.after, f) || "空"}`).join("；")}</li>)}</ul>
      <p className="mb-3 text-xs text-text-secondary">确认后整批保存；已登记来料的部位如有生产计划变动，将暂停该部位自动重排，避免覆盖人工安排，再次保存来料可恢复。</p>

    </section>}
    <div ref={footer} role="region" aria-label="排期保存操作" className="fixed inset-x-0 bottom-0 z-40 border-t border-mint-400 bg-white px-5 py-3 shadow-[0_-3px_12px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-[1760px] flex-wrap items-center gap-3">
        <span className="text-sm">共 {data.rows.length} 行，待保存 {dirty.length} 行（新增 {Object.keys(additions).length} 行，含筛选隐藏行）</span>
        <label className="text-sm">调整原因<input aria-label="调整原因" disabled={busy} className={`${control} ml-2 w-[220px]`} maxLength={500} placeholder="如临时加单、来料推迟" value={reason} onChange={e => { setReason(e.target.value); setPreview(null); }} /></label>
        <button type="button" className={button} disabled={busy || !dirty.length} onClick={() => submit(true)}>检查改动（{dirty.length}）</button>
        <button type="button" className="rounded-btn bg-mint-700 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy || !preview?.adjustedPlans} onClick={() => submit(false)}>确认统一保存（{preview?.adjustedPlans ?? 0}）</button>
        <span className="text-xs text-text-secondary">{preview ? "请核对上方预览后确认保存" : "先检查改动，再确认统一保存"}</span>
      </div>
    </div>
    {addOpen && <AddPlanDialog date={from} lines={data.lines} orderId={orderId} onClose={() => setAddOpen(false)} onAdd={add} />}
  </div>;
}
