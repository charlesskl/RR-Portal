'use strict';
// Same categories and deduction rates as the single-product internal template.
function addMixedTax(ws,result,refs,priceRef,options={}){
 const make=(f,v)=>({formula:f,result:v}), val=k=>(result.common_components[k]||0)+result.products.reduce((n,p)=>n+(p.components[k]||0)*p.weight*result.cost_units,0);
 const components=Object.fromEntries(Object.keys(refs).map(k=>[k,make(refs[k],val(k))]));
 components.freight=make(options.freightRef||"'混装算价参数'!B10",result.components.freight);
 components.cabinet=make(options.cabinetRef||"'混装算价参数'!B11",result.components.cabinet);
 if(options.miscFormula)components.misc=make(options.miscFormula,val('misc')+(options.surtaxHkd||0));
 const section=name=>{ws.addRow([]);const r=ws.addRow([name]).number;ws.mergeCells(r,1,r,12);ws.getRow(r).font={bold:true,name:'Microsoft YaHei',size:12,color:{argb:'FF234E70'}};};
 const block=(title,cols)=>{section(title);const h=ws.addRow(cols.map(c=>c[0]));h.height=42;h.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDCEAF4'}};h.font={bold:true,name:'Microsoft YaHei',size:11};const r=ws.addRow(cols.map(c=>c[1])).number;return Object.fromEntries(cols.map((c,i)=>[c[2]||c[0],{ref:ws.getColumn(i+1).letter+r,v:typeof c[1]==='object'?c[1].result:c[1]}]));};
 const select=entries=>entries.map(([label,key])=>[label,components[key],key]);
 section('减税明细 / 成本汇总');
 const a=block('一、出厂货价核',[['货价',make(priceRef,result.final_hkd),'price'],...select([['进口料','imp_mat'],['国内料','dom_mat'],['吹气','blow'],['搪胶','slush'],['车发','sewing_hair'],['车衣','sewing_cloth'],['五金','hardware'],['电子','electronic'],['马达','motor'],['吸塑','suction'],['胶袋','glue_bag']])]);
 const b=block('二、包装 / 外购',[['彩盒/内咭',components.color_box,'color_box'],['未减税前码数',0,'before'],['减税后码数',0,'after'],...select([['电池','battery'],['利宝','libao'],['电镀','plating'],['植绒','flocking'],['其他外购','other_buy'],['纸箱','carton'],['运费','freight'],['吊柜费','cabinet'],['杂项','misc']])]);
 const laborKeys=['injection_labor','painting_labor','assembly_labor'];
 const all=Object.keys(components), cost=all.reduce((n,k)=>n+components[k].result,0),labor=laborKeys.reduce((n,k)=>n+val(k),0),non=cost-labor,price=result.final_hkd;
 const nonRefs=all.filter(k=>!laborKeys.includes(k)).map(k=>'('+components[k].formula+')').join('+');
 const c=block('三、人工 & 成本汇总',[...select([['啤工','injection_labor'],['喷油工','painting_labor'],['油漆','paint_material'],['装配工','assembly_labor']]),['不含人工成本',make(nonRefs,non),'non'],['人工比例',make(`IFERROR((${laborKeys.map(k=>'('+refs[k]+')').join('+')})/${a.price.ref},0)`,price?labor/price:0),'laborRate'],['毛利',make(`${a.price.ref}-(${nonRefs})`,price-non),'gross'],['毛利率',make(`IFERROR((${a.price.ref}-(${nonRefs}))/${a.price.ref},0)`,price?(price-non)/price:0),'grossRate'],['利润',make(`${a.price.ref}-(${all.map(k=>'('+components[k].formula+')').join('+')})`,price-cost),'profit'],['利润率',make(`IFERROR((${a.price.ref}-(${all.map(k=>'('+components[k].formula+')').join('+')}))/${a.price.ref},0)`,price?(price-cost)/price:0),'profitRate'],['总成本',make(all.map(k=>'('+components[k].formula+')').join('+'),cost),'cost']]);
 // Use the visible cost cells, matching the single-product calculation chain.
 const nonLaborCells=[...Object.entries(a).filter(([k])=>k!=='price').map(([,v])=>v),
   ...Object.entries(b).filter(([k])=>!['before','after'].includes(k)).map(([,v])=>v)];
 const nonFormula=[...nonLaborCells.map(v=>v.ref),c.paint_material.ref].join('+');
 ws.getCell(c.non.ref).value=make(nonFormula,non);
 const laborFormula=[c.injection_labor.ref,c.painting_labor.ref,c.assembly_labor.ref].join('+');
 ws.getCell(c.cost.ref).value=make(`${c.non.ref}+${laborFormula}`,cost);
 ws.getCell(c.laborRate.ref).value=make(`IFERROR((${laborFormula})/${a.price.ref},0)`,price?labor/price:0);
 ws.getCell(c.gross.ref).value=make(`${a.price.ref}-${c.non.ref}`,price-non);
 ws.getCell(c.grossRate.ref).value=make(`IFERROR(${c.gross.ref}/${a.price.ref},0)`,price?(price-non)/price:0);
 ws.getCell(c.profit.ref).value=make(`${a.price.ref}-${c.cost.ref}`,price-cost);
 ws.getCell(c.profitRate.ref).value=make(`IFERROR(${c.profit.ref}/${a.price.ref},0)`,price?(price-cost)/price:0);
 for(const k of ['laborRate','grossRate','profitRate'])ws.getCell(c[k].ref).numFmt='0.00%';
 ws.getCell(b.before.ref).value=make(`IFERROR(${a.price.ref}/${c.cost.ref},0)`,cost?price/cost:0);
 const taxable=['dom_mat','hardware','motor','color_box','battery','libao','flocking','other_buy','paint_material','glue_bag'];
 const visible={...a,...b,...c};
 const amount=k=>make(visible[k].ref,components[k].result);
 const tax13=make(taxable.map(k=>visible[k].ref).join('+'),taxable.reduce((n,k)=>n+components[k].result,0));
 const taxes=[['含税13%类成本',tax13,null],['纸箱类',amount('carton'),.1],['含税1%',amount('plating'),.0099],['搪胶类3%',amount('slush'),.03],['车发类13%',amount('sewing_hair'),.115],['车衣类13%',amount('sewing_cloth'),.115],['吸塑类6%',amount('suction'),.06],['运费类9%',amount('freight'),.0826],['含税13%类',tax13,.115]];
 section('四、减税明细');const h=ws.addRow([...taxes.map(t=>t[0]),'合计减税']);h.height=42;h.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDCEAF4'}};
 const amounts=ws.addRow(taxes.map(t=>t[1])).number;
 // The first 13% column is a reference only; share its base without a second deduction.
 ws.getCell(amounts,9).value=make(`A${amounts}`,tax13.result);
 const rates=ws.addRow([...taxes.map(t=>t[2]),'税率 %']).number;
 const deduction=ws.addRow(taxes.map((t,i)=>t[2]===null?'—':make(`${ws.getColumn(i+1).letter}${amounts}*${ws.getColumn(i+1).letter}${rates}`,t[1].result*t[2]))).number;
 const ded=taxes.reduce((n,t)=>n+t[1].result*(t[2]||0),0);ws.getCell(deduction,10).value=make(`SUM(B${deduction}:I${deduction})`,ded);
 for(let i=2;i<=9;i++)ws.getCell(rates,i).numFmt='0.00%';
 ws.getCell(b.after.ref).value=make(`IFERROR(${a.price.ref}/(${c.cost.ref}-J${deduction}),0)`,cost!==ded?price/(cost-ded):0);
 ws.addRow([]);
 for(const [label,f,v,pct] of [['合计减税',`J${deduction}`,ded],['减税后成本',`${c.cost.ref}-J${deduction}`,cost-ded],['减税后毛利',`${c.gross.ref}+J${deduction}`,price-non+ded],['减税后毛利率',`IFERROR((${c.gross.ref}+J${deduction})/${a.price.ref},0)`,price?(price-non+ded)/price:0,true],['减税后利润',`${c.profit.ref}+J${deduction}`,price-cost+ded],['减税后利润率',`IFERROR((${c.profit.ref}+J${deduction})/${a.price.ref},0)`,price?(price-cost+ded)/price:0,true]]){
 const r=ws.addRow([label]).number;ws.mergeCells(r,1,r,6);ws.mergeCells(r,7,r,10);ws.getCell(r,7).value=make(f,v);ws.getCell(r,7).numFmt=pct?'0.00%':'0.0000';ws.getRow(r).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE5EFF9'}};
 }
 ws.eachRow(r=>{r.height=r.height||28;r.eachCell(cell=>{cell.numFmt=cell.numFmt||'0.0000';cell.alignment={vertical:'middle',wrapText:true};cell.font=cell.font?.name?cell.font:{name:'Microsoft YaHei',size:11};});});
}
module.exports={addMixedTax};
