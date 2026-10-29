const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
async function load(file){
 const source=fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(out).toString('base64'));
}




test('read-only generic writes reject before fetch or XHR',async()=>{
 const {api,setApiSession}=await load('lib/api.ts');let requests=0;global.fetch=async()=>{requests++;throw Error('unexpected')};
 setApiSession({id:'r',name:'Reader',canRead:true,canEdit:false,canReview:false});
 await assert.rejects(api.mkdir('x'),/只读/);await assert.rejects(api.upload('x',new File(['x'],'x.xlsx')),/只读/);assert.equal(requests,0);
});
test('login uses proxy JSON+same-origin cookie+CSRF marker, no browser Bearer',async()=>{
 const {api}=await load('lib/api.ts');let observed;
 global.fetch=async(url,options)=>{observed={url,options};return {ok:true,json:async()=>({id:'a',name:'Verified',canRead:true,canEdit:true,canReview:false})}};
 await api.epmsLogin('synthetic-user','synthetic-password');
 assert.equal(observed.url,'api/epms/login');assert.deepEqual(JSON.parse(observed.options.body),{username:'synthetic-user',password:'synthetic-password'});
 assert.equal(observed.options.headers.get('X-EPMS-Request'),'1');assert.equal(observed.options.headers.has('Authorization'),false);assert.equal(observed.options.credentials,'same-origin');
});
test('save/status carry opaque lease+version, never handtyped authority',async()=>{
 const {api,setApiSession}=await load('lib/api.ts');const rows=[];
 setApiSession({id:'a',name:'Reviewer',canRead:true,canEdit:false,canReview:true});
 global.fetch=async(url,options)=>{rows.push({url,options});return {ok:true,json:async()=>({status:'pending',version:8})}};
 await api.epmsSave('A/2026/P','排模表',{moldNo:'A'},'opaque-fixture-token',7);
 await api.epmsStatus('A/2026/P','排模表','approve','opaque-fixture-token',8);
 assert.deepEqual(JSON.parse(rows[0].options.body),{path:'A/2026/P',doc:'排模表',data:{moldNo:'A'},lockToken:'opaque-fixture-token',version:7});
 assert.equal(JSON.parse(rows[1].options.body).version,8);assert.equal(JSON.parse(rows[1].options.body).action,'approve');
 assert.equal(rows[0].options.headers.get('X-EPMS-Request'),'1');
});
test('upload preserves original conflict guard and adds controlled-file lease marker',async()=>{
 const {api,setApiSession}=await load('lib/api.ts');setApiSession({id:'e',name:'Editor',canRead:true,canEdit:true,canReview:false});let xhr;
 global.XMLHttpRequest=class{constructor(){xhr=this;this.upload={};this.headers={}}open(method,url){this.method=method;this.url=url}setRequestHeader(k,v){this.headers[k]=v}send(){this.status=200;this.responseText='{"ok":true,"name":"x.xlsx"}';this.onload()}};
 await api.upload('A/2026/P/工程放产资料',new File(['fixture'],'排模表.xlsx'),undefined,{overwrite:true,baseMtime:123,lockToken:'opaque'});
 assert.equal(xhr.headers['X-EPMS-Request'],'1');assert.equal(xhr.headers['X-EPMS-Lock-Token'],'opaque');assert.ok(xhr.url.includes('baseMtime=123')&&xhr.url.includes('overwrite=1'));
});
test('API errors preserve HTTP status without logging credentials',async()=>{
 const {api}=await load('lib/api.ts');global.fetch=async()=>({ok:false,status:503,json:async()=>({error:'core unavailable'})});
 await assert.rejects(api.epmsSession(),e=>e.status===503&&e.message==='core unavailable');
});
