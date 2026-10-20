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
