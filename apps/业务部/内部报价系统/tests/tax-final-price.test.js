const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWorkbook}=require('../backend/services/exportInternal');
test('tax goods price uses final USD including fees and surcharge, times divisor and HKD rate',async()=>{
 for(const customer of ['JAZWARES','TOMY']){
 const wb=await buildWorkbook({quote:{customer,qty:1000},sections:[{dept:'sales',payload_json:JSON.stringify({header:{fx_hkd_usd:7.75,fx_rmb_hkd:0.85},shipping:{markup_x:1.2,divisor:0.96,scenarios:[{name:'出厂价',is_factory:true},{name:'盐田40柜'}],customer_supplied_products:[{name:'成品',amount_usd:2}]}})}]});
 const ws=wb.getWorksheet('报价明细');let final,tax;
 ws.eachRow(r=>{if(r.getCell(1).value==='TOTAL (USD)')final=r.number;if(r.getCell(1).value==='一、出厂货价核')tax=r.number+2;});
 const cell=ws.getCell(tax,1).value;
 assert.equal(cell.formula,`C${final}*7.75*0.96`);
 assert.ok(Math.abs(cell.result-(2+2*0.004*1.2/0.96)*0.96*7.75)<1e-10);
 }
});
