import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {readLegacy} from '../collector/bridge.mjs';import {validateConfig} from '../collector/config.mjs';
test('legacy bridge reads authenticated status only, maps IDs, rejects stale readings and clears state on failure',async()=>{
 let fail=false;const requests=[];
 const server=http.createServer((req,res)=>{requests.push([req.method,req.url,req.headers.authorization]);if(fail){res.writeHead(401);return res.end();}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({'1':{connected:true,gcodeState:'RUNNING',printProgress:45,lastUpdate:Date.now(),accessCode:'never-forward'},'2':{connected:true,gcodeState:'FINISH',lastUpdate:Date.now()-60000},'21':{connected:true,gcodeState:'IDLE',lastSeen:Date.now()}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const legacy={url:`http://127.0.0.1:${server.address().port}`,username:'test',password:'private',machineMap:{'1':'101','2':'102','21':'121'}};
 try {
  const result=await readLegacy(legacy);assert.equal(result.statuses['101'].gcodeState,'RUNNING');assert.equal(result.statuses['101'].printProgress,45);assert.equal(result.statuses['102'].connected,false);assert.equal(result.statuses['121'].connected,true);assert.ok(!JSON.stringify(result).includes('never-forward'));
  fail=true;const offline=await readLegacy(legacy);assert.equal(offline.statuses['101'].connected,false);assert.ok(offline.error);assert.ok(requests.every(([method,url,auth])=>method==='GET'&&url==='/api/printers'&&auth==='Basic '+Buffer.from('test:private').toString('base64')));
  const config={mode:'bridge',cloudUrl:'https://platform.test',token:'a'.repeat(64),bindingsFile:'/tmp/bindings.json',legacy};assert.deepEqual(validateConfig(config),[]);assert.ok(validateConfig({...config,legacy:{...legacy,url:'http://remote.test'}}).length);assert.ok(validateConfig({...config,legacy:{...legacy,machineMap:{1:'1',2:'1'}}}).length);
 }finally{await new Promise(r=>server.close(r));}
});
