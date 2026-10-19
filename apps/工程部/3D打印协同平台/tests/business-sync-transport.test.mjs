import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {mkdtempSync,copyFileSync,rmSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {DatabaseSync} from 'node:sqlite';
import core from '../shared/business-sync.cjs';import createSync from '../production/business-sync.cjs';import {startBusinessSync} from '../collector/business-sync.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const data=()=>({products:[{id:1,name:'产品'}],inventory:{PETG:{stockG:1000}},records:{'2026-10-10':{items:[{_id:'r1',qty:1,weight:10,material:'PETG',machine:1}]}}});
test('Windows installation includes standalone core dependencies and preserves configuration and business files',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'printlink-installer-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original="const _syncEnabled=false,_role='master',DATA_FILE='data.json';\nfunction loadData(){}\nfunction saveData(data){}\nfunction handle(req,res){\n if(false){\n  } else if (!requireAuth(req, res)) return;\n}\n";
 const config=JSON.stringify({sync:{enabled:false},role:'master',businessSync:true}),snapshot=JSON.stringify(data());
 writeFileSync(path.join(dir,'server.js'),original);writeFileSync(path.join(dir,'config.json'),config);writeFileSync(path.join(dir,'data.json'),snapshot);
 const install=()=>{const result=spawnSync(process.execPath,[fileURLToPath(new URL('../legacy/install-business-sync.mjs',import.meta.url)),dir],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
 install();const patched=readFileSync(path.join(dir,'server.js'),'utf8');
 assert.equal(spawnSync(process.execPath,['--check',path.join(dir,'server.js')]).status,0);
 assert.equal(typeof createRequire(import.meta.url)(path.join(dir,'business-sync-adapter.cjs')),'function');
 const installed=createRequire(import.meta.url)(path.join(dir,'business-sync-core.cjs'));assert.equal(installed.fingerprint(core.project(data())),core.fingerprint(core.project(data())));
 install();assert.equal(readFileSync(path.join(dir,'server.js'),'utf8'),patched);
 assert.equal(readFileSync(path.join(dir,'server.js.before-business-sync'),'utf8'),original);
 assert.equal(readFileSync(path.join(dir,'config.json'),'utf8'),config);assert.equal(readFileSync(path.join(dir,'data.json'),'utf8'),snapshot);
});
test('Windows adapter + collector: credentials, CAS, restart, lost response, failed disk writes and offline edits',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'printlink-business-sync-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 copyFileSync(new URL('../legacy/business-sync-adapter.cjs',import.meta.url),path.join(dir,'adapter.cjs'));copyFileSync(new URL('../shared/business-sync.cjs',import.meta.url),path.join(dir,'business-sync-core.cjs'));
 copyFileSync(new URL('../shared/json-stream.cjs',import.meta.url),path.join(dir,'json-stream.cjs'));
 const adapter=createRequire(import.meta.url)(path.join(dir,'adapter.cjs')),db=new DatabaseSync(path.join(dir,'collector.sqlite')),cloudDB=new DatabaseSync(':memory:');t.after(()=>{db.close();cloudDB.close();});
 cloudDB.exec('CREATE TABLE snapshot(value TEXT)');cloudDB.prepare('INSERT INTO snapshot VALUES (?)').run(JSON.stringify(data()));
 const cloud=()=>JSON.parse(cloudDB.prepare('SELECT value FROM snapshot').get().value);const writeCloud=x=>cloudDB.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(x));
 const cloudSync=createSync(cloudDB,{load:cloud,write:writeCloud});process.env.BUSINESS_SYNC_STATION='test';t.after(()=>delete process.env.BUSINESS_SYNC_STATION);
 let windows=data(),disk=structuredClone(windows),writes=0,failDisk=false,failResponse=false,race=false;
 const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Basic '+Buffer.from('user:pass').toString('base64')){res.writeHead(401);res.end('{}');return;}adapter(req,res,{enabled:true,load:()=>structuredClone(windows),readDisk:()=>disk,save:async x=>{writes++;windows=x;if(!failDisk)disk=structuredClone(x);}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const config={url:`http://127.0.0.1:${server.address().port}`,username:'user',password:'pass'};
 const call=async(route,input)=>{const result=cloudSync({action:input.probe?'probe':'exchange',station:'test',...input});if(race&&!input.probe){race=false;windows.products[0].name='并发本地修改';disk=structuredClone(windows);}if(failResponse&&!input.probe){failResponse=false;throw Error('response lost');}return result;};
 let runner=startBusinessSync({config,db,call,autoStart:false});await runner.sync();assert.ok(runner().lastSuccess);assert.equal(writes,0);
 // Windows creates a debit; cloud commit succeeds but its HTTP response is lost.
 windows.inventory.PETG.stockG=990;disk=structuredClone(windows);failResponse=true;await runner.sync();assert.match(runner().error,/lost/);assert.equal(cloud().inventory.PETG.stockG,990);
 runner.close();runner=startBusinessSync({config,db,call,autoStart:false});await runner.sync();assert.equal(runner().error,'');assert.equal(cloud().inventory.PETG.stockG,990);
 // Cloud edit must be written exactly once without replaying the debit.
 let next=cloud();next.products[0].name='云端修改';writeCloud(next);await runner.sync();assert.equal(windows.products[0].name,'云端修改');assert.equal(windows.inventory.PETG.stockG,990);const count=writes;await runner.sync();assert.equal(writes,count);
 // A local edit after the read prevents the cloud proposal overwriting it.
 next=cloud();next.products[0].name='另一云修改';writeCloud(next);race=true;await runner.sync();assert.match(runner().error,/已变化/);assert.equal(windows.products[0].name,'并发本地修改');await runner.sync();assert.match(runner().error,/差异/);
 let conflicts=cloudSync({action:'status'}).conflicts;cloudSync({action:'resolve',choices:conflicts.map(c=>({id:c.id,signature:c.signature,side:'windows'}))});await runner.sync();assert.equal(runner().error,'');assert.equal(cloud().products[0].name,'并发本地修改');
 // Failed disk persistence cannot advance the common baseline.
 next=cloud();next.products[0].name='落盘测试';writeCloud(next);const before=db.prepare('SELECT value FROM business_sync_base').get().value;failDisk=true;await runner.sync();assert.match(runner().error,/落盘/);assert.equal(db.prepare('SELECT value FROM business_sync_base').get().value,before);
 await runner.sync();assert.match(runner().error,/磁盘/);assert.equal(db.prepare('SELECT value FROM business_sync_base').get().value,before);
 // Simulate server restart from its actual disk after a failed write.
 windows=structuredClone(disk);failDisk=false;await runner.sync();assert.equal(runner().error,'');assert.equal(disk.products[0].name,'落盘测试');
 // Two new products share an ID. Split on the cloud, then lose the response and restart.
 next=cloud();next.products.push({id:658,name:'车轮',image:'data:image/png;base64,cloud'});writeCloud(next);
 windows.products.push({id:658,name:'眼睛底模',image:'data:image/png;base64,local'});
 windows.records['2026-10-16']={items:[{_id:'split-record',productId:658,productName:'眼睛底模'}]};disk=structuredClone(windows);
 await runner.sync();assert.match(runner().error,/差异/);
 conflicts=cloudSync({action:'status'}).conflicts;
 cloudSync({action:'resolve',choices:conflicts.map(c=>({id:c.id,signature:c.signature,side:'both'}))});
 failResponse=true;await runner.sync();assert.match(runner().error,/lost/);
 runner.close();runner=startBusinessSync({config,db,call,autoStart:false});await runner.sync();assert.equal(runner().error,'');
 assert.equal(windows.products.find(p=>p.id===658).name,'车轮');assert.equal(windows.products.find(p=>p.id===659).name,'眼睛底模');
 assert.equal(windows.records['2026-10-16'].items[0].productId,659);
 assert.deepEqual(core.project(windows),core.project(cloud()));
 const productCount=windows.products.length;await runner.sync();assert.equal(windows.products.length,productCount);runner.close();
 const stale=await fetch(config.url+'/api/business-sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from('user:pass').toString('base64')},body:JSON.stringify({expected:'stale',data:core.project(windows)})});assert.equal(stale.status,409);
 const bad=await fetch(config.url+'/api/business-sync');assert.equal(bad.status,401);
});

test('Windows CAS rejects a disk-only edit made after the initial read',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'printlink-disk-cas-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 copyFileSync(new URL('../legacy/business-sync-adapter.cjs',import.meta.url),path.join(dir,'adapter.cjs'));
 copyFileSync(new URL('../shared/business-sync.cjs',import.meta.url),path.join(dir,'business-sync-core.cjs'));
 copyFileSync(new URL('../shared/json-stream.cjs',import.meta.url),path.join(dir,'json-stream.cjs'));
 const adapter=createRequire(import.meta.url)(path.join(dir,'adapter.cjs')),file=path.join(dir,'data.json');
 let memory=data(),writes=0;writeFileSync(file,JSON.stringify(memory));
 const server=http.createServer((req,res)=>{
  if(req.headers.authorization!=='Basic '+Buffer.from('user:pass').toString('base64')){res.writeHead(401);res.end('{}');return;}
  adapter(req,res,{enabled:true,load:()=>structuredClone(memory),readDisk:()=>JSON.parse(readFileSync(file,'utf8')),
   save:x=>{writes++;memory=x;writeFileSync(file,JSON.stringify(x));}});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/business-sync`,headers={Authorization:'Basic '+Buffer.from('user:pass').toString('base64'),'Content-Type':'application/json'};
 const baseline=await (await fetch(url,{headers})).json();
 const disk=data();disk.products[0].name='磁盘独立修改';writeFileSync(file,JSON.stringify(disk));
 const proposal=core.project(memory);proposal.records.r1.qty=2;
 const result=await fetch(url,{method:'POST',headers,body:JSON.stringify({expected:baseline.fingerprint,data:proposal})});
 assert.equal(result.status,409);assert.equal(writes,0);
 assert.equal(JSON.parse(readFileSync(file,'utf8')).products[0].name,'磁盘独立修改');
 assert.equal(memory.records['2026-10-10'].items[0].qty,1);
});
