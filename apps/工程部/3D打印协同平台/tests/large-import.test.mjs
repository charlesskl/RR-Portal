import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';import {once} from 'node:events';
test('22 MiB business JSON supports preview, import, full save and restart; configured smaller limit rejects it',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'printlink-large-'));const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));let child;
 const launch=async(limit)=>{child=spawn(process.execPath,['production/server.js'],{cwd:process.cwd(),env:{...process.env,PRODUCTION_PORT:String(port),PRODUCTION_DB:path.join(dir,'data.sqlite'),PRODUCTION_SOURCE:path.join(dir,'absent.json'),PRODUCT_FILES_DIR:path.join(dir,'files'),INTERNAL_TOKEN:'test-only-token',PRODUCTION_JSON_LIMIT_MB:String(limit)},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('service exited')})]);};
 const stop=async()=>{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}};
 const call=async(route,data)=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+route,{method:data?'POST':'GET',headers:{'X-Internal-Token':'test-only-token','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json()};};
 const source={settings:null,products:[{id:1,name:'large-test',image:'x'.repeat(22*1024*1024)}],materials:[],inventory:{},records:{},schedules:[],maintenance:[],stockInLogs:[],miscExpenses:[]};
 try{
  await launch(64);assert.equal((await call('legacy-import/limits')).body.maxMB,64);
  const preview=await call('legacy-import/preview',{data:source});assert.equal(preview.status,200);assert.deepEqual(preview.body.conflicts,[]);
  const applied=await call('legacy-import/apply',{data:source,fingerprint:preview.body.fingerprint});assert.equal(applied.status,200);assert.ok(applied.body.backupId);
  const loaded=(await call('data')).body;assert.equal(loaded.products[0].image.length,22*1024*1024);assert.equal((await call('data',loaded)).status,200);
  await stop();await launch(64);assert.equal((await call('data')).body.products[0].image.length,22*1024*1024);
  await stop();await launch(10);assert.equal((await call('legacy-import/preview',{data:source})).status,413);assert.equal((await call('data')).body.products.length,1);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
