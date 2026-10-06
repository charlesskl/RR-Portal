const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
const start = source.indexOf('function syncElectronicDetailSummary');
const end = source.indexOf('function isDerivedElectronicSummary', start);
const context = {};
vm.runInNewContext(source.slice(start,end),context);
const sync=context.syncElectronicDetailSummary;
test('空总表可由明细创建，后续汇总及保存重载继续同步',()=>{
 const p={electronics:[]};
 assert.equal(sync(p,[{name:'IC',qty:1,unit_price:2}]),true);
 const restored=JSON.parse(JSON.stringify(p));
 assert.equal(sync(restored,[{name:'IC',qty:2,unit_price:3}]),true);
 assert.equal(restored.electronics[0].qty,2);
});
test('手动编辑总表或已有历史数据不被汇总覆盖',()=>{
 for(const manual of [false,true]) {
  const p={electronics:[]};sync(p,[{name:'IC',qty:1,unit_price:2}]);
  if(manual)p.electronics_summary_manual=true;else p.electronics[0].unit_price=9;
  const before=JSON.stringify(p.electronics);
  assert.equal(sync(p,[{name:'PACB',unit_price:4}]),false);
  assert.equal(JSON.stringify(p.electronics),before);
 }
 const old={electronics:[{name:'旧总表',unit_price:8}]};
 assert.equal(sync(old,[]),false);assert.equal(old.electronics[0].unit_price,8);
});
