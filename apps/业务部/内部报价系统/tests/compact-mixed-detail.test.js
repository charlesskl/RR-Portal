const {test}=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {compactMixedDetail}=require('../backend/services/compactMixedDetail');
test('喷油连续表保留两款数量单价及公式，外部汇总重新定位',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('喷油明细'),out=w.addWorksheet('总表');
 for(const [r,code,price] of [[1,'P12',.22],[9,'P15',.18]]){
  s.mergeCells(r,1,r,5);s.getCell(r,1).value=code+' · 产品';
  s.getRow(r+1).values=['序号','名称','散枪',null,'金额'];
  s.getRow(r+2).values=[null,null,'数量','单价'];
  s.getRow(r+3).values=[1,code,2,price,{formula:`C${r+3}*D${r+3}`,result:2*price}];
  s.getRow(r+4).values=['合计',null,null,null,{formula:`SUM(E${r+3}:E${r+3})`,result:2*price}];
 }
 out.getCell('A1').value={formula:"'喷油明细'!E5+'喷油明细'!E13",result:.8};
 compactMixedDetail(w,'喷油明细');
 const copy=new ExcelJS.Workbook();await copy.xlsx.load(await w.xlsx.writeBuffer());
 const flat=copy.getWorksheet('喷油明细');assert.equal(flat.rowCount,4);
 assert.equal(flat.getCell('A2').value,'P12');assert.equal(flat.getCell('A3').value,'P15');
 assert.equal(flat.getCell('E1').value,'散枪 数量');assert.equal(flat.getCell('F1').value,'散枪 单价');
 assert.equal(flat.getCell('G2').formula,'E2*F2');assert.equal(flat.getCell('G3').formula,'E3*F3');
 assert.equal(flat.getCell('A4').value,'总合计');assert.equal(flat.getCell('G4').formula,'SUM(G2:G3)');assert.equal(flat.getCell('G4').result,.8);
 assert.equal(copy.getWorksheet('总表').getCell('A1').formula,"(SUM('喷油明细'!G2:G2))+(SUM('喷油明细'!G3:G3))");
});
test('按模号重排时产品小计只引用原产品明细，不包含夹在中间的其他产品',()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('啤机明细'),out=w.addWorksheet('汇总');
 for(const [r,code] of [[1,'P1'],[8,'P2']]){
  s.mergeCells(r,1,r,3);s.getCell(r,1).value=code+' · 产品';
  s.getRow(r+1).values=['序号','模具名称','金额'];
  s.getRow(r+2).values=[1,code+'A',10];s.getRow(r+3).values=[2,code+'B',20];
  s.getRow(r+4).values=['合计',null,{formula:`SUM(C${r+2}:C${r+3})`,result:30}];
 }
 out.getCell('A1').value={formula:"'啤机明细'!C5",result:30};
 compactMixedDetail(w,'啤机明细',(_,seq)=>seq===1?'01M':'02M');
 const flat=w.getWorksheet('啤机明细');
 assert.deepEqual([2,3,4,5].map(r=>flat.getCell(r,1).value),['P1','P2','P1','P2']);
 assert.equal(out.getCell('A1').formula,"(SUM('啤机明细'!E2,'啤机明细'!E4))");
});
