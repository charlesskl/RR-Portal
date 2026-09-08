"use client";
import { useEffect,useState } from "react";
import { useComplaintData } from "@/components/data-provider";
import { ChartCard, DataTable, KpiCard, PageTitle, StatusBadge } from "@/components/ui";
import { groupCount, percent } from "@/lib/stats";

export default function IssueTypes(){
  const {records,issueTypes,issueTypeDefinitions,setIssueTypeChineseName}=useComplaintData();
  const counts=new Map(groupCount(records,r=>r.issueType).map(i=>[i.name,i.count]));
  const rows=[...issueTypes.map(name=>({name,chineseName:issueTypeDefinitions.find(item=>item.name===name)?.chineseName||"未设置中文类型",count:counts.get(name)||0})),...(counts.has("Unspecified")?[{name:"Unspecified",chineseName:"未分类",count:counts.get("Unspecified")||0}]:[])].sort((a,b)=>b.count-a.count);
  const known=records.filter(r=>r.issueType).length;
  return <><PageTitle title="问题类型统计" description="保留原始问题类型，并用可维护的中文类型统一全站统计显示。" action="管理类型" secondary="导出统计"/><div className="mb-4 grid gap-3 sm:grid-cols-3"><KpiCard label="问题类型库" value={String(issueTypes.length)}/><KpiCard label="已分类记录" value={String(known)} tone="good" detail={percent(known,records.length)}/><KpiCard label="未分类记录" value={String(records.length-known)} tone="accent" detail={percent(records.length-known,records.length)}/></div><ChartCard title="问题类型数据库"><DataTable columns={["原始问题类型","对应中文类型","投诉数","占比","数据状态"]} rows={rows.map(i=>[<span key="source">{i.name==="Unspecified"?"—":i.name}</span>,i.name==="Unspecified"?<span key="none">未分类</span>:<ChineseNameEditor key={i.name} name={i.name} value={i.chineseName} save={setIssueTypeChineseName}/>,i.count,percent(i.count,records.length),<StatusBadge key="status" tone={i.name==="Unspecified"?"warning":"good"}>{i.name==="Unspecified"?"待分类":i.count?"使用中":"已保存"}</StatusBadge>])}/></ChartCard></>
}

function ChineseNameEditor({name,value,save}:{name:string;value:string;save:(name:string,value:string)=>Promise<void>}){
  const [draft,setDraft]=useState(value);const [busy,setBusy]=useState(false);const [saved,setSaved]=useState(false);
  useEffect(()=>setDraft(value),[value]);
  return <div className="flex min-w-[220px] items-center gap-2"><input aria-label={`${name}的中文类型`} value={draft} onChange={e=>{setDraft(e.target.value);setSaved(false)}} className="field min-w-0 flex-1"/><button disabled={busy||!draft.trim()||draft.trim()===value} onClick={async()=>{setBusy(true);await save(name,draft);setBusy(false);setSaved(true)}} className="rounded bg-ink px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">{busy?"保存中":saved?"已保存":"保存"}</button></div>
}
