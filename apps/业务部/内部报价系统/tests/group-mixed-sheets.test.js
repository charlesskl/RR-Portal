const {test}=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {groupMixedSheets,relocateFormula}=require('../backend/services/groupMixedSheets');
test('合并部门明细移动绝对/相对/跨表引用，不改变字符串和函数名',()=>{
 const mapping=new Map([['旧表',{name:'啤机明细',offset:20}]]);
 assert.equal(relocateFormula('SUM(\'旧表\'!$A$2:B3)+$C$4+LOG10(D5)+IF(A1="A1",1,0)',{offset:10},mapping),
  'SUM(\'啤机明细\'!$A$22:B23)+$C$14+LOG10(D15)+IF(A11="A1",1,0)');
});
test('多个产品按部门合并后，汇总引用仍指向各自小计，保留图片和合并格',async()=>{
 const w=new ExcelJS.Workbook(),sum=w.addWorksheet('总表'),a=w.addWorksheet('A部门'),b=w.addWorksheet('B部门');
 for(const s of [a,b]){s.addRows([['物料',2,3],['小计',{formula:'B1*C1',result:6}]]);s.mergeCells('A3:C3');s.getCell('A3').value='备注';}
 sum.getCell('A1').value={formula:"'A部门'!B2+'B部门'!B2",result:12};
 const img=w.addImage({base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKq0AAAAASUVORK5CYII=',extension:'png'});
 b.addImage(img,{tl:{col:0,row:0},ext:{width:10,height:10}});
 groupMixedSheets(w,[{sheet:a,group:'部门明细',title:'A'},{sheet:b,group:'部门明细',title:'B'}]);
 const c=new ExcelJS.Workbook();await c.xlsx.load(await w.xlsx.writeBuffer());
 const g=c.getWorksheet('部门明细');
 assert.equal(g.getCell('B3').formula,'B2*C2');
 assert.equal(g.getCell('B9').formula,'B8*C8');
 assert.equal(c.getWorksheet('总表').getCell('A1').formula,"'部门明细'!B3+'部门明细'!B9");
 assert.equal(g.getImages().length,1);assert.equal(g.getImages()[0].range.tl.nativeRow,7);
 assert.equal(g.getCell('C10').master.address,'A10');
});
