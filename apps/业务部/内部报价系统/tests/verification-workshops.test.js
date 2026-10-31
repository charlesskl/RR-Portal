const test=require('node:test'),assert=require('node:assert/strict');
const {resolveWorkshop}=require('../backend/services/verificationWorkshops');
const G=require('../frontend/verification-report-groups');
const {buildWorkbook,localFormula}=require('../backend/services/verificationWorkshopExport');
const {columns}=require('../backend/services/verificationSummary');
test('historical customer + SKU mappings, FX variants and unknowns',()=>{
  const w=(customer,quote_no)=>resolveWorkshop({customer,quote_no},[]).workshop;
  assert.equal(w('ZURU','92125'),'兴信B');assert.equal(w('Cepia','G1002'),'兴信B');
  assert.equal(w('Cepia','Z1000'),'兴信A');assert.equal(w('Cepia','D1026'),G.pending);
  assert.equal(w('Sky Castle','JC100'),'华登');assert.equal(w('Sky Castle','JS100CDU-12'),'华登');
  assert.equal(w('ZANZOON','1125155（新款五角星）'),'兴信B');
  assert.equal(w('ZURU','not-in-file'),G.pending);
});
test('new explicit assignment wins; conflicting source mappings are not guessed',()=>{
  const q={customer:'ZURU',quote_no:'92125'},sections=[{dept:'sales',payload_json:JSON.stringify({header:{workshop:'A'}})}];
  assert.equal(resolveWorkshop(q,sections).workshop,'兴信A');
  assert.equal(resolveWorkshop(q,[],[{customer:'ZURU',sku:'92125',workshop:'兴信A'},{customer:'ZURU',sku:'92125',workshop:'兴信B'}]).workshop,G.pending);
});
function row(id,customer,workshop,qty,price,amount){return {id,workshop,values:{A:customer,B:'sku'+id,C:'product',D:qty,E:price,F:price/2,DI:amount,DX:amount/4,DZ:amount/10,J:amount/5},sources:{},formulas:{DI:'D1*E1'},issues:[],missing:[]};}
test('one detail row per quote; subtotals and ratios reflect underlying amounts',()=>{
  const rs=[row(1,'A','兴信A',10,20,200),row(2,'A','兴信B',1,100,100),row(3,'B',null,2,50,100)];
  const detail=G.reportRows(rs,'customer-detail');assert.equal(detail.filter(r=>!r.kind).length,3);
  const total=G.reportRows(rs,'workshop-summary').at(-1);
  assert.equal(total.values.DI,400);assert.equal(total.values.K,0.2);assert.equal(total.members.length,3);
  rs[0].values.DI=400;rs[0].values.J=80;assert.equal(G.reportRows(rs,'customer-summary').at(-1).values.DI,600);
  rs[0].values.DI=null;assert.equal(G.aggregate(rs,'','').values.DI,null);assert.equal(G.aggregate(rs,'','').values.K,null);
});
test('export links customer subtotals and includes pending groups without duplicates',async()=>{
  const rs=[row(1,'A','兴信A',10,20,200),row(2,'A',null,1,100,100)];
  const wb=buildWorkbook(rs,columns),summary=wb.getWorksheet('总表不分车间');
  assert.match(summary.getCell('DG4').formula,/'A'!DI/);assert.equal(summary.getCell('DG4').result,.03);
  const detail=wb.getWorksheet('不分车间核价明细');assert.equal(detail.getCell('DI5').formula,`IF(ISNUMBER('A'!DI5),'A'!DI5,"")`);
  const customer=wb.getWorksheet('A');assert.ok(customer.getColumn(1).values.some(v=>typeof v==='string'&&v.includes(G.pending)));
  const sums=wb.getWorksheet('总表分车间');assert.equal(sums.getCell(`DG${sums.rowCount}`).result,.03);
  assert.ok((await wb.xlsx.writeBuffer()).length>1000);
});
test('customer export calculations use local rows and local detail subtotals',async()=>{
  const rs=[row(1,'Sky Castle','华登',100,10,1000),row(2,'Sky Castle','河源',20,10,200)];
  for(const r of rs){
    Object.assign(r.values,{H:0.5,I:0.5,J:r.values.D*0.5,K:0.05,L:1,M:1,N:r.values.D,O:0.1,P:0,Q:0,R:0,S:0,AN:2,AO:2-2/1.1*0.115,AP:(2-2/1.1*0.115)*r.values.D,AQ:(2-2/1.1*0.115)/10});
    Object.assign(r.formulas,{I:'H1',J:'I1*D1',K:'IF(DI1=0,"",J1/DI1)',M:'L1',N:'M1*D1',O:'IF(DI1=0,"",N1/DI1)',Q:'P1',R:'Q1*D1',S:'IF(DI1=0,"",R1/DI1)',AO:'AN1-AN1/1.1*11.5%',AP:'AO1*D1',AQ:'IF(DI1=0,"",AP1/DI1)'});
  }
  const wb=buildWorkbook(rs,columns),ws=wb.getWorksheet('Sky Castle');
  for(const n of [5,8]){
    for(const [c,f] of Object.entries(rs[0].formulas))assert.equal(ws.getCell(`${c}${n}`).formula,localFormula(f,n));
  }
  assert.equal(ws.getCell('J6').formula,'IF(COUNT(J5)=1,SUM(J5),"")');
  assert.equal(ws.getCell('J10').formula,'IF(COUNT(J5,J8)=2,SUM(J5,J8),"")');
  assert.equal(ws.getCell('J5').formula,'IF(COUNT(I5,D5)=2,I5*D5,"")');
  assert.equal(ws.getCell('K5').formula,'IF(COUNT(DI5,J5)=2,IF(DI5=0,"",J5/DI5),"")');
  const summary=wb.getWorksheet('总表分车间');
  assert.match(summary.getCell(`J${summary.rowCount}`).formula,/'Sky Castle'!J6.*'Sky Castle'!J9/);
  const saved=new (require('exceljs').Workbook)();await saved.xlsx.load(await wb.xlsx.writeBuffer());
  assert.equal(saved.getWorksheet('Sky Castle').getCell('J5').formula,localFormula('I1*D1',5));
  assert.equal(saved.getWorksheet('Sky Castle').getCell('D5').value,100);
  // Source row 8 is not green detail row 6 (customer workshop headings differ).
  assert.equal(saved.getWorksheet('不分车间核价明细').getCell('J6').formula,`IF(ISNUMBER('Sky Castle'!J8),'Sky Castle'!J8,"")`);
  saved.getWorksheet('Sky Castle').eachRow(r=>r.eachCell(c=>{if(c.formula)assert.ok(!c.formula.includes('!'),c.formula);}));
});
test('missing and zero results retain formulas for later input edits',()=>{
  const r=row(1,'A','华登',null,10,null);
  r.values.J=null;r.values.K=null;
  r.formulas.J='I1*D1';r.formulas.K='IF(DI1=0,"",J1/DI1)';
  const ws=buildWorkbook([r],columns).getWorksheet('A');
  assert.equal(ws.getCell('J5').formula,localFormula('I1*D1',5));
  assert.equal(ws.getCell('J6').formula,'IF(COUNT(J5)=1,SUM(J5),"")');
  assert.equal(ws.getCell('K5').formula,localFormula(r.formulas.K,5));
});
