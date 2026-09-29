'use strict';
const M=require('../../frontend/mixed-molds');
function addMixedClassification(wb, quote, result, keys, sections=[]) {
  const ws=wb.addWorksheet('内部分类汇总'),cost=wb.getWorksheet('小产品完整成本');
  const roots=Object.fromEntries(sections.map(s=>[s.dept,JSON.parse(s.payload_json||'{}')]));
  const eng=roots.engineering||{}, rates=roots.sales?.header||{};
  const items=[...result.products.map(p=>({p,breakdown:M.dynamicCostBreakdown(p.components,eng.mixed_products?.[p.id],rates)})),{p:{components:result.common_components},breakdown:M.dynamicCostBreakdown(result.common_components,eng.mixed_shared,rates)}];
  const columns=[['imp_mat','进口料'],['dom_mat','国内料'],['injection_labor','啤工'],['painting_labor','喷工'],['paint_material','油漆'],['assembly_labor','装工＋\n入纸袋／包装'],...Object.entries(items[0].breakdown.labels)];
  if(items.some(i=>Math.abs(i.breakdown.columns.other||0)>1e-10))columns.push(['other','其他费用']);
  const totalCol=columns.length+3,naCol=totalCol+1,weightedCol=totalCol+2;
  ws.columns=[{width:24},{width:34},...columns.map(()=>({width:16})),{width:20},{width:18},{width:22}];
  const letter=c=>ws.getColumn(c).letter;
  const lastCol=letter(weightedCol);
  ws.addRow(['各小产品费用明细（HKD）']);ws.mergeCells(`A1:${lastCol}1`);
  ws.addRow([`${quote.quote_no||''}  ${quote.product_name||''}`]);ws.mergeCells(`A2:${lastCol}2`);
  ws.addRow(['各分类为未乘NA的原始成本；右侧为成本×NA；共有费用每包装计一次。']);ws.mergeCells(`A3:${lastCol}3`);
  ws.addRow(['货号','品名',...columns.map(c=>c[1]),'成本合计 HKD','NA比例','NA比例后合计 HKD']);
  const source=(key,row)=>`'小产品完整成本'!${cost.getColumn(keys.indexOf(key)+3).letter}${row}`;
  function detail(item,index,shared=false){
    const {p,breakdown:b}=item,r=ws.addRow([shared?'共有费用':p.code,shared?'每包装共有项目':p.name]).number;
    const sr=index+2;
    columns.forEach(([key],i)=>{
      const c=ws.getCell(r,i+3),v=b.columns[key]||0;
      if(key==='box_libao') c.value=v;
      else if(key==='product_libao')c.value={formula:`${source('libao',sr)}-${letter(columns.findIndex(x=>x[0]==='box_libao')+3)}${r}`,result:v};
      else if(key==='other')c.value={formula:keys.filter(k=>k!=='abs_material').map(k=>source(k,sr)).join('+')+`-SUM(C${r}:${letter(i+2)}${r})`,result:v};
      else c.value={formula:source(key,sr),result:v};
    });
    ws.getCell(r,totalCol).value={formula:`SUM(C${r}:${letter(totalCol-1)}${r})`,result:b.total};
    ws.getCell(r,naCol).value=shared?'每包装一次':{formula:`'混装报价汇总'!C${sr}`,result:p.weight};
    ws.getCell(r,naCol).numFmt='0.00%';
    ws.getCell(r,weightedCol).value={formula:shared?`${letter(totalCol)}${r}`:`${letter(totalCol)}${r}*${letter(naCol)}${r}`,result:b.total*(shared?1:p.weight)};
    return r;
  }
  result.products.forEach((p,i)=>detail(items[i],i));
  const last=ws.rowCount;
  const subtotal=ws.addRow(['小产品合计',`${result.products.length}款，不含共有费用`]).number;
  const avg=ws.addRow(['全部小产品平均价（NA）','各款分类金额×NA比例，再求和']).number;
  const common=detail(items.at(-1),result.products.length,true);
  const combined=ws.addRow(['合计','NA平均价＋共有费用']).number;
  const refs={};
  for(let col=3;col<=weightedCol;col++){
    if(col===naCol)continue;
    const l=letter(col),sum=result.products.reduce((n,p,i)=>n+(col===weightedCol?items[i].breakdown.total*p.weight:col===totalCol?items[i].breakdown.total:items[i].breakdown.columns[columns[col-3][0]]||0),0);
    const weighted=result.products.reduce((n,p,i)=>n+(col>=totalCol?items[i].breakdown.total:items[i].breakdown.columns[columns[col-3][0]]||0)*p.weight,0);
    ws.getCell(subtotal,col).value={formula:`SUM(${l}5:${l}${last})`,result:sum};
    ws.getCell(avg,col).value={formula:col===weightedCol?`SUM(${l}5:${l}${last})`:`SUMPRODUCT(${l}5:${l}${last},${letter(naCol)}5:${letter(naCol)}${last})`,result:weighted};
    const shared=col>=totalCol?items.at(-1).breakdown.total:items.at(-1).breakdown.columns[columns[col-3][0]]||0;
    ws.getCell(combined,col).value={formula:`${l}${avg}*${result.config.na_direct?'1':"'混装算价参数'!$B$3"}+${l}${common}`,result:weighted*result.cost_units+shared};
  }
  for(const key of keys.filter(k=>k!=='abs_material')){
    const index=columns.findIndex(c=>c[0]===key);
    if(index>=0)refs[key]=`'内部分类汇总'!${letter(index+3)}${combined}`;
    else if(key==='libao')refs[key]=['product_libao','box_libao'].map(k=>`'内部分类汇总'!${letter(columns.findIndex(c=>c[0]===k)+3)}${combined}`).join('+');
    else refs[key]=`SUMPRODUCT('小产品完整成本'!${cost.getColumn(keys.indexOf(key)+3).letter}2:${cost.getColumn(keys.indexOf(key)+3).letter}${result.products.length+1},'混装报价汇总'!$C$2:$C$${result.products.length+1})*${result.config.na_direct?'1':"'混装算价参数'!$B$3"}+${source(key,result.products.length+2)}`;
  }
  ws.eachRow(r=>{r.height=30;r.eachCell(c=>{c.font={name:'Microsoft YaHei',size:11};c.alignment={vertical:'middle',wrapText:true};c.numFmt=typeof c.value==='string'?'@':(c.numFmt||'0.0000;-0.0000;;@');c.border={bottom:{style:'thin',color:{argb:'FFD6DFEA'}}};});});
  ws.getRow(4).height=48;
  for(const r of [1,4,subtotal,avg,common,combined]){ws.getRow(r).fill={type:'pattern',pattern:'solid',fgColor:{argb:r===1?'FF234E70':'FFE5EFF9'}};ws.getRow(r).font={name:'Microsoft YaHei',size:11,bold:true,color:{argb:r===1?'FFFFFFFF':'FF234E70'}};}
  ws.views=[{state:'frozen',ySplit:4,xSplit:2}];
  return refs;
}
module.exports={addMixedClassification};
