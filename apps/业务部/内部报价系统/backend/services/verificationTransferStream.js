const fs=require('node:fs');
const {createGunzip,gunzipSync}=require('node:zlib');
const {createInterface}=require('node:readline');
const {Transform}=require('node:stream');
const {validateBundle,digest,insertRecord}=require('./verificationTransfer');
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
async function* records(file){
  if(!/\.jsonl(?:\.gz)?$/i.test(file.originalname)){
    let bundle;
    try{
      const raw=await fs.promises.readFile(file.path);
      const bytes=raw[0]===0x1f&&raw[1]===0x8b?gunzipSync(raw,{maxOutputLength:20*1024*1024}):raw;
      if(bytes.length>20*1024*1024)fail('整包过大，请使用 JSONL/GZIP 分行导入包或分批导入');
      bundle=JSON.parse(bytes.toString('utf8'));
    }catch(error){if(error.status)throw error;fail('导入包无效或整包过大，请使用 JSONL/GZIP 分行导入包或分批导入');}
    validateBundle(bundle);yield* bundle.records;return;
  }
  const input=fs.createReadStream(file.path),unzip=/\.gz$/i.test(file.originalname)?createGunzip():null;
  let bytes=0,lineBytes=0;
  const limit=new Transform({transform(chunk,encoding,done){
    bytes+=chunk.length;
    for(const byte of chunk){lineBytes=byte===10?0:lineBytes+1;if(lineBytes>10*1024*1024)return done(Error('单张核价资料超过 10 MB'));}
    done(bytes>160*1024*1024?Error('导入包展开后超过 160 MB'):null,chunk);
  }});
  if(unzip)input.on('error',e=>limit.destroy(e));
  const decoded=unzip?input.pipe(unzip):input;
  decoded.on('error',e=>limit.destroy(e));
  const lines=createInterface({input:decoded.pipe(limit),crlfDelay:Infinity});
  let header=false,count=0;
  try{
    for await(const line of lines){
      if(!line.trim())continue;
      let value;try{value=JSON.parse(line);}catch{fail('导入包含无效的 JSON 行');}
      if(!header){if(value.format!=='rr-verification-transfer-jsonl-v1')fail('分行导入包格式无效');header=true;continue;}
      if(++count>1000)fail('每包最多 1000 张资料');
      validateBundle({format:'rr-verification-transfer-v1',records:[value]});yield value;
    }
    if(!header||!count)fail('导入包为空');
  }finally{lines.close();input.destroy();unzip?.destroy();limit.destroy();}
}
async function planFile(db,file,factoryCode){
  const items=[],codes=new Set();
  for await(const record of records(file)){
    const q=record.quote,hash=digest(record);
    if(codes.has(q.quote_no))fail(`导入包货号重复：${q.quote_no}`);codes.add(q.quote_no);
    const existing=await db.prepare('SELECT id FROM quotes WHERE factory_code=? AND quote_no=?').get(factoryCode,q.quote_no);
    const applied=await db.prepare("SELECT detail FROM audit_log WHERE action='verification_transfer_import' AND detail=?").get(JSON.stringify({factory:factoryCode,hash}));
    if(!applied&&existing)fail(`客户 ${q.customer} 货号 ${q.quote_no} 已有资料，本次不覆盖，请先核对`);
    items.push({customer:q.customer,quote_no:q.quote_no,status:applied?'already_imported':'new',hash});
  }
  return {count:items.length,new_count:items.filter(p=>p.status==='new').length,existing_count:items.filter(p=>p.status==='already_imported').length,token:digest([factoryCode,items]),items};
}
async function applyFile(db,file,{factoryCode,actor,expectedToken}){
  return db.transaction(async()=>{
    if(db.pool)await db.prepare('SELECT code FROM factories WHERE code=? FOR UPDATE').get(factoryCode);
    const plan=await planFile(db,file,factoryCode);if(plan.token!==expectedToken)fail('导入预览已变化，请重新预览');
    let i=0;
    for await(const record of records(file)){
      const item=plan.items[i++];
      if(!item||item.hash!==digest(record))fail('导入包在预览后发生变化，本次未写入');
      if(item.status==='new')await insertRecord(db,record,{factoryCode,actor,hash:item.hash});
    }
    if(i!==plan.items.length)fail('导入包在预览后发生变化，本次未写入');
    return {ok:true,count:plan.new_count,already_imported:plan.existing_count};
  })();
}
module.exports={records,planFile,applyFile};
