const {createHash}=require('node:crypto');
const jsonStream=require('./json-stream.cjs');
const arrays=['products','materials','schedules','maintenance','miscExpenses','stockInLogs'];
const ignored=new Set(['_updatedAt','_mergedAt','_sourceFacts','sourceStation','sourceRecordId','platformMachine','inventorySync','inventoryReview','inventoryReason','inventoryDeduction','qualitySettled','cloudJobId','cloudAttempt','orderId','orderNumber','cloudManaged','printerOutcome']);
const settingKeys=['machines','elecPerMachine','laborPerDay','resinQuotePerGram','resinElecPerDay','resinLaborPerDay','lossRate','profitRate'];
const safeKey=k=>!['__proto__','constructor','prototype'].includes(String(k));
const localMetadata=row=>Object.fromEntries(Object.entries(row||{}).filter(([k])=>ignored.has(k)));
const blocked=/password|token|secret|accesscode|checkcode|credential/i;
function clean(x){if(Array.isArray(x))return x.map(clean);if(x&&typeof x==='object'){const y={};for(const k of Object.keys(x).sort()){if(['__proto__','constructor','prototype'].includes(k)||ignored.has(k)||blocked.test(k))continue;y[k]=clean(x[k]);}return y;}return x;}
const equal=jsonStream.equal;
function project(data){
 const out={};
 for(const name of arrays){out[name]={};for(const row of data[name]||[]){if(row.id===undefined)throw Error(name+' 存在缺少 ID 的数据，请先修复');const key=String(row.id);if(!safeKey(key))throw Error('无效 ID');if(Object.hasOwn(out[name],key))throw Error(name+' ID 重复：'+key);out[name][key]=clean(row);}}
 out.records={};out.days={};
 for(const [date,day]of Object.entries(data.records||{})){out.days[date]={off:!!day.off};for(const item of day.items||[]){const id=item.sourceRecordId||item._id;if(!id||!safeKey(id))throw Error('生产记录缺少 ID');if(out.records[id])throw Error('生产记录 ID 重复：'+id);out.records[id]={...clean(item),_id:id,date};}}
 out.inventory=clean(data.inventory||{});
 out.settings={};for(const k of settingKeys)if(data.settings?.[k]!==undefined)out.settings[k]=data.settings[k];
 return clean(out);
}
function fingerprint(data){const hash=createHash('sha256');for(const part of jsonStream.parts(clean(data)))hash.update(part);return hash.digest('hex');}
// Product identities survive old Windows adapters as ordinary row fields.
const identityKey='_printlinkProductIdentity';
const validIdentity=value=>typeof value==='string'&&/^printlink-product-v1:[a-f0-9]{64}$/.test(value);
const canKeepBoth=c=>c.path?.length===2&&c.path[0]==='products'&&c.baseMissing&&!c.cloudMissing&&!c.windowsMissing&&!c.cloud?._deleted&&!c.windows?._deleted&&
 (!Object.hasOwn(c.cloud||{},identityKey)||validIdentity(c.cloud[identityKey]))&&(!Object.hasOwn(c.windows||{},identityKey)||validIdentity(c.windows[identityKey]))&&
 !(c.cloud?.[identityKey]&&c.cloud[identityKey]===c.windows?.[identityKey]);
function withIdentity(row,identity){
 if(!row)return row;
 if(Object.hasOwn(row,identityKey)&&row[identityKey]!==identity)throw Error('产品同步身份字段已变化，请保留资料并核对产品 '+row.id);
 return row[identityKey]===identity?row:{...row,[identityKey]:identity};
}
function productRows(doc,rows){return {...doc,products:{...doc.products,...rows}};}
// Copy changed containers only; retain inline image strings and untouched rows.
function rewriteReferences(value,from,to){
 if(!value||typeof value!=='object')return value;
 let result=value;
 for(const [key,child]of Object.entries(value)){
  const next=key==='productId'&&String(child)===String(from)?(typeof child==='string'?String(to):to):rewriteReferences(child,from,to);
  if(next!==child){if(result===value)result=Array.isArray(value)?value.slice():{...value};result[key]=next;}
 }
 return result;
}
function remapProduct(doc,from,to,identity){
 const result=rewriteReferences(doc,from,to),products={...result.products},row=products[from];delete products[from];
 if(row)products[String(to)]={...withIdentity(row,identity),id:to};
 return {...result,products};
}
function numberingConflict(mapping,windows){
 const path=['产品编号归属',String(mapping.from)],id=JSON.stringify(path);
 return {id,path,signature:fingerprint({mapping,windows}),base:null,baseMissing:true,cloudMissing:false,windowsMissing:false,
  cloud:{说明:'现场已采用新平台编号，保留现场当前编号，不再次重编号',原编号:mapping.from,现场产品新编号:mapping.to},
  windows:{说明:'现场仍采用原系统旧编号，原编号的现场产品需要重编号',原编号:mapping.from,现场产品新编号:mapping.to}};
}
// Three-way merge: simultaneous changes to a field never silently win.
function merge(base,cloud,windows,choices={},productRemaps=[]){
 const acknowledged=m=>m.cloudIdentity?base?.products?.[m.from]?.[identityKey]===m.cloudIdentity||base?.products?.[String(m.to)]?.[identityKey]===m.windowsIdentity:!!base?.products?.[String(m.to)];
 const remaps=productRemaps.filter(m=>!acknowledged(m)).map(m=>({...m}));
 const approved=new Map(),identityConflicts=[],remoteWindows=windows,pendingCloudRows={};
 for(const m of remaps){
  const source=remoteWindows.products?.[m.from],target=remoteWindows.products?.[String(m.to)];
  let space,confirmed=false;
  if(m.cloudIdentity&&source?.[identityKey]===m.cloudIdentity||m.windowsIdentity&&target?.[identityKey]===m.windowsIdentity)space='cloud';
  else if(m.windowsIdentity&&source?.[identityKey]===m.windowsIdentity)space='windows';
  // A captured, untouched source version also identifies the pre-CAS proposal.
  // Edited unmarked rows or stripped markers need an explicit current choice.
  else if(m.sourceHash&&source&&!Object.hasOwn(source,identityKey)&&fingerprint(source)===m.sourceHash)space='windows';
  else{
   const conflict=numberingConflict(m,remoteWindows),choice=choices[conflict.id];
   if(choice?.signature===conflict.signature&&['cloud','windows'].includes(choice.side)){space=choice.side;confirmed=true;}
   else{identityConflicts.push(conflict);continue;}
  }
  if(space==='windows'&&target)throw Error('产品重编号目标已被现场其他产品占用，请核对产品 '+m.to);
  // Legacy from/to-only receipts require namespace confirmation and retain
  // ordinary product conflicts: they have no previously approved row versions.
  if(!m.cloudIdentity||!m.windowsIdentity){
   const seed=fingerprint({from:m.from,to:m.to,cloud:cloud.products,windows:windows.products});
   m.cloudIdentity='printlink-product-v1:'+fingerprint({seed,side:'cloud'});m.windowsIdentity='printlink-product-v1:'+fingerprint({seed,side:'windows'});
   cloud=productRows(cloud,{...(cloud.products?.[m.from]?{[m.from]:withIdentity(cloud.products[m.from],m.cloudIdentity)}:{}),...(cloud.products?.[String(m.to)]?{[String(m.to)]:withIdentity(cloud.products[String(m.to)],m.windowsIdentity)}:{})});
   if(space==='cloud')windows=productRows(windows,{...(source?{[m.from]:withIdentity(source,m.cloudIdentity)}:{}),...(target?{[String(m.to)]:withIdentity(target,m.windowsIdentity)}:{})});
  }
  if(confirmed&&space==='cloud')windows=productRows(windows,{...(source?{[m.from]:withIdentity(source,m.cloudIdentity)}:{}),...(target?{[String(m.to)]:withIdentity(target,m.windowsIdentity)}:{})});
  if(m.cloudVersion)approved.set(m.from,m.cloudVersion);
  if(m.windowsVersion)approved.set(String(m.to),m.windowsVersion);
  if(space==='windows'){
   windows=remapProduct(windows,m.from,m.to,m.windowsIdentity);
   // Before CAS, Windows has never received this approved cloud product.
   if(m.cloudVersion)pendingCloudRows[m.from]=m.cloudVersion;
  }
 }
 if(identityConflicts.length)return {data:cloud,conflicts:identityConflicts,productRemaps:remaps};
 if(Object.keys(pendingCloudRows).length)windows=productRows(windows,pendingCloudRows);
 let nextId=0;for(const d of [base,cloud,windows])for(const id of Object.keys(d?.products||{})){const n=Number(id);if(Number.isSafeInteger(n))nextId=Math.max(nextId,n);}
 const absent=undefined;let conflicts=[],newRemaps=[];
 function walk(b,c,w,path,allowSplit){
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const productBase=path[0]==='products'&&approved.has(path[1]);
  if(path.length===2&&productBase)b=approved.get(path[1]);
  const differentIdentity=path.length===2&&path[0]==='products'&&object(c)&&object(w)&&
   (Object.hasOwn(c,identityKey)||Object.hasOwn(w,identityKey))&&c[identityKey]!==w[identityKey];
  if(object(c)&&object(w)&&object(b)&&!differentIdentity){
   const out={};for(const key of new Set([...Object.keys(b),...Object.keys(c),...Object.keys(w)])){const val=walk(b[key],c[key],w[key],[...path,key],allowSplit);if(val!==absent)out[key]=val;}return out;
  }
  const concurrentStock=!!base&&path[0]==='inventory'&&path.at(-1)==='stockG'&&!equal(c,b)&&!equal(w,b);
  if(equal(c,w)&&!concurrentStock)return c;
  if(!differentIdentity&&(base||productBase)){if(equal(c,b))return w;if(equal(w,b))return c;}
  const id=JSON.stringify(path),signature=fingerprint({base:[b!==undefined,b??null],cloud:[c!==undefined,c??null],windows:[w!==undefined,w??null]});
  if(choices[id]?.signature===signature){
   if(['cloud','windows'].includes(choices[id].side))return choices[id].side==='cloud'?c:w;
   if(allowSplit&&choices[id].side==='both'&&canKeepBoth({path,baseMissing:b===undefined,cloudMissing:c===undefined,windowsMissing:w===undefined,cloud:c,windows:w})){
    if(!Number.isSafeInteger(++nextId))throw Error('产品编号超出安全范围');
    const cloudIdentity=c[identityKey]||'printlink-product-v1:'+fingerprint({signature,side:'cloud',to:nextId});
    const windowsIdentity=w[identityKey]||'printlink-product-v1:'+fingerprint({signature,side:'windows',to:nextId});
    newRemaps.push({from:path[1],to:nextId,cloudIdentity,windowsIdentity,sourceHash:fingerprint(w),cloudVersion:withIdentity(c,cloudIdentity),windowsVersion:{...withIdentity(w,windowsIdentity),id:nextId}});return c;
   }
  }
  conflicts.push({id,path,signature,base:b??null,cloud:c??null,windows:w??null,baseMissing:b===undefined,cloudMissing:c===undefined,windowsMissing:w===undefined});return c;
 }
 const initial=base||Object.fromEntries(Object.keys(cloud).map(k=>[k,{}]));
 let result=walk(initial,cloud,windows,[],true);
 if(newRemaps.length){
  // Finish every source-side rewrite before inserting any cloud-owned rows.
  for(const m of newRemaps)windows=remapProduct(windows,m.from,m.to,m.windowsIdentity);
  const cloudRows={},windowsCloudRows={...pendingCloudRows};
  for(const m of newRemaps){
   m.windowsVersion=windows.products[String(m.to)];
   approved.set(m.from,m.cloudVersion);approved.set(String(m.to),m.windowsVersion);
   cloudRows[m.from]=m.cloudVersion;cloudRows[String(m.to)]=m.windowsVersion;windowsCloudRows[m.from]=m.cloudVersion;
  }
  cloud=productRows(cloud,cloudRows);windows=productRows(windows,windowsCloudRows);
  conflicts=[];result=walk(initial,cloud,windows,[],false);remaps.push(...newRemaps);
 }
 if(!conflicts.length)for(const m of remaps){if(!Object.hasOwn(m,'cloudVersion'))m.cloudVersion=result.products?.[m.from];if(!Object.hasOwn(m,'windowsVersion'))m.windowsVersion=result.products?.[String(m.to)];}
 return {data:result,conflicts,productRemaps:remaps};
}
function validateKeys(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(!safeKey(key)||ignored.has(key)||blocked.test(key))throw Error('同步文档含有保留字段：'+key);validateKeys(child);}}
function apply(original,doc){
 validateKeys(doc);
 if(!doc||typeof doc!=='object'||Array.isArray(doc))throw Error('无效同步文档');
 // Validate the document by round-tripping its business model before storing it.
 const result=structuredClone(original),stamp=Date.now();
 for(const name of arrays){const old=new Map((original[name]||[]).map(x=>[String(x.id),x]));result[name]=Object.values(doc[name]||{}).map(row=>({...localMetadata(old.get(String(row.id))),...row,_updatedAt:stamp}));}
 result.records={};
 const previous=new Map(Object.values(original.records||{}).flatMap(d=>d.items||[]).map(i=>[i.sourceRecordId||i._id,i]));
 for(const [date,day]of Object.entries(doc.days||{}))result.records[date]={off:!!day.off,items:[]};
 for(const [id,entry]of Object.entries(doc.records||{})){const {date,...item}=entry;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||id!==item._id)throw Error('生产记录格式无效');const old=previous.get(id);result.records[date]||={off:false,items:[]};result.records[date].items.push({...localMetadata(old),...item,_id:old?._id||id,_updatedAt:stamp,_mergedAt:stamp});}
 result.inventory=structuredClone(doc.inventory||{});for(const row of Object.values(result.inventory)){if(!Number.isFinite(row.stockG)||row.stockG<0)throw Error('库存数量无效');row._updatedAt=stamp;}
 result.settings={...original.settings};for(const k of settingKeys)delete result.settings[k];Object.assign(result.settings,doc.settings);result._snapshotUpdatedAt=stamp;
 if(!equal(project(result),clean(doc)))throw Error('同步文档含有不支持的字段或格式');return result;
}
module.exports={project,apply,merge,fingerprint,canKeepBoth};
