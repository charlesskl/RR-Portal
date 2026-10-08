const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {assemblyGroupsTotal}=require('../backend/services/assemblyMix');
const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function assemblyGroupFactor('),source.indexOf('function renderAssembly(')),ctx);
test('assembly defaults to direct sum; usage and ratios match frontend and backend',()=>{
 const groups=[{steps:[{count:2}],qty:10},{steps:[{count:5}],qty:10}];
 for(const calculate of [assemblyGroupsTotal,ctx.assemblyGroupsTotal]) {
  assert.equal(calculate(groups,10),7);
  const mixed=[{...groups[0],cost_mode:'average',usage:1,mix_ratio:99},{...groups[1],cost_mode:'average',usage:2,mix_ratio:99},{steps:[{count:.5}],qty:10,usage:1}];
  assert.equal(calculate(mixed,10),4.5);
  mixed[2].usage=2;assert.equal(calculate(mixed,10),4.5);
  mixed[0].usage=0;mixed[1].usage=0;assert.equal(calculate(mixed,10),.5);
 }
});

test('usage 2:1 determines weights, independent of obsolete ratio fields',()=>{
 const groups=[{steps:[{count:2}],qty:10,usage:2,cost_mode:'average',mix_ratio:1},{steps:[{count:5}],qty:10,usage:1,cost_mode:'average',mix_ratio:1}];
 assert.equal(assemblyGroupsTotal(groups,10),3);
 assert.equal(ctx.assemblyGroupsTotal(groups,10),3);
 groups[1].cost_mode='direct';
 assert.equal(assemblyGroupsTotal(groups,10),7);
 groups[0].usage=0;
 assert.equal(assemblyGroupsTotal(groups,10),5);
});

test('direct addition ignores saved usage, including zero, for old and new groups',()=>{
 for (const usage of [0,2,99]) {
  const groups=[{steps:[{count:2}],qty:10,usage},{steps:[{count:5}],qty:10,usage,cost_mode:'direct'}];
  assert.equal(assemblyGroupsTotal(groups,10),7);
  assert.equal(ctx.assemblyGroupsTotal(groups,10),7);
 }
});
