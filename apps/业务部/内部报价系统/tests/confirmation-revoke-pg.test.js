const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const pgUrl=process.env.TEST_DATABASE_URL;
test('PostgreSQL confirmation revocation preserves NUMERIC 12/zero/NULL and transaction/lifecycle boundaries',{skip:!pgUrl,timeout:45000},async t=>{
 const {Pool,types}=require('pg');types.setTypeParser(1184,v=>v);const bcrypt=require('bcryptjs');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'revoke-pg-test-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const schema=`revoke_pg_${process.pid}_${Math.random().toString(16).slice(2)}`;
 const admin=new Pool({connectionString:pgUrl});await admin.query(`CREATE SCHEMA ${schema}`);
 const db=new Pool({connectionString:pgUrl,options:`-c search_path=${schema},public`});
 const child=spawn(process.execPath,['backend/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',DB_DRIVER:'postgres',DB_FILE:'',DATABASE_URL:pgUrl,DB_SCHEMA:schema,PORT:String(port),HOST:'127.0.0.1',SESSION_SECRET:'revoke-private-fixture',COOKIE_SECURE:'0',ADMIN_INITIAL_PASSWORD:'revoke-private-fixture'},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();fs.rmSync(temporary,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('isolated server start timeout')),15000);child.stdout.on('data',b=>{if(String(b).includes('listening on')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`isolated server exit ${code}`));});});
 function session(){let cookie='';return async function api(url,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}/api${url}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});if(r.headers.getSetCookie().length)cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return{status:r.status,body:await r.json()};};}
 const api=session();assert.equal((await api('/auth/login','POST',{username:'admin',password:'revoke-private-fixture'})).status,200);
 const one=async(sql,args=[])=>{const r=await db.query(sql,args);return r.rows[0];};
 const revision=async id=>Number((await one("SELECT MAX(id) r FROM audit_log WHERE quote_id=$1 AND action IN ('customer_confirmation','customer_confirmation_revoke')",[id])).r||0);
 let counter=0;
 async function confirmed(body={confirmed_price:12,confirmed_qty:20}){
  const r=await api('/quotes','POST',{quote_no:`PG-REVOKE-${++counter}`,customer:'TEST',product_name:'original',qty:100});assert.equal(r.status,200);const id=r.body.id;
  assert.equal((await api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed',...body})).status,200);return id;
 }
 async function snapshot(id){
  const tables=['quotes','quote_sections','quote_customer_confirmations','quote_verifications','quote_verification_versions','audit_log'];const out={};
  for(const table of tables){const key=table==='quotes'?'id':'quote_id';out[table]=JSON.parse(JSON.stringify((await db.query(`SELECT * FROM ${table} WHERE ${key}=$1 ORDER BY ${table==='quote_customer_confirmations'||table==='quote_verifications'?'quote_id':'id'}`,[id])).rows));}
  return out;
 }
 const undo=async(id,who=api)=>who(`/quote-summary/${id}/revoke-confirmation`,'POST',{base_confirmation_revision:await revision(id),reason:'synthetic mistaken confirmation'});
 await t.test('retained numeric values round-trip and a new confirmation snapshots corrected header',async()=>{
  for(const [price,qty]of[[12,20],[0,0],[null,null]]){
   const id=await confirmed({confirmed_price:price,confirmed_qty:qty}),before=await snapshot(id),oldRevision=await revision(id);
   const raw=await one('SELECT confirmed_price,confirmed_qty FROM quote_customer_confirmations WHERE quote_id=$1',[id]);assert.equal(raw.confirmed_price==null?null:Number(raw.confirmed_price),price);assert.equal(raw.confirmed_qty,qty);
   const r=await undo(id);assert.equal(r.status,200,JSON.stringify(r.body));const after=await snapshot(id);
   assert.deepEqual(after.quotes,before.quotes);assert.deepEqual(after.quote_sections,before.quote_sections);assert.deepEqual(after.quote_verification_versions,[]);assert.deepEqual(after.quote_verifications,[]);
   const audit=JSON.parse(after.audit_log.find(a=>a.action==='customer_confirmation_revoke').detail);assert.deepEqual(audit.previous_confirmation,before.quote_customer_confirmations[0]);assert.deepEqual(audit.unused_verification,before.quote_verifications[0]);
   assert.equal((await api(`/quotes/${id}/header`,'PUT',{product_name:'corrected'})).status,200);
   const reconfirm=await api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed'});assert.equal(reconfirm.status,200,JSON.stringify(reconfirm.body));
   const row=await one('SELECT * FROM quote_customer_confirmations WHERE quote_id=$1',[id]);assert.equal(row.confirmed_price==null?null:Number(row.confirmed_price),price);assert.equal(row.confirmed_qty,qty);
   const baseline=JSON.parse((await one('SELECT baseline_json FROM quote_verifications WHERE quote_id=$1',[id])).baseline_json);assert.equal(baseline.quote.product_name,'corrected');assert.equal(baseline.quote.confirmed_price,price);assert.equal(baseline.quote.confirmed_qty,qty);
   assert.equal((await api(`/quote-summary/${id}/revoke-confirmation`,'POST',{base_confirmation_revision:oldRevision,reason:'stale request'})).status,409);
  }
  const id=await confirmed({});assert.equal((await undo(id)).status,200);assert.equal((await api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed'})).status,200);const row=await one('SELECT confirmed_price,confirmed_qty FROM quote_customer_confirmations WHERE quote_id=$1',[id]);assert.equal(row.confirmed_price,null);assert.equal(row.confirmed_qty,null);
 });
 await t.test('server roles, customer ownership, active factory and anonymous boundaries are preserved',async()=>{
  const password='synthetic-only',hash=bcrypt.hashSync(password,8);
  async function user(name,dept,customer,canAdmin=false){
   const u=await one("INSERT INTO users(username,password_hash,display_name,dept,role,factory_code) VALUES($1,$2,$1,$3,'staff','qingxi') RETURNING id",[name,hash,dept]);
   await db.query("INSERT INTO user_factories(user_id,factory_code) VALUES($1,'qingxi')",[u.id]);if(customer)await db.query('INSERT INTO user_customers(user_id,customer) VALUES($1,$2)',[u.id,customer]);if(canAdmin)await db.query("INSERT INTO user_perms(user_id,menu,can_view,can_admin) VALUES($1,'账号管理',1,1)",[u.id]);
   const who=session();assert.equal((await who('/auth/login','POST',{username:name,password})).status,200);return who;
  }
  const id=await confirmed(),before=await snapshot(id),anon=session();assert.equal((await undo(id,anon)).status,401);
  for(const who of[await user('engineering','engineering','TEST'),await user('sales_other','sales','OTHER'),await user('painting','painting','TEST')]){assert.equal((await undo(id,who)).status,403);assert.deepEqual(await snapshot(id),before);}
  const grant=await user('delegated','engineering',null,true);assert.equal((await undo(id,grant)).status,200);
  const sales=await user('sales_allowed','sales','TEST');const own=await confirmed();assert.equal((await undo(own,sales)).status,200);
  await db.query("INSERT INTO factories(code,name_cn,sort_order,active) VALUES('review_other','synthetic other',99,1)");const foreign=await confirmed();await db.query("UPDATE quotes SET factory_code='review_other' WHERE id=$1",[foreign]);const foreignBefore=await snapshot(foreign);assert.equal((await undo(foreign,sales)).status,403);assert.deepEqual(await snapshot(foreign),foreignBefore);
 });
 await t.test('first costing GET and revocation serialize without orphan cases or lost version data',async()=>{
  for(let i=0;i<6;i++){
   const id=await confirmed(),rev=await revision(id);const [view,revoke]=await Promise.all([api(`/verifications/${id}`),api(`/quote-summary/${id}/revoke-confirmation`,'POST',{base_confirmation_revision:rev,reason:'concurrent test'})]);
   const rows=await snapshot(id);
   if(revoke.status===200){assert.equal(view.status,409);assert.equal(rows.quote_customer_confirmations[0].status,'pending');assert.equal(rows.quote_verifications.length,0);assert.equal(rows.quote_verification_versions.length,0);}
   else{assert.equal(revoke.status,409);assert.equal(view.status,200);assert.equal(rows.quote_customer_confirmations[0].status,'confirmed');assert.equal(rows.quote_verifications.length,1);assert.equal(rows.quote_verification_versions.length,1);assert.equal((await undo(id)).status,409);}
  }
 });
 await t.test('header and reconfirm races match their acknowledged lifecycle result',async()=>{
  for(let i=0;i<4;i++){
   const id=await confirmed();const [revoke,header]=await Promise.all([undo(id),api(`/quotes/${id}/header`,'PUT',{product_name:'race-corrected'})]);assert.equal(revoke.status,200);assert.ok([200,409].includes(header.status));const q=await one('SELECT product_name FROM quotes WHERE id=$1',[id]);assert.equal(q.product_name,header.status===200?'race-corrected':'original');
   assert.equal((await api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed'})).status,200);const old=await revision(id);
   const both=await Promise.all([undo(id),api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed'})]);assert.equal(both[0].status,200);assert.ok([200,409].includes(both[1].status));const state=await one('SELECT status FROM quote_customer_confirmations WHERE quote_id=$1',[id]);assert.equal(state.status,both[1].status===200?'confirmed':'pending');if(state.status==='confirmed')assert.equal((await api(`/quote-summary/${id}/revoke-confirmation`,'POST',{base_confirmation_revision:old,reason:'stale old revision'})).status,409);
  }
 });
 await t.test('an update failure rolls back audit, case deletion and confirmation together',async()=>{
  const id=await confirmed(),before=await snapshot(id);
  await db.query(`CREATE FUNCTION reject_revoke_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.status='pending' AND OLD.status='confirmed' THEN RAISE EXCEPTION 'synthetic revoke update failure'; END IF; RETURN NEW; END$$`);await db.query('CREATE TRIGGER reject_revoke_update BEFORE UPDATE ON quote_customer_confirmations FOR EACH ROW EXECUTE FUNCTION reject_revoke_update()');
  try{assert.equal((await undo(id)).status,500);assert.deepEqual(await snapshot(id),before);}finally{await db.query('DROP TRIGGER reject_revoke_update ON quote_customer_confirmations');await db.query('DROP FUNCTION reject_revoke_update()');}
 });
 await t.test('a deferred commit failure is never acknowledged as successful undo',async()=>{
  const id=await confirmed(),before=await snapshot(id);
  await db.query(`CREATE FUNCTION reject_revoke_commit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='customer_confirmation_revoke' THEN RAISE EXCEPTION 'synthetic deferred commit failure'; END IF; RETURN NEW; END$$`);await db.query('CREATE CONSTRAINT TRIGGER reject_revoke_commit AFTER INSERT ON audit_log DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_revoke_commit()');
  try{assert.equal((await undo(id)).status,500);assert.deepEqual(await snapshot(id),before);}finally{await db.query('DROP TRIGGER reject_revoke_commit ON audit_log');await db.query('DROP FUNCTION reject_revoke_commit()');}
 });
 assert.ok(!/deadlock detected|no transaction is active/.test(errors),errors);
});
