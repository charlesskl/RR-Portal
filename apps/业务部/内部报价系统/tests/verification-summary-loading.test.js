const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/verification-summary.js'),'utf8');
async function page(responses){
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)){
      const classes=new Set();
      nodes.set(id,{value:'',checked:false,textContent:'',innerHTML:'',disabled:false,handlers:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},addEventListener(event,fn){this.handlers[event]=fn;}});
    }
    return nodes.get(id);
  };
  const location={pathname:'/verification-summary.html',href:''};
  vm.runInNewContext(source,{VerificationReportGroups:require('../frontend/verification-report-groups'),document:{getElementById:node},location,URLSearchParams,fetch:async()=>responses.shift()});
  await new Promise(resolve=>setImmediate(resolve));
  return {node,location};
}
test('HTML 404 produces actionable error, and a successful retry clears it',async()=>{
  const p=await page([{status:404,ok:false,text:async()=>'<html>Cannot GET /api/verification-summary</html>'},
    {status:200,ok:true,text:async()=>JSON.stringify({rows:[],columns:[],customers:[]})}]);
  assert.match(p.node('vs-message').textContent,/尚未加载核价汇总接口/);
  assert.equal(p.node('vs-export').disabled,true);
  await p.node('vs-refresh').handlers.click();
  assert.equal(p.node('vs-message').classList.contains('vs-error'),false);
  assert.equal(p.node('vs-export').disabled,false);
  assert.equal(p.node('vs-count').textContent,'0 款核价');
});
test('invalid success payload does not enable export',async()=>{
  const p=await page([{status:200,ok:true,text:async()=>'{}'}]);
  assert.match(p.node('vs-message').textContent,/格式不完整/);
  assert.equal(p.node('vs-export').disabled,true);
});
test('401 redirects without attempting to parse the response',async()=>{
  const p=await page([{status:401,ok:false,text:async()=>{throw new Error('must not parse');}}]);
  assert.equal(p.location.href,'./index.html');
});
test('all template columns are visible by default in every report',async()=>{
  const columns=require('../backend/services/verificationSummaryTemplate.json').columns;
  const p=await page([{status:200,ok:true,text:async()=>JSON.stringify({rows:[],columns,customers:[]})}]);
  const expected=columns.filter(c=>c.key!=='D');
  assert.equal(p.node('vs-all').checked,true);
  const verify=()=>{
    const html=p.node('vs-detail').innerHTML;
    let last=-1;
    for(const c of expected){const at=html.indexOf(`<th>${c.label}</th>`,last+1);assert.ok(at>last,`${c.label} visible in order`);last=at;}
  };
  verify();
  for(const mode of ['workshop-summary','customer-summary','all-details','customer-detail']){
    p.node('vs-reports').handlers.click({target:{closest:()=>({dataset:{mode}})}});verify();
  }
  p.node('vs-all').checked=false;p.node('vs-all').handlers.input();
  assert.ok(!p.node('vs-detail').innerHTML.includes('<th>退税后啤工</th>'));
});
test('report values display exactly two decimals without rounding source calculations',async()=>{
  const columns=require('../backend/services/verificationSummaryTemplate.json').columns;
  const row={id:1,values:{A:'Sky Castle',B:'JC100',C:'JC100',D:100,E:5.7885,F:6.0848,G:0,Z:0.123456,DI:578.85},sources:{},formulas:{},issues:[],workshop:'河源'};
  const p=await page([{status:200,ok:true,text:async()=>JSON.stringify({rows:[row],columns,customers:[]})}]);
  const html=p.node('vs-detail').innerHTML;
  for(const value of ['5.79','6.08','0.00','100.00','12.35%'])assert.ok(html.includes(`>${value}</td>`),value);
  assert.ok(p.node('vs-overview').innerHTML.includes('>578.85</td>'));
  assert.equal(row.values.E,5.7885);
});
