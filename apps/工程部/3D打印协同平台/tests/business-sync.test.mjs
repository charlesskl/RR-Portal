import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import core from '../shared/business-sync.cjs';
import createSync from '../production/business-sync.cjs';
const snapshot=()=>({products:[{id:1,name:'扣子',price:10}],materials:[{id:1,name:'PETG'}],records:{'2026-10-10':{off:false,items:[{_id:'r1',machine:11,productName:'扣子',qty:1,weight:10,material:'PETG'}]}},inventory:{PETG:{stockG:1000,minStockG:50}}});
const doc=()=>core.project(snapshot());
function resolve(result,side){return Object.fromEntries(result.conflicts.map(c=>[c.id,{signature:c.signature,side}]));}
test('all business collections round trip; credentials and cloud ownership never leave',()=>{
 const data=snapshot();data.settings={laborPerDay:100,password:'secret',printers:[{accessCode:'secret'}]};data.records['2026-10-10'].items[0].cloudJobId='job';
 for(const name of ['schedules','maintenance','miscExpenses','stockInLogs'])data[name]=[{id:2,name:'记录',amount:5}];
 const projected=core.project(data);assert.ok(!JSON.stringify(projected).includes('secret'));assert.ok(!JSON.stringify(projected).includes('job'));
 assert.deepEqual(core.project(core.apply(data,projected)),projected);assert.equal(core.apply(data,projected).records['2026-10-10'].items[0].cloudJobId,'job');
});
test('independent field edits merge, same-field conflicts require a current choice',()=>{
 const base=doc(),cloud=structuredClone(base),windows=structuredClone(base);cloud.records.r1.qty=2;windows.records.r1.productName='眼睛';
 let r=core.merge(base,cloud,windows);assert.equal(r.conflicts.length,0);assert.equal(r.data.records.r1.qty,2);assert.equal(r.data.records.r1.productName,'眼睛');
 windows.records.r1.qty=3;r=core.merge(base,cloud,windows);assert.equal(r.conflicts.length,1);
 const choices=resolve(r,'windows');assert.equal(core.merge(base,cloud,windows,choices).data.records.r1.qty,3);
 windows.records.r1.qty=4;assert.equal(core.merge(base,cloud,windows,choices).conflicts.length,1);
});
test('first reconciliation flags one-sided rows and stock, concurrent ID collisions never merge',()=>{
 const cloud=doc(),windows=doc();windows.products['2']={id:2,name:'新产品'};windows.inventory.PETG.stockG=900;
 const r=core.merge(null,cloud,windows);assert.equal(r.conflicts.length,2);assert.equal(core.merge(null,cloud,windows,resolve(r,'windows')).conflicts.length,0);
 const base=doc();cloud.products['2']={id:2,name:'云产品'};assert.equal(core.merge(base,cloud,windows).conflicts.length,1);
});
test('deletions, delete/edit conflicts, removed fields and source IDs survive roundtrip',()=>{
 const data=snapshot();data.records['2026-10-10'].items[0]._id='bridge-id';data.records['2026-10-10'].items[0].sourceRecordId='r1';
 const base=core.project(data),cloud=structuredClone(base),windows=structuredClone(base);delete cloud.products['1'];delete cloud.records.r1.weight;
 let r=core.merge(base,cloud,windows);assert.equal(r.conflicts.length,0);const applied=core.apply(data,r.data);assert.equal(applied.products.length,0);assert.equal(applied.records['2026-10-10'].items[0]._id,'bridge-id');assert.ok(!('weight' in applied.records['2026-10-10'].items[0]));
 windows.products['1'].name='修改';assert.equal(core.merge(base,cloud,windows).conflicts.length,1);
});
test('inventory copies balances once; simultaneous balances conflict; retry is idempotent',()=>{
 const base=doc(),cloud=doc(),windows=doc();windows.inventory.PETG.stockG=990;
 let r=core.merge(base,cloud,windows);assert.equal(r.data.inventory.PETG.stockG,990);
 assert.equal(core.merge(base,r.data,windows).conflicts.length,1,'equal balances can represent two independent debits and require review');
 cloud.inventory.PETG.stockG=980;assert.equal(core.merge(base,cloud,windows).conflicts.length,1);
});
test('cloud transaction persists conflicts without changing business data, resolves and retries safely',()=>{
 process.env.BUSINESS_SYNC_STATION='test';const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE snapshot(value TEXT)');db.prepare('INSERT INTO snapshot VALUES (?)').run(JSON.stringify(snapshot()));
 const load=()=>JSON.parse(db.prepare('SELECT value FROM snapshot').get().value),write=data=>db.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(data));
 const sync=createSync(db,{load,write}),remote=doc();remote.inventory.PETG.stockG=800;
 assert.equal(sync({action:'exchange',clientId:'11111111-1111-1111-1111-111111111111',station:'test',remote}).ok,false);assert.equal(load().inventory.PETG.stockG,1000);
 const conflicts=sync({action:'status'}).conflicts;sync({action:'resolve',choices:conflicts.map(c=>({id:c.id,signature:c.signature,side:'windows'}))});
 assert.equal(sync({action:'exchange',clientId:'11111111-1111-1111-1111-111111111111',station:'test',remote}).ok,true);assert.equal(load().inventory.PETG.stockG,800);
 assert.equal(sync({action:'exchange',clientId:'11111111-1111-1111-1111-111111111111',station:'test',remote}).ok,true);assert.equal(load().inventory.PETG.stockG,800);
 assert.throws(()=>sync({action:'exchange',clientId:'11111111-1111-1111-1111-111111111111',station:'other',remote}));db.close();delete process.env.BUSINESS_SYNC_STATION;
});
test('transport rejects reserved metadata, credentials and prototype keys rather than storing stripped values',()=>{
 for(const key of ['token','_sourceFacts','__proto__']){const input=doc();Object.defineProperty(input.products['1'],key,{value:'do-not-store',enumerable:true});assert.throws(()=>core.apply({},input),/保留字段/);}
});
test('cloud rollback is atomic and a different bridge instance cannot take over',()=>{
 process.env.BUSINESS_SYNC_STATION='test';const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE snapshot(value TEXT)');db.prepare('INSERT INTO snapshot VALUES (?)').run(JSON.stringify(snapshot()));
 const load=()=>JSON.parse(db.prepare('SELECT value FROM snapshot').get().value);
 let failWrite=false;const sync=createSync(db,{load,write:data=>{db.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(data));if(failWrite)throw Error('disk full');}});
 const input={action:'exchange',station:'test',clientId:'11111111-1111-1111-1111-111111111111',base:doc(),remote:doc()};sync(input);
 assert.throws(()=>sync({...input,clientId:'22222222-2222-2222-2222-222222222222'}),/其他桥接/);
 const backupsBefore=db.prepare('SELECT COUNT(*) n FROM business_sync_backups').get().n;
 input.remote.inventory.PETG.stockG=900;failWrite=true;assert.throws(()=>sync(input),/disk full/);assert.equal(load().inventory.PETG.stockG,1000);assert.equal(db.prepare('SELECT COUNT(*) n FROM business_sync_backups').get().n,backupsBefore);
 failWrite=false;assert.equal(sync(input).ok,true);assert.equal(sync(input).ok,true);assert.equal(load().inventory.PETG.stockG,900);db.close();delete process.env.BUSINESS_SYNC_STATION;
});

test('keep both preserves colliding products, images and source-side references without touching stock',()=>{
 const base=doc(),cloud=doc(),windows=doc();
 cloud.products['658']={id:658,name:'车轮47705',image:'data:image/png;base64,cloud'};
 cloud.products['659']={id:659,name:'47756A自卸卡车'};
 windows.products['658']={id:658,name:'老奶奶眼睛底模',image:'data:image/png;base64,windows'};
 windows.products['659']={id:659,name:'71137眼镜蛇身前段身'};
 windows.products['900']={id:900,name:'占用编号'};
 cloud.days['2026-10-16']={off:false};windows.days['2026-10-16']={off:false};
 cloud.records.c={_id:'c',date:'2026-10-16',productId:658};
 windows.records.w={_id:'w',date:'2026-10-16',productId:'658'};
 windows.schedules['3']={id:3,productId:659};
 const conflicts=core.merge(base,cloud,windows);
 const choices=resolve(conflicts,'both'),result=core.merge(base,cloud,windows,choices);
 assert.equal(result.conflicts.length,0);
 assert.equal(result.data.products['658'].name,'车轮47705');
 assert.equal(result.data.products['901'].name,'老奶奶眼睛底模');
 assert.equal(result.data.products['901'].image,windows.products['658'].image);
 assert.equal(result.data.products['902'].name,'71137眼镜蛇身前段身');
 assert.equal(result.data.records.c.productId,658);assert.equal(result.data.records.w.productId,'901');
 assert.equal(result.data.schedules['3'].productId,902);assert.deepEqual(result.data.inventory,base.inventory);
 assert.deepEqual(core.project(core.apply({},result.data)),result.data);
 assert.equal(windows.products['658'].id,658,'input is not mutated');
 // Lost response followed by a new Windows edit must reuse the allocated ID.
 windows.products['658'].price=7;
 const retry=core.merge(base,result.data,windows,{},result.productRemaps);
 assert.equal(Object.keys(retry.data.products).length,6);
 assert.equal(retry.conflicts.length,1);assert.deepEqual(retry.conflicts[0].path,['products','901']);
 const resolved=core.merge(base,result.data,windows,resolve(retry,'windows'),result.productRemaps);
 assert.equal(resolved.conflicts.length,0);assert.equal(resolved.data.products['901'].price,7);
 const ack=core.merge(resolved.data,resolved.data,resolved.data,{},result.productRemaps);
 assert.equal(ack.conflicts.length,0);assert.deepEqual(ack.productRemaps,[]);
});

test('keep both choice expires on edits and cannot split existing shared products or inventory',()=>{
 const base=doc(),cloud=doc(),windows=doc();cloud.products['2']={id:2,name:'云产品'};windows.products['2']={id:2,name:'现场产品'};
 const choices=resolve(core.merge(base,cloud,windows),'both');windows.products['2'].name='已修改';
 assert.equal(core.merge(base,cloud,windows,choices).conflicts.length,1);
 cloud.inventory.PETG.stockG=900;windows.inventory.PETG.stockG=800;
 const result=core.merge(base,cloud,windows);const merged=core.merge(base,cloud,windows,resolve(result,'both'));
 assert.equal(merged.conflicts.length,1);assert.equal(merged.conflicts[0].path[0],'inventory');
});

test('product split mapping survives server restart and lost response without duplicating products',()=>{
 process.env.BUSINESS_SYNC_STATION='test';const db=new DatabaseSync(':memory:');
 try{
 db.exec('CREATE TABLE snapshot(value TEXT)');const initial=snapshot();initial.products.push({id:658,name:'云产品'});
 db.prepare('INSERT INTO snapshot VALUES (?)').run(JSON.stringify(initial));
 const load=()=>JSON.parse(db.prepare('SELECT value FROM snapshot').get().value),write=x=>db.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(x));
 let sync=createSync(db,{load,write});const remote=doc();remote.products['658']={id:658,name:'现场产品'};
 const input={action:'exchange',station:'test',clientId:'11111111-1111-1111-1111-111111111111',base:doc(),remote};
 assert.equal(sync(input).ok,false);
 sync({action:'resolve',choices:sync({action:'status'}).conflicts.map(c=>({id:c.id,signature:c.signature,side:'both'}))});
 assert.equal(sync(input).ok,true);assert.equal(load().products.length,3);
 sync=createSync(db,{load,write});assert.equal(sync(input).ok,true);assert.equal(load().products.length,3);
 remote.days['2026-10-16']={off:false};remote.records.new={_id:'new',date:'2026-10-16',productId:658};
 assert.equal(sync(input).ok,true);assert.equal(load().products.length,3);
 assert.equal(load().records['2026-10-16'].items[0].productId,659);
 }finally{db.close();delete process.env.BUSINESS_SYNC_STATION;}
});

test('first reconciliation can keep both products without approving unrelated differences',()=>{
 const cloud=doc(),windows=doc();cloud.products['658']={id:658,name:'云产品'};windows.products['658']={id:658,name:'现场产品'};windows.inventory.PETG.stockG=800;
 const initial=core.merge(null,cloud,windows),choices=Object.fromEntries(initial.conflicts.filter(core.canKeepBoth).map(c=>[c.id,{signature:c.signature,side:'both'}]));
 const result=core.merge(null,cloud,windows,choices);
 assert.equal(result.data.products['658'].name,'云产品');assert.equal(result.data.products['659'].name,'现场产品');
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].path[0],'inventory');
});

test('a newly occupied remap target stops retry instead of confusing unrelated products',()=>{
 const base=doc(),cloud=doc(),windows=doc();cloud.products['658']={id:658,name:'云产品'};windows.products['658']={id:658,name:'现场产品'};
 const initial=core.merge(base,cloud,windows),split=core.merge(base,cloud,windows,resolve(initial,'both'));
 windows.products['659']={id:659,name:'另一新增产品'};
 assert.throws(()=>core.merge(base,split.data,windows,{},split.productRemaps),/占用/);
});
