const core=require('../shared/business-sync.cjs');
const commands=require('../shared/authority-commands.cjs');
module.exports=function(store,{load,write}){
 store.exec(`CREATE TABLE IF NOT EXISTS authority_state(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS authority_commands(id TEXT PRIMARY KEY,value TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS authority_backups(id INTEGER PRIMARY KEY,created TEXT NOT NULL,value TEXT NOT NULL);`);
 const state=()=>JSON.parse(store.prepare('SELECT value FROM authority_state WHERE id=1').get()?.value||'{}');
 const put=s=>store.prepare('INSERT INTO authority_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(s));
 const enabled=()=>!!state().enabled;
 function handle(input){
  let s=state();
  if(input.action==='authority-view'){
   if(!commands.collections.includes(input.collection))throw Error('不支持的资料类别');
   const doc=core.project(load()),rows=input.collection==='settings'?{business:doc.settings}:doc[input.collection];
   const query=String(input.query||'').toLowerCase();
   return {enabled:!!s.enabled,collection:input.collection,rows:Object.entries(rows||{}).filter(([key,value])=>!query||[key,value.name,value.productName,value.date,value.material].some(x=>String(x||'').toLowerCase().includes(query))).slice(0,200).map(([key,value])=>({key,expected:commands.hash(value),value:Object.fromEntries(Object.entries(value).filter(([k])=>k!=='image'))}))};
  }
  if(input.action==='authority-status')return {...s,candidate:undefined,matches:!!s.hash&&s.hash===core.fingerprint(core.project(load())),commands:store.prepare('SELECT id,status,result,created,value FROM authority_commands ORDER BY created DESC LIMIT 100').all().map(x=>({...x,value:JSON.parse(x.value),result:JSON.parse(x.result||'null')}))};
  if(input.action==='authority-enable'){
   if(s.enabled)return {ok:true};
   if(!s.candidate||Date.now()-Date.parse(s.seen)>60000)throw Error('现场尚未接入新版或快照已过期');
   const cloud=core.project(load());
   if(core.fingerprint(cloud)!==s.hash||input.expected!==s.hash)throw Error('两边仍有差异或资料已变化，请先完成迁移对账；未覆盖任何资料');
   store.exec('BEGIN IMMEDIATE');try{store.prepare('INSERT INTO authority_backups(created,value) VALUES(?,?)').run(new Date().toISOString(),JSON.stringify(load()));s.enabled=true;s.cutover=new Date().toISOString();put(s);store.exec('COMMIT');}catch(e){store.exec('ROLLBACK');throw e;}return {ok:true};
  }
  if(input.action==='authority-job'){
   if(!s.enabled)throw Error('统一记账尚未启用');
   const j=input.job;if(!j||typeof j.cloudJobId!=='string')throw Error('任务无效');
   const value={externalJobId:j.cloudJobId,revision:Number(j.revision||0),date:j.date,machine:Number(j.sourceMachine||j.machine),productName:j.productName,material:j.material,qty:j.qty,weight:j.weight,status:j.status,remark:j.remark};
   // Task dispatch is an independent, durable stream; it never books stock or production records.
   const command={id:'job-'+core.fingerprint(value),collection:'schedules',operation:'task',key:j.cloudJobId,expected:'task',reason:'订单生产任务下发',value};
   const linked=(load().schedules||[]).find(row=>row.cloudJobId===j.cloudJobId);
   if(linked){command.existingKey=String(linked.id);command.existingHash=commands.hash(core.project(load()).schedules[command.existingKey]);}
   commands.validate(command);store.prepare('INSERT OR IGNORE INTO authority_commands VALUES(?,?,?,NULL,?)').run(command.id,JSON.stringify(command),'pending',new Date().toISOString());const queued=store.prepare('SELECT status,result FROM authority_commands WHERE id=?').get(command.id);if(queued.status==='rejected')throw Error('现场拒绝任务：'+JSON.parse(queued.result).error);return {ok:true,pending:queued.status==='pending'};
  }
  if(input.action==='authority-submit'){
   if(!s.enabled)throw Error('统一记账尚未启用');
   const proposed={...input.command};if(proposed.operation==='task')throw Error('生产任务请从生产协同下发');if(proposed.operation==='create'&&proposed.expected==='absent')proposed.expected=commands.hash(undefined);
   const c=commands.validate(proposed),existing=store.prepare('SELECT value,status FROM authority_commands WHERE id=?').get(c.id);
   if(existing){if(core.fingerprint(JSON.parse(existing.value))!==core.fingerprint(c))throw Error('申请编号已用于其他内容');return {ok:true,pending:existing.status==='pending',id:c.id};}
   // Validate against the last confirmed mirror, but never book the proposed change here.
   commands.apply(load(),c);
   store.prepare('INSERT INTO authority_commands VALUES(?,?,?,NULL,?)').run(c.id,JSON.stringify(c),'pending',new Date().toISOString());return {ok:true,pending:true,id:c.id};
  }
  if(input.action!=='authority-exchange')throw Error('未知统一记账操作');
  if(input.protocol!==1||!process.env.BUSINESS_SYNC_STATION||input.station!==process.env.BUSINESS_SYNC_STATION||!/^[-a-f0-9]{36}$/.test(input.clientId||''))throw Error('现场协议或授权无效');
  const legacy=store.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_sync_state'").get()?JSON.parse(store.prepare('SELECT value FROM business_sync_state WHERE id=1').get()?.value||'{}'):{};
  if(legacy.clientId&&legacy.clientId!==input.clientId)throw Error('请使用既有桥接实例完成切换');
  if(s.clientId&&s.clientId!==input.clientId)throw Error('统一记账已绑定其他采集实例');
  core.apply({},input.remote);
  store.exec('BEGIN IMMEDIATE');try{
   s.clientId=input.clientId;s.seen=new Date().toISOString();s.hash=core.fingerprint(input.remote);
   if(!s.enabled){s.candidate=true;put(s);store.exec('COMMIT');return {ok:true,mode:'migration',hash:s.hash,matches:s.hash===core.fingerprint(core.project(load()))};}
   // Receipts are read from the same durable Windows snapshot as remote.
   for(const receipt of input.receipts||[]){
    const row=store.prepare('SELECT value FROM authority_commands WHERE id=?').get(receipt.id);
    if(!row||receipt.request!==core.fingerprint(JSON.parse(row.value))||!['applied','rejected'].includes(receipt.status))throw Error('现场回执不匹配');
    store.prepare('UPDATE authority_commands SET status=?,result=? WHERE id=?').run(receipt.status,JSON.stringify(receipt),receipt.id);
   }
   const original=load();if(core.fingerprint(core.project(original))!==s.hash){
    store.prepare('INSERT INTO authority_backups(created,value) VALUES(?,?)').run(s.seen,JSON.stringify(original));
    const next=core.apply(original,input.remote);for(const d of Object.values(next.records||{}))for(const r of d.items||[])r.inventorySync=true;write(next);
    store.exec('DELETE FROM authority_backups WHERE id NOT IN (SELECT id FROM authority_backups ORDER BY id DESC LIMIT 5)');
   }
   s.lastConfirmed=s.seen;delete s.candidate;put(s);
   const pending=store.prepare("SELECT value FROM authority_commands WHERE status='pending' ORDER BY created LIMIT 20").all().map(x=>JSON.parse(x.value));
   store.exec('COMMIT');return {ok:true,mode:'authority',hash:s.hash,commands:pending};
  }catch(e){store.exec('ROLLBACK');throw e;}
 }
 return {handle,enabled};
};
