const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
const start = source.indexOf('function electronicDetailFingerprint');
const end = source.indexOf('function isDerivedElectronicSummary', start);
const context = {};
vm.runInNewContext(source.slice(start,end),context);
const sync=context.syncElectronicDetailSummary;
const fresh = price => [{name:'IC',qty:1,unit_price_rmb:price,_electronic_summary_role:'ic'},
 {name:'PACB电子',qty:1,unit_price_rmb:2,_electronic_summary_role:'pacb'}];
test('保留手填总表并追加；反复汇总不重复，自动行继续更新',()=>{
 const p={electronics:[{name:'PACB',qty:1,unit_price_rmb:1}]};
 sync(p,fresh(3));sync(p,fresh(4));
 assert.equal(p.electronics.length,3);assert.equal(p.electronics[0].unit_price_rmb,1);
 assert.equal(p.electronics[1].unit_price_rmb,4);
});
test('追加行手改后不覆盖；保存重载及明细删除仍保留手填行',()=>{
 const p={electronics:[{name:'手填',qty:1,unit_price_rmb:99}]};sync(p,fresh(3));
 p.electronics[1].unit_price_rmb=88;
 const restored=JSON.parse(JSON.stringify(p));sync(restored,fresh(5));
 assert.equal(restored.electronics.length,3);assert.equal(restored.electronics[1].unit_price_rmb,88);
 sync(restored,[]);assert.equal(restored.electronics.length,2);assert.equal(restored.electronics[0].unit_price_rmb,99);
});
test('空总表可汇总，旧版未改自动总表迁移不重复',()=>{
 const rows=fresh(3);const p={electronics:rows,electronics_summary_baseline:JSON.stringify(rows)};
 sync(p,fresh(4));assert.equal(p.electronics.length,2);assert.equal(p.electronics[0].unit_price_rmb,4);
 const empty={};sync(empty,fresh(3));assert.equal(empty.electronics.length,2);
});
