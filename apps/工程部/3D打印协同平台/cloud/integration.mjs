import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream';
import {deviceDetails} from '../shared/device-details.mjs';
import http from 'node:http';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
export function integration({db,body,json,fail,recordEvent,DEMO,ROOT}) {
 db.exec(`CREATE TABLE IF NOT EXISTS production_jobs(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,station TEXT NOT NULL,machine TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,telemetry TEXT,sequence INTEGER DEFAULT 0,synced INTEGER DEFAULT 0,created TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_machine ON production_jobs(station,machine) WHERE status IN ('待打印','打印中','待质检','异常');
 CREATE TABLE IF NOT EXISTS collector_events(id TEXT PRIMARY KEY,station TEXT NOT NULL,received TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS collector_devices(station TEXT,machine TEXT,payload TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(station,machine));
 CREATE TABLE IF NOT EXISTS collector_stations(id TEXT PRIMARY KEY,last_seen TEXT,sequence INTEGER DEFAULT 0);`);
 if(!db.prepare('PRAGMA table_info(production_jobs)').all().some(c=>c.name==='sync_error'))db.exec("ALTER TABLE production_jobs ADD COLUMN sync_error TEXT DEFAULT ''");
 const stations=JSON.parse(process.env.COLLECTOR_STATIONS||JSON.stringify([{id:'acceptance-station',name:'本地验收采集站',factories:['清溪','湖南','河源','印尼'],machines:Array.from({length:30},(_,i)=>String(i+1)),token:process.env.COLLECTOR_TOKEN}]));
 if(!Array.isArray(stations)||!stations.length||stations.some(s=>!s.id||!s.name||!Array.isArray(s.factories)||!s.factories.length||s.factories.some(f=>!['清溪','湖南','河源','印尼'].includes(f))||!Array.isArray(s.machines)||!s.machines.length||s.machines.some(m=>!/^\d+$/.test(m))||typeof s.token!=='string'||s.token.length<32)||new Set(stations.map(s=>s.id)).size!==stations.length||new Set(stations.map(s=>s.token)).size!==stations.length||new Set(stations.flatMap(s=>s.machines)).size!==stations.flatMap(s=>s.machines).length)throw Error('采集站配置无效：编号、令牌和机台编号必须唯一');
 const station=stations[0].id;
 const digest=x=>createHash('sha256').update(x).digest();
 const stamp=()=>new Date().toISOString();
 async function catalog(){const response=await fetch(`http://127.0.0.1:${process.env.PRODUCTION_PORT||3102}/api/data`,{headers:{'X-Internal-Token':process.env.INTERNAL_TOKEN},signal:AbortSignal.timeout(3000)});if(!response.ok)fail(503,'生产资料暂时不可用');return response.json();}
 const jobs=()=>db.prepare('SELECT * FROM production_jobs ORDER BY created DESC').all().map(j=>({...j,...JSON.parse(db.prepare('SELECT payload FROM orders WHERE id=?').get(j.order_id).payload),...JSON.parse(j.payload),telemetry:j.telemetry?JSON.parse(j.telemetry):null,orderStatus:db.prepare('SELECT status FROM orders WHERE id=?').get(j.order_id)?.status,files:db.prepare('SELECT id,name FROM files WHERE order_id=?').all(j.order_id),events:db.prepare('SELECT actor,text,created FROM events WHERE order_id=? ORDER BY id DESC LIMIT 8').all(j.order_id)}));
 function collectorAuth(req){const found=stations.find(s=>s.token&&timingSafeEqual(digest(req.headers.authorization||''),digest('Bearer '+s.token)));if(!found)fail(401,'采集站凭据无效');return found;}
 async function sync(j){
  const p=JSON.parse(j.payload), o=db.prepare('SELECT * FROM orders WHERE id=?').get(j.order_id), op=JSON.parse(o.payload);
  try {const r=await fetch(`http://127.0.0.1:${process.env.PRODUCTION_PORT||3102}/bridge/jobs`,{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':process.env.INTERNAL_TOKEN},body:JSON.stringify({cloudJobId:j.id,date:p.date,productName:p.productionProduct||op.product,customer:op.customer,material:p.productionMaterial||op.material,completion:p.quality||null,weight:p.weight,qty:op.quantity,machine:p.machineNumber,priority:'normal',status:({待打印:'pending',打印中:'printing',待质检:'printing',异常:'printing',待交付:'done',已取消:'cancelled'})[j.status],remark:`关联订单 ${o.number} · ${o.factory} · ${j.status}；请在生产协同页操作`}),signal:AbortSignal.timeout(3000)}); if(!r.ok){const result=await r.json();throw Error(result.error||'生产业务同步失败');}db.prepare("UPDATE production_jobs SET synced=1,sync_error='' WHERE id=? AND status=? AND payload=? AND sequence=?").run(j.id,j.status,j.payload,j.sequence);}catch(e){db.prepare('UPDATE production_jobs SET synced=0,sync_error=? WHERE id=?').run(e.message||'生产业务暂时不可用',j.id);}
 }
 let syncing=false;
 const timer=setInterval(async()=>{if(syncing)return;syncing=true;try{for(const j of db.prepare('SELECT * FROM production_jobs WHERE synced=0').all())await sync(j);}finally{syncing=false;}},5000); timer.unref();
 function transition(j,status,text){db.prepare('UPDATE production_jobs SET status=?,synced=0 WHERE id=?').run(status,j.id);recordEvent(j.order_id,'生产平台',text);}
 return async function handle(req,res,route,u){
  if(route.startsWith('/api/collector/')){
   const authorizedStation=collectorAuth(req),station=authorizedStation.id;
   if(route==='/api/collector/jobs'&&req.method==='GET')return json(res,200,{station,machines:stations.find(s=>s.id===station).machines.map(String),jobs:jobs().filter(j=>j.station===station&&['待打印','打印中','待质检','异常'].includes(j.status)).map(j=>({id:j.id,number:j.number,product:j.product,status:j.status,machine:j.machine,attempt:j.attempt||1,requestedState:DEMO?j.requestedState:undefined}))}),true;
   if(route!=='/api/collector/events'||req.method!=='POST')fail(404,'采集接口不存在');
   const e=await body(req);
   if(e.devices!==undefined&&(!Array.isArray(e.devices)||e.devices.length>999||e.devices.some(d=>!authorizedStation.machines.includes(d.machine)||typeof d.connected!=='boolean'||!['RUNNING','FINISH','FAILED','PAUSE','IDLE','UNKNOWN'].includes(d.state)||!Number.isFinite(d.progress)||d.progress<0||d.progress>100)))fail(400,'设备超出本站授权范围或数据无效');
   if(typeof e.id!=='string'||!e.id.length||e.id.length>80||!Number.isSafeInteger(e.sequence)||e.sequence<1||!Number.isFinite(Date.parse(e.observedAt))||Date.parse(e.observedAt)>Date.now()+60000)fail(400,'无效的采集事件');
   if(e.jobId && (!Number.isInteger(e.attempt)||e.attempt<1||typeof e.jobId!=='string'||typeof e.machine!=='string'||!['RUNNING','FINISH','FAILED','PAUSE','IDLE'].includes(e.state)||!Number.isFinite(e.progress)||e.progress<0||e.progress>100))fail(400,'无效设备状态');
   const j=e.jobId?db.prepare('SELECT * FROM production_jobs WHERE id=? AND station=? AND machine=?').get(e.jobId,station,e.machine):null;
   if(e.jobId&&!j)fail(403,'任务与设备未绑定');
   if(db.prepare('SELECT id FROM collector_events WHERE id=?').get(e.id))return json(res,200,{ok:true,duplicate:true}),true;
   db.exec('BEGIN IMMEDIATE');
   try {
    db.prepare('INSERT INTO collector_events VALUES (?,?,?)').run(e.id,station,stamp());
    db.prepare('INSERT INTO collector_stations VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,sequence=MAX(sequence,excluded.sequence)').run(station,stamp(),e.sequence);
    for(const d of e.devices||[])db.prepare('INSERT INTO collector_devices VALUES (?,?,?,?) ON CONFLICT(station,machine) DO UPDATE SET payload=excluded.payload,observed=excluded.observed WHERE excluded.observed>collector_devices.observed').run(station,d.machine,JSON.stringify({...deviceDetails(d),state:d.state,progress:d.progress,connected:d.connected}),e.observedAt);
    if(j&&e.sequence>j.sequence&&e.attempt===(JSON.parse(j.payload).attempt||1)){
     db.prepare('UPDATE production_jobs SET telemetry=?,sequence=? WHERE id=?').run(JSON.stringify({state:e.state,progress:e.progress,observedAt:e.observedAt,simulated:DEMO}),e.sequence,j.id);
     if(Date.parse(e.observedAt)>=Date.parse(JSON.parse(j.payload).attemptStarted||j.created)){
      if(e.state==='RUNNING'&&j.status==='待打印'){
       transition(j,'打印中','采集到打印开始');db.prepare("UPDATE orders SET status='打印中',updated=? WHERE id=? AND status='待排产'").run(stamp(),j.order_id);
      } else if(e.state==='FINISH'&&j.status==='打印中')transition(j,'待质检','设备打印完成，等待人工质检');
      else if(['FAILED','PAUSE'].includes(e.state)&&['待打印','打印中'].includes(j.status))transition(j,'异常','设备异常，等待人工处理');
     }
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return json(res,200,{ok:true}),true;
  }
  if(!route.startsWith('/api/platform/')&&!route.startsWith('/api/production/')&&!route.startsWith('/production/'))return false;
  if(!u||u.role!=='admin')fail(403,'仅管理员可访问生产业务');
  if(route==='/api/platform/devices'&&req.method==='GET')return json(res,200,{demo:DEMO,stations:stations.map(({token,...s})=>({...s,...db.prepare('SELECT last_seen FROM collector_stations WHERE id=?').get(s.id),devices:s.machines.map(machine=>{const d=db.prepare('SELECT * FROM collector_devices WHERE station=? AND machine=?').get(s.id,machine);return {machine,...(d?JSON.parse(d.payload):{}),observed:d?.observed,online:!!d&&JSON.parse(d.payload).connected&&Date.now()-Date.parse(d.observed)<20000};})}))}),true;
  if(route==='/api/platform/catalog'&&req.method==='GET'){const d=await catalog();return json(res,200,{products:d.products||[],materials:(d.materials||[]).map(m=>({...m,stockG:d.inventory?.[m.name]?.stockG||0}))}),true;}
  if(route==='/api/platform/overview'&&req.method==='GET'){
   const st=db.prepare('SELECT * FROM collector_stations WHERE id=?').get(station);
   return json(res,200,{demo:DEMO,stations:stations.map(({token,...s})=>({...s,...db.prepare('SELECT last_seen FROM collector_stations WHERE id=?').get(s.id)})),jobs:jobs(),station:{id:station,lastSeen:st?.last_seen,online:!!st&&Date.now()-Date.parse(st.last_seen)<20000},orders:db.prepare("SELECT id,number,factory,payload FROM orders WHERE status IN ('待接单','待排产') AND id NOT IN (SELECT order_id FROM production_jobs)").all().map(o=>({...o,...JSON.parse(o.payload),files:db.prepare('SELECT id,name FROM files WHERE order_id=?').all(o.id)}))}),true;
  }
  if(route==='/api/platform/jobs'&&req.method==='POST'){
   const p=await body(req),o=db.prepare('SELECT * FROM orders WHERE id=?').get(p.orderId);
   if(!o||!['待接单','待排产'].includes(o.status))fail(400,'订单当前不可排产');
   if(db.prepare('SELECT id FROM production_jobs WHERE order_id=?').get(o.id))fail(409,'订单已经排产');
   if(!Number.isInteger(p.machineNumber)||p.machineNumber<1||p.machineNumber>999||typeof p.date!=='string'||(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date)||!Number.isFinite(p.weight)||p.weight<=0)fail(400,'请填写机台、日期和单件重量');
   const stationDef=stations.find(x=>x.id===(p.stationId||station));
   const machine=String(p.machineNumber);
   if(!stationDef||!stationDef.factories.includes(o.factory)||!stationDef.machines.includes(machine))fail(400,'此采集站未授权该厂区或机台');
   const selectedStation=stationDef.id;
   if(db.prepare("SELECT id FROM production_jobs WHERE station=? AND machine=? AND status IN ('待打印','打印中','待质检','异常')").get(selectedStation,machine))fail(409,'此机台已有未结束任务');
   const c=await catalog(), product=p.productId?c.products.find(x=>String(x.id)===String(p.productId)):null,material=p.materialId?c.materials.find(x=>String(x.id)===String(p.materialId)):null;
   if(p.productId&&!product||p.materialId&&!material)fail(400,'产品或材料已不存在，请刷新');
   const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{
    if(!['待接单','待排产'].includes(db.prepare('SELECT status FROM orders WHERE id=?').get(o.id)?.status)||db.prepare('SELECT id FROM production_jobs WHERE order_id=?').get(o.id))fail(409,'订单状态已变化，请刷新');
    if(db.prepare("SELECT id FROM production_jobs WHERE station=? AND machine=? AND status IN ('待打印','打印中','待质检','异常')").get(selectedStation,machine))fail(409,'机台已被其他任务占用');
    db.prepare('INSERT INTO production_jobs(id,order_id,station,machine,payload,status,created) VALUES (?,?,?,?,?,?,?)').run(id,o.id,selectedStation,machine,JSON.stringify({number:o.number,factory:o.factory,product:JSON.parse(o.payload).product,machineNumber:p.machineNumber,date:p.date,weight:p.weight,quantity:JSON.parse(o.payload).quantity,productId:product?.id||null,productionProduct:product?.name||JSON.parse(o.payload).product,materialId:material?.id||null,productionMaterial:material?.name||JSON.parse(o.payload).material,attempt:1,requestedState:'IDLE'}),'待打印',stamp());
    db.prepare("UPDATE orders SET status='待排产',updated=? WHERE id=?").run(stamp(),o.id);recordEvent(o.id,u.name,'已关联生产任务和采集机台 #'+machine);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   await sync(db.prepare('SELECT * FROM production_jobs WHERE id=?').get(id));return json(res,201,{id}),true;
  }
  const match=route.match(/^\/api\/platform\/jobs\/([a-f0-9-]+)$/);
  if(match&&req.method==='PATCH'){
   const p=await body(req),j=db.prepare('SELECT * FROM production_jobs WHERE id=?').get(match[1]);if(!j)fail(404,'任务不存在');
   let quality;
   if(p.action==='quality'){
    if(j.status!=='待质检')fail(409,'任务已处理，请刷新');
    const o=db.prepare('SELECT payload FROM orders WHERE id=?').get(j.order_id),op=JSON.parse(o.payload);
    if(!Number.isFinite(p.totalWeight)||p.totalWeight<=0||!Number.isFinite(p.actualHours)||p.actualHours<=0||!Number.isFinite(p.price)||p.price<0||typeof p.notes!=='string'||!p.notes.trim()||p.notes.length>2000)fail(400,'请填写实际总耗材、工时、每件报价和质检记录');
    const c=await catalog(),m=c.materials.find(x=>String(x.id)===String(p.materialId));if(!m)fail(400,'请选择实际使用的材料');
    if((c.inventory?.[m.name]?.stockG||0)<p.totalWeight)fail(409,'实际耗材超过可用库存，请先核实或补充入库');
    quality={totalWeight:p.totalWeight,weight:p.totalWeight/op.quantity,time:p.actualHours,price:p.price,qty:op.quantity,material:m.name,notes:p.notes.trim(),checkedBy:u.name,checkedAt:stamp(),date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())};
    const fresh=db.prepare('SELECT status FROM production_jobs WHERE id=?').get(j.id);if(fresh.status!=='待质检')fail(409,'任务已被其他人处理');
   }
   if(p.action==='resync'){await sync(j);return json(res,200,{ok:true}),true;}
   if(p.action==='deliver'){
    if(j.status!=='待交付'||!j.synced)fail(409,'请先完成质检及生产记录同步');
    const o=db.prepare('SELECT * FROM orders WHERE id=?').get(j.order_id);if(o.status!=='待交付')fail(409,'订单当前不能交付');
    if(typeof p.notes!=='string'||!p.notes.trim()||p.notes.length>2000)fail(400,'请填写交付说明');
    db.exec('BEGIN');try{db.prepare("UPDATE orders SET status='已完成',updated=? WHERE id=?").run(stamp(),o.id);recordEvent(o.id,u.name,'交付完成：'+p.notes.trim());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{ok:true}),true;
   }
   if(p.action==='simulate'){
    if(!DEMO)fail(403,'生产环境禁用模拟');if(!['待打印','打印中'].includes(j.status)||!['RUNNING','FINISH','FAILED'].includes(p.state))fail(400,'此任务不可模拟');
    db.prepare('UPDATE production_jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(j.payload),requestedState:p.state}),j.id);
   }else{
    db.exec('BEGIN IMMEDIATE');try{
     if(p.action==='quality'&&j.status==='待质检'){
      db.prepare('UPDATE production_jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(j.payload),quality}),j.id);
      transition(j,'待交付','管理员 '+u.name+' 确认质检合格');db.prepare("UPDATE orders SET status='待交付',updated=? WHERE id=?").run(stamp(),j.order_id);
     }else if(p.action==='retry'&&['异常','待质检'].includes(j.status)){
      transition(j,'待打印','管理员 '+u.name+' 确认重新打印');db.prepare('UPDATE production_jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(j.payload),attempt:(JSON.parse(j.payload).attempt||1)+1,attemptStarted:stamp(),requestedState:'IDLE'}),j.id);
      db.prepare("UPDATE orders SET status='待排产',updated=? WHERE id=?").run(stamp(),j.order_id);
     }else if(p.action==='cancel'&&j.status==='待打印'){
      transition(j,'已取消','管理员 '+u.name+' 取消未开始任务');db.prepare("UPDATE orders SET status='已取消',updated=? WHERE id=?").run(stamp(),j.order_id);
     }else fail(400,'当前状态不允许此操作');db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   return json(res,200,{ok:true}),true;
  }
  if(route.startsWith('/production/')){
   const name=route==='/production/'?'index.html':route.slice('/production/'.length);
   if(!['index.html','chart.js','xlsx.js'].includes(name))fail(404,'文件不存在');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'");res.setHeader('X-Frame-Options','SAMEORIGIN');
   res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');createReadStream(path.join(ROOT,'../production',name)).pipe(res);return true;
  }
  if(route.startsWith('/api/production/')){
   const target=req.url.replace('/api/production/','/api/');
   if(/^\/api\/(sync|reload|resin-printers|printers\/(push|rescan))/.test(target))fail(403,'请通过本地采集程序管理设备连接');
   if(target==='/api/printers/jobs')return json(res,200,{}),true;
   if(target.startsWith('/api/printers/'))fail(403,'采集程序只读，远程控制已禁用');
   if(target==='/api/printers'){
    const devices=db.prepare('SELECT * FROM collector_devices').all();
    return json(res,200,Object.fromEntries(devices.map(d=>{const p=JSON.parse(d.payload);return [d.machine,{...deviceDetails(p),id:Number(d.machine),name:p.name||`#${d.machine} 采集机台`,connected:p.connected&&Date.now()-Date.parse(d.observed)<20000,gcodeState:p.state,printProgress:p.progress,lastUpdate:Date.parse(d.observed)}];}))),true;
   }
   const proxy=http.request({hostname:'127.0.0.1',port:process.env.PRODUCTION_PORT||3102,path:target,method:req.method,headers:{'content-type':req.headers['content-type']||'application/json','x-internal-token':process.env.INTERNAL_TOKEN,...(req.headers['content-length']?{'content-length':req.headers['content-length']}:{})}},r=>{
    const compress=req.method==='GET' && target==='/api/data' && /\bgzip\b(?!\s*;\s*q=0(?:[.,;\s]|$))/.test(req.headers['accept-encoding']||'');
    res.writeHead(r.statusCode,{'Content-Type':r.headers['content-type']||'application/json','Cache-Control':'no-store','Vary':'Accept-Encoding',...(compress?{'Content-Encoding':'gzip'}:{}),...(r.headers['content-disposition']?{'Content-Disposition':r.headers['content-disposition']}:{})});
    pipeline(...(compress?[r,createGzip(),res]:[r,res]),()=>{});
   });
   proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'生产服务暂时不可用'});else res.destroy();});req.pipe(proxy);return true;
  }
  fail(404,'接口不存在');
 };
}
