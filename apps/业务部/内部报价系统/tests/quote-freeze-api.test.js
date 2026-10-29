const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {DatabaseSync}=require('node:sqlite');

test('customer confirmation atomically freezes matching price, header and sections under concurrent HTTP writes',{timeout:30000},async t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quote-freeze-test-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const database=path.join(temporary,'test.db');
  const pgUrl=process.env.TEST_DATABASE_URL;
  const schema=`quote_freeze_${process.pid}_${Math.random().toString(16).slice(2)}`;
  let pgAdmin,pgRead;
  if(pgUrl){const {Pool}=require('pg');pgAdmin=new Pool({connectionString:pgUrl});await pgAdmin.query(`CREATE SCHEMA ${schema}`);pgRead=new Pool({connectionString:pgUrl,options:`-c search_path=${schema},public`});}
  const child=spawn(process.execPath,['backend/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',DB_DRIVER:pgUrl?'postgres':'sqlite',DB_FILE:pgUrl?'':database,DATABASE_URL:pgUrl||'',DB_SCHEMA:schema,PORT:String(port),HOST:'127.0.0.1',SESSION_SECRET:'freeze-fixture-only',COOKIE_SECURE:'0',ADMIN_INITIAL_PASSWORD:'freeze-fixture-only'},stdio:['ignore','pipe','pipe']});
  let errorLog='';child.stderr.on('data',b=>errorLog+=b);
  t.after(async()=>{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server start timed out')),15000);child.stdout.on('data',b=>{if(String(b).includes('listening on')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}`));});});
  let cookie='';
  async function api(url,method='GET',body){const response=await fetch(`http://127.0.0.1:${port}/api${url}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(response.headers.getSetCookie().length)cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return{status:response.status,body:await response.json()};}
  assert.equal((await api('/auth/login','POST',{username:'admin',password:'freeze-fixture-only'})).status,200);
  const native=pgUrl?null:new DatabaseSync(database,{readOnly:true});
  const readDb={prepare(sql){return{async get(...args){if(!pgUrl)return native.prepare(sql).get(...args);let i=0;return(await pgRead.query(sql.replace(/\?/g,()=>`$${++i}`),args)).rows[0];}}}};
  t.after(async()=>{if(native)native.close();if(pgRead)await pgRead.end();if(pgAdmin){await pgAdmin.query(`DROP SCHEMA ${schema} CASCADE`);await pgAdmin.end();}});
  const created=await api('/quotes','POST',{quote_no:'CONFIRM-DOUBLE',customer:'TEST',product_name:'original',qty:100});assert.equal(created.status,200);
  const id=created.body.id;
  const confirmations=await Promise.all([api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed',confirmed_price:11}),api(`/quote-summary/${id}/confirmation`,'PUT',{status:'confirmed',confirmed_price:22})]);
  assert.deepEqual(confirmations.map(r=>r.status).sort(),[200,409]);
  const confirmed=await readDb.prepare('SELECT * FROM quote_customer_confirmations WHERE quote_id=?').get(id),baseline=JSON.parse((await readDb.prepare('SELECT baseline_json FROM quote_verifications WHERE quote_id=?').get(id)).baseline_json);
  assert.equal(confirmed.status,'confirmed');assert.equal(baseline.quote.confirmed_price,Number(confirmed.confirmed_price));
  assert.equal((await api(`/quote-summary/${id}/confirmation`,'PUT',{status:'pending',note:'stale autosave'})).status,409);
  assert.equal((await api(`/quotes/${id}/header`,'PUT',{product_name:'must not overwrite'})).status,409);
  const section=await readDb.prepare("SELECT * FROM quote_sections WHERE quote_id=? AND dept='sales'").get(id);
  assert.equal((await api(`/sections/${section.id}`,'PUT',{payload:{header:{fx_rmb_hkd:9}},base_filled_at:null})).status,409);
  assert.equal((await api(`/reviews/${section.id}`,'POST',{action:'reject'})).status,409);
  assert.equal((await api(`/reviews/${section.id}/reopen`,'POST',{})).status,409);
  // Saving and confirmation may win in either order, but the successful
  // confirmation must freeze exactly the content present in the original.
  for(let i=0;i<3;i++){
    const made=await api('/quotes','POST',{quote_no:`CONFIRM-SAVE-${i}`,customer:'TEST',product_name:'original'});assert.equal(made.status,200);
    const qid=made.body.id,sec=await readDb.prepare("SELECT * FROM quote_sections WHERE quote_id=? AND dept='sales'").get(qid);
    const results=await Promise.all([api(`/quote-summary/${qid}/confirmation`,'PUT',{status:'confirmed',confirmed_price:30+i}),api(`/sections/${sec.id}`,'PUT',{payload:{header:{fx_rmb_hkd:.95}},base_filled_at:null})]);
    assert.equal(results[0].status,200);assert.ok([200,409].includes(results[1].status));
    const b=JSON.parse((await readDb.prepare('SELECT baseline_json FROM quote_verifications WHERE quote_id=?').get(qid)).baseline_json);
    assert.deepEqual(JSON.parse((await readDb.prepare('SELECT payload_json FROM quote_sections WHERE id=?').get(sec.id)).payload_json),b.sections.find(s=>s.dept==='sales').payload);
  }
  // A deliberate undo uses a separate endpoint and a revision; stale generic
  // pending autosaves remain blocked, and a reconfirmation gets a fresh baseline.
  const undone=await api('/quotes','POST',{quote_no:'UNDO-MISTAKE',customer:'TEST',product_name:'before'});
  const uid=undone.body.id;
  await api(`/quote-summary/${uid}/confirmation`,'PUT',{status:'confirmed',confirmed_price:12,confirmed_qty:20});
  const undoRow=()=>readDb.prepare('SELECT * FROM quote_customer_confirmations WHERE quote_id=?').get(uid);
  const revision=async qid=>Number((await readDb.prepare(`SELECT MAX(id) AS r FROM audit_log WHERE quote_id=? AND action IN ('customer_confirmation','customer_confirmation_revoke')`).get(qid)).r||0);
  const rev=await revision(uid);
  assert.equal((await api(`/quotes`)).body.find(q=>q.id===uid).confirmation_revision,rev);
  const undoBody={base_confirmation_revision:rev,reason:'误点确认'};
  assert.equal((await api(`/quote-summary/${uid}/revoke-confirmation`,'POST',{...undoBody,reason:''})).status,400);
  assert.equal((await undoRow()).status,'confirmed');
  const beforeUndoSection=await readDb.prepare("SELECT payload_json FROM quote_sections WHERE quote_id=? AND dept='sales'").get(uid);
  const concurrentUndo=await Promise.all([api(`/quote-summary/${uid}/revoke-confirmation`,'POST',undoBody),api(`/quote-summary/${uid}/revoke-confirmation`,'POST',undoBody)]);
  assert.deepEqual(concurrentUndo.map(r=>r.status).sort(),[200,409]);
  const pending=await undoRow();assert.equal(pending.status,'pending');assert.equal(pending.confirmed_by,null);assert.equal(pending.confirmed_at,null);
  assert.equal(pending.confirmed_price,12);assert.equal(pending.confirmed_qty,20);
  assert.equal(await readDb.prepare('SELECT * FROM quote_verifications WHERE quote_id=?').get(uid),undefined);
  assert.equal((await readDb.prepare("SELECT payload_json FROM quote_sections WHERE quote_id=? AND dept='sales'").get(uid)).payload_json,beforeUndoSection.payload_json);
  const audit=JSON.parse((await readDb.prepare("SELECT detail FROM audit_log WHERE quote_id=? AND action='customer_confirmation_revoke'").get(uid)).detail);
  assert.equal(audit.previous_confirmation.status,'confirmed');assert.ok(audit.unused_verification.baseline_json);
  assert.equal((await api(`/quotes/${uid}/header`,'PUT',{product_name:'corrected'})).status,200);
  assert.equal((await api(`/quote-summary/${uid}/confirmation`,'PUT',{status:'confirmed'})).status,200);
  assert.equal(JSON.parse((await readDb.prepare('SELECT baseline_json FROM quote_verifications WHERE quote_id=?').get(uid)).baseline_json).quote.product_name,'corrected');
  assert.equal((await api(`/quote-summary/${uid}/revoke-confirmation`,'POST',undoBody)).status,409);
  // Viewing the costing task may initialize its first version; any
  // resulting version must survive an attempted undo, even if it is still empty.
  assert.equal((await api(`/verifications/${uid}`)).status,200);
  assert.equal((await api(`/quote-summary/${uid}/revoke-confirmation`,'POST',{...undoBody,base_confirmation_revision:await revision(uid)})).status,409);
  assert.ok(await readDb.prepare('SELECT id FROM quote_verification_versions WHERE quote_id=?').get(uid));
  assert.equal((await undoRow()).status,'confirmed');
  // A global publication is also an original-quote writer. Existing frozen
  // payloads must survive both the new basis and the legacy material API.
  const basis=(await api('/admin/costing-basis')).body.data;basis.exchange.rmb_hkd=.91;basis.materials[0].price+=1;
  assert.equal((await api('/admin/costing-basis','PUT',{data:basis})).status,200);
  assert.equal((await readDb.prepare('SELECT payload_json FROM quote_sections WHERE id=?').get(section.id)).payload_json,section.payload_json);
  assert.ok(!/cannot start a transaction|SQLITE_BUSY|no transaction is active/.test(errorLog),errorLog);
});
