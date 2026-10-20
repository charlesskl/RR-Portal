import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const target=process.argv[2];if(!target)throw Error('用法：node legacy/install-business-sync.mjs 原3d-server目录（先停止原服务）');
const file=path.resolve(target,'server.js'),raw=readFileSync(file,'utf8'),nl=raw.includes('\r\n')?'\r\n':'\n';
const anchor='  } else if (!requireAuth(req, res)) return;';
const marker='// PRINTLINK_BUSINESS_SYNC_V1';
if(!raw.includes(marker)&&raw.split(anchor).length!==2)throw Error('原 server.js 版本不匹配，未修改任何文件');
for(const symbol of ['_syncEnabled','_role','DATA_FILE','function loadData()','function saveData(data)'])if(!raw.includes(symbol))throw Error('原 server.js 缺少适配接口：'+symbol+'；未修改文件');
const configPath=path.resolve(target,'config.json');const config=JSON.parse(readFileSync(configPath,'utf8'));
if(config.sync?.enabled||config.role==='slave')throw Error('请先停用旧主从同步；不能同时运行两套同步');
// Validate every patch point before installing any file.
if(!raw.includes('// PRINTLINK_AUTHORITY_RECEIPTS_V1')&&raw.split('function saveData(data) {').length!==2)throw Error('保存接口不匹配，未修改任何文件');
if(!raw.includes('// PRINTLINK_REPORT_V1')&&raw.split(anchor).length!==2)throw Error('报表路由接口不匹配，未修改任何文件');
const previewIndex=path.resolve(target,'index.html');
if(existsSync(previewIndex)){
 const html=readFileSync(previewIndex,'utf8');
 if(!html.includes('PrintLinkReport.day')){
  const start=html.indexOf('function getDaySummary(date){');
  if(start<0||!html.includes('<head>'))throw Error('原报表版本不匹配，未修改任何文件');
  let end=html.indexOf('{',start)+1,depth=1;
  for(;end<html.length&&depth;end++){if(html[end]==='{')depth++;else if(html[end]==='}')depth--;}
  if(depth)throw Error('原报表函数格式不匹配，未修改任何文件');
 }
}
const backup=file+'.before-business-sync';if(!existsSync(backup))copyFileSync(file,backup);
copyFileSync(path.join(here,'business-sync-adapter.cjs'),path.resolve(target,'business-sync-adapter.cjs'));
copyFileSync(path.join(here,'../shared/business-sync.cjs'),path.resolve(target,'business-sync-core.cjs'));
copyFileSync(path.join(here,'../shared/authority-commands.cjs'),path.resolve(target,'authority-commands.cjs'));
copyFileSync(path.join(here,'../shared/json-stream.cjs'),path.resolve(target,'json-stream.cjs'));
if(!raw.includes(marker)){
 const hook=`${anchor}\n  ${marker}\n  if(req.url==='/api/business-sync'){\n    require('./business-sync-adapter.cjs')(req,res,{load:loadData,save:saveData,readDisk:()=>JSON.parse(fs.readFileSync(DATA_FILE,'utf8')),enabled:_config.businessSync===true&&!_syncEnabled&&_role!=='slave'});return;\n  }`;
 writeFileSync(file,raw.replace(anchor,hook.replaceAll('\n',nl)));
}
// Keep receipts in the same durable snapshot even when an older browser posts full data.
let installed=readFileSync(file,'utf8');
if(!installed.includes('// PRINTLINK_AUTHORITY_RECEIPTS_V1')){
 const anchorSave='function saveData(data) {';
 if(installed.split(anchorSave).length!==2)throw Error('保存接口不匹配，统一记账回执保护未安装');
 installed=installed.replace(anchorSave,anchorSave+nl+"  // PRINTLINK_AUTHORITY_RECEIPTS_V1"+nl+"  for(const collection of ['products','materials'])for(const row of data[collection]||[])if(!row._uid)row._uid=require('node:crypto').randomUUID();"+nl+"  const authorityPrevious=loadData()._printlinkAuthority;"+nl+"  if(authorityPrevious||data._printlinkAuthority)data._printlinkAuthority={enabled:!!(authorityPrevious?.enabled||data._printlinkAuthority?.enabled),receipts:{...data._printlinkAuthority?.receipts,...authorityPrevious?.receipts}};");
 writeFileSync(file,installed);
}
copyFileSync(path.join(here,'../shared/production-report.js'),path.resolve(target,'production-report.js'));
installed=readFileSync(file,'utf8');
if(!installed.includes('// PRINTLINK_REPORT_V1')){
 installed=installed.replace(anchor,anchor+nl+"  // PRINTLINK_REPORT_V1"+nl+"  if(req.url==='/production-report.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});res.end(fs.readFileSync(require('path').join(__dirname,'production-report.js')));return;}");
 writeFileSync(file,installed);
}
const indexFile=path.resolve(target,'index.html');
if(existsSync(indexFile)){
 let html=readFileSync(indexFile,'utf8');
 if(!html.includes('PrintLinkReport.day')){
  const start=html.indexOf('function getDaySummary(date){');
  if(start<0)throw Error('原报表函数不匹配，请勿启用统一记账');
  let end=start+html.slice(start).indexOf('{')+1,depth=1;
  for(;end<html.length&&depth;end++){if(html[end]==='{')depth++;else if(html[end]==='}')depth--;}
  if(depth)throw Error('原报表函数格式不匹配');
  if(!existsSync(indexFile+'.before-authority'))copyFileSync(indexFile,indexFile+'.before-authority');
  html=html.slice(0,start)+'function getDaySummary(date){return PrintLinkReport.day({settings:S,materials,records},date);}'+html.slice(end);
  html=html.replace('<head>','<head><script src="/production-report.js"></script>');
  const todayStart=html.indexOf('function today(){'),todayEnd=html.indexOf('}',todayStart);
  if(todayStart>=0)html=html.slice(0,todayStart)+'function today(){return PrintLinkReport.today();}'+html.slice(todayEnd+1);
  writeFileSync(indexFile,html);
 }
}
console.log('适配器已安装；未修改业务资料或配置。请在原 config.json 与桥接配置中设置 businessSync: true，再启动服务。备份：'+backup);
