"use client";
import { useEffect,useRef,useState } from "react";
import { ArrowDownTrayIcon,ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { PageTitle } from "@/components/ui";
import { useComplaintData } from "@/components/data-provider";
import { apiFetch } from "@/lib/backend";
import { LocalStorageComplaintRepository } from "@/lib/repository";
import type { LocalDataBackup } from "@/lib/types";

function Setting({title,description,locked}:{title:string;description:string;locked?:string}){
  const [on,setOn]=useState(true);
  return <div className="flex flex-col justify-between gap-4 border-b border-line py-5 last:border-0 sm:flex-row sm:items-center"><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs text-neutral-500">{description}</p></div>{locked?<span className="text-xs font-bold text-emerald-600">{locked}</span>:<button aria-label={title} aria-pressed={on} onClick={()=>setOn(value=>!value)} className={`relative h-6 w-11 rounded-full transition ${on?"bg-ink":"bg-neutral-300"} after:absolute after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all ${on?"after:right-1":"after:left-1"}`}/>}</div>
}

// One-time migration helper: browsers that used the old localStorage version
// may still hold accounts/complaints. Offer a single click to move them into
// the backend database, then the data exists for every device.
function LegacyLocalSync(){
  const [localUsers,setLocalUsers]=useState(0);
  const [localComplaints,setLocalComplaints]=useState(0);
  const [syncing,setSyncing]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    try{setLocalUsers((JSON.parse(localStorage.getItem("toyqms.users.v1")||"[]") as unknown[]).length)}catch{setLocalUsers(0)}
    try{setLocalComplaints((JSON.parse(localStorage.getItem("toyqms.complaints.v1")||"[]") as unknown[]).length)}catch{setLocalComplaints(0)}
  },[]);
  const syncLocal=async()=>{
    if(!window.confirm(`将把本浏览器中的 ${localUsers} 个账户与 ${localComplaints} 条投诉记录同步到后端数据库。同名账户会用本地版本覆盖（含密码），同步后需要重新登录。是否继续？`))return;
    setSyncing(true);setMessage("");
    try{
      const backup=await new LocalStorageComplaintRepository().exportLocalData();
      if(backup.complaintRecords.length||backup.capRecords?.length||backup.importHistory.length){
        await apiFetch("/backup/restore",{method:"POST",body:backup});
      }
      const users=JSON.parse(localStorage.getItem("toyqms.users.v1")||"[]") as unknown[];
      const result=await apiFetch<{imported:number}>("/users/import",{method:"POST",body:{users}});
      window.alert(`同步完成：已导入 ${result.imported} 个账户${backup.complaintRecords.length?`、${backup.complaintRecords.length} 条投诉记录`:""}。请使用原账户和密码重新登录。`);
      window.location.href="/login/";
    }catch(reason){setMessage(reason instanceof Error?reason.message:"同步失败。")}
    finally{setSyncing(false)}
  };
  if(!localUsers&&!localComplaints)return null;
  return <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-800">本浏览器还保存着 {localUsers} 个旧本地账户、{localComplaints} 条旧本地投诉记录（早期浏览器版遗留），尚未进入后端数据库。其它设备上看不到这些账户与数据。</p><button type="button" onClick={()=>void syncLocal()} disabled={syncing} className="btn-accent mt-3 disabled:opacity-50">{syncing?"同步中…":"同步本地数据到后端"}</button>{message&&<p className="mt-2 text-sm text-red-700">{message}</p>}</div>
}

export default function Settings(){
  const {records,capRecords,exportLocalData,restoreLocalData}=useComplaintData();
  const backupInput=useRef<HTMLInputElement>(null);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const downloadBackup=async()=>{const backup=await exportLocalData();const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");const date=new Date().toISOString().slice(0,10);link.href=url;link.download=`ToyQMS-Data-Backup-${date}.json`;link.click();URL.revokeObjectURL(url);setError("");setNotice(`已导出 ${backup.complaintRecords.length} 条投诉记录。`)};
  const restoreBackup=async(file?:File)=>{if(!file)return;setError("");setNotice("");try{const backup=JSON.parse(await file.text()) as LocalDataBackup;const count=Array.isArray(backup.complaintRecords)?backup.complaintRecords.length:0;if(!window.confirm(`备份中包含 ${count} 条投诉记录。恢复后会替换当前数据库中的数据，是否继续？`))return;await restoreLocalData(backup);setNotice(`恢复完成：已载入 ${count} 条投诉记录。`)}catch(reason){setError(reason instanceof Error?reason.message:"无法读取备份文件。")}finally{if(backupInput.current)backupInput.current.value=""}};
  return <><PageTitle title="系统设置" description={`投诉与 CAP 数据统一保存在后端数据库（当前 ${records.length} 条投诉、${capRecords.length} 份 CAP）。`} action="导出备份" onAction={()=>void downloadBackup()}/>
    <div className="grid gap-5 xl:grid-cols-2"><section className="card p-6"><h2 className="text-lg font-bold">数据与分类</h2><Setting title="保留英文原文" description="每条导入投诉的英文原文必须永久保留。" locked="强制启用"/><Setting title="AI 建议必须人工确认" description="未经人工确认的建议不能改变统计数据。" locked="强制启用"/><Setting title="修改类型后重新计算统计" description="立即刷新问题类型、系列和报告汇总。"/></section><section className="card p-6"><h2 className="text-lg font-bold">导入规则</h2><Setting title="主要系列来源" description="使用 Excel 工作表名称。" locked="工作表名称"/><Setting title="次要系列来源" description="使用工作簿中的 Range Name 字段。" locked="Range Name"/><Setting title="累计文件重复检测" description="使用七字段规范化组合键识别重复记录。"/></section></div>
    <section className="card mt-5 p-6"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h2 className="text-lg font-bold">数据备份与迁移</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">备份包含投诉、中文译文、导入历史、问题类型及系列中文名称。可用于存档或迁移到其它部署。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void downloadBackup()} className="btn-secondary"><ArrowDownTrayIcon className="h-4 w-4"/>导出数据（{records.length} 条）</button><input id="toyqms-backup-file" ref={backupInput} type="file" accept=".json,application/json" className="sr-only" onChange={event=>void restoreBackup(event.target.files?.[0])}/><label htmlFor="toyqms-backup-file" className="btn-accent cursor-pointer"><ArrowUpTrayIcon className="h-4 w-4"/>恢复数据</label></div></div>{notice&&<div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}{error&&<div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}<LegacyLocalSync/></section>
    <section className="card mt-5 p-6"><h2 className="text-lg font-bold">产品信息</h2><div className="mt-5 grid gap-4 md:grid-cols-5"><label><span className="label">产品名</span><input className="field mt-2 w-full" value="ToyQMS" readOnly/></label><label><span className="label">完整名称</span><input className="field mt-2 w-full" value="玩具质量管理系统" readOnly/></label><label><span className="label">副标题</span><input className="field mt-2 w-full" value="投诉与 CAP 分析" readOnly/></label><label><span className="label">Version</span><input className="field mt-2 w-full" value="0.3.9" readOnly/></label><label><span className="label">Build</span><input className="field mt-2 w-full" value="21" readOnly/></label></div></section>
  </>
}
