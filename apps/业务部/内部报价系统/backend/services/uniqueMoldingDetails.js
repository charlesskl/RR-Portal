'use strict';
const {relocateFormula}=require('./groupMixedSheets');
function uniqueMoldingDetails(wb,parts){
 const source=wb.getWorksheet('啤机明细');if(!source||!parts.size)return;
 const dest=wb.addWorksheet('注塑零件源'),rows=new Map([[1,1]]),unique=new Map(),owners=[];
 for(const [r,p] of parts){
  const key=p.catalog_part_id||JSON.stringify([p.mold_no,p.name,p.material,p.catalog_raw_weight,p.material_unit_price]);
  if(!unique.has(key)){unique.set(key,owners.length+2);owners.push([r,p]);}
  rows.set(r,unique.get(key));
 }
 rows.set(source.rowCount,owners.length+2);
 const plain={name:dest.name,rows,colOffset:-2},mapping=new Map([[source.name,plain]]);
 const copy=(r,t)=>source.getRow(r).eachCell((c,col)=>{if(col<3)return;const d=dest.getCell(t,col-2);d.style=structuredClone(c.style);d.value=c.formula?{formula:relocateFormula(c.formula,plain,mapping),result:c.result}:structuredClone(c.value);});
 source.columns.slice(2).forEach((c,i)=>{dest.getColumn(i+1).width=c.width||16;});
 copy(1,1);dest.getCell('A1').value='模号';dest.getCell('B1').value='零件名称';
 owners.forEach(([r,p])=>{
  const t=rows.get(r),usage=Number(p.catalog_usage??1);copy(r,t);
  if(!(usage>0))throw Error('零件用量无效');
  for(const col of [4,9]){const c=dest.getCell(t,col),v=c.formula?c.result:c.value;c.value=c.formula?{formula:`(${c.formula})/${usage}`,result:Number(v)/usage}:Number(v)/usage;}
  // Refresh caches for the usage-scaled derived costs; Excel retains live formulas.
  for(const col of [5,7,14]){const c=dest.getCell(t,col);if(c.formula)c.value={formula:c.formula,result:Number(c.result||0)/usage};else if(typeof c.value==='number')c.value/=usage;}
 });
 const expanded=new Map();
 for(const [r,p] of parts){const usage=Number(p.catalog_usage??1);for(const col of [6,7,9,11,16]){const from=source.getCell(r,col).address,to=dest.getCell(rows.get(r),col-2).address;expanded.set(from,`'${dest.name}'!${to}*${usage}`);}}
 const external=new Map([[source.name,{...plain,cellFormulas:expanded}]]);
 wb.eachSheet(s=>{if(s===source||s===dest)return;s.eachRow(r=>r.eachCell(c=>{if(c.formula)c.value={formula:relocateFormula(c.formula,null,external),result:c.result};}));});
 const total=owners.length+2;dest.getCell(total,1).value='总合计';dest.getCell(total,2).value='零件单价合计';
 for(const col of [7,9,14]){const l=dest.getColumn(col).letter;dest.getCell(total,col).value={formula:`SUM(${l}2:${l}${total-1})`,result:owners.reduce((n,[r])=>n+Number(dest.getCell(rows.get(r),col).result??dest.getCell(rows.get(r),col).value??0),0)};}
 const order=source.orderNo;wb.removeWorksheet(source.id);dest.name='啤机明细';dest.orderNo=order;
 const rename=new Map([['注塑零件源',{name:dest.name,offset:0}]]);
 wb.eachSheet(s=>s.eachRow(r=>r.eachCell(c=>{if(c.formula)c.value={formula:relocateFormula(c.formula,null,rename),result:c.result};})));
}
module.exports={uniqueMoldingDetails};
