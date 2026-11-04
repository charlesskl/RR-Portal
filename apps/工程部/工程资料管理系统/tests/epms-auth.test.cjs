// Trusted-core provider tests; fetch is a synthetic fixed-response stub, no network sockets.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const APP=path.resolve(__dirname,'..'),os=require('node:os'),test=require('node:test');
const ts=require('typescript');const cache=new Map();
function load(n){n=path.resolve(APP,n);if(cache.has(n))return cache.get(n).exports;const m=new Module(n,module);m.filename=n;cache.set(n,m);const native=m.require.bind(m);m.require=k=>k==='./epms-store'?load('epms-store.ts'):native(k);m._compile(ts.transpileModule(fs.readFileSync(n,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,n);return m.exports;}
const {createCoreEpmsAuth,coreUserCapabilities}=load('epms-auth.ts');const checks=[];const ok=n=>checks.push(n);
const user={id:11,username:'engineering-user',full_name:'真实姓名',department:'工程部',role:'user',permissions:['epms:edit'],is_active:true};
const req=(extra={})=>({method:'POST',headers:{host:'portal.example','origin':'http://portal.example','x-epms-request':'1',...extra},socket:{}});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v}});
const jwt='SYNTHETIC.PAYLOAD.SIGNATURE';let current={...user},calls=[],status=200;
const fetchCore=async(url,init)=>{calls.push({url,init});assert.ok(['http://core:8000/api/auth/login','http://core:8000/api/auth/me'].includes(url));assert.equal(init.redirect,'error');return new Response(JSON.stringify(url.endsWith('/login')?{access_token:jwt,token_type:'bearer'}:current),{status});};
const auth=createCoreEpmsAuth(fetchCore);const fails=async(fn,s)=>assert.rejects(fn,e=>e.status===s);
test('EPMS verifies fresh core identities and request boundaries', async()=>{
 let caps=coreUserCapabilities(user);assert.equal(caps.name,'真实姓名');assert.equal(caps.id,'11');assert.equal(caps.canEdit,true);assert.equal(caps.canReview,false);
 assert.equal(coreUserCapabilities({...user,department:'业务部'}).canEdit,false);assert.equal(coreUserCapabilities({...user,permissions:[]}).canEdit,false);assert.equal(coreUserCapabilities({...user,department:'业务部',role:'admin',permissions:[]}).canEdit,false);assert.equal(coreUserCapabilities({...user,department:'业务部',role:'admin',permissions:[]}).canReview,true);assert.equal(coreUserCapabilities({...user,department:'业务部',permissions:['epms:approve']}).canReview,true);assert.equal(coreUserCapabilities({...user,full_name:' '}).name,user.username);ok('exact department+epms:edit; approve permission OR admin; no admin edit bypass; authoritative display fallback');
 for(const bad of [{...user,is_active:false},{...user,id:'11'},{...user,role:['admin']},{...user,permissions:'epms:approve'}])assert.throws(()=>coreUserCapabilities(bad),e=>e.status===401);ok('malformed/inactive core user rejected');
 const res=response();caps=await auth.login(req(),res,{username:' engineering-user ',password:'SYNTHETIC password',by:'forged-name',role:'admin'});assert.equal(caps.canReview,false);assert.equal(caps.name,user.full_name);assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].init.body),{username:'engineering-user',password:'SYNTHETIC password'});assert.equal(calls[1].init.headers.Authorization,'Bearer '+jwt);assert.ok(res.headers['Set-Cookie'].includes('Path=/gongcheng-ziliao/; HttpOnly; SameSite=Strict'));assert.ok(!res.headers['Set-Cookie'].includes('Secure'));ok('fixed login+fresh me proxy; forged by/role ignored; HttpOnly path-scoped SameSite cookie');
 const originalCount=calls.length;for(const headers of [{origin:'http://evil.example'},{origin:'null'},{'x-epms-request':''},{origin:''}])await fails(()=>auth.login(req(headers),response(),{username:'x',password:'y'}),403);assert.equal(calls.length,originalCount);ok('cross-origin or missing custom marker rejected before core call');
 const cookie={'cookie':'rr_epms_session='+jwt};caps=await auth.authenticate({...req(cookie),method:'GET'});assert.equal(caps.canEdit,true);current={...current,department:'其他',permissions:['epms:approve']};caps=await auth.authenticate({...req(cookie),method:'GET'});assert.equal(caps.canEdit,false);assert.equal(caps.canReview,true);assert.equal(calls.length,originalCount+2);ok('every protected request fresh core/me; role/department/grant changes immediately applied');
 status=401;await fails(()=>auth.authenticate({...req(cookie),method:'GET'}),401);status=200;ok('expired/revoked core credential does not use cached capability');
 const before=calls.length;assert.equal(await auth.authenticate({...req(),method:'GET'}),null);assert.equal(await auth.authenticate({...req({cookie:'rr_epms_session=invalid'}),method:'GET'}),null);assert.equal(await auth.authenticate({...req({cookie:'rr_epms_session='+jwt+'; rr_epms_session='+jwt}),method:'GET'}),null);assert.equal(calls.length,before);ok('missing/malformed/duplicate cookies never become identity');
 await fails(()=>auth.authenticate(req({...cookie,origin:'http://other.example'})),403);ok('authenticated writes also require same-origin custom marker');
 const secureRes=response();await auth.login(req({'x-forwarded-proto':'https',origin:'https://portal.example'}),secureRes,{username:'x',password:'y'});assert.ok(secureRes.headers['Set-Cookie'].endsWith('; Secure'));const cleared=response();assert.deepEqual(await auth.logout(req(),cleared),{ok:true});assert.ok(cleared.headers['Set-Cookie'].includes('Max-Age=0'));ok('https cookie secure and CSRF-protected logout clears scoped cookie');
 await fails(()=>createCoreEpmsAuth(async()=>{throw Error('synthetic failure')}).authenticate({...req(cookie),method:'GET'}),503);await fails(()=>createCoreEpmsAuth(async()=>new Response('x'.repeat(65537))).authenticate({...req(cookie),method:'GET'}),503);ok('unavailable or oversized core responses fail closed');
 const result={status:'GREEN',passed:checks.length,checks,sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(APP,'epms-auth.ts'))).digest('hex'),noNetwork:true,onlySyntheticCredentials:true};console.log(JSON.stringify(result));
});

test('guarded personal re-login checks the fresh actor before replacing the cookie', async () => {
 const cases = [
  { name: 'same identity and edit rights', value: user, expected: true, status: 200 },
  { name: 'different identity', value: { ...user, id: 12 }, expected: true, status: 409 },
  { name: 'edit permission revoked', value: { ...user, permissions: [] }, expected: true, status: 409 },
  { name: 'edit permission newly granted', value: user, expected: false, status: 409 },
  { name: 'same readonly identity', value: { ...user, permissions: [] }, expected: false, status: 200 },
 ];
 for (const c of cases) {
  const observed = [], target = response();
  const guardedAuth = createCoreEpmsAuth(async (url, init) => {
   observed.push(url);
   assert.equal(Object.hasOwn(target.headers, 'Set-Cookie'), false, c.name + ': no cookie before fresh /me');
   if (url.endsWith('/login')) assert.deepEqual(JSON.parse(init.body), { username: user.username, password: 'synthetic-only' });
   return new Response(JSON.stringify(url.endsWith('/login') ? { access_token: jwt } : c.value));
  });
  const operation = () => guardedAuth.login(req(), target, { username: user.username, password: 'synthetic-only', expectedActorId: String(user.id), expectedCanEdit: c.expected, role: 'admin', canEdit: true });
  if (c.status === 409) {
   await assert.rejects(operation, error => error.status === 409 && /保存或下载.*退出账号再登录/.test(error.message), c.name);
   assert.equal(Object.hasOwn(target.headers, 'Set-Cookie'), false, c.name);
  } else {
   const accepted = await operation();
   assert.equal(accepted.id, String(user.id)); assert.equal(accepted.canEdit, c.expected);
   assert.match(target.headers['Set-Cookie'], /^rr_epms_session=/);
  }
  assert.deepEqual(observed, ['http://core:8000/api/auth/login', 'http://core:8000/api/auth/me']);
 }
});

test('malformed re-login constraints reject before any core request or cookie write', async () => {
 let requested = 0; const guardedAuth = createCoreEpmsAuth(async () => { requested++; throw Error('must not call core'); });
 for (const constraints of [
  { expectedActorId: '' , expectedCanEdit: true }, { expectedActorId: ' 11', expectedCanEdit: true },
  { expectedActorId: 11, expectedCanEdit: true }, { expectedActorId: null, expectedCanEdit: true },
  { expectedActorId: 'x'.repeat(129), expectedCanEdit: true }, { expectedActorId: '11' },
  { expectedCanEdit: false }, { expectedActorId: '11', expectedCanEdit: 'true' },
  { expectedActorId: '11', expectedCanEdit: 1 }, { expectedActorId: '11', expectedCanEdit: null },
 ]) {
  const target = response();
  await assert.rejects(() => guardedAuth.login(req(), target, { username: user.username, password: 'synthetic-only', ...constraints }), error => error.status === 400);
  assert.equal(Object.hasOwn(target.headers, 'Set-Cookie'), false);
 }
 assert.equal(requested, 0);
});

test('guarded bad credentials retain the core adapter internal 401 and never replace the cookie', async () => {
 const target = response(), guardedAuth = createCoreEpmsAuth(async () => new Response('{}', { status: 401 }));
 await assert.rejects(() => guardedAuth.login(req(), target, { username: user.username, password: 'synthetic-wrong', expectedActorId: String(user.id), expectedCanEdit: true }), error => error.status === 401);
 assert.equal(Object.hasOwn(target.headers, 'Set-Cookie'), false);
});
