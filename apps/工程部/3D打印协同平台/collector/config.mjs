import path from 'node:path';
import {readFileSync} from 'node:fs';
const placeholder=value=>typeof value==='string'&&/REPLACE|YOUR[-_]|ABSOLUTE|填写|示例/i.test(value);
export function validateConfig(config) {
 const errors=[];
 if(!config||typeof config!=='object'||Array.isArray(config))return ['配置必须是 JSON 对象'];
 if(!['live','simulation','bridge'].includes(config.mode))errors.push('mode 必须是 live、bridge 或 simulation');
 try {
  const url=new URL(config.cloudUrl);
  if(!['https:','http:'].includes(url.protocol)||(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)))errors.push('远程平台地址必须使用 HTTPS');
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')errors.push('平台地址只填写站点根地址，不包含账号、路径或查询参数');
  if(placeholder(url.hostname)||url.hostname.endsWith('.example'))errors.push('请填写实际平台地址');
 } catch {errors.push('cloudUrl 不是有效地址');}
 if(typeof config.token!=='string'||config.token.length<32||placeholder(config.token))errors.push('请配置至少 32 位的本站专用令牌');
 if(config.consolePort!==undefined&&(!Number.isInteger(config.consolePort)||config.consolePort<1024||config.consolePort>65535))errors.push('consolePort 必须是 1024–65535 的整数');
 const ids=new Set();let total=0;
 for(const [key,credential]of [['bambuPrinters','accessCode'],['flashForgePrinters','checkCode']]){
  if(config[key]!==undefined&&!Array.isArray(config[key])){errors.push(key+' 必须是数组');continue;}
  for(const [index,printer]of (config[key]||[]).entries()){
   const label=key+' 第 '+(index+1)+' 台';total++;
   if(!printer||typeof printer!=='object'){errors.push(label+' 配置无效');continue;}
   const id=String(printer.id??'');
   if(!/^[1-9]\d*$/.test(id))errors.push(label+' 机台编号必须是正整数');
   if(ids.has(id))errors.push(label+' 机台编号重复');ids.add(id);
   for(const field of ['name','host','serial',credential])if(typeof printer[field]!=='string'||!printer[field].trim()||placeholder(printer[field]))errors.push(label+' 请填写 '+field);
   if(typeof printer.host==='string'&&!/^[a-zA-Z0-9.:-]+$/.test(printer.host))errors.push(label+' host 只填写设备 IP 或主机名');
  }
 }
 if(config.mode==='bridge'){
  const b=config.legacy||{};
  try {const u=new URL(b.url);if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();}catch{errors.push('原系统地址必须是同一电脑的回环根地址');}
  if(typeof b.username!=='string'||!b.username||b.username.includes(':')||typeof b.password!=='string'||!b.password||placeholder(b.username)||placeholder(b.password))errors.push('请在现场填写原系统登录账号和密码');
  const map=b.machineMap;
  if(!map||typeof map!=='object'||Array.isArray(map)||!Object.keys(map).length||Object.entries(map).some(([a,b])=>!(/^[1-9]\d*$/.test(a)&&/^[1-9]\d*$/.test(String(b))))||new Set(Object.values(map).map(String)).size!==Object.keys(map).length)errors.push('machineMap 必须配置不重复的原机台编号到平台机台编号映射');
  if(total)errors.push('桥接模式不配置直连打印机');
 }
 if(config.mode==='live'){

  if(total===0)errors.push('真实模式至少配置一台打印机');
 }
 if(['live','bridge'].includes(config.mode)){
  if(typeof config.bindingsFile!=='string'||!path.isAbsolute(config.bindingsFile)||placeholder(config.bindingsFile))errors.push('bindingsFile 必须是本机实际绝对路径');
 }
 return errors;
}
export function loadConfig(file){
 let config;try{config=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('无法读取配置文件或 JSON 格式错误，请检查文件路径和格式');}
 const errors=validateConfig(config);if(errors.length)throw Error(errors.join('\n'));return config;
}
