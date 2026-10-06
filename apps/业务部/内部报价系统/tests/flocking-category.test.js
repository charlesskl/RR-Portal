const test=require('node:test'),assert=require('node:assert/strict');
const {calculateSingleQuoteCosts}=require('../backend/services/quoteCostSummary');
const {dynamicCostBreakdown}=require('../frontend/mixed-molds');
test('植绒独立计入分类与总成本，不重复进入其他外购',()=>{
 const eng={aux_materials:[{name:'植绒件',category:'植绒',qty:2,unit_price:3},{name:'外购件',category:'其他外购',qty:1,unit_price:4}],packaging_materials:[{category:'植绒',qty:1,unit_price:5}]};
 const sections=[{dept:'engineering',payload_json:JSON.stringify(eng)}];
 const result=calculateSingleQuoteCosts({qty:1},sections);
 assert.equal(result.components.flocking,11);
 assert.equal(result.components.other_buy,4);
 const breakdown=dynamicCostBreakdown(result.components,eng);
 assert.equal(breakdown.columns.flocking,11);
 assert.equal(breakdown.labels.flocking,'植绒');
 assert.equal(breakdown.total,15);
});
test('混装导出保留植绒列、金额与公式',async()=>{
 const {buildMixedWorkbook}=require('../backend/services/exportMixedQuotation');
 const p={sales:{mixed_quote:{enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'01',name:'01'},{id:'b',code:'02',name:'02'}]},header:{fx_rmb_hkd:.85,fx_hkd_usd:7.8},shipping:{markup_x:1,divisor:1},mixed_pricing:{surtax_pct:0}},engineering:{mixed_products:{b:{aux_materials:[{category:'其他外购',qty:1,unit_price:1}]},a:{aux_materials:[{category:'植绒',name:'植绒件',qty:2,unit_price:3}]}}}};
 const workbook=await buildMixedWorkbook({consolidate:false,quote:{qty:1,quote_no:'FLOCK',product_name:'植绒'},sections:Object.entries(p).map(([dept,payload])=>({dept,payload_json:JSON.stringify(payload)}))});
 let found=false;
 workbook.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell((cell,col)=>{
  if(cell.value==='植绒') {
   for(let offset=1;offset<=3;offset++) {
    const data=sheet.getCell(row.number+offset,col);
    if(data.result===6 && data.formula)found=true;
   }
  }
  assert.ok(!cell.formula?.includes('#REF!'));
 })));
 assert.ok(found,'植绒金额应有独立公式单元格');
});
