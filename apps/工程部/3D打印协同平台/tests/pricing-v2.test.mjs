import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import commands from '../shared/authority-commands.cjs';
import core from '../shared/business-sync.cjs';
import report from '../shared/pricing-report.cjs';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
const update=path.join(root,'ops');
const rules=require(path.join(root,'legacy/pricing-patch-rules.cjs'));
const patch=require(path.join(root,'legacy/pricing-patch.cjs'));
const source=()=>({settings:{machines:21,laborPerDay:750,elecPerMachine:1.5,lossRate:1.2,profitRate:40,resinQuotePerGram:.5},materials:[{id:1,name:'PLA',priceKg:32}],products:[{id:1,name:'样品',process:'fdm',material:'PLA',weight:60,time:2.5,qty:1,price:14.6}],records:{'2026-11-13':{off:false,items:[{_id:'old',status:'running',machine:1,productName:'样品',material:'PLA',weight:60,time:2.5,qty:1}]}},inventory:{PLA:{stockG:1000}}});
const cmd=(d,value,key='1',collection='products')=>({id:'test-request',operation:'set',collection,key,value,expected:commands.hash(core.project(d)[collection][key]),reason:'核实人工人数'});
test('product headcount requests recalculate only requested product and preserve historical records/inventory',()=>{
 let d=source();
 for(const [count,price]of [[1,7.31],[2,10.95],[3,14.60]]){
  d=commands.apply(d,cmd(d,{fdmLaborCount:count})).data;
  assert.equal(d.products[0].price,price);
  assert.equal(d.records['2026-11-13'].items[0].fdmLaborCount,undefined);
  assert.equal(d.inventory.PLA.stockG,1000);
 }
 for(const count of [0,4,1.5,'2',null])assert.throws(()=>commands.validate(cmd(d,{fdmLaborCount:count})),/人工人数/);
 d=commands.apply(d,cmd(d,{fdmLaborCount:1,price:99})).data;assert.equal(d.products[0].price,99);
});
test('daily report matches quote calculations; resin history remains fixed and daily overhead unchanged',()=>{
 const d=source(),items=d.records['2026-11-13'].items;
 items[0].fdmLaborCount=1;
 assert.equal(report.day(d,'2026-11-13').revenue,report.product(d,{...d.products[0],fdmLaborCount:1}).price);
 assert.equal(report.day(d,'2026-11-13').laborCost,750);
 items.splice(0,1,{_id:'resin-old',machine:21,status:'running',weight:100,qty:2,resinQuotePerGram:.8},{_id:'resin-new',machine:21,status:'running',weight:100,qty:2,resinQuotePerGram:.5});
 assert.equal(report.day(d,'2026-11-13').revenue,260);
 d.settings.resinQuotePerGram=.3;assert.equal(report.day(d,'2026-11-13').revenue,260);
});
test('sync roundtrip retains count/rate; record edit preserves rate and new record captures current rate',()=>{
 let d=source();d.records['2026-11-13'].items.push({_id:'resin',machine:21,status:'running',weight:100,qty:1,resinQuotePerGram:.8});
 d=commands.apply(d,cmd(d,{fdmLaborCount:2},'old','records')).data;
 assert.equal(core.apply({},core.project(d)).records['2026-11-13'].items.find(x=>x._id==='old').fdmLaborCount,2);
 d=commands.apply(d,cmd(d,{remark:'edit'},'resin','records')).data;
 assert.equal(d.records['2026-11-13'].items.find(x=>x._id==='resin').resinQuotePerGram,.8);
 const create={id:'new-resin',operation:'create',collection:'records',key:'new',expected:commands.hash(undefined),reason:'测试新增',value:{date:'2026-11-13',machine:21,status:'running',weight:100,qty:1}};
 d=commands.apply(d,create).data;
 assert.equal(d.records['2026-11-13'].items.find(x=>x._id==='new-resin').resinQuotePerGram,.5);
});
test('incremental command patch preserves newer request hashes and binding validation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pricing-command-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const f of ['business-sync.cjs','json-stream.cjs','pricing-report.cjs','pricing-records.cjs'])fs.copyFileSync(path.join(root,'shared',f),path.join(dir,f));
 const before=fs.readFileSync(path.join(root,'shared/authority-commands.cjs'),'utf8'),after=rules.commands(before);
 assert.equal(rules.commands(after),after);
 fs.writeFileSync(path.join(dir,'commands.cjs'),after);const current=require(path.join(dir,'commands.cjs'));
 assert.equal(typeof current.requestHash,'function');
 assert.throws(()=>current.validate({...cmd(source(),{fdmLaborCount:1}),binding:{station:'a'}}),/归属/);
 assert.equal(current.apply(source(),cmd(source(),{fdmLaborCount:1})).data.products[0].price,7.31);
});
test('Windows updater supports queued save signature; preflight failure writes nothing; repeat installation is no-op',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pricing-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bridge=path.join(dir,'bridge'),local=path.join(dir,'local');fs.mkdirSync(path.join(bridge,'shared'),{recursive:true});fs.mkdirSync(path.join(bridge,'collector'));fs.mkdirSync(local);
 fs.writeFileSync(path.join(bridge,'collector/agent.mjs'),'// existing collector');
 for(const [dest,prefix]of [[bridge,'shared/'],[local,'']]){
  fs.copyFileSync(path.join(root,'shared/authority-commands.cjs'),path.join(dest,prefix+'authority-commands.cjs'));
  fs.copyFileSync(path.join(root,'shared/production-report.js'),path.join(dest,prefix+'production-report.js'));
 }
 const before="// business-sync-adapter.cjs\nfunction saveData(data, authorityWrite=false) {\n  // PRINTLINK_AUTHORITY_QUEUE_V1\n  return authorityWrite;\n}\n";
 fs.writeFileSync(path.join(local,'server.js'),before);fs.writeFileSync(path.join(local,'config.json'),'{"businessSync":true,"sync":{"enabled":false}}');fs.writeFileSync(path.join(local,'data.json'),'DO NOT MODIFY');
 fs.writeFileSync(path.join(local,'index.html'),'<head>unsupported</head>');
 const run=(...flags)=>spawnSync(process.execPath,[path.join(update,'update-fdm-pricing.cjs'),'windows',bridge,local,...flags],{encoding:'utf8'});
 assert.notEqual(run().status,0);assert.equal(fs.readFileSync(path.join(local,'server.js'),'utf8'),before);assert.equal(fs.readdirSync(local).some(x=>x.startsWith('.fdm')),false);
 fs.copyFileSync(path.join(root,'production/index.html'),path.join(local,'index.html'));
 assert.equal(run('--check').status,0);assert.equal(fs.readFileSync(path.join(local,'server.js'),'utf8'),before);
 let r=run();assert.equal(r.status,0,r.stderr);r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/0 个程序文件/);
 assert.match(fs.readFileSync(path.join(local,'server.js'),'utf8'),/authorityWrite=false/);assert.match(fs.readFileSync(path.join(local,'server.js'),'utf8'),/PRINTLINK_AUTHORITY_QUEUE_V1/);
 assert.equal(fs.readFileSync(path.join(local,'data.json'),'utf8'),'DO NOT MODIFY');
});
test('authority UI offers 3/2/1 and serializes numeric headcount without editing untouched fields',async()=>{
 const elements=new Map(),fieldInputs=[];
 function el(tag='div'){return {tag,dataset:{},value:'',append(child){(this.children??=[]).push(child);if(child.dataset?.field)fieldInputs.push(child);},replaceChildren(){this.children=[];if(this===elements.get('#fields'))fieldInputs.length=0;}};}
 const document={querySelector(q){if(!elements.has(q))elements.set(q,el());return elements.get(q);},createElement:el,querySelectorAll(q){assert.match(q,/select/);return fieldInputs;}};
 const ctx=vm.createContext({document,crypto:{randomUUID:()=> 'id'},console});
 const js=fs.readFileSync(path.join(root,'cloud/public/authority.js'),'utf8');vm.runInContext(js.slice(0,js.indexOf("$('#refresh').onclick")),ctx);
 elements.get('#collection')||(document.querySelector('#collection'));elements.get('#collection').value='products';document.querySelector('#entity').value='1';document.querySelector('#reason').value='测试';
 vm.runInContext("rows=[{key:'1',expected:'hash',value:{name:'sample',qty:1}}];render();",ctx);
 const count=fieldInputs.find(i=>i.dataset.field==='fdmLaborCount');assert.equal(count.value,3);assert.equal(count.children.length,3);count.value='1';
 vm.runInContext('api=async value=>{globalThis.sent=value;return {pending:true};};refresh=async()=>{};',ctx);
 await vm.runInContext('submit()',ctx);assert.equal(ctx.sent.command.value.fdmLaborCount,1);
 assert.deepEqual(Object.keys(ctx.sent.command.value),['fdmLaborCount']);
});

test('shared browser/node reports and persistence helpers remain identical',()=>{
 assert.equal(fs.readFileSync(path.join(root,'shared/production-report.js'),'utf8'),fs.readFileSync(path.join(root,'shared/pricing-report.cjs'),'utf8'));
 assert.equal(fs.readFileSync(path.join(root,'shared/pricing-records.cjs'),'utf8'),fs.readFileSync(path.join(root,'production/pricing-records.cjs'),'utf8'));
});
