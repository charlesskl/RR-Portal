import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../cloud/public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../cloud/public/style.css',import.meta.url),'utf8');
function browser(){
 const nodes=new Map(),listeners={},intervals=[];
 function element(key){let html='';return {style:{},scrollTop:0,scrollLeft:0,value:'',firstChild:null,classList:{add(){},remove(){}},focus(){this.focused=true;},querySelector(){return null;},querySelectorAll(){return [];},get innerHTML(){return html;},set innerHTML(value){
  html=String(value);
  if(key==='#app'){
   for(const name of ['#main','#order-table','.order-scroll','#file-results','#file-search','#user-list','#login-form','#login-error'])nodes.delete(name);
   if(html.includes('id="main"'))nodes.set('#main',element('#main'));
   if(html.includes('id="login-form"')){nodes.set('#login-form',element('#login-form'));nodes.set('#login-error',element('#login-error'));}
  }
  if(key==='#main'){
   for(const name of ['#order-table','.order-scroll','#file-results','#file-search','#user-list'])nodes.delete(name);
   for(const id of ['order-table','file-results','file-search','user-list'])if(html.includes(`id="${id}"`))nodes.set('#'+id,element('#'+id));
  }
  if(key==='#order-table'){nodes.delete('.order-scroll');if(html.includes('order-scroll'))nodes.set('.order-scroll',element('.order-scroll'));}
 }};}
 for(const key of ['#app','#overlay','#toast','#main','#order-table'])nodes.set(key,element(key));
 const document={hidden:false,body:{style:{}},querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn)};
 const ctx=vm.createContext({document,console,location:{search:''},URLSearchParams,URL,Blob,FormData:class{constructor(form){return Object.entries(form.values||{});}},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},setInterval:fn=>{intervals.push(fn);return intervals.length;},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('unexpected fetch');}});
 assert.equal((source.match(/\nload\(\);\n/g)||[]).length,1);
 // Actual definitions/listeners run; boot network read is disabled in this isolated harness.
 vm.runInContext(source.replace('\nload();\n','\n'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 return {ctx,nodes,listeners,run,setState(state){ctx.fixture=state;run('Object.assign(state,fixture)');},readState(){return JSON.parse(run('JSON.stringify(state)'));},refresh:()=>intervals[0]()};
}
const me=(id='a')=>({user:{id,name:id,role:'member',factories:['清溪','石排']},factories:['清溪','石排'],csrf:'synthetic-'+id,demo:false});
const order=(id,extra={})=>({id,number:'ORDER-'+id,product:'Product '+id,sku:'SKU-'+id,customer:'Customer',engineer:'Engineer',follower:'',factory:'清溪',quantity:1,material:'PLA',color:'白',priority:'普通',dueDate:'2026-12-01',status:'待接单',owner:'a',files:[],events:[],...extra});
const state=(orders=[],extra={})=>({me:me(),orders,view:'orders',factory:'全部厂区',filter:'全部',search:'',fileSearch:'',users:[],...extra});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('actual renderer includes every filtered order with sticky scrolling and no pagination',()=>{
 const b=browser();b.setState(state(Array.from({length:17},(_,i)=>order('o'+i))));b.run('renderTable()');
 const html=b.nodes.get('#order-table').innerHTML;
 assert.equal((html.match(/<tr data-order=/g)||[]).length,17);assert.match(html,/共 17 条订单/);assert.doesNotMatch(html,/data-page|pagination/);
 assert.match(html,/tabindex="0" role="region" aria-label="打印订单列表，可上下滚动"/);
 assert.match(css,/\.order-scroll\s*\{[^}]*max-height:[^}]*overflow:auto/s);assert.match(css,/\.order-scroll th\s*\{[^}]*position:sticky;top:0/s);
 b.run("state.filter='已完成';renderTable()");assert.match(b.nodes.get('#order-table').innerHTML,/没有找到符合条件的订单/);
});
test('file search uses case-insensitive AND across file/order fields and factory scope',()=>{
 const b=browser();b.setState(state([
  order('a',{product:'Widget',sku:'XY-12',customer:'Acme',files:[{id:'f1',name:'ALPHA.stl',size:40}]}),
  order('b',{product:'Other',sku:'XY-99',customer:'Acme',files:[{id:'f2',name:'beta.stl',size:40}]}),
  order('c',{factory:'石排',product:'Widget',sku:'XY-12',customer:'Acme',files:[{id:'f3',name:'ALPHA.stl',size:40}]}),
  order('hidden',{canDownloadFiles:false,files:[]}),
 ],{view:'files',factory:'清溪',fileSearch:'  alpha  XY-12 acME  '}));
 b.run('renderFiles()');const html=b.nodes.get('#file-results').innerHTML;
 assert.match(html,/找到 1 个文件，共 2 个/);assert.match(html,/\/api\/files\/f1/);assert.doesNotMatch(html,/\/api\/files\/(?:f2|f3)/);
 const input=b.nodes.get('#file-search');b.listeners.input[0]({target:{id:'file-search',value:'not found'}});
 assert.equal(b.nodes.get('#file-search'),input);assert.match(b.nodes.get('#file-results').innerHTML,/没有找到符合条件的文件/);
});
test('file metadata/search text are escaped and a denied empty library exposes no file URL',()=>{
 const b=browser();b.setState(state([order('a',{product:'<svg onload=bad()>',sku:'" onclick="bad()',files:[{id:'f',name:'<img src=x onerror=bad()>.stl',size:5}]})],{view:'files',fileSearch:'"<'}));
 b.run('renderFiles()');assert.match(b.nodes.get('#main').innerHTML,/value="&quot;&lt;"/);
 b.run("state.fileSearch='';renderFileResults()");const html=b.nodes.get('#file-results').innerHTML;
 assert.doesNotMatch(html,/<img|<svg onload| onclick="bad/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);
 b.setState(state([order('hidden',{canDownloadFiles:false,files:[]})],{view:'files'}));b.run('renderFiles()');assert.match(b.nodes.get('#file-results').innerHTML,/这里只显示您有权访问的文件/);assert.doesNotMatch(b.nodes.get('#file-results').innerHTML,/\/api\/files\//);
});
test('actual polling retains both scroll axes and preserves the file search control',async()=>{
 const b=browser();b.setState(state([order('a')]));b.run('renderView()');b.nodes.get('.order-scroll').scrollTop=244;b.nodes.get('.order-scroll').scrollLeft=88;
 b.ctx.fetch=async()=>response([order('a'),order('b')]);await b.refresh();assert.equal(b.nodes.get('.order-scroll').scrollTop,244);assert.equal(b.nodes.get('.order-scroll').scrollLeft,88);
 b.run("state.view='files';state.fileSearch='alpha';renderView()");const input=b.nodes.get('#file-search');
 b.ctx.fetch=async()=>response([order('a',{files:[{id:'f',name:'alpha.stl',size:3}]})]);await b.refresh();assert.equal(b.nodes.get('#file-search'),input);assert.equal(b.readState().fileSearch,'alpha');assert.match(b.nodes.get('#file-results').innerHTML,/alpha\.stl/);
});
test('old-account refresh cannot restore private metadata after another account signs in',async()=>{
 const b=browser(),pending=deferred();b.setState(state([order('old')]));b.run('renderView()');b.ctx.fetch=()=>pending.promise;
 const refresh=b.refresh();b.run('renderLogin()');b.setState(state([order('new')],{me:me('b'),view:'files'}));b.run('renderShell()');
 pending.resolve(response([order('old',{files:[{id:'secret',name:'OLD-PRIVATE.stl',size:2}]})]));await refresh;
 assert.equal(b.readState().orders[0].id,'new');assert.doesNotMatch(b.nodes.get('#file-results').innerHTML,/OLD-PRIVATE|secret/);
});
test('current unauthorized request clears identity and cached metadata before showing login',async()=>{
 const b=browser();b.setState(state([order('private')],{users:[{id:'admin'}],fileSearch:'private'}));b.ctx.fetch=async()=>response({error:'expired'},401);
 await assert.rejects(b.run('api("/api/orders")'),/expired/);const current=b.readState();assert.equal(current.me,null);assert.deepEqual(current.orders,[]);assert.deepEqual(current.users,[]);assert.equal(current.fileSearch,'');assert.ok(b.nodes.get('#login-form'));
});
test('an old 401 response cannot sign out a newer account',async()=>{
 const b=browser(),pending=deferred();b.setState(state([order('old')]));b.ctx.fetch=()=>pending.promise;const request=b.run('api("/api/orders")');
 b.run('renderLogin()');b.setState(state([order('new')],{me:me('b'),view:'files'}));b.run('renderShell()');pending.resolve(response({error:'old expired'},401));await assert.rejects(request,/old expired/);
 assert.equal(b.readState().me.user.id,'b');assert.equal(b.readState().orders[0].id,'new');assert.equal(b.nodes.has('#login-form'),false);
});
test('load started before sign-out cannot commit its old identity or issue orders read afterward',async()=>{
 const b=browser(),pending=deferred();let orderReads=0;b.ctx.fetch=url=>url==='/api/me'?pending.promise:(orderReads++,Promise.resolve(response([order('old')])));
 const load=b.run('load()');b.run('renderLogin()');b.setState(state([order('new')],{me:me('b')}));b.run('renderShell()');pending.resolve(response(me('a')));await load;
 assert.equal(b.readState().me.user.id,'b');assert.equal(b.readState().orders[0].id,'new');assert.equal(orderReads,0);
});
test('overlapping refreshes keep the newest result and a modal opened during the wait is untouched',async()=>{
 const b=browser(),first=deferred(),second=deferred();b.setState(state([order('base')]));b.run('renderView()');let calls=0;b.ctx.fetch=()=>++calls===1?first.promise:second.promise;
 const a=b.refresh(),z=b.refresh();second.resolve(response([order('newest')]));await z;first.resolve(response([order('older')]));await a;assert.equal(b.readState().orders[0].id,'newest');
 const modal=deferred();b.ctx.fetch=()=>modal.promise;const wait=b.refresh();b.nodes.get('#overlay').firstChild={};const html=b.nodes.get('#main').innerHTML;modal.resolve(response([order('while-form-open')]));await wait;assert.equal(b.nodes.get('#main').innerHTML,html);assert.equal(b.readState().orders[0].id,'newest');
});

test('normal load atomically applies the current account and all orders',async()=>{
 const b=browser(),current=me('b'),orders=[order('mine')];const calls=[];
 b.ctx.fetch=async url=>{calls.push(url);return response(url==='/api/me'?current:orders);};
 await b.run('load()');assert.deepEqual(calls,['/api/me','/api/orders']);assert.equal(b.readState().me.user.id,'b');assert.equal(b.readState().orders[0].id,'mine');assert.ok(b.nodes.get('#main'));assert.equal(b.nodes.has('#login-form'),false);
});
test('an earlier orders load cannot commit after a later login load succeeds',async()=>{
 const b=browser(),oldOrders=deferred();let meCalls=0,ordersCalls=0;
 b.ctx.fetch=async url=>{if(url==='/api/me')return response(me(++meCalls===1?'old':'new'));return ++ordersCalls===1?oldOrders.promise:response([order('new')]);};
 const oldLoad=b.run('load()');while(ordersCalls===0)await Promise.resolve();
 b.run('renderLogin()');await b.run('load()');oldOrders.resolve(response([order('old-private')]));await oldLoad;
 assert.equal(b.readState().me.user.id,'new');assert.equal(b.readState().orders[0].id,'new');
});
test('login submit preserves a current 401 message and enables retry',async()=>{
 const b=browser();b.run('renderLogin()');const button={disabled:false};const form={id:'login-form',values:{username:'synthetic',password:'synthetic'},querySelector:()=>button};
 b.ctx.fetch=async()=>response({error:'账号或密码不正确'},401);
 await b.listeners.submit[0]({target:form,preventDefault(){}});
 assert.equal(b.nodes.get('#login-error').textContent,'账号或密码不正确');assert.equal(button.disabled,false);assert.ok(b.nodes.get('#login-form'));assert.equal(b.readState().me,null);
});
test('successful logout handler clears both searches, users, identity and attachment metadata',async()=>{
 const b=browser();b.setState(state([order('private',{files:[{id:'secret',name:'secret.stl',size:1}]})],{users:[{id:'admin'}],search:'old order',fileSearch:'old file'}));
 b.ctx.fetch=async()=>response({ok:true});const target={dataset:{action:'logout'}};
 await b.listeners.click[0]({target:{closest:()=>target}});const cleared=b.readState();
 assert.equal(cleared.me,null);assert.deepEqual(cleared.orders,[]);assert.deepEqual(cleared.users,[]);assert.equal(cleared.search,'');assert.equal(cleared.fileSearch,'');assert.ok(b.nodes.get('#login-form'));
});

test('order details explain restricted attachments and keep authorized image preview/download',()=>{
 const b=browser();b.setState(state([order('denied',{owner:'other',canDownloadFiles:false,files:[]})]));b.run('openOrder("denied")');
 const denied=b.nodes.get('#overlay').innerHTML;assert.match(denied,/附件仅管理员和下单账号可查看及下载/);assert.doesNotMatch(denied,/\/api\/files\//);
 b.setState(state([order('own',{canDownloadFiles:true,files:[{id:'img',name:'reference.png',size:9},{id:'model',name:'model.stl',size:9}]})]));b.run('openOrder("own")');
 const allowed=b.nodes.get('#overlay').innerHTML;assert.match(allowed,/href="\/api\/files\/img\?preview=1" target="_blank" rel="noopener"/);assert.match(allowed,/src="\/api\/files\/img\?preview=1"/);assert.match(allowed,/href="\/api\/files\/model" download/);
});
test('current startup 401 shows login, and obsolete startup errors cannot replace a newer shell',async()=>{
 const b=browser();b.ctx.fetch=async()=>response({error:'expired'},401);await b.run('load()');assert.ok(b.nodes.get('#login-form'));assert.equal(b.readState().me,null);
 const pending=deferred();b.ctx.fetch=()=>pending.promise;const old=b.run('load()');b.run('renderLogin()');b.setState(state([order('new')],{me:me('b')}));b.run('renderShell()');const html=b.nodes.get('#app').innerHTML;
 pending.resolve(response({error:'obsolete failed'},503));await old;assert.equal(b.nodes.get('#app').innerHTML,html);assert.equal(b.readState().me.user.id,'b');
});
test('polling does not replace a users view opened while its order request is in flight',async()=>{
 const b=browser(),pending=deferred();b.setState(state([order('base')]));b.run('renderView()');b.ctx.fetch=()=>pending.promise;const refresh=b.refresh();b.run("state.view='users'");const html=b.nodes.get('#main').innerHTML;
 pending.resolve(response([order('replacement')]));await refresh;assert.equal(b.nodes.get('#main').innerHTML,html);assert.equal(b.readState().orders[0].id,'base');
});

test('old administrator update response cannot restore attachment metadata into another account',async()=>{
 const b=browser(),pending=deferred(),admin=me('a');admin.user.role='admin';
 b.setState(state([order('shared',{owner:'a'})],{me:admin}));b.run('renderView()');b.ctx.fetch=()=>pending.promise;
 const button={disabled:false},form={id:'update-form',dataset:{id:'shared'},values:{status:'待排产'},querySelector:()=>button};
 const update=b.listeners.submit[0]({target:form,preventDefault(){}});
 b.run('renderLogin()');b.setState(state([order('shared',{owner:'a',canDownloadFiles:false,files:[]})],{me:me('b'),view:'files'}));b.run('renderShell()');
 pending.resolve(response(order('shared',{owner:'a',status:'待排产',canDownloadFiles:true,files:[{id:'old-private',name:'OLD-PRIVATE.stl',size:2}]})));await update;
 assert.equal(b.readState().me.user.id,'b');assert.deepEqual(b.readState().orders[0].files,[]);assert.doesNotMatch(b.nodes.get('#overlay').innerHTML,/OLD-PRIVATE|old-private/);assert.equal(button.disabled,false);
});
test('old user-list response cannot restore another account user cache',async()=>{
 const b=browser(),pending=deferred(),admin=me('a');admin.user.role='admin';b.setState(state([],{me:admin,view:'users'}));b.ctx.fetch=()=>pending.promise;
 const listing=b.run('renderUsers()');b.run('renderLogin()');b.setState(state([],{me:me('b'),view:'files'}));b.run('renderShell()');
 pending.resolve(response([{id:'old-private-user',username:'old-private-login',name:'old-private-name',role:'member',factories:['清溪']}]));await listing;
 assert.equal(b.readState().me.user.id,'b');assert.deepEqual(b.readState().users,[]);assert.doesNotMatch(b.nodes.get('#main').innerHTML,/old-private/);
});
test('successful login submit still loads its own identity and orders',async()=>{
 const b=browser();b.run('renderLogin()');const button={disabled:false},form={id:'login-form',values:{username:'synthetic',password:'synthetic'},querySelector:()=>button};const calls=[];
 b.ctx.fetch=async url=>{calls.push(url);return response(url==='/api/orders'?[order('own')]:me('b'));};
 await b.listeners.submit[0]({target:form,preventDefault(){}});assert.deepEqual(calls,['/api/login','/api/me','/api/orders']);assert.equal(b.readState().me.user.id,'b');assert.equal(b.readState().orders[0].id,'own');assert.equal(button.disabled,false);assert.equal(b.nodes.has('#login-form'),false);
});
test('current administrator update still applies authorized attachment metadata',async()=>{
 const b=browser(),admin=me('a');admin.user.role='admin';b.setState(state([order('shared')],{me:admin}));b.run('renderView()');
 b.ctx.fetch=async()=>response(order('shared',{status:'待排产',canDownloadFiles:true,files:[{id:'own-private',name:'OWN-PRIVATE.stl',size:2}]}));
 const button={disabled:false},form={id:'update-form',dataset:{id:'shared'},values:{status:'待排产'},querySelector:()=>button};
 await b.listeners.submit[0]({target:form,preventDefault(){}});assert.equal(b.readState().orders[0].status,'待排产');assert.equal(b.readState().orders[0].files[0].id,'own-private');assert.match(b.nodes.get('#overlay').innerHTML,/OWN-PRIVATE/);
});
