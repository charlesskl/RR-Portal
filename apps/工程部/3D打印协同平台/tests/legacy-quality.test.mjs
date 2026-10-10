import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('legacy quality is single-use under concurrency and cannot reopen delivered orders',()=>{
 const moduleURL=new URL('../cloud/integration.mjs',import.meta.url).href;
 const script=`
  import assert from 'node:assert/strict';
  import {DatabaseSync} from 'node:sqlite';
  import {integration} from ${JSON.stringify(moduleURL)};
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,payload TEXT,updated TEXT); CREATE TABLE events(order_id TEXT,actor TEXT,text TEXT)');
  let calls=0,holdCatalog=false,releaseCatalog;
  globalThis.fetch=async()=>{calls++;if(holdCatalog)await new Promise(resolve=>releaseCatalog=resolve);return new Response(JSON.stringify({materials:[{id:'pla',name:'PLA'}],inventory:{PLA:{stockG:100}},records:{}}));};
  const handle=integration({db,body:async req=>req.data,json:(res,status)=>res.status=status,fail:(status,message)=>{throw Object.assign(Error(message),{status});},recordEvent:(id,actor,text)=>db.prepare('INSERT INTO events VALUES (?,?,?)').run(id,actor,text),DEMO:false});
  const first='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',third='cccccccc-cccc-cccc-cccc-cccccccccccc';
  for(const [id,machine] of [[first,'1'],[second,'2'],[third,'3']]){
   db.prepare('INSERT INTO orders VALUES (?,?,?,?)').run(id,'待交付',JSON.stringify({quantity:2}),'original');
   db.prepare('INSERT INTO production_jobs(id,order_id,station,machine,payload,status,created) VALUES (?,?,?,?,?,?,?)').run(id,id,'test-station',machine,JSON.stringify({attempt:1}),'待交付','original');
  }
  async function request(id,data){const res={};try{await handle({method:'PATCH',data},res,'/api/platform/jobs/'+id,{role:'admin',name:'Review'});return res.status;}catch(e){if(e.status)return e.status;throw e;}}
  const quality={action:'quality',materialId:'pla',totalWeight:10,actualHours:1,price:0,notes:'旧版页面确认'};
  const concurrent=await Promise.all([request(first,quality),request(first,{...quality,totalWeight:20})]);
  assert.deepEqual(concurrent.sort(),[200,409],'only one legacy settlement may win');
  assert.equal(db.prepare('SELECT count(*) n FROM events WHERE order_id=?').get(first).n,1);
  const busy='dddddddd-dddd-dddd-dddd-dddddddddddd';
  db.prepare('INSERT INTO orders VALUES (?,?,?,?)').run(busy,'待排产',JSON.stringify({quantity:2}),'original');
  db.prepare('INSERT INTO production_jobs(id,order_id,station,machine,payload,status,created) VALUES (?,?,?,?,?,?,?)').run(busy,busy,'test-station','1',JSON.stringify({attempt:1}),'待打印','original');
  assert.equal(await request(first,{action:'retry'}),409,'a ready task cannot steal a now occupied machine');
  assert.ok(JSON.parse(db.prepare('SELECT payload FROM production_jobs WHERE id=?').get(first).payload).quality);
  assert.equal(await request(busy,{action:'cancel'}),200);
  assert.equal(await request(first,{action:'retry'}),200);
  const retried=JSON.parse(db.prepare('SELECT payload FROM production_jobs WHERE id=?').get(first).payload);
  assert.equal(retried.attempt,2);assert.equal(retried.quality,undefined,'a new attempt clears prior quality');
  assert.equal(await request(first,{action:'deliver',notes:'尚未重新打印'}),409);
  assert.equal(await request(second,{action:'deliver',notes:'不需要质检，已签收'}),200);
  assert.equal(await request(second,{action:'retry'}),409,'delivered orders cannot be retried');
  assert.equal(await request(second,{action:'deliver',notes:'重复签收'}),409);
  const beforeCalls=calls;
  assert.equal(await request(second,quality),409,'a cached legacy form must not reopen a delivered order');
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(second).status,'已完成');
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM production_jobs WHERE id=?').get(second).payload).quality,undefined);
  assert.equal(calls,beforeCalls,'reject delivered orders before consulting production data');
  holdCatalog=true;
  const pendingQuality=request(third,quality);
  while(!releaseCatalog)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await request(third,{action:'deliver',notes:'生产资料响应期间已交付'}),200);
  releaseCatalog();
  assert.equal(await pendingQuality,409,'delivery while catalog is loading must also win');
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(third).status,'已完成');
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM production_jobs WHERE id=?').get(third).payload).quality,undefined);
  db.close();
 `;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000,env:{...process.env,COLLECTOR_STATIONS:JSON.stringify([{id:'test-station',name:'Test',factories:['清溪'],machines:['1','2','3'],token:'test-token-'.repeat(4)}])}});
 assert.equal(child.status,0,child.stderr||child.error?.message);
});
