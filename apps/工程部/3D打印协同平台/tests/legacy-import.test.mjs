import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {planImport}=createRequire(import.meta.url)('../production/legacy-import.cjs');
const empty=()=>({settings:null,materials:[],products:[],schedules:[],maintenance:[],stockInLogs:[],miscExpenses:[],records:{},inventory:{}});
test('legacy import previews totals, merges idempotently, preserves cloud jobs and rejects conflicting inventory',()=>{
 const source={...empty(),settings:{machines:21},products:[{id:1,name:'原产品'}],materials:[{id:1,name:'PLA'}],inventory:{PLA:{stockG:100}},records:{'2026-10-08':{off:false,items:[{_id:'old1',machine:1,qty:3}]}},schedules:[{id:1,machine:1}]};
 const first=planImport(empty(),source);assert.equal(first.summary.after.recordItems,1);assert.equal(first.summary.after.products,1);assert.deepEqual(first.conflicts,[]);
 const repeated=planImport(first.next,source);assert.deepEqual(repeated.next,first.next);assert.deepEqual(repeated.conflicts,[]);
 const current=structuredClone(first.next);current.schedules.push({id:2,cloudJobId:'job-1'});current.records['2026-10-09']={items:[{_id:'cloud1',cloudJobId:'job-1'}]};
 const merged=planImport(current,source);assert.equal(merged.next.schedules[1].cloudJobId,'job-1');assert.equal(merged.summary.after.recordItems,2);
 current.inventory.PLA.stockG=75;assert.match(planImport(current,source).conflicts.join(),/库存/);assert.equal(current.inventory.PLA.stockG,75);
 assert.notEqual(first.fingerprint,planImport(current,source).fingerprint);
 assert.throws(()=>planImport(empty(),{...source,products:[{cloudJobId:'bad'}]}),/云端/);
 assert.throws(()=>planImport(empty(),{products:[]}),/完整/);
});
