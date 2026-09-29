'use strict';
const {relocateFormula}=require('./groupMixedSheets');
// The web-style matrix replaces the old cost schedule. Retain live references
// to department details rather than a second copy of the cost table.
function inlineMixedCost(wb){
 const cost=wb.getWorksheet('小产品完整成本');if(!cost)return;
 const cells=new Map();
 cost.eachRow(r=>r.eachCell(c=>{
   if(c.formula)cells.set(c.address,c.formula);
   else if(typeof c.value==='number')cells.set(c.address,String(c.value));
   else if(r.number>1&&c.col>2&&c.value==null)cells.set(c.address,'0');
 }));
 const mapping=new Map([[cost.name,{name:cost.name,offset:0,cellFormulas:cells}]]);
 wb.eachSheet(s=>{if(s===cost)return;s.eachRow(r=>r.eachCell(c=>{
  if(!c.formula||!c.formula.includes('小产品完整成本'))return;
  let f=c.formula.replace(/SUMPRODUCT\('小产品完整成本'!\$?([A-Z]+)\$?(\d+):\$?\1\$?(\d+),'混装报价汇总'!\$?C\$?(\d+):\$?C\$?(\d+)\)/g,(_,col,start,end,ws,we)=>{
   if(Number(end)-Number(start)!==Number(we)-Number(ws))throw Error('成本加权范围不一致');
   return '('+Array.from({length:Number(end)-Number(start)+1},(_,i)=>`('小产品完整成本'!${col}${Number(start)+i}*'混装报价汇总'!C${Number(ws)+i})`).join('+')+')';
  });
  f=relocateFormula(f,null,mapping);
  if(f.includes('小产品完整成本'))throw Error('成本明细存在未迁移的引用：'+c.address);
  if(f.length>8192)throw Error('替换后的成本公式过长：'+c.address);
  c.value={formula:f,result:c.result};
 }));});
 wb.removeWorksheet(cost.id);
}
module.exports={inlineMixedCost};
