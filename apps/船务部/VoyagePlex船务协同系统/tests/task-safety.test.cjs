const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const {webcrypto,createHash}=require('node:crypto');
function load(file,extras={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const context={exports:{},process,Headers,FormData,File,Blob,Response,Uint8Array,ArrayBuffer,atob,crypto:webcrypto,...extras};vm.runInNewContext(code,context);return context.exports;}
test('他人任务取消后不重试；确认后携带所属账号且不改变归属',async()=>{
 let calls=[];const {taskMutation}=load('lib/task-mutation.ts',{window:{confirm:()=>false}});const send=async(_,options)=>{calls.push(JSON.parse(options.body));return Response.json({code:'OtherTaskOwner',ownerId:7,taskId:3,error:'确认覆盖'},{status:409});};
 await assert.rejects(taskMutation('/api/shipments/3',{method:'PATCH',body:'{"items":[]}'},send),/取消/);assert.equal(calls.length,1);
 calls=[];const confirmed=load('lib/task-mutation.ts',{window:{confirm:()=>true}}).taskMutation;
 await confirmed('/api/shipments/3',{method:'PATCH',body:'{"items":[]}'},async(_,options)=>{calls.push(JSON.parse(options.body));return calls.length===1?Response.json({code:'OtherTaskOwner',ownerId:7,taskId:3,error:'确认覆盖'},{status:409}):Response.json({ok:true});});
 assert.equal(calls[1].confirmedOwnerId,7);assert.equal(calls[1].ownerConfirmations['3'],7);assert.equal(calls[1].responsibleUserId,undefined);
});
function fixture({failComplete=false,failSecondWrite=false}={}){
 const data=new Map([['a.xlsx',Buffer.from('old a')],['b.xlsx',Buffer.from('old b')]]);const calls=[];let writes=0;
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const files=[...data].map(([filename,bytes])=>({filename,backup_filename:filename+'.backup',beforeHash:hash(bytes),afterHash:hash(Buffer.from('new '+filename)),backup_base64:bytes.toString('base64'),content_base64:Buffer.from('new '+filename).toString('base64')}));
 const handle={getFileHandle:async(name,options)=>{if(!data.has(name)&&!options?.create)throw new Error('missing file');return {getFile:async()=>new File([data.get(name)],name),createWritable:async()=>{let pending;return {write:async value=>{pending=Buffer.from(value);},close:async()=>{if(name==='b.xlsx'&&failSecondWrite)throw new Error('disk failure');if(!name.endsWith('.backup'))writes++;data.set(name,pending);}};}};}};
 const api=load('lib/inventory-writeback.ts',{window:{confirm:()=>true},fetch:async(path)=>{calls.push(path);if(path.endsWith('/local-files/writeback'))return Response.json({operationId:'op',files,updated_rows:2});if(path.endsWith('/complete')&&failComplete){failComplete=false;throw new Error('network failure');}return Response.json({ok:true});}});
 return {api,data,files,handle,calls,get writes(){return writes;}};
}
test('文件已写入但完成请求断线：恢复只补状态，不再写文件',async()=>{
 const f=fixture({failComplete:true});await assert.rejects(f.api.runInventoryWriteback(f.handle,[],[1]),/network failure/);assert.equal(f.writes,2);
 const message=await f.api.recoverInventoryWriteback(f.handle,{operationId:'op',state:'Writing',result:{files:f.files}});assert.match(message,/未再次扣减/);assert.equal(f.writes,2);assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,2);
});
test('只写入部分文件时保留待核对，不补完成或重扣',async()=>{
 const f=fixture({failSecondWrite:true});await assert.rejects(f.api.runInventoryWriteback(f.handle,[],[1]),/disk failure/);assert.equal(f.writes,1);
 await assert.rejects(f.api.recoverInventoryWriteback(f.handle,{operationId:'op',state:'Writing',result:{files:f.files}}),/人工核对/);assert.equal(f.writes,1);assert.ok(!f.calls.some(p=>p.endsWith('/complete')));
});
test('未写入方案可取消；原文件已变化时停止回写',async()=>{
 const f=fixture();await f.api.recoverInventoryWriteback(f.handle,{operationId:'op',state:'Prepared',result:{files:f.files}});assert.equal(f.writes,0);assert.ok(f.calls.some(p=>p.endsWith('/cancel')));
 f.data.set('a.xlsx',Buffer.from('changed by another user'));await assert.rejects(f.api.runInventoryWriteback(f.handle,[],[1]),/其他人修改/);assert.equal(f.writes,0);assert.ok(!f.calls.some(p=>p.endsWith('/writing')));
});

test('写入前文件已全部恢复时，必须人工确认才能解除Writing记录',async()=>{
 const f=fixture();const message=await f.api.recoverInventoryWriteback(f.handle,{operationId:'op',state:'Writing',result:{files:f.files}});
 assert.match(message,/人工核对/);assert.equal(f.writes,0);assert.ok(f.calls.some(path=>path.endsWith('/rollback')));
});

test('无请求体的单封邮件确认也可确认他人任务覆盖提示',async()=>{
 const {taskMutation}=load('lib/task-mutation.ts',{Headers,window:{confirm:()=>true}});let count=0;
 await taskMutation('/api/mail/candidates/3/confirm',{method:'POST'},async(_,options)=>{count++;if(count===1)return Response.json({code:'OtherTaskOwner',ownerId:7,taskId:3,error:'确认覆盖'},{status:409});assert.equal(new Headers(options.headers).get('content-type'),'application/json');assert.equal(JSON.parse(options.body).ownerConfirmations['3'],7);return Response.json({ok:true});});
 assert.equal(count,2);
});
