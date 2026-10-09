import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../production/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('async function loadBusinessData(){'),html.indexOf('async function boot(){'));
function harness(pull){
 const elements={dataLoadGate:{style:{}},dataLoadMessage:{},dataLoadRetry:{}};
 const c=vm.createContext({_loadingData:false,_dataLoaded:false,document:{getElementById:id=>elements[id]},pullFromServer:pull,updateDashCustomInputs(){},reRenderCurrent(){c.renders++;},updateSyncUI:s=>c.status=s,setTimeout:fn=>fn(),console:{error(){}},renders:0});
 vm.runInContext(code,c);return {c,elements,run:()=>vm.runInContext('loadBusinessData()',c)};
}
test('slow refresh blocks editing and does not render empty business data',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const pending=h.run();
 assert.equal(h.elements.dataLoadGate.style.display,'flex');assert.equal(h.c._dataLoaded,false);assert.equal(h.c.renders,0);
 resolve();await pending;assert.equal(h.c._dataLoaded,true);assert.equal(h.c.renders,1);assert.equal(h.elements.dataLoadGate.style.display,'none');
});
test('failed refresh stays blocked, exposes retry and recovers without importing again',async()=>{
 let fail=true,calls=0;const h=harness(async()=>{calls++;if(fail)throw Error('连接中断');});
 await h.run();assert.equal(calls,3);assert.equal(h.c._dataLoaded,false);assert.equal(h.c.renders,0);assert.equal(h.elements.dataLoadRetry.hidden,false);assert.match(h.elements.dataLoadMessage.textContent,/连接中断/);
 fail=false;await h.run();assert.equal(h.c.status,'ok');assert.equal(h.c.renders,1);
});
test('temporary read error retries automatically',async()=>{
 let calls=0;const h=harness(async()=>{if(++calls<2)throw Error('temporary');});await h.run();assert.equal(calls,2);assert.equal(h.c._dataLoaded,true);
});
test('all inline scripts remain valid JavaScript',()=>{
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});
