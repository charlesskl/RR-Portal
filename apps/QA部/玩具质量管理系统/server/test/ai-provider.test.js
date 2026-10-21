// Isolated protocol/storage regressions. Only loopback HTTP; AI fetch is replaced.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {providerName} from '../ai.js';
const serverRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const secret='synthetic-portal-ticket-key-only';
const features=['dashboard','complaints','cap','reports','series-analysis','quality-intelligence','import','issue-types','users','settings'];
const permissions=(changes={})=>({...Object.fromEntries(features.map(f=>[f,'none'])),...changes});
function ticket(claims={},key=secret){
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({app:'toyqms',sub:'fixture-portal',name:'Synthetic Portal User',exp:Date.now()+60_000,...claims})).toString('base64url');
 return header+'.'+payload+'.'+createHmac('sha256',key).update(header+'.'+payload).digest('base64url');
}
async function freePort(){const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}
async function fixture(baseUrl){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toyqms-provider-'));const mock=path.join(dir,'synthetic-ai.mjs');
 fs.writeFileSync(mock,`import fs from 'node:fs';globalThis.fetch=async(url,options)=>{const request=JSON.parse(options.body);fs.appendFileSync(process.env.TEST_AI_REQUESTS,JSON.stringify({url:String(url),method:options.method,model:request.model})+'\\n');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items:[{index:0,translation:'合成译文，等待人工审核'}]})}}]}),{status:200,headers:{'content-type':'application/json'}})};`);
 const port=await freePort();const env={...process.env,HOST:'127.0.0.1',PORT:String(port),TOYQMS_DATA_DIR:dir,TOYQMS_STATIC_DIR:path.join(dir,'no-static'),NODE_ENV:'test',SSO_SECRET:secret,MOONSHOT_API_KEY:'synthetic-api-key',MOONSHOT_MODEL:'synthetic-compatible-model',TEST_AI_REQUESTS:path.join(dir,'requests.jsonl')};
 if(baseUrl===undefined)delete env.MOONSHOT_BASE_URL;else env.MOONSHOT_BASE_URL=baseUrl;
 const child=spawn(process.execPath,['--import',pathToFileURL(mock).href,'index.js'],{cwd:serverRoot,env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);const origin=`http://127.0.0.1:${port}`;
 async function close(){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}fs.rmSync(dir,{recursive:true,force:true});}
 async function api(method,route,body,token){const r=await fetch(origin+'/api'+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});return{status:r.status,data:await r.json()};}
 try{for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('fixture server exited: '+output);try{if((await api('GET','/health')).status===200)return{dir,api,close};}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('fixture server did not start: '+output);}catch(error){await close();throw error;}
}
test('provider labels use exact URL host boundaries and the configured default',()=>{
 const old=process.env.MOONSHOT_BASE_URL;
 const cases=[
  [undefined,'moonshot'],['','moonshot'],['https://api.moonshot.cn/v1','moonshot'],['https://api.moonshot.ai/v1','moonshot'],['https://API.MOONSHOT.CN./v1/','moonshot'],
  ['https://dashscope.aliyuncs.com/compatible-mode/v1','aliyun-dashscope'],['https://dashscope-intl.aliyuncs.com/compatible-mode/v1','aliyun-dashscope'],['https://dashscope-us.aliyuncs.com/compatible-mode/v1','aliyun-dashscope'],['https://dashscope-ap-southeast-1.aliyuncs.com/compatible-mode/v1','aliyun-dashscope'],
  ['https://openrouter.ai/api/v1','openrouter'],['https://api.openrouter.ai/api/v1','openrouter'],
  ['https://dashscope.aliyuncs.com.evil.invalid/v1','openai-compatible'],['https://notdashscope.aliyuncs.com/v1','openai-compatible'],['https://openrouter.ai.evil.invalid/api/v1','openai-compatible'],['https://notopenrouter.ai/v1','openai-compatible'],['https://moonshot.cn.evil.invalid/v1','openai-compatible'],['https://example.invalid/dashscope/openrouter?v=moonshot.cn','openai-compatible'],['https://dashscope@custom.invalid/v1','openai-compatible'],['https://openrouter.ai@custom.invalid/v1','openai-compatible'],['https://custom.invalid/v1#dashscope','openai-compatible'],['not a URL dashscope','openai-compatible'],['ftp://openrouter.ai/v1','openai-compatible'],
 ];
 try{for(const[value,want]of cases){if(value===undefined)delete process.env.MOONSHOT_BASE_URL;else process.env.MOONSHOT_BASE_URL=value;assert.equal(providerName(),want,value);}}finally{if(old===undefined)delete process.env.MOONSHOT_BASE_URL;else process.env.MOONSHOT_BASE_URL=old;}
});
test('real SSO validates tickets and preserves portal view/full/none permissions',{timeout:15_000},async()=>{
 const f=await fixture();try{
  for(const value of['broken',ticket({},'wrong-key'),ticket({exp:Date.now()-1}),ticket({app:'another-app'}),ticket({sub:''})])assert.equal((await f.api('POST','/auth/sso',{ticket:value})).status,400);
  const login=await f.api('POST','/auth/sso',{ticket:ticket({perms:permissions({dashboard:'view',complaints:'view'})})});assert.equal(login.status,200);assert.deepEqual(login.data.user.permissions,['view_dashboard','view_complaints']);assert.equal(login.data.user.passwordHash,undefined);assert.equal(login.data.user.passwordSalt,undefined);
  const token=login.data.token;assert.equal((await f.api('GET','/complaints',undefined,token)).status,200);
  for(const[route,body]of[['/complaints/import',{records:[],summary:{}}],['/ai/translate',{ids:['fixture']}],['/users',{name:'Synthetic',loginName:'other'}],['/backup/restore',{}]])assert.equal((await f.api('POST',route,body,token)).status,403,route);
  const elevated=await f.api('POST','/auth/sso',{ticket:ticket({perms:permissions({dashboard:'view','issue-types':'full'})})});assert.equal(elevated.status,200);assert.deepEqual(elevated.data.user.permissions,['view_dashboard','manage_classification','manage_translation']);assert.equal(elevated.data.user.id,login.data.user.id);assert.equal((await f.api('POST','/ai/translate',{ids:[]},elevated.data.token)).status,400);assert.equal((await f.api('POST','/users',{},elevated.data.token)).status,403);assert.equal(fs.existsSync(path.join(f.dir,'requests.jsonl')),false);
 }finally{await f.close();}
});
test('real translation API and SQLite agree on the actual request provider and remain drafts',{timeout:25_000},async(t)=>{
 const cases=[[undefined,'https://api.moonshot.cn/v1','moonshot'],['https://dashscope-intl.aliyuncs.com/compatible-mode/v1/','https://dashscope-intl.aliyuncs.com/compatible-mode/v1','aliyun-dashscope'],['https://openrouter.ai/api/v1','https://openrouter.ai/api/v1','openrouter'],['https://custom.invalid/dashscope/openrouter','https://custom.invalid/dashscope/openrouter','openai-compatible']];
 for(const[base,actual,want]of cases)await t.test(want,async()=>{
  const f=await fixture(base);try{
   const admin=await f.api('POST','/auth/login',{loginName:'JC',password:'12345678'});assert.equal(admin.status,200);
   const record={id:'synthetic-complaint',duplicateKey:'synthetic-unique-key',primarySeries:'Synthetic',status:'Needs classification',updatedAt:new Date().toISOString(),complaintMessageOriginal:'Missing synthetic part',translationStatus:'pending',translationProvider:null,complaintMessageZhMachine:null,complaintMessageZhFinal:null,rawData:{}};
   const imported=await f.api('POST','/complaints/import',{records:[record],summary:{batchId:'synthetic-import'}},admin.data.token);assert.equal(imported.status,200);assert.equal(imported.data.imported,1);
   const translator=await f.api('POST','/auth/sso',{ticket:ticket({perms:permissions({complaints:'view','issue-types':'full'})})});assert.equal(translator.status,200);
   const translated=await f.api('POST','/ai/translate',{ids:[record.id]},translator.data.token);assert.equal(translated.status,200);assert.deepEqual(translated.data,{translated:1,failed:0,skipped:0});
   const all=await f.api('GET','/complaints',undefined,translator.data.token);assert.equal(all.status,200);assert.equal(all.data.length,1);const item=all.data[0];assert.equal(item.translationProvider,want);assert.equal(item.translationModel,'synthetic-compatible-model');assert.equal(item.translationStatus,'translated');assert.equal(item.complaintMessageZhMachine,'合成译文，等待人工审核');assert.equal(item.complaintMessageZhFinal,null);assert.equal(item.reviewedAt,null);
   const requests=fs.readFileSync(path.join(f.dir,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(requests,[{url:actual+'/chat/completions',method:'POST',model:'synthetic-compatible-model'}]);
   const db=new DatabaseSync(path.join(f.dir,'toyqms.db'),{readOnly:true});try{const stored=JSON.parse(db.prepare('SELECT data FROM complaints WHERE id=?').get(record.id).data);assert.equal(stored.translationProvider,item.translationProvider);assert.equal(stored.translationStatus,item.translationStatus);assert.equal(stored.complaintMessageZhFinal,null);assert.equal(db.prepare('SELECT count(*) AS n FROM complaints').get().n,1);}finally{db.close();}
  }finally{await f.close();}
 });
});
