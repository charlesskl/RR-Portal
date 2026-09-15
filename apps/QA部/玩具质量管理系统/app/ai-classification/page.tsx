"use client";
import { useEffect,useMemo,useState } from "react";
import { useComplaintData } from "@/components/data-provider";
import { DataTable, KpiCard, PageTitle, StatusBadge } from "@/components/ui";
import { percent } from "@/lib/stats";
import { getAiStatus, requestAiClassification, type AiClassificationSuggestion } from "@/lib/ai";

// AI 分类审核：Kimi 生成的分类建议只是草稿，必须人工确认或修改后
// 才会写入记录并进入统计（系统强制规则）。
export default function AIClassification(){
  const {records,primarySeriesLabel,issueTypeLabel,issueTypeDefinitions,setComplaintIssue}=useComplaintData();
  const [aiReady,setAiReady]=useState(false);
  const [aiBusy,setAiBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [suggestions,setSuggestions]=useState<Map<string,AiClassificationSuggestion>>(new Map());
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editChoice,setEditChoice]=useState("");
  const [savingId,setSavingId]=useState<string|null>(null);
  const pending=useMemo(()=>records.filter(record=>!record.issueType),[records]);
  const classified=records.length-pending.length;
  const flash=(message:string)=>{setNotice(message);window.setTimeout(()=>setNotice(""),5000)};
  useEffect(()=>{void getAiStatus().then(result=>setAiReady(result.configured)).catch(()=>setAiReady(false))},[]);
  useEffect(()=>{const valid=new Set(pending.map(record=>record.id));setSuggestions(current=>new Map([...current].filter(([id])=>valid.has(id))))},[pending]);
  const generate=async()=>{const ids=pending.slice(0,100).map(record=>record.id);if(!ids.length){flash("当前没有待分类的记录。");return}if(!window.confirm(`将使用 AI（Kimi）为 ${ids.length} 条待分类记录生成建议${pending.length>100?"（本次处理前 100 条）":""}。建议必须经过人工确认或修改后才会保存并进入统计。是否继续？`))return;setAiBusy(true);try{const result=await requestAiClassification(ids);const next=new Map(suggestions);let ok=0;for(const item of result.suggestions){next.set(item.id,item);if(item.issueType)ok+=1}setSuggestions(next);flash(`AI 建议已生成：${ok} 条有明确建议，${result.suggestions.length-ok} 条无法确定。请逐条确认或修改。`)}catch(reason){flash(reason instanceof Error?reason.message:"AI 分类失败。")}finally{setAiBusy(false)}};
  const confirm=async(id:string,issueType:string)=>{setSavingId(id);try{await setComplaintIssue(id,issueType);setSuggestions(current=>{const next=new Map(current);next.delete(id);return next});flash(`已确认分类：${issueTypeLabel(issueType)}。`)}catch(reason){flash(reason instanceof Error?reason.message:"保存分类失败。")}finally{setSavingId(null)}};
  const suggestionCell=(id:string)=>{
    const suggestion=suggestions.get(id);
    if(!suggestion)return <StatusBadge tone="neutral">等待 AI 建议</StatusBadge>;
    if(suggestion.error)return <StatusBadge tone="bad">{suggestion.error}</StatusBadge>;
    if(!suggestion.issueType)return <span className="text-xs text-neutral-500">AI 无法确定{suggestion.reason?`：${suggestion.reason}`:""}</span>;
    return <div className="max-w-xs"><div className="font-semibold text-accent">{issueTypeLabel(suggestion.issueType)}</div>{suggestion.reason&&<div className="mt-1 text-xs leading-5 text-neutral-500">{suggestion.reason}</div>}</div>;
  };
  const actionCell=(id:string)=>{
    const suggestion=suggestions.get(id);
    if(editingId===id)return <div className="flex flex-wrap items-center gap-2"><select value={editChoice} onChange={event=>setEditChoice(event.target.value)} className="field max-w-48 text-xs"><option value="">选择问题类型…</option>{issueTypeDefinitions.map(type=><option key={type.name} value={type.name}>{type.chineseName||type.name}</option>)}</select><button disabled={!editChoice||savingId===id} onClick={()=>{void confirm(id,editChoice);setEditingId(null)}} className="btn-accent px-3 py-1 text-xs disabled:opacity-40">保存</button><button onClick={()=>setEditingId(null)} className="btn-secondary px-3 py-1 text-xs">取消</button></div>;
    return <div className="flex flex-wrap gap-2">{suggestion?.issueType&&<button disabled={savingId===id} onClick={()=>void confirm(id,suggestion.issueType!)} className="btn-accent px-3 py-1 text-xs disabled:opacity-40">确认建议</button>}<button onClick={()=>{setEditingId(id);setEditChoice(suggestion?.issueType||"")}} className="btn-secondary px-3 py-1 text-xs">{suggestion?.issueType?"修改":"人工分类"}</button></div>;
  };
  return <><PageTitle title="AI 分类审核" description="Kimi 生成的分类建议必须经过人工确认或修改后，才能保存并进入统计。" action={aiBusy?"AI 分析中…":`生成 AI 建议（${Math.min(pending.length,100)}）`} onAction={()=>void generate()}/>
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><KpiCard label="等待分类" value={String(pending.length)} tone="accent" detail="来自已导入投诉"/><KpiCard label="已人工分类" value={String(classified)} tone="good" detail="已有问题类型"/><KpiCard label="分类覆盖率" value={percent(classified,records.length)} detail={`${classified} / ${records.length} 条`}/></div>
    {!aiReady&&<div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>AI 未配置：</b>请在服务器环境变量中设置 MOONSHOT_API_KEY（月之暗面 Kimi 开放平台密钥）并重启服务后，即可生成分类建议。</div>}
    <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><b>人工确认控制：</b>AI 建议只是草稿。点击“确认建议”或人工修改保存后，分类才会写入记录并进入统计。</div>
    {notice&&<div className="mb-3 rounded-lg bg-neutral-900 p-3 text-sm text-white">{notice}</div>}
    <DataTable columns={["投诉编号","英文投诉原文","主要系列","AI 建议","置信度","操作"]} rows={pending.map(record=>{const suggestion=suggestions.get(record.id);return [record.sourceSubmissionId||record.id.slice(0,8),<span className="block max-w-xl whitespace-pre-wrap break-words" key="message">{record.complaintMessageOriginal}</span>,primarySeriesLabel(record.primarySeries),suggestionCell(record.id),suggestion?.issueType?`${Math.round((suggestion.confidence||0)*100)}%`:"—",actionCell(record.id)]})}/>
  </>
}
