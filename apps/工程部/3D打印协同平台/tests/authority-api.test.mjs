import {fileURLToPath} from 'node:url';import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import core from '../shared/business-sync.cjs';
const root=fileURLToPath(new URL('..',import.meta.url)),delay=ms=>new Promise(r=>setTimeout(r,ms));
test('authority HTTP API gates cutover, blocks old writes and only exposes confirmed command outcomes',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'printlink-business-api-')),port=35000+Math.floor(Math.random()*2000),base=`http://127.0.0.1:${port}`;
 const source={products:[{id:1,name:'眼睛'}],inventory:{PETG:{stockG:1000}},records:{}};
 writeFileSync(path.join(dir,'production-source.json'),JSON.stringify(source));
 const token='a'.repeat(40),other='b'.repeat(40);let logs='';
 const child=spawn(process.execPath,['start.mjs','--cloud-only'],{cwd:root,env:{...process.env,APP_MODE:'production',PLATFORM_DATA_DIR:dir,PORT:String(port),PRODUCTION_PORT:String(port+2500),ADMIN_PASSWORD:'sync-test-password',COOKIE_SECURE:'false',BUSINESS_SYNC_STATION:'qingxi',COLLECTOR_STATIONS:JSON.stringify([{id:'qingxi',name:'清溪',factories:['清溪'],machines:['101'],token},{id:'other',name:'其他站',factories:['湖南'],machines:['201'],token:other}])},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 async function request(route,{data,headers={},method}={}){const r=await fetch(base+route,{method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
  const remote=core.project(source),clientId='11111111-1111-1111-1111-111111111111';
  const exchange=(extra={})=>request('/api/collector/business-sync',{headers:{Authorization:'Bearer '+token},data:{authority:1,clientId,remote,receipts:[],...extra}});
  assert.equal((await request('/api/platform/authority')).status,401);
  assert.equal((await request('/api/collector/business-sync',{headers:{Authorization:'Bearer '+other},data:{authority:1,clientId,remote}})).status,403);
  assert.equal((await exchange()).data.mode,'migration');
  const login=await request('/api/login',{data:{username:'admin',password:'sync-test-password'}});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};
  const enable={action:'authority-enable',expected:core.fingerprint(remote)};
  assert.equal((await request('/api/platform/authority',{headers:{Cookie:headers.Cookie},data:enable})).status,403);
  assert.equal((await request('/api/platform/authority',{headers,data:enable})).status,200);
  assert.equal((await request('/api/production/data',{headers,data:source})).status,409);
  assert.equal((await request('/api/production/legacy-import/apply',{headers,data:{data:source}})).status,409);
  const command={id:'request-stock',collection:'inventory',key:'PETG',operation:'stock',delta:-61,expected:core.fingerprint({value:remote.inventory.PETG}),reason:'真实领料'};
  assert.equal((await request('/api/platform/authority',{headers,data:{action:'authority-submit',command}})).status,200);
  assert.equal((await request('/api/production/data',{headers})).data.inventory.PETG.stockG,1000);
  const pending=await exchange();assert.equal(pending.data.commands[0].id,command.id);
  remote.inventory.PETG.stockG=939;
  const receipt={id:command.id,request:core.fingerprint(command),status:'applied',result:{key:'PETG'}};
  assert.equal((await exchange({receipts:[receipt]})).data.commands.length,0);
  assert.equal((await request('/api/production/data',{headers})).data.inventory.PETG.stockG,939);
  const status=(await request('/api/platform/authority',{headers})).data;assert.equal(status.enabled,true);assert.equal(status.commands[0].status,'applied');
  assert.equal((await request('/api/platform/authority',{headers,data:{action:'authority-exchange',remote}})).status,400);
  assert.equal((await request('/api/collector/business-sync',{headers:{Authorization:'Bearer '+token},data:{clientId,remote}})).status,400);

 }finally{child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));rmSync(dir,{recursive:true,force:true});}
});
