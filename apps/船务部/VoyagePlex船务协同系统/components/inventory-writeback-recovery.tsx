"use client";
import { useEffect,useState } from "react";
import { recoverInventoryWriteback,type InventoryDirectory,type PendingWriteback } from "@/lib/inventory-writeback";
const basePath=process.env.NEXT_PUBLIC_BASE_PATH||"";
export function InventoryWritebackRecovery({getDirectory,onRecovered}:{getDirectory:()=>Promise<InventoryDirectory>;onRecovered:()=>void}){
  const [records,setRecords]=useState<PendingWriteback[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  async function load(){try{const response=await fetch(`${basePath}/api/inventory/writebacks`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"无法读取回写记录");setRecords(data);}catch(reason){setError(reason instanceof Error?reason.message:"读取失败");}}
  useEffect(()=>{void load();},[]);
  async function recover(record:PendingWriteback){setBusy(true);setError("");setNotice("");try{setNotice(await recoverInventoryWriteback(await getDirectory(),record));await load();onRecovered();}catch(reason){setError(reason instanceof Error?reason.message:"请人工核对回写记录");}finally{setBusy(false);}}
  return <section className="panel"><div className="panel-title"><div><h2>库存回写记录</h2><p>中断后先核对文件，已写入时仅补存完成状态。</p></div><button className="ghost-button" disabled={busy} onClick={()=>void load()}>刷新记录</button></div>{error&&<p className="form-error">{error}</p>}{notice&&<p className="notice">{notice}</p>}{records.length?records.map(record=><div className="notice" key={record.operationId}><span>任务 {record.taskIds.map(id=>`#${id}`).join("、")} · {record.actorName} · {record.state==="Writing"?"写入结果待核对":"方案未完成"}</span>{record.result.files?.map(file=><small style={{display:"block"}} key={file.filename}>原表：{file.filename}；备份：{file.backup_filename}</small>)}<button className="ghost-button" disabled={busy} onClick={()=>void recover(record)}>核对文件并恢复</button></div>):<p>暂无待恢复记录</p>}</section>;
}
