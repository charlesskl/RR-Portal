import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import core from '../shared/business-sync.cjs';
import commands from '../shared/authority-commands.cjs';
const original=String.raw`const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const DATA_FILE=path.join(__dirname,'data.json'),_syncEnabled=false,_role='master',_config=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json')));let dataVersion=Number(process.env.FIXTURE_VERSION||Date.now()),current=JSON.parse(fs.readFileSync(DATA_FILE));
function loadData(){return structuredClone(current);}
function saveData(data) {fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));current=structuredClone(data);dataVersion++;}
function requireAuth(req,res){if(req.headers.authorization==='Basic '+Buffer.from('fixture:fixture').toString('base64'))return true;res.writeHead(401);res.end('{}');return false;}
const server=http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.end('{}');return;
  } else if (!requireAuth(req, res)) return;
 if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...loadData(),_version:dataVersion}));return;}
 const chunks=[];for await(const c of req)chunks.push(c);const data=JSON.parse(Buffer.concat(chunks));
 if(data._version !== undefined && data._version !== dataVersion){res.writeHead(409);res.end('{}');return;}
 delete data._version;saveData(data);res.end('{}');
});server.listen(Number(process.env.FIXTURE_PORT),'127.0.0.1');`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('installed Windows-compatible source retains debit+receipt through process restart and protects stale browser saves',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'authority-installed-http-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const data={products:[{id:1,name:'产品'}],inventory:{PETG:{stockG:1000}},records:{}};
 writeFileSync(path.join(dir,'server.js'),original);writeFileSync(path.join(dir,'config.json'),JSON.stringify({businessSync:true,sync:{enabled:false},role:'master',existingCredential:'fixture-preserved'}));writeFileSync(path.join(dir,'data.json'),JSON.stringify(data));
 writeFileSync(path.join(dir,'index.html'),'<head></head><script>function today(){return "old";}function getDaySummary(date){return {};}</script>');
 const install=spawnSync(process.execPath,[fileURLToPath(new URL('../legacy/install-business-sync.mjs',import.meta.url)),dir],{encoding:'utf8'});assert.equal(install.status,0,install.stderr);
 assert.equal(JSON.parse(readFileSync(path.join(dir,'config.json'))).existingCredential,'fixture-preserved');assert.deepEqual(JSON.parse(readFileSync(path.join(dir,'data.json'))),data);
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));let child;
 const start=async(initialVersion)=>{child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,FIXTURE_PORT:String(port),...(initialVersion?{FIXTURE_VERSION:String(initialVersion)}:{})},stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',x=>logs+=x);for(let n=0;n<60;n++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok)return;}catch{}await delay(50);}throw Error(logs||'fixture startup timeout');};
 const stop=async()=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));};t.after(stop);
 const request=async(route,data)=>{const r=await fetch(`http://127.0.0.1:${port}`+route,{method:data?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from('fixture:fixture').toString('base64'),'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 await start();const stale=(await request('/api/data')).data,clientId=randomUUID(),binding={station:'test',clientId,actor:'admin'};
 assert.equal((await request('/api/business-sync',{action:'authority-enable',expected:core.fingerprint(core.project(data)),station:'test',clientId})).status,200);
 const c={id:randomUUID(),collection:'inventory',key:'PETG',operation:'stock',expected:commands.hash(core.project(data).inventory.PETG),delta:-61,reason:'真实领料',binding};
 assert.equal((await request('/api/business-sync',{action:'command',command:c})).data.status,'applied');
 const durableVersion=JSON.parse(readFileSync(path.join(dir,'data.json')))._printlinkAuthority.version;assert.ok(durableVersion>stale._version);await stop();await start(1);
 assert.equal((await request('/api/business-sync',{action:'command',command:c})).data.status,'applied');
 const confirmed=(await request('/api/data')).data;assert.ok(confirmed._version>=durableVersion);assert.equal(confirmed.inventory.PETG.stockG,939);assert.equal(confirmed.stockInLogs.length,1);assert.ok(confirmed._printlinkAuthority.receipts[c.id]);
 assert.equal((await request('/api/data',stale)).status,409);
 const missing={...confirmed};delete missing._version;assert.equal((await request('/api/data',missing)).status,409);
 const fresh=(await request('/api/data')).data;fresh.products[0].name='现场核对后的产品名';fresh._printlinkAuthority={enabled:false,receipts:{forged:{status:'applied'}}};assert.equal((await request('/api/data',fresh)).status,200);
 const disk=JSON.parse(readFileSync(path.join(dir,'data.json')));assert.equal(disk._printlinkAuthority.enabled,true);assert.ok(disk._printlinkAuthority.receipts[c.id]);assert.equal(disk._printlinkAuthority.receipts.forged,undefined);assert.equal(disk.inventory.PETG.stockG,939);assert.equal(disk.products[0].name,'现场核对后的产品名');assert.equal(disk._printlinkAuthority.station,'test');assert.equal(disk._printlinkAuthority.clientId,clientId);
});
