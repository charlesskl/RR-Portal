import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,openSync,closeSync,fsyncSync,unlinkSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target) throw Error('用法：node legacy/install-business-sync.mjs 原3d-server目录（先停止原服务并独立备份）');
const root = path.resolve(target), read = name => readFileSync(path.join(root,name),'utf8');
const raw = read('server.js'), html = read('index.html'), config = JSON.parse(read('config.json'));
if (config.sync?.enabled || config.role === 'slave') throw Error('请先停用旧主从同步；不能同时运行两套同步');
const anchor = '  } else if (!requireAuth(req, res)) return;';
for (const symbol of ['_syncEnabled','_role','DATA_FILE','function loadData()']) if (!raw.includes(symbol)) throw Error('原 server.js 缺少适配接口：' + symbol + '；未修改文件');
if (raw.split(anchor).length !== 2) throw Error('原服务认证接口不匹配；未修改文件');
// Only patch supported source forms; braces inside strings/comments are not delimiters.
function endBlock(text,start) {
 let depth = 0, quote = '', line = false, block = false;
 for (let i = text.indexOf('{',start); i < text.length; i++) {
  const c=text[i], n=text[i+1];
  if (line) {if(c==='\n')line=false;continue;}
  if (block) {if(c==='*'&&n==='/'){block=false;i++;}continue;}
  if (quote) {if(c==='\\')i++;else if(c===quote)quote='';continue;}
  if (c==='/'&&n==='/'){line=true;i++;continue;}
  if (c==='/'&&n==='*'){block=true;i++;continue;}
  if (['"',"'",'`'].includes(c)){quote=c;continue;}
  if (c==='{')depth++;
  if (c==='}'&&--depth===0)return i+1;
 }
 throw Error('原函数格式不匹配；未修改文件');
}
let server = raw, index = html;
const marker = '// PRINTLINK_AUTHORITY_V2';
if(raw.includes(marker))for(const proof of ["require('./authority-durability.cjs').protect(data,loadData(),authorityWrite);","require('./authority-durability.cjs').writeJSON(DATA_FILE,data)",'save:data=>saveData(data,true),readDisk:',"data._printlinkAuthority.version=dataVersion","loadData()._printlinkAuthority?.enabled && data._version === undefined"])if(!raw.includes(proof))throw Error('已有适配器不完整；请保持停机并检查整组代码备份');
if (!raw.includes(marker)) {
 if (raw.includes('// PRINTLINK_AUTHORITY_RECEIPTS_V1')) throw Error('检测到未受支持的早期统一记账版本，请保留目录并交管理员升级');
 const saveAnchor='function saveData(data) {';
 if(raw.split(saveAnchor).length!==2)throw Error('保存接口不匹配；未修改文件');
 const start=raw.indexOf(saveAnchor),end=endBlock(raw,start),body=raw.slice(start,end);
 // A crash-safe replacement must be proven to replace the actual data-file write.
 const diskWrite=/fs\.writeFileSync\(\s*DATA_FILE\s*,\s*JSON\.stringify\(\s*data\s*(?:,\s*null\s*,\s*2\s*)?\)\s*(?:,\s*['"]utf8['"]\s*)?\)/g;
 if([...body.matchAll(diskWrite)].length!==1)throw Error('原快照写入方式不匹配；未修改任何文件');
 const version='data._version !== undefined && data._version !== dataVersion';
 if(raw.split(version).length!==2)throw Error('原系统缺少受支持的资料版本保护；未修改任何文件');
 const patched=body.replace(saveAnchor,'function saveData(data, authorityWrite=false) {\n  '+marker+"\n  require('./authority-durability.cjs').protect(data,loadData(),authorityWrite);\n  dataVersion=Math.max(Date.now(),dataVersion+1,(loadData()._printlinkAuthority?.version||0)+1);\n  if(data._printlinkAuthority?.enabled)data._printlinkAuthority.version=dataVersion;").replace(diskWrite,"require('./authority-durability.cjs').writeJSON(DATA_FILE,data)");
 server=server.slice(0,start)+patched+server.slice(end);
 server=server.replace(version,"(loadData()._printlinkAuthority?.enabled && data._version === undefined) || ("+version+")");
 // Upgrade the previous two-way adapter hook without adding a second handler.
 const oldMarker='// PRINTLINK_BUSINESS_SYNC_V1';
 if(server.includes(oldMarker)) {
  const call="save:saveData,readDisk:";
  if(server.split(call).length!==2)throw Error('旧桥接保存接口不匹配；未修改文件');
  server=server.replace(call,'save:data=>saveData(data,true),readDisk:');
 } else {
  server=server.replace(anchor,anchor+"\n  "+oldMarker+"\n  if(req.url==='/api/business-sync'){\n    require('./business-sync-adapter.cjs')(req,res,{load:loadData,save:data=>saveData(data,true),readDisk:()=>JSON.parse(fs.readFileSync(DATA_FILE,'utf8')),enabled:_config.businessSync===true&&!_syncEnabled&&_role!=='slave'});return;\n  }");
 }
 server=server.replace(anchor,anchor+"\n  // PRINTLINK_AUTHORITY_VERSION_V2\n  if(loadData()._printlinkAuthority?.enabled)dataVersion=Math.max(dataVersion,loadData()._printlinkAuthority.version||0);");
 if(!server.includes('// PRINTLINK_REPORT_V1')) server=server.replace(anchor,anchor+"\n  // PRINTLINK_REPORT_V1\n  if(req.url==='/production-report.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});res.end(fs.readFileSync(require('path').join(__dirname,'production-report.js')));return;}");
}
if(!html.includes('PrintLinkReport.day')) {
 const start=html.indexOf('function getDaySummary(date){');
 if(start<0||!html.includes('<head>'))throw Error('原报表版本不匹配；未修改文件');
 const end=endBlock(html,start);
 index=html.slice(0,start)+'function getDaySummary(date){return PrintLinkReport.day({settings:S,materials,records},date);}'+html.slice(end);
 index=index.replace('<head>','<head><script src="/production-report.js"></script>');
 const todayStart=index.indexOf('function today(){');
 if(todayStart<0)throw Error('原报表日期函数不匹配；未修改文件');
 index=index.slice(0,todayStart)+'function today(){return PrintLinkReport.today();}'+index.slice(endBlock(index,todayStart));
}
if(!index.includes('PrintLinkReport.today()')||!index.includes('src="/production-report.js"'))throw Error('已有报表适配不完整；未修改文件');
new vm.Script(server,{filename:'server.js'});
const plans=new Map([
 ['business-sync-adapter.cjs',readFileSync(path.join(here,'business-sync-adapter.cjs'))],
 ['business-sync-core.cjs',readFileSync(path.join(here,'../shared/business-sync.cjs'))],
 ['authority-commands.cjs',readFileSync(path.join(here,'../shared/authority-commands.cjs'))],
 ['authority-durability.cjs',readFileSync(path.join(here,'authority-durability.cjs'))],
 ['json-stream.cjs',readFileSync(path.join(here,'../shared/json-stream.cjs'))],
 ['production-report.js',readFileSync(path.join(here,'../shared/production-report.js'))],
 ['index.html',Buffer.from(index)],['server.js',Buffer.from(server)]
]);
const previous=new Map();
for(const [name,bytes]of plans) {
 const file=path.join(root,name);
 if(existsSync(file)&&!lstatSync(file).isFile())throw Error('安装目标不是普通文件：'+name);
 previous.set(name,existsSync(file)?readFileSync(file):null);
 if(name.endsWith('.cjs')||name.endsWith('.js'))new vm.Script(bytes.toString(),{filename:name});
}
if([...plans].every(([name,bytes])=>previous.get(name)?.equals(bytes))){console.log('统一记账适配器已为当前版本，未改动文件或配置。');process.exit(0);}
const backup=path.join(root,'.printlink-install-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
mkdirSync(backup,{mode:0o700});
const digest=x=>createHash('sha256').update(x).digest('hex');
function backupWrite(file,bytes){const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
for(const [name,bytes]of previous)if(bytes!==null)backupWrite(path.join(backup,name),bytes);
backupWrite(path.join(backup,'manifest.json'),JSON.stringify([...plans].map(([name,bytes])=>({name,before:previous.get(name)===null?null:digest(previous.get(name)),after:digest(bytes)}))));
if(process.platform!=='win32'){const fd=openSync(backup,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function atomic(file,bytes) {
 const temp=file+'.install-'+randomUUID();let fd;
 try {fd=openSync(temp,'wx',existsSync(file)?lstatSync(file).mode&0o777:0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,file);}
 finally{if(fd!==undefined)closeSync(fd);if(existsSync(temp))unlinkSync(temp);}
}
try {for(const [name,bytes]of plans)atomic(path.join(root,name),bytes);}
catch(error) {
 for(const [name,bytes]of previous){if(bytes===null){if(existsSync(path.join(root,name)))unlinkSync(path.join(root,name));}else atomic(path.join(root,name),bytes);}
 throw error;
}
console.log('已安装代码；业务快照、配置和桥接身份均未修改。保持原 businessSync 配置，先启动原服务，再启动桥接。代码恢复备份：'+backup+'。尚未启用统一记账。');
