'use strict';
const {projectSections}=require('./mixedQuotation');
const M=require('../../frontend/mixed-molds');
const ref=(sheet,cell)=>"'"+sheet.replace(/'/g,"''")+"'!"+cell;
const formula=(formula,result)=>({formula,result});
function style(ws){
  ws.views=[{state:'frozen',ySplit:1}];
  ws.columns.forEach((c,i)=>c.width=i<2?26:18);
  ws.eachRow(r=>r.eachCell(c=>{c.numFmt='0.0000';c.font={name:'Microsoft YaHei',size:10};c.border={bottom:{style:'thin',color:{argb:'FFD6DFEA'}}};}));
  ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};
}
async function addTemplateDetails(wb,args,result){
 const roots=Object.fromEntries(args.sections.map(s=>[s.dept,JSON.parse(s.payload_json||'{}')]));
 const root=M.engineeringCatalog(roots.molding||{},roots.engineering);
 if(!root.parts_catalog) M.enableCatalog(root,result.config,args.quote.qty);
 const resolved=M.catalogRows(root,result.config,args.quote.qty).resolved;
 const params=wb.addWorksheet('混装算价参数');
 params.addRows([['参数','数值'],['出货包装数量',args.quote.qty],['每包装小产品数量',result.units_per_pack],['主体码点',result.pricing.markup],['车缝码点',roots.sales.shipping?.sew_markup_x??result.pricing.markup],['电子码点',roots.sales.shipping?.elec_markup_x??result.pricing.markup],['找数',result.pricing.divisor],['HKD/USD',result.pricing.fx],['附加税 %',result.pricing.surtax_pct],['每包装运费 HKD',result.components.freight],['每包装吊柜费 HKD',result.components.cabinet],['额外摊费 USD',result.amortization_usd]]);
 const scenario=result.freight_scenarios.find(s=>s.key===result.selected_container);
 const carton=roots.engineering?.carton_calc||{};
 const fc=roots.sales.freight_calc||{};
 const capKey={yt40:'cap_40',hk40:'cap_40',yt20:'cap_20',hk20:'cap_20',yt5t:'cap_5t',hk5t:'cap_5t',yt10t:'cap_10t',hk10t:'cap_10t'}[result.selected_container];
 params.addRows([['所选货柜',result.selected_container],['每箱 CUFT',Number(carton.cuft||0)],['每箱包装数',Number(carton.qty||1)],['货柜容量 CUFT',Number(fc[capKey]||0)],['整柜费用 HKD',Number(fc[result.selected_container]||0)],['运费占比 %',roots.sales.shipping?.freight_pct??48],['吊柜费占比 %',roots.sales.shipping?.lifting_pct??52]]);
 if(result.selected_container!=='factory' && Number(carton.cuft)>0){
   params.getCell('B10').value=formula('B17/MAX(ROUND(B16/B14,0),1)/B15*B18/100',result.components.freight);
   params.getCell('B11').value=formula('B17/MAX(ROUND(B16/B14,0),1)/B15*B19/100',result.components.cabinet);
 }
 params.getCell('B12').value=Number(roots.sales.mixed_pricing?.amortization_usd||0);
 const summary=wb.worksheets[0];
 const bom=wb.addWorksheet('零件用量');
 bom.addRow(['小产品','零件标识','每款用量']);
 const usageRefs=new Map();
 for(const [id,refs] of Object.entries(root.parts_catalog.selections||{}))for(const r of refs){
   const n=bom.rowCount+1;
   bom.addRow([id==='__shared__'?'共有费用':result.products.find(p=>p.id===id)?.code,r.part_id,r.usage]);
   usageRefs.set(id+':'+r.part_id,ref(bom.name,'C'+n));
 }
 const labor=wb.addWorksheet('封穴啤工计算');
 labor.addRow(['模号','零件','日费用 HKD','日产啤次','出模数','需求量（手填）','完成啤次','阶段每穴费用','累计啤工 HKD','每件啤工 HKD','每啤价 HKD','上一阶段完成啤次']);
 const groups=new Map(), laborRefs=new Map();
 for(const part of root.parts_catalog.parts){const key=String(part.mold_no||'').trim()||part.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(part);}
 for(const [key,parts] of groups){
   const start=labor.rowCount+1,end=start+parts.length-1;
   const cycles='$G$'+start+':$G$'+end,cav='$E$'+start+':$E$'+end,stage='$H$'+start+':$H$'+end;
   parts.forEach((part,i)=>{
     const r=start+i,v=resolved.get(part.id),target=Number(part.target||root.mixed_molds?.find(m=>m.mold_no===key)?.target);
     const cycle=v.labor_demand/part.cavity;
     const allCycles=parts.map(p=>resolved.get(p.id).labor_demand/p.cavity);
     const previous=Math.max(0,...allCycles.filter(n=>n<cycle));
     const active=parts.reduce((n,p,j)=>n+(allCycles[j]>=cycle?Number(p.cavity):0),0);
     const stageCache=cycle?(cycle-previous)*v.shot_cost/active/allCycles.filter(n=>n===cycle).length:0;
     labor.addRow([part.mold_no||part.name,part.name,v.shot_cost*target,target,part.cavity,
       Number(v.labor_demand),
       formula('F'+r+'/E'+r,v.labor_demand/part.cavity),
       formula('IF(G'+r+'=0,0,(G'+r+'-L'+r+')*K'+r+'/SUMIF('+cycles+',">="&G'+r+','+cav+')/COUNTIF('+cycles+',G'+r+'))',stageCache),
       formula('SUMIF('+cycles+',"<="&G'+r+','+stage+')*E'+r,v.shot_price*v.labor_demand),
       formula(v.direct_labor ? 'K'+r+'/E'+r : 'IFERROR(I'+r+'/F'+r+',0)',v.shot_price),
       formula('C'+r+'/D'+r,v.shot_cost),
       formula('MAX(0,'+parts.map((_,j)=>'IF(G'+(start+j)+'<G'+r+',G'+(start+j)+',0)').join(',')+')',previous)]);
     laborRefs.set(part.id,ref(labor.name,'J'+r));
   });
 }
 // Copy each original single-product workbook, retaining styles, formulas, print layout and images.
 const products=[...result.products.map(p=>({id:p.id,code:p.code,name:p.name,item:p})),{id:'__shared__',code:'共有',name:'每包装共有项目'}];
 const outputs=new Map(),blocks=[],injectionByProduct=new Map();
 for(let index=0;index<products.length;index++){
   const p=products[index],sections=projectSections(args.sections,p.id,args.quote.qty);
   const sales=sections.find(s=>s.dept==='sales');
   const sp=JSON.parse(sales.payload_json);sp.header ||= {};sp.header.fx_hkd_usd=result.pricing.fx;sp.shipping={...sp.shipping,scenarios:[],surtax_pct:0};sp.pricing_summary={surtax:0};sales.payload_json=JSON.stringify(sp);
   const source=await require('./exportInternal').buildWorkbook({quote:{...args.quote,quote_no:p.code,product_name:p.name},sections});
   const names=new Map(source.worksheets.map((ws,i)=>[ws.name,(String(index+1).padStart(2,'0')+'-'+p.code+'-'+ws.name).replace(/[\\/*?:\[\]]/g,'_').slice(0,31)]));
   const images=new Map();(source.model.media||[]).forEach((img,i)=>images.set(i,wb.addImage(img)));
   const copies=[];
   for(const sheet of source.worksheets){
     const dest=wb.addWorksheet(names.get(sheet.name));const model=sheet.model;
     dest.model={...model,id:dest.id,name:dest.name,media:(model.media||[]).map(m=>({...m,imageId:images.get(m.imageId)??m.imageId}))};
     dest.eachRow(row=>row.eachCell(cell=>{
       const val=cell.value;
       if(val?.formula){let f=val.formula;for(const [old,next] of names){f=f.split("'"+old+"'!").join("'"+next+"'!").split(old+'!').join("'"+next+"'!");}cell.value={formula:f,result:val.result};}
     }));
     copies.push(dest);
     blocks.push({sheet:dest,group:sheet.name==='报价明细'?'工程及单款汇总':sheet.name,title:p.code+' · '+p.name});
   }
   const injection=JSON.parse(sections.find(s=>s.dept==='molding')?.payload_json||'{}').injection||[];
   injectionByProduct.set(p.code,injection);
   for(const sheet of copies){
     let priceCol=0,nameCol=0;
     sheet.eachRow(row=>{
       row.eachCell((cell,c)=>{if(typeof cell.value==='string' && /^啤价 HK/.test(cell.value))priceCol=c;if(cell.value==='模具名称')nameCol=c;});
       if(!priceCol||!nameCol)return;
       const part=injection.find(x=>x.name===row.getCell(nameCol).value);
       if(part?.catalog_part_id){const link=laborRefs.get(part.catalog_part_id),usage=usageRefs.get(p.id+':'+part.catalog_part_id);if(link&&usage)row.getCell(priceCol).value=formula(link+'*'+usage,part.shot_price);}
     });
   }
   const main=copies[0],cells={},amortRefs=[];
   main.eachRow(row=>{
     const label=String(row.getCell(6).value||'');
     if(/^(模费按|手板费分摊|测试费分摊)/.test(label) && row.getCell(10).value?.formula) amortRefs.push(ref(main.name,row.getCell(10).address));
     const a=row.getCell(1).value;
     const mapping=a==='货价'?{imp_mat:2,dom_mat:3,blow:4,slush:5,sewing_hair:6,sewing_cloth:7,hardware:8,electronic:9,motor:10,suction:11,glue_bag:12}
       :a==='彩盒/内咭'?{color_box:1,battery:4,libao:5,plating:6,other_buy:7,carton:8,misc:11}
       :a==='啤工'?{injection_labor:1,painting_labor:2,paint_material:3,assembly_labor:4}:null;
     if(mapping)for(const [key,col] of Object.entries(mapping))cells[key]=ref(main.name,main.getCell(row.number+1,col).address);
   });
   const keys=Object.keys(p.item?.components||result.common_components).filter(k=>!['abs_material','freight','cabinet'].includes(k));
   const missing=keys.filter(k=>!cells[k]&&Math.abs((p.item?.components||result.common_components)[k]||0)>1e-10);
   if(missing.length)throw new Error(p.code+' 模板缺少公式引用：'+missing.join(','));
   const costSheet=wb.getWorksheet('小产品完整成本');
   if(costSheet)Object.keys(require('./exportMixedQuotation').labels).forEach((key,i)=>{
     if(cells[key])costSheet.getCell(index+2,i+3).value=formula(cells[key],(p.item?.components||result.common_components)[key]||0);
   });
   const r=main.rowCount+3,comps=p.item?.components||result.common_components;
   main.getCell(r,1).value='混装汇总引用（USD）';
   const mainRefs=keys.filter(k=>!['sewing_hair','sewing_cloth','electronic'].includes(k)).map(k=>cells[k]||'0');
   const f='(('+mainRefs.join('+')+')*'+ref(params.name,'B4')+'+('+[cells.sewing_hair||'0',cells.sewing_cloth||'0'].join('+')+')*'+ref(params.name,'B5')+'+('+ (cells.electronic||'0')+')*'+ref(params.name,'B6')+')/'+ref(params.name,'B7')+'/'+ref(params.name,'B8');
   main.getCell(r,2).value=formula(f,(Object.entries(comps).reduce((n,[k,v])=>n+(['abs_material','freight','cabinet','sewing_hair','sewing_cloth','electronic'].includes(k)?0:v),0)*result.pricing.markup+(comps.sewing_hair+comps.sewing_cloth)*(sp.shipping.sew_markup_x??result.pricing.markup)+comps.electronic*(sp.shipping.elec_markup_x??result.pricing.markup))/result.pricing.divisor/result.pricing.fx);
   main.getCell(r+1,1).value='模具、手办及测试摊费 USD';main.getCell(r+1,2).value=formula(amortRefs.join('+')||'0',p.item?.amortization_usd??result.amortization_usd-Number(roots.sales.mixed_pricing?.amortization_usd||0));
   if(costSheet){const col=Object.keys(require('./exportMixedQuotation').labels).length+3;costSheet.getCell(1,col).value='模具、手办及测试摊费 USD';costSheet.getCell(index+2,col).value=formula(ref(main.name,'B'+(r+1)),p.item?.amortization_usd??result.amortization_usd-Number(roots.sales.mixed_pricing?.amortization_usd||0));}
   main.getCell(r+2,1).value='本款合计 USD'; main.getCell(r+2,2).value=formula('B'+r+'+B'+(r+1),p.item?.price_usd??result.common_usd-result.freight_hkd*result.pricing.markup/result.pricing.divisor/result.pricing.fx-Number(roots.sales.mixed_pricing?.amortization_usd||0));
   outputs.set(p.id,ref(main.name,'B'+(r+2)));
 }
 result.products.forEach((p,i)=>{summary.getCell(i+2,5).value=formula(outputs.get(p.id),p.price_usd);summary.getCell(i+2,4).value=formula('E'+(i+2)+'*'+ref(params.name,'B8'),p.price_hkd);});
 const avg=result.products.length+3;
 summary.getCell(avg+1,2).value=result.config.na_direct ? 1 : formula(ref(params.name,'B3'),result.units_per_pack);
 summary.getCell(avg+2,2).value=formula(outputs.get('__shared__')+'+('+ref(params.name,'B10')+'+'+ref(params.name,'B11')+')*'+ref(params.name,'B4')+'/'+ref(params.name,'B7')+'/'+ref(params.name,'B8')+'+'+ref(params.name,'B12'),result.common_usd);
 summary.getCell(avg+3,2).value=formula('(B'+avg+'*B'+(avg+1)+'+B'+(avg+2)+')*'+ref(params.name,'B9')+'/100*'+ref(params.name,'B4')+'/'+ref(params.name,'B7'),result.surcharge_usd);
 summary.getCell(avg+5,2).value=formula('B'+(avg+4)+'*'+ref(params.name,'B8'),result.final_hkd);
 for(const ws of [params,bom,labor])style(ws);
 for(let row=2;row<=labor.rowCount;row++){
   const cell=labor.getCell(row,6);
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
   cell.dataValidation={type:'decimal',operator:'greaterThanOrEqual',formulae:[0],allowBlank:false,showErrorMessage:true,errorTitle:'需求量无效',error:'请输入大于或等于0的需求量'};
 }
 labor.getColumn(6).width=23;
 for(const name of ['共模啤价分摊','共模生产阶段']){const ws=wb.getWorksheet(name);if(ws)wb.removeWorksheet(ws.id);}
 const summaries={};
 const deptMap={'工程及单款汇总':'engineering','电子明细':'electronic','车缝明细':'sewing','装配明细':'assembly','啤机明细':'molding','吹气明细':'blow','喷油明细':'painting','搪胶明细':'slush'};
 const {labels,deptKeys}=require('./exportMixedQuotation');
 const costSheet=wb.getWorksheet('小产品完整成本');
 for(const [name,dept] of Object.entries(deptMap)){
   const keys=deptKeys[dept];
   summaries[name]=[['货号','小产品名称','部门费用 HKD（未乘NA）','NA比例','NA后金额 HKD'],...products.map((p,i)=>{
     const c=p.item?.components||result.common_components;
     const amount=keys.reduce((n,k)=>n+(c[k]||0),0),r=i+2;
     const terms=keys.map(k=>ref(costSheet.name,costSheet.getCell(r,Object.keys(labels).indexOf(k)+3).address));
     return [p.code,p.name,formula(terms.join('+'),amount),p.item?formula(ref(summary.name,'C'+r),p.item.weight):1,formula('C'+r+'*D'+r,amount*(p.item?.weight??1))];
   })];
 }
 require('./groupMixedSheets').groupMixedSheets(wb,blocks,summaries);
 for(const name of ['啤机明细','吹气明细','喷油明细']) require('./compactMixedDetail').compactMixedDetail(wb,name,name==='啤机明细'?(code,sequence)=>injectionByProduct.get(code)?.[sequence-1]?.mold_no:undefined);
 const moldingSheet=wb.getWorksheet('啤机明细'),moldingParts=new Map();
 if(moldingSheet?.getCell('C1').value==='序号'){
   moldingSheet.eachRow(row=>{
     if(row.number===1)return;
     const sequence=row.getCell(3).value;if(typeof sequence!=='number')return;
     const part=injectionByProduct.get(row.getCell(1).value)?.[sequence-1];
     if(!part||String(part.name||'')!==String(row.getCell(4).value||''))throw new Error('注塑模号与零件匹配失败：'+row.getCell(4).value);
     moldingParts.set(row.number,part);
     row.getCell(3).value=part.mold_no==null?null:String(part.mold_no);
     row.getCell(3).numFmt='@';
   });
   moldingSheet.getCell('C1').value='模号';moldingSheet.getColumn(3).width=16;
 }
 // Material totals consume each selected part's live material amount. The
 // unique-part relocation below applies catalog usage to these references.
 if(costSheet&&moldingParts.size){
   const materialRows=new Map();
   for(const [row,part] of moldingParts){
     const code=moldingSheet.getCell(row,1).value,material=String(part.material||'').trim();
     if(!material)continue;
     const key=/^(PVC|TPR|TPE)\b/i.test(material)?'dom_mat':'imp_mat';
     const group=materialRows.get(code)||{imp_mat:[],dom_mat:[]};
     group[key].push(ref(moldingSheet.name,'I'+row));materialRows.set(code,group);
   }
   products.forEach((p,index)=>{
     for(const key of ['imp_mat','dom_mat']){
       const cell=costSheet.getCell(index+2,Object.keys(labels).indexOf(key)+3);
       const terms=materialRows.get(p.code)?.[key]||[];
       const match=cell.formula?.match(/^'([^']+)'!([A-Z]+\d+)$/);
       if(match)wb.getWorksheet(match[1]).getCell(match[2]).value=formula(terms.join('+')||'0',cell.result);
       cell.value=formula(terms.join('+')||'0',cell.result);
     }
   });
 }
 require('./uniqueMoldingDetails').uniqueMoldingDetails(wb,moldingParts);
 return wb;
}
module.exports={addTemplateDetails};
