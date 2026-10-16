const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{AsyncLocalStorage}=require('node:async_hooks');
const {DatabaseSync}=require('node:sqlite');
const {payloadRevision}=require('../backend/services/verificationMetadata');

async function fixture(t){
  require('express-async-errors');
  const store=new AsyncLocalStorage(),url=process.env.TEST_DATABASE_URL;
  let native,pool,admin,schema,tail=Promise.resolve(),before=async()=>{};
  if(url){
    const {Pool,types}=require('pg');types.setTypeParser(1184,v=>v);
    schema=`summary_test_${process.pid}_${Math.random().toString(16).slice(2)}`;
    admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
    pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`});
  }else native=new DatabaseSync(':memory:');
  const query=async(sql,params=[],method='run',outside=false)=>{
    if(native)return native.prepare(sql)[method](...params);
    let i=0;const result=await (outside?pool:store.getStore()||pool).query(sql.replace(/\?/g,()=>`$${++i}`),params);
    return method==='all'?result.rows:method==='get'?result.rows[0]:{changes:result.rowCount};
  };
  const db={pool,prepare(sql){return Object.fromEntries(['get','all','run'].map(method=>[method,async(...params)=>{await before(sql,params,method);return query(sql,params,method);} ]));},transaction(fn){return async()=>{
    let client,release;
    if(pool)client=await pool.connect();else{const previous=tail;tail=new Promise(r=>release=r);await previous;}
    try{if(pool)await client.query('BEGIN');else native.exec('BEGIN');const result=await store.run(client,fn);if(pool)await client.query('COMMIT');else native.exec('COMMIT');return result;}
    catch(e){if(pool)await client.query('ROLLBACK');else native.exec('ROLLBACK');throw e;}
    finally{client?.release();release?.();}
  };}};
  const ddl=`CREATE TABLE quotes(id INTEGER PRIMARY KEY,customer TEXT,quote_no TEXT,product_name TEXT,version TEXT,deleted_at TEXT,factory_code TEXT);
    CREATE TABLE user_customers(user_id INTEGER,customer TEXT);
    CREATE TABLE departments(code TEXT);
    CREATE TABLE quote_customer_confirmations(quote_id INTEGER,status TEXT,confirmed_price REAL,confirmed_qty INTEGER,confirmed_at TEXT);
    CREATE TABLE quote_verification_versions(id INTEGER PRIMARY KEY,quote_id INTEGER,version_no INTEGER,label TEXT,category TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE quote_verification_sections(id INTEGER PRIMARY KEY,version_id INTEGER,dept TEXT,payload_json TEXT,status TEXT,filled_at ${pool?'TIMESTAMPTZ':'TEXT'},reviewed_at ${pool?'TIMESTAMPTZ':'TEXT'});
    CREATE TABLE audit_log(quote_id INTEGER,dept TEXT,actor TEXT,action TEXT,detail TEXT);
    INSERT INTO quotes VALUES(1,'A','A1','one','R1',NULL,'qingxi'),(2,'B','B1','two','R1',NULL,'qingxi'),(3,'A','A3','three','R1',NULL,'heyuan');
    INSERT INTO user_customers VALUES(7,'A');INSERT INTO departments VALUES('sales');
    INSERT INTO quote_customer_confirmations VALUES(1,'confirmed',10,2,'2026-10-16'),(2,'confirmed',10,2,'2026-10-16'),(3,'confirmed',10,2,'2026-10-16');
    INSERT INTO quote_verification_versions VALUES(1,1,1,'V1',NULL,'completed','unchanged'),(2,2,1,'V1',NULL,'completed','unchanged'),(3,3,1,'V1',NULL,'completed','unchanged');`;
  if(pool)await pool.query(ddl);else native.exec(ddl);
  const initial=' { "amount": 12, "formula": "=A1", "header": {"workshop":"华登"} } ';
  for(const id of [1,2,3])await query("INSERT INTO quote_verification_sections(id,version_id,dept,payload_json,status,filled_at,reviewed_at) VALUES(?,?,'sales',?,'approved','2026-10-16T00:00:00.123456Z','2026-10-16T00:00:01.654321Z')",[id,id,initial]);
  const authFile=path.join(__dirname,'../backend/middleware/auth.js'),authModule={exports:{}};
  vm.runInNewContext(fs.readFileSync(authFile,'utf8'),{module:authModule,require:id=>id==='../db'?db:createRequire(authFile)(id)});
  const auth={quoteAccess:authModule.exports.quoteAccess,requireAuth(req,_res,next){
    req.user={id:7,username:'fixture',name:'Fixture',dept:req.headers['x-dept']||'sales',role:req.headers['x-role']||'staff',active_factory_code:req.headers['x-factory']||'qingxi',perms:req.headers['x-admin']==='1'?{'账号管理':{can_admin:1}}:{}};next();
  }};
  function route(file){const filename=path.join(__dirname,'../backend/routes',file),module={exports:{}},real=createRequire(filename);vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:id=>id==='../db'?db:id==='../middleware/auth'?auth:real(id)});return module.exports;}
  const express=require('express'),app=express();app.use(express.json());app.use('/summary',route('verificationSummary.js'));app.use('/tasks',route('verifications.js'));app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));if(pool){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}else native.close();});
  const api=async(route,body,headers={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:body?'PUT':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const read=id=>query('SELECT * FROM quote_verification_sections WHERE id=?',[id],'get');
  const token=async id=>payloadRevision(await read(id));
  const qty=async(id,value,headers={})=>api('/summary/quantity',{version_id:id,quantity:value,expected_revision:await token(id)},headers);
  const workshops=async(ids,name,headers={})=>api('/tasks/workshops',{version_ids:ids,workshop:name,expected_revisions:Object.fromEntries(await Promise.all(ids.map(async id=>[id,await token(id)])))},headers);
  return {api,read,token,qty,workshops,query,db,pg:!!pool,setBefore(fn){before=fn;},outside:(sql,params=[])=>query(sql,params,'run',true)};
}

test('summary and tasks expose the same raw-payload revision and latest non-cancelled version in scope',async t=>{
  const f=await fixture(t);
  await f.query("INSERT INTO quote_verification_versions VALUES(4,1,2,'V2',NULL,'cancelled','unchanged')");
  const report=await f.api('/summary'),tasks=await f.api('/tasks');
  assert.equal(report.status,200);assert.deepEqual(report.body.rows.map(r=>r.id),[1]);
  assert.equal(report.body.rows[0].quantity_revision,await f.token(1));
  assert.equal(tasks.body.rows[0].current_version_id,1);assert.equal(tasks.body.rows[0].workshop_revision,await f.token(1));
  assert.equal((await f.workshops([1],'河源')).status,200);
  assert.deepEqual((await f.api('/summary',null,{'x-admin':'1'})).body.rows.map(r=>r.id),[1,2]);
});

test('a cancelled newer version does not block assignment of the current active version',async t=>{
  const f=await fixture(t);
  await f.query("INSERT INTO quote_verification_versions VALUES(4,1,2,'V2',NULL,'cancelled','unchanged')");
  assert.equal((await f.workshops([1],'河源')).status,200);
  assert.equal(JSON.parse((await f.read(1)).payload_json).workshop_assignment.name,'河源');
});

test('new metadata writes enforce customer, factory, role, input and loaded-revision permissions',async t=>{
  const f=await fixture(t);
  for(const route of ['/summary/quantity','/tasks/workshops'])assert.equal((await f.api(route,route.includes('quantity')?{version_id:1,quantity:2}:{version_ids:[1],workshop:'华登'},{'x-dept':'assembly'})).status,403);
  assert.equal((await f.qty(2,1)).status,403);assert.equal((await f.workshops([3],'华登',{'x-admin':'1'})).status,403);
  assert.equal((await f.api('/summary/quantity',{version_id:1,quantity:2})).status,400);
  assert.equal((await f.api('/tasks/workshops',{version_ids:[1],workshop:'华登',expected_revisions:{1:'bad'}})).status,400);
  for(const quantity of [-1,0.1,'3',Number.MAX_SAFE_INTEGER+1])assert.equal((await f.qty(1,quantity)).status,400);
  assert.equal((await f.workshops([1],'unknown')).status,400);
  assert.equal((await f.api('/tasks/workshops',{version_ids:[0],workshop:'华登'})).status,400);
  await f.query('DELETE FROM user_customers WHERE user_id=7');
  const empty=await f.api('/tasks');assert.equal(empty.status,200);assert.deepEqual(empty.body.rows,[]);assert.equal(empty.body.can_assign_workshop,true);
  assert.equal((await f.api('/tasks',null,{'x-dept':'assembly'})).body.can_assign_workshop,false);
});

test('quantity zero, blank and workshop changes preserve costing, approval and precise timestamps',async t=>{
  const f=await fixture(t),before=await f.read(1),v=await f.query('SELECT * FROM quote_verification_versions WHERE id=1',[],'get');
  for(const quantity of [30,0,null]){
    const r=await f.qty(1,quantity);assert.equal(r.status,200);assert.equal(r.body.quantity_revision,await f.token(1));
    const section=await f.read(1),p=JSON.parse(section.payload_json);assert.equal(p.summary_order_quantity.value,quantity);assert.equal(p.amount,12);assert.equal(p.formula,'=A1');
    for(const key of ['status','filled_at','reviewed_at'])assert.equal(section[key],before[key]);
  }
  const w=await f.workshops([1,1],'河源');assert.equal(w.status,200);assert.equal(w.body.count,1);assert.equal(w.body.revisions[1],await f.token(1));
  assert.deepEqual(await f.query('SELECT * FROM quote_verification_versions WHERE id=1',[],'get'),v);
  assert.equal((await f.workshops([1],'待分配车间')).status,200);
  assert.equal(JSON.parse((await f.read(1)).payload_json).workshop_assignment.name,'待分配车间');
  assert.equal((await f.api('/summary')).body.rows[0].workshop,'待分配车间');
  assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),5);
  if(f.pg){assert.match(before.filled_at,/\.123456/);assert.match(before.reviewed_at,/\.654321/);}
});

test('two loaded pages cannot silently overwrite quantity or workshop edits',async t=>{
  const f=await fixture(t),stale=await f.token(1);
  assert.equal((await f.qty(1,8)).status,200);
  assert.equal((await f.api('/summary/quantity',{version_id:1,quantity:99,expected_revision:stale})).status,409);
  assert.equal((await f.api('/tasks/workshops',{version_ids:[1],workshop:'河源',expected_revisions:{1:stale}})).status,409);
  assert.equal(JSON.parse((await f.read(1)).payload_json).summary_order_quantity.value,8);
  assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),1);
});

test('a batch with a denied or stale later item rolls back every earlier assignment and audit',async t=>{
  const f=await fixture(t),before=await f.read(1);
  assert.equal((await f.workshops([1,2],'河源')).status,403);assert.deepEqual(await f.read(1),before);
  const expected={1:await f.token(1),2:await f.token(2)};
  await f.qty(2,10,{'x-admin':'1'});
  assert.equal((await f.api('/tasks/workshops',{version_ids:[2,1],workshop:'河源',expected_revisions:expected},{'x-admin':'1'})).status,409);
  assert.deepEqual(await f.read(1),before);assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),1);
});

test('metadata update and audit failures roll back together',async t=>{
  const f=await fixture(t),before=await f.read(1);
  f.setBefore(async sql=>{if(sql.startsWith('INSERT INTO audit_log'))throw Error('fixture failed audit');});
  assert.equal((await f.qty(1,4)).status,500);assert.deepEqual(await f.read(1),before);
  assert.equal((await f.workshops([1],'河源')).status,500);assert.deepEqual(await f.read(1),before);
  assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),0);
});

test('simultaneous quantity and workshop editors share one exact sales-payload compare-and-swap',{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const f=await fixture(t),revision=await f.token(1);
  let count=0,release;const gate=new Promise(r=>release=r);
  f.setBefore(async sql=>{if(!sql.startsWith('UPDATE quote_verification_sections SET payload_json'))return;if(++count===2)release();await gate;});
  const results=await Promise.all([
    f.api('/summary/quantity',{version_id:1,quantity:33,expected_revision:revision}),
    f.api('/tasks/workshops',{version_ids:[1],workshop:'河源',expected_revisions:{1:revision}}),
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const p=JSON.parse((await f.read(1)).payload_json);
  assert.equal(p.amount,12);assert.equal(p.formula,'=A1');
  assert.equal(Boolean(p.summary_order_quantity)!==Boolean(p.workshop_assignment),true);
  assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),1);
});

for(const mode of ['quantity','workshop'])for(const change of ['new version','cancelled','payload'])test(`${mode} rejects a ${change} committed after its initial reads`,{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const f=await fixture(t),before=await f.read(1);let injected=false;
  f.setBefore(async sql=>{
    if(injected||!sql.startsWith('UPDATE quote_verification_sections SET payload_json'))return;injected=true;
    if(change==='new version')await f.outside("INSERT INTO quote_verification_versions VALUES(4,1,2,'V2',NULL,'drafting','new')");
    else if(change==='cancelled')await f.outside("UPDATE quote_verification_versions SET status='cancelled' WHERE id=1");
    else await f.outside('UPDATE quote_verification_sections SET payload_json=? WHERE id=1',[' {"concurrent":true} ']);
  });
  const result=mode==='quantity'?await f.qty(1,33):await f.workshops([1],'河源');
  assert.equal(result.status,409);assert.equal(injected,true);
  assert.equal((await f.read(1)).payload_json,change==='payload'?' {"concurrent":true} ':before.payload_json);
  assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),0);
});

for(const mode of ['quantity','workshop'])test(`${mode} returns a conflict when cancellation leaves no active version`,{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const f=await fixture(t),before=await f.read(1);let injected=false;
  f.setBefore(async sql=>{if(injected||!sql.startsWith('SELECT id FROM quote_verification_versions WHERE quote_id='))return;injected=true;await f.outside("UPDATE quote_verification_versions SET status='cancelled' WHERE id=1");});
  const result=mode==='quantity'?await f.qty(1,33):await f.workshops([1],'河源');
  assert.equal(result.status,409);assert.equal(injected,true);assert.deepEqual(await f.read(1),before);
  assert.equal(Number((await f.query('SELECT count(*) n FROM audit_log',[],'get')).n),0);
});
