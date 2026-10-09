import {integration} from './integration.mjs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, existsSync, copyFileSync, statSync, createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DEMO = process.env.APP_MODE !== 'production';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
if (DEMO && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) throw Error('演示模式仅允许本机访问；联网部署请设置 APP_MODE=production');
mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'printlink.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT, password TEXT, role TEXT, factory TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, number TEXT UNIQUE, owner TEXT REFERENCES users(id), factory TEXT, status TEXT, created TEXT, updated TEXT, payload TEXT);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), order_id TEXT REFERENCES orders(id), name TEXT, size INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, order_id TEXT REFERENCES orders(id), actor TEXT, text TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), author TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, rating TEXT NOT NULL, content TEXT NOT NULL, created TEXT NOT NULL, status TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '', responder TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`);
db.exec('CREATE TABLE IF NOT EXISTS account_events (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, created TEXT NOT NULL)');
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='factory_scope')) db.exec('ALTER TABLE users ADD COLUMN factory_scope TEXT');
const savedMode = db.prepare('SELECT value FROM metadata WHERE key=?').get('mode');
if (savedMode && savedMode.value !== (DEMO ? 'demo' : 'production')) throw Error('演示和生产不能共用数据目录，请使用独立 DATA_DIR');
db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('mode', DEMO ? 'demo' : 'production');
const factories = ['清溪', '湖南', '河源', '印尼'];
const statuses = ['待接单', '待排产', '打印中', '待交付', '已完成', '已取消'];
const transitions = { '待接单': ['待排产', '已取消'], '待排产': ['打印中', '已取消'], '打印中': ['待交付'], '待交付': ['已完成'], '已完成': [], '已取消': [] };
const extensions = new Set(['.stl','.stp','.step','.obj','.3mf','.iges','.igs','.ply','.png','.jpg','.jpeg','.webp','.gif','.zip','.rar','.7z']);
const now = () => new Date().toISOString();
const hash = x => createHash('sha256').update(x).digest('hex');
function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
function verifyPassword(password, stored) { const [salt, key] = stored.split(':'); return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64)); }
function addUser(username, name, password, role, factory, scope=[factory]) { const id = randomUUID(); db.prepare('INSERT INTO users(id,username,name,password,role,factory,factory_scope) VALUES (?,?,?,?,?,?,?)').run(id, username, name, passwordHash(password), role, factory, JSON.stringify(scope)); return id; }
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  if (DEMO) addUser('demo', '演示管理员', randomBytes(32).toString('hex'), 'admin', '湖南');
  else {
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 8) throw Error('首次启动需设置至少 8 位的 ADMIN_PASSWORD');
    addUser(process.env.ADMIN_USERNAME || 'admin', '系统管理员', password, 'admin', '湖南');
  }
}
function recordEvent(id, actor, text) { db.prepare('INSERT INTO events(order_id,actor,text,created) VALUES (?,?,?,?)').run(id, actor, text, now()); }
if (DEMO && !db.prepare('SELECT value FROM metadata WHERE key=?').get('seeded')) {
  const owner = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  const samples = [
    ['湖南','手办','OHM-LS1','凯适福',10,'硬胶','白色','待接单','2026-10-06','光固化'],
    ['河源','装配定位治具','JIG-028','内部研发',2,'尼龙','黑色','打印中','2026-10-08','尺寸公差 ±0.2mm'],
    ['湖南','外壳结构样板','SH-106','样品客户',6,'硬胶','灰色','待排产','2026-10-09','用于结构装配验证'],
    ['河源','旋钮功能样件','KB-012','内部研发',12,'ABS','白色','待交付','2026-10-07','表面打磨'],
    ['湖南','连接支架','BR-032','样品客户',4,'PLA','黑色','已完成','2026-10-04','装配测试'],
  ];
  samples.forEach((r, i) => {
    const [factory,product,sku,customer,quantity,material,color,status,dueDate,notes] = r;
    const id = randomUUID(), created = new Date(Date.now() - i * 86400000).toISOString();
    const payload = { workshop:'A', customer, sku, product, quantity, material, color, dueDate, replyDate: i ? dueDate : '', engineer:'唐海林', follower:'张颖瑞', notes, priority: i===0?'加急':'普通', sample:true };
    db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)').run(id, `3DP-202610-${String(i+1).padStart(4,'0')}`, owner, factory, status, created, created, JSON.stringify(payload));
    recordEvent(id, '系统', i ? '演示订单，用于体验流程' : '申请表示例；厂区与状态为演示设置');
    if (!i) for (const filename of ['ip08a1_lens_1_8(1).stp','dc0a368cb02c2dffe2214069ab345ade.png','33M~42M.rar']) {
      const source = path.join(ROOT, filename); if (!existsSync(source)) continue;
      const fid = randomUUID(); copyFileSync(source, path.join(DATA,'uploads',fid));
      db.prepare('INSERT INTO files VALUES (?,?,?,?,?,?)').run(fid,owner,id,filename,statSync(source).size,now());
    }
  });
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('seeded','1');
}
// Unattached uploads expire after 24 hours; linked production files are never removed here.
for (const file of db.prepare('SELECT id FROM files WHERE order_id IS NULL AND created < ?').all(new Date(Date.now()-86400000).toISOString())) {
  try { unlinkSync(path.join(DATA,'uploads',file.id)); } catch {}
  db.prepare('DELETE FROM files WHERE id=?').run(file.id);
}
const safeUser = u => ({ id:u.id, username:u.username, name:u.name, role:u.role, factory:u.factory, factories:userFactories(u) });
const validUsername = value => value.length>=3&&value.length<=80&&(/^[a-zA-Z0-9_.-]+$/.test(value)||/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value));
function session(req) {
  if (DEMO) return { user: db.prepare('SELECT * FROM users WHERE username=?').get('demo'), csrf:'local-demo' };
  const cookie = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('printlink='));
  if (!cookie) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(cookie.slice(10)), Date.now());
  return s ? { user:db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id), csrf:s.csrf } : null;
}
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
async function body(req) {
  let length = 0, chunks = []; for await (const chunk of req) { length += chunk.length; if (length > 1024*1024) fail(413,'表单内容过大'); chunks.push(chunk); }
  try { const value=JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { fail(400,'无效的请求数据'); }
}
function userFactories(user) { return user.role==='admin'?factories:(user.factory_scope?JSON.parse(user.factory_scope):[user.factory]); }
function requestedFactories(data,role) {
  const scope=data.factories===undefined?[field(data,'factory',true)]:data.factories;
  if(!Array.isArray(scope)||!scope.length||scope.length>factories.length||scope.some(f=>!factories.includes(f))||new Set(scope).size!==scope.length) fail(400,'请至少选择一个有效厂区');
  return role==='admin'?[...factories]:factories.filter(f=>scope.includes(f));
}
function allowed(user, order) { return userFactories(user).includes(order.factory); }
function getOrder(user,id) { const o=db.prepare('SELECT * FROM orders WHERE id=?').get(id); if (!o || !allowed(user,o)) fail(404,'订单不存在或无访问权限'); return o; }
function orderJSON(o) { const job=db.prepare('SELECT id,status,synced FROM production_jobs WHERE order_id=?').get(o.id); return { production:job?{id:job.id,status:job.status,synced:!!job.synced}:null, ...JSON.parse(o.payload), id:o.id, owner:o.owner, number:o.number, factory:o.factory, status:o.status, created:o.created, updated:o.updated, feedback:db.prepare('SELECT f.*, u.name AS authorName FROM feedback f JOIN users u ON u.id=f.author WHERE order_id=? ORDER BY created DESC').all(o.id), files:db.prepare('SELECT id,name,size FROM files WHERE order_id=?').all(o.id), events:db.prepare('SELECT actor,text,created FROM events WHERE order_id=? ORDER BY id DESC').all(o.id) }; }
function field(data,key,required=false,max=120) { const v=data[key]; if (v!==undefined && typeof v!=='string') fail(400,`${key} 格式不正确`); const value=(v||'').trim(); if (required && !value) fail(400,`请填写 ${labels[key]||key}`); if(value.length>max) fail(400,`${labels[key]||key} 内容过长`); return value; }
const labels={factory:'厂区',workshop:'车间',customer:'客名',sku:'货号',product:'产品名称',engineer:'跟进工程师',material:'耗材',color:'颜色',dueDate:'需交板时间'};
function date(value,required=false) { if (!value && !required) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) fail(400,'请填写有效日期'); return value; }
const attempts = new Map();
const staticFiles = { '/mobile-order.png':'mobile-order.png','/mobile-order.html':'mobile-order.html', '/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg','/manifest.webmanifest':'manifest.webmanifest','/platform':'platform.html','/platform.js':'platform.js','/platform.css':'platform.css' };
const mime = {'.png':'image/png','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const integrate=integration({db,body,json,fail,recordEvent,DEMO,ROOT});
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url,'http://localhost'), route=url.pathname;
    if (DEMO && !['127.0.0.1','localhost','[::1]'].includes(new URL('http://'+req.headers.host).hostname)) fail(403,'本地验收仅允许通过 localhost 访问');
    if (req.method==='GET' && staticFiles[route]) { const p=path.join(ROOT,'public',staticFiles[route]); res.writeHead(200,{'Content-Type':mime[path.extname(p)],'Cache-Control':'no-cache'}); return createReadStream(p).pipe(res); }
    if (route==='/api/health' && req.method==='GET') return json(res,200,{ok:true});
    if(route.startsWith('/api/collector/')) { await integrate(req,res,route); return; }
    if(route.startsWith('/production/')) { const ss=session(req); if(!ss)fail(401,'请先登录'); await integrate(req,res,route,ss.user);return; }
    if (!route.startsWith('/api/')) fail(404,'页面不存在');
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin) { const origin=new URL(req.headers.origin); if(origin.host !== req.headers.host) fail(403,'跨站请求被拒绝'); }
    if(route==='/api/login' && req.method==='POST') {
      const ip=req.socket.remoteAddress, recent=(attempts.get(ip)||[]).filter(t=>t>Date.now()-900000); if(recent.length>=10) fail(429,'尝试次数过多，请 15 分钟后重试'); recent.push(Date.now()); attempts.set(ip,recent);
      const data=await body(req), username=field(data,'username',true), password=field(data,'password',true,256);
      const u=db.prepare('SELECT * FROM users WHERE username=?').get(username);
      if(!u || !verifyPassword(password,u.password)) fail(401,'账号或密码不正确');
      attempts.delete(ip); const token=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),u.id,csrf,Date.now()+43200000);
      res.setHeader('Set-Cookie',`printlink=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE==='false'?'':'; Secure'}`);
      return json(res,200,{user:safeUser(u),csrf});
    }
    const s=session(req); if (!s) fail(401,'请先登录'); const u=s.user;
    if (!['GET','HEAD'].includes(req.method) && req.headers['x-csrf-token']!==s.csrf) fail(403,'会话验证失败，请刷新页面');
    if(await integrate(req,res,route,u))return;
    if(route==='/api/me' && req.method==='GET') return json(res,200,{user:safeUser(u),csrf:s.csrf,demo:DEMO,factories,statuses});
    if(route==='/api/logout' && req.method==='POST') { const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)printlink=([^;]+)/); if(cookie) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(cookie[1])); res.setHeader('Set-Cookie','printlink=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res,200,{ok:true}); }
    const passwordMatch=route.match(/^\/api\/users\/([a-f0-9-]+)\/password$/);
    if(passwordMatch && req.method==='PATCH') {
      if(u.role!=='admin') fail(403,'只有管理员可以更改密码');
      const d=await body(req), target=db.prepare('SELECT id FROM users WHERE id=?').get(passwordMatch[1]);
      if(!target) fail(404,'用户不存在');
      const password=field(d,'password',true,256), confirmation=field(d,'confirmation',true,256);
      if(password.length<8) fail(400,'密码至少 8 位');
      if(password!==confirmation) fail(400,'两次输入的密码不一致');
      const hashed=passwordHash(password);
      db.exec('BEGIN IMMEDIATE'); try {
        db.prepare('UPDATE users SET password=? WHERE id=?').run(hashed,target.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
        db.prepare('INSERT INTO account_events(actor,target,action,created) VALUES (?,?,?,?)').run(u.id,target.id,'管理员更改密码',now());
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      const signedOut=!DEMO&&target.id===u.id;
      if(signedOut) res.setHeader('Set-Cookie','printlink=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res,200,{ok:true,signedOut});
    }
    const userMatch=route.match(/^\/api\/users\/([a-f0-9-]+)$/);
    if(userMatch && req.method==='PATCH') {
      if(u.role!=='admin') fail(403,'只有管理员可以编辑用户');
      const d=await body(req), target=db.prepare('SELECT * FROM users WHERE id=?').get(userMatch[1]);
      if(!target) fail(404,'用户不存在');
      const name=field(d,'name',true,40), username=field(d,'username',true,80), role=field(d,'role',true);
      const scope=requestedFactories(d,role), factory=scope.includes(target.factory)?target.factory:scope[0];
      if(!validUsername(username)) fail(400,'请输入有效账号或邮箱，长度 3–80 位');
      if(!['admin','member'].includes(role)||!factories.includes(factory)) fail(400,'请选择有效角色和厂区');
      if(DEMO&&target.username==='demo'&&(username!=='demo'||role!=='admin')) fail(400,'演示管理员的登录账号和管理员角色不可更改');
      if(target.role==='admin'&&role!=='admin'&&db.prepare("SELECT count(*) AS count FROM users WHERE role='admin'").get().count<=1) fail(400,'系统必须至少保留一名管理员');
      if(db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,target.id)) fail(409,'账号已存在');
      const accessChanged=username!==target.username||role!==target.role||factory!==target.factory||JSON.stringify(scope)!==JSON.stringify(userFactories(target));
      db.exec('BEGIN IMMEDIATE');try {
        db.prepare('UPDATE users SET name=?,username=?,role=?,factory=?,factory_scope=? WHERE id=?').run(name,username,role,factory,JSON.stringify(scope),target.id);
        if(accessChanged) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
        db.prepare('INSERT INTO account_events(actor,target,action,created) VALUES (?,?,?,?)').run(u.id,target.id,JSON.stringify({action:'编辑用户',before:safeUser(target),after:{name,username,role,factory,factories:scope}}),now());
        db.exec('COMMIT');
      } catch(e){db.exec('ROLLBACK');throw e;}
      const signedOut=!DEMO&&accessChanged&&u.id===target.id;
      if(signedOut) res.setHeader('Set-Cookie','printlink=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res,200,{user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id)),signedOut,accessChanged});
    }
    if(route==='/api/users') {
      if(u.role!=='admin') fail(403,'需要管理员权限');
      if(req.method==='GET') return json(res,200,db.prepare('SELECT * FROM users ORDER BY name').all().map(safeUser));
      if(req.method==='POST') { const d=await body(req); const username=field(d,'username',true,80), name=field(d,'name',true,40), password=field(d,'password',true,256), role=field(d,'role',true); const scope=requestedFactories(d,role), factory=scope[0];
        if(!validUsername(username)) fail(400,'请输入有效账号或邮箱，长度 3–80 位');
        if(password.length<8) fail(400,'密码至少 8 位'); if(!factories.includes(factory) || !['admin','member'].includes(role)) fail(400,'厂区或角色不正确');
        if(db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409,'账号已存在');
        const id=addUser(username,name,password,role,factory,scope); return json(res,201,{id}); }
    }
    if(route==='/api/orders' && req.method==='GET') return json(res,200,db.prepare('SELECT * FROM orders ORDER BY created DESC').all().filter(o=>allowed(u,o)).map(orderJSON));
    if(route==='/api/uploads' && req.method==='POST') {
      let name; try { name=decodeURIComponent(req.headers['x-file-name']||''); } catch { fail(400,'文件名无效'); }
      if(!name || name.length>240 || /[\x00-\x1f/\\]/.test(name) || !extensions.has(path.extname(name).toLowerCase())) fail(400,'不支持此文件类型，请上传 3D 模型、图片或 ZIP / RAR / 7Z 压缩包');
      const pending=db.prepare('SELECT count(*) AS count, coalesce(sum(size),0) AS size FROM files WHERE owner=? AND order_id IS NULL').get(u.id);
      if(pending.count>=30 || pending.size>=1024*1024*1024) fail(400,'待提交附件过多，请先完成现有申请');
      const id=randomUUID(), target=path.join(DATA,'uploads',id); let size=0;
      try { await pipeline(req,new Transform({transform(chunk,enc,done){size+=chunk.length; done(size>200*1024*1024?Object.assign(new Error('单个文件不能超过 200 MB'),{status:413}):null,chunk);}}),createWriteStream(target,{flags:'wx'})); if(!size) fail(400,'不能上传空文件');
        db.prepare('INSERT INTO files VALUES (?,?,?,?,?,?)').run(id,u.id,null,name,size,now()); return json(res,201,{id,name,size});
      } catch(e) { if(existsSync(target)) unlinkSync(target); throw e; }
    }
    const fileMatch=route.match(/^\/api\/files\/([a-f0-9-]+)$/);
    if(fileMatch && req.method==='GET') {
      const f=db.prepare('SELECT * FROM files WHERE id=?').get(fileMatch[1]); if(!f) fail(404,'文件不存在');
      if(f.order_id) getOrder(u,f.order_id); else if(f.owner!==u.id) fail(404,'文件不存在');
      const isImage=['.png','.jpg','.jpeg','.webp','.gif'].includes(path.extname(f.name).toLowerCase());
      const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
      res.writeHead(200,{'Content-Type':isImage?types[path.extname(f.name).toLowerCase()]:'application/octet-stream','Content-Length':f.size,'Content-Disposition':`${isImage && url.searchParams.has('preview')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'private, no-store'});
      return createReadStream(path.join(DATA,'uploads',f.id)).pipe(res);
    }
    if(route==='/api/orders' && req.method==='POST') {
      const d=await body(req), factory=field(d,'factory',true); if(!factories.includes(factory) || !userFactories(u).includes(factory)) fail(403,'不能向该厂区下单');
      const p={}; for(const key of ['workshop','customer','sku','product','material','color','engineer']) p[key]=field(d,key,true);
      p.printerType=field(d,'printerType'); if(p.printerType && !['光固化','FDM'].includes(p.printerType)) fail(400,'打印机器只能选择光固化或 FDM');
      p.follower=field(d,'follower'); p.notes=field(d,'notes',false,2000); p.dueDate=date(field(d,'dueDate'),true); p.replyDate=date(field(d,'replyDate'));
      p.priority=field(d,'priority')||'普通'; if(!['普通','加急'].includes(p.priority)) fail(400,'优先级无效');
      p.quantity=Number(d.quantity); if(!Number.isSafeInteger(p.quantity) || p.quantity<1 || p.quantity>100000) fail(400,'数量需为 1–100000 的整数');
      if(!Array.isArray(d.fileIds) || !d.fileIds.length || d.fileIds.length>10 || new Set(d.fileIds).size!==d.fileIds.length || d.fileIds.some(x=>typeof x!=='string')) fail(400,'请上传 1–10 个附件');
      const files=d.fileIds.map(id=>db.prepare('SELECT * FROM files WHERE id=?').get(id)); if(files.some(f=>!f || f.owner!==u.id || f.order_id)) fail(400,'附件已使用或无访问权限'); if(files.reduce((a,f)=>a+f.size,0)>500*1024*1024) fail(400,'每单附件总大小不能超过 500 MB');
      const id=randomUUID(), created=now(), number='3DP-'+created.slice(0,10).replaceAll('-','')+'-'+randomBytes(3).toString('hex').toUpperCase();
      db.exec('BEGIN IMMEDIATE'); try {
        db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)').run(id,number,u.id,factory,'待接单',created,created,JSON.stringify(p));
        for(const f of files) db.prepare('UPDATE files SET order_id=? WHERE id=?').run(id,f.id);
        recordEvent(id,u.name,'提交打印申请'); db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      return json(res,201,orderJSON(getOrder(u,id)));
    }
    const feedbackOrder=route.match(/^\/api\/orders\/([a-f0-9-]+)\/feedback$/);
    if(feedbackOrder && req.method==='POST') {
      const d=await body(req), o=getOrder(u,feedbackOrder[1]);
      if(o.owner!==u.id) fail(403,'只有本订单的下单人可以提交反馈');
      if(o.status!=='已完成') fail(400,'订单完成后才可以提交反馈');
      const category=field(d,'category',true), rating=field(d,'rating',true), content=field(d,'content',true,2000);
      if(!['质量问题','改进建议','使用体验','其他反馈'].includes(category) || !['满意','一般','不满意'].includes(rating)) fail(400,'请选择有效的反馈类型和评价');
      const created=now(); db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO feedback VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),o.id,u.id,category,rating,content,created,'待处理','','',created);
        recordEvent(o.id,u.name,`提交交付反馈：${category}`); db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      return json(res,201,orderJSON(getOrder(u,o.id)));
    }
    const feedbackMatch=route.match(/^\/api\/feedback\/([a-f0-9-]+)$/);
    if(feedbackMatch && req.method==='PATCH') {
      if(u.role!=='admin') fail(403,'只有管理员可以处理反馈');
      const d=await body(req), f=db.prepare('SELECT * FROM feedback WHERE id=?').get(feedbackMatch[1]);
      if(!f) fail(404,'反馈不存在'); getOrder(u,f.order_id);
      const status=field(d,'status',true), reply=field(d,'reply',true,2000);
      if(!['待处理','处理中','已处理'].includes(status)) fail(400,'处理状态无效');
      db.exec('BEGIN IMMEDIATE'); try {
        db.prepare('UPDATE feedback SET status=?,reply=?,responder=?,updated=? WHERE id=?').run(status,reply,u.name,now(),f.id);
        recordEvent(f.order_id,u.name,`反馈${status}：${reply}`); db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      return json(res,200,orderJSON(getOrder(u,f.order_id)));
    }
    const match=route.match(/^\/api\/orders\/([a-f0-9-]+)$/);
    if(match && req.method==='PATCH') {
      if(u.role!=='admin') fail(403,'只有管理员可更新订单进度');
      const d=await body(req), o=getOrder(u,match[1]), p=JSON.parse(o.payload); const status=field(d,'status',true);
      if(status==='已完成'&&db.prepare("SELECT id FROM production_jobs WHERE order_id=? AND synced=0").get(o.id))fail(409,'生产记录尚未同步，请先处理入账');
      if(status!==o.status && db.prepare("SELECT id FROM production_jobs WHERE order_id=? AND status NOT IN ('待交付','已取消')").get(o.id)) fail(409,'关联生产任务请在生产协同页处理状态');
      if(status!==o.status && !transitions[o.status].includes(status)) fail(400,'不能跳过或回退处理流程');
      p.replyDate=date(field(d,'replyDate')); p.follower=field(d,'follower');
      if(!['待接单','已取消'].includes(status) && (!p.replyDate || !p.follower)) fail(400,'接单后需填写复交板时间和 3D 跟进人');
      db.exec('BEGIN IMMEDIATE'); try {
        db.prepare('UPDATE orders SET status=?,payload=?,updated=? WHERE id=?').run(status,JSON.stringify(p),now(),o.id);
        recordEvent(o.id,u.name,status===o.status?'更新复交板时间 / 跟进人':`${o.status} → ${status}`); db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      return json(res,200,orderJSON(getOrder(u,o.id)));
    }
    fail(404,'接口不存在');
  } catch(e) { if(!e.status) console.error(e); if(!res.headersSent && !res.destroyed) json(res,e.status||500,{error:e.status?e.message:'服务器处理失败，请稍后重试'}); }
});
server.requestTimeout=10*60*1000;
server.listen(PORT,HOST,()=>console.log(`PrintLink ${DEMO?'本地演示':'生产'}: http://${HOST}:${PORT}`));
