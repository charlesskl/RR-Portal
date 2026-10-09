import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';import {randomUUID,createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('cloud production integration: permissions, scheduling, telemetry replay, quality gate, durable collector and restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'printlink-integrated-'));const port=33100+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;let processHandle,collector,logs='';
 async function launch(){processHandle=spawn(process.execPath,['start.mjs','--cloud-only'],{cwd:root,env:{...process.env,APP_MODE:'production',PLATFORM_DATA_DIR:dir,PORT:String(port),PRODUCTION_PORT:String(port+600),ADMIN_PASSWORD:'test-secret-123',COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});processHandle.stdout.on('data',x=>logs+=x);processHandle.stderr.on('data',x=>logs+=x);for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){await delay(200);return;}}catch{}await delay(100);}throw Error(logs);}
 async function stop(){if(processHandle){const p=processHandle;processHandle=null;p.kill('SIGTERM');await new Promise(r=>p.once('exit',r));}}
 async function request(route,{auth,data,method,token}={}){const r=await fetch(base+route,{method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body,headers:r.headers};}
 async function login(username='admin'){const r=await request('/api/login',{data:{username,password:username==='admin'?'test-secret-123':'member123'}});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.body.csrf};}
 try{
  await writeFile(path.join(dir,'production-source.json'),JSON.stringify({settings:null,products:[{id:'test-product',name:'测试产品',image:'data:image/png;base64,aGVsbG8='}],materials:[{id:'test-material',name:'PLA'}],inventory:{PLA:{stockG:1000}},records:{},schedules:[],maintenance:[],stockInLogs:[],miscExpenses:[]}));
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
   const r=await fetch(base+'/api/production/data',{headers:{Cookie:admin.cookie,'Accept-Encoding':'gzip'}});
   assert.equal(r.headers.get('content-encoding'),'gzip');assert.equal((await r.json()).records['2026-09-01'].items.length,1);
  }
  const plain=await fetch(base+'/api/production/data',{headers:{Cookie:admin.cookie,'Accept-Encoding':'identity'}});
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
  const upload=await fetch(base+'/api/uploads',{method:'POST',headers:{Cookie:member.cookie,'X-CSRF-Token':member.csrf,'X-File-Name':'test.stl'},body:'solid test\nendsolid test'});assert.equal(upload.status,201);const file=await upload.json();
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
  const eventId=randomUUID();await emit(5,'FINISH',{id:eventId});assert.equal((await emit(5,'FINISH',{id:eventId})).body.duplicate,true);assert.equal((await overview()).jobs[0].status,'待质检');
  await emit(2,'FAILED');assert.equal((await overview()).jobs[0].status,'待质检');
  await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'retry'}});await emit(8,'FINISH');assert.equal((await overview()).jobs[0].status,'待打印','old attempt ignored');
  await emit(9,'RUNNING',{attempt:2});await emit(10,'FINISH',{attempt:2});assert.equal((await overview()).jobs[0].status,'待质检');
  assert.equal((await request('/api/platform/jobs/'+id,{auth:member,method:'PATCH',data:{action:'quality'}})).status,403);
  const cat=(await request('/api/platform/catalog',{auth:admin})).body;const material=cat.materials.find(m=>m.stockG>=24);assert.ok(material);
  const quality={action:'quality',totalWeight:24,actualHours:1.5,price:0,notes:'尺寸与表面检查合格',materialId:material.id};
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'quality'}})).status,400);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{...quality,totalWeight:material.stockG+1}})).status,409);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:quality})).status,200);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:quality})).status,409);
  for(let n=0;n<2;n++)assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'resync'}})).status,200);
  const records=(await request('/api/production/data',{auth:admin})).body;
  assert.equal(records.inventory[material.name].stockG,material.stockG-24);
  assert.equal(Object.values(records.records).flatMap(d=>d.items||[]).filter(i=>i.cloudJobId===id).length,1);
  assert.equal((await request('/api/platform/jobs/'+id,{auth:admin,method:'PATCH',data:{action:'deliver',notes:'测试接收人签收 2 件'}})).status,200);
  const orders=(await request('/api/orders',{auth:member})).body;assert.equal(orders[0].status,'已完成');
  await stop();await launch();admin=await login();assert.equal((await overview()).jobs[0].status,'待交付');
  // An order manually marked as printing can be explicitly linked without regression.
  const extraUpload=await fetch(base+'/api/uploads',{method:'POST',headers:{Cookie:admin.cookie,'X-CSRF-Token':admin.csrf,'X-File-Name':'link.stl'},body:'solid link\nendsolid link'});
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
  assert.equal((await request('/api/orders',{auth:admin})).body.find(o=>o.id===orderId).status,'已完成','same-name products do not link unrelated orders');
  // A persisted outbox created while offline must replay and be cleared by the real agent process.
  const agentDir=path.join(dir,'agent');await mkdir(agentDir);const q=new DatabaseSync(path.join(agentDir,'outbox.sqlite'));q.exec('CREATE TABLE outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL)');const replay=randomUUID();q.prepare('INSERT INTO outbox(payload) VALUES (?)').run(JSON.stringify({id:replay,observedAt:new Date().toISOString()}));q.close();
  const conf=path.join(dir,'collector-test.json');await writeFile(conf,JSON.stringify({mode:'simulation',cloudUrl:base,token}));
  collector=spawn(process.execPath,['collector/agent.mjs'],{cwd:root,env:{...process.env,COLLECTOR_CONFIG:conf,COLLECTOR_DATA_DIR:agentDir},stdio:'ignore'});
  for(let i=0;i<40;i++){const database=new DatabaseSync(path.join(dir,'orders/printlink.sqlite'));const done=database.prepare('SELECT id FROM collector_events WHERE id=?').get(replay);database.close();if(done)break;await delay(150);}
  const check=new DatabaseSync(path.join(dir,'orders/printlink.sqlite'));assert.ok(check.prepare('SELECT id FROM collector_events WHERE id=?').get(replay));check.close();
 }finally{if(collector){collector.kill();await new Promise(r=>collector.once('exit',r));}await stop();await rm(dir,{recursive:true,force:true});}
});
test('vendored scripts match original SRI hashes',async()=>{for(const [file,expected]of [['chart.js','9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4'],['xlsx.js','OUW9euuUyxyHcAhTqbhI+Iyb8LMssXt/cpz0yXhs9UWG2/R/uaWdakx/4cfww7Vb']])assert.equal(createHash('sha384').update(await readFile(path.join(root,'production',file))).digest('base64'),expected);});
