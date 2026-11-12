import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../cloud/public/app.js',import.meta.url),'utf8');
const unescape=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
function classes(initial=''){
 const set=new Set(initial.split(/\s+/).filter(Boolean));
 return {add:v=>set.add(v),remove:v=>set.delete(v),contains:v=>set.has(v),toggle(v,on){const show=on??!set.has(v);if(show)set.add(v);else set.delete(v);return show;}};
}
function browser(){
 const nodes=new Map(),listeners={},intervals=[],calls=[];
 function element(key){let html='';const node={value:'',textContent:'',style:{},classList:classes(),firstChild:null,querySelector:()=>null,querySelectorAll:()=>[],focus(){}};
  Object.defineProperty(node,'innerHTML',{get:()=>html,set(value){html=String(value);node.htmlWrites=(node.htmlWrites||0)+1;
   if(key==='#main')for(const id of ['user-list','user-search','user-search-count'])if(html.includes(`id="${id}"`))nodes.set('#'+id,element('#'+id));
   if(key==='#user-list'){
    node.rows=[...html.matchAll(/<tr data-user-id="([^"]+)">([\s\S]*?)<\/tr>/g)].map(match=>row(match[1],match[2],node));
    node.querySelectorAll=selector=>{assert.equal(selector,'tr[data-user-id]');return node.rows;};
    nodes.set('#user-search-empty',{classList:classes('empty hide')});
   }
  }});return node;
 }
 function row(id,html,list){
  const fields={};for(const match of html.matchAll(/<input name="(name|username)"[^>]*value="([^"]*)"/g))fields[match[1]]={name:match[1],value:unescape(match[2])};
  const role=html.match(/<option value="(admin|member)" selected/);fields.role={name:'role',value:role[1]};
  const factories=[...html.matchAll(/<input type="checkbox" name="factories" value="([^"]*)"([^>]*)>/g)].map(m=>({value:unescape(m[1]),checked:/\bchecked\b/.test(m[2])}));
  const error={textContent:'',isConnected:true},buttons=[{disabled:false},{disabled:false},{disabled:false}];
  const result={id,fields,factories,error,classList:classes(),querySelector(selector){if(selector==='.user-row-error')return error;return fields[selector.match(/^\[name=(\w+)\]$/)?.[1]]||null;},querySelectorAll(selector){if(selector==='[name=factories]:checked')return factories.filter(f=>f.checked);if(selector==='button')return buttons;assert.equal(selector,'input[name=name],input[name=username],select[name=role]');return Object.values(fields);}};
  Object.defineProperty(result,'outerHTML',{set(value){const match=value.match(/^<tr data-user-id="([^"]+)">([\s\S]*)<\/tr>$/);assert.ok(match);list.rows[list.rows.indexOf(result)]=row(match[1],match[2],list);error.isConnected=false;}});return result;
 }
 for(const key of ['#app','#main','#overlay','#toast','#selected-files'])nodes.set(key,element(key));
 const document={hidden:false,body:{style:{}},querySelector(selector){const id=selector.match(/^\[data-user-id="([^"]+)"\]$/)?.[1];return id?nodes.get('#user-list')?.rows.find(r=>r.id===id):nodes.get(selector)||null;},querySelectorAll:()=>[],addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
 const ctx=vm.createContext({document,console,location:{search:''},URLSearchParams,URL,Blob,FormData:class{},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},setInterval:fn=>intervals.push(fn),setTimeout:()=>1,clearTimeout(){},fetch:async(url,options)=>{calls.push({url,options});throw Error('unexpected request');}});
 vm.runInContext(source.replace('\nload();\n','\n'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 run(`state.me={user:{id:'admin',name:'PR1111 admin',role:'admin',factories:['清溪','湖南']},factories:['清溪','湖南'],csrf:'synthetic',demo:false};state.view='users'`);
 const list=()=>nodes.get('#user-list');
 return {ctx,nodes,calls,run,list,intervals,search(value){const input=nodes.get('#user-search');input.value=value;listeners.input[0]({target:{id:'user-search',value}});},async load(users){ctx.fetch=async()=>({ok:true,status:200,json:async()=>users});await run('renderUsers()');}};
}
const users=[{id:'one',name:'张 工程师',username:'ALPHA@example.test',role:'member',factories:['清溪']},{id:'two',name:'李工程师',username:'beta@example.test',role:'member',factories:['湖南']}];
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});

test('search hides existing rows and preserves all unsaved editable fields when cleared',async()=>{
 const b=browser();await b.load(users);const list=b.list(),input=b.nodes.get('#user-search'),first=list.rows[0];
 first.fields.name.value='PR1111 未保存姓名';first.fields.username.value='edited@example.test';first.fields.role.value='admin';first.factories[1].checked=true;first.error.textContent='未保存提示';
 const writes=list.htmlWrites;b.search('beta');assert.equal(first.classList.contains('hide'),true);assert.equal(list.rows[1].classList.contains('hide'),false);
 b.search('missing');assert.equal(b.nodes.get('#user-search-empty').classList.contains('hide'),false);assert.equal(b.nodes.get('#user-search-count').textContent,'找到 0 个账号，共 2 个');
 b.search('');assert.equal(list.rows[0],first);assert.equal(b.nodes.get('#user-search'),input);assert.equal(list.htmlWrites,writes);assert.equal(first.classList.contains('hide'),false);
 assert.deepEqual(Object.fromEntries(Object.entries(first.fields).map(([k,v])=>[k,v.value])),{name:'PR1111 未保存姓名',username:'edited@example.test',role:'admin'});
 assert.equal(first.factories[1].checked,true);assert.equal(first.error.textContent,'未保存提示');
});
test('actual search handler matches name plus email case-insensitively with AND keywords',async()=>{
 const b=browser();await b.load(users);b.search('  张   ALpHa@EXAMPLE.TEST ');
 assert.equal(b.list().rows[0].classList.contains('hide'),false);assert.equal(b.list().rows[1].classList.contains('hide'),true);assert.equal(b.nodes.get('#user-search-count').textContent,'找到 1 个账号，共 2 个');
 b.list().rows[0].fields.username.value='changed@example.test';b.search('changed 张');assert.equal(b.list().rows[0].classList.contains('hide'),false);
 let reads=0;b.ctx.fetch=async()=>{reads++;throw Error('poll must not overwrite edits');};await b.intervals[0]();assert.equal(reads,0);assert.equal(b.list().rows[0].fields.username.value,'changed@example.test');
});
test('saving one filtered row sends that row only and preserves another hidden draft',async()=>{
 const b=browser();await b.load(users);const hidden=b.list().rows[0];hidden.fields.name.value='PR1111 保留此未保存值';b.list().rows[1].fields.name.value='PR1111 已修改李';b.search('beta');
 let sent;b.ctx.fetch=async(url,options)=>{sent={url,body:JSON.parse(options.body)};return response({user:{...users[1],name:'PR1111 已修改李'},signedOut:false,accessChanged:false});};
 await b.run('saveUser("two")');assert.equal(sent.url,'/api/users/two');assert.deepEqual(sent.body,{name:'PR1111 已修改李',username:'beta@example.test',role:'member',factories:['湖南']});
 assert.equal(b.list().rows[0],hidden);assert.equal(hidden.fields.name.value,'PR1111 保留此未保存值');assert.equal(hidden.classList.contains('hide'),true);assert.equal(b.list().rows[1].fields.name.value,'PR1111 已修改李');assert.equal(b.run('state.userSearch'),'beta');
});
test('failed save keeps the filtered draft and error rather than replacing it with server values',async()=>{
 const b=browser();await b.load(users);const edited=b.list().rows[0];edited.fields.name.value='PR1111 retry';b.search('alpha');b.ctx.fetch=async()=>response({error:'合成冲突'},409);
 await b.run('saveUser("one")');assert.equal(b.list().rows[0],edited);assert.equal(edited.fields.name.value,'PR1111 retry');assert.equal(edited.error.textContent,'合成冲突');assert.equal(b.run('state.userSearch'),'alpha');assert.equal(b.run('busy'),false);
});
test('search entered while users are loading is applied once the real response arrives',async()=>{
 const b=browser();let resolve;b.ctx.fetch=()=>new Promise(r=>{resolve=r;});const pending=b.run('renderUsers()');b.search('BETA');resolve(response(users));await pending;
 assert.equal(b.list().rows[0].classList.contains('hide'),true);assert.equal(b.list().rows[1].classList.contains('hide'),false);assert.equal(b.nodes.get('#user-search-count').textContent,'找到 1 个账号，共 2 个');
});
test('file picker accepts JFIF and X_T case variants but rejects disguised suffixes and empty files',()=>{
 const b=browser();b.ctx.files=[{name:'PR1111.jfif',size:11},{name:'PR1111.JFIF',size:12},{name:'PR1111.x_t',size:13},{name:'PR1111.X_T',size:14},{name:'PR1111.jfif.exe',size:15},{name:'empty.x_t',size:0}];b.run('addFiles(files)');
 assert.deepEqual(JSON.parse(b.run('JSON.stringify(selectedFiles.map(f=>f.name))')),['PR1111.jfif','PR1111.JFIF','PR1111.x_t','PR1111.X_T']);assert.match(b.nodes.get('#selected-files').innerHTML,/PR1111\.jfif/);
});
