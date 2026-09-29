'use strict';
const {relocateFormula}=require('./groupMixedSheets');
// Continuous detail rows; expand old product subtotals into live detail formulas.
function compactMixedDetail(wb, name, moldNumber) {
 const source=wb.getWorksheet(name);if(!source)return;
 let header=0,current=null;const kept=[],rows=new Map(),owners=new Map(),subtotals=[];
 const finalOnly=['啤机明细','喷油明细'].includes(name);
 source.eachRow(row=>{
   const a=row.getCell(1).value;
   if(typeof a==='string' && a.includes(' · ') && row.getCell(1).isMerged){const split=a.indexOf(' · ');current=[a.slice(0,split),a.slice(split+3)];}
   if(!current)return;
   if(a==='序号'){if(!header)header=row.number;rows.set(row.number,1);if(name==='喷油明细')rows.set(row.number+1,1);return;}
   if(finalOnly && typeof a==='string' && /^合计/.test(a)){subtotals.push(row.number);return;}
   if(typeof a==='number'||(typeof a==='string'&&/^合计/.test(a))){kept.push(row.number);owners.set(row.number,current);}
 });
 if(!header)return;
 if(moldNumber){
   const key=r=>String(moldNumber(owners.get(r)[0],source.getCell(r,1).value)||'').trim();
   kept.sort((a,b)=>{const x=key(a),y=key(b);return x&&y?x.localeCompare(y,'en',{numeric:true}):x?-1:y?1:a-b;});
 }
 const dest=wb.addWorksheet(name+'整理');
 rows.set(header,1);kept.forEach((r,i)=>rows.set(r,i+2));
 const cellFormulas=new Map();
 for(const r of subtotals)source.getRow(r).eachCell(cell=>{if(cell.formula)cellFormulas.set(cell.address,moldNumber?cell.formula.replace(/SUM\((\$?[A-Z]+)\$?(\d+):\$?[A-Z]+\$?(\d+)\)/g,(_,col,start,end)=>'SUM('+Array.from({length:Number(end)-Number(start)+1},(_,i)=>col+(Number(start)+i)).join(',')+')'):cell.formula);});
 const move={name,rows,colOffset:2,cellFormulas};const mapping=new Map([[name,move]]);
 const copy=(r,target)=>source.getRow(r).eachCell((cell,c)=>{
   if(cell.isMerged&&cell.master.address!==cell.address)return;
   const out=dest.getCell(target,c+2);out.style=structuredClone(cell.style);
   out.value=cell.formula?{formula:relocateFormula(cell.formula,move,mapping),result:cell.result}:structuredClone(cell.value);
 });
 copy(header,1);
 if(name==='喷油明细'){
   let group='';
   for(let c=1;c<=source.columnCount;c++){
     const top=source.getCell(header,c).value,sub=source.getCell(header+1,c).value;
     if(typeof top==='string'&&top)group=top;
     if(sub==='数量'||sub==='单价')dest.getCell(1,c+2).value=group+' '+sub;
   }
 }
 dest.getCell('A1').value='货号';dest.getCell('B1').value='小产品名称';
 kept.forEach(r=>{const target=rows.get(r);copy(r,target);dest.getCell(target,1).value=owners.get(r)[0];dest.getCell(target,2).value=owners.get(r)[1];dest.getRow(target).height=26;});
 dest.getColumn(1).width=16;dest.getColumn(2).width=26;
 source.columns.forEach((col,i)=>{dest.getColumn(i+3).width=Math.max(col.width||14,14);});
 dest.getColumn(3).width=10;dest.getColumn(4).width=28;
 dest.getRow(1).height=38;dest.getRow(1).eachCell(c=>{c.font={name:'Microsoft YaHei',bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234E70'}};c.alignment={wrapText:true,vertical:'middle'};});
 dest.views=[{state:'frozen',xSplit:2,ySplit:1}];
 dest.autoFilter={from:{row:1,column:1},to:{row:dest.rowCount,column:source.columnCount+2}};
 if(finalOnly){
   const end=dest.rowCount,total=end+1,columns=new Set();
   for(const r of subtotals)source.getRow(r).eachCell((cell,col)=>{if(cell.formula)columns.add(col+2);});
   dest.getCell(total,1).value='总合计';dest.getCell(total,2).value='未乘NA比例';
   for(const col of columns){
     const letter=dest.getColumn(col).letter;
     const cached=kept.reduce((sum,r)=>{const cell=source.getCell(r,col-2);return sum+Number(cell.formula?cell.result||0:cell.value||0);},0);
     dest.getCell(total,col).value={formula:end>1?`SUM(${letter}2:${letter}${end})`:'0',result:cached};dest.getCell(total,col).numFmt='0.0000';
   }
   dest.getRow(total).height=28;dest.getRow(total).eachCell(c=>{c.font={name:'Microsoft YaHei',bold:true,color:{argb:'FF234E70'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE5EFF9'}};});
 }
 dest.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};
 for(const im of source.getImages()){
  const r=rows.get(im.range.tl.nativeRow+1);if(!r)continue;
  const anchor=a=>({nativeCol:a.nativeCol+2,nativeColOff:a.nativeColOff,nativeRow:(rows.get(a.nativeRow+1)||r)-1,nativeRowOff:a.nativeRowOff});
  dest.addImage(im.imageId,{...im.range,tl:anchor(im.range.tl),...(im.range.br?{br:anchor(im.range.br)}:{})});
 }
 wb.eachSheet(ws=>{if(ws===source||ws===dest)return;ws.eachRow(row=>row.eachCell(cell=>{if(cell.formula)cell.value={formula:relocateFormula(cell.formula,null,mapping),result:cell.result};}));});
 const order=source.orderNo;wb.removeWorksheet(source.id);dest.name=name;dest.orderNo=order;
}
module.exports={compactMixedDetail};
