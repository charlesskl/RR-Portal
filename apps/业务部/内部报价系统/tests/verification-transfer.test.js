const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const {planTransfer,applyTransfer,validateBundle} = require('../backend/services/verificationTransfer');
const depts = ['sales','engineering','electronic','molding','painting','slush','sewing','assembly'];
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  db.prepare("INSERT INTO factories(code,name_cn) VALUES ('qingxi','清溪')").run();
  for (const dept of depts) db.prepare('INSERT INTO departments(code,name_cn,pin_staff,pin_supervisor) VALUES (?,?,?,?)').run(dept,dept,'test-hash','test-hash');
  db.transaction = fn => async()=> {db.exec('BEGIN');try {const result=await fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  return db;
}
function bundle(sku='TEST-1') {
  const sections = depts.map(dept=>({dept,payload:dept==='sales'?{legacy_import:{summary_only:true},pricing_summary:{t1:{base_price:12}}}:{test_value:1},status:'approved'}));
  return {format:'rr-verification-transfer-v1',records:[{quote:{customer:'TEST CUSTOMER',quote_no:sku,product_name:'测试产品',qty:100},confirmation:{confirmed_price:12,confirmed_qty:100},baseline:{quote:{quote_no:sku},sections},versions:[{version_no:1,status:'completed',sections}]}]};
}
test('transfer preserves approved source sections, remaps IDs, and is idempotent',async()=>{
  const db=database();try {
    const data=bundle(),plan=await planTransfer(db,data,'qingxi');
    assert.equal(plan.new_count,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM quotes').get().n,0,'preview does not write');
    await assert.rejects(applyTransfer(db,data,{factoryCode:'qingxi',actor:'tester',expectedToken:'stale'}),/预览已变化/);
    const result=await applyTransfer(db,data,{factoryCode:'qingxi',actor:'tester',expectedToken:plan.token});
    assert.equal(result.count,1);
    const version=db.prepare('SELECT * FROM quote_verification_versions').get();
    assert.equal(version.status,'completed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM quote_verification_sections WHERE status=\'approved\'').get().n,8);
    const baseline=JSON.parse(db.prepare('SELECT baseline_json FROM quote_verifications').get().baseline_json);
    assert.equal(baseline.quote.id,version.quote_id);assert.equal(baseline.quote.factory_code,'qingxi');
    assert.deepEqual(baseline.sections,data.records[0].baseline.sections);
    const replay=await planTransfer(db,data,'qingxi');assert.equal(replay.new_count,0);assert.equal(replay.existing_count,1);
    await applyTransfer(db,data,{factoryCode:'qingxi',actor:'tester',expectedToken:replay.token});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM quotes').get().n,1);
    data.records[0].versions[0].sections[0].payload.changed=1;
    await assert.rejects(planTransfer(db,data,'qingxi'),/已有资料/);
  } finally {db.close();}
});
test('SKU collisions across customers and deleted records are rejected before any write',async()=>{
  const db=database();try {
    db.prepare("INSERT INTO quotes(quote_no,product_name,customer,deleted_at) VALUES ('TEST-1','原产品','OTHER',datetime('now'))").run();
    await assert.rejects(planTransfer(db,bundle(),'qingxi'),/已有资料/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM quote_verifications').get().n,0);
    const duplicate=bundle();duplicate.records.push({...duplicate.records[0],quote:{...duplicate.records[0].quote,customer:'ANOTHER'}});
    assert.throws(()=>validateBundle(duplicate),/重复/);
  } finally {db.close();}
});
test('a mid-batch database failure rolls back quotes, versions, and audit together',async()=>{
  const db=database();try {
    const data=bundle();data.records.push(bundle('TEST-2').records[0]);
    const plan=await planTransfer(db,data,'qingxi');
    db.exec("CREATE TRIGGER test_fail BEFORE INSERT ON quotes WHEN NEW.quote_no='TEST-2' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    await assert.rejects(applyTransfer(db,data,{factoryCode:'qingxi',actor:'tester',expectedToken:plan.token}),/test failure/);
    for(const table of ['quotes','quote_verifications','quote_verification_sections','audit_log'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
  } finally {db.close();}
});
module.exports={database,bundle};

test('streaming GZIP import preserves rows, skips a replay, and rolls back on late failure',async()=>{
 const {gzipSync}=require('node:zlib'),os=require('node:os');
 const {planFile,applyFile}=require('../backend/services/verificationTransferStream');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verification-stream-'));
 const file={path:path.join(dir,'package.gz'),originalname:'package.jsonl.gz'};
 const data=bundle(),second=bundle('TEST-2').records[0];
 const text=[JSON.stringify({format:'rr-verification-transfer-jsonl-v1'}),...data.records.concat(second).map(r=>JSON.stringify(r))].join('\n');
 fs.writeFileSync(file.path,gzipSync(text));
 const db=database();try{
   const plan=await planFile(db,file,'qingxi');assert.equal(plan.new_count,2);
   db.exec("CREATE TRIGGER test_stream_fail BEFORE INSERT ON quotes WHEN NEW.quote_no='TEST-2' BEGIN SELECT RAISE(ABORT,'late failure'); END");
   await assert.rejects(applyFile(db,file,{factoryCode:'qingxi',actor:'tester',expectedToken:plan.token}),/late failure/);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM quotes').get().n,0);
   db.exec('DROP TRIGGER test_stream_fail');
   const result=await applyFile(db,file,{factoryCode:'qingxi',actor:'tester',expectedToken:plan.token});
   assert.equal(result.count,2);assert.equal((await planFile(db,file,'qingxi')).existing_count,2);
   fs.writeFileSync(file.path,gzipSync(text+'\n'+JSON.stringify(data.records[0])));
   await assert.rejects(planFile(db,file,'qingxi'),/货号重复/);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('streaming transfer rejects malformed GZIP and records before any write',async()=>{
 const {gzipSync}=require('node:zlib'),os=require('node:os');
 const {planFile}=require('../backend/services/verificationTransferStream');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verification-stream-invalid-'));
 const file={path:path.join(dir,'package.gz'),originalname:'package.jsonl.gz'},db=database();
 try{
  fs.writeFileSync(file.path,'invalid gzip');await assert.rejects(planFile(db,file,'qingxi'));
  fs.writeFileSync(file.path,gzipSync('{"format":"rr-verification-transfer-jsonl-v1"}\n{"quote":{}}'));
  await assert.rejects(planFile(db,file,'qingxi'),/缺失或重复/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM quotes').get().n,0);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('streaming transfer enforces line size and record limits without writing',async()=>{
 const os=require('node:os'),{records,planFile}=require('../backend/services/verificationTransferStream');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verification-bounds-'));
 const file={path:path.join(dir,'package.jsonl'),originalname:'package.jsonl'},db=database();
 const header=JSON.stringify({format:'rr-verification-transfer-jsonl-v1'})+'\n';
 try {
  fs.writeFileSync(file.path,header+JSON.stringify({...bundle().records[0],padding:'x'.repeat(10*1024*1024)}));
  await assert.rejects(async()=>{for await(const ignored of records(file))void ignored;},/单张核价资料超过/);
  const out=fs.openSync(file.path,'w');try{
   fs.writeSync(out,header);
   for(let i=0;i<1001;i++)fs.writeSync(out,JSON.stringify(bundle('LIMIT-'+i).records[0])+'\n');
  }finally{fs.closeSync(out);}
  await assert.rejects(planFile(db,file,'qingxi'),/最多 1000/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM quotes').get().n,0);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a changed same-SKU record invalidates the preview and leaves existing tables unchanged',async()=>{
 const os=require('node:os'),{planFile,applyFile}=require('../backend/services/verificationTransferStream');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verification-token-'));
 const file={path:path.join(dir,'package.jsonl'),originalname:'package.jsonl'},db=database(),data=bundle();
 const write=()=>fs.writeFileSync(file.path,JSON.stringify({format:'rr-verification-transfer-jsonl-v1'})+'\n'+JSON.stringify(data.records[0]));
 try {
  write();const plan=await planFile(db,file,'qingxi');data.records[0].versions[0].sections[2].payload.price=500;write();
  await assert.rejects(applyFile(db,file,{factoryCode:'qingxi',actor:'test',expectedToken:plan.token}),/预览已变化/);
  for(const table of ['quotes','quote_verifications','quote_verification_sections','audit_log'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('disk multipart route cleans private temporary files on success, parse error, and upload limit',async()=>{
 const express=require('express'),os=require('node:os');
 const dbPath=require.resolve('../backend/db'),authPath=require.resolve('../backend/middleware/auth');
 const previousDb=require.cache[dbPath],previousAuth=require.cache[authPath];
 const db=database();let server;
 const before=new Set(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('verification-transfer-')));
 try {
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
  require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{requireAuth:(req,res,next)=>{
   req.user={username:'test',active_factory_code:'qingxi',perms:{'账号管理':{can_admin:true}}};next();
  }}};
  const app=express();app.use('/transfer',require('../backend/routes/verificationTransfer'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const endpoint=`http://127.0.0.1:${server.address().port}/transfer`;
  const temp=fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('verification-transfer-')&&!before.has(n));assert.equal(temp.length,1);
  const directory=path.join(os.tmpdir(),temp[0]);assert.equal(fs.statSync(directory).mode&0o777,0o700);
  async function post(bytes,name,fields={}) {
   const data=new FormData();data.set('file',new Blob([bytes]),name);for(const[k,v]of Object.entries(fields))data.set(k,v);
   const result=await fetch(endpoint,{method:'POST',body:data});const body=await result.json();
   // Response can be flushed before the finally-unlink continuation finishes.
   for(let i=0;i<20&&fs.readdirSync(directory).length;i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.deepEqual(fs.readdirSync(directory),[]);return{result,body};
  }
  const valid=JSON.stringify(bundle());let response=await post(valid,'test.json');assert.equal(response.result.status,200);assert.equal(response.body.new_count,1);
  response=await post('<invalid>','broken.jsonl');assert.equal(response.result.status,409);
  response=await post(valid,'test.json',{oversized:'x'.repeat(1025)});assert.equal(response.result.status,400);assert.match(response.body.error,/字段/);
  response=await post(Buffer.alloc(49*1024*1024+1),'too-large.jsonl');assert.equal(response.result.status,413);assert.match(response.body.error,/49 MiB/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM quotes').get().n,0);
  fs.rmSync(directory,{recursive:true,force:true});
 }finally {
  if(server)await new Promise(resolve=>server.close(resolve));db.close();
  if(previousDb)require.cache[dbPath]=previousDb;else delete require.cache[dbPath];
  if(previousAuth)require.cache[authPath]=previousAuth;else delete require.cache[authPath];
 }
});
