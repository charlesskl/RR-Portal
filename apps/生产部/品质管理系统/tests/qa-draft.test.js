'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const fields=['customer','productName','productNo','department','requester','ageGrade','source','receivedDate','sampleQty','description','reportNo','stage','purpose','language'];
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',classList:{toggle(){},remove(){}},replaceChildren(){}});return elements.get(id);}
 const data=Object.fromEntries(fields.map(k=>[k,k==='sampleQty'?'3':'']));Object.assign(data,{standards:[],tests:[]});
 for(const k of fields)el('qa_'+k).value=data[k];
 const storage=new Map(),timers=new Map();let seq=0,requests=[];
 const auth={company:'dg-xingxin',csrfToken:'synthetic',user:{enabled:true,username:'fixture'}};
 const window={__QC_AUTH:auth,addEventListener(){},__QC_REQUEST:async(_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),resolve}))};
 const c=vm.createContext({window,URL,AbortController,location:{href:'http://127.0.0.1/'},document:{currentScript:null,getElementById:el,querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},getCompany:()=>auth.company,canView:()=>true,effPerms:()=>({records:{e:1}}),QC_COMPANIES:[{id:auth.company}],setTimeout:fn=>{timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id),console});
 let src=fs.readFileSync(path.join(__dirname,'../qa-application.js'),'utf8');
 src=src.replace(/\}\)\(\);\s*$/, 'window.fixture={set:c=>session=c,changedApplication,saveApplication,flushApplication,closingWrites,draftKey};})();');vm.runInContext(src,c);
 const context={auth,user:auth.user,username:'fixture',company:auth.company,csrfToken:'synthetic',editable:true,loaded:true,loading:false,version:1,record:{id:1},savedJSON:JSON.stringify(data)};
 window.fixture.set(context);
 return {context,storage,timers,requests,window,fixture:window.fixture,change:v=>{el('qa_sampleQty').value=v;window.fixture.changedApplication()},ack:async(i=0)=>{const q=requests[i];q.resolve({ok:true,json:async()=>({ok:true,application:{recordId:1,version:i+2,data:q.body.data,updatedAt:'2026-11-18T00:00:00Z',updatedBy:'fixture'}})});await new Promise(resolve=>setImmediate(resolve))}};
}
test('reverting unsaved edits removes their draft and cancels autosave',()=>{
 const h=harness();h.change('5');assert.equal(h.storage.size,1);h.change('3');
 assert.equal(h.storage.size,0);assert.equal(h.timers.size,0);assert.equal(h.context.dirty,false);assert.equal(h.context.lastModel.sampleQty,'3');
});
test('reverting during an in-flight save and closing commits the latest intended value',async()=>{
 const h=harness();h.change('5');const first=h.fixture.saveApplication(h.context);h.change('3');
 assert.equal(h.context.dirty,true);assert.equal(JSON.parse([...h.storage.values()][0]).data.sampleQty,'3');
 h.window.closeQAApplication();assert.equal(h.fixture.closingWrites.size,1);
 await h.ack();await first;assert.equal(h.requests.length,2);assert.equal(h.requests[1].body.data.sampleQty,'3');assert.equal(h.requests[1].body.baseVersion,2);
 await h.ack(1);await Promise.all(h.fixture.closingWrites.values());
 assert.equal(h.storage.size,0);assert.equal(JSON.parse(h.context.savedJSON).sampleQty,'3');
});
test('an unsuccessful write retains the latest reverted value locally',async()=>{
 const h=harness();h.change('5');const first=h.fixture.saveApplication(h.context);h.change('3');h.window.closeQAApplication();
 h.requests[0].resolve({ok:false,status:503,json:async()=>({ok:false,error:'offline'})});await first;await Promise.all(h.fixture.closingWrites.values());
 assert.equal(JSON.parse([...h.storage.values()][0]).data.sampleQty,'3');
});
