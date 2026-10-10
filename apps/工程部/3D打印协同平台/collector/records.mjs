import {createHash} from 'node:crypto';
// Explicit allowlist: no images, model files, settings, credentials or inventory.
export function extractRecords(data,map){
 const result=[];
 for(const [date,day] of Object.entries(data.records||{}))for(const item of day.items||[]){
  const machine=String(map[item.machine]||'');if(!machine||item._deleted)continue;
  const record={};
  for(const key of ['productName','material','customer','remark','status','createdAt','printStartTime','printEndTime','_gcodeFile'])if(typeof item[key]==='string')record[key]=item[key].slice(0,key==='remark'?2000:256);
  for(const key of ['weight','qty','time','price','designFee'])if(typeof item[key]==='number'&&Number.isFinite(item[key])&&item[key]>=0)record[key]=item[key];
  record.autoRecord=item.autoRecord===true;
  const sourceId=String(item._id||createHash('sha256').update(JSON.stringify([date,item.machine,item.printStartTime||item.createdAt,item._gcodeFile,item.productName])).digest('hex'));
  result.push({date,sourceId,machine,sourceMachine:String(item.machine),record});
 }
 return result;
}
export function startRecordSync({config,db,call,bindings,assignments,autoStart=true}){
 db.exec('CREATE TABLE IF NOT EXISTS record_cursors (source TEXT PRIMARY KEY, hash TEXT NOT NULL)');
 let busy=false,version=null,lastSuccess=null,error='',uploaded=0;
 const headers={Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')};
 async function get(route){const response=await fetch(new URL(route,config.url),{headers,redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('原系统记录读取失败 '+response.status);return response.json();}
 async function tick(){if(busy)return;busy=true;try{
  const v=(await get('/api/version')).version;if(v!=null&&v===version)return;
  const rows=extractRecords(await get('/api/data'),config.machineMap);
  const pending=rows.map(row=>{
   const binding=bindings()[row.machine],job=assignments().find(j=>j.id===binding?.jobId&&j.attempt===binding?.attempt);
   if(job&&Date.parse(row.record.printStartTime)>=Date.parse(job.attemptStarted||job.created)){row.jobId=job.id;row.attempt=job.attempt;}
   return {row,hash:createHash('sha256').update(JSON.stringify(row)).digest('hex')};
  }).filter(({row,hash})=>db.prepare('SELECT hash FROM record_cursors WHERE source=?').get(row.sourceId)?.hash!==hash);
  for(let i=0;i<pending.length;i+=20){const batch=pending.slice(i,i+20);await call('/api/collector/records',{records:batch.map(x=>x.row)});
   db.exec('BEGIN');try{for(const {row,hash} of batch)db.prepare('INSERT INTO record_cursors VALUES (?,?) ON CONFLICT(source) DO UPDATE SET hash=excluded.hash').run(row.sourceId,hash);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}uploaded+=batch.length;
  }
  version=v;lastSuccess=new Date().toISOString();error='';
 }catch(e){error=e.message;console.error('生产记录同步：'+error+'；保留游标，稍后重试');}finally{busy=false;}}
 if(autoStart)tick();const timer=autoStart?setInterval(tick,30000):null;timer?.unref();
 return Object.assign(()=>({lastSuccess,error,uploaded,busy}),{sync:tick,close:()=>clearInterval(timer)});
}
