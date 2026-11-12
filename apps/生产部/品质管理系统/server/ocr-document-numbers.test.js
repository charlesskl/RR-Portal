'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const block=source.slice(source.indexOf('const OCR_READ_PROMPT ='),source.indexOf('/* ── 记录表列顺序'));
function runtime(responses=[]) {
  let calls=0;
  const ctx=vm.createContext({AI:{ready:true,baseURL:'https://synthetic.invalid/v1',apiKey:'synthetic',ocrModel:'synthetic'},
    console:{warn(){}},setTimeout:fn=>fn(),AbortSignal,fetch:async()=>{
      calls++;assert.ok(responses.length,'unexpected model request');
      return{status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:responses.shift()}}]})};
    }});
  vm.runInContext(block+';this.actual={parseDeliveryNote,_explicitOcrHeaders,aiVisionExtract};',ctx);
  const plain=x=>JSON.parse(JSON.stringify(x));
  return{parse:text=>plain(ctx.actual.parseDeliveryNote(text)),headers:text=>plain(ctx.actual._explicitOcrHeaders(text)),
    extract:async()=>plain(await ctx.actual.aiVisionExtract('data:image/png;base64,c3ludGhldGlj')),calls:()=>calls};
}
const goods='|序号|产品名称|物料编号|数量/KG|累计/KG|备注|\n|1|合成轻泥甲|系列-TEST|80|80|20KG*4箱|\n|2|合成轻泥乙|系列-TEST|100|100|20KG*5箱|';
const countedGoods='|货号|品名|数量|单位|\n|SKU-001|合成甲零件|80|PCS|\n|SKU-002|合成乙零件|100|PCS|';
const prefix='合成供应商有限公司\n日期：2026-11-12\n客户订单\n编号PO.NO: PO2026/S019\n';
const delivery='送货单号\nNO: 20261112HD0123\n';
test('a customer PO.NO preceding the bilingual delivery number keeps the two identities separate through extraction',async()=>{
  const raw=prefix+delivery+goods,r=runtime([raw]);
  const fields=r.parse(raw),extracted=await r.extract();
  assert.equal(fields.deliveryNo,'20261112HD0123'); assert.equal(fields.orderNo,'PO2026/S019');
  assert.equal(fields.items.length,2); assert.deepEqual(fields.items.map(i=>i.qty),['80','100']);
  assert.equal(extracted.fields.deliveryNo,fields.deliveryNo); assert.equal(extracted.fields.orderNo,fields.orderNo);
  assert.equal(extracted.rawText,raw); assert.equal(r.calls(),1);
});
for(const label of ['PO.NO','PO NO','PO No.','P.O. NO.','P.O.NO','PO','PURCHASE ORDER NO.','订单号','訂單編號','客户订单编号','订单号(PO#)','PO#','PO号']) {
  test('order label '+label+' cannot supply delivery identity',()=>{
    const fields=runtime().parse(label+': PO2026/S019\n'+goods);
    assert.equal(fields.orderNo,'PO2026/S019'); assert.equal(fields.deliveryNo,'');
  });
}
for(const label of ['送货单号\nNO:','送貨單號\nNO.:','送货单号：','送貨單編號：','发货单编号：','DELIVERY NOTE NO:','D.O.No.:']) {
  test('explicit delivery label '+JSON.stringify(label)+' wins over earlier generic NO and PO text',()=>{
    const fields=runtime().parse('NO: OLD-9999\n'+prefix+label+' 20261112HD0123\n'+goods);
    assert.equal(fields.deliveryNo,'20261112HD0123'); assert.equal(fields.orderNo,'PO2026/S019');
  });
}
test('two explicit conflicting delivery numbers stay blank instead of falling back to the PO or another bare number',()=>{
  const fields=runtime().parse(prefix+'送货单号: DN-1111\n发货单号: DN-2222\n888888\n'+goods);
  assert.equal(fields.deliveryNo,''); assert.equal(fields.orderNo,'PO2026/S019');
});
test('an isolated numeric customer order on its next line is not an unlabeled delivery number',()=>{
  const fields=runtime().parse('客户订单号\n123456\n'+goods);
  assert.equal(fields.orderNo,'123456'); assert.equal(fields.deliveryNo,'');
});
test('a missing delivery number never copies a customer PO, including split PO labels',()=>{
  for(const label of ['PO\nNO:', '客户订单\n编号PO.NO:']) {
    const fields=runtime().parse(label+' PO2026/S019\n送货单号\nNO:\n'+goods);
    assert.equal(fields.orderNo,'PO2026/S019'); assert.equal(fields.deliveryNo,'');
  }
});
test('supplemental headers use the same explicit bilingual classification and ignore order numbers',()=>{
  const r=runtime(),fields=r.headers(prefix+delivery);
  assert.equal(fields.deliveryNo,'20261112HD0123');
  assert.equal(r.headers(prefix).deliveryNo,'');
  assert.equal(r.headers('NO: 20261112HD0123').deliveryNo,'','bare NO alone is not explicit supplemental evidence');
  assert.equal(r.headers(prefix+goods+'\n'+delivery).deliveryNo,'','a table body is not a header');
});

test('optional bilingual header recovery fills delivery identity without copying or replacing the original PO',async()=>{
  const raw='客户订单\n编号PO.NO: PO2026/S019\n'+countedGoods;
  const r=runtime([raw,'合成供应商有限公司\n日期：2026-11-12\n客户订单\n编号PO.NO: OTHER-1234\n'+delivery]);
  const result=await r.extract();
  assert.equal(result.fields.orderNo,'PO2026/S019'); assert.equal(result.fields.deliveryNo,'20261112HD0123');
  assert.equal(result.rawText,raw); assert.equal(result.fields.items.length,2); assert.equal(r.calls(),2);
});

test('weight quantities still require manual confirmation and do not trigger optional header recovery',async()=>{
  const raw='客户订单\n编号PO.NO: PO2026/S019\n'+goods;
  const r=runtime([raw,'合成供应商有限公司\n日期：2026-11-12\n'+delivery]);
  const result=await r.extract();
  assert.equal(r.calls(),1); assert.equal(result.needsManualReview,true);
  assert.equal(result.fields.orderNo,'PO2026/S019'); assert.equal(result.fields.deliveryNo,'');
  assert.equal(result.rawText,raw); assert.equal(result.fields.items.length,2);
  assert.deepEqual(result.fields.items.map(i=>[i.qty,i.unit,i.quantityNeedsReview]),[['80','KG',true],['100','KG',true]]);
});

for(const [kind,table] of [['counted',countedGoods],['weight',goods]]) {
  test(kind+' delivery conflict preserves all primary rows and cannot be filled from a later one-number header',async()=>{
    const raw=prefix+'送货单号: DN-1111\n发货单号: DN-2222\n'+table;
    const r=runtime([raw,'合成供应商有限公司\n日期：2026-11-12\n送货单号: DN-1111']);
    const initial=r.parse(raw),result=await r.extract();
    assert.equal(result.fields.deliveryNo,''); assert.equal(result.fields.orderNo,'PO2026/S019');
    assert.equal(result.fields.manualReviewRequired,true); assert.equal(result.needsManualReview,true);
    assert.equal(result.rawText,raw); assert.deepEqual(result.fields.items,initial.items);
    assert.equal(result.fields.items.length,2); assert.equal(r.calls(),1);
  });
}

test('explicit corrected source text is reparsed afresh without carrying the previous delivery conflict',()=>{
  const r=runtime(),conflicting=prefix+'送货单号: DN-1111\n发货单号: DN-2222\n'+countedGoods;
  const before=r.parse(conflicting); assert.equal(before.deliveryNo,''); assert.equal(before.manualReviewRequired,true);
  const corrected=r.parse(conflicting.replace('发货单号: DN-2222\n',''));
  assert.equal(corrected.deliveryNo,'DN-1111'); assert.equal(corrected.orderNo,'PO2026/S019');
  assert.equal(corrected.manualReviewRequired,undefined); assert.deepEqual(corrected.items,before.items);
  assert.equal(r.calls(),0,'Manual source parsing does not invoke a model');
});
