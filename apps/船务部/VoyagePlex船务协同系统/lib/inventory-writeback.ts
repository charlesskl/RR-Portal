export type InventoryFile={filename:string;backup_filename:string;beforeHash:string;afterHash:string;content_base64?:string;backup_base64?:string};
export type PendingWriteback={operationId:string;state:string;actorName:string;taskIds:number[];result:{files?:InventoryFile[]}};
type FileHandle={getFile:()=>Promise<File>;createWritable:()=>Promise<{write:(data:Uint8Array<ArrayBuffer>)=>Promise<void>;close:()=>Promise<void>}>};
export type InventoryDirectory={getFileHandle:(name:string,options?:{create?:boolean})=>Promise<FileHandle>};
const basePath=process.env.NEXT_PUBLIC_BASE_PATH||"";
async function read(response:Response){const text=await response.text();try{return text?JSON.parse(text):{};}catch{throw new Error("回写服务响应异常，请先核对待恢复记录");}}
async function request(path:string,body:Record<string,unknown>,ownerConfirmations:Record<string,number>){
  for(;;){
    const response=await fetch(`${basePath}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,ownerConfirmations})});
    const result=await read(response);
    if(response.status===409&&result.code==="OtherTaskOwner"){
      if(ownerConfirmations[result.taskId]===result.ownerId||!window.confirm(result.error))throw new Error("已取消操作，未覆盖他人任务资料");
      ownerConfirmations[result.taskId]=result.ownerId;continue;
    }
    if(!response.ok)throw new Error(result.error||"回写操作失败，请先核对恢复记录");return result;
  }
}
function decode(value:string){const bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0));return bytes;}
export async function inventoryHash(file:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),value=>value.toString(16).padStart(2,"0")).join("");}
export async function fileEvidence(handle:InventoryDirectory,files:InventoryFile[]){
  return Promise.all(files.map(async file=>({filename:file.filename,hash:await inventoryHash(await(await handle.getFileHandle(file.filename,{create:false})).getFile())})));
}
export async function runInventoryWriteback(handle:InventoryDirectory,files:File[],taskIds:number[]){
  let result;
  // A confirmation is valid for this operation only, never for a later save.
  const ownerConfirmations:Record<string,number>={};
  for(;;){
    const form=new FormData();files.forEach(file=>form.append("files",file,file.name));form.set("task_ids",JSON.stringify(taskIds));form.set("owner_confirmations",JSON.stringify(ownerConfirmations));
    const response=await fetch(`${basePath}/api/inventory/local-files/writeback`,{method:"POST",body:form});result=await read(response);
    if(response.status===409&&result.code==="OtherTaskOwner"){
      if(ownerConfirmations[result.taskId]===result.ownerId||!window.confirm(result.error))throw new Error("已取消回写，未覆盖他人任务资料");
      ownerConfirmations[result.taskId]=result.ownerId;continue;
    }
    if(!response.ok)throw new Error(result.error||"回写方案生成失败");break;
  }
  const outputs:InventoryFile[]=result.files;
  const evidence=await fileEvidence(handle,outputs);
  if(outputs.some(file=>!evidence.some(value=>value.filename===file.filename&&value.hash===file.beforeHash)))throw new Error("库存文件已被其他人修改，未写入；请核对待恢复记录");
  await request("/api/inventory/writebacks/writing",{operationId:result.operationId},ownerConfirmations);
  for(const file of outputs){const backup=await handle.getFileHandle(file.backup_filename,{create:true});const writer=await backup.createWritable();await writer.write(decode(file.backup_base64!));await writer.close();}
  for(const file of outputs){
    const target=await handle.getFileHandle(file.filename,{create:false});
    if(await inventoryHash(await target.getFile())!==file.beforeHash)throw new Error("库存文件在写入前发生变化，已停止，请核对恢复记录");
    const writer=await target.createWritable();await writer.write(decode(file.content_base64!));await writer.close();
  }
  await request("/api/inventory/writebacks/complete",{operationId:result.operationId,files:await fileEvidence(handle,outputs)},ownerConfirmations);
  return result;
}
export async function recoverInventoryWriteback(handle:InventoryDirectory,record:PendingWriteback){
  const ownerConfirmations:Record<string,number>={};
  const files=record.result.files||[];
  if(record.state==="Writing"){
    const evidence=await fileEvidence(handle,files);
    if(files.length&&files.every(file=>evidence.some(value=>value.filename===file.filename&&value.hash===file.afterHash))){
      await request("/api/inventory/writebacks/complete",{operationId:record.operationId,files:evidence},ownerConfirmations);return "库存文件已核对，仅补存任务完成状态，未再次扣减";
    }
    if(files.length&&files.every(file=>evidence.some(value=>value.filename===file.filename&&value.hash===file.beforeHash))){
      if(!window.confirm("全部文件均与写入前一致。请确认原写入窗口已停止，且已人工核对或恢复全部原表。是否解除本次记录，之后重新回写？"))throw new Error("已保留回写记录");
      await request("/api/inventory/writebacks/rollback",{operationId:record.operationId,files:evidence,confirmRollback:true},ownerConfirmations);return "已记录人工核对并解除未生效的回写，可以重新发起";
    }
    throw new Error("文件与写入前后记录不完全一致，可能只写入部分。请根据列出的备份人工核对并恢复全部原表，再核对恢复；不可直接重复扣库存。");
  }
  if(record.state!=="Preparing"&&record.state!=="Prepared")throw new Error("回写阶段已变化，请刷新记录");
  if(!window.confirm("此记录尚未开始写库存。确认取消未写入的方案，之后可重新发起回写？"))throw new Error("已保留回写记录");
  await request("/api/inventory/writebacks/cancel",{operationId:record.operationId},ownerConfirmations);return "已取消未写入的方案，可以重新回写";
}
