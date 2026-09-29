'use strict';
function addMixedHeading(sheet,quote,label,width){
 const title=[quote.quote_no,quote.product_name,label].filter(Boolean).join(' ');
 sheet.addRow([title]);sheet.mergeCells(1,1,1,width);
 sheet.addRow([`客户：${quote.customer||'—'}    数量：${quote.qty??'—'}    创建：${quote.created_at||'—'}`]);sheet.mergeCells(2,1,2,width);
 sheet.addRow([]);sheet.getRow(3).height=12;
}
function styleMixedHeading(sheet){
 for(const [r,size,color,bg] of [[1,16,'FFFFFFFF','FF103B5C'],[2,10,'FF60758A','FFF0F4F8']]){
  const cell=sheet.getCell(r,1);cell.font={name:'Microsoft YaHei',size,bold:r===1,italic:r===2,color:{argb:color}};
  cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}};
  cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};cell.numFmt='@';sheet.getRow(r).height=r===1?38:28;
 }
}
module.exports={addMixedHeading,styleMixedHeading};
