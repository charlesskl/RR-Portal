"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { valuesOf, type PlanValues, type WorkbenchAllocationSource, type WorkbenchBalance, type WorkbenchLine } from "@/lib/planWorkbench";
export type PlanOption = { orderId: number; orderPartQtyId: number; sourcePartId: number; orderNo: string; productNo: string; partName: string; stepNo: number; craft: string; demand: number; remaining: number; token: string; balance?: WorkbenchBalance; allocationSources?: WorkbenchAllocationSource[] };
const input = "w-full rounded-md border border-app-border bg-white px-3 py-2 text-sm";
export default function AddPlanDialog({ date, lines, orderId, onClose, onAdd }: {
  date: string; lines: WorkbenchLine[]; orderId?: number; onClose: () => void; onAdd: (option: PlanOption, values: PlanValues) => void;
}) {
  const [options, setOptions] = useState<PlanOption[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [key, setKey] = useState("");
  const [day, setDay] = useState(date), [lineId, setLineId] = useState(""), [qty, setQty] = useState("");
  const [people, setPeople] = useState("1"), [hours, setHours] = useState("11"), [machineNos, setMachineNos] = useState(""), [remark, setRemark] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    apiFetch(`/api/plans/workbench/options${orderId ? `?orderId=${orderId}` : ""}`, { cache: "no-store", signal: abort.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "可排产品读取失败"); if (!Array.isArray(body)) throw new Error("可排产品返回格式异常，请重试"); setOptions(body); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [orderId]);
  useEffect(() => { const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown); }, [onClose]);
  const option = options.find(o => `${o.orderPartQtyId}:${o.stepNo}` === key);
  const filtered = options.filter(o => `${o.orderNo} ${o.productNo} ${o.partName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const targetLines = lines.filter(l => l.isActive && l.craftType === option?.craft);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
    <form role="dialog" aria-modal="true" aria-labelledby="add-plan-title" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-card bg-white p-5 shadow-xl" onSubmit={event => {
      event.preventDefault(); setError("");
      try {
        if (!option) throw new Error("请选择已有订单的产品部位和工序");
        const values = valuesOf({ planDate: day, lineId, plannedQty: qty, workerCount: people, workHours: hours, machineNos, remark });
        onAdd(option, values);
      } catch (e) { setError(e instanceof Error ? e.message : "请检查输入"); }
    }}>
      <div className="mb-3 flex justify-between"><h2 id="add-plan-title" className="font-bold text-mint-700">增加排期</h2><button type="button" aria-label="关闭增加排期" onClick={onClose}>✕</button></div>
      <p className="mb-3 text-sm text-text-secondary">选择当前厂区已有订单的货号、部位与工序，加入草稿后与表格改动一起检查并统一保存。未建订单或未补全工艺的产品，请先在订单总览维护。</p>
      {error && <p role="alert" aria-label="增加排期错误" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {loading ? <p>正在加载可排产品…</p> : <>
        <label className="mb-3 block text-sm">搜索订单 / 货号 / 部位<input className={input} value={query} onChange={e => { setQuery(e.target.value); setKey(""); setLineId(""); setMachineNos(""); }} /></label>
        <label className="mb-3 block text-sm">订单产品与工序<select className={input} value={key} onChange={e => {
          const next = options.find(o => `${o.orderPartQtyId}:${o.stepNo}` === e.target.value);
          setKey(e.target.value); setLineId(String(lines.find(l => l.isActive && l.craftType === next?.craft)?.id ?? "")); setMachineNos("");
        }}><option value="">请选择</option>{filtered.map(o => <option key={`${o.orderPartQtyId}:${o.stepNo}`} value={`${o.orderPartQtyId}:${o.stepNo}`}>{o.orderNo} · {o.productNo} · {o.partName} · 第{o.stepNo}道 {o.craft}</option>)}</select></label>
        {!options.length && <p className="mb-3 text-sm text-text-secondary">没有可排产品，请先核对订单状态及部位工艺资料。</p>}
        {option && <p className="mb-3 text-sm text-mint-700">该部位需求 {option.demand.toLocaleString()} 件，第 {option.stepNo} 道剩余未排 {option.remaining.toLocaleString()} 件。</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">新增排期日期<input type="date" className={input} value={day} onChange={e => setDay(e.target.value)} /></label>
          <label className="text-sm">新增排期拉别<select className={input} value={lineId} onChange={e => { setLineId(e.target.value); setMachineNos(""); }}><option value="">选择相同工艺拉别</option>{targetLines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="text-sm">新增计划数量<input className={input} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} /></label>
          <label className="text-sm">新增排期人数<input className={input} inputMode="numeric" value={people} onChange={e => setPeople(e.target.value)} /></label>
          <label className="text-sm">新增排期工时<input className={input} inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} /></label>
          <label className="text-sm">新增排期机台<input className={input} value={machineNos} onChange={e => setMachineNos(e.target.value)} placeholder="多台用顿号分隔" list="new-plan-machines" /></label>
          <datalist id="new-plan-machines">{lines.find(l => l.id === Number(lineId))?.machineNos.map(no => <option key={no} value={no} />)}</datalist>
          <label className="col-span-2 text-sm">新增排期备注<textarea className={input} maxLength={2000} value={remark} onChange={e => setRemark(e.target.value)} /></label>
        </div>
      </>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded-btn border px-4 py-2 text-sm" onClick={onClose}>取消</button><button disabled={loading || !option} className="rounded-btn bg-mint-700 px-4 py-2 text-sm text-white disabled:opacity-40">加入排期草稿</button></div>
    </form>
  </div>;
}
