import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';
try {
process.umask(0o077);
const root='/app/runtime',mode=process.env.PRINTLINK_OPS_MODE;
const has=(db,t)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
const cloud=new DatabaseSync(path.join(root,'orders/printlink.sqlite'),{readOnly:true});
const production=new DatabaseSync(path.join(root,'production.sqlite'),{readOnly:true});
const ids=(db,t)=>has(db,t)?db.prepare('SELECT id FROM '+t+' ORDER BY id').all().map(x=>x.id):[];
const collections=new Set(['products','materials','schedules','maintenance','miscExpenses','stockInLogs','records','days','inventory','settings']);
const readState=()=>has(production,'business_sync_state')?JSON.parse(production.prepare('SELECT value FROM business_sync_state WHERE id=1').get()?.value||'{}'):{};
function stationDefinitions(){
 const file=path.join(root,'stations.json');
 const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):JSON.parse(process.env.COLLECTOR_STATIONS||'[]');
 if(!Array.isArray(value))throw Error('STATION_CONFIG_INVALID');
 return value;
}
function conflictSummary(conflicts){
 const counts=new Map();
 for(const conflict of Array.isArray(conflicts)?conflicts:[]){
  const parts=Array.isArray(conflict.path)?conflict.path:[];
  const collection=collections.has(parts[0])?parts[0]:'other';
  const category=[collection,...parts.slice(1).map(()=>'*')].join('/');
  const key=collection+'\0'+category;
  counts.set(key,{collection,pathCategory:category,count:(counts.get(key)?.count||0)+1});
 }
 return [...counts.values()].sort((a,b)=>a.pathCategory.localeCompare(b.pathCategory));
}
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
function stateSummary(state){
 const stations=stationDefinitions(),known=value=>stations.some(s=>s.id===value),active=process.env.BUSINESS_SYNC_STATION||null;
 return {active:active&&known(active)?active:active?'[unknown-station]':null,activated:state.activated===true,clientIdExists:typeof state.clientId==='string'&&!!state.clientId,lastSuccess:timestamp(state.lastSuccess),conflicts:Array.isArray(state.conflicts)?state.conflicts.length:0,conflictCategories:conflictSummary(state.conflicts),boundStation:state.station&&known(state.station)?state.station:state.station?'[unknown-station]':null,stationMatchesDefinition:!state.station||known(state.station),activeMatchesDefinition:!active||known(active)};
}
function retainedData(){
 const baseline=process.env.PRINTLINK_OPS_BASELINE?JSON.parse(process.env.PRINTLINK_OPS_BASELINE):null;
 if(!baseline)return null;
 for(const table of ['orders','files','users']){const current=new Set(ids(cloud,table));if(!Array.isArray(baseline[table])||baseline[table].some(id=>!current.has(id)))throw Error('ORIGINAL_'+table.toUpperCase()+'_MISSING');}
 const rows=cloud.prepare('SELECT id,order_id,created,item_id FROM production_jobs').all(),map=new Map(rows.map(row=>[row.id,row]));
 if(!Array.isArray(baseline.jobs))throw Error('BACKUP_AUDIT_INVALID');
 for(const before of baseline.jobs){const after=map.get(before.id),expectedItem=Object.hasOwn(before,'item_id')?before.item_id:'legacy';if(!after||after.order_id!==before.order_id||after.created!==before.created||after.item_id!==expectedItem)throw Error('ORIGINAL_JOB_CHANGED');}
 return {orders:baseline.orders.length,files:baseline.files.length,users:baseline.users.length,jobs:baseline.jobs.length,currentJobs:rows.length};
}
function assertIntegrity(){for(const db of [cloud,production])if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('DATABASE_INTEGRITY_FAILED');}
function assertSources(){
 if(!process.env.PRINTLINK_OPS_SOURCE_HASHES)return;
 for(const [file,expected] of Object.entries(JSON.parse(process.env.PRINTLINK_OPS_SOURCE_HASHES))){if(!/^[a-zA-Z0-9_./-]+$/.test(file)||file.includes('..')||createHash('sha256').update(fs.readFileSync(path.join('/app',file))).digest('hex')!==expected)throw Error('RUNNING_SOURCE_MISMATCH');}
}
function assertUnbound(state){if(state.activated||state.clientId||state.station||state.lastSuccess||state.conflicts?.length)throw Error('BRIDGE_ALREADY_BOUND_OR_CONFLICTED');}
function processStations(expected){
 const found={parent:[],cloud:[],production:[]};
 for(const name of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
  try{
   const command=fs.readFileSync('/proc/'+name+'/cmdline','utf8').split('\0');
   const role=Object.entries({parent:'start.mjs',cloud:'cloud/server.mjs',production:'production/server.js'}).find(([,file])=>command.some(arg=>arg===file||arg==='/app/'+file))?.[0];
   if(!role)continue;
   const value=fs.readFileSync('/proc/'+name+'/environ','utf8').split('\0').find(e=>e.startsWith('BUSINESS_SYNC_STATION='))?.slice('BUSINESS_SYNC_STATION='.length)||null;
   const parent=Number(fs.readFileSync('/proc/'+name+'/status','utf8').match(/^PPid:\s+(\d+)/m)?.[1]);
   found[role].push({pid:Number(name),parent,value});
  }catch(error){if(error.code!=='ENOENT')throw Error('PROCESS_ENV_UNREADABLE');}
 }
 if(Object.values(found).some(rows=>rows.length!==1||rows[0].value!==expected)||found.cloud[0].parent!==found.parent[0].pid||found.production[0].parent!==found.parent[0].pid)throw Error('PROCESS_STATION_ENV_MISMATCH');
 return Object.fromEntries(Object.entries(found).map(([role,rows])=>[role,rows[0].value]));
}
async function liveStatus(){
 assertSources();assertIntegrity();const retained=retainedData();
 const secret=JSON.parse(fs.readFileSync(path.join(root,'secrets.json'),'utf8'));
 const internal=await fetch('http://127.0.0.1:3102/bridge/business-sync',{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':secret.internal},body:JSON.stringify({action:'status'}),signal:AbortSignal.timeout(20000)});
 if(!internal.ok)throw Error('INTERNAL_STATUS_FAILED');const internalState=await internal.json();
 const health=await fetch('http://127.0.0.1:3100/api/health',{signal:AbortSignal.timeout(10000)});if(!health.ok)throw Error('CLOUD_HEALTH_FAILED');
 const writable=new DatabaseSync(path.join(root,'orders/printlink.sqlite'));
 const admin=writable.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();if(!admin){writable.close();throw Error('NO_EXISTING_ADMIN');}
 const cookie=randomBytes(32).toString('hex'),digest=createHash('sha256').update(cookie).digest('hex'),csrf=randomBytes(24).toString('hex');let cleaned=false,pageCode,apiCode,unauthenticatedCode,apiState;
 try{
  writable.prepare('INSERT INTO sessions(token,user_id,csrf,expires) VALUES (?,?,?,?)').run(digest,admin.id,csrf,Date.now()+120000);
  const headers={Cookie:'printlink='+cookie};
  const page=await fetch('http://127.0.0.1:3100/business-sync',{headers,signal:AbortSignal.timeout(10000)});pageCode=page.status;if(!page.ok||!(await page.text()).includes('business-sync.js'))throw Error('BUSINESS_SYNC_PAGE_FAILED');
  const api=await fetch('http://127.0.0.1:3100/api/platform/business-sync',{headers,signal:AbortSignal.timeout(20000)});apiCode=api.status;if(!api.ok)throw Error('ADMIN_STATUS_FAILED');apiState=await api.json();
  const guard=await fetch('http://127.0.0.1:3100/api/platform/business-sync',{signal:AbortSignal.timeout(10000)});unauthenticatedCode=guard.status;if(guard.status!==401)throw Error('ADMIN_AUTH_BOUNDARY_FAILED');
  if(apiState.active!==internalState.active||apiState.active!==(process.env.BUSINESS_SYNC_STATION||null))throw Error('STATUS_API_MISMATCH');
 }finally{
  try{writable.prepare('DELETE FROM sessions WHERE token=?').run(digest);cleaned=!writable.prepare('SELECT token FROM sessions WHERE token=?').get(digest);}finally{writable.close();}
 }
 if(!cleaned)throw Error('TEMPORARY_SESSION_CLEANUP_FAILED');
 const saved=readState();if(process.env.PRINTLINK_OPS_EXPECT_UNBOUND==='1')assertUnbound(saved);
 return {businessSync:stateSummary({...saved,lastSuccess:apiState.lastSuccess,conflicts:apiState.conflicts}),databaseIntegrity:'ok',retained,health:health.status,businessSyncPage:pageCode,adminSyncApi:apiCode,unauthenticatedSyncApi:unauthenticatedCode,temporarySessionCleaned:true,cloudEnabled:!!apiState.active,reconciliationCompleted:false};
}
if(mode==='inspect'){
 const snapshot=has(production,'snapshot')?JSON.parse(production.prepare('SELECT value FROM snapshot WHERE id=1').get()?.value||'{}'):{};
 const collectionCounts=Object.fromEntries([...collections].map(name=>[name,name==='records'?Object.values(snapshot.records||{}).reduce((sum,day)=>sum+(Array.isArray(day?.items)?day.items.length:0),0):name==='days'?Object.keys(snapshot.records||{}).length:Array.isArray(snapshot[name])?snapshot[name].length:snapshot[name]&&typeof snapshot[name]==='object'?Object.keys(snapshot[name]).length:0]));
 assertSources();
 console.log(JSON.stringify({stations:stationDefinitions().map(s=>{const heartbeat=has(cloud,'collector_stations')?cloud.prepare('SELECT last_seen,sequence FROM collector_stations WHERE id=?').get(s.id):null;return {id:s.id,name:s.name,factories:Array.isArray(s.factories)?s.factories:[],devices:Array.isArray(s.machines)?s.machines.length:0,lastSeen:timestamp(heartbeat?.last_seen),sequence:Number(heartbeat?.sequence||0)};}),businessSync:stateSummary(readState()),collectionCounts}));
 cloud.close();production.close();
}else if(mode==='status'||mode==='enable'){
 let environment;
 if(mode==='enable'){
  const stations=stationDefinitions(),qingxi=stations.filter(s=>Array.isArray(s.factories)&&s.factories.includes('清溪'));
  if(stations.length!==1||qingxi.length!==1||qingxi[0].id!=='qingxi'||process.env.BUSINESS_SYNC_STATION!=='qingxi')throw Error('EXACT_QINGXI_STATION_REQUIRED');
  if(readState().station&&readState().station!=='qingxi')throw Error('BOUND_STATION_MISMATCH');environment=processStations('qingxi');
 }
 const status=await liveStatus();if(environment)status.processStations=environment;
 console.log(JSON.stringify(status));cloud.close();production.close();
}else if(mode==='backup'){
 const target=fs.mkdtempSync(path.join(root,'.pre909-'));
 for(const name of fs.readdirSync(root)){
  if(name.startsWith('.pre909-')||name==='.platform-lock')continue;
  fs.cpSync(path.join(root,name),path.join(target,name),{recursive:true,filter:p=>!/(?:\.sqlite(?:-wal|-shm)?|\.platform-lock)$/.test(p)});
 }
 fs.mkdirSync(path.join(target,'orders'),{recursive:true});
 await backup(cloud,path.join(target,'orders/printlink.sqlite'));
 await backup(production,path.join(target,'production.sqlite'));
 const c=new DatabaseSync(path.join(target,'orders/printlink.sqlite'),{readOnly:true});
 const p=new DatabaseSync(path.join(target,'production.sqlite'),{readOnly:true});
 for(const db of [c,p])if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('backup quick_check failed');
 const itemColumn=has(c,'production_jobs')&&c.prepare('PRAGMA table_info(production_jobs)').all().some(column=>column.name==='item_id');
 const jobs=has(c,'production_jobs')?c.prepare('SELECT id,order_id,created'+(itemColumn?',item_id':'')+' FROM production_jobs ORDER BY id').all():[];
 const audit={created:new Date().toISOString(),orders:ids(c,'orders'),files:ids(c,'files'),users:ids(c,'users'),jobs};
 fs.writeFileSync(path.join(target,'pre909-audit.json'),JSON.stringify(audit));
 c.close();p.close();cloud.close();production.close();
 console.log(JSON.stringify({target,orders:audit.orders.length,files:audit.files.length,users:audit.users.length,jobs:jobs.length}));
}else if(mode==='verify'){
 const baseline=JSON.parse(process.env.PRINTLINK_OPS_BASELINE);
 const expectedSources={"cloud/public/app.js": "3809d8a47da62a80f27034da8124bfc1f7c3657778f00c68ba9d372b8ea94275", "cloud/server.mjs": "4e5d525f2581c756a3aafa3163b1d565cc69e62b6e6b22fdcb3d9ff174ab1951"};
 for(const [file,expected] of Object.entries(expectedSources))if(createHash('sha256').update(fs.readFileSync(path.join('/app',file))).digest('hex')!==expected)throw Error('Deployed source differs from reviewed PR910: '+file);

 for(const table of ['orders','files','users']){const current=new Set(ids(cloud,table));if(baseline[table].some(id=>!current.has(id)))throw Error('missing original '+table);}
 const rows=cloud.prepare('SELECT id,order_id,created,item_id FROM production_jobs').all();retainedData();
 for(const db of [cloud,production]){if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('database integrity failed');}
 const state=has(production,'business_sync_state')?JSON.parse(production.prepare('SELECT value FROM business_sync_state WHERE id=1').get()?.value||'{}'):{};
 if(process.env.BUSINESS_SYNC_STATION){const status=await liveStatus();console.log(JSON.stringify({...status,reviewedSources:'PR910 matched'}));cloud.close();production.close();}
 else {
 if(state.activated)throw Error('business sync unexpectedly active');
 const secret=JSON.parse(fs.readFileSync(path.join(root,'secrets.json'),'utf8'));
 const response=await fetch('http://127.0.0.1:3102/bridge/business-sync',{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':secret.internal},body:JSON.stringify({action:'status'})});
 if(!response.ok)throw Error('internal sync status failed '+response.status);
 const status=await response.json();if(status.active||status.conflicts?.length)throw Error('unexpected sync activation/conflicts');
 const health=await fetch('http://127.0.0.1:3100/api/health');if(!health.ok)throw Error('cloud health failed');
 const auth=await fetch('http://127.0.0.1:3100/api/platform/business-sync');if(auth.status!==401)throw Error('admin API authentication guard failed');
 console.log(JSON.stringify({originalOrdersRetained:baseline.orders.length,originalFilesRetained:baseline.files.length,originalUsersRetained:baseline.users.length,originalJobsMigrated:baseline.jobs.length,currentJobs:rows.length,databaseIntegrity:'ok',reviewedSources:'PR910 matched',businessSyncActive:status.active,conflicts:status.conflicts.length,health:health.status,unauthenticatedSyncApi:auth.status}));
 cloud.close();production.close();
 }
}else throw Error('invalid mode');
}catch(error){
 console.log(JSON.stringify({failed:true,safeError:'PRINTLINK_OPS_FAILED'}));process.exitCode=1;
}
