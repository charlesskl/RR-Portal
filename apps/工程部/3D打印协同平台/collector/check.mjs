import {accessSync,constants,existsSync} from 'node:fs';
import path from 'node:path';
import {loadConfig} from './config.mjs';
try {
 const file=process.argv[2]||process.env.COLLECTOR_CONFIG;
 if(!file)throw Error('用法：node collector/check.mjs 配置文件 [--platform]');
 const config=loadConfig(file);
 if(config.bindingsFile){accessSync(path.dirname(config.bindingsFile),constants.W_OK);if(existsSync(config.bindingsFile))accessSync(config.bindingsFile,constants.R_OK|constants.W_OK);}
 console.log('配置格式通过；未连接打印机。');
 if(process.argv.includes('--platform')){
  const response=await fetch(new URL('/api/collector/jobs',config.cloudUrl),{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok)throw Error('平台认证失败，HTTP '+response.status+'；检查站点令牌和平台地址');
  const body=await response.json();
  if(!Array.isArray(body.machines))throw Error('平台版本尚未提供机台授权检查，请先更新平台');
  const printers=config.mode==='bridge'?Object.values(config.legacy.machineMap).map(id=>({id})):[...(config.bambuPrinters||[]),...(config.flashForgePrinters||[])];
  if(printers.some(p=>!body.machines.includes(String(p.id))))throw Error('存在未被本站授权的机台编号，请检查平台 stations.json');
  console.log('平台认证与机台授权通过。此检查不证明打印机在线或型号兼容。');
 }
} catch(e){
 // File system/network errors may contain local addresses or credentials; show only controlled messages.
 console.error(e.code?'检查失败：请检查路径权限或网络连接。':e.message==='fetch failed'?'无法连接平台，请检查地址、网络和证书。':e.message);
 process.exitCode=1;
}
