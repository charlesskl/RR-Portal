"use client";
import { useMemo, useState } from "react";
import { PencilSquareIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { DataTable, KpiCard, PageTitle, StatusBadge } from "@/components/ui";
import { useComplaintData } from "@/components/data-provider";
import { useAuth } from "@/components/auth-provider";
import type { CAPInput, CAPRecord, CAPStage } from "@/lib/types";

const stages:CAPStage[]=["草稿","原因分析","措施执行","等待验证","已关闭"];
const blank:CAPInput={problemDescription:"",issueType:"",owner:"",stage:"草稿",dueDate:"",rootCauseAnalysis:"",correctiveAction:"",preventiveAction:"",effectivenessVerification:"",complaintIds:[]};
const overdue=(cap:CAPRecord)=>cap.stage!=="已关闭"&&Boolean(cap.dueDate)&&cap.dueDate<new Date().toISOString().slice(0,10);

export default function CAP(){
  const {can}=useAuth();const canManage=can("manage_cap");
  const {capRecords,records,issueTypes,issueTypeLabel,saveCAP,deleteCAP}=useComplaintData();
  const [editing,setEditing]=useState<CAPRecord|null|undefined>(undefined);
  const active=capRecords.filter(cap=>cap.stage!=="已关闭").length,late=capRecords.filter(overdue).length,waiting=capRecords.filter(cap=>cap.stage==="等待验证").length,closed=capRecords.filter(cap=>cap.stage==="已关闭").length;
  const rows=useMemo(()=>capRecords.map(cap=>[
    <b key="number">{cap.capNumber}</b>,cap.problemDescription,<StatusBadge key="links" tone="info">{cap.complaintIds.length} 条投诉</StatusBadge>,cap.owner||"未指定",
    <StatusBadge key="stage" tone={cap.stage==="已关闭"?"good":overdue(cap)?"bad":"warning"}>{overdue(cap)?"已逾期":cap.stage}</StatusBadge>,cap.dueDate||"未设置",
    canManage?<div key="actions" className="flex gap-2"><button onClick={()=>setEditing(cap)} className="btn-secondary"><PencilSquareIcon className="h-4 w-4"/>编辑</button><button onClick={()=>{if(confirm(`确认删除 ${cap.capNumber}？关联投诉不会被删除。`))void deleteCAP(cap.id)}} className="rounded-lg border border-red-200 px-2 text-red-600"><TrashIcon className="h-4 w-4"/></button></div>:<span key="readonly" className="text-xs text-neutral-400">只读</span>
  ]),[capRecords,deleteCAP,canManage]);
  return <><PageTitle title="纠正措施计划（CAP）" description="以真实本地数据创建、执行和验证 CAP，并保持投诉关联同步。" action={canManage?"新建 CAP":undefined} onAction={canManage?()=>setEditing(null):undefined}/>
    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><KpiCard label="CAP 总数" value={String(capRecords.length)}/><KpiCard label="进行中" value={String(active)} tone="accent"/><KpiCard label="逾期" value={String(late)} tone="bad"/><KpiCard label="等待验证" value={String(waiting)} tone="accent"/><KpiCard label="已关闭" value={String(closed)} tone="good"/><KpiCard label="关闭率" value={`${capRecords.length?(closed/capRecords.length*100).toFixed(1):"0.0"}%`} tone="good"/></div>
    <DataTable columns={["CAP 编号","问题描述","关联记录","负责人","阶段/状态","到期日","操作"]} rows={rows}/>
    {editing!==undefined&&<CAPEditor cap={editing} records={records} issueTypes={issueTypes} issueTypeLabel={issueTypeLabel} close={()=>setEditing(undefined)} save={saveCAP}/>}
  </>;
}

function CAPEditor({cap,records,issueTypes,issueTypeLabel,close,save}:{cap:CAPRecord|null;records:ReturnType<typeof useComplaintData>["records"];issueTypes:string[];issueTypeLabel:(name:string)=>string;close:()=>void;save:(input:CAPInput,id?:string)=>Promise<void>}){
  const [form,setForm]=useState<CAPInput>(cap?{problemDescription:cap.problemDescription,issueType:cap.issueType,owner:cap.owner,stage:cap.stage,dueDate:cap.dueDate,rootCauseAnalysis:cap.rootCauseAnalysis,correctiveAction:cap.correctiveAction,preventiveAction:cap.preventiveAction,effectivenessVerification:cap.effectivenessVerification,complaintIds:cap.complaintIds}:blank);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");const field=(key:keyof CAPInput,value:string|string[])=>setForm(current=>({...current,[key]:value}));
  async function submit(){if(!form.problemDescription.trim()||!form.issueType.trim()){setError("问题描述和问题类型为必填项。");return}setBusy(true);try{await save(form,cap?.id);close()}catch(reason){setError(reason instanceof Error?reason.message:"保存失败");setBusy(false)}}
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={close}><section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={event=>event.stopPropagation()}>
    <div className="flex justify-between"><div><div className="label">{cap?"编辑 CAP":"新建 CAP"}</div><h2 className="mt-1 text-lg font-bold">{cap?.capNumber||"编号将在保存时自动生成"}</h2></div><button onClick={close}><XMarkIcon className="h-5 w-5"/></button></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="问题描述"><input className="field w-full" value={form.problemDescription} onChange={e=>field("problemDescription",e.target.value)}/></Field><Field label="问题类型"><input list="cap-issues" className="field w-full" value={form.issueType} onChange={e=>field("issueType",e.target.value)}/><datalist id="cap-issues">{issueTypes.map(type=><option key={type} value={type}>{issueTypeLabel(type)}</option>)}</datalist></Field><Field label="负责人"><input className="field w-full" value={form.owner} onChange={e=>field("owner",e.target.value)}/></Field><Field label="阶段"><select className="field w-full" value={form.stage} onChange={e=>field("stage",e.target.value)}>{stages.map(stage=><option key={stage}>{stage}</option>)}</select></Field><Field label="到期日"><input type="date" className="field w-full" value={form.dueDate} onChange={e=>field("dueDate",e.target.value)}/></Field></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">{(["rootCauseAnalysis","correctiveAction","preventiveAction","effectivenessVerification"] as const).map((key,index)=><Field key={key} label={["原因分析","纠正措施","预防措施","有效性验证"][index]}><textarea rows={3} className="field w-full" value={form[key]} onChange={e=>field(key,e.target.value)}/></Field>)}</div>
    <Field label={`关联投诉（已选择 ${form.complaintIds.length} 条）`}><div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line p-3">{records.length?records.map(record=><label key={record.id} className="flex gap-2 border-b border-line py-2 text-xs last:border-0"><input type="checkbox" checked={form.complaintIds.includes(record.id)} onChange={e=>field("complaintIds",e.target.checked?[...form.complaintIds,record.id]:form.complaintIds.filter(id=>id!==record.id))}/><span><b>{record.sourceSubmissionId||record.productSku}</b> · {record.issueType?issueTypeLabel(record.issueType):"未分类"} · {record.complaintMessageZhFinal||record.complaintMessageZhMachine||record.complaintMessageOriginal}</span></label>):<p className="text-sm text-neutral-400">暂无投诉记录</p>}</div></Field>
    {error&&<div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={close}>取消</button><button className="btn-accent" disabled={busy} onClick={()=>void submit()}>{busy?"保存中…":"保存 CAP"}</button></div>
  </section></div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block"><span className="mb-2 block text-sm font-semibold">{label}</span>{children}</label>}
