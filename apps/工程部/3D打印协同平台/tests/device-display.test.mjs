import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {deviceDetails} from '../shared/device-details.mjs';
test('mapped machine cards use real cloud IDs and show original IDs without inventing 1..N devices',()=>{
 const html=readFileSync(new URL('../production/index.html',import.meta.url),'utf8');
 const code=html.slice(html.indexOf('function displayMachineIds'),html.indexOf('async function pollPrinterStatus'));
 const context=vm.createContext({liveStatus:{101:{sourceMachine:'1'},114:{sourceMachine:'14'}},escHtml:s=>String(s)});vm.runInContext(code,context);
 assert.deepEqual(Array.from(vm.runInContext('displayMachineIds(30,[])',context)),[101,114]);
 assert.deepEqual(Array.from(vm.runInContext('displayMachineIds(30,[{machine:115}])',context)),[101,114]);
 assert.equal(vm.runInContext('deviceLabel(114)',context),'现场 #14 · 平台 #114');
 const imported=[{machine:1,status:'running'},{machine:14,status:'running'},{machine:21,status:'running'}];
 context.imported=imported;
 assert.deepEqual(Array.from(vm.runInContext('displayMachineIds(21,imported)',context)),[101,114]);
 assert.deepEqual(Array.from(vm.runInContext('historyMachineIds(imported)',context)),[1,14,21],'table includes only machines recorded on the selected date');
 assert.deepEqual(Array.from(vm.runInContext('historyMachineIds([])',context)),[]);
 assert.deepEqual(Array.from(vm.runInContext('historyMachineIds([{machine:101},{machine:101},{machine:114,_deleted:true},{machine:0},{machine:"bad"}])',context)),[101],'keep a platform machine when it has real records, exclude deleted or invalid ones');
 context.liveStatus[114].connected=false;
 assert.deepEqual(Array.from(vm.runInContext('displayMachineIds()',context)),[101,114],'offline bridge devices remain visible');
 context.liveStatus={};assert.equal(vm.runInContext('displayMachineIds(30,imported).length',context),0,'do not invent cards before first telemetry');
 assert.equal(imported.length,3,'display filtering does not remove historical records');
});
test('display telemetry is bounded and excludes credentials and arbitrary fields',()=>{
 const data=deviceDetails({sourceMachine:'14',gcodeFile:'a'.repeat(1000),nozzleTemp:210,bedTemp:NaN,remainingTime:-1,accessCode:'secret',password:'secret',serial:'secret'});
 assert.equal(data.gcodeFile.length,256);assert.equal(data.nozzleTemp,210);assert.equal(data.sourceMachine,'14');assert.equal(data.accessCode,undefined);assert.equal(data.bedTemp,undefined);assert.equal(data.remainingTime,undefined);
});
