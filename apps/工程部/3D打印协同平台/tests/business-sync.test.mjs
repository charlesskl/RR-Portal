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
 assert.equal(retry.conflicts.length,1);assert.deepEqual(retry.conflicts[0].path,['产品编号归属','658']);
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

const productIdentity='_printlinkProductIdentity';
function splitFixture(base=doc()){
 const cloud=doc(),windows=doc();cloud.products['658']={id:658,name:'Cloud',image:'data:image/png;base64,cloud'};windows.products['658']={id:658,name:'Windows',image:'data:image/png;base64,windows'};
 const split=core.merge(base,cloud,windows,resolve(core.merge(base,cloud,windows),'both'));
 assert.equal(split.conflicts.length,0);return {base,cloud,windows,split};
}
test('post-CAS lost acknowledgement merges offline edits using stable identities',()=>{
 const {base,split}=splitFixture(),cloud=structuredClone(split.data),windows=structuredClone(split.data);
 cloud.products['659'].price=7;windows.products['658'].price=3;
 const result=core.merge(base,cloud,windows,{},split.productRemaps);
 assert.equal(result.conflicts.length,0);assert.equal(result.data.products['658'].price,3);assert.equal(result.data.products['659'].price,7);
 assert.equal(result.data.products['658'][productIdentity],split.data.products['658'][productIdentity]);
 assert.equal(result.data.products['659'][productIdentity],split.data.products['659'][productIdentity]);
});
test('post-CAS target deletion never moves the surviving cloud product or its new records',()=>{
 const {base,split}=splitFixture(),cloud=structuredClone(split.data),windows=structuredClone(split.data);
 delete cloud.products['659'];delete windows.products['659'];
 windows.days['2026-10-16']={off:false};windows.records.new={_id:'new',date:'2026-10-16',productId:658};
 const result=core.merge(base,cloud,windows,{},split.productRemaps);
 assert.equal(result.conflicts.length,0);assert.equal(result.data.products['659'],undefined);assert.equal(result.data.records.new.productId,658);
 // One-sided removal also propagates against the approved split baseline.
 const removed=core.merge(base,split.data,windows,{},split.productRemaps);
 assert.equal(removed.conflicts.length,0);assert.equal(removed.data.products['659'],undefined);
 const editedCloud=structuredClone(split.data);editedCloud.products['659'].price=5;
 const deletedVsEdited=core.merge(base,editedCloud,windows,{},split.productRemaps);
 assert.deepEqual(deletedVsEdited.conflicts.map(c=>c.path),[['products','659']]);
});
test('pending split baselines stay immutable across repeated changed requests',()=>{
 const {base,windows,split}=splitFixture(),cloud=structuredClone(split.data);cloud.products['659'].price=7;
 const first=core.merge(base,cloud,windows,{},split.productRemaps);assert.equal(first.conflicts.length,0);assert.equal(first.data.products['659'].price,7);
 windows.days['2026-10-16']={off:false};windows.records.new={_id:'new',date:'2026-10-16',productId:658};
 const second=core.merge(base,first.data,windows,{},first.productRemaps);
 assert.equal(second.conflicts.length,0);assert.equal(second.data.products['659'].price,7,'an old unacknowledged source must not revert a cloud edit');
 assert.equal(second.data.records.new.productId,659);
});
test('first reconciliation retry inherits only approved product rows',()=>{
 const {windows,split}=splitFixture(null);windows.products['658'].price=9;
 windows.days['2026-10-16']={off:false};windows.records.new={_id:'new',date:'2026-10-16',productId:'658'};windows.inventory.PETG.stockG=800;
 const unknown=core.merge(null,split.data,windows,{},split.productRemaps);
 assert.equal(unknown.conflicts.length,1);assert.equal(unknown.conflicts[0].path[0],'产品编号归属');
 let result=core.merge(null,split.data,windows,resolve(unknown,'windows'),split.productRemaps);
 assert.ok(result.conflicts.some(c=>c.path[0]==='inventory'));assert.ok(result.conflicts.some(c=>c.path[0]==='records'));
 assert.ok(!result.conflicts.some(c=>c.path[0]==='products'),'approved split rows do not need a second unrelated approval');
 assert.equal(result.data.products['659'].price,9);
 assert.equal(result.data.products['658'].name,'Cloud');assert.equal(result.data.products['659'].name,'Windows');
 const choices={...resolve(unknown,'windows'),...resolve(result,'windows')};
 result=core.merge(null,split.data,windows,choices,split.productRemaps);
 assert.equal(result.conflicts.length,0);assert.equal(result.data.records.new.productId,'659');assert.equal(result.data.inventory.PETG.stockG,800);
});
test('stripped identity markers require current explicit namespace confirmation',()=>{
 const {base,split}=splitFixture(),windows=structuredClone(split.data);
 for(const p of Object.values(windows.products))delete p[productIdentity];
 windows.products['658'].price=3;windows.products['659'].price=4;
 const unknown=core.merge(base,split.data,windows,{},split.productRemaps);
 assert.equal(unknown.conflicts[0].path[0],'产品编号归属');
 const choices=resolve(unknown,'cloud'),result=core.merge(base,split.data,windows,choices,split.productRemaps);
 assert.equal(result.conflicts.length,0);assert.equal(result.data.products['658'].price,3);assert.equal(result.data.products['659'].price,4);
 assert.equal(result.data.products['658'][productIdentity],split.data.products['658'][productIdentity]);
 windows.products['658'].price=8;
 assert.equal(core.merge(base,split.data,windows,choices,split.productRemaps).conflicts[0].path[0],'产品编号归属','namespace choice expires when source changes');
});
test('existing identity fields and different product identities cannot be silently overwritten',()=>{
 const {base,cloud,windows}=splitFixture();
 cloud.products['658'][productIdentity]='business-owned-value';
 const first=core.merge(base,cloud,windows),result=core.merge(base,cloud,windows,resolve(first,'both'));
 assert.equal(core.canKeepBoth(first.conflicts[0]),false);assert.equal(result.conflicts.length,1);
 assert.equal(result.data.products['658'][productIdentity],'business-owned-value');
 const shared=splitFixture(),c=structuredClone(shared.split.data),w=structuredClone(shared.split.data);
 w.products['659'][productIdentity]='printlink-product-v1:'+'a'.repeat(64);w.products['659'].price=6;
 const changed=core.merge(shared.split.data,c,w);
 assert.deepEqual(changed.conflicts.map(x=>x.path),[['products','659']]);
 assert.equal(core.canKeepBoth(changed.conflicts[0]),false);
});
test('merge does not clone full image documents and leaves inputs untouched',()=>{
 const {base,cloud,windows}=splitFixture();const initial=core.merge(base,cloud,windows),choices=resolve(initial,'both');
 const originalClone=globalThis.structuredClone;globalThis.structuredClone=()=>{throw Error('whole-document clone forbidden');};
 try{
  const merged=core.merge(base,cloud,windows,choices);
  assert.equal(merged.conflicts.length,0);assert.equal(windows.products['658'].id,658);assert.equal(windows.products['658'][productIdentity],undefined);
  assert.equal(merged.data.products['659'].image,windows.products['658'].image);
 }finally{globalThis.structuredClone=originalClone;}
});
test('post-CAS deleted target recovery remains correct through SQLite restart',()=>{
 process.env.BUSINESS_SYNC_STATION='test';const db=new DatabaseSync(':memory:');
 try{
 const {base,cloud,windows}=splitFixture();db.exec('CREATE TABLE snapshot(value TEXT)');db.prepare('INSERT INTO snapshot VALUES (?)').run(JSON.stringify(core.apply({},cloud)));
 const load=()=>JSON.parse(db.prepare('SELECT value FROM snapshot').get().value),write=x=>db.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(x));
 let sync=createSync(db,{load,write});const input={action:'exchange',station:'test',clientId:'11111111-1111-1111-1111-111111111111',base,remote:windows};
 assert.equal(sync(input).ok,false);sync({action:'resolve',choices:sync({action:'status'}).conflicts.map(c=>({id:c.id,signature:c.signature,side:'both'}))});
 const accepted=sync(input);assert.equal(accepted.ok,true);input.remote=structuredClone(accepted.data);
 const next=load();next.products=next.products.filter(p=>p.id!==659);write(next);delete input.remote.products['659'];
 input.remote.days['2026-10-16']={off:false};input.remote.records.new={_id:'new',date:'2026-10-16',productId:658};
 sync=createSync(db,{load,write});assert.equal(sync(input).ok,true);
 assert.equal(load().products.some(p=>p.id===659),false);assert.equal(load().records['2026-10-16'].items[0].productId,658);
 assert.equal(JSON.parse(db.prepare('SELECT value FROM business_sync_state WHERE id=1').get().value).productRemaps.length,1);
 }finally{db.close();delete process.env.BUSINESS_SYNC_STATION;}
});
test('status derives the canonical keep-both flag without trusting persisted flags',()=>{
 process.env.BUSINESS_SYNC_STATION='test';const db=new DatabaseSync(':memory:');
 try{
 const {base,cloud,windows}=splitFixture(),sync=createSync(db,{load:()=>core.apply({},cloud),write:()=>{throw Error('unexpected write');}});
 const input={action:'exchange',station:'test',clientId:'11111111-1111-1111-1111-111111111111',base,remote:windows};
 assert.equal(sync(input).ok,false);let status=sync({action:'status'});assert.equal(status.conflicts[0].canKeepBoth,true);
 const state=JSON.parse(db.prepare('SELECT value FROM business_sync_state WHERE id=1').get().value);
 state.conflicts[0].cloud[productIdentity]='owned-business-value';state.conflicts[0].canKeepBoth=true;
 db.prepare('UPDATE business_sync_state SET value=? WHERE id=1').run(JSON.stringify(state));
 status=sync({action:'status'});assert.equal(status.conflicts[0].canKeepBoth,false);
 assert.throws(()=>sync({action:'resolve',choices:status.conflicts.map(c=>({id:c.id,signature:c.signature,side:'both'}))}),/冲突已变化/);
 }finally{db.close();delete process.env.BUSINESS_SYNC_STATION;}
});
test('legacy mappings require namespace confirmation and do not approve changed product values',()=>{
 const {base,split}=splitFixture(),cloud=structuredClone(split.data),windows=structuredClone(split.data);
 for(const d of [cloud,windows])for(const p of Object.values(d.products))delete p[productIdentity];
 windows.products['659'].price=8;
 const legacy=[{from:'658',to:659}],first=core.merge(base,cloud,windows,{},legacy);
 assert.equal(first.conflicts[0].path[0],'产品编号归属');
 const namespace=resolve(first,'cloud'),next=core.merge(base,cloud,windows,namespace,legacy);
 assert.deepEqual(next.conflicts.map(c=>c.path),[['products','659']]);
 const final=core.merge(base,cloud,windows,{...namespace,...resolve(next,'windows')},legacy);
 assert.equal(final.conflicts.length,0);assert.equal(final.data.products['659'].price,8);
 assert.ok(final.productRemaps[0].cloudIdentity);assert.ok(final.data.products['658'][productIdentity]);
});
test('first split lost response plus new records does not ask to reapprove either product',()=>{
 const {windows,split}=splitFixture(null);
 windows.days['2026-10-16']={off:false};windows.records.new={_id:'new',date:'2026-10-16',productId:658};
 const retry=core.merge(null,split.data,windows,{},split.productRemaps);
 assert.deepEqual(retry.conflicts.map(c=>c.path),[['days','2026-10-16'],['records','new']]);
 const accepted=core.merge(null,split.data,windows,resolve(retry,'windows'),split.productRemaps);
 assert.equal(accepted.conflicts.length,0);assert.equal(accepted.data.records.new.productId,659);
});
test('split transaction rollback leaves no marker, mapping, receipt or backup behind',()=>{
 process.env.BUSINESS_SYNC_STATION='test';const db=new DatabaseSync(':memory:');
 try{
 const {base,cloud,windows}=splitFixture();db.exec('CREATE TABLE snapshot(value TEXT)');db.prepare('INSERT INTO snapshot VALUES (?)').run(JSON.stringify(core.apply({},cloud)));
 const load=()=>JSON.parse(db.prepare('SELECT value FROM snapshot').get().value);let fail=true;
 const sync=createSync(db,{load,write:x=>{db.prepare('UPDATE snapshot SET value=?').run(JSON.stringify(x));if(fail)throw Error('disk full');}});
 const input={action:'exchange',station:'test',clientId:'11111111-1111-1111-1111-111111111111',base,remote:windows};
 sync(input);sync({action:'resolve',choices:sync({action:'status'}).conflicts.map(c=>({id:c.id,signature:c.signature,side:'both'}))});
 assert.throws(()=>sync(input),/disk full/);
 const state=JSON.parse(db.prepare('SELECT value FROM business_sync_state WHERE id=1').get().value);
 assert.equal(state.productRemaps,undefined);assert.equal(state.receipt,undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM business_sync_backups').get().n,0);
 assert.equal(load().products.find(p=>p.id===658)[productIdentity],undefined);
 fail=false;assert.equal(sync(input).ok,true);assert.equal(load().products.length,3);assert.equal(db.prepare('SELECT COUNT(*) n FROM business_sync_backups').get().n,1);
 }finally{db.close();delete process.env.BUSINESS_SYNC_STATION;}
});
test('split allocation includes tombstones and rejects integer overflow',()=>{
 const {base,cloud,windows}=splitFixture();cloud.products['900']={id:900,name:'deleted',_deleted:true};
 const first=core.merge(base,cloud,windows),split=core.merge(base,cloud,windows,resolve(first,'both'));
 assert.equal(split.data.products['901'].name,'Windows');assert.equal(split.data.products['900']._deleted,true);
 cloud.products[String(Number.MAX_SAFE_INTEGER)]={id:Number.MAX_SAFE_INTEGER,name:'last id'};
 const last=core.merge(base,cloud,windows);assert.throws(()=>core.merge(base,cloud,windows,resolve(last,'both')),/安全范围/);
});
test('multiple split products rewrite only source references, including cross-product links',()=>{
 const base=doc(),cloud=doc(),windows=doc();
 cloud.products['658']={id:658,name:'Cloud A',links:{productId:659}};cloud.products['659']={id:659,name:'Cloud B',links:{productId:658}};
 windows.products['658']={id:658,name:'Windows A',links:{productId:659}};windows.products['659']={id:659,name:'Windows B',links:{productId:658}};
 const split=core.merge(base,cloud,windows,resolve(core.merge(base,cloud,windows),'both'));
 assert.equal(split.conflicts.length,0);assert.equal(split.data.products['658'].links.productId,659);assert.equal(split.data.products['659'].links.productId,658);
 assert.equal(split.data.products['660'].links.productId,661);assert.equal(split.data.products['661'].links.productId,660);
 const retry=core.merge(base,split.data,windows,{},split.productRemaps);
 assert.equal(retry.conflicts.length,0);assert.equal(retry.data.products['658'].links.productId,659);assert.equal(retry.data.products['659'].links.productId,658);
 assert.equal(retry.data.products['660'].links.productId,661);assert.equal(retry.data.products['661'].links.productId,660);
});
test('new collisions during a pending split do not rewrite synthetic cloud references',()=>{
 const {base,cloud,windows,split}=splitFixture();
 const current=structuredClone(split.data);current.products['658'].links={productId:700};
 current.products['700']={id:700,name:'Cloud B'};windows.products['700']={id:700,name:'Windows B',links:{productId:658}};
 const initial=core.merge(base,current,windows,{},split.productRemaps);
 const result=core.merge(base,current,windows,resolve(initial,'both'),split.productRemaps);
 assert.equal(result.conflicts.length,0);assert.equal(result.data.products['658'].links.productId,700);
 assert.equal(result.data.products['701'].name,'Windows B');assert.equal(result.data.products['701'].links.productId,659);
});
