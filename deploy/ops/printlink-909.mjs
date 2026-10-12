import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
process.umask(0o077);
const root='/app/runtime',mode=process.env.PRINTLINK_OPS_MODE;
const has=(db,t)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
const cloud=new DatabaseSync(path.join(root,'orders/printlink.sqlite'),{readOnly:true});
const production=new DatabaseSync(path.join(root,'production.sqlite'),{readOnly:true});
const ids=(db,t)=>has(db,t)?db.prepare('SELECT id FROM '+t+' ORDER BY id').all().map(x=>x.id):[];
if(mode==='backup'){
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
 const jobs=has(c,'production_jobs')?c.prepare('SELECT id,order_id,created FROM production_jobs ORDER BY id').all():[];
 const audit={created:new Date().toISOString(),orders:ids(c,'orders'),files:ids(c,'files'),users:ids(c,'users'),jobs};
 fs.writeFileSync(path.join(target,'pre909-audit.json'),JSON.stringify(audit));
 c.close();p.close();cloud.close();production.close();
 console.log(JSON.stringify({target,orders:audit.orders.length,files:audit.files.length,users:audit.users.length,jobs:jobs.length}));
}else if(mode==='verify'){
 const baseline=JSON.parse(process.env.PRINTLINK_OPS_BASELINE);
 const expectedSources={"cloud/public/app.js": "3809d8a47da62a80f27034da8124bfc1f7c3657778f00c68ba9d372b8ea94275", "cloud/server.mjs": "4e5d525f2581c756a3aafa3163b1d565cc69e62b6e6b22fdcb3d9ff174ab1951"};
 for(const [file,expected] of Object.entries(expectedSources))if(createHash('sha256').update(fs.readFileSync(path.join('/app',file))).digest('hex')!==expected)throw Error('Deployed source differs from reviewed PR910: '+file);

 for(const table of ['orders','files','users']){const current=new Set(ids(cloud,table));if(baseline[table].some(id=>!current.has(id)))throw Error('missing original '+table);}
 const rows=cloud.prepare('SELECT id,order_id,created,item_id FROM production_jobs').all(),map=new Map(rows.map(r=>[r.id,r]));
 for(const before of baseline.jobs){const after=map.get(before.id);if(!after||after.order_id!==before.order_id||after.created!==before.created||after.item_id!=='legacy')throw Error('original job migration mismatch');}
 for(const db of [cloud,production]){if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('database integrity failed');}
 const state=has(production,'business_sync_state')?JSON.parse(production.prepare('SELECT value FROM business_sync_state WHERE id=1').get()?.value||'{}'):{};
 if(process.env.BUSINESS_SYNC_STATION||state.activated)throw Error('business sync unexpectedly active');
 const secret=JSON.parse(fs.readFileSync(path.join(root,'secrets.json'),'utf8'));
 const response=await fetch('http://127.0.0.1:3102/bridge/business-sync',{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':secret.internal},body:JSON.stringify({action:'status'})});
 if(!response.ok)throw Error('internal sync status failed '+response.status);
 const status=await response.json();if(status.active||status.conflicts?.length)throw Error('unexpected sync activation/conflicts');
 const health=await fetch('http://127.0.0.1:3100/api/health');if(!health.ok)throw Error('cloud health failed');
 const auth=await fetch('http://127.0.0.1:3100/api/platform/business-sync');if(auth.status!==401)throw Error('admin API authentication guard failed');
 console.log(JSON.stringify({originalOrdersRetained:baseline.orders.length,originalFilesRetained:baseline.files.length,originalUsersRetained:baseline.users.length,originalJobsMigrated:baseline.jobs.length,currentJobs:rows.length,databaseIntegrity:'ok',reviewedSources:'PR910 matched',businessSyncActive:status.active,conflicts:status.conflicts.length,health:health.status,unauthenticatedSyncApi:auth.status}));
 cloud.close();production.close();
}else throw Error('invalid mode');
