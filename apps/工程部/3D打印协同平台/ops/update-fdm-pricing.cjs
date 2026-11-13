// Incremental updater: preflight every target before any writes, preserve deployment configuration and existing sync implementation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const patch=require('../legacy/pricing-patch.cjs'),rules=require('../legacy/pricing-patch-rules.cjs');
const mode=process.argv[2],args=process.argv.slice(3).filter(a=>a!=='--check');
const check=process.argv.includes('--check');
if(!['cloud','windows'].includes(mode)||args.length!==(mode==='cloud'?1:2))throw Error('用法：node ops/update-fdm-pricing.cjs cloud 云端源码目录 [--check]\n或 node ops/update-fdm-pricing.cjs windows 桥接目录 原3d-server目录 [--check]');
const roots=args.map(p=>fs.realpathSync(p)),changes=[];
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
const payload=file=>file==='report-hashes.json'?read(path.join(__dirname,'../legacy'),'pricing-report-hashes.json'):read(path.join(__dirname,'../shared'),file);
function add(root,file,text){
 const dest=path.join(root,file),old=fs.existsSync(dest)?fs.readFileSync(dest):null;
 if(old?.equals(Buffer.from(text)))return;
 if(/\.(?:cjs|js)$/.test(file))new vm.Script(text,{filename:file});
 if(file.endsWith('.html'))for(const match of text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:file});
 changes.push({root,file,dest,old,text});
}
function report(root,file){
 const text=read(root,file),normalized=text.replaceAll('\r\n','\n');
 const hash=crypto.createHash('sha256').update(normalized).digest('hex');
 const supported=JSON.parse(payload('report-hashes.json'));
 if(!supported.includes(hash))throw Error('共享报表版本不匹配，未写入：'+path.join(root,file));
 add(root,file,payload('production-report.js'));
}
function shared(root,prefix){
 add(root,prefix+'authority-commands.cjs',rules.commands(read(root,prefix+'authority-commands.cjs')));
 report(root,prefix+'production-report.js');
 add(root,prefix+'pricing-report.cjs',payload('pricing-report.cjs'));
 add(root,prefix+'pricing-records.cjs',payload('pricing-records.cjs'));
}
if(mode==='cloud'){
 const root=roots[0];
 for(const file of ['package.json','Dockerfile','production/server.js','production/index.html','cloud/public/authority.js','production/authority-store.cjs'])read(root,file);
 shared(root,'shared/');
 add(root,'cloud/public/authority.js',rules.ui(read(root,'cloud/public/authority.js')));
 add(root,'production/server.js',patch.server(read(root,'production/server.js')));
 add(root,'production/index.html',patch.html(read(root,'production/index.html')));
 add(root,'production/pricing-records.cjs',payload('pricing-records.cjs'));
}else{
 const [bridge,local]=roots;
 if(bridge===local)throw Error('桥接目录与原3d-server目录不能相同');
 read(bridge,'collector/agent.mjs');
 const config=JSON.parse(read(local,'config.json')),server=read(local,'server.js');
 if(config.sync?.enabled||config.role==='slave')throw Error('检测到原主从同步仍启用，请先按既有统一记账流程核实同步方式；未修改文件');
 if(!server.includes('business-sync-adapter.cjs'))throw Error('原3d-server缺少现有桥接接口。请先在备份及停机后用现有桥接安装器恢复接口，再运行本包；不要直接覆盖整份server.js。');
 shared(bridge,'shared/');
 shared(local,'');
 add(local,'server.js',patch.server(server));
 add(local,'index.html',patch.html(read(local,'index.html')));
}
console.log('检查通过：'+changes.length+' 个程序文件需要更新。不会修改配置、数据库、附件或同步身份。');
if(check){console.log('只检查，未写入文件。');process.exit(0);}
if(!changes.length){console.log('已是本次版本，无需修改。');process.exit(0);}
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupName='.fdm-pricing-backup-'+stamp;
// Backups include a manifest so newly added files can also be removed during code rollback.
for(const root of new Set(changes.map(c=>c.root))){
 const backup=path.join(root,backupName);fs.mkdirSync(backup,{recursive:true});
 const entries=changes.filter(c=>c.root===root);
 for(const c of entries)if(c.old){const file=path.join(backup,c.file);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,c.old);}
 fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(entries.map(c=>({file:c.file,existed:!!c.old})),null,2));
 console.log('代码备份：'+backup);
}
const written=[];
try{
 for(const c of changes){fs.mkdirSync(path.dirname(c.dest),{recursive:true});const tmp=c.dest+'.fdm-tmp';try{fs.writeFileSync(tmp,c.text);fs.renameSync(tmp,c.dest);written.push(c);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
}catch(error){
 const failures=[];for(const c of written.reverse())try{if(c.old)fs.writeFileSync(c.dest,c.old);else fs.unlinkSync(c.dest);}catch(e){failures.push(c.dest+': '+e.message);}
 throw Error('更新失败，已尝试恢复程序文件：'+error.message+(failures.length?'\n恢复失败，请保持停机：\n'+failures.join('\n'):''));
}
console.log('程序文件已更新。尚未重建云端容器或启动服务；请按部署说明继续。');
