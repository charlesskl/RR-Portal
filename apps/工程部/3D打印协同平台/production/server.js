const http = require('http');
const {planImport}=require('./legacy-import.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const tls = require('tls');
const crypto = require('crypto');
const { createProductFileHandler } = require('./product-files');

const PORT = Number(process.env.PRODUCTION_PORT || 3102);
const businessLimitMB=Number(process.env.PRODUCTION_JSON_LIMIT_MB||64);
if(!Number.isInteger(businessLimitMB)||businessLimitMB<1||businessLimitMB>256)throw Error('PRODUCTION_JSON_LIMIT_MB 必须是 1–256 的整数');
const businessLimitBytes=businessLimitMB*1024*1024;
const DATA_FILE = path.join(__dirname, 'data.json');
const HTML_FILE = path.join(__dirname, 'index.html');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const SYNC_STATE_FILE = path.join(__dirname, 'sync-state.json');
let dataVersion = Date.now();

// 生成唯一ID
function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// 为所有记录 item 分配 _id 和 _updatedAt（数据迁移）
function ensureItemIds() {
  const data = _cachedData ? _cachedData : loadData();
  let changed = false;
  if (data.records) {
    for (const dateStr of Object.keys(data.records)) {
      const day = data.records[dateStr];
      if (!day.items) continue;
      for (const item of day.items) {
        if (!item._id) {
          item._id = generateId();
          changed = true;
        }
        if (!item._updatedAt) {
          item._updatedAt = Date.now();
          changed = true;
        }
      }
    }
  }
  if (changed) {
    console.log('[迁移] 已为现有记录分配 _id 和 _updatedAt');
    saveData(data);
  }
}

// 加载打印机配置（凭据从 config.json 读取，不再硬编码在源代码中）
const _config = {}, _role = 'master';
const { DatabaseSync } = require('node:sqlite');
const store = new DatabaseSync(process.env.PRODUCTION_DB || path.join(__dirname,'../data/production.sqlite'));
store.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
if (!store.prepare('SELECT id FROM snapshot WHERE id=1').get()) { const source=process.env.PRODUCTION_SOURCE || path.join(__dirname,'../data/production-source.json'); store.prepare('INSERT INTO snapshot VALUES (1,?)').run(fs.existsSync(source)?fs.readFileSync(source,'utf8'):JSON.stringify({settings:null,materials:[],products:[],records:{},schedules:[],maintenance:[],inventory:{},stockInLogs:[],miscExpenses:[]})); }
const dataImages=require('./data-images.cjs')(store);
let compactCache=null,compactVersion=null;
let _cachedData = null;
function loadData() { _cachedData=JSON.parse(store.prepare('SELECT value FROM snapshot WHERE id=1').get().value); return structuredClone(_cachedData); }
function requireAuth(req,res) {
  if(process.env.INTERNAL_TOKEN && req.headers['x-internal-token']===process.env.INTERNAL_TOKEN) return true;
  res.writeHead(401); res.end('Internal service'); return false;
}
// 尝试用去掉乱码后的残余文字匹配已知名称列表
function _fuzzyMatchCorrupted(corrupted, knownNames) {
  const cleaned = corrupted.replace(/\uFFFD/g, '');
  if (cleaned.length < 2) return null;
  // 1. 精确子串：清理后文字是某个已知名的子串
  let best = null, bestLen = 0;
  for (const n of knownNames) {
    if (n.includes(cleaned) && n.length > bestLen) { best = n; bestLen = n.length; }
  }
  if (best) return best;
  // 2. 逐字符匹配：已知名去掉部分字符后等于清理版
  for (const n of knownNames) {
    let ci = 0;
    for (let ni = 0; ni < n.length && ci < cleaned.length; ni++) {
      if (n[ni] === cleaned[ci]) ci++;
    }
    if (ci === cleaned.length && cleaned.length >= n.length * 0.5) return n;
  }
  return null;
}

// 修复因 UTF-8 分包导致的乱码字段（启动时调用一次）
function repairCorruptedData(data) {
  if (!data || !data.records) return;
  const matNames = (data.materials || []).map(m => m.name);
  const prodNames = (data.products || []).map(p => p.name);
  const prodSet = new Set(prodNames);
  const matSet = new Set(matNames);
  let fixed = 0;
  for (const [date, day] of Object.entries(data.records)) {
    if (!day.items) continue;
    for (const it of day.items) {
      // 修复 material：含 FFFD 或不在已知材料列表中
      if (it.material && (it.material.includes('\uFFFD') || (!matSet.has(it.material) && it.material.length > 1))) {
        const match = _fuzzyMatchCorrupted(it.material, matNames);
        if (match && match !== it.material) {
          console.log(`[数据修复] ${date} #${it.machine} 材料 "${it.material}" → "${match}"`);
          it.material = match;
          fixed++;
        } else if (it.material.includes('\uFFFD')) {
          it.material = it.material.replace(/\uFFFD/g, '');
          fixed++;
        }
      }
      // 修复 productName：含 FFFD 或不在已知产品列表中（仅对自动记录）
      if (it.productName && it.autoRecord && (it.productName.includes('\uFFFD') || !prodSet.has(it.productName))) {
        const match = _fuzzyMatchCorrupted(it.productName, prodNames);
        if (match && match !== it.productName) {
          console.log(`[数据修复] ${date} #${it.machine} 产品 "${it.productName}" → "${match}"`);
          it.productName = match;
          // 同时用产品库数据修复关联字段
          const prod = (data.products || []).find(p => p.name === match);
          if (prod) {
            if (prod.material) it.material = prod.material;
            if (prod.weight) it.weight = prod.weight;
            if (prod.price) it.price = prod.price;
          }
          fixed++;
        } else if (it.productName.includes('\uFFFD')) {
          it.productName = it.productName.replace(/\uFFFD/g, '');
          fixed++;
        }
      }
    }
  }
  if (fixed > 0) {
    console.log(`[数据修复] 共修复 ${fixed} 处乱码`);
    saveData(data);
  }
}

function deductInventory(data,name,grams){if(!name||!Number.isFinite(grams)||grams<=0)return;data.inventory||={};data.inventory[name]||={stockG:0,minStockG:3000};if(data.inventory[name].stockG<grams)throw Error('材料库存不足，请先核实入库');data.inventory[name].stockG-=grams;data.inventory[name]._updatedAt=Date.now();data._snapshotUpdatedAt=Date.now();}
function saveData(data) {
  data=dataImages.restore(data);
  // Linked orders are owned by the cloud task workflow, not legacy forms.
  const current=loadData(),existing=current.schedules||[];
  for(const [date,day]of Object.entries(current.records||{})){const linked=(day.items||[]).filter(i=>i.cloudJobId);if(linked.length){data.records||={};data.records[date]||={off:false,items:[]};data.records[date].items=(data.records[date].items||[]).filter(i=>!i.cloudJobId).concat(linked);}}
  const sourceRows=new Map(Object.values(current.records||{}).flatMap(d=>d.items||[]).filter(i=>i.sourceRecordId).map(i=>[i._id,i]));
  for(const day of Object.values(data.records||{}))for(const item of day.items||[]){const old=sourceRows.get(item._id);if(old)for(const key of ['sourceRecordId','sourceStation','platformMachine','inventoryReview','printerOutcome','_sourceFacts'])item[key]=old[key];}
  data.schedules=(data.schedules||[]).filter(x=>!x.cloudJobId).concat(existing.filter(x=>x.cloudJobId));
  dataVersion=Math.max(Date.now(),dataVersion+1); _cachedData=structuredClone(data);
  store.prepare('UPDATE snapshot SET value=? WHERE id=1').run(JSON.stringify(data));
}
const printerStatus={}, _remotePrinterStatus={},printerPrevState={};
function sanitizeString(s) { return s; }
// HTTP 服务器
// ═══════════════════════════════════════════════════════
const handleProductFiles = createProductFileHandler({
  storageDir: process.env.PRODUCT_FILES_DIR || path.join(__dirname, '../data/product-files'),
  getProducts: () => loadData().products
});

const server = http.createServer((req, res) => {
  if (!requireAuth(req,res)) return;
  if(req.url==='/api/legacy-import/limits'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({maxBytes:businessLimitBytes,maxMB:businessLimitMB}));return;}
  if(['/api/legacy-import/preview','/api/legacy-import/apply'].includes(req.url)&&req.method==='POST'){
    const chunks=[];let size=0,aborted=false;
    req.on('data',chunk=>{size+=chunk.length;if(size>businessLimitBytes){if(!aborted){aborted=true;chunks.length=0;res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:`请求超过 ${businessLimitMB}MB，请管理员调整 PRODUCTION_JSON_LIMIT_MB 及反向代理限制`}));}return;}chunks.push(chunk);});
    req.on('end',()=>{if(aborted)return;try{
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8')),current=loadData(),plan=planImport(current,input.data);
      if(req.url.endsWith('/preview')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({summary:plan.summary,conflicts:plan.conflicts,fingerprint:plan.fingerprint}));return;}
      if(plan.conflicts.length||input.fingerprint!==plan.fingerprint){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:plan.conflicts.length?'存在冲突，未写入；请核对预览':'云端资料已变化，请重新预览'}));return;}
      store.exec('CREATE TABLE IF NOT EXISTS import_backups (id TEXT PRIMARY KEY, created TEXT NOT NULL, value TEXT NOT NULL)');
      const backupId=generateId();store.exec('BEGIN IMMEDIATE');
      try{store.prepare('INSERT INTO import_backups VALUES (?,?,?)').run(backupId,new Date().toISOString(),JSON.stringify(current));store.prepare('UPDATE snapshot SET value=? WHERE id=1').run(JSON.stringify(plan.next));store.exec('COMMIT');}catch(e){store.exec('ROLLBACK');throw e;}
      _cachedData=structuredClone(plan.next);dataVersion=Math.max(Date.now(),dataVersion+1);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,backupId,summary:plan.summary}));
    }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});return;
  }
  if(req.url==='/bridge/records'&&req.method==='POST'){
    let raw='';req.on('data',c=>{raw+=c;if(raw.length>1024*1024)req.destroy();});
    req.on('end',()=>{try{const {station,records}=JSON.parse(raw);if(typeof station!=='string'||!Array.isArray(records)||records.length>20)throw Error('记录格式无效');
      store.exec('BEGIN IMMEDIATE');let result;
      try{const data=loadData();result=require('./record-sync.cjs')(store,data,station,records);store.prepare('UPDATE snapshot SET value=? WHERE id=1').run(JSON.stringify(data));store.exec('COMMIT');dataVersion=Math.max(Date.now(),dataVersion+1);_cachedData=null;}catch(e){store.exec('ROLLBACK');throw e;}
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,...result}));
    }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});return;
  }
  if (req.url === '/bridge/jobs' && req.method==='POST') {
    let raw=''; req.on('data',c=>{raw+=c;if(raw.length>65536) req.destroy();});
    req.on('end',()=>{try {
      const job=JSON.parse(raw), data=loadData(); data.schedules ||= [];
      const old=data.schedules.find(x=>x.cloudJobId===job.cloudJobId);
      if(old) Object.assign(old,job); else data.schedules.push({...job,id:Math.max(0,...data.schedules.map(x=>Number(x.id)||0))+1});
      if(job.completion){
        const q=job.completion;
        const existingRecord=Object.values(data.records||{}).flatMap(day=>day.items||[]).filter(i=>i.cloudJobId===job.cloudJobId&&(i.cloudAttempt||1)===(job.attempt||1)).sort((a,b)=>(a.printStartTime||'').localeCompare(b.printStartTime||'')).at(-1);
        if(!existingRecord||existingRecord.inventoryReview){
          deductInventory(data,q.material,q.totalWeight);
          data.records||={};data.records[q.date]||={off:false,items:[]};
          if(existingRecord)for(const day of Object.values(data.records))day.items=day.items.filter(i=>i!==existingRecord);
          data.records[q.date].items.push({...existingRecord,inventoryReview:false,_id:existingRecord?._id||'cloud-'+job.cloudJobId,cloudJobId:job.cloudJobId,cloudAttempt:job.attempt||1,_updatedAt:Date.now(),createdAt:q.checkedAt,machine:job.machine,status:'running',productName:job.productName,material:q.material,weight:q.weight,qty:q.qty,time:q.time,price:q.price,designFee:0,customer:job.customer,remark:job.remark+'；质检人：'+q.checkedBy+'；'+q.notes});
        }
      }
      dataVersion=Math.max(Date.now(),dataVersion+1); store.prepare('UPDATE snapshot SET value=? WHERE id=1').run(JSON.stringify(data));
      res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');
    } catch(e) {res.writeHead(400);res.end(JSON.stringify({error:e.message}));}}); return;
  }
  if (/^\/api\/(sync|reload|resin-printers|printers\/(push|rescan|rescan-all))/.test(req.url)) {res.writeHead(403);res.end('{"error":"设备采集已迁移至本地程序"}');return;}
  const isRsconStatusPush=false;
  if (/^\/api\/products\/(?:files(?:[/?]|$)|[^/]+\/files(?:[/?]|$))/.test(req.url || '')) {
    handleProductFiles(req, res).catch(() => {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: false, error: '文件操作失败，请稍后重试'}));
      } else if (!res.destroyed) res.destroy();
    });
    return;
  }

  if (isRsconStatusPush) {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 64 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '状态数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (Number(body.machineId) !== 21) throw new Error('此采集接口只允许机台 #21');
        const allowedStates = new Set(['RUNNING', 'FINISH', 'IDLE', 'PAUSE', 'FAILED', 'UNKNOWN']);
        const state = String(body.state || 'UNKNOWN').toUpperCase();
        if (!allowedStates.has(state)) throw new Error('状态值无效');
        const numberOrNull = value => {
          if (value === null || value === undefined || value === '') return null;
          const num = Number(value);
          return Number.isFinite(num) ? num : null;
        };
        printerStatus[21] = {
          connected: true,
          source: 'rscon-log-agent',
          name: '#21 Lite 600HD-D',
          model: 'UTSLAC600',
          controllerIp: sanitizeString(body.controllerIp || '192.168.2.190'),
          gcodeState: state,
          gcodeFile: sanitizeString(body.sessionId || body.runFile || ''),
          runFile: sanitizeString(body.runFile || ''),
          jobName: sanitizeString(body.jobName || '光固化任务'),
          currentHeight: numberOrNull(body.currentHeight),
          laserPowerMw: numberOrNull(body.laserPowerMw),
          printProgress: numberOrNull(body.printProgress),
          remainingTime: numberOrNull(body.remainingTime),
          lastSeen: Date.now(),
          agentTimestamp: sanitizeString(body.timestamp || '')
        };
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: true, receivedAt: new Date().toISOString()}));
      } catch (e) {
        res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
  }
  else if (req.url.startsWith('/api/data-images/') && req.method === 'GET') {
    const image=dataImages.image(req.url.slice('/api/data-images/'.length));
    if(!image){res.writeHead(404);res.end('Image not found');return;}
    res.writeHead(200,{'Content-Type':image.type,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=86400'});
    res.end(image.body);
  }
  else if (req.url === '/api/data?view=compact' && req.method === 'GET') {
    if(compactVersion!==dataVersion){
      const data=dataImages.compact(loadData());data._version=dataVersion;
      compactCache=JSON.stringify(data);compactVersion=dataVersion;
    }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(compactCache);
  }
  else if (req.url === '/api/data' && req.method === 'GET') {
    const data = loadData();
    data._version = dataVersion;
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  }
  // 每日记录编辑使用单条原子更新，避免打印机自动采集导致全量数据版本冲突，
  // 进而把用户刚修改的内容恢复成自动识别值。
  else if (req.url === '/api/records/update' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const date = body.date;
        const recordId = body.recordId;
        const patch = body.record;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !recordId || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '记录参数无效'}));
          return;
        }

        const data = loadData();
        const day = data.records && data.records[date];
        const item = day && Array.isArray(day.items) && day.items.find(it => it._id === recordId && !it._deleted);
        if(item?.cloudJobId)throw Error('关联生产记录已由质检确认，不允许直接改写或删除');
        if (!item) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '记录不存在或已被删除，请刷新后重试'}));
          return;
        }

        const editableFields = ['machine','status','productName','material','weight','qty','time','designFee','price','customer','remark'];
        for (const field of editableFields) {
          if (Object.prototype.hasOwnProperty.call(patch, field)) item[field] = patch[field];
        }
        item._updatedAt = Date.now();
        await saveData(data);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: true, version: dataVersion, record: item}));
      } catch (e) {
        console.error('[每日记录] 保存编辑失败:', e);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '保存失败：' + e.message}));
      }
    });
  }
  // 每日记录新增使用原子接口，避免打印机自动状态写入造成全量版本冲突。
  else if (req.url === '/api/records/create' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const date = body.date;
        const input = body.record;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !input || typeof input !== 'object' || Array.isArray(input)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '记录参数无效'}));
          return;
        }
        if (!Number.isInteger(Number(input.machine)) || Number(input.machine) <= 0) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '请选择有效机台'}));
          return;
        }

        const data = loadData();
        if (!data.records || typeof data.records !== 'object') data.records = {};
        if (!data.records[date]) data.records[date] = {off:false, items:[]};
        if (!Array.isArray(data.records[date].items)) data.records[date].items = [];
        data.records[date].off = false;
        const item = {};
        const editableFields = ['machine','status','productName','material','weight','qty','time','designFee','price','customer','remark'];
        for (const field of editableFields) {
          if (Object.prototype.hasOwnProperty.call(input, field)) item[field] = input[field];
        }
        item.machine = Number(item.machine);
        item._id = generateId();
        item._updatedAt = Date.now();
        item.createdAt = new Date().toISOString();
        data.records[date].items.push(item);

        // 新增生产记录和库存扣减在同一次服务端写入中完成。
        if (item.status === 'running' && item.material && Number(item.weight) > 0) {
          deductInventory(data, item.material, Number(item.weight) * (Number(item.qty) || 1));
          if (data.inventory && data.inventory[item.material]) data.inventory[item.material]._updatedAt = Date.now();
          data._snapshotUpdatedAt = Date.now();
        }
        await saveData(data);
        res.writeHead(201, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, version:dataVersion, record:item, inventory:data.inventory || {}}));
      } catch (e) {
        console.error('[每日记录] 新增失败:', e);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'新增失败：' + e.message}));
      }
    });
  }
  // 每日记录删除直接标记服务器最新记录，避免全量保存的版本冲突。
  else if (req.url === '/api/records/delete' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const date = body.date;
        const recordId = body.recordId;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !recordId) {
          res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify({error:'删除参数无效'}));
          return;
        }
        const data = loadData();
        const day = data.records && data.records[date];
        const item = day && Array.isArray(day.items) && day.items.find(it => it._id === recordId && !it._deleted);
        if(item?.cloudJobId)throw Error('关联生产记录已由质检确认，不允许直接改写或删除');
        if (!item) {
          res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify({error:'记录不存在或已经删除，请刷新页面'}));
          return;
        }
        item._deleted = true;
        item._updatedAt = Date.now();
        await saveData(data);
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, version:dataVersion, record:item}));
      } catch (e) {
        console.error('[每日记录] 删除失败:', e);
        res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'删除失败：' + e.message}));
      }
    });
  }
  // 工作日/休息日状态直接更新服务器最新日期数据，避免全量保存版本冲突。
  else if (req.url === '/api/records/day-off' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'提交数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const date = body.date;
        const off = body.off;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || typeof off !== 'boolean') {
          res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify({error:'休息日参数无效'}));
          return;
        }
        const data = loadData();
        if (!data.records || typeof data.records !== 'object') data.records = {};
        if (!data.records[date]) data.records[date] = {off:false, items:[]};
        data.records[date].off = off;
        // 与原界面行为一致：标记为休息日时清空当天记录。
        if (off) data.records[date].items = [];
        await saveData(data);
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, version:dataVersion, day:data.records[date]}));
      } catch (e) {
        console.error('[每日记录] 休息日保存失败:', e);
        res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'保存失败：' + e.message}));
      }
    });
  }
  // 材料新增/编辑使用单条原子更新，避免打印机采集更新数据版本时丢失材料。
  else if (req.url === '/api/materials/save' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 64 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'材料数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const input = body.material;
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('材料参数无效');
        const name = sanitizeString(input.name).trim();
        const type = sanitizeString(input.type).trim();
        const priceKg = Number(input.priceKg);
        if (!name) throw new Error('材料名称不能为空');
        if (!type) throw new Error('材料类型不能为空');
        if (!Number.isFinite(priceKg) || priceKg <= 0) throw new Error('材料价格必须大于0');
        const data = loadData();
        if (!Array.isArray(data.materials)) data.materials = [];
        let material;
        if (body.materialId !== undefined && body.materialId !== null) {
          material = data.materials.find(item => String(item.id) === String(body.materialId));
          if (!material) throw new Error('材料不存在，请刷新后重试');
          if (data.materials.some(item => String(item.id) !== String(body.materialId) && item.name === name)) throw new Error('已存在同名材料');
          const oldName = material.name;
          material.name = name;
          material.type = type;
          material.priceKg = priceKg;
          // 材料改名时同步当前业务引用；历史库存数据也迁移到新名称。
          if (oldName !== name) {
            for (const product of (data.products || [])) if (product.material === oldName) product.material = name;
            for (const day of Object.values(data.records || {})) for (const item of (day.items || [])) if (item.material === oldName) item.material = name;
            for (const schedule of (data.schedules || [])) if (schedule.material === oldName) schedule.material = name;
            for (const log of (data.stockInLogs || [])) if (log.material === oldName) log.material = name;
            if (data.inventory && data.inventory[oldName]) {
              data.inventory[name] = data.inventory[oldName];
              delete data.inventory[oldName];
            }
          }
        } else {
          if (data.materials.some(item => item.name === name)) throw new Error('已存在同名材料');
          const nextId = data.materials.length ? Math.max(0, ...data.materials.map(item => Number(item.id) || 0)) + 1 : 1;
          material = {id:nextId, name, type, priceKg};
          data.materials.push(material);
        }
        material._updatedAt = Date.now();
        data._snapshotUpdatedAt = Date.now();
        await saveData(data);
        res.writeHead(body.materialId !== undefined && body.materialId !== null ? 200 : 201, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, material, version:dataVersion}));
      } catch (e) {
        res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'保存失败：' + e.message}));
      }
    });
  }
  else if (req.url === '/api/materials/delete' && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const data = loadData();
        if (!Array.isArray(data.materials)) data.materials = [];
        const index = data.materials.findIndex(item => String(item.id) === String(body.materialId));
        if (index < 0) throw new Error('材料不存在或已经删除');
        const material = data.materials[index];
        const inUse = (data.products || []).some(item => item.material === material.name) ||
          (data.schedules || []).some(item => item.material === material.name) ||
          Object.values(data.records || {}).some(day => (day.items || []).some(item => !item._deleted && item.material === material.name));
        if (inUse) throw new Error('该材料已被产品、排期或每日记录使用，不能删除');
        data.materials.splice(index, 1);
        data._snapshotUpdatedAt = Date.now();
        await saveData(data);
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, materialId:body.materialId, version:dataVersion}));
      } catch (e) {
        res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'删除失败：' + e.message}));
      }
    });
  }
  // 产品编辑使用单产品原子更新，并记录产品级更新时间供双机同步合并。
  else if (req.url === '/api/products/update' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 10 * 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '产品图片或数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const productId = body.productId;
        const patch = body.product;
        if (productId === undefined || productId === null || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '产品参数无效'}));
          return;
        }

        const data = loadData();
        const product = (data.products || []).find(p => String(p.id) === String(productId));
        if (!product) {
          res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '产品不存在，请刷新后重试'}));
          return;
        }
        const name = typeof patch.name === 'string' ? patch.name.trim() : '';
        if (!name) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '产品名称不能为空'}));
          return;
        }

        const oldName = product.name;
        const editableFields = ['name','customer','material','weight','time','qty','price','image','process'];
        for (const field of editableFields) {
          if (Object.prototype.hasOwnProperty.call(patch, field)) product[field] = patch[field];
        }
        product.name = name;
        product._updatedAt = Date.now();

        // 保持每日记录和排期中的产品引用与产品库一致。
        for (const day of Object.values(data.records || {})) {
          for (const item of (day.items || [])) {
            if (item.productName !== oldName) continue;
            item.productName = product.name;
            if (product.material) item.material = product.material;
            if (product.weight) item.weight = product.weight;
            if (product.time) item.time = product.time;
            if (product.price) item.price = product.price;
            item._updatedAt = Date.now();
          }
        }
        for (const schedule of (data.schedules || [])) {
          if (schedule.productName !== oldName) continue;
          schedule.productName = product.name;
          if (product.material) schedule.material = product.material;
          if (product.weight) schedule.weight = product.weight;
          schedule._updatedAt = Date.now();
        }
        data._snapshotUpdatedAt = Date.now();
        await saveData(data);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: true, version: dataVersion, product}));
      } catch (e) {
        console.error('[产品库] 保存编辑失败:', e);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '保存失败：' + e.message}));
      }
    });
  }
  // 新增产品同样使用原子接口，避免全量保存因自动采集/主从同步更新版本而失败。
  else if (req.url === '/api/products/create' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 10 * 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '产品图片或数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const input = body.product;
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '产品参数无效'}));
          return;
        }
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '产品名称不能为空'}));
          return;
        }

        const data = loadData();
        if (!Array.isArray(data.products)) data.products = [];
        if (data.products.some(p => p.name === name)) {
          res.writeHead(409, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '已存在同名产品，请直接编辑原产品'}));
          return;
        }
        const nextId = data.products.length
          ? Math.max(0, ...data.products.map(p => Number(p.id) || 0)) + 1
          : 1;
        try { handleProductFiles.removeProductFiles(nextId); }
        catch (error) {
          console.error('[3D文件] 清理旧产品文件失败:', error.code || 'IO_ERROR');
          throw new Error('无法清理旧产品文件，请稍后重试');
        }
        const product = {id: nextId, name};
        const editableFields = ['customer','material','weight','time','qty','price','image','process'];
        for (const field of editableFields) {
          if (Object.prototype.hasOwnProperty.call(input, field)) product[field] = input[field];
        }
        product._updatedAt = Date.now();
        data.products.push(product);
        data._snapshotUpdatedAt = Date.now();
        await saveData(data);
        res.writeHead(201, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: true, version: dataVersion, product}));
      } catch (e) {
        console.error('[产品库] 新增产品失败:', e);
        res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '新增失败：' + e.message}));
      }
    });
  }
  // 排期、维修和仓库使用模块级原子保存，避免全量数据版本冲突。
  else if (req.url === '/api/module/save' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 2 * 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '提交数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const moduleName = body.module;
        const input = body.record;
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('提交参数无效');
        const data = loadData();
        const now = Date.now();
        let result;

        if (moduleName === 'schedule' || moduleName === 'maintenance' || moduleName === 'miscExpense') {
          const key = moduleName === 'schedule' ? 'schedules' : moduleName === 'maintenance' ? 'maintenance' : 'miscExpenses';
          if (!Array.isArray(data[key])) data[key] = [];
          let item;
          if (body.id !== undefined && body.id !== null) {
            item = data[key].find(x => String(x.id) === String(body.id));
            if (!item) throw new Error(moduleName === 'schedule' ? '排期不存在，请刷新后重试' : moduleName === 'maintenance' ? '维修记录不存在，请刷新后重试' : '杂费记录不存在，请刷新后重试');
            if(item.cloudJobId) throw new Error('关联订单的排程请在生产协同页修改');
            Object.assign(item, input);
          } else {
            const nextId = data[key].length ? Math.max(0, ...data[key].map(x => Number(x.id) || 0)) + 1 : 1;
            item = {id: nextId, ...input};
            data[key].push(item);
          }
          item._updatedAt = now;
          result = {item};
        } else if (moduleName === 'stockLog') {
          if (!Array.isArray(data.stockInLogs)) data.stockInLogs = [];
          if (!data.inventory || Array.isArray(data.inventory)) data.inventory = {};
          let log;
          if (body.id !== undefined && body.id !== null) {
            log = data.stockInLogs.find(x => String(x.id) === String(body.id));
            if (!log) throw new Error('入库记录不存在，请刷新后重试');
            if (data.inventory[log.material]) {
              data.inventory[log.material].stockG = Math.max(0, (data.inventory[log.material].stockG || 0) - (log.amountG || 0));
              data.inventory[log.material]._updatedAt = now;
            }
            Object.assign(log, input);
          } else {
            const nextId = data.stockInLogs.length ? Math.max(0, ...data.stockInLogs.map(x => Number(x.id) || 0)) + 1 : 1;
            log = {id: nextId, date: input.date || new Date().toISOString().slice(0, 10), ...input};
            data.stockInLogs.push(log);
          }
          if (!data.inventory[log.material]) data.inventory[log.material] = {stockG: 0, minStockG: 3000};
          data.inventory[log.material].stockG = Math.max(0, (data.inventory[log.material].stockG || 0) + (log.amountG || 0));
          data.inventory[log.material]._updatedAt = now;
          log._updatedAt = now;
          result = {item: log, inventory: data.inventory};
        } else if (moduleName === 'inventory') {
          if (!data.inventory || Array.isArray(data.inventory)) data.inventory = {};
          if (!input.name) throw new Error('材料名称不能为空');
          if (!data.inventory[input.name]) data.inventory[input.name] = {stockG: 0, minStockG: 3000};
          data.inventory[input.name].stockG = Math.max(0, Number(input.stockG) || 0);
          data.inventory[input.name].minStockG = Math.max(0, Number(input.minStockG) || 0);
          data.inventory[input.name]._updatedAt = now;
          result = {inventory: data.inventory};
        } else if (moduleName === 'stockAdjust') {
          if (!data.inventory || Array.isArray(data.inventory)) data.inventory = {};
          if (!Array.isArray(data.stockInLogs)) data.stockInLogs = [];
          const name = input.material;
          if (!name || !data.inventory[name]) throw new Error('材料库存不存在');
          const oldG = Number(data.inventory[name].stockG) || 0;
          const newG = Math.max(0, Number(input.stockG) || 0);
          data.inventory[name].stockG = newG;
          data.inventory[name]._updatedAt = now;
          const nextId = data.stockInLogs.length ? Math.max(0, ...data.stockInLogs.map(x => Number(x.id) || 0)) + 1 : 1;
          const log = {id: nextId, date: input.date || new Date().toISOString().slice(0, 10), material: name, amountG: newG-oldG, vendor:'[调整]', cost:0, remark:input.remark || '', _updatedAt:now};
          data.stockInLogs.push(log);
          result = {item: log, inventory: data.inventory};
        } else {
          throw new Error('不支持的保存模块');
        }

        data._snapshotUpdatedAt = now;
        await saveData(data);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, version:dataVersion, ...result}));
      } catch (e) {
        console.error('[模块保存] 失败:', e);
        res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'保存失败：' + e.message}));
      }
    });
  }
  // 排期和维修记录原子删除，直接操作服务器中的最新数组。
  else if (req.url === '/api/module/delete' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'提交数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const moduleName = body.module;
        const id = body.id;
        const key = moduleName === 'schedule' ? 'schedules' : moduleName === 'maintenance' ? 'maintenance' : moduleName === 'miscExpense' ? 'miscExpenses' : null;
        if (!key || id === undefined || id === null) {
          res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify({error:'删除参数无效'}));
          return;
        }
        const data = loadData();
        if (!Array.isArray(data[key])) data[key] = [];
        const index = data[key].findIndex(item => String(item.id) === String(id));
        if (index < 0) {
          res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify({error:moduleName === 'schedule' ? '排期不存在或已经删除' : moduleName === 'maintenance' ? '维修记录不存在或已经删除' : '杂费记录不存在或已经删除'}));
          return;
        }
        if(data[key][index].cloudJobId) throw new Error('关联订单的排程请在生产协同页处理');
        data[key].splice(index, 1);
        data._snapshotUpdatedAt = Date.now();
        await saveData(data);
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, version:dataVersion, id}));
      } catch (e) {
        console.error('[模块删除] 失败:', e);
        res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'删除失败：' + e.message}));
      }
    });
  }
  // 系统设置使用原子更新，避免延迟的全量保存与打印机自动采集发生版本竞争。
  else if (req.url === '/api/settings/update' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 64 * 1024) {
        aborted = true;
        res.writeHead(413, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'设置数据过大'}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const input = body && body.settings;
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置参数无效');
        const finite = (value, name) => {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new Error(name + '必须是数字');
          return number;
        };
        const settings = {
          machines: Math.max(21, Math.min(50, Math.trunc(finite(input.machines, '机器数量')))),
          elecPerMachine: Math.max(0, finite(input.elecPerMachine, 'FDM电费')),
          laborPerDay: Math.max(0, finite(input.laborPerDay, 'FDM人工')),
          resinQuotePerGram: Math.max(0, finite(input.resinQuotePerGram, '光固化客户报价')),
          resinElecPerDay: Math.max(0, finite(input.resinElecPerDay, '光固化日电费')),
          resinLaborPerDay: Math.max(0, finite(input.resinLaborPerDay, '光固化日人工')),
          lossRate: Math.max(1, finite(input.lossRate, '材料损耗系数')),
          profitRate: Math.max(0, finite(input.profitRate, '利润率'))
        };
        const data = loadData();
        data.settings = {...(data.settings || {}), ...settings};
        data._snapshotUpdatedAt = Date.now();
        await saveData(data);
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok:true, settings:data.settings, version:dataVersion}));
      } catch (e) {
        res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'保存失败：' + e.message}));
      }
    });
  }
  else if (req.url === '/api/data' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > businessLimitBytes) {
        if (!aborted) {
          aborted = true;
          res.writeHead(413);
          res.end(JSON.stringify({error: `业务数据超过 ${businessLimitMB}MB，请调整 PRODUCTION_JSON_LIMIT_MB`}));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const data = JSON.parse(body);
        // 输入校验：必须是对象且不能是数组
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: '数据格式错误，需要JSON对象'}));
          return;
        }
        // 乐观锁：检查客户端提交的 _version 是否匹配当前服务器版本
        if (data._version !== undefined && data._version !== dataVersion) {
          const latest = loadData();
          latest._version = dataVersion;
          res.writeHead(409, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '数据冲突，其他用户已更新数据', latestData: latest}));
          return;
        }
        // 结构校验
        if (data.settings && typeof data.settings !== 'object') {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'settings 格式无效'}));
          return;
        }
        if (data.materials && !Array.isArray(data.materials)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'materials 必须是数组'}));
          return;
        }
        if (data.products && !Array.isArray(data.products)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'products 必须是数组'}));
          return;
        }
        if (data.records && typeof data.records !== 'object') {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'records 格式无效'}));
          return;
        }
        if (data.maintenance && !Array.isArray(data.maintenance)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'maintenance 必须是数组'}));
          return;
        }
        if (data.miscExpenses && !Array.isArray(data.miscExpenses)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'miscExpenses 必须是数组'}));
          return;
        }
        if (data.inventory && (typeof data.inventory !== 'object' || Array.isArray(data.inventory))) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'inventory 格式无效'}));
          return;
        }
        if (data.stockInLogs && !Array.isArray(data.stockInLogs)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'stockInLogs 必须是数组'}));
          return;
        }
        if (data.schedules && !Array.isArray(data.schedules)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'schedules 必须是数组'}));
          return;
        }
        delete data._version;
        // 处理记录的 _id、_updatedAt 和软删除
        if (data.records && _cachedData && _cachedData.records) {
          const oldRecords = _cachedData.records;
          for (const dateStr of Object.keys(data.records)) {
            const day = data.records[dateStr];
            if (!day || !day.items) continue;
            const oldDay = oldRecords[dateStr];
            const oldItems = (oldDay && oldDay.items) || [];
            // 构建旧记录的 _id 索引
            const oldById = {};
            for (const oi of oldItems) {
              if (oi._id) oldById[oi._id] = oi;
            }
            // 为新 item 分配 _id，检测变更并更新 _updatedAt
            for (const item of day.items) {
              if (!item._id) {
                item._id = generateId();
                item._updatedAt = Date.now();
              } else {
                const oldItem = oldById[item._id];
                if (oldItem) {
                  // 先保留旧的 _updatedAt（前端可能未传回此字段）
                  if (!item._updatedAt && oldItem._updatedAt) {
                    item._updatedAt = oldItem._updatedAt;
                  }
                  // 保护服务端自动记录字段：printEndTime/printStartTime/_gcodeFile/autoRecord
                  // 这些字段仅由服务端 checkPrinterTransitions 设置，前端推送的旧数据不应覆盖
                  if (oldItem.autoRecord) {
                    if (oldItem.printEndTime && !item.printEndTime) {
                      item.printEndTime = oldItem.printEndTime;
                    }
                    if (oldItem.printStartTime && !item.printStartTime) {
                      item.printStartTime = oldItem.printStartTime;
                    }
                    if (oldItem._gcodeFile && !item._gcodeFile) {
                      item._gcodeFile = oldItem._gcodeFile;
                    }
                    if (!item.autoRecord) {
                      item.autoRecord = true;
                    }
                  }
                  // 检查内容是否变化（忽略内部字段）
                  const changed = ['productName','material','weight','qty','time','price','remark','status','machine'].some(
                    k => JSON.stringify(item[k]) !== JSON.stringify(oldItem[k])
                  );
                  if (changed) item._updatedAt = Date.now();
                } else {
                  // item 有 _id 但不在旧数据中（可能从其他地方来）
                  if (!item._updatedAt) item._updatedAt = Date.now();
                }
              }
            }
            // 软删除：旧记录中有但新数据中没有的 item
            // 用 _version（时间戳）区分：前端加载之后新增的记录（来自同步/自动记录）应保留
            const newIds = new Set(day.items.map(it => it._id));
            const frontendLoadTime = data._version || 0;
            for (const oi of oldItems) {
              if (oi._id && !newIds.has(oi._id) && !oi._deleted) {
                const protectTime = Math.max(oi._updatedAt || 0, oi._mergedAt || 0);
                if (protectTime > frontendLoadTime) {
                  // 前端加载后由同步/自动记录新增的，保留
                  day.items.push(oi);
                } else {
                  // 前端加载时已存在但用户删除了，标记软删除
                  oi._deleted = true;
                  oi._updatedAt = Date.now();
                  day.items.push(oi);
                }
              }
            }
          }
        }
        // 保留前端未提交但缓存中存在的日期（由同步添加的）
        if (_cachedData && _cachedData.records) {
          for (const dateStr of Object.keys(_cachedData.records)) {
            if (!data.records[dateStr]) {
              data.records[dateStr] = _cachedData.records[dateStr];
            }
          }
        }
        // 保护快照数组（schedules/stockInLogs/products/materials）：
        // 前端加载后由同步新增的条目不应被前端旧数据覆盖
        const frontendLoadTime = data._version || 0;
        if (_cachedData && frontendLoadTime) {
          // schedules：保留前端加载后由同步新增的排期
          if (_cachedData.schedules && Array.isArray(data.schedules)) {
            const frontIds = new Set(data.schedules.map(s => s.id));
            for (const cs of _cachedData.schedules) {
              if (!frontIds.has(cs.id) && cs._syncedAt && cs._syncedAt > frontendLoadTime) {
                data.schedules.push(cs);
              }
            }
          }
          // stockInLogs：保留前端加载后由同步新增的入库记录
          if (_cachedData.stockInLogs && Array.isArray(data.stockInLogs)) {
            const frontLogIds = new Set(data.stockInLogs.map(l => l.id));
            for (const cl of _cachedData.stockInLogs) {
              if (!frontLogIds.has(cl.id) && cl._syncedAt && cl._syncedAt > frontendLoadTime) {
                data.stockInLogs.push(cl);
              }
            }
          }
          // maintenance：保留前端加载后由同步新增的维修记录
          if (_cachedData.maintenance && Array.isArray(data.maintenance)) {
            const frontMaintIds = new Set(data.maintenance.map(m => m.id));
            for (const cm of _cachedData.maintenance) {
              if (!frontMaintIds.has(cm.id) && cm._syncedAt && cm._syncedAt > frontendLoadTime) {
                data.maintenance.push(cm);
              }
            }
          }
          // miscExpenses：保留前端加载后通过原子接口新增的杂费记录
          if (_cachedData.miscExpenses && Array.isArray(data.miscExpenses)) {
            const frontMiscIds = new Set(data.miscExpenses.map(item => item.id));
            for (const cachedItem of _cachedData.miscExpenses) {
              if (!frontMiscIds.has(cachedItem.id) && cachedItem._updatedAt && cachedItem._updatedAt > frontendLoadTime) data.miscExpenses.push(cachedItem);
            }
          }
        }
        // 仅当快照字段有变化时才更新版本号，避免每次保存都触发全量快照推送
        const prev = _cachedData || {};
        const snapChanged = JSON.stringify(data.inventory) !== JSON.stringify(prev.inventory) ||
          JSON.stringify(data.stockInLogs) !== JSON.stringify(prev.stockInLogs) ||
          JSON.stringify(data.products) !== JSON.stringify(prev.products) ||
          JSON.stringify(data.schedules) !== JSON.stringify(prev.schedules) ||
          JSON.stringify(data.materials) !== JSON.stringify(prev.materials) ||
          JSON.stringify(data.maintenance) !== JSON.stringify(prev.maintenance) ||
          JSON.stringify(data.miscExpenses) !== JSON.stringify(prev.miscExpenses);
        if (snapChanged) data._snapshotUpdatedAt = Date.now();
        saveData(data);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true, version: dataVersion}));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({error: e.message}));
      }
    });
  }
  else if (req.url === '/api/version' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({version: dataVersion}));
  }
  else if (req.url === '/api/printers' && req.method === 'GET') {
    const resinStatus = printerStatus[21];
    if (resinStatus && resinStatus.lastSeen && Date.now() - resinStatus.lastSeen > 30000) {
      resinStatus.connected = false;
      resinStatus.gcodeState = 'UNKNOWN';
      resinStatus.error = 'RSCON 采集器超过30秒未上报';
    }
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    const statusToReturn = (_role === 'slave') ? (_remotePrinterStatus || {}) : printerStatus;
    res.end(JSON.stringify(statusToReturn));
  }
  else if (req.url === '/api/printers/push' && req.method === 'POST') {
    // 从机专用：接收主机推送的打印机状态
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body && body.printerStatus) {
          _remotePrinterStatus = body.printerStatus;
        }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }
  else if (req.url.startsWith('/api/printers/') && req.url.endsWith('/rescan') && req.method === 'POST') {
    const id = parseInt(req.url.split('/')[3]);
    if (scanTriggers[id]) {
      scanTriggers[id]();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: true, message: `#${id} 正在扫描新IP...`}));
    } else {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '该打印机不支持IP扫描'}));
    }
  }
  else if (req.url === '/api/printers/rescan-all' && req.method === 'POST') {
    const triggered = [];
    for (const [id, fn] of Object.entries(scanTriggers)) {
      if (!printerStatus[id] || !printerStatus[id].connected) { fn(); triggered.push(id); }
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: true, triggered}));
  }
  else if (req.url === '/api/printers/jobs' && req.method === 'GET') {
    const jobs = {};
    for (const [id, prev] of Object.entries(printerPrevState)) {
      if (prev.gcodeState === 'RUNNING' && prev.startTime) {
        jobs[id] = { startTime: prev.startTime, gcodeFile: prev.gcodeFile };
      }
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(jobs));
  }
  // 同步 API
  else if (req.url.startsWith('/api/sync/changes') && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const since = parseInt(url.searchParams.get('since') || '0') || 0;
    const result = getChangesSince(since);
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(result));
  }
  else if (req.url === '/api/sync/merge' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 20 * 1024 * 1024) {
        if (!aborted) { aborted = true; res.writeHead(413); res.end(JSON.stringify({error: '数据过大'})); req.destroy(); }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body.changes) {
          res.writeHead(400);
          res.end(JSON.stringify({error: '缺少 changes 字段'}));
          return;
        }
        const result = mergeRemoteChanges(body.changes, body.serverId);
        if (body.snapshot) {
          applyRemoteSnapshot(body.snapshot);
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ ok: true, merged: result.merged, skipped: result.skipped }));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({error: e.message}));
      }
    });
  }
  else if (req.url === '/api/reload' && req.method === 'POST') {
    _cachedData = null;
    loadData();
    dataVersion = Date.now();
    console.log('[重载] data.json 已重新加载');
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok: true, message: 'data.json 已重新加载' }));
  }
  else if (req.url === '/api/sync/status' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({
      enabled: _syncEnabled,
      serverId: _syncServerId,
      peer: _syncPeer.host ? (_syncPeer.host + ':' + (_syncPeer.port || 3000)) : null,
      lastSyncTime: _syncLastTime,
      consecutiveFailures: _syncConsecutiveFailures,
      currentInterval: _syncCurrentInterval
    }));
  }
  else {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end('File not found'); return; }
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
      res.end(data);
    });
  }
});

// 为大附件慢速上传保留 30 分钟请求窗口，与前端上传超时一致。
server.requestTimeout = 30 * 60 * 1000;

server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.requestTimeout=10*60*1000;
server.listen(PORT, '127.0.0.1', () => { ensureItemIds(); console.log('生产业务内部服务已启动'); });
