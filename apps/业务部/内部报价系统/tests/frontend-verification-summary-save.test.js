'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/verification-summary.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const revision='a'.repeat(64),nextRevision='b'.repeat(64);
const response=(body,status=200)=>({ok:status<400,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
function payload(quantity=10,token=revision){return {can_edit_quantity:true,columns:['A','B','C','D'].map(key=>({key,label:key})),customers:[{customer:'客户'}],rows:[{id:1,version_id:7,quantity_revision:token,values:{A:'客户',B:'SKU',C:'产品',D:quantity},sources:{},formulas:{},issues:[],workshop:'华登'}]};}
async function page(responses){
  const nodes=new Map(),requests=[],rows=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,checked:false,handlers:{},style:{setProperty(){}},classList:{add(){},remove(){}},addEventListener(event,fn){this.handlers[event]=fn;}});return nodes.get(id);};
  const table=node('vs-detail');
  table.querySelector=()=>({getBoundingClientRect:()=>({width:160})});
  table.querySelectorAll=selector=>selector==='thead th'?Array.from({length:4},()=>({textContent:''})):rows;
  let html='';Object.defineProperty(table,'innerHTML',{get:()=>html,set:value=>{html=value;rows.splice(0,rows.length,...Array.from({length:(value.match(/<tr/g)||[]).length-1},()=>({cells:Array.from({length:8},()=>({innerHTML:''}))})));}});
  const context={document:{getElementById:node},VerificationReportGroups:require('../frontend/verification-report-groups'),location:{pathname:'/verification-summary.html'},confirm:()=>true,URLSearchParams,fetch:async(url,options)=>{requests.push({url,options});const value=responses.shift();return typeof value==='function'?value():value;}};
  vm.runInNewContext(source,context);await flush();
  const input={value:'',validity:{badInput:false},matches:()=>true};
  const button={dataset:{quantitySave:'7'},disabled:false};
  const message={textContent:''};const cell={querySelector:selector=>selector==='input'?input:selector==='button'?button:message};input.parentElement=button.parentElement=cell;
  const type=value=>{input.value=value;table.handlers.input({target:input});};
  const save=()=>table.handlers.click({target:{closest:selector=>selector==='[data-quantity-save]'?button:null}});
  const quantityHTML=()=>rows.map(row=>row.cells[3]?.innerHTML).join('');
  return {node,table,requests,type,save,quantityHTML,responses,setID:id=>{button.dataset.quantitySave=String(id);},reset:()=>table.handlers.click({target:{closest:selector=>selector==='[data-quantity-reset]'?{dataset:{quantityReset:button.dataset.quantitySave}}:null}})};
}
test('save uses revision and preserves edits entered during the request across a report switch',async()=>{
  let resolveSave;
  const p=await page([response(payload()),()=>new Promise(resolve=>{resolveSave=resolve;}),response(payload(20,nextRevision))]);
  p.type('20');const saving=p.save();await flush();
  const body=JSON.parse(p.requests[1].options.body);assert.equal(body.expected_revision,revision);assert.equal(body.quantity,20);
  p.type('30');p.node('vs-reports').handlers.click({target:{closest:()=>({dataset:{mode:'all-details'}})}});
  assert.match(p.quantityHTML(),/value="30"/);assert.match(p.quantityHTML(),/disabled/);
  resolveSave(response({ok:true,quantity_revision:nextRevision}));await saving;
  assert.match(p.quantityHTML(),/value="30"/);assert.match(p.quantityHTML(),/新修改待保存/);
});
for(const status of [403,409,502])test(`HTTP ${status} keeps the quantity draft and enables retry`,async()=>{
  const p=await page([response(payload()),response(status===502?'<html>Bad Gateway</html>':{error:status===409?'核价资料已更新，请刷新后重试':'无权修改'},status)]);
  p.type('0');await p.save();assert.match(p.quantityHTML(),/value="0"/);assert.doesNotMatch(p.quantityHTML(),/<button[^>]+disabled/);
  assert.match(p.quantityHTML(),status===502?/HTTP 502/:status===409?/刷新/:/无权/);
});
test('clearing explicitly sends null, and refresh failure retains the acknowledged value',async()=>{
  const p=await page([response(payload()),response({ok:true,quantity_revision:nextRevision}),response('<html>Bad Gateway</html>',502)]);
  p.type('');await p.save();assert.equal(JSON.parse(p.requests[1].options.body).quantity,null);
  assert.match(p.quantityHTML(),/value=""/);assert.match(p.quantityHTML(),/已保存；汇总读取失败/);assert.equal(p.node('vs-export').disabled,true);
});
test('a missing sales revision disables quantity saving',async()=>{
  const p=await page([response(payload(10,null))]);assert.match(p.quantityHTML(),/缺少业务核价信息/);p.type('22');await p.save();assert.equal(p.requests.length,1);
});

test('another row refresh cannot replace the revision captured by an unsaved quantity draft',async()=>{
  const first=payload(),second={...first.rows[0],id:2,version_id:8};first.rows.push(second);
  const refreshed=payload(40,nextRevision);refreshed.rows.push({...second,quantity_revision:nextRevision,values:{...second.values,D:0}});
  const p=await page([response(first),response({ok:true,quantity_revision:nextRevision}),response(refreshed),response({error:'核价资料已更新，请刷新后重试'},409)]);
  p.type('30');p.setID(8);p.type('0');await p.save();
  p.setID(7);p.type('30');await p.save();
  assert.equal(JSON.parse(p.requests.at(-1).options.body).expected_revision,revision);
  assert.match(p.quantityHTML(),/value="30"/);assert.match(p.quantityHTML(),/刷新后重试/);
  p.responses.push(response(refreshed));await p.reset();assert.match(p.quantityHTML(),/value="40"/);assert.doesNotMatch(p.quantityHTML(),/value="30"/);
});
test('a successful own save advances the base of later edits to its acknowledged revision',async()=>{
  let finish;
  const p=await page([response(payload()),()=>new Promise(resolve=>finish=resolve),response(payload(20,nextRevision))]);
  p.type('20');const saving=p.save();await flush();p.type('30');finish(response({ok:true,quantity_revision:nextRevision}));await saving;
  p.responses.push(response({error:'stop after observing request'},409));await p.save();
  assert.equal(JSON.parse(p.requests.at(-1).options.body).expected_revision,nextRevision);
});

test('three acknowledged saves serialize refreshes behind an older in-flight snapshot',async()=>{
  const initial=payload();initial.rows.push({...initial.rows[0],id:2,version_id:8},{...initial.rows[0],id:3,version_id:9});
  let releaseOld,releaseFirst,releaseSecond,releaseThird;let active=0,maxActive=0;
  const get=release=>()=>new Promise(resolve=>{active++;maxActive=Math.max(maxActive,active);release(value=>{active--;resolve(response(value));});});
  const p=await page([response(initial)]);
  p.responses.push(get(resolve=>releaseOld=resolve));const old=p.node('vs-refresh').handlers.click();await flush();
  p.responses.push(response({ok:true,quantity_revision:nextRevision}),response({ok:true,quantity_revision:nextRevision}),response({ok:true,quantity_revision:nextRevision}),get(resolve=>releaseFirst=resolve),get(resolve=>releaseSecond=resolve),get(resolve=>releaseThird=resolve));
  p.type('21');const a=p.save();p.setID(8);p.type('22');const b=p.save();p.setID(9);p.type('23');const c=p.save();await flush();
  releaseOld(initial);await old;await flush();assert.equal(active,1);assert.equal(maxActive,1);assert.equal(typeof releaseSecond,'undefined');
  const latest=JSON.parse(JSON.stringify(initial));latest.rows.forEach((row,i)=>{row.values.D=21+i;row.quantity_revision=nextRevision;});
  releaseFirst(latest);await flush();assert.equal(active,1);assert.equal(maxActive,1);assert.equal(typeof releaseThird,'undefined');
  releaseSecond(latest);await flush();assert.equal(active,1);assert.equal(maxActive,1);
  releaseThird(latest);await Promise.all([a,b,c]);assert.equal(active,0);assert.equal(maxActive,1);
  for(const value of ['21','22','23'])assert.match(p.quantityHTML(),new RegExp(`value="${value}"`));
});
