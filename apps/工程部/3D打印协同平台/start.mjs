import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lockData} from './ops/lock.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),data=path.resolve(process.env.PLATFORM_DATA_DIR||path.join(root,'data'));
mkdirSync(data,{recursive:true});
const unlock=lockData(data,'platform');
const production=process.env.APP_MODE==='production';
const cloudPort=process.env.PORT||'3100', internalPort=process.env.PRODUCTION_PORT||'3102';
const secretFile=path.join(data,'secrets.json');
if(!existsSync(secretFile))writeFileSync(secretFile,JSON.stringify({internal:randomBytes(32).toString('hex'),collector:randomBytes(32).toString('hex')}),{mode:0o600});
const secret=JSON.parse(readFileSync(secretFile));
const env={...process.env,PORT:cloudPort,PRODUCTION_PORT:internalPort,DATA_DIR:path.join(data,'orders'),PRODUCTION_SOURCE:path.join(data,'production-source.json'),PRODUCTION_DB:path.join(data,'production.sqlite'),PRODUCT_FILES_DIR:path.join(data,'product-files'),INTERNAL_TOKEN:secret.internal,COLLECTOR_TOKEN:secret.collector,...(existsSync(path.join(data,'stations.json'))?{COLLECTOR_STATIONS:readFileSync(path.join(data,'stations.json'),'utf8')}:{})};
const children=[];let stopping=false;
function start(file,extra={}){const p=spawn(process.execPath,[file],{cwd:root,env:{...env,...extra},stdio:'inherit'});children.push(p);p.on('exit',code=>{if(!stopping){console.error('子服务退出：'+file);stop(code||1);}});return p;}
function stop(code=0){
 if(stopping)return;stopping=true;
 Promise.all(children.map(p=>new Promise(resolve=>{if(p.exitCode!==null||p.signalCode!==null)return resolve();p.once('exit',resolve);p.kill('SIGTERM');}))).then(()=>{unlock();process.exit(code);});
 setTimeout(()=>{console.error('子进程未及时停止，保留目录锁，请检查进程');process.exit(1);},10000).unref();
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
start('production/server.js');start('cloud/server.mjs');
if(!production&&!process.argv.includes('--cloud-only')){
 const file=path.join(data,'collector.json');writeFileSync(file,JSON.stringify({mode:'simulation',cloudUrl:`http://127.0.0.1:${cloudPort}`,token:secret.collector}),{mode:0o600});
 start('collector/agent.mjs',{COLLECTOR_CONFIG:file,COLLECTOR_CONSOLE_PORT:process.env.COLLECTOR_CONSOLE_PORT||'3103',COLLECTOR_DATA_DIR:path.join(data,'collector')});
}
console.log(`独立整合版：http://127.0.0.1:${cloudPort}/platform`);
