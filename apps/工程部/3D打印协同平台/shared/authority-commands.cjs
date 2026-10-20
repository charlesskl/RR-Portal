let core;try{core=require('./business-sync.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;core=require('./business-sync-core.cjs');}
const collections=['products','materials','records','schedules','maintenance','miscExpenses','inventory','settings','days'];
const safe=k=>typeof k==='string'&&k.length>0&&k.length<256&&!['__proto__','prototype','constructor'].includes(k);
const hash=x=>core.fingerprint({value:x??null});
function validate(c){
 if(!c||!safe(c.id)||!collections.includes(c.collection)||!['set','create','delete','stock','task'].includes(c.operation))throw Error('不支持的修改申请');
 if(!safe(c.key)||!safe(c.reason)||!c.expected)throw Error('修改申请缺少对象、原因或版本');
 if(c.operation==='task'&&(c.collection!=='schedules'||!safe(c.value?.externalJobId)))throw Error('生产任务参数无效');
 if(c.operation==='stock'&&(c.collection!=='inventory'||!Number.isFinite(c.delta)||c.delta===0))throw Error('库存变动量无效');
 if(c.collection==='settings'&&c.key!=='business')throw Error('设置对象无效');
 if(c.operation==='create'&&!['products','materials','records','schedules','maintenance','miscExpenses'].includes(c.collection))throw Error('该资料不支持新增');
 if(c.operation==='delete'&&['inventory','settings','days'].includes(c.collection))throw Error('库存和设置不可直接删除');
 if(c.operation==='set'&&c.collection==='inventory')throw Error('库存请使用出入库或盘点申请');
 const allowed={products:['name','material','customer','weight','qty','time','price','process','image','remark'],materials:['name','priceKg','density','remark'],records:['date','machine','status','productName','material','weight','qty','time','designFee','price','customer','remark'],schedules:['date','machine','productName','material','qty','weight','status','remark','priority','externalJobId','revision'],maintenance:['date','machine','cost','remark','type'],miscExpenses:['date','cost','remark','type','name'],days:['off'],settings:['machines','elecPerMachine','laborPerDay','resinQuotePerGram','resinElecPerDay','resinLaborPerDay','lossRate','profitRate']};
 if(c.value!==undefined){
  if(!c.value||typeof c.value!=='object'||Array.isArray(c.value))throw Error('修改内容无效');if(!allowed[c.collection]||Object.keys(c.value).some(k=>!allowed[c.collection].includes(k)))throw Error('修改包含未支持的字段');
  for(const k of Object.keys(c.value))if(!safe(k)||/password|token|secret|accesscode|credential/i.test(k)||['id','_id','_uid','sourceRecordId','cloudJobId'].includes(k))throw Error('不允许修改身份或凭据字段');
  if(c.collection==='settings'&&Object.values(c.value).some(v=>!Number.isFinite(v)||v<0))throw Error('设置必须为非负数字');
  for(const [k,v]of Object.entries(c.value))if(['weight','qty','time','price','priceKg','density','revision','designFee','cost','stockG','minStockG','amountG'].includes(k)&&(!Number.isFinite(v)||v<0))throw Error(k+' 必须是非负数');
 }
 return c;
}
function objectAt(doc,c){return c.collection==='settings'?doc.settings:doc[c.collection]?.[c.key];}
function apply(original,command){
 const c=validate(command),doc=core.project(original),old=objectAt(doc,c);
 if(c.operation!=='task'&&hash(old)!==c.expected)throw Error('该项现场资料已更新，请刷新后重新提交');
 if(c.operation==='create'&&old!==undefined)throw Error('新增对象已存在');
 if(!['create','task'].includes(c.operation)&&old===undefined)throw Error('对象不存在');
 const stamp=new Date().toISOString();let key=c.key;
 if(c.operation==='task'){
  let existing=Object.entries(doc.schedules).find(([,r])=>r.externalJobId===c.value.externalJobId);
  if(!existing&&c.existingKey){const row=doc.schedules[c.existingKey];if(!row||hash(row)!==c.existingHash)throw Error('原排期已变化，请核对任务关联');existing=[c.existingKey,row];}
  if(existing&&Number(existing[1].revision||0)>Number(c.value.revision||0))return {data:original,result:{key:existing[0],operation:'task',superseded:true,at:stamp}};
  const id=existing?existing[1].id:Math.max(0,...Object.values(doc.schedules).map(x=>Number(x.id)||0))+1;
  key=String(id);doc.schedules[key]={...existing?.[1],...c.value,id,_uid:existing?.[1]._uid||c.id};
 }else if(c.operation==='stock'){
  const balance=Math.round((old.stockG+c.delta)*100)/100;if(balance<0)throw Error('库存不足，未执行');
  doc.inventory[c.key]={...old,stockG:balance};
  const id=Math.max(0,...Object.values(doc.stockInLogs).map(x=>Number(x.id)||0))+1;
  doc.stockInLogs[String(id)]={id,_uid:c.id,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp)),material:c.key,amountG:c.delta,remark:c.reason,vendor:'[平台申请]',cost:0};
 }else if(c.operation==='delete'){
  if(c.collection==='records')doc.records[c.key]={...old,_deleted:true};
  else {
   if(['materials','products'].includes(c.collection)&&[...Object.values(doc.records),...Object.values(doc.schedules),...(c.collection==='materials'?Object.values(doc.products):[])].some(r=>!r._deleted&&(c.collection==='products'?r.productName===old.name:r.material===old.name)))throw Error('资料已被生产记录使用，请在现场核对后处理');
   delete doc[c.collection][c.key];
  }
 }else{
  if(!c.value)throw Error('修改内容不能为空');
  let row={...old,...c.value};
  if(c.operation==='create'){
   if(c.collection==='records'){key=c.id;row={...row,_id:c.id};}
   else{const id=Math.max(0,...Object.values(doc[c.collection]).map(x=>Number(x.id)||0))+1;key=String(id);row={...row,id,_uid:c.id};}
  }
  if(c.collection==='records'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isInteger(row.machine)||row.machine<1||row.machine>50||!Number.isInteger(row.qty)||row.qty<1)throw Error('记录日期、现场机台或数量无效');
   doc.days[row.date]||={off:false};
  }
  if(['products','materials'].includes(c.collection)){
   if(typeof row.name!=='string'||!row.name.trim())throw Error('名称不能为空');
   if(Object.entries(doc[c.collection]).some(([id,p])=>id!==key&&p.name===row.name))throw Error('同名资料已存在');
   if(old&&row.name!==old.name)throw Error('重命名涉及历史引用，请在原系统操作');
  }
  if(c.collection==='settings')doc.settings=row;else doc[c.collection][key]=row;
 }
 return {data:core.apply(original,doc),result:{key,operation:c.operation,collection:c.collection,at:stamp}};
}
module.exports={validate,apply,hash,objectAt,collections};
