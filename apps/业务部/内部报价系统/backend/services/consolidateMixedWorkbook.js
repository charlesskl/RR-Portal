'use strict';
const {groupMixedSheets,relocateFormula}=require('./groupMixedSheets');

// Keep one internal overview and the department detail tabs. Supporting inputs
// remain visible in the overview so formulas stay editable.
function consolidateMixedWorkbook(wb,quote) {
  // Usage is already part of each detail's cost formula. Inline the saved
  // multiplier before removing the redundant schedule, preserving non-unit usage.
  const usage=wb.getWorksheet('零件用量');
  if(usage){
    const cellFormulas=new Map();
    usage.eachRow(r=>{if(r.number>1){
      const value=r.getCell(3).value;
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('零件每款用量无效');
      cellFormulas.set('C'+r.number,String(value));
    }});
    const mapping=new Map([['零件用量',{name:'零件用量',offset:0,cellFormulas}]]);
    wb.eachSheet(s=>s.eachRow(r=>r.eachCell(c=>{
      if(c.formula){
        const formula=relocateFormula(c.formula,null,mapping);
        if(formula.includes('零件用量'))throw new Error('存在未处理的零件用量引用');
        c.value={formula,result:c.result};
      }
    })));
    wb.removeWorksheet(usage.id);
  }
  require('./inlineMixedCost').inlineMixedCost(wb);
  // Keep parameter dependencies intact without displaying the input appendix.
  const parameters=wb.getWorksheet('混装算价参数');
  if(parameters)parameters.state='veryHidden';
  const quotation=wb.getWorksheet('混装报价汇总');
  const classification=wb.getWorksheet('内部分类汇总');
  // The visible classification matrix owns NA inputs; all other calculations
  // consume those cells through the retained, hidden quotation calculation sheet.
  if(quotation&&classification){
    classification.eachRow(row=>row.eachCell(cell=>{
      const match=cell.formula?.match(/^'混装报价汇总'!(C\d+)$/);
      if(!match)return;
      const source=quotation.getCell(match[1]);
      const value=source.formula?source.result:source.value;
      cell.value=value;
      if(source.dataValidation?.type)cell.dataValidation=structuredClone(source.dataValidation);
      source.value={formula:`'内部分类汇总'!${cell.address}`,result:value};
    }));
    quotation.state='veryHidden';
  }
  const names=['内部分类汇总','总报价表','NA比例分摊成本'];
  const titles=['十、各小产品费用明细及合计','十一、出货价算价及减税汇总','附录：NA加权成本明细'];
  const blocks=names.map((name,i)=>({sheet:wb.getWorksheet(name),group:'内部总表',title:titles[i]})).filter(b=>b.sheet);
  const details=require('./mixedReferenceDetails').referenceDetails(wb,quote);
  const molds=details.find(b=>b.sheet.name==='总表模具源')?.sheet;
  blocks.unshift(...details.filter(b=>b.sheet!==molds));
  // Show labor inputs/results beside each unique part. Retain the original
  // calculation rows privately so stage ranges keep their exact membership.
  const labor=wb.getWorksheet('封穴啤工计算');
  const injection=details.find(b=>b.sheet.name==='总表啤机明细源')?.sheet;
  // Make the visible material weight/price/amount cells the calculation inputs.
  const molding=wb.getWorksheet('啤机明细');
  if(injection&&molding){
    const cells=new Map();
    for(let r=2;r<molding.rowCount;r++)for(const col of [4,5,6,7]){
      const source=molding.getCell(r,col),target=injection.getCell(r,col);
      cells.set(source.address,`'${injection.name}'!${target.address}`);
    }
    const mapping=new Map([[molding.name,{name:molding.name,offset:0,cellFormulas:cells}]]);
    for(let r=2;r<molding.rowCount;r++)for(const col of [4,5,6,7]){
      const source=molding.getCell(r,col),target=injection.getCell(r,col);
      target.value=source.formula?{formula:relocateFormula(source.formula,{name:molding.name,offset:0,qualifyLocal:true},mapping),result:source.result}:structuredClone(source.value);
    }
    // Resolve unqualified material references inside the copied formulas too.
    for(let r=2;r<molding.rowCount;r++)for(const col of [4,5,6,7]){
      const target=injection.getCell(r,col);
      if(target.formula)target.value={formula:relocateFormula(target.formula,null,mapping),result:target.result};
    }
    wb.eachSheet(s=>{if(s===injection)return;s.eachRow(r=>r.eachCell(c=>{
      if(c.formula)c.value={formula:relocateFormula(c.formula,null,mapping),result:c.result};
    }));});
    for(let r=2;r<molding.rowCount;r++)for(const col of [4,5,6,7]){
      const source=molding.getCell(r,col),target=injection.getCell(r,col);
      source.value={formula:`'${injection.name}'!${target.address}`,result:target.formula?target.result:target.value};
    }
  }
  if(labor&&injection){
    const key=(mold,part)=>JSON.stringify([String(mold||part||'').trim(),String(part||'').trim()]);
    const targets=new Map();
    injection.eachRow(r=>{if(r.number>1&&r.getCell(1).value!=='总合计'){
      const k=key(r.getCell(1).value,r.getCell(2).value);
      if(targets.has(k))throw Error('注塑零件存在重复模号及名称，无法对应啤工计算');
      targets.set(k,r.number);
    }});
    for(let col=3;col<=12;col++)injection.getCell(1,col+12).value=labor.getCell(1,col).value;
    labor.eachRow(r=>{
      if(r.number===1)return;
      const target=targets.get(key(r.getCell(1).value,r.getCell(2).value));
      if(!target)throw Error('啤工计算找不到对应注塑零件：'+r.getCell(2).value);
      for(let col=3;col<=12;col++){
        const source=r.getCell(col),dest=injection.getCell(target,col+12);
        dest.style=structuredClone(source.style);
        if(source.formula){dest.value={formula:`'${labor.name}'!${source.address}`,result:source.result};}
        else{
          const value=structuredClone(source.value);dest.value=value;
          if(source.dataValidation?.type)dest.dataValidation=structuredClone(source.dataValidation);
          source.value={formula:`'${injection.name}'!${dest.address}`,result:value};
        }
      }
    });
    labor.state='veryHidden';
  }
  if(molds){
    molds.name='模具报价';molds.orderNo=1;
    // Make the visible mold inputs authoritative; existing amortization formulas
    // continue to consume these cells through their original source addresses.
    const source=wb.getWorksheet('工程及单款汇总');
    molds.eachRow(row=>row.eachCell(cell=>{
      const match=cell.formula?.match(/^'工程及单款汇总'!([A-Z]+[0-9]+)$/);
      if(!match)return;
      const original=source.getCell(match[1]),value=original.value;
      cell.value=original.formula?{formula:relocateFormula(original.formula,{name:source.name,offset:0,qualifyLocal:true},new Map()),result:original.result}:structuredClone(value);
      original.value={formula:`'模具报价'!${cell.address}`,result:cell.formula?cell.result:cell.value};
    }));
  }
  const moves=groupMixedSheets(wb,blocks,{},quote?{'内部总表':{quote,label:'混装内部报价明细',width:Math.max(...blocks.map(b=>b.sheet.columnCount))}}:{});
  const main=wb.getWorksheet('内部总表');
  main.name='总报价表';main.orderNo=0;
  const rename=new Map([['内部总表',{name:main.name,offset:0}]]);
  if(labor){labor.name='内部啤工计算源';rename.set('封穴啤工计算',{name:labor.name,offset:0});}
  if(quotation){quotation.name='内部报价计算源';rename.set('混装报价汇总',{name:quotation.name,offset:0});}
  const engineering=wb.getWorksheet('工程及单款汇总');
  // Retain the formula dependencies as a non-visible calculation source.
  // The customer-facing mold tab contains only the extracted mold quotation.
  if(engineering){engineering.name='内部计算源';engineering.state='veryHidden';rename.set('工程及单款汇总',{name:'内部计算源',offset:0});}
  if(!quote)main.getCell('A1').value='混装内部总表 · 二、注塑部分';
  wb.eachSheet(ws=>ws.eachRow(row=>row.eachCell(c=>{
    if(c.formula)c.value={formula:relocateFormula(c.formula,null,rename),result:c.result};
  })));
  // Restore input validation, which belongs to the original editable cells.
  for(const block of blocks){
    const move=moves.get(block.sheet.name);
    block.sheet.eachRow(row=>row.eachCell(c=>{
      if(c.dataValidation?.type)main.getCell(row.number+move.offset,c.col).dataValidation=structuredClone(c.dataValidation);
    }));
  }
  // Show all content without outline levels or collapsed rows.
  main.eachRow({includeEmpty:true},row=>{row.outlineLevel=0;row.hidden=false;});
  main.properties.outlineLevelRow=0;
  main.getColumn(1).width=39;main.getColumn(2).width=25;
  for(let c=3;c<=main.columnCount;c++)main.getColumn(c).width=16;
  const pricing=moves.get('总报价表');
  main.getRow(pricing.offset+2).height=66;
  main.getCell(pricing.offset+27,2).value='NA比例直接在上方各小产品费用明细的NA比例列填写；运费与吊柜费在上方方案列调整。其他算价参数沿用网页保存值。';
  main.getRow(pricing.offset+27).height=54;
  main.views=[{state:'frozen',ySplit:0,xSplit:2}];
  main.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:${main.getColumn(main.columnCount).letter}${main.rowCount}`};
  require('./styleMixedWorkbook').styleMixedWorkbook(wb,blocks,moves);
  if(quote){const {styleMixedHeading}=require('./mixedHeading');styleMixedHeading(main);if(molds)styleMixedHeading(molds);}
  require('./visibleMixedFormulas').visibleMixedFormulas(wb);
  return moves;
}
module.exports={consolidateMixedWorkbook};
