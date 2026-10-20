const {createHash}=require('node:crypto');
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateBundle(bundle){
 if(bundle?.format!=='rr-verification-transfer-v1'||!Array.isArray(bundle.records)||!bundle.records.length||bundle.records.length>1000)fail('核价导入包格式无效');
 const keys=new Set();
 for(const record of bundle.records){
  const q=record.quote,key=q?.quote_no;
  if(!q||!['customer','quote_no','product_name'].every(k=>typeof q[k]==='string'&&q[k].trim()&&q[k].length<=500)||keys.has(key))fail('导入包客户和货号缺失或重复');keys.add(key);
  if(!Array.isArray(record.versions)||!record.versions.length)fail('缺少核价版本');
  const numbers=new Set();
  for(const v of record.versions){
   if(!Number.isSafeInteger(v.version_no)||v.version_no<1||numbers.has(v.version_no)||!['drafting','in_review','ready','completed'].includes(v.status))fail('核价版本无效');numbers.add(v.version_no);
   if(!Array.isArray(v.sections)||v.sections.length!==8||new Set(v.sections.map(s=>s.dept)).size!==8)fail('核价部门资料不完整');
   for(const s of v.sections)if(!['sales','engineering','electronic','molding','painting','slush','sewing','assembly'].includes(s.dept)||!s.payload||typeof s.payload!=='object'||Array.isArray(s.payload)||!['empty','filled','approved','rejected'].includes(s.status))fail('核价部门资料无效');
   if(v.status==='completed'&&v.sections.some(s=>s.status!=='approved'))fail('已完成版本必须全部审核通过');
  }
  if(!record.baseline?.sections?.length||!record.versions[0].sections.find(s=>s.dept==='sales').payload.legacy_import)fail('只支持已导入的历史核价资料');
 }
 return bundle;
}
async function planTransfer(db,bundle,factoryCode){
 validateBundle(bundle);const plan=[];
 for(const record of bundle.records){
  const hash=digest(record),q=record.quote;
  const existing=await db.prepare('SELECT id FROM quotes WHERE factory_code=? AND quote_no=?').all(factoryCode,q.quote_no);
  const applied=await db.prepare("SELECT detail FROM audit_log WHERE action='verification_transfer_import' AND detail=?").get(JSON.stringify({factory:factoryCode,hash}));
  if(applied){plan.push({customer:q.customer,quote_no:q.quote_no,status:'already_imported',hash});continue;}
  if(existing.length)fail(`客户 ${q.customer} 货号 ${q.quote_no} 已有资料，本次不覆盖，请先核对`);
  plan.push({customer:q.customer,quote_no:q.quote_no,status:'new',hash});
 }
 return {count:plan.length,new_count:plan.filter(p=>p.status==='new').length,existing_count:plan.filter(p=>p.status==='already_imported').length,token:digest([factoryCode,plan]),items:plan};
}
async function applyTransfer(db,bundle,{factoryCode,actor,expectedToken}){
 return db.transaction(async()=>{
  if(db.pool)await db.prepare('SELECT code FROM factories WHERE code=? FOR UPDATE').get(factoryCode);
  const plan=await planTransfer(db,bundle,factoryCode);if(plan.token!==expectedToken)fail('导入预览已变化，请重新预览');
  for(let i=0;i<bundle.records.length;i++){
   if(plan.items[i].status!=='new')continue;
   await insertRecord(db,bundle.records[i],{factoryCode,actor,hash:plan.items[i].hash});
  }
  return {ok:true,count:plan.new_count,already_imported:plan.existing_count};
 })();
}
async function insertRecord(db,record,{factoryCode,actor,hash}){
   const q=record.quote;
   const inserted=await db.prepare(`INSERT INTO quotes(quote_no,product_name,version,customer,qty,factory_code,status,created_by_name) VALUES (?,?,?,?,?,?,'drafting',?) RETURNING id`).get(q.quote_no,q.product_name,q.version||'V1',q.customer,q.qty??0,factoryCode,actor);
   const id=Number(inserted.id),baseline=structuredClone(record.baseline);baseline.quote={...baseline.quote,id,factory_code:factoryCode};
   for(const s of baseline.sections)await db.prepare("INSERT INTO quote_sections(quote_id,dept,payload_json,status) VALUES (?,?,?,'approved')").run(id,s.dept,JSON.stringify(s.payload||{}));
   await db.prepare(`INSERT INTO quote_customer_confirmations(quote_id,status,confirmed_price,confirmed_qty,confirmed_by,confirmed_at) VALUES (?,'confirmed',?,?,?,datetime('now'))`).run(id,record.confirmation?.confirmed_price??0,record.confirmation?.confirmed_qty??q.qty??0,actor);
   await db.prepare(`INSERT INTO quote_verifications(quote_id,baseline_json,verified_values_json,verified_sections_json,status,created_by,updated_by) VALUES (?,?,'{}','{}',?,?,?)`).run(id,JSON.stringify(baseline),[...record.versions].sort((a,b)=>b.version_no-a.version_no)[0].status==='completed'?'completed':'in_progress',actor,actor);
   const ids=new Map();
   for(const v of [...record.versions].sort((a,b)=>a.version_no-b.version_no)){
    const saved=await db.prepare(`INSERT INTO quote_verification_versions(quote_id,version_no,label,parent_version_id,source_type,status,note,created_by,completed_by,completed_at,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(id,v.version_no,v.label||'V'+v.version_no,ids.get(v.parent_version_no)||null,v.source_type||'quote',v.status,v.note||null,v.created_by||actor,v.status==='completed'?(v.completed_by||actor):null,v.status==='completed'?(v.completed_at||new Date().toISOString()):null,v.category||null,v.created_at||new Date().toISOString(),v.updated_at||new Date().toISOString());
    ids.set(v.version_no,Number(saved.id));
    for(const s of v.sections)await db.prepare(`INSERT INTO quote_verification_sections(version_id,dept,payload_json,status,filled_by,filled_at,reviewed_by,reviewed_at,review_comment) VALUES (?,?,?,?,?,?,?,?,?)`).run(Number(saved.id),s.dept,JSON.stringify(s.payload),s.status,s.filled_by||actor,s.filled_at||null,s.reviewed_by||null,s.reviewed_at||null,s.review_comment||null);
   }
   await db.prepare("INSERT INTO audit_log(quote_id,actor,action,detail) VALUES (?,?,'verification_transfer_import',?)").run(id,actor,JSON.stringify({factory:factoryCode,hash:hash}));
}
module.exports={validateBundle,planTransfer,applyTransfer,digest,insertRecord};
