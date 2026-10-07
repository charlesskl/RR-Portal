import {readdirSync,lstatSync,readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {lockData} from './lock.mjs';

const databases=['orders/printlink.sqlite','production.sqlite'];
function files(dir, prefix='') {
  return readdirSync(path.join(dir,prefix)).sort().flatMap(name=>{
    const rel=prefix?prefix+'/'+name:name;
    if(rel==='.platform-lock') return [];
    const info=lstatSync(path.join(dir,rel));
    if(info.isSymbolicLink() || (!info.isFile()&&!info.isDirectory())) throw Error('不支持链接或特殊文件：'+rel);
    return info.isDirectory()?files(dir,rel):[rel];
  });
}
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function databaseCheck(dir) {
  for(const rel of databases) {
    const db=new DatabaseSync(path.join(dir,rel),{readOnly:true});
    try { if(db.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok')) throw Error('数据库校验失败：'+rel); }
    finally { db.close(); }
  }
}
function freshDestination(source,destination) {
  const src=realpathSync(source),parent=realpathSync(path.dirname(destination));
  const dst=path.join(parent,path.basename(destination));
  if(dst===src || dst.startsWith(src+path.sep)) throw Error('目标不能放在源目录内');
  if(existsSync(dst)) throw Error('目标目录已存在，请使用新的目录以避免覆盖数据');
  return dst;
}
function copyTree(source,destination,list) {
  mkdirSync(destination,{mode:0o700});
  for(const rel of list) {
    const target=path.join(destination,rel);
    mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    // Exclusive creation, private permissions, including station tokens.
    writeFileSync(target,readFileSync(path.join(source,rel)),{flag:'wx',mode:0o600});
  }
}
export function backup(source,destination) {
  source=realpathSync(source); destination=freshDestination(source,path.resolve(destination));
  const unlock=lockData(source,'backup');
  try {
    for(const rel of databases) {
      if(!existsSync(path.join(source,rel))) throw Error('缺少业务数据库：'+rel);
      const db=new DatabaseSync(path.join(source,rel));
      try { if(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy) throw Error('数据库仍在使用，请先停机'); }
      finally { db.close(); }
    }
    databaseCheck(source);
    // The two business services must be stopped together before this snapshot.
    const list=files(source).filter(f=>f!=='collector.json'&&!f.startsWith('collector/')&&!/\.sqlite-(wal|shm)$/.test(f));
    copyTree(source,destination,list);
    for(const rel of databases) {
      const db=new DatabaseSync(path.join(destination,rel));
      try { db.exec('PRAGMA journal_mode=DELETE'); } finally { db.close(); }
    }
    databaseCheck(destination);
    const manifest={version:1,created:new Date().toISOString(),files:list.map(file=>({file,sha256:digest(path.join(destination,file))}))};
    writeFileSync(path.join(destination,'backup-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
    return {directory:destination,files:list.length};
  } catch(e) { if(existsSync(destination)) rmSync(destination,{recursive:true,force:true}); throw e; }
  finally { unlock(); }
}
export function verify(source) {
  source=realpathSync(source);
  const manifest=JSON.parse(readFileSync(path.join(source,'backup-manifest.json'),'utf8'));
  if(manifest.version!==1 || !Array.isArray(manifest.files)) throw Error('不支持的备份清单');
  const actual=files(source).filter(f=>f!=='backup-manifest.json');
  const expected=manifest.files.map(item=>item.file);
  if(new Set(expected).size!==expected.length || JSON.stringify([...expected].sort())!==JSON.stringify(actual.sort())) throw Error('备份文件清单不一致');
  for(const item of manifest.files) {
    if(typeof item.file!=='string'||item.file.split('/').some(p=>p==='..'||p==='.'||!p)||path.isAbsolute(item.file)) throw Error('无效备份路径');
    if(digest(path.join(source,item.file))!==item.sha256) throw Error('备份文件校验失败：'+item.file);
  }
  databaseCheck(source);
  return {directory:source,files:actual.length};
}
export function restore(source,destination) {
  verify(source);
  destination=freshDestination(source,path.resolve(destination));
  try {
    copyTree(source,destination,files(source).filter(f=>f!=='backup-manifest.json'));
    databaseCheck(destination);
    // Restored users retain their passwords, but existing browser sessions must reauthenticate.
    const db=new DatabaseSync(path.join(destination,'orders/printlink.sqlite'));
    try { db.exec('DELETE FROM sessions'); } finally { db.close(); }
    return {directory:destination};
  } catch(e) { if(existsSync(destination)) rmSync(destination,{recursive:true,force:true}); throw e; }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,source,destination]=process.argv.slice(2);
  try {
    if(!source || !['backup','verify','restore'].includes(command) || (command!=='verify'&&!destination)) throw Error('用法：node ops/backup.mjs backup 数据目录 新备份目录 | verify 备份目录 | restore 备份目录 新数据目录');
    console.log(JSON.stringify(command==='backup'?backup(source,destination):command==='verify'?verify(source):restore(source,destination),null,2));
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
