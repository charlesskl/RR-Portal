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
  for (const id of [101,102,103]) db.prepare('INSERT INTO records(id,date,supplier,productNo,status,updatedAt) VALUES(?,?,?,?,?,?)').run(id,'2026-11-18',company,'77907','approved','2026-11-18T00:00:00Z');
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

const groupEndpoint = ids => '/api/qa-application?recordIds=' + ids;
test('a combined application has a canonical independent version and persists after restart',async()=>{
 const before=recordSnapshot(), single=(await request(endpoint(101),{session:admin})).json.application;
 const group=model({productName:'',description:'1. 身体\n2. 透明配件',reportNo:'QA-combined-1'});
 assert.equal((await request(groupEndpoint('102,101'),{session:admin})).json.application,null);
 const saved=await request(groupEndpoint('102,101'),{method:'POST',session:admin,body:{baseVersion:0,data:group}});
 assert.equal(saved.status,200);assert.equal(saved.json.application.recordId,'group:101,102');assert.equal(saved.json.application.version,1);
 assert.deepEqual((await request(groupEndpoint('101,102'),{session:reader})).json.application.data,group);
 assert.deepEqual((await request(endpoint(101),{session:admin})).json.application,single);
 assert.equal((await request(groupEndpoint('101,103'),{session:admin})).json.application,null);
 const conflict=await request(groupEndpoint('101,102'),{method:'POST',session:admin,body:{baseVersion:0,data:model()}});
 assert.equal(conflict.status,409);
 const retry=await request(groupEndpoint('101,102'),{method:'POST',session:admin,body:{baseVersion:0,data:group}});
 assert.equal(retry.json.application.version,1);
 const longer={...group,description:Array.from({length:50},(_,i)=>(i+1)+'. '+ '长款式名称'.repeat(12)).join('\n')};
 const edit=await request(groupEndpoint('101,102'),{method:'POST',session:admin,body:{baseVersion:1,data:longer}});
 assert.equal(edit.status,200);assert.equal(edit.json.application.version,2);
 await stop();await start();
 assert.deepEqual((await request(groupEndpoint('102,101'),{session:admin})).json.application.data,longer);
 assert.equal(recordSnapshot(),before);
});
test('combined QA enforces permissions, company boundaries, valid selection and text limits atomically',async()=>{
 const route=groupEndpoint('101,102');
 const before=(await request(route,{session:admin})).json.application;
 assert.equal((await request(route)).status,401);
 assert.equal((await request(route,{session:hidden})).status,403);
 assert.equal((await request(route,{session:reader,method:'POST',body:{baseVersion:2,data:model()}})).status,403);
 assert.equal((await request(route,{session:admin,method:'POST',csrf:false,body:{baseVersion:2,data:model()}})).status,403);
 const other=await login('testadmin',B);
 assert.equal((await request(route,{session:other,company:B})).json.application,null);
 for(const ids of ['101','101,101','101,0','101,-1','101,1.2','101,102x','101,9007199254740992',Array.from({length:101},(_,i)=>i+1).join(',')]) {
  assert.equal((await request(groupEndpoint(ids),{session:admin})).status,400,ids);
 }
 assert.equal((await request(route+'&recordId=101',{session:admin})).status,400);
 assert.equal((await request(route+'&recordIds=101,103',{session:admin})).status,400);
 assert.equal((await request(groupEndpoint('101,999'),{session:admin})).status,404);
 assert.equal((await request(groupEndpoint('101,999'),{session:admin,method:'POST',body:{baseVersion:0,data:model()}})).status,404);
 assert.equal((await request(route,{session:admin,method:'POST',body:{baseVersion:2,data:model({description:'x'.repeat(24001)})}})).status,400);
 assert.deepEqual((await request(route,{session:admin})).json.application,before);
});

test('source fields persist, preserve old-client response shape and survive older saves without metadata loss',async()=>{
 const route=endpoint(103),full=route+'&sourceFields=1';
 const fields=model({supplier:'华登B',deliveryNo:'000107-A'});
 const created=await request(full,{session:admin,method:'POST',body:{baseVersion:0,data:fields}});
 assert.equal(created.status,200);assert.equal(created.json.application.data.supplier,'华登B');assert.equal(created.json.application.data.deliveryNo,'000107-A');
 const legacy=(await request(route,{session:reader})).json.application;
 assert.equal(Object.hasOwn(legacy.data,'supplier'),false);assert.equal(Object.hasOwn(legacy.data,'deliveryNo'),false);
 const olderEdit=model({sampleQty:'8 PCS'});
 const updated=await request(route,{session:admin,method:'POST',body:{baseVersion:1,data:olderEdit}});
 assert.equal(updated.status,200);assert.deepEqual(updated.json.application.data,olderEdit);
 const stored=(await request(full,{session:reader})).json.application;
 assert.equal(stored.data.supplier,'华登B');assert.equal(stored.data.deliveryNo,'000107-A');assert.equal(stored.data.sampleQty,'8 PCS');
 const retry=await request(route,{session:admin,method:'POST',body:{baseVersion:1,data:olderEdit}});
 assert.equal(retry.status,200);assert.equal(retry.json.application.version,stored.version);
 await stop();await start();assert.equal((await request(full,{session:admin})).json.application.data.deliveryNo,'000107-A');
 const cleared=await request(full,{session:admin,method:'POST',body:{baseVersion:stored.version,data:{...stored.data,supplier:'',deliveryNo:''}}});
 assert.equal(cleared.status,200);assert.equal(cleared.json.application.data.supplier,'');assert.equal(cleared.json.application.data.deliveryNo,'');
});
test('source fields use existing permission and conflict checks and reject invalid values atomically',async()=>{
 const route=endpoint(103)+'&sourceFields=1',before=(await request(route,{session:admin})).json.application;
 assert.equal((await request(route,{session:reader,method:'POST',body:{baseVersion:before.version,data:model({supplier:'A',deliveryNo:'1'})}})).status,403);
 for(const extra of [{supplier:'A'.repeat(2001)},{deliveryNo:'1'.repeat(4001)},{supplier:null},{deliveryNo:123},{deliveryNo:'A\0B'}]) {
  assert.equal((await request(route,{session:admin,method:'POST',body:{baseVersion:before.version,data:model(extra)}})).status,400);
 }
 assert.equal((await request(route,{session:admin,method:'POST',body:{baseVersion:0,data:model({supplier:'另一家',deliveryNo:'2'})}})).status,409);
 assert.deepEqual((await request(route,{session:admin})).json.application,before);
});

test('custom QA dropdown options persist across clients and restart without changing inspections',async()=>{
 const route='/api/qa-options',before=recordSnapshot();
 const defaults={ageGrade:['3+','6+','6M+','18M+'],sampleQty:['6PCS','12PCS','24PCS']};
 assert.deepEqual((await request(route,{session:reader})).json.options,defaults);
 const add=async(field,value,session=admin)=>request(route,{session,method:'POST',body:{field,value}});
 assert.equal((await add('ageGrade',' 12+ ')).status,200);
 assert.equal((await add('sampleQty','36PCS')).status,200);
 assert.equal((await add('ageGrade','12+')).json.options.ageGrade.filter(v=>v==='12+').length,1);
 assert.equal((await add('ageGrade','6M+')).json.options.ageGrade.filter(v=>v==='6M+').length,1);
 const concurrent=await Promise.all(Array.from({length:4},()=>add('sampleQty','48PCS')));
 assert.ok(concurrent.every(r=>r.status===200));
 assert.deepEqual((await request(route,{session:reader})).json.options,{ageGrade:[...defaults.ageGrade,'12+'],sampleQty:[...defaults.sampleQty,'36PCS','48PCS']});
 const other=await login('testadmin',B);
 assert.deepEqual((await request(route,{session:other,company:B})).json.options,defaults);
 await stop();await start();
 assert.deepEqual((await request(route,{session:reader})).json.options.ageGrade,[...defaults.ageGrade,'12+']);
 assert.equal(recordSnapshot(),before);
});
test('custom QA options enforce view/edit permission, CSRF and text limits atomically',async()=>{
 const route='/api/qa-options',before=(await request(route,{session:admin})).json.options;
 assert.equal((await request(route)).status,401);
 assert.equal((await request(route,{session:hidden})).status,403);
 assert.equal((await request(route,{session:reader,method:'POST',body:{field:'ageGrade',value:'8+'}})).status,403);
 assert.equal((await request(route,{session:admin,method:'POST',csrf:false,body:{field:'ageGrade',value:'8+'}})).status,403);
 assert.equal((await request(route,{session:admin,method:'POST',body:null})).status,415);
 for(const body of [[],{field:['ageGrade'],value:'8+'},{field:'unknown',value:'x'},{field:'__proto__',value:'x'},{field:'ageGrade',value:''},{field:'ageGrade',value:'   '},
  {field:'ageGrade',value:'x'.repeat(41)},{field:'sampleQty',value:'x'.repeat(61)},{field:'ageGrade',value:'3+\n4+'},{field:'ageGrade',value:'\0'},
  {field:'ageGrade',value:12},{field:'ageGrade',value:'8+',extra:true}]) {
  assert.equal((await request(route,{session:admin,method:'POST',body})).status,400);
 }
 assert.deepEqual((await request(route,{session:admin})).json.options,before);
 database(A,db=>{
  for(let i=0;db.prepare("SELECT COUNT(*) count FROM qa_field_options WHERE field='ageGrade'").get().count<100;i++) {
   db.prepare('INSERT INTO qa_field_options(field,value,createdAt,createdBy) VALUES(?,?,?,?)').run('ageGrade','capacity-'+i,'2026-11-25','testadmin');
  }
 });
 const full=(await request(route,{session:admin})).json.options;
 assert.equal((await request(route,{session:admin,method:'POST',body:{field:'ageGrade',value:'over-capacity'}})).status,400);
 assert.equal((await request(route,{session:admin,method:'POST',body:{field:'ageGrade',value:'12+'}})).status,200);
 assert.deepEqual((await request(route,{session:admin})).json.options,full);
});
