const test=require('node:test'),assert=require('node:assert/strict'),XLSX=require('xlsx');
const {parseWorkbook}=require('../backend/services/parseMoldSheet');
test('模具配件导入保留各行日产能要求并排除制表签字行',()=>{
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
 ['模号','配件名称','胶料类型','型腔','套数','零件重量(g)','模具预计日啤数','日产能要求','机型(TON)'],
 ['01M','04-瓶盖','ABS',4,4,.14,2829,3890,'120T'],
 ['01M','21-大身1','ABS',4,4,.30,2829,4170,'120T'],
 ['','制表','','','','','','',''],
 ]),'模具');
 const result=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 const parts=result.molds.flatMap(m=>m.parts?.length?m.parts:[m]);
 assert.equal(parts.length,2);
 assert.deepEqual(parts.map(p=>p.production_demand),[3890,4170]);
});
