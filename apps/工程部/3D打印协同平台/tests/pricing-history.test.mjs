import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import patch from '../legacy/pricing-patch.cjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('product headcount HTTP edit preserves historical prices, quantities, timestamps and schedules',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'pr1115-history-'));
 const product={id:1,name:'样品',material:'PLA',weight:60,time:2.5,qty:1,price:14.6};
 const source={settings:{machines:21,laborPerDay:750},materials:[{id:1,name:'PLA',priceKg:32}],products:[product],records:{'2026-11-13':{items:[{_id:'history',_updatedAt:1,productName:'样品',material:'PLA',weight:45,time:2,price:12,qty:2,machine:1,inventorySync:true}]}},schedules:[{id:1,productName:'样品',weight:45,material:'PLA',_updatedAt:1}],inventory:{PLA:{stockG:1000}}};
 writeFileSync(path.join(dir,'production-source.json'),JSON.stringify(source));
 const port=40000+Math.floor(Math.random()*2000),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['start.mjs','--cloud-only'],{cwd:root,env:{...process.env,APP_MODE:'production',HOST:'127.0.0.1',PLATFORM_DATA_DIR:dir,PORT:String(port),PRODUCTION_PORT:String(port+2300),ADMIN_PASSWORD:'PR1115-Synthetic-Only!',COOKIE_SECURE:'false'},stdio:'ignore'});
 try{
  for(let n=0;n<60;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100))}
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'PR1115-Synthetic-Only!'})});assert.equal(login.status,200);const {csrf}=await login.json();const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const before=await(await fetch(base+'/api/production/data',{headers})).json();
  const r=await fetch(base+'/api/production/products/update',{method:'POST',headers,body:JSON.stringify({productId:1,product:{...product,fdmLaborCount:1,price:7.31}})});assert.equal(r.status,200,await r.text());
  const after=await(await fetch(base+'/api/production/data',{headers})).json();assert.equal(after.products[0].fdmLaborCount,1);assert.equal(after.products[0].price,7.31);assert.deepEqual(after.records,before.records);assert.deepEqual(after.schedules,before.schedules);assert.deepEqual(after.inventory,before.inventory);
  const repeated=await fetch(base+'/api/production/products/update',{method:'POST',headers,body:JSON.stringify({productId:1,product:after.products[0]})});assert.equal(repeated.status,200);const again=await(await fetch(base+'/api/production/data',{headers})).json();assert.deepEqual(again.records,before.records);assert.deepEqual(again.schedules,before.schedules);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));rmSync(dir,{recursive:true,force:true})}
});
test('incremental patch adds history guards to unpatched cloud and Windows-compatible source and is repeatable',()=>{
 const server=readFileSync(path.join(root,'production/server.js'),'utf8');
 const before=server.replace("        const preserveHistory = require('./pricing-records.cjs').headcountOnlyEdit(product, {...patch,name});\n",'').replace('        // 人数及其报价调整只更新产品，不改写已有生产记录或排期。\n        if (!preserveHistory) {\n','').replace('          schedule._updatedAt = Date.now();\n        }\n        }','          schedule._updatedAt = Date.now();\n        }');
 assert.notEqual(before,server);assert.equal(patch.server(before),server);new vm.Script(patch.server(before));assert.equal(patch.server(server),server);
 const queued=before.replace('function saveData(data) {','function saveData(data, authorityWrite=false) {');const upgraded=patch.server(queued);assert.match(upgraded,/saveData\(data, authorityWrite=false\)/);assert.match(upgraded,/if \(!preserveHistory\)/);new vm.Script(upgraded);
 assert.throws(()=>patch.server(before.replace('const oldName = product.name;','const priorName = product.name;')),/版本不匹配/);
});
