const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const mix=require('../backend/services/productMix');
const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
const ctx=vm.createContext({sum:(rows,fn)=>rows.reduce((s,r,i)=>s+fn(r,i),0), rowProductGroups:mix.productGroups, productMixRatio:mix.productRatio});
vm.runInContext(source.slice(source.indexOf('function directProductGroup('),source.indexOf('function weightedPaintingSum(')),ctx);
for(const modes of [{c:'direct'},{a:'direct',b:'direct',c:'direct'}]) {
 test('frontend, backend and exported formula agree: '+JSON.stringify(modes),()=>{
  const p={product_mix_modes:modes,product_mix_ratios:{a:1,b:2,c:99},injection:[{product_group_id:'a',value:10},{product_group_id:'b',value:16},{product_group_id:'c',value:3}]};
  const expected=modes.a?29:17;
  assert.equal(mix.weightedInjectionSum(p,r=>r.value),expected);
  assert.equal(ctx.weightedInjectionSum(p,r=>r.value),expected);
  const formula=mix.weightedColumnFormula(p,2,'N').replace(/N2/g,'10').replace(/N3/g,'16').replace(/N4/g,'3');
  assert.equal(vm.runInNewContext(formula),expected);
  // Painting uses the same backend row aggregation.
  assert.equal(mix.weightedRowsSum(p,p.injection,r=>r.value),expected);
  p.product_mix_ratios={a:0,b:0,c:0};
  assert.equal(mix.weightedInjectionSum(p,r=>r.value),modes.a?29:3);
 });
}
