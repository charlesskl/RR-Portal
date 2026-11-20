'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const fields=['customer','productName','productNo','department','requester','ageGrade','source','receivedDate','sampleQty','description','reportNo','stage','purpose','language'];
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',classList:{toggle(){},remove(){}},replaceChildren(){}});return elements.get(id);}
 const data=Object.fromEntries(fields.map(k=>[k,k==='sampleQty'?'3':k==='receivedDate'?'2026-11-19':'']));Object.assign(data,{standards:[],tests:[]});
 for(const k of fields)el('qa_'+k).value=data[k];
 const storage=new Map(),timers=new Map();let seq=0,requests=[],day='2026-11-19';
 const auth={company:'dg-xingxin',csrfToken:'synthetic',user:{enabled:true,username:'fixture'}};
 const window={__QC_AUTH:auth,addEventListener(){},__QC_REQUEST:async(_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),resolve}))};
 const c=vm.createContext({window,URL,AbortController,location:{href:'http://127.0.0.1/'},document:{currentScript:null,getElementById:el,querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},todayStr:()=>day,getCompany:()=>auth.company,canView:()=>true,effPerms:()=>({records:{e:1}}),QC_COMPANIES:[{id:auth.company}],setTimeout:fn=>{timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id),console});
 let src=fs.readFileSync(path.join(__dirname,'../qa-application.js'),'utf8');
 src=src.replace(/\}\)\(\);\s*$/, 'window.fixture={set:c=>session=c,changedApplication,saveApplication,flushApplication,closingWrites,draftKey,applyValues,formValues,syncGenerationDate,sameEditableValues,applicationSelection,takeDescription};})();');vm.runInContext(src,c);
 const context={auth,user:auth.user,username:'fixture',company:auth.company,csrfToken:'synthetic',editable:true,loaded:true,loading:false,version:1,record:{id:1},generationDate:day,savedJSON:JSON.stringify(data)};
 window.fixture.set(context);
 return {context,storage,timers,requests,window,el,setDay:v=>day=v,fixture:window.fixture,change:v=>{el('qa_sampleQty').value=v;window.fixture.changedApplication()},ack:async(i=0)=>{const q=requests[i];q.resolve({ok:true,json:async()=>({ok:true,application:{recordId:1,version:i+2,data:q.body.data,updatedAt:'2026-11-18T00:00:00Z',updatedBy:'fixture'}})});await new Promise(resolve=>setImmediate(resolve))}};
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

test('loading a saved applicant preserves the actual name and uses the generation date',()=>{
 const h=harness();
 h.fixture.applyValues({requester:'张三',receivedDate:'2026-10-30',sampleQty:'8 PCS',description:'已填写的样板描述',standards:[],tests:[]});
 const fields=h.fixture.formValues();
 assert.equal(fields.requester,'张三');assert.equal(fields.receivedDate,'2026-11-19');
 assert.equal(fields.sampleQty,'8 PCS');assert.equal(fields.description,'已填写的样板描述');
});
test('regenerating on another day updates the date without changing the applicant',()=>{
 const h=harness();h.el('qa_requester').value='实际申请人';h.setDay('2026-11-20');
 assert.equal(h.fixture.syncGenerationDate(h.context),true);
 assert.equal(h.fixture.formValues().receivedDate,'2026-11-20');
 assert.equal(h.fixture.formValues().requester,'实际申请人');
 assert.equal(h.context.generationDate,'2026-11-20');
});
test('generation-date-only differences do not turn a saved equivalent draft into a conflict',()=>{
 const h=harness();const original={...h.fixture.formValues(),requester:'实际申请人'};
 assert.equal(h.fixture.sameEditableValues(original,{...original,receivedDate:'2026-11-18'}),true);
 assert.equal(h.fixture.sameEditableValues(original,{...original,requester:'另一个申请人'}),false);
 assert.equal(h.fixture.sameEditableValues(original,{...original,sampleQty:'9'}),false);
});

test('multiple selections number product names in the editable description and leave the product name blank',()=>{
 const h=harness();
 const records=[{id:9,productNo:'15780',productName:'黑粉拼接小公仔C普通款',client:'Zuru',supplier:'华登'},
  {id:3,productNo:'15780',productName:'紫色怪A 普通款',client:'Zuru',supplier:'华登'}];
 const selected=h.fixture.applicationSelection([9,3],records,'2026-11-20');
 assert.equal(selected.record.id,'group:3,9');assert.deepEqual(Array.from(selected.recordIds),[3,9]);
 assert.equal(selected.defaults.productName,'');assert.equal(selected.defaults.productNo,'15780');
 assert.equal(selected.defaults.description,'1. 黑粉拼接小公仔C普通款\n2. 紫色怪A 普通款');
 assert.equal(selected.defaults.sampleQty,'');assert.equal(selected.defaults.department,'品质部');assert.equal(selected.defaults.source,'来料');
 assert.equal(selected.defaults.receivedDate,'2026-11-20');
 assert.equal(h.fixture.applicationSelection([3,9],records,'2026-11-20').record.id,selected.record.id);
 assert.notEqual(h.fixture.applicationSelection(3,records,'2026-11-20').record.id,selected.record.id);
});
test('different product numbers remain associated with each numbered description',()=>{
 const h=harness();const records=[{id:1,productNo:'A-1',productName:'款式A'},{id:2,productNo:'B-2',productName:'款式B'}];
 const selected=h.fixture.applicationSelection([1,2],records,'2026-11-20');
 assert.equal(selected.defaults.productNo,'A-1、B-2');
 assert.equal(selected.defaults.description,'1. 款式A（货号：A-1）\n2. 款式B（货号：B-2）');
 for (const ids of [[],[1],[1,1],[1,999],[-1,2]]) assert.throws(()=>h.fixture.applicationSelection(ids,records,'2026-11-20'));
});
test('combined drafts and requests are isolated from the first individual record',async()=>{
 const h=harness();h.context.record={id:'group:1,2'};h.context.recordIds=[1,2];
 const originalRequest=h.window.__QC_REQUEST;
 h.window.__QC_REQUEST=(url,options)=>{assert.match(url,/recordIds=1%2C2/);return originalRequest(url,options)};
 h.change('12 PCS');assert.ok([...h.storage.keys()][0].endsWith(':group:1,2'));
 const pending=h.fixture.saveApplication(h.context);
 const q=h.requests[0];q.resolve({ok:true,json:async()=>({ok:true,application:{recordId:'group:1,2',version:2,data:q.body.data,updatedAt:'2026-11-20T00:00:00Z',updatedBy:'fixture'}})});
 assert.equal(await pending,true);assert.equal(h.storage.size,0);
});

test('description continuation preserves numbered lines and Unicode without clipping or empty-page loops',()=>{
 const h=harness();
 const element={textContent:'',clientHeight:66,get scrollHeight(){
  return this.textContent.split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(Array.from(line).length/20)),0)*22;
 }};
 const text='1. 简短款式\n2. '+ '长款式😀身体'.repeat(35)+'\n3. 最后一项 <b>原文</b>\n';
 const chunks=[];let rest=text;
 while(rest){const previous=rest;rest=h.fixture.takeDescription(element,rest);chunks.push(element.textContent);
  assert.ok(element.scrollHeight<=element.clientHeight+1);assert.ok(rest.length<previous.length);assert.ok(chunks.length<100);
 }
 assert.equal(chunks.join(''),text);assert.ok(chunks.length>1);assert.ok(chunks.at(-1).includes('3. 最后一项'));
 assert.equal(h.fixture.takeDescription(element,''),'');
 assert.throws(()=>h.fixture.takeDescription({textContent:'',clientHeight:0,scrollHeight:22},'无法放下'),/无法排版/);
});
