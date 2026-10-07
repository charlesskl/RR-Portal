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
test('模具标准附录及钢料编号说明不导入，真实数字模号保留',()=>{
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
 ['模号','配件名称','胶料类型','型腔','套数','零件重量(g)'],
 ['1','正常塑胶件','ABS',2,2,1],
 ['MNFRG-32M-01','uv胶瓶盖','ABS',4,4,2],
 ['模具标准一览表','uv胶瓶盖模'],
 ['序号','钢料材料'],
 ['1','龙记LKM模胚'],
 ['2','龙记钢料 738H 或 718H/2316H/NAK80/铸造钢料'],
 ['3','S136/2344/8407'],
 ['8','标准弹簧'],
 ['制定Prepared by:','uv胶瓶盖模']
 ]),'模具');
 const result=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 assert.deepEqual(result.molds.map(m=>m.mold_no),['1','MNFRG-32M-01']);
});
test('实际产能啤数与件数分别提取，产能要求映射生产需求量',()=>{
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
 ['模号','产品名称','配件名称','胶料','出模数','套数','零件重量','产能要求','原产能','实际产能\n（啤数）','实际产能\n（个数）','实际产能（啤数）'],
 ['MNFRG-01M-01','Water','P66水瓶','PVC',6,6,1.5,12396,2829,3400,20400,3000],
 ['','MHH','P47热蜂蜜瓶','PVC',2,2,1.3,2421,2829,3400,6800,3000]
 ]),'模具');
 const result=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 assert.equal(result.molds[0].target,3400);
 assert.deepEqual(result.molds[0].parts.map(p=>p.production_demand),[12396,2421]);
});
test('产能要求纵向合并值分配给覆盖的每个配件，普通空白仍留空',()=>{
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([
 ['模号','产品名称','配件名称','胶料','出模数','套数','产能要求'],
 ['M3','Kombucha','P62康普茶','PVC',6,6,11604],
 ['M3','Pancakes','P48千层饼上件','PVC',1,1,1683],
 ['M3','Pancakes','P48千层饼下件','PVC',1,1,''],
 ['M4','Other','普通空白零件','PVC',1,1,'']
 ]);
 sheet['!merges']=[{s:{r:2,c:6},e:{r:3,c:6}}];
 XLSX.utils.book_append_sheet(book,sheet,'模具');
 const result=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 const parts=result.molds.flatMap(m=>m.parts);
 assert.deepEqual(parts.map(p=>p.production_demand),[11604,1683,1683,null]);
});
test('需求文本支持乘法和加法但不执行其他表达式',()=>{
 const book=XLSX.utils.book_new();
 const values=['10008*2','1742*8','1042*3+4000*3','1042×4','process.exit()',''];
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
 ['模号','产品名称','配件名称','胶料','出模数','套数','产能要求'],
 ...values.map((v,i)=>['M'+i,'产品','零件'+i,'PVC',1,1,v])
 ]),'模具');
 const result=parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 assert.deepEqual(result.molds.flatMap(m=>m.parts).map(p=>p.production_demand),[20016,13936,15126,4168,null,null]);
});
