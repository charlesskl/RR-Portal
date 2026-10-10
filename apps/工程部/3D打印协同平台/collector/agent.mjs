import {startRecordSync} from './records.mjs';
import {deviceDetails} from '../shared/device-details.mjs';
import {readLegacy} from './bridge.mjs';
import {loadConfig} from './config.mjs';
import {startConsole} from './console.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url));
const config=loadConfig(process.env.COLLECTOR_CONFIG||path.join(root,'../data/collector.json'));
const url=new URL(config.cloudUrl);
// loadConfig applies the same transport policy as the preflight checker.
if(url.protocol==='http:'&&config.allowInsecureHttp===true)console.warn('已启用 HTTP 上报：令牌与生产信息不加密');
const dir=process.env.COLLECTOR_DATA_DIR||path.join(root,'../data/collector');mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'outbox.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS readings(machine TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rejected(sequence INTEGER PRIMARY KEY,payload TEXT,error TEXT);');
let statuses={},sourceError='';
if(config.mode==='live'){
 if(!process.argv.includes('--live'))throw Error('连接真实设备需要显式 --live 参数');
 statuses=createRequire(import.meta.url)('./drivers.cjs').start(config);
}else if(config.mode==='bridge'){if(!process.argv.includes('--bridge'))throw Error('桥接需显式 --bridge 参数');}else if(config.mode!=='simulation')throw Error('未知采集模式');
async function call(route,body){const r=await fetch(new URL(route,url),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(route==='/api/collector/records'?30000:5000),redirect:'error'});if(!r.ok)throw Object.assign(Error(`上报返回 ${r.status}`),{status:r.status});return r.json();}
function enqueue(value){if(db.prepare('SELECT COUNT(*) n FROM outbox').get().n>20000){console.error('离线队列已满，暂停采样；恢复连接后继续。');return null;}const e={id:randomUUID(),observedAt:new Date().toISOString(),...value};const id=db.prepare('INSERT INTO outbox(payload) VALUES (?)').run(JSON.stringify(e)).lastInsertRowid;return id;}
db.exec('CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY,value TEXT)');
const bindingPath=config.bindingsFile||path.join(dir,'bindings.json');
mkdirSync(path.dirname(bindingPath),{recursive:true,mode:0o700});
function readBindings(){try{return JSON.parse(readFileSync(bindingPath,'utf8'));}catch{return {};}}
let paused=false,lastSuccess=null;
let known=JSON.parse(db.prepare('SELECT value FROM assignments WHERE id=1').get()?.value||'[]'); let busy=false;let previousError='';
async function tick(){if(busy)return;busy=true;try{
 if(config.mode==='bridge'){const result=await readLegacy(config.legacy);statuses=result.statuses;sourceError=result.error;}
 // Sample remembered assignments even while cloud is unreachable; local SQLite survives restarts.
 for(const j of known){
  let state,progress;
  if(config.mode==='simulation'){state=j.requestedState||'IDLE';progress=state==='FINISH'?100:state==='RUNNING'?45:0;}
  else {
   // Explicit local task binding prevents an unrelated printer job from updating a cloud order.
   const binding=readBindings()[j.machine];
   if(binding?.jobId!==j.id||binding?.attempt!==(j.attempt||1))continue;
   const s=statuses[j.machine];if(!s?.connected)continue;
   state=s.gcodeState==='ERROR'?'FAILED':s.gcodeState;progress=Number(s.printProgress||0);
  }
  if(!['IDLE','RUNNING','FINISH','FAILED','PAUSE'].includes(state))continue;
  const key=JSON.stringify({jobId:j.id,state,progress});const old=db.prepare('SELECT state FROM readings WHERE machine=?').get(j.machine);
  if(true){db.exec('BEGIN');try{enqueue({jobId:j.id,machine:j.machine,attempt:j.attempt||1,state,progress});db.prepare('INSERT INTO readings VALUES (?,?) ON CONFLICT(machine) DO UPDATE SET state=excluded.state').run(j.machine,key);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 }
 if(paused)return;
 for(const row of db.prepare('SELECT * FROM outbox ORDER BY sequence LIMIT 100').all()){
  try{await call('/api/collector/events',{...JSON.parse(row.payload),sequence:row.sequence});}catch(e){if(![400,403,404].includes(e.status))throw e;db.prepare('INSERT OR REPLACE INTO rejected VALUES (?,?,?)').run(row.sequence,row.payload,e.message);console.error('无效事件已保留在 rejected 队列，请检查任务绑定');}db.prepare('DELETE FROM outbox WHERE sequence=?').run(row.sequence);
 }
 known=(await call('/api/collector/jobs')).jobs;lastSuccess=new Date().toISOString();db.prepare('INSERT INTO assignments VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(known));
 const devices=deviceSnapshot();
 enqueue({devices}); // Heartbeats go through the same ordered durable delivery stream.
 if(previousError)console.log('采集站连接已恢复');previousError='';
}catch(e){if(e.message!==previousError)console.log('采集站：'+e.message+'；保留本地队列并自动重试');previousError=e.message;}finally{busy=false;}}
console.log(`本地采集程序已启动（${config.mode==='simulation'?'模拟设备':'真实设备只读采集'}）`);
await tick();setInterval(tick,3000);

function deviceSnapshot(){return config.mode==='simulation'?known.map(j=>({machine:j.machine,connected:true,state:j.requestedState||'IDLE',progress:j.requestedState==='FINISH'?100:j.requestedState==='RUNNING'?45:0})):Object.entries(statuses).map(([machine,s])=>({...deviceDetails(s),machine,connected:!!s.connected,state:s.gcodeState==='ERROR'?'FAILED':['RUNNING','FINISH','FAILED','PAUSE','IDLE'].includes(s.gcodeState)?s.gcodeState:'UNKNOWN',progress:Math.min(100,Math.max(0,Number(s.printProgress)||0))}));}

const recordSync=config.mode==='bridge'?startRecordSync({config:config.legacy,db,call,bindings:readBindings,assignments:()=>known}):()=>null;

if(process.env.COLLECTOR_CONSOLE_PORT||config.consolePort)startConsole({port:Number(process.env.COLLECTOR_CONSOLE_PORT||config.consolePort),
 status:()=>({recordSync:recordSync(),mode:config.mode,sourceError,paused,lastSuccess,connected:!paused&&!!lastSuccess&&Date.now()-Date.parse(lastSuccess)<20000,pending:db.prepare('SELECT COUNT(*) n FROM outbox').get().n,rejected:db.prepare('SELECT COUNT(*) n FROM rejected').get().n,devices:deviceSnapshot(),jobs:known.map(j=>({...j,bound:readBindings()[j.machine]?.jobId===j.id&&readBindings()[j.machine]?.attempt===(j.attempt||1)}))}),
 bind:({jobId,attempt})=>{const j=known.find(j=>j.id===jobId&&j.attempt===attempt&&j.status==='待打印');if(!j)throw Error('任务或轮次已变化，请刷新');if(!lastSuccess||Date.now()-Date.parse(lastSuccess)>15000)throw Error('平台连接中断，暂不能确认绑定');if(config.mode!=='simulation'&&(!statuses[j.machine]?.connected||statuses[j.machine].gcodeState!=='IDLE'))throw Error('请确认设备在线且空闲，再绑定新任务');const bindings=readBindings();bindings[j.machine]={jobId,attempt};const tmp=bindingPath+'.tmp';writeFileSync(tmp,JSON.stringify(bindings,null,2),{mode:0o600});renameSync(tmp,bindingPath);},
 pause:value=>{if(config.mode!=='simulation'||typeof value!=='boolean')throw Error('只允许在模拟验收中暂停上报');paused=value;}
});
