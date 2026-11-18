'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {DatabaseSync}=require('node:sqlite');
const Auth=require('./auth');
const A='dg-xingxin',B='dg-huadeng-a';
const password='qa-fixture-password';
let directory,dataPath,child,base,admin,reader,hidden;
const model=(extra={})=>({customer:'ZURU',productName:'塑胶身体',productNo:'77907',department:'品质部',requester:'测试员',ageGrade:'',source:'来料',receivedDate:'2026-11-18',sampleQty:'3 PCS',description:'检查装配可靠性',reportNo:'QA-test-101',stage:'PP',purpose:'来料测试',language:'zh',standards:['1'],tests:['L0','R10'],...extra});
function database(company,callback){const db=new DatabaseSync(path.join(dataPath,company,'qc.db'));try{return callback(db)}finally{db.close()}}
async function start(){
 child=spawn(process.execPath,[path.join(directory,'server','server.js')],{env:{...process.env,PORT:'0',DATA_PATH:dataPath,DASHSCOPE_API_KEY:'',QC_BAILIAN_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let output='';
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error(output)),10000);
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)\/index.html/);if(match){base='http://127.0.0.1:'+match[1];clearTimeout(timer);resolve()}});
  child.stderr.on('data',chunk=>{output+=chunk});child.once('exit',()=>{clearTimeout(timer);reject(Error(output))});
 });
 const ready=await fetch(base+'/api/health');assert.equal(ready.status,200);
}
async function stop(){if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit}}
async function request(route,{method='GET',body,session,company=A,csrf=true}={}){
 const response=await fetch(base+route+(route.includes('?')?'&':'?')+'company='+company,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,...(csrf?{'X-QC-CSRF':session.csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,json:await response.json(),response};
}
async function login(username='testadmin',company=A){const result=await request('/api/login',{method:'POST',company,body:{username,password}});assert.equal(result.status,200);return {cookie:result.response.headers.get('set-cookie').split(';')[0],csrf:result.json.csrfToken}}
const endpoint=id=>'/api/qa-application?recordId='+id;
const recordSnapshot=()=>database(A,db=>JSON.stringify(db.prepare('SELECT * FROM records ORDER BY id').all()));
test.before(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'qms-qa-store-'));dataPath=path.join(directory,'data');fs.mkdirSync(path.join(directory,'server'));
 for(const name of ['server.js','auth.js'])fs.copyFileSync(path.join(__dirname,name),path.join(directory,'server',name));
 fs.writeFileSync(path.join(directory,'server','seed.json'),JSON.stringify({records:[],users:[],defectLib:[]}));
 fs.writeFileSync(path.join(directory,'server','ai-config.json'),JSON.stringify({enabled:false,apiKey:''}));
 await start();await stop();
 for(const company of [A,B])database(company,db=>{
  const insert=db.prepare('INSERT INTO users(username,password,role,enabled,perms) VALUES(?,?,?,?,?)');
  insert.run('testadmin',Auth.hashPassword(password),'admin',1,null);
  insert.run('reader',Auth.hashPassword(password),'viewer',1,JSON.stringify({records:{v:1,e:0}}));
  insert.run('hidden',Auth.hashPassword(password),'viewer',1,JSON.stringify({records:{v:0,e:0}}));
  db.prepare('INSERT INTO records(id,date,supplier,productNo,status,updatedAt) VALUES(?,?,?,?,?,?)').run(101,'2026-11-18',company,'77907','approved','2026-11-18T00:00:00Z');
 });
 await start();admin=await login();reader=await login('reader');hidden=await login('hidden');
});
test.after(async()=>{await stop();if(directory)fs.rmSync(directory,{recursive:true,force:true})});
test('QA application persists independently of inspection content and survives process restart',async()=>{
 const before=recordSnapshot();
 assert.equal((await request(endpoint(101),{session:admin})).json.application,null);
 const saved=await request(endpoint(101),{method:'POST',session:admin,body:{baseVersion:0,data:model()}});
 assert.equal(saved.status,200);assert.equal(saved.json.application.version,1);assert.equal(saved.json.application.updatedBy,'testadmin');
 const read=await request(endpoint(101),{session:reader});assert.equal(read.status,200);assert.deepEqual(read.json.application.data,model());
 assert.equal(recordSnapshot(),before);
 await stop();await start();
 const reopened=await request(endpoint(101),{session:admin});assert.equal(reopened.status,200);assert.equal(reopened.json.application.data.sampleQty,'3 PCS');assert.equal(reopened.json.application.data.description,'检查装配可靠性');
 assert.equal(recordSnapshot(),before);
});
test('company boundaries, record existence, view/edit permission and CSRF are enforced',async()=>{
 assert.equal((await request(endpoint(101))).status,401);
 assert.equal((await request(endpoint(101),{session:hidden})).status,403);
 assert.equal((await request(endpoint(101),{session:reader,method:'POST',body:{baseVersion:1,data:model()}})).status,403);
 assert.equal((await request(endpoint(101),{session:admin,method:'POST',csrf:false,body:{baseVersion:1,data:model()}})).status,403);
 assert.equal((await request(endpoint(999),{session:admin})).status,404);
 assert.equal((await request(endpoint(999),{session:admin,method:'POST',body:{baseVersion:0,data:model()}})).status,404);
 assert.equal((await request(endpoint(101),{session:admin,company:B})).status,401);
 const other=await login('testadmin',B);assert.equal((await request(endpoint(101),{session:other,company:B})).json.application,null);
 for(const id of ['0','-1','1.1','9007199254740992','101x'])assert.equal((await request(endpoint(id),{session:admin})).status,400);
});
test('optimistic versions reject stale edits and acknowledge identical retries without another write',async()=>{
 const current=(await request(endpoint(101),{session:admin})).json.application;
 const edit=model({sampleQty:'5 PCS',description:'更新后的样板描述'});
 const saved=await request(endpoint(101),{session:admin,method:'POST',body:{baseVersion:current.version,data:edit}});
 assert.equal(saved.status,200);assert.equal(saved.json.application.version,current.version+1);
 const stale=await request(endpoint(101),{session:admin,method:'POST',body:{baseVersion:current.version,data:model({sampleQty:'8 PCS'})}});
 assert.equal(stale.status,409);
 const retry=await request(endpoint(101),{session:admin,method:'POST',body:{baseVersion:current.version,data:edit}});
 assert.equal(retry.status,200);assert.equal(retry.json.application.version,saved.json.application.version);
 assert.equal((await request(endpoint(101),{session:admin,method:'POST',body:{baseVersion:999,data:edit}})).status,409);
 assert.deepEqual((await request(endpoint(101),{session:admin})).json.application.data,edit);
});
test('malformed or oversized forms do not change the saved application',async()=>{
 const before=(await request(endpoint(101),{session:admin})).json.application;
 for(const data of [model({description:'x'.repeat(2001)}),model({tests:['R8']}),model({language:'xx'}),model({unexpected:1}),model({sampleQty:3})]){
  assert.equal((await request(endpoint(101),{session:admin,method:'POST',body:{baseVersion:before.version,data}})).status,400);
 }
 assert.equal((await request(endpoint(101),{session:admin,method:'POST',body:{data:model()}})).status,400);
 assert.deepEqual((await request(endpoint(101),{session:admin})).json.application,before);
});
