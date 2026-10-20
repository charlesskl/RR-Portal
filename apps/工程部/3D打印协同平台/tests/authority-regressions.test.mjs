import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import core from '../shared/business-sync.cjs';
import commands from '../shared/authority-commands.cjs';
import createAuthority from '../production/authority-store.cjs';
import {startBusinessSync} from '../collector/business-sync.mjs';
const require=createRequire(import.meta.url),durable=require('../legacy/authority-durability.cjs');
const source=()=>({products:[{id:1,name:'产品'}],materials:[{id:1,name:'PETG'}],records:{'2026-10-20':{off:false,items:[{_id:'r1',machine:1,status:'running',qty:1,productName:'产品',material:'PETG'}]}},inventory:{PETG:{stockG:1000}}});
function fixture(t){
 const before=process.env.BUSINESS_SYNC_STATION;process.env.BUSINESS_SYNC_STATION='test';
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE snapshot(value TEXT NOT NULL)');db.prepare('INSERT INTO snapshot VALUES(?)').run(JSON.stringify(source()));
 const load=()=>JSON.parse(db.prepare('SELECT value FROM snapshot').get().value),write=x=>db.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(x));
 const authority=createAuthority(db,{load,write}),clientId=randomUUID(),actor={id:'administrator-1'};
 const exchange=(data=load(),receipts=[])=>authority.handle({action:'authority-exchange',protocol:1,station:'test',clientId,remote:core.project(data),receipts});
 const enable=()=>authority.handle({action:'authority-enable',expected:exchange().hash,actor,backupConfirmed:true});
 const submit=(command,other={})=>authority.handle({action:'authority-submit',command,actor,...other});
 const stock=(id=randomUUID())=>({id,collection:'inventory',key:'PETG',operation:'stock',delta:-10,expected:commands.hash(core.project(load()).inventory.PETG),reason:'真实领料'});
 t.after(()=>{db.close();if(before===undefined)delete process.env.BUSINESS_SYNC_STATION;else process.env.BUSINESS_SYNC_STATION=before;});
 return {db,authority,load,write,clientId,actor,exchange,enable,submit,stock};
}
test('commands bind authenticated actor and fixed station/client; replay cannot change ownership or payload',t=>{
 const f=fixture(t);f.enable();const c=f.stock();f.submit(c);const stored=f.exchange().commands[0];
 assert.deepEqual(stored.binding,{station:'test',clientId:f.clientId,actor:f.actor.id});
 assert.equal(f.submit(c).pending,true);
 assert.throws(()=>f.submit(c,{actor:{id:'administrator-2'}}),/其他内容或账号/);
 assert.throws(()=>f.submit({...c,delta:-20}),/其他内容或账号/);
 assert.throws(()=>f.submit({...c,id:randomUUID(),binding:{...stored.binding,actor:'forged'}}),/指定申请归属/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM authority_commands').get().n,1);
 assert.equal(f.load().inventory.PETG.stockG,1000);
});
test('cutover cannot activate without explicit backup confirmation or a fresh matching snapshot',t=>{
 const f=fixture(t),hash=f.exchange().hash;
 assert.throws(()=>f.authority.handle({action:'authority-enable',actor:f.actor,expected:hash}),/备份/);
 assert.throws(()=>f.authority.handle({action:'authority-enable',actor:f.actor,expected:'0'.repeat(64),backupConfirmed:true}),/差异/);
 const state=JSON.parse(f.db.prepare('SELECT value FROM authority_state').get().value);state.seen='2000-01-01T00:00:00.000Z';f.db.prepare('UPDATE authority_state SET value=?').run(JSON.stringify(state));
 assert.throws(()=>f.authority.handle({action:'authority-enable',actor:f.actor,expected:hash,backupConfirmed:true}),/过期/);
 assert.equal(f.authority.enabled(),false);
});
test('terminal receipts are immutable including otherwise ignored metadata, and failure rolls back the full exchange',t=>{
 const f=fixture(t);f.enable();f.submit(f.stock());const c=f.exchange().commands[0],receipt={id:c.id,request:commands.requestHash(c),status:'rejected',error:'现场版本已改变',confirmedAt:new Date().toISOString()};
 f.exchange(f.load(),[receipt]);f.exchange(f.load(),[receipt]);
 const changed=f.load();changed.inventory.PETG.stockG=950;
 assert.throws(()=>f.exchange(changed,[{...receipt,status:'applied'}]),/不允许更改/);
 assert.throws(()=>f.exchange(changed,[{...receipt,_updatedAt:123}]),/不允许更改/);
 assert.equal(f.load().inventory.PETG.stockG,1000);
 assert.equal(JSON.parse(f.db.prepare('SELECT result FROM authority_commands').get().result).status,'rejected');
});
test('task versions are immutable and independent of source state while rejected tasks remain rejected on retry',t=>{
 const f=fixture(t);f.enable();const job={cloudJobId:'job-a',station:'test',revision:0,date:'2026-10-20',machine:101,productName:'产品',material:'PETG',qty:1,weight:10,status:'pending',remark:'任务'};
 assert.equal(f.authority.handle({action:'authority-job',job}).pending,true);
 assert.throws(()=>f.authority.handle({action:'authority-job',job:{...job,status:'done'}}),/相同任务版本/);
 assert.throws(()=>f.authority.handle({action:'authority-job',job:{...job,station:'other'}}),/归属/);
 const c=f.exchange().commands[0];f.exchange(f.load(),[{id:c.id,request:commands.requestHash(c),status:'rejected',error:'机台未映射'}]);
 assert.throws(()=>f.authority.handle({action:'authority-job',job}),/现场拒绝任务/);
 assert.equal(f.authority.handle({action:'authority-job',job:{...job,revision:1,status:'printing'}}).pending,true);
 assert.equal(f.exchange().commands.length,1);
});
test('source keeps a newer task version and rejects equal-version divergent task payloads',()=>{
 const a=source(),c={id:randomUUID(),operation:'task',collection:'schedules',key:'job-a',expected:'task',reason:'生产任务',value:{externalJobId:'job-a',revision:3,date:'2026-10-20',machine:1,qty:1,status:'done'}};
 const next=commands.apply(a,c).data;
 assert.equal(commands.apply(next,{...c,value:{...c.value,revision:2,status:'printing'}}).result.superseded,true);
 assert.throws(()=>commands.apply(next,{...c,value:{...c.value,status:'printing'}}),/相同任务版本/);
 assert.throws(()=>commands.apply(next,{id:randomUUID(),operation:'set',collection:'schedules',key:'1',expected:commands.hash(core.project(next).schedules['1']),reason:'更改',value:{externalJobId:'different'}}),/身份及版本/);
});
async function adapterFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'authority-regression-'));
 for(const [from,to]of [['legacy/business-sync-adapter.cjs','adapter.cjs'],['shared/business-sync.cjs','business-sync-core.cjs'],['shared/authority-commands.cjs','authority-commands.cjs'],['shared/json-stream.cjs','json-stream.cjs']])fs.copyFileSync(new URL('../'+from,import.meta.url),path.join(dir,to));
 const adapter=require(path.join(dir,'adapter.cjs'));let memory=source(),disk=structuredClone(memory),failDisk=false;
 const server=http.createServer((req,res)=>adapter(req,res,{enabled:true,load:()=>structuredClone(memory),readDisk:()=>structuredClone(disk),save:async x=>{memory=x;if(!failDisk)disk=structuredClone(x);}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request=async data=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/business-sync`,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 return {request,url:`http://127.0.0.1:${server.address().port}`,edit:fn=>{fn(memory);disk=structuredClone(memory);},disk:()=>disk,fail:()=>failDisk=true,reset:()=>{memory=structuredClone(disk);failDisk=false;}};
}
test('source rejects commands before verified cutover and enforces station binding after cutover',async t=>{
 const f=await adapterFixture(t),clientId=randomUUID(),binding={station:'test',clientId,actor:'admin'};
 const c={id:randomUUID(),operation:'stock',collection:'inventory',key:'PETG',expected:commands.hash(core.project(source()).inventory.PETG),delta:-10,reason:'领料',binding};
 assert.equal((await f.request({action:'command',command:c})).status,409);
 assert.equal((await f.request({action:'authority-enable',expected:'0'.repeat(64),station:'test',clientId})).status,409);
 assert.equal((await f.request({action:'authority-enable',expected:core.fingerprint(core.project(source())),station:'test',clientId})).status,200);
 assert.equal((await f.request({action:'command',command:{...c,binding:{...binding,station:'other'}}})).status,400);
 assert.equal((await f.request({action:'command',command:c})).data.status,'applied');
 assert.equal((await f.request({action:'command',command:c})).data.status,'applied');
 assert.equal(f.disk().inventory.PETG.stockG,990);assert.equal(f.disk().stockInLogs.length,1);
});
test('a rejected command cannot be acknowledged from memory if its receipt failed to reach disk',async t=>{
 const f=await adapterFixture(t),clientId=randomUUID();
 await f.request({action:'authority-enable',expected:core.fingerprint(core.project(source())),station:'test',clientId});
 f.fail();const c={id:randomUUID(),operation:'stock',collection:'inventory',key:'PETG',expected:'0'.repeat(64),delta:-10,reason:'现场已改变',binding:{station:'test',clientId,actor:'admin'}};
 assert.equal((await f.request({action:'command',command:c})).status,400);
 assert.equal((await f.request()).status,409);
 assert.equal(f.disk()._printlinkAuthority.receipts[c.id],undefined);
 f.reset();assert.equal((await f.request({action:'command',command:c})).data.status,'rejected');
 assert.equal((await f.request()).data.receipts.length,1);
});
test('atomic snapshot writes retain the old snapshot on pre-rename failure and preserve receipt identity after reload',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'authority-durable-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'data.json');
 const original={...source(),_printlinkAuthority:{enabled:true,station:'test',clientId:'client',receipts:{}}};durable.writeJSON(file,original);
 const receipt={id:'request',status:'applied'},next=structuredClone(original);next.inventory.PETG.stockG=990;next._printlinkAuthority.receipts.request=receipt;
 const rename=fs.renameSync;fs.renameSync=()=>{throw Error('simulated rename failure');};try{assert.throws(()=>durable.writeJSON(file,next),/rename failure/);}finally{fs.renameSync=rename;}
 assert.deepEqual(JSON.parse(fs.readFileSync(file)),original);assert.deepEqual(fs.readdirSync(dir),['data.json']);
 durable.writeJSON(file,next);assert.deepEqual(JSON.parse(fs.readFileSync(file)),next);
 const browser={...source(),_printlinkAuthority:{enabled:false,receipts:{forged:{status:'applied'}}}};durable.protect(browser,next,false);assert.deepEqual(browser._printlinkAuthority,next._printlinkAuthority);
 assert.throws(()=>durable.protect({...next,_printlinkAuthority:{...next._printlinkAuthority,receipts:{}}},next,true),/回执/);
});
test('Shanghai report date is identical across browser time zones at a UTC date boundary',()=>{
 const instant='2026-10-19T16:05:00.000Z';class FixedDate extends Date{constructor(value){super(value??instant);}}
 const context={Intl,Date:FixedDate};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../shared/production-report.js',import.meta.url),'utf8'),context);
 assert.equal(context.PrintLinkReport.today(),'2026-10-20');
});

test('one stale command is rejected without blocking a later debit or the fresh source snapshot',async t=>{
 const cloud=fixture(t),local=await adapterFixture(t);cloud.enable();
 const edit={id:randomUUID(),collection:'records',key:'r1',operation:'set',value:{qty:5},expected:commands.hash(core.project(cloud.load()).records.r1),reason:'修改数量'};
 cloud.submit(edit);cloud.submit(cloud.stock());local.edit(data=>{data.records['2026-10-20'].items[0].qty=2;});
 const bridge=new DatabaseSync(':memory:');bridge.exec('CREATE TABLE business_sync_client(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');bridge.prepare('INSERT INTO business_sync_client VALUES(1,?)').run(cloud.clientId);t.after(()=>bridge.close());
 const runner=startBusinessSync({db:bridge,config:{url:local.url,username:'fixture',password:'fixture'},autoStart:false,call:async(route,input)=>cloud.authority.handle({action:'authority-exchange',protocol:1,station:'test',...input})});t.after(()=>runner.close());
 await runner.sync();assert.equal(runner().error,'');
 assert.equal(local.disk().inventory.PETG.stockG,990);assert.equal(local.disk().stockInLogs.length,1);
 assert.equal(cloud.load().inventory.PETG.stockG,990);assert.equal(cloud.load().records['2026-10-20'].items[0].qty,2);
 assert.deepEqual(cloud.db.prepare('SELECT status FROM authority_commands ORDER BY status').all().map(x=>x.status),['applied','rejected']);
});

test('rolling mirror backups retain the original cutover while command receipts are never pruned',t=>{
 const f=fixture(t);f.enable();for(let i=0;i<8;i++){const next=f.load();next.inventory.PETG.stockG=999-i;f.exchange(next);}
 const backups=f.db.prepare('SELECT id,value FROM authority_backups ORDER BY id').all();assert.equal(backups.length,6);assert.equal(backups[0].id,1);assert.equal(JSON.parse(backups[0].value).inventory.PETG.stockG,1000);
});
