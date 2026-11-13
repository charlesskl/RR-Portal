const fs=require('node:fs'),path=require('node:path');
const arg=process.argv[2];if(!arg)throw Error('用法：node restore-code.cjs 本次.fdm-pricing-backup目录（先停止业务）');
const backup=fs.realpathSync(arg),root=path.dirname(backup);
if(!path.basename(backup).startsWith('.fdm-pricing-backup-'))throw Error('不是本更新器的代码备份目录');
const entries=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8'));
for(const e of entries){if(typeof e.file!=='string'||path.isAbsolute(e.file)||e.file.split(/[\\/]/).includes('..')||typeof e.existed!=='boolean')throw Error('无效备份清单');if(e.existed)fs.accessSync(path.join(backup,e.file));}
for(const e of entries){const target=path.join(root,e.file);if(e.existed){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(backup,e.file),target);}else if(fs.existsSync(target))fs.unlinkSync(target);}
console.log('本次程序文件已恢复；未修改数据库。云端需重新构建，Windows按原启动方式恢复。');
