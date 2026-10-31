const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../frontend/verification.js'),'utf8');
function fixture({failCreate=false,failReload=false}={}){
 let overlay,creates=0,load=0,opened=0;
 const nodes=new Map(),node=k=>{if(!nodes.has(k))nodes.set(k,{disabled:false,textContent:'',focus(){}});return nodes.get(k);};
 const form={reportValidity:()=>true,querySelector:node};
 const context={$:node,esc:v=>String(v).replace(/</g,'&lt;'),document:{createElement(){return overlay={removed:false,querySelector:s=>s==='form'?form:node(s),remove(){this.removed=true;}};},body:{appendChild(){}}},
  api:async(url)=>{if(url==='/quotes/customers')return {customers:['<客户>']};creates++;if(failCreate)throw Error('创建失败');return{id:9};},
  FormData:class{*[Symbol.iterator](){yield ['quote_no','TEST'];yield ['customer','<客户>'];}},versionCache:new Map(),selectedQuoteId:null,
  loadList:async()=>{load++;if(failReload)throw Error('列表失败');},selectTask:async()=>{},openDetail:()=>opened++,alert(){},window:{location:{href:''}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function openCreateVerification()'),source.indexOf('const VERSION_STATUS')),context);
 return {context,node,open:()=>context.openCreateVerification(),submit:()=>form.onsubmit({preventDefault(){}}),overlay:()=>overlay,counts:()=>({creates,load,opened})};
}
test('新建表单转义客户名称、拒绝重复提交并直接进入核价',async()=>{
 const f=fixture();await f.open();assert.match(f.overlay().innerHTML,/&lt;客户>/);
 await Promise.all([f.submit(),f.submit()]);assert.deepEqual(f.counts(),{creates:1,load:1,opened:1});assert.equal(f.context.selectedQuoteId,9);
});
test('创建失败保留输入可重试；已创建后列表失败只导航现有任务，不再次创建',async()=>{
 const failed=fixture({failCreate:true});await failed.open();await failed.submit();assert.equal(failed.overlay().removed,false);assert.equal(failed.node('[type="submit"]').disabled,false);assert.equal(failed.node('[data-create-error]').textContent,'创建失败');
 const reload=fixture({failReload:true});await reload.open();await reload.submit();assert.equal(reload.counts().creates,1);assert.equal(reload.context.window.location.href,'./verification.html?quote_id=9');
});
