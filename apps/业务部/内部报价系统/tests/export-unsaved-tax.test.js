const test=require('node:test'),assert=require('node:assert/strict');
const {buildWorkbook}=require('../backend/services/exportXlsx');
test('未保存减税汇总也导出成本及减税公式，并保留加宽K列',async()=>{
 const sales={header:{fx_rmb_hkd:1,fx_hkd_usd:7.8},shipping:{markup_x:1,divisor:1}};
 const w=await buildWorkbook({quote:{id:1,quote_no:'TAX',product_name:'test',qty:1},sections:[{dept:'sales',payload_json:JSON.stringify(sales)},{dept:'engineering',payload_json:JSON.stringify({aux_materials:[{name:'植绒',category:'植绒',qty:2,unit_price_rmb:3}]})}]});
 const ws=w.worksheets[0];
 const labels=[];ws.eachRow(r=>labels.push(r.getCell(1).value));
 assert.ok(labels.includes('十二、减税明细 / 成本汇总'));
 assert.ok(labels.includes('四、减税明细'));
 let flock;
 ws.eachRow(r=>r.eachCell((c,i)=>{if(c.value==='植绒')flock=ws.getCell(r.number+1,i);}));
 assert.ok(flock.formula);assert.equal(flock.result,6);
 let total;ws.eachRow(r=>{if(r.getCell(1).value==='合计减税')total=r;});
 assert.ok(total,'合计减税汇总行存在');
 assert.equal(ws.getColumn(11).width,20);
 assert.equal(sales.pricing_summary,undefined);
});
for (const summary of [undefined, {}, {t1:{},t2:{},t3:{},t4:{}}]) {
 test(`内部完整导出固定保留减税区：${summary===undefined?'未保存':JSON.stringify(summary)}`,async()=>{
  const {buildWorkbook:buildInternal}=require('../backend/services/exportInternal');
  const wb=await buildInternal({quote:{id:1,quote_no:'TAX',product_name:'test',qty:1},sections:[{dept:'sales',payload_json:JSON.stringify({pricing_summary:summary})}]});
  const values=[];wb.worksheets[0].eachRow(r=>r.eachCell(c=>values.push(c.value)));
  assert.ok(values.includes('四、减税明细'));
  assert.ok(values.includes('合计减税'));
  assert.ok(values.includes('减税后成本'));
 });
}
test('混装完整导出未保存减税汇总仍含减税区',async()=>{
 const {buildWorkbook:buildInternal}=require('../backend/services/exportInternal');
 const payloads={sales:{mixed_quote:{enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'01',name:'01'},{id:'b',code:'02',name:'02'}]}},engineering:{mixed_products:{a:{aux_materials:[{name:'A',category:'植绒',qty:1,unit_price:3}]},b:{aux_materials:[{name:'B',category:'其他外购',qty:1,unit_price:2}]}}}};
 const wb=await buildInternal({quote:{quote_no:'MIX-TAX',qty:1},sections:Object.entries(payloads).map(([dept,payload])=>({dept,payload_json:JSON.stringify(payload)}))});
 const values=[];wb.getWorksheet('总报价表').eachRow(r=>r.eachCell(c=>values.push(c.value)));
 assert.ok(values.includes('四、减税明细'));
 assert.ok(values.includes('减税后成本'));
});
