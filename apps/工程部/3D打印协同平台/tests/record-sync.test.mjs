import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {extractRecords} from '../collector/records.mjs';
const merge=createRequire(import.meta.url)('../production/record-sync.cjs');
test('70 records backfill 30 imported rows without duplicates or inventory changes; cloud edits and deletions win',()=>{
 const db=new DatabaseSync(':memory:');
 const items=Array.from({length:70},(_,i)=>({_id:'old-'+i,machine:1,autoRecord:true,productName:'产品'+i,qty:1,time:0,createdAt:'2026-10-09T00:00:00Z',printStartTime:'2026-10-09T00:00:00Z',image:'DO-NOT-SEND',password:'SECRET'}));
 const rows=extractRecords({records:{'2026-10-09':{items}}},{1:101});
 assert.ok(!JSON.stringify(rows).includes('SECRET'));assert.ok(!JSON.stringify(rows).includes('DO-NOT-SEND'));
 const data={records:{'2026-10-09':{items:structuredClone(items.slice(0,30))}},inventory:{PLA:{stockG:800}}};
 data.records['2026-10-09'].items[0].productName='云端已修改';
 assert.equal(merge(db,data,'qingxi',rows).added,40);assert.equal(data.records['2026-10-09'].items.length,70);
 assert.equal(merge(db,data,'qingxi',rows).added,0);assert.equal(data.records['2026-10-09'].items[0].productName,'云端已修改');
 assert.equal(data.inventory.PLA.stockG,800);
 const row=rows[69];row.record.printEndTime='2026-10-09T02:00:00Z';row.record.time=2;row.record.remark='打印失败';
 merge(db,data,'qingxi',[row]);const item=data.records['2026-10-09'].items[69];assert.equal(item.time,2);assert.equal(item.printerOutcome,'失败');assert.equal(item.printEndTime,row.record.printEndTime);
 item.time=3;row.record.time=4;merge(db,data,'qingxi',[row]);assert.equal(item.time,3);
 item._deleted=true;merge(db,data,'qingxi',[row]);assert.equal(item._deleted,true);assert.equal(data.records['2026-10-09'].items.length,70);
 data.records['2026-10-09'].items.pop();merge(db,data,'qingxi',[row]);assert.equal(data.records['2026-10-09'].items.length,69);
 db.close();
});
import http from 'node:http';
import {startRecordSync} from '../collector/records.mjs';
test('bridge retries failed batches, persists cursors across restart and reads large snapshot only on version changes',async()=>{
 const db=new DatabaseSync(':memory:');let version=1,reads=0,calls=0,fail=true;
 const source={records:{'2026-10-09':{items:[{_id:'one',machine:1,autoRecord:true,productName:'one',printStartTime:'2026-10-09T00:00:00Z'}]}}};
 const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Basic '+Buffer.from('user:secret').toString('base64'));res.setHeader('Content-Type','application/json');if(req.url==='/api/version')res.end(JSON.stringify({version}));else{reads++;res.end(JSON.stringify(source));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={autoStart:false,config:{url:`http://127.0.0.1:${server.address().port}`,username:'user',password:'secret',machineMap:{1:101}},db,bindings:()=>({}),assignments:()=>[],call:async(route,input)=>{calls++;assert.equal(route,'/api/collector/records');assert.equal(input.records[0].machine,'101');if(fail)throw Error('offline');return {ok:true};}};
 try{
  let sync=startRecordSync(options);await sync.sync();assert.match(sync().error,/offline/);assert.equal(db.prepare('SELECT COUNT(*) n FROM record_cursors').get().n,0);
  fail=false;await sync.sync();assert.equal(sync().error,'');assert.equal(calls,2);const previousReads=reads;await sync.sync();assert.equal(reads,previousReads);
  sync.close();sync=startRecordSync(options);await sync.sync();assert.equal(calls,2,'restart does not resend acknowledged records');
  version++;source.records['2026-10-09'].items[0].printEndTime='2026-10-10T01:00:00Z';await sync.sync();assert.equal(calls,3);sync.close();
 }finally{db.close();await new Promise(r=>server.close(r));}
});

test('separate source batches and retry attempts remain distinct even for one cloud order',()=>{
 const db=new DatabaseSync(':memory:'),data={records:{}};
 const row={sourceId:'batch-a',date:'2026-10-09',sourceMachine:'11',machine:'111',jobId:'order-job',attempt:1,record:{autoRecord:true,printStartTime:'2026-10-09T01:00:00Z'}};
 merge(db,data,'station',[row,{...row,sourceId:'batch-b',attempt:2}]);
 assert.equal(data.records[row.date].items.length,2);
 merge(db,data,'station',[row,{...row,sourceId:'batch-b',attempt:2}]);assert.equal(data.records[row.date].items.length,2);db.close();
});
