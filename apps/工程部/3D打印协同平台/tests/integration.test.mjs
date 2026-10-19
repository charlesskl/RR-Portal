import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once,EventEmitter} from 'node:events';import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';import {randomUUID,createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const exited=p=>p.exitCode!==null||p.signalCode!==null;
function stopChild(p,{termMs=1500,killMs=1000}={}){
 if(!p||exited(p))return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let termTimer,deadline,settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(termTimer);clearTimeout(deadline);p.removeListener('exit',onExit);p.removeListener('error',onError);if(error)reject(error);else resolve();};
  const onExit=()=>finish(),onError=error=>finish(error);
  p.once('exit',onExit);p.once('error',onError);
  if(exited(p)){finish();return;}
  termTimer=setTimeout(()=>{try{p.kill('SIGKILL');}catch(error){finish(error);}},termMs);
  deadline=setTimeout(()=>finish(Error('Fixture child did not exit after SIGTERM and SIGKILL')),termMs+killMs);
  try{if(!p.kill('SIGTERM')&&exited(p))finish();}catch(error){finish(error);}
 });
}
async function cleanupFixture(children,dir,primaryError,report=()=>{},options){
 const results=await Promise.allSettled(children.map(child=>stopChild(child,options))),errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
 if(!errors.length)try{await rm(dir,{recursive:true,force:true});}catch(error){errors.push(error);}
 if(errors.length){
  if(primaryError){primaryError.cleanupErrors=errors;report('Fixture cleanup also failed: '+errors.map(e=>e.message).join('; '));}
  else throw new AggregateError(errors,'Fixture cleanup failed');
 }
}
for(const scenario of [{stock:1000,batches:1},{stock:1000,batches:2},{stock:35,batches:1},{stock:35,batches:2}])test(`cloud production integration: permissions, scheduling, quality, restart; stock=${scenario.stock}, prepaid batches=${scenario.batches}`,async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'printlink-integrated-'));const port=33100+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;let processHandle,collector,primaryError,logs='';
 async function launch(){
  let spawnError;const child=spawn(process.execPath,['start.mjs','--cloud-only'],{cwd:root,env:{...process.env,APP_MODE:'production',PLATFORM_DATA_DIR:dir,PORT:String(port),PRODUCTION_PORT:String(port+600),ADMIN_PASSWORD:'test-secret-123',COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});processHandle=child;
  child.once('error',error=>{spawnError=error;});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  const deadline=Date.now()+10000;
  const checkExit=()=>{if(spawnError||exited(child))throw Error('Fixture exited before ready: '+(spawnError?.message||String(child.exitCode??child.signalCode))+'\n'+logs);};
  for(let i=0;i<80&&Date.now()<deadline;i++){
   checkExit();let healthy=false;
   try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});healthy=response.ok;await response.arrayBuffer();}catch{}
   if(healthy){await delay(200);checkExit();return;}await delay(100);
  }
  checkExit();throw Error('Fixture startup timed out\n'+logs);
 }
 async function stop(){const p=processHandle;await stopChild(p);if(processHandle===p)processHandle=null;}
 async function request(route,{auth,data,method,token}={}){const r=await fetch(base+route,{signal:AbortSignal.timeout(30000),method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body,headers:r.headers};}
 async function login(username='admin'){const r=await request('/api/login',{data:{username,password:username==='admin'?'test-secret-123':'member123'}});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.body.csrf};}
 try{
  await writeFile(path.join(dir,'production-source.json'),JSON.stringify({settings:null,products:[{id:'test-product',name:'测试产品',image:'data:image/png;base64,aGVsbG8='}],materials:[{id:'test-material',name:'PLA'}],inventory:{PLA:{stockG:scenario.stock}},records:{},schedules:[],maintenance:[],stockInLogs:[],miscExpenses:[]}));
  await launch();let admin=await login();const secrets=JSON.parse(await readFile(path.join(dir,'secrets.json'),'utf8')),token=secrets.collector;
  assert.equal((await request('/api/platform/overview')).status,401);
  assert.equal((await request('/api/collector/jobs',{token:'wrong'})).status,401);
  assert.equal((await request('/api/users',{auth:admin,data:{username:'member',name:'测试成员',password:'member123',role:'member',factory:'清溪',factories:['清溪']}})).status,201);
  const member=await login('member');assert.equal((await request('/api/platform/overview',{auth:member})).status,403);assert.equal((await request('/production/',{auth:member})).status,403);
  const legacySource={settings:null,products:[{id:'import-product',name:'历史产品'}],materials:[],inventory:{},records:{'2026-09-01':{off:false,items:[{_id:'import-record',machine:1,qty:2}]}},schedules:[],maintenance:[],stockInLogs:[],miscExpenses:[]};
  assert.equal((await request('/api/production/legacy-import/preview',{auth:member,data:{data:legacySource}})).status,403);
  const preview=await request('/api/production/legacy-import/preview',{auth:admin,data:{data:legacySource}});assert.equal(preview.status,200);assert.deepEqual(preview.body.conflicts,[]);
  assert.equal((await request('/api/production/legacy-import/apply',{auth:admin,data:{data:legacySource,fingerprint:'stale'}})).status,409);
  const imported=await request('/api/production/legacy-import/apply',{auth:admin,data:{data:legacySource,fingerprint:preview.body.fingerprint}});assert.equal(imported.status,200);assert.ok(imported.body.backupId);
  for(let refresh=0;refresh<3;refresh++){
   const r=await fetch(base+'/api/production/data',{signal:AbortSignal.timeout(30000),headers:{Cookie:admin.cookie,'Accept-Encoding':'gzip'}});
   assert.equal(r.headers.get('content-encoding'),'gzip');assert.equal((await r.json()).records['2026-09-01'].items.length,1);
  }
  const plain=await fetch(base+'/api/production/data',{signal:AbortSignal.timeout(30000),headers:{Cookie:admin.cookie,'Accept-Encoding':'identity'}});
  assert.equal(plain.headers.get('content-encoding'),null);assert.equal((await plain.json()).products.length,2);
  const compactData=await request('/api/production/data?view=compact',{auth:admin});
  assert.equal(compactData.headers.get('content-encoding'),'gzip');
  const picture=compactData.body.products[0].image;
  assert.ok(picture.startsWith('/api/production/data-images/'));
  assert.equal((await request(picture)).status,401);
  assert.equal((await request(picture,{auth:member})).status,403);
  const image=await request(picture,{auth:admin});assert.equal(image.body,'hello');assert.equal(image.headers.get('content-type'),'image/png');
  const verifyImport=(await request('/api/production/data',{auth:admin})).body;assert.equal(verifyImport.records['2026-09-01'].items.length,1);
  const again=await request('/api/production/legacy-import/preview',{auth:admin,data:{data:legacySource}});assert.equal(again.body.summary.after.products,2);
  assert.equal((await request('/api/production/legacy-import/apply',{auth:admin,data:{data:legacySource,fingerprint:again.body.fingerprint}})).status,200);
  const snapDB=new DatabaseSync(path.join(dir,'production.sqlite'));assert.ok(snapDB.prepare('SELECT value FROM import_backups WHERE id=?').get(imported.body.backupId));snapDB.close();
  const upload=await fetch(base+'/api/uploads',{signal:AbortSignal.timeout(30000),method:'POST',headers:{Cookie:member.cookie,'X-CSRF-Token':member.csrf,'X-File-Name':'test.stl'},body:'solid test\nendsolid test'});assert.equal(upload.status,201);const file=await upload.json();
  const input={factory:'清溪',workshop:'A',customer:'测试',sku:'INTEGRATION',product:'整合测试件',quantity:2,material:'PLA',color:'白色',dueDate:'2026-12-01',engineer:'测试',follower:'测试',fileIds:[file.id]};
  const created=await request('/api/orders',{auth:member,data:input});assert.equal(created.status,201,JSON.stringify(created.body));const orderId=created.body.id;
  const sourceCatalog=(await request('/api/platform/catalog',{auth:admin})).body;
  assert.equal(sourceCatalog.products[0].image,undefined,'scheduling selector does not download full product images');
  const assigned=await request('/api/platform/jobs',{auth:admin,data:{orderId,machineNumber:1,date:'2026-11-30',weight:12,productId:sourceCatalog.products[0].id,materialId:sourceCatalog.materials[0].id}});assert.equal(assigned.status,201,JSON.stringify(assigned.body));const id=assigned.body.id;
  assert.equal((await request('/api/platform/jobs',{auth:admin,data:{orderId,machineNumber:2,date:'2026-11-30',weight:12}})).status,409);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'simulate',state:'FINISH'}})).status,403);
  assert.equal((await request('/api/orders/'+orderId,{auth:admin,method:'PATCH',data:{status:'打印中'}})).status,409);
  let legacy=await request('/api/production/data',{auth:admin});assert.equal(legacy.status,200);assert.equal(legacy.body.products.length,2);const linked=legacy.body.schedules.find(x=>x.cloudJobId===id);assert.ok(linked);assert.equal(linked.orderId,orderId);assert.equal(linked.orderNumber,created.body.number);assert.equal((await request('/api/orders',{auth:member})).body.find(o=>o.id===orderId).production.id,id);assert.equal(linked.productName,sourceCatalog.products[0].name);assert.equal(linked.material,sourceCatalog.materials[0].name);
  assert.equal((await request('/api/production/module/save',{auth:admin,data:{module:'schedule',id:linked.id,record:{status:'done'}}})).status,400);
  assert.equal((await request('/api/production/printers/1/rescan',{auth:admin,data:{}})).status,403);
  assert.equal((await request('/api/collector/events',{token,data:{id:randomUUID(),sequence:1,observedAt:new Date().toISOString(),devices:[{machine:'999',connected:true,state:'IDLE',progress:0}]}})).status,400);
  assert.equal((await request('/api/collector/events',{token,data:{id:randomUUID(),sequence:1,observedAt:new Date().toISOString(),devices:[{machine:'1',connected:true,state:'IDLE',progress:0,sourceMachine:'14',gcodeFile:'test.3mf',nozzleTemp:215,remainingTime:12,accessCode:'must-not-forward'}]}})).status,200);
  assert.equal((await request('/api/production/printers',{auth:admin})).body['1'].connected,true);
  const device=(await request('/api/production/printers',{auth:admin})).body['1'];assert.equal(device.sourceMachine,'14');assert.equal(device.gcodeFile,'test.3mf');assert.equal(device.nozzleTemp,215);assert.equal(device.accessCode,undefined);
  const overview=async()=> (await request('/api/platform/overview',{auth:admin})).body;
  const emit=(sequence,state,extra={})=>request('/api/collector/events',{token,data:{id:randomUUID(),jobId:id,machine:'1',attempt:1,sequence,state,progress:state==='FINISH'?100:45,observedAt:new Date().toISOString(),...extra}});
  assert.equal((await emit(1,'FINISH')).status,200);assert.equal((await overview()).jobs[0].status,'待打印','finish without start must not finish unrelated job');
  assert.equal((await emit(2,'RUNNING',{machine:'2'})).status,403);
  assert.equal((await emit(3,'RUNNING',{observedAt:new Date(Date.now()-300000).toISOString()})).status,200);assert.equal((await overview()).jobs[0].status,'待打印','stale state cannot advance');
  assert.equal((await emit(4,'RUNNING')).status,200);assert.equal((await overview()).jobs[0].status,'打印中');
  const eventId=randomUUID();await emit(5,'FINISH',{id:eventId});assert.equal((await emit(5,'FINISH',{id:eventId})).body.duplicate,true);assert.equal((await overview()).jobs[0].status,'待交付');
  assert.equal((await request('/api/orders',{auth:member})).body.find(o=>o.id===orderId).status,'待交付','confirmed completion automatically advances the order before quality');

  assert.equal((await request('/api/orders/'+orderId,{auth:admin,method:'PATCH',data:{status:'已完成',follower:'测试',replyDate:'2026-11-30'}})).status,409,'order workbench cannot bypass quality');
  await emit(2,'FAILED');assert.equal((await overview()).jobs[0].status,'待交付');
  await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'retry'}});await emit(8,'FINISH');assert.equal((await overview()).jobs[0].status,'待打印','old attempt ignored');
  assert.equal((await request('/api/orders',{auth:member})).body.find(o=>o.id===orderId).status,'待排产','retry reopens scheduling');
  await emit(9,'RUNNING',{attempt:2});
  const confirm={action:'confirm-finish',attempt:2,notes:'现场已确认机台及本轮订单全部打印完成'};
  assert.equal((await request('/api/platform/jobs/'+id,{auth:member,method:'PATCH',data:confirm})).status,403);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{...confirm,notes:''}})).status,400);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{...confirm,attempt:1}})).status,409);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:confirm})).status,200);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:confirm})).status,409);
  assert.equal((await request('/api/orders',{auth:member})).body.find(o=>o.id===orderId).status,'待交付');
  await emit(10,'FINISH',{attempt:2});assert.equal((await overview()).jobs[0].status,'待交付');
  assert.equal((await request('/api/platform/jobs/'+id,{auth:member,method:'PATCH',data:{action:'quality'}})).status,403);
  const cat=(await request('/api/platform/catalog',{auth:admin})).body;const material=cat.materials.find(m=>m.stockG>=24);assert.ok(material);
  const sourceBatch={records:[{sourceId:'local-print-1',attempt:2,sourceMachine:'1',machine:'1',date:'2026-10-09',jobId:id,record:{productName:'测试产品',autoRecord:true,status:'running',printStartTime:new Date().toISOString(),qty:1,time:0}}]};
  assert.equal((await request('/api/collector/records',{token:'wrong',data:sourceBatch})).status,401);
  assert.equal((await request('/api/collector/records',{token,data:{records:[{...sourceBatch.records[0],machine:'9999'}]}})).status,400);
  const unbound={records:[{...sourceBatch.records[0],jobId:undefined,record:{...sourceBatch.records[0].record,material:material.name,weight:10,qty:2}}]};
  for(let n=0;n<2;n++)assert.equal((await request('/api/collector/records',{token,data:unbound})).status,200);
  assert.equal((await request('/api/production/data',{auth:admin})).body.inventory[material.name].stockG,material.stockG-20,'unbound auto record charges only once before later task binding');
  let prepaid=20;
  if(scenario.batches===2){
   const extra={records:[{...unbound.records[0],sourceId:'local-print-extra',record:{...unbound.records[0].record,weight:5}}]};
   assert.equal((await request('/api/collector/records',{token,data:extra})).status,200);
   assert.equal((await request('/api/collector/records',{token,data:{records:[{...extra.records[0],jobId:id}]}})).status,200);
   prepaid+=10;
  }
  assert.equal((await request('/api/collector/records',{token,data:sourceBatch})).status,200);
  assert.equal((await request('/api/collector/records',{token,data:sourceBatch})).status,200);
  const beforeQuality=(await request('/api/production/data',{auth:admin})).body;
  assert.equal(Object.values(beforeQuality.records).flatMap(d=>d.items||[]).filter(i=>i.cloudJobId===id).length,scenario.batches);
  assert.equal(beforeQuality.inventory[material.name].stockG,material.stockG-prepaid);
  const quality={action:'quality',totalWeight:24,actualHours:1.5,price:0,notes:'尺寸与表面检查合格',materialId:material.id};
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'quality'}})).status,400);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{...quality,totalWeight:material.stockG+1}})).status,409);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:quality})).status,200);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:quality})).status,409);
  for(let n=0;n<2;n++)assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'resync'}})).status,200);
  // A later source batch from the same attempt must not debit inventory again.
  const lateBatch={records:[{...sourceBatch.records[0],sourceId:'local-print-late',record:{...sourceBatch.records[0].record,printStartTime:new Date(Date.parse(sourceBatch.records[0].record.printStartTime)+1000).toISOString()}}]};
  assert.equal((await request('/api/collector/records',{token,data:lateBatch})).status,200);
  for(let n=0;n<2;n++)assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'resync'}})).status,200);
  const records=(await request('/api/production/data',{auth:admin})).body;
  assert.equal(records.inventory[material.name].stockG,material.stockG-24);
  const attemptRecords=Object.values(records.records).flatMap(d=>d.items||[]).filter(i=>i.cloudJobId===id);
  assert.equal(attemptRecords.length,scenario.batches+1);
  assert.equal(attemptRecords.filter(i=>i.inventoryReview===false).length,scenario.batches);
  assert.equal(attemptRecords.filter(i=>i.inventoryReview===true).length,1);
  // A prepaid batch linked after settlement refunds its debit without charging quality again.
  const latePaid={records:[{...unbound.records[0],sourceId:'local-print-late-paid',record:{...unbound.records[0].record,weight:1,qty:1}}]};
  assert.equal((await request('/api/collector/records',{token,data:latePaid})).status,200);
  assert.equal((await request('/api/production/data',{auth:admin})).body.inventory[material.name].stockG,material.stockG-25);
  assert.equal((await request('/api/collector/records',{token,data:{records:[{...latePaid.records[0],jobId:id}]}})).status,200);
  for(let n=0;n<2;n++)assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'resync'}})).status,200);
  assert.equal((await request('/api/production/data',{auth:admin})).body.inventory[material.name].stockG,material.stockG-24);

  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'deliver',notes:'测试接收人签收 2 件'}})).status,200);
  const orders=(await request('/api/orders',{auth:member})).body;assert.equal(orders[0].status,'已完成');
  await stop();await launch();admin=await login();assert.equal((await overview()).jobs[0].status,'待交付');
  assert.equal((await request('/api/orders',{auth:admin})).body.find(o=>o.id===orderId).status,'已完成','startup reconciliation preserves delivered orders');
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'resync'}})).status,200);
  assert.equal((await request('/api/production/data',{auth:admin})).body.inventory[material.name].stockG,material.stockG-24,'restart and late-batch retries must preserve the single inventory debit');
  // An order manually marked as printing can be explicitly linked without regression.
  const extraUpload=await fetch(base+'/api/uploads',{signal:AbortSignal.timeout(30000),method:'POST',headers:{Cookie:admin.cookie,'X-CSRF-Token':admin.csrf,'X-File-Name':'link.stl'},body:'solid link\nendsolid link'});
  assert.equal(extraUpload.status,201);const extraFile=await extraUpload.json();
  const extraOrder=await request('/api/orders',{auth:admin,data:{...input,fileIds:[extraFile.id]}});assert.equal(extraOrder.status,201);
  for(const status of ['待排产','打印中'])assert.equal((await request('/api/orders/'+extraOrder.body.id,{auth:admin,method:'PATCH',data:{status,follower:'测试',replyDate:'2026-11-30'}})).status,200);
  assert.ok((await overview()).orders.some(o=>o.id===extraOrder.body.id));
  const linkBody={orderId:extraOrder.body.id,machineNumber:2,date:'2026-11-30',weight:12};
  assert.equal((await request('/api/platform/jobs',{auth:member,data:linkBody})).status,403);
  const extraJob=await request('/api/platform/jobs',{auth:admin,data:linkBody});assert.equal(extraJob.status,201,JSON.stringify(extraJob.body));
  const linkedOrder=(await request('/api/orders',{auth:admin})).body.find(o=>o.id===extraOrder.body.id);
  assert.equal(linkedOrder.status,'打印中');assert.equal(linkedOrder.production.status,'打印中');
  const extraSchedule=(await request('/api/production/data',{auth:admin})).body.schedules.find(x=>x.orderId===extraOrder.body.id);
  assert.equal(extraSchedule.status,'printing');assert.equal(extraSchedule.orderNumber,extraOrder.body.number);
  assert.equal((await request('/api/platform/jobs',{auth:admin,data:linkBody})).status,409);
  // A manually linked printing order has no bound device completion: confirm only its current attempt.
  const manual={action:'confirm-finish',attempt:1,notes:'现场确认机台 2 已完成本轮 2 件'};
  const manualRoute='/api/platform/jobs/'+extraJob.body.id;
  const beforeManual=(await request('/api/production/data',{auth:admin})).body;
  for(const invalid of [{attempt:undefined},{attempt:'1'},{notes:' '.repeat(3)},{notes:'x'.repeat(2001)}]){
   assert.equal((await request(manualRoute,{auth:admin,method:'PATCH',data:{...manual,...invalid}})).status,'notes' in invalid?400:409);
  }
  const manualDB=new DatabaseSync(path.join(dir,'orders/printlink.sqlite'));
  try{
   manualDB.prepare("UPDATE orders SET status='待交付' WHERE id=?").run(extraOrder.body.id);
   assert.equal((await request(manualRoute,{auth:admin,method:'PATCH',data:manual})).status,409);
   manualDB.prepare("UPDATE orders SET status='打印中' WHERE id=?").run(extraOrder.body.id);
   manualDB.exec("CREATE TRIGGER reject_manual_audit BEFORE INSERT ON events WHEN NEW.text LIKE '%手动确认打印完成%' BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
   assert.equal((await request(manualRoute,{auth:admin,method:'PATCH',data:manual})).status,500);
   assert.equal(manualDB.prepare('SELECT status FROM production_jobs WHERE id=?').get(extraJob.body.id).status,'打印中');
   assert.equal(manualDB.prepare('SELECT status FROM orders WHERE id=?').get(extraOrder.body.id).status,'打印中');
   manualDB.exec('DROP TRIGGER reject_manual_audit');
  }finally{manualDB.close();}
  const concurrent=await Promise.all([request(manualRoute,{auth:admin,method:'PATCH',data:manual}),request(manualRoute,{auth:admin,method:'PATCH',data:manual})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const manuallyFinished=(await overview()).jobs.find(j=>j.id===extraJob.body.id);
  assert.equal(manuallyFinished.status,'待交付');assert.equal(manuallyFinished.orderStatus,'待交付');
  assert.equal(manuallyFinished.sequence,0);assert.equal(manuallyFinished.requestedState,'IDLE');assert.equal(manuallyFinished.quality,undefined);
  assert.equal(manuallyFinished.events.filter(e=>e.text.includes('手动确认打印完成')).length,1);
  const confirmingAdmin=(await request('/api/me',{auth:admin})).body.user.name;
  assert.ok(manuallyFinished.events.some(e=>e.text.includes('管理员 '+confirmingAdmin)&&e.text.includes(manual.notes)));
  const afterManual=(await request('/api/production/data',{auth:admin})).body;
  assert.deepEqual(afterManual.inventory,beforeManual.inventory);assert.deepEqual(afterManual.records,beforeManual.records);
  // Bound collector batches settle inventory without creating a legacy quality record.
  const automatic={records:[{sourceId:'linked-auto-without-quality',sourceMachine:'2',machine:'2',date:'2026-10-10',jobId:extraJob.body.id,attempt:1,record:{productName:'无质检自动采集',autoRecord:true,status:'running',printStartTime:new Date().toISOString(),material:material.name,weight:2,qty:2,time:1}}]};
  for(let n=0;n<2;n++)assert.equal((await request('/api/collector/records',{token,data:automatic})).status,200);
  const autoData=(await request('/api/production/data',{auth:admin})).body;
  assert.equal(autoData.inventory[material.name].stockG,afterManual.inventory[material.name].stockG-4);
  const autoRows=Object.values(autoData.records).flatMap(day=>day.items).filter(item=>item.cloudJobId===extraJob.body.id);
  assert.equal(autoRows.length,1);assert.equal(autoRows[0].inventoryDeduction.grams,4);
  assert.equal(autoRows[0].qualitySettled,undefined);

  assert.equal((await request('/api/orders/'+extraOrder.body.id,{auth:admin,method:'PATCH',data:{status:'已完成',follower:'测试',replyDate:'2026-11-30'}})).status,409);
  assert.equal((await request('/api/orders/'+extraOrder.body.id,{auth:admin,method:'PATCH',data:{status:'待交付',follower:'新的跟进人',replyDate:'2026-12-02'}})).status,200,'linked order metadata remains editable');
  assert.equal((await request('/api/orders',{auth:admin})).body.find(o=>o.id===orderId).status,'已完成','same-name products do not link unrelated orders');
  assert.equal((await request(manualRoute,{auth:admin,method:'PATCH',data:{action:'deliver',notes:'无需质检直接交付，现场签收'}})).status,200);
  assert.equal((await request('/api/orders',{auth:admin})).body.find(o=>o.id===extraOrder.body.id).status,'已完成');
  assert.equal((await request('/api/collector/records',{token,data:automatic})).status,200);
  assert.equal((await request(manualRoute,{auth:admin,method:'PATCH',data:{action:'resync'}})).status,200);
  assert.equal((await request('/api/production/data',{auth:admin})).body.inventory[material.name].stockG,autoData.inventory[material.name].stockG,'delivery and collector replay must not debit twice');
  // A persisted outbox created while offline must replay and be cleared by the real agent process.
  const agentDir=path.join(dir,'agent');await mkdir(agentDir);const q=new DatabaseSync(path.join(agentDir,'outbox.sqlite'));q.exec('CREATE TABLE outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL)');const replay=randomUUID();q.prepare('INSERT INTO outbox(payload) VALUES (?)').run(JSON.stringify({id:replay,observedAt:new Date().toISOString()}));q.close();
  const conf=path.join(dir,'collector-test.json');await writeFile(conf,JSON.stringify({mode:'simulation',cloudUrl:base,token}));
  collector=spawn(process.execPath,['collector/agent.mjs'],{cwd:root,env:{...process.env,COLLECTOR_CONFIG:conf,COLLECTOR_DATA_DIR:agentDir},stdio:'ignore'});
  for(let i=0;i<40;i++){const database=new DatabaseSync(path.join(dir,'orders/printlink.sqlite'));const done=database.prepare('SELECT id FROM collector_events WHERE id=?').get(replay);database.close();if(done)break;await delay(150);}
  const check=new DatabaseSync(path.join(dir,'orders/printlink.sqlite'));assert.ok(check.prepare('SELECT id FROM collector_events WHERE id=?').get(replay));check.close();
 }catch(error){primaryError=error;throw error;}finally{await cleanupFixture([collector,processHandle],dir,primaryError,message=>t.diagnostic(message));}
});
test('vendored scripts match original SRI hashes',async()=>{for(const [file,expected]of [['chart.js','9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4'],['xlsx.js','OUW9euuUyxyHcAhTqbhI+Iyb8LMssXt/cpz0yXhs9UWG2/R/uaWdakx/4cfww7Vb']])assert.equal(createHash('sha384').update(await readFile(path.join(root,'production',file))).digest('base64'),expected);});

test('integration fixture cleanup handles exited, live and SIGTERM-resistant children',async t=>{
 const children=[],dir=await mkdtemp(path.join(tmpdir(),'printlink-child-cleanup-'));let primaryError;
 try{
  const done=spawn(process.execPath,['-e','process.exit(7)'],{stdio:'ignore'});children.push(done);await once(done,'exit',{signal:AbortSignal.timeout(3000)});await stopChild(done);assert.equal(done.exitCode,7);
  const live=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});children.push(live);await once(live,'spawn',{signal:AbortSignal.timeout(3000)});await stopChild(live);assert.equal(live.signalCode,'SIGTERM');
  const resistant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});children.push(resistant);
  await once(resistant.stdout,'data',{signal:AbortSignal.timeout(3000)});await stopChild(resistant,{termMs:100,killMs:1000});assert.equal(resistant.signalCode,'SIGKILL');
  for(const p of children){assert.equal(p.listenerCount('exit'),0);assert.equal(p.listenerCount('error'),0);}
 }catch(error){primaryError=error;throw error;}finally{await cleanupFixture(children,dir,primaryError,message=>t.diagnostic(message),{termMs:100,killMs:1000});}
});
test('integration fixture cleanup has a hard deadline and preserves the original failure',async()=>{
 const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,kill:()=>false}),primary=new Error('original fixture failure'),diagnostics=[];
 const dir=await mkdtemp(path.join(tmpdir(),'printlink-cleanup-proof-'));
 try{
  await assert.rejects(async()=>{try{throw primary;}finally{await cleanupFixture([child],dir,primary,message=>diagnostics.push(message),{termMs:10,killMs:10});}},error=>error===primary);
  assert.equal(primary.cleanupErrors.length,1);assert.match(primary.cleanupErrors[0].message,/SIGTERM and SIGKILL/);assert.equal(diagnostics.length,1);
  assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
  await assert.rejects(cleanupFixture([child],dir,null,()=>{},{termMs:10,killMs:10}),/Fixture cleanup failed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
