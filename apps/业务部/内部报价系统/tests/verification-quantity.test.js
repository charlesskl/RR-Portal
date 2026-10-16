const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{DatabaseSync}=require('node:sqlite');
const {payloadRevision}=require('../backend/services/verificationMetadata');
test('manual quantity saves are scoped and audited without changing completed costing',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE quotes(id INTEGER,deleted_at TEXT);CREATE TABLE quote_verification_versions(id INTEGER,quote_id INTEGER,version_no INTEGER,status TEXT,label TEXT);CREATE TABLE quote_verification_sections(id INTEGER,version_id INTEGER,dept TEXT,payload_json TEXT);CREATE TABLE audit_log(quote_id INTEGER,dept TEXT,actor TEXT,action TEXT,detail TEXT);
 INSERT INTO quotes VALUES(1,NULL),(2,NULL);INSERT INTO quote_verification_versions VALUES(1,1,1,'completed','V1'),(2,2,1,'completed','V1');
 INSERT INTO quote_verification_sections VALUES(1,1,'sales','{"amount":12,"formula":"=A1"}'),(2,2,'sales','{}');`);
 const filename=path.join(__dirname,'../backend/routes/verificationSummary.js'),realRequire=createRequire(filename),routes={};
 const router={use(){},get(){},put(url,fn){routes[url]=fn;}};
 let staleWrite=false;
 const adapter={prepare:s=>staleWrite&&s.startsWith('UPDATE quote_verification_sections SET payload_json=')?{run:()=>({changes:0})}:db.prepare(s),transaction:fn=>async()=>{db.exec('BEGIN');try{const r=await fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:{exports:{}},require:id=>id==='express'?{Router:()=>router}:id==='../db'?adapter:id==='../middleware/auth'?{requireAuth(){},quoteAccess:async(u,id)=>({status:id===2?403:200})}:realRequire(id)});
 const call=async(body,role='admin')=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};const section=db.prepare("SELECT payload_json FROM quote_verification_sections WHERE version_id=? AND dept='sales'").get(body.version_id);await routes['/quantity']({body:{...body,expected_revision:payloadRevision(section)},user:{role,dept:'other',name:'test'}},res);return res;};
 assert.equal((await call({version_id:1,quantity:10},'staff')).statusCode,403);
 assert.equal((await call({version_id:2,quantity:10})).statusCode,403);
 for(const quantity of [-1,0.5,'10',undefined])assert.equal((await call({version_id:1,quantity})).statusCode,400);
 for(const quantity of [20,0,null]){
  assert.equal((await call({version_id:1,quantity})).statusCode,200);
  const p=JSON.parse(db.prepare('SELECT payload_json FROM quote_verification_sections WHERE id=1').get().payload_json);
  assert.equal(p.summary_order_quantity.value,quantity);assert.equal(p.amount,12);assert.equal(p.formula,'=A1');
 }
 assert.equal(db.prepare('SELECT status FROM quote_verification_versions WHERE id=1').get().status,'completed');
 assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n,3);
 db.exec("INSERT INTO quote_verification_versions VALUES(3,1,2,'draft','V2')");
 assert.equal((await call({version_id:1,quantity:30})).statusCode,409);
 staleWrite=true;
 const beforeConflict=db.prepare('SELECT payload_json FROM quote_verification_sections WHERE id=1').get().payload_json;
 db.exec('DELETE FROM quote_verification_versions WHERE id=3');
 assert.equal((await call({version_id:1,quantity:99})).statusCode,409);
 assert.equal(db.prepare('SELECT payload_json FROM quote_verification_sections WHERE id=1').get().payload_json,beforeConflict);
 db.close();
});
