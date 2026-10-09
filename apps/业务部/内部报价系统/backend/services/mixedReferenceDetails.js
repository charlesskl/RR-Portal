'use strict';
// Reuse the existing department/template cells for the full internal overview.
// Numeric values and formulas link back to their owning department cells.
function referenceDetails(wb,quote){
 const eng=wb.getWorksheet('工程及单款汇总');
 const sections=[];
 const create=(name,title)=>{const sheet=wb.addWorksheet(name);sections.push({sheet,group:'内部总表',title});return sheet;};
 const copy=(source,target,rowNo,code,name,header=false)=>{
   const original=source.getRow(rowNo),offset=code===null?0:2;
   const row=target.addRow(offset?[code,name]:[]);row.height=original.height||28;
   original.eachCell({includeEmpty:true},(c,col)=>{
     if(c.isMerged&&c.master.address!==c.address)return;
     const t=row.getCell(col+offset);t.style=structuredClone(c.style);
     t.value=c.value===''?null:header||typeof c.value==='string'?structuredClone(c.value):c.value==null?null:{formula:`'${source.name}'!${c.address}`,result:c.formula?c.result:c.value};
   });
   for(const range of source.model.merges||[]){
     const m=range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
     if(m&&Number(m[2])===rowNo&&Number(m[4])===rowNo){
       const col=l=>[...l].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)+offset;
       target.mergeCells(row.number,col(m[1]),row.number,col(m[3]));
     }
   }
   for(const image of source.getImages())if(Math.floor(image.range.tl.nativeRow)===rowNo-1){
     const anchor=a=>({...a,nativeRow:row.number-1+(a.nativeRow-(rowNo-1)),nativeCol:a.nativeCol+offset});
     target.addImage(image.imageId,{...image.range,tl:anchor(image.range.tl),...(image.range.br?{br:anchor(image.range.br)}:{})});
   }
   return row;
 };
 function extract(name,title,start,end){
   const dest=create(name,title);if(quote&&name==='总表模具源')require('./mixedHeading').addMixedHeading(dest,quote,'混装模具报价',Math.max(15,(eng?.columnCount||13)+2));let code='',product='',active=false,header=false;
   if(eng)eng.eachRow(row=>{
     const first=row.getCell(1).value;
     if(typeof first==='string'&&/^[^\s]+ · /.test(first)){[code,...rest]=first.split(' · ');product=rest.join(' · ');active=false;}
     if(start(row)){active=true;return;}
     if(active&&end(row)){active=false;return;}
     if(!active)return;
     if(first==='序号'){
       if(!header){copy(eng,dest,row.number,'货号','品名',true);header=true;}
     }else if(typeof first==='number')copy(eng,dest,row.number,code,product);
   });
   if(!dest.rowCount)dest.addRow(['暂无填报明细']);
   return dest;
 }
 let rest;
 extract('总表模具源','一、模具部分',r=>r.getCell(1).value==='一、模具部分',r=>String(r.getCell(1).value||'').startsWith('小计'));
 function department(name,title,onlyPresent=false){
   const src=wb.getWorksheet(name);
   const compact=src?.getCell('B1').value==='模号'||src?.getCell('A1').value==='模号'||['序号','模号'].includes(src?.getCell('C1').value);
   const amount=cell=>Number(cell.formula?cell.result:cell.value)||0;
   // NA ratios alone do not indicate a department cost. Compact sheets retain real
   // detail records even when their current calculated cost is zero.
   const present=[];
   if(onlyPresent&&src){
     if(compact){
       src.eachRow(r=>{if(typeof r.getCell(3).value==='number')present.push(r.number);});
     }else{
       const recordedProducts=new Set();let product='';
       if(name==='搪胶明细')src.eachRow(row=>{
         const label=String(row.getCell(1).value||'');
         if(label.startsWith('搪胶报价 · ')){if(product)recordedProducts.add(product);}
         else if(/^[^\s]+ · /.test(label))product=label.split(' · ')[0];
       });
       for(let r=2;r<=src.rowCount;r++){
         if(String(src.getCell(r,1).value||'').includes(' · '))break;
         if(recordedProducts.has(String(src.getCell(r,1).value||''))||amount(src.getCell(r,3))!==0||amount(src.getCell(r,5))!==0)present.push(r);
       }
     }
   }
   if(onlyPresent&&!present.length)return;
   const dest=create('总表'+name+'源',title);
   if(src){
     // Compact detail sheets already have one shared header and grand total.
     // Empty legacy department blocks contain only their summary; keep that summary.
     const limit=compact?src.rowCount:(()=>{let n=src.rowCount;src.eachRow(r=>{if(r.number>1&&String(r.getCell(1).value||'').includes(' · '))n=Math.min(n,r.number-1);});return n;})();
     for(let r=1;r<=limit;r++)if(src.getRow(r).hasValues&&(!onlyPresent||compact||r===1||present.includes(r)))copy(src,dest,r,null,null,r===1);
   }else dest.addRow(['暂无填报明细']);
 }
 department('啤机明细','二、注塑部分');
 department('吹气明细','二B、吹气部分',true);
 department('搪胶明细','二C、搪胶部分',true);
 // Product costs are shown once in the classification matrix.
 // Carton/freight specifications, if present, live between these section markers.
 const carton=create('总表纸箱源','纸箱 / 运费计算');let inCarton=false;
 if(eng)eng.eachRow(row=>{
   const first=String(row.getCell(1).value||'');
   if(first.includes('纸箱 / 运费')){inCarton=true;return;}
   if(first==='十、合计'){inCarton=false;return;}
   if(inCarton&&row.hasValues)copy(eng,carton,row.number,null,null);
 });
 if(!carton.rowCount){
   const params=wb.getWorksheet('混装算价参数');
   if(params){
     const saved=r=>params.getCell(r,2).result??params.getCell(r,2).value;
     carton.addRow(['名称','L (inch)','W','H']);
     carton.addRow(['产品尺寸（英寸）',null,null,null,'CU.FT','箱价 (HK$)','数量']);
     carton.addRow(['主纸箱',null,null,null,{formula:`IF(COUNT(B3:D3)=3,B3*C3*D3/1728,${Number(saved(14))||0})`,result:Number(saved(14))||0},null,saved(15)]);
     carton.addRow(['主平卡',null,null,null,null,null,null]);
     carton.getCell('E3').numFmt='0.0000';
     carton.getCell('G3').numFmt='#,##0';
     for(const a of ['F3','F4'])carton.getCell(a).numFmt='"HK$"0.00';
     carton.addRow(['运输方案','每箱箱积 CUFT','每箱包装数','货柜容量 CUFT','整柜费用 HKD','运费占比','吊柜费占比','每柜箱数','运费 HKD / 包装','吊柜费 HKD / 包装','合计 HKD / 包装']);
     const names={yt20:'YT 20柜',yt40:'YT 40柜',hk20:'HK 20柜',hk40:'HK 40柜',yt5t:'YT 5吨车',yt10t:'YT 10吨车',hk5t:'HK 5吨车',hk10t:'HK 10吨车',factory:'出厂价'};
     const value=r=>params.getCell(r,2).result??params.getCell(r,2).value;
     const vals=[names[value(13)]||value(13),value(14),value(15),value(16),value(17),Number(value(18))/100,Number(value(19))/100];
     carton.addRow(vals);
     carton.getCell('B6').value={formula:'E3',result:vals[1]};
     carton.getCell('C6').value={formula:'G3',result:vals[2]};
     const boxes=vals[1]>0?Math.max(Math.round(vals[3]/vals[1]),1):0;
     const total=boxes&&vals[2]?vals[4]/boxes/vals[2]:0;
     for(const [addr,formula,result] of [['H6','IFERROR(MAX(ROUND(D6/B6,0),1),0)',boxes],['I6','IFERROR(E6/H6/C6*F6,0)',total*vals[5]],['J6','IFERROR(E6/H6/C6*G6,0)',total*vals[6]],['K6','SUM(I6:J6)',total]])carton.getCell(addr).value={formula,result};
     for(const col of [6,7])carton.getCell(6,col).numFmt='0.00%';
     for(const col of [3,8])carton.getCell(6,col).numFmt='#,##0';
     const note=carton.addRow(['纸箱尺寸、纸质及单价尚未填写；上表箱积和装箱数用于运输分摊。']);carton.mergeCells(note.number,1,note.number,11);
     const overview=wb.getWorksheet('总报价表');
     const selected=overview.getRow(6).values.findIndex(v=>typeof v==='string'&&v.includes('报客方案'));
     if(selected>0){
       overview.getCell(8,selected).value={formula:`'${carton.name}'!I6`,result:total*vals[5]};
       overview.getCell(9,selected).value={formula:`'${carton.name}'!J6`,result:total*vals[6]};
     }
   }else carton.addRow(['暂无纸箱及运输参数']);
 }
 for(const b of sections){b.sheet.columns.forEach((c,i)=>c.width=i<2?24:16);b.sheet.eachRow(r=>{r.height=Math.max(r.height||28,28);r.eachCell(c=>{c.font={name:'Microsoft YaHei',size:10};c.alignment={vertical:'middle',wrapText:true};c.numFmt=typeof c.value==='string'?'@':c.numFmt||'0.0000';if(typeof c.value==='string'&&!c.isMerged){const units=[...c.value].reduce((n,ch)=>n+(/[^\x00-\x7f]/.test(ch)?2:1),0);r.height=Math.max(r.height,Math.ceil(units/14)*15+8);}});});b.sheet.getRow(1).height=42;b.sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDCEAF4'}};}
 return sections;
}
module.exports={referenceDetails};
