const test=require('node:test'),assert=require('node:assert/strict');
const {buildWorkbook}=require('../backend/services/exportInternal');
test('injection exports retain mold numbers and shift all cost formulas',async()=>{
 const wb=await buildWorkbook({quote:{qty:1000},sections:[{dept:'molding',payload_json:JSON.stringify({injection:[{qty:1,mold_no:'0012',name:'外壳',material:'ABS',weight_g:10,material_unit_price:0.02,shot_price:0.5,sets:2,target:1000}]})}]});
 for(const name of ['报价明细','啤机明细']){
 const ws=wb.getWorksheet(name);let h;ws.eachRow(r=>{if(r.getCell(1).value==='模号'&&r.getCell(2).value==='模具名称')h=r.number;});
 assert.ok(h);const r=h+1;assert.equal(ws.getCell(r,1).value,'0012');
 assert.equal(ws.getCell(r,7).formula,`E${r}*F${r}`);
 assert.equal(ws.getCell(r,9).formula,`1000/J${r}/L${r}`);
 assert.equal(ws.getCell(r,14).formula,`G${r}+I${r}`);
 assert.equal(ws.getCell(r+1,14).result,0.706);
 }
});
