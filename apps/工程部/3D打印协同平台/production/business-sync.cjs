const core=require('../shared/business-sync.cjs');
module.exports=function createBusinessSync(store,{load,write}){
 store.exec('CREATE TABLE IF NOT EXISTS business_sync_state (id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS business_sync_backups (id INTEGER PRIMARY KEY,created TEXT NOT NULL,value TEXT NOT NULL)');
 const get=()=>JSON.parse(store.prepare('SELECT value FROM business_sync_state WHERE id=1').get()?.value||'{}');
 const put=s=>store.prepare('INSERT INTO business_sync_state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(s));
 return function(input){
  const state=get();
  if(input.action==='status')return {lastSuccess:state.lastSuccess,conflicts:state.conflicts||[],active:process.env.BUSINESS_SYNC_STATION||null};
  if(input.action==='resolve'){
   if(!Array.isArray(input.choices))throw Error('请选择冲突处理方式');
   state.choices||={};for(const choice of input.choices){const c=state.conflicts?.find(c=>c.id===choice.id&&c.signature===choice.signature);if(!c||!(['cloud','windows'].includes(choice.side)||choice.side==='both'&&core.canKeepBoth(c)))throw Error('冲突已变化，请刷新');state.choices[c.id]={signature:c.signature,side:choice.side};}put(state);return {ok:true};
  }
  if(!['exchange','probe'].includes(input.action))throw Error('未知同步操作');
  if(!process.env.BUSINESS_SYNC_STATION||input.station!==process.env.BUSINESS_SYNC_STATION)throw Error('未启用此站双向同步');
  if(typeof input.clientId!=='string'||!/^[-a-f0-9]{36}$/.test(input.clientId))throw Error('桥接实例编号无效');
  if(state.clientId&&state.clientId!==input.clientId||state.station&&state.station!==input.station)throw Error('已绑定其他桥接实例；请恢复原桥接数据目录，勿同时启用多个实例');
  if(input.action==='probe'){const hash=core.fingerprint(core.project(load()));return {unchanged:input.baseHash===hash&&input.remoteHash===hash};}
  store.exec('BEGIN IMMEDIATE');try{
   state.activated=true;state.clientId=input.clientId;state.station=input.station;
   const original=load(),cloud=core.project(original);
   // Validate both remote snapshots; never accept arbitrary settings or credentials.
   core.apply({},input.remote);if(input.base)core.apply({},input.base);
   const requestHash=core.fingerprint({base:input.base||null,remote:input.remote});
   if(state.receipt?.request===requestHash&&state.receipt.result===core.fingerprint(cloud)){store.exec('COMMIT');return {ok:true,data:cloud};}
   const merged=core.merge(input.base,cloud,input.remote,state.choices,state.productRemaps);
   if(merged.conflicts.length){state.conflicts=merged.conflicts;state.choices=state.choices||{};put(state);store.exec('COMMIT');return {ok:false,conflicts:merged.conflicts.length};}
   const next=core.apply(original,merged.data);
   let inventoryModeChanged=false;for(const day of Object.values(next.records||{}))for(const row of day.items||[]){if(!row.inventorySync)inventoryModeChanged=true;row.inventorySync=true;}
   if(inventoryModeChanged||core.fingerprint(cloud)!==core.fingerprint(merged.data)){
    store.prepare('INSERT INTO business_sync_backups(created,value) VALUES (?,?)').run(new Date().toISOString(),JSON.stringify(original));
    write(next);
    store.exec('DELETE FROM business_sync_backups WHERE id NOT IN (SELECT id FROM business_sync_backups ORDER BY id DESC LIMIT 5)');
   }
   state.productRemaps=merged.productRemaps;
   state.receipt={request:requestHash,result:core.fingerprint(merged.data)};
   state.conflicts=[];state.choices={};state.lastSuccess=new Date().toISOString();put(state);store.exec('COMMIT');return {ok:true,data:merged.data};
  }catch(e){store.exec('ROLLBACK');throw e;}
 };
};
