import {randomUUID} from 'node:crypto';
import core from '../shared/business-sync.cjs';
// Advance the shared baseline only after Windows has durably acknowledged the CAS write.
export function startBusinessSync({config,db,call,autoStart=true}){
 db.exec('CREATE TABLE IF NOT EXISTS business_sync_base (id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS business_sync_client (id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
 db.prepare('INSERT OR IGNORE INTO business_sync_client VALUES (1,?)').run(randomUUID());
 const clientId=db.prepare('SELECT value FROM business_sync_client WHERE id=1').get().value;
 let busy=false,lastSuccess=null,error='',uploaded=0,mode='migration';
 const headers={Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64'),'Content-Type':'application/json'};
 async function local(payload){
  const r=await fetch(new URL('/api/business-sync',config.url),{method:payload?'POST':'GET',headers,body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'原系统双向同步接口不可用 '+r.status);return data;
 }
 async function tick(){if(busy)return;busy=true;try{
  const remote=await local();
  if(remote.authorityProtocol===1){
   const exchange=await call('/api/collector/business-sync',{authority:1,clientId,remote:remote.data,receipts:remote.receipts||[]});
   if(exchange.mode==='authority'){
    mode='authority';
    if(!remote.authorityEnabled)await local({action:'authority-enable'});
    for(const raw of exchange.commands||[]){
     const command=structuredClone(raw);
     if(command.operation==='task'){
      const source=Object.entries(config.machineMap||{}).find(([,target])=>String(target)===String(command.value.machine))?.[0];
      // Preserve the request identity; the adapter receives the original request and an explicit mapping.
      await local({action:'command',command:raw,sourceMachine:source?Number(source):null});
     }else await local({action:'command',command});
    }
    // Upload after command acknowledgement so the mirror never shows an unconfirmed proposal.
    if(exchange.commands?.length){const confirmed=await local();await call('/api/collector/business-sync',{authority:1,clientId,remote:confirmed.data,receipts:confirmed.receipts||[]});}
    lastSuccess=new Date().toISOString();uploaded++;error='';return;
   }
  }
  const base=JSON.parse(db.prepare('SELECT value FROM business_sync_base WHERE id=1').get()?.value||'null');
  if(base&&core.fingerprint(base)===remote.fingerprint){const probe=await call('/api/collector/business-sync',{clientId,probe:true,baseHash:remote.fingerprint,remoteHash:remote.fingerprint});if(probe.unchanged){lastSuccess=new Date().toISOString();error='';return;}}
  const result=await call('/api/collector/business-sync',{clientId,base,remote:remote.data});
  if(!result.ok)throw Error(`有 ${result.conflicts} 项差异待处理，请管理员打开云端 /business-sync；本轮未写入`);
  if(core.fingerprint(result.data)!==remote.fingerprint)await local({expected:remote.fingerprint,data:result.data});
  db.prepare('INSERT INTO business_sync_base VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(result.data));
  lastSuccess=new Date().toISOString();uploaded++;error='';
 }catch(e){error=e.message;console.error('双向同步：'+error);}finally{busy=false;}}
 if(autoStart)tick();const timer=autoStart?setInterval(tick,30000):null;timer?.unref();
 return Object.assign(()=>({twoWay:mode!=='authority',mode,busy,lastSuccess,error,uploaded}),{sync:tick,close:()=>clearInterval(timer)});
}
