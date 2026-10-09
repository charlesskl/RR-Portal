import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const js=readFileSync(new URL('../cloud/public/platform.js',import.meta.url),'utf8');
test('machine picker uses reported authorized IDs, preserves mapping, and excludes occupied machines',()=>{
 const nodes={'[name=stationId]':{value:'qingxi'},'[name=orderId]':{value:'order'},'[name=machineNumber]':{value:'111'},'#machine-hint':{}};
 let entries=[];
 const c=vm.createContext({$:s=>nodes[s],deviceCatalog:{stations:[{id:'qingxi',factories:['清溪'],devices:[{machine:'111',sourceMachine:'11',observed:'2026-10-09',online:true,state:'RUNNING',jobName:'眼睛扣'},{machine:'108',sourceMachine:'8',observed:'2026-10-09',online:false},{machine:'130'}]}]},overview:{orders:[{id:'order',factory:'清溪'}],jobs:[]},options:(selector,items)=>{entries=items;if(!items.some(x=>x.value===nodes[selector].value))nodes[selector].value='';}});
 vm.runInContext(js.slice(js.indexOf('function renderMachineOptions(){'),js.indexOf("$('[name=stationId]').addEventListener")),c);
 c.renderMachineOptions();assert.deepEqual(Array.from(entries,e=>e.value),['','108','111']);assert.match(entries[2].label,/现场 #11 · 平台 #111/);assert.match(entries[2].label,/眼睛扣/);assert.match(entries[1].label,/离线/);assert.equal(nodes['[name=machineNumber]'].value,'111');
 c.overview.jobs=[{station:'qingxi',machine:'111',status:'打印中'}];c.renderMachineOptions();assert.equal(entries[2].disabled,true);assert.equal(nodes['[name=machineNumber]'].value,'');
 c.overview.orders[0].factory='印尼';c.renderMachineOptions();assert.equal(entries.length,1);assert.equal(nodes['[name=machineNumber]'].disabled,true);
 c.overview.orders[0].factory='清溪';c.deviceCatalog.stations[0].devices=[];c.renderMachineOptions();assert.equal(entries.length,1);assert.match(nodes['#machine-hint'].textContent,/尚未收到/);
});
