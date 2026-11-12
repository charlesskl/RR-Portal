'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const test=require('node:test');
const s=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const block=s.slice(s.indexOf('const OCR_READ_PROMPT ='),s.indexOf('/* ── 记录表列顺序'));
const heading='|NO|合同编号|客户订单号|品名规格|物料编号|单位|数量|备品数|重量kg|';
const raw='合成供应商有限公司\n日期：2026-11-12\n送货单号：DN-CONTRACT-01\n'+heading+'\n'+
  Array.from({length:6},(_,i)=>'|'+(i+1)+'|FDJA202612'+(i<3?'3':'4')+'||合成吊牌|SKU00'+i+'|PCS|'+(i?'1000':'2000')+'|100|20|').join('\n')+
  '\n|合计人民币||||||||140|\n|(大写)|||||||||';
const codes=['FDJA20261237-01','FDJA20261237-01','FDJA20261237-01','FDJA20261241-01','FDJA20261241-01','FDJA20261241-01'];
const evidenceRows=()=>codes.map((code,i)=>[String(i+1),code,'PCS',i?'1000':'2000']);
const table=rows=>'|NO|合同编号|单位|数量|\n'+rows.map(row=>'|'+row.join('|')+'|').join('\n');
function runtime(responses) {
  const calls=[],warnings=[];
  const ctx=vm.createContext({AI:{ready:true,baseURL:'https://synthetic.invalid/v1',apiKey:'synthetic',ocrModel:'synthetic'},
    console:{warn:(...xs)=>warnings.push(xs.join(' '))},setTimeout:fn=>fn(),AbortSignal,
    fetch:async(_url,req)=>{
      calls.push(JSON.parse(req.body));assert.ok(responses.length,'unexpected additional OCR request');
      const next=responses.shift();if(next instanceof Error)throw next;
      if(next&&typeof next==='object')return{status:next.status||200,text:async()=>JSON.stringify(next.data||{})};
      return{status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:next}}]})};
    }});
  vm.runInContext(block+';this.actual={parseDeliveryNote,aiVisionExtract};',ctx);
  return{parse:()=>JSON.parse(JSON.stringify(ctx.actual.parseDeliveryNote(raw))),calls,warnings,
    extract:async()=>JSON.parse(JSON.stringify(await ctx.actual.aiVisionExtract('data:image/png;base64,c3ludGhldGlj')))};
}
test('capital-amount footer does not create a seventh goods row or inherit its SKU and contract',()=>{
  const fields=runtime([]).parse();assert.equal(fields.items.length,6);
  assert.ok(fields.items.every(item=>item.orderNoNeedsReview));assert.equal(fields.orderNo,'');
  assert.deepEqual(fields.items.map(i=>i.qty),['2000','1000','1000','1000','1000','1000']);
});
test('one targeted image response recovers lower contract lines by sequence without replacing original rows or raw text',async()=>{
  const r=runtime([raw,table(evidenceRows().reverse())]),initial=r.parse(),result=await r.extract();
  assert.equal(r.calls.length,2);assert.match(r.calls[1].messages[0].content[0].text,/lower wrapped line/);
  assert.equal(result.rawText,raw);assert.equal(result.needsManualReview,false);
  assert.deepEqual(result.fields.items.map(i=>i.orderNo),codes);
  assert.ok(result.fields.items.every(i=>i.orderNoEvidence===i.orderNo&&!i.orderNoNeedsReview));
  assert.deepEqual(result.fields.items.map(i=>[i.productNo,i.productName,i.qty,i.unit]),initial.items.map(i=>[i.productNo,i.productName,i.qty,i.unit]));
});
for(const kind of ['missing-row','duplicate-sequence','changed-quantity','wrong-prefix','still-incomplete','truncated','unavailable','network']) {
  test('contract verification '+kind+' preserves primary data and unresolved PO flags without inventing suffixes',async()=>{
    let rows=evidenceRows(),reply;
    if(kind==='missing-row')rows.pop();
    if(kind==='duplicate-sequence')rows[5][0]='1';
    if(kind==='changed-quantity')rows[0][3]='9999';
    if(kind==='wrong-prefix')rows[0][1]='FDJA20269999-01';
    if(kind==='still-incomplete')rows[0][1]='FDJA2026123';
    reply=table(rows);
    if(kind==='truncated')reply={data:{choices:[{finish_reason:'length',message:{content:reply}}]}};
    if(kind==='unavailable')reply={status:503};
    if(kind==='network')reply=new Error('private-provider-detail');
    const r=runtime([raw,reply]),before=r.parse(),result=await r.extract();
    assert.equal(r.calls.length,2);assert.equal(result.rawText,raw);assert.deepEqual(result.fields,before);
    assert.equal(result.fields.items.length,6);assert.equal(result.needsManualReview,true);
    assert.ok(!r.warnings.join(' ').includes('private-provider-detail'));
  });
}
test('complete contract numbers never require a supplementary identifier request',async()=>{
  let complete=raw;
  for(const [prefix,full] of [['FDJA2026123','FDJA20261237-01'],['FDJA2026124','FDJA20261241-01']])complete=complete.replaceAll(prefix,full);
  const r=runtime([complete]),result=await r.extract();assert.equal(r.calls.length,1);
  assert.equal(result.fields.items.length,6);assert.equal(result.needsManualReview,false);
});

test('a real sequenced goods row named 大写 is not treated as a footer',()=>{
  const ctx=vm.createContext({});vm.runInContext(block+';this.parse=parseDeliveryNote;',ctx);
  const fields=ctx.parse(heading+'\n|1|FDJA20261237-01||(大写)|SKU001|PCS|80|1|2|');
  assert.equal(fields.items.length,1);assert.equal(fields.items[0].qty,'80');
});

test('equivalent bilingual case and traditional header cells keep explicit column meanings',async()=>{
  const rows=evidenceRows().map(([seq,code,unit,qty])=>[seq,code,qty,unit]);
  const evidence='|No.|合同編號|數量|單位|\n'+rows.map(row=>'|'+row.join('|')+'|').join('\n');
  const r=runtime([raw,evidence]),result=await r.extract();
  assert.equal(result.needsManualReview,false);assert.deepEqual(result.fields.items.map(i=>i.orderNo),codes);
});
