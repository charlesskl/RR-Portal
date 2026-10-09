const {createHash}=require('node:crypto');
const arrays=['materials','products','schedules','maintenance','stockInLogs','miscExpenses'];
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function stable(x){if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(object(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';return JSON.stringify(x);}
const hash=x=>createHash('sha256').update(stable(x)).digest('hex');
function validate(source){
 if(!object(source)||!arrays.every(k=>Array.isArray(source[k]))||!object(source.records)||!object(source.inventory)||!(source.settings===null||object(source.settings)))throw Error('请选择原系统设置页导出的完整 JSON 业务备份');
 const walk=x=>{if(!x||typeof x!=='object')return;for(const [k,v]of Object.entries(x)){if(['__proto__','prototype','constructor'].includes(k))throw Error('文件含无效字段');if(k==='cloudJobId'&&v)throw Error('只能导入原系统资料，不能导入带云端关联任务的快照');walk(v);}};walk(source);
 for(const k of arrays)if(source[k].some(x=>!object(x)))throw Error(k+' 数据格式错误');
 for(const [date,day]of Object.entries(source.records))if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!object(day)||!Array.isArray(day.items)||day.items.some(x=>!object(x)))throw Error('每日记录格式错误');
 for(const item of Object.values(source.inventory))if(!object(item))throw Error('库存格式错误');
}
function counts(data){return {...Object.fromEntries(arrays.map(k=>[k,(data[k]||[]).length])),recordDays:Object.keys(data.records||{}).length,recordItems:Object.values(data.records||{}).reduce((n,d)=>n+(d.items||[]).length,0),inventory:Object.keys(data.inventory||{}).length};}
function planImport(current,source){
 validate(source);const next=structuredClone(current),conflicts=[];
 function mergeList(old,added,label){const out=structuredClone(old||[]);const key=x=>x._id!=null?'_id:'+x._id:x.id!=null?'id:'+x.id:'hash:'+hash(x);const seen=new Map(out.map(x=>[key(x),x]));for(const entry of added){const k=key(entry),prior=seen.get(k);if(prior){if(stable(prior)!==stable(entry))conflicts.push(label+' 同编号记录存在差异：'+k);}else {const copy=structuredClone(entry);out.push(copy);seen.set(k,copy);}}return out;}
 for(const key of arrays)next[key]=mergeList(current[key],source[key],key);
 next.inventory=structuredClone(current.inventory||{});
 for(const [name,value]of Object.entries(source.inventory)){if(name in next.inventory&&stable(next.inventory[name])!==stable(value))conflicts.push('库存已存在且数值不同：'+name);else next.inventory[name]=structuredClone(value);}
 next.records=structuredClone(current.records||{});
 for(const [date,day]of Object.entries(source.records)){
  const old=next.records[date];if(!old){next.records[date]=structuredClone(day);continue;}
  if(!!old.off!==!!day.off)conflicts.push(date+' 休息日设置不同');
  next.records[date]={...day,...old,items:mergeList(old.items,day.items,date)};
 }
 const populated=Object.values(counts(current)).some(n=>n>0);
 if(current.settings&&source.settings&&stable(current.settings)!==stable(source.settings)&&populated)conflicts.push('云端已有业务，且成本/机台设置与原系统不同');
 else if(source.settings)next.settings=structuredClone(source.settings);
 return {next,summary:{before:counts(current),incoming:counts(source),after:counts(next)},conflicts:conflicts.slice(0,30),fingerprint:hash({current,source})};
}
module.exports={planImport,counts};
