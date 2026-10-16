const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {buildVerificationRow,quantityFor,customerTotals,buildVerificationWorkbook,columns}=require('../backend/services/verificationSummary');

function fixture(){
  const cells={},groups=[];
  function group(title,row,labels,values){
    const ids=labels.map((_,i)=>`s!${String.fromCharCode(65+i)}${row}`),vs=ids.map(id=>id.replace(String(row),String(row+1)));
    labels.forEach((v,i)=>cells[ids[i]]={v});values.forEach((v,i)=>cells[vs[i]]=typeof v==='object'?v:{v});
    groups.push({title,rows:[ids,vs]});
  }
  group('货价与材料',1,['货价','进口料','国内料','车衣','电子'],[20,4.5,0,3,2]);
  group('包装与外购',4,['不含人工成本','纸箱','运费','吊柜费'],[10,1,0,0]);
  group('人工与成本',7,['总成本','啤工','装配工','喷油工','减税后人工合计','减税后不含人工成本'],[13,1,2,0,3,9]);
  group('减税与税后结果',10,['含税13%类成本','含税13%类','车衣类13%'],[{v:0,f:'C2'},0.115,0]);
  groups[3].rows.push(['s!A13','s!B13','s!C13']);cells['s!B13']={v:0};cells['s!C13']={v:0};
  cells['s!K1']={v:1};cells['s!K2']={v:12};cells['s!B2']={v:4.5,f:'[11]核价基数!C9',external_input:true};
  const model={cells,groups,metrics:{price:'s!A2',total:'s!A8',no_labor:'s!A5',deduction:'s!K1',after_cost:'s!K2'}};
  return [{dept:'sales',payload_json:JSON.stringify({header:{fx_hkd_usd:6.9},legacy_import:{excel_model:model},excel_native:{inputs:{}}})}];
}
const quote={id:1,customer:'ZURU',quote_no:'92125',product_name:'猫蛋'},version={id:2,label:'V1',status:'completed'};
test('detail fallback retains unit costs without inventing order quantity or weighted totals',()=>{
  const r=buildVerificationRow({...quote,customer:'Sky Castle',quote_no:'JS100CDU-12'},version,fixture(),[]);
  assert.equal(r.values.E,20);assert.equal(r.values.F,13);assert.equal(r.values.T,4.5);
  assert.equal(r.values.D,null);assert.equal(r.values.DI,null);assert.equal(r.values.DQ,null);
  assert.equal(r.sources.E,'s!A2');
});
const qty=[{customer:'ZURU',sku:'92125（汇率6.9）',qty:100,source:'D10'},{customer:'ZURU',sku:'92125（汇率7.25）',qty:200,source:'D11'}];
test('after-tax labor directly references unit costs and propagates to amounts',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json);
  p.excel_native.inputs['s!B8']={v:1.23456,f:null,t:'n'};
  sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,qty);
  for(const [out,input,amount,ratio] of [['I','H','J','K'],['M','L','N','O'],['Q','P','R','S']]){
    assert.equal(r.values[out],r.values[input]);
    assert.equal(r.formulas[out],`${input}1`);
    assert.equal(r.values[amount],r.values[out]*100);
    assert.equal(r.values[ratio],r.values[amount]/r.values.DI);
  }
  assert.equal(r.values.I,1.23456);assert.equal(r.values.Q,0);
});
test('carton rebate uses the confirmed fixed formula and updates amount and ratio',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json);
  p.legacy_import.excel_model.cells['s!B5']={v:2.95};
  sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,qty);
  assert.ok(Math.abs(r.values.AO-(2.95-2.95/1.15*0.115))<1e-12);
  assert.equal(r.formulas.AO,'AN1-AN1/1.15*11.5%');
  assert.ok(Math.abs(r.values.AP-r.values.AO*100)<1e-10);
  assert.equal(r.values.AQ,r.values.AP/r.values.DI);
  for(const value of [0,4]){
    p.excel_native.inputs['s!B5']={v:value,f:null,t:'n'};
    sections[0].payload_json=JSON.stringify(p);
    assert.ok(Math.abs(buildVerificationRow(quote,version,sections,qty).values.AO-value*0.9)<1e-12);
  }
});
test('quantity matches customer + sku + current FX, preserves zero and rejects duplicates',()=>{
  assert.equal(quantityFor(quote,qty,6.9).value,100);
  assert.equal(quantityFor(quote,qty,7.25).value,200);
  assert.equal(quantityFor(quote,qty,7.75).value,null);
  assert.equal(quantityFor({...quote,customer:'other'},qty,6.9).value,null);
  assert.equal(quantityFor(quote,[...qty,qty[0]],6.9).value,null);
  assert.equal(quantityFor(quote,[{...qty[0],qty:0}],6.9).value,0);
  assert.equal(quantityFor({...quote,customer:'ZANZOON'},[{customer:'ZANZOON（嘉苏）',sku:'92125',qty:2}]).value,2);
});
test('native verification preserves cached external prices, tax exemptions and source payloads',()=>{
  const sections=fixture(),before=JSON.stringify(sections),r=buildVerificationRow(quote,version,sections,qty);
  assert.equal(r.values.T,4.5);assert.equal(r.values.BN,3);assert.equal(r.values.CY,1);assert.equal(r.values.CZ,12);
  assert.equal(r.values.D,100);assert.equal(r.values.DI,2000);assert.equal(r.values.DQ,300);
  assert.equal(r.formulas.DQ,'(H1+L1+P1)*D1');assert.equal(r.values.CM,7);
  assert.equal(JSON.stringify(sections),before);assert.match(r.issues.join(' '),/外部引用/);
});
test('cell overrides recalculate; formula errors and missing quantity do not turn into zero',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json);p.excel_native.inputs['s!A2']={v:30,f:null,t:'n'};
  p.legacy_import.excel_model.cells['s!K1']={v:1,f:'1/0'};sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,[]);
  assert.equal(r.values.E,30);assert.equal(r.values.CY,null);assert.equal(r.values.D,null);assert.equal(r.values.DI,null);
  assert.match(r.issues.join(' '),/错误|除/);assert.equal(r.values.CM,17);
});
test('a matching tax-class label is never mistaken for a missing cost component',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json),m=p.legacy_import.excel_model;
  m.groups[3].rows[0].push('s!D10');m.groups[3].rows[1].push('s!D11');m.groups[3].rows[2].push('s!D13');
  m.cells['s!D10']={v:'车发'};m.cells['s!D11']={v:0.115};m.cells['s!D13']={v:0};
  sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,qty);
  assert.equal(r.values.BI,null);assert.equal(r.values.CV,0);assert.equal(r.values.CS,0);
});
test('pooled tax allocation uses the source formula factor, not a blanket tax rate',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json),m=p.legacy_import.excel_model;
  m.cells['s!A11']={v:1,f:'E2*0.5'};m.cells['s!B13']={v:0.115,f:'A11*B11'};
  sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,qty);
  assert.ok(Math.abs(r.values.AT-1.885)<1e-10);
  // A hard-coded tax base does not establish which cost components are exempt.
  m.cells['s!B13']={v:0.115};sections[0].payload_json=JSON.stringify(p);
  assert.equal(buildVerificationRow(quote,version,sections,qty).values.AT,null);
});
test('conflicting costs stay unresolved and profits use the confirmed summary relationship',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json),m=p.legacy_import.excel_model;
  m.groups[0].rows[0].push('s!F1');m.cells['s!F1']={v:'油漆'};m.cells['s!F2']={v:0.24};
  m.groups[2].rows[0].push('s!G7','s!H7');m.cells['s!G7']={v:'油漆'};m.cells['s!G8']={v:0};m.cells['s!H7']={v:'利润'};m.cells['s!H8']={v:99};
  sections[0].payload_json=JSON.stringify(p);const r=buildVerificationRow(quote,version,sections,qty);
  assert.equal(r.values.BQ,null);assert.match(r.issues.join(' '),/多个不同金额来源/);
  assert.equal(r.values.CM,7);assert.equal(r.formulas.CM,'E1-F1');
});
test('horizontal product summary resolves missing electronics and ambiguous paint, with live formulas',()=>{
 const sections=fixture(),p=JSON.parse(sections[0].payload_json),m=p.legacy_import.excel_model;
 delete m.cells['s!E1'];delete m.cells['s!E2'];
 m.groups[0].rows[0].push('s!F1');m.cells['s!F1']={v:'油漆'};m.cells['s!F2']={v:null};
 m.groups[2].rows[0].push('s!G7');m.cells['s!G7']={v:'油漆'};m.cells['s!G8']={v:0.132};
 const labels=['总采购价','彩盒','贴纸','吸塑','纸箱','电镀','电子','电池','五金','油漆'];
 labels.forEach((v,i)=>{const col=String.fromCharCode(65+i);m.cells[`s!${col}16`]={v};m.cells[`s!${col}17`]={v:0,f:v==='油漆'?'K18': '0'};});
 m.cells['s!K18']={v:0.132};
 // A different sheet and a later product must not be searched.
 m.cells['other!G16']={v:'电子'};m.cells['other!G17']={v:99};
 labels.forEach((v,i)=>{const col=String.fromCharCode(65+i);m.cells[`s!${col}100`]={v};m.cells[`s!${col}101`]={v:99};});
 sections[0].payload_json=JSON.stringify(p);
 let r=buildVerificationRow(quote,version,sections,qty);
 assert.equal(r.values.AS,0);assert.equal(r.sources.AS,'s!G17');assert.equal(r.values.BQ,0.132);
 p.excel_native.inputs['s!K18']={v:0.25,f:null};sections[0].payload_json=JSON.stringify(p);
 r=buildVerificationRow(quote,version,sections,qty);assert.equal(r.values.BQ,0.25);
});
test('manual quantities override source values, preserve zero and explicit blanks',()=>{
 const sections=fixture(),p=JSON.parse(sections[0].payload_json);
 for(const [value,expected] of [[20,400],[0,0],[null,null]]){
  p.summary_order_quantity={value};sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,qty);
  assert.equal(r.values.D,value);assert.equal(r.values.DI,expected);assert.equal(r.values.E,20);
 }
});
test('customer totals require complete coverage and do not sum unit prices or percentages',()=>{
  const r=buildVerificationRow(quote,version,fixture(),qty),missing=structuredClone(r);missing.values.DI=null;
  assert.equal(customerTotals([r,missing])[0].totals.DI,null);
  assert.equal(customerTotals([r])[0].totals.DI,2000);
  assert.equal(customerTotals([r])[0].totals.E,undefined);
});
test('XLSX contains template columns, customer sheets, formulas, frozen panes and typed blanks',async()=>{
  const r=buildVerificationRow(quote,version,fixture(),qty),wb=buildVerificationWorkbook([r]);
  const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await wb.xlsx.writeBuffer());
  assert.equal(columns.length,135);assert.deepEqual(reopened.worksheets.map(s=>s.name),['总表分车间','打印','截图','总表不分车间','不分车间 打印','不分车间核价明细','ZURU','生成提示']);
  const ws=reopened.getWorksheet('ZURU');assert.equal(ws.getCell('D5').value,100);
  assert.equal(reopened.getWorksheet('不分车间核价明细').getCell('D5').formula,`IF(ISNUMBER('ZURU'!D5),'ZURU'!D5,"")`);
  assert.equal(ws.getCell('DQ5').formula,'IF(COUNT(H5,L5,P5,D5)=4,(H5+L5+P5)*D5,"")');assert.equal(ws.getCell('DI5').result,2000);
  assert.equal(ws.views[0].xSplit,3);assert.equal(ws.views[0].ySplit,3);assert.equal(ws.getCell('EE3').value,columns[134].label);
  assert.equal(ws.getCell('Y5').value,null);assert.equal(ws.getCell('T5').value,4.5);
  assert.equal(ws.getColumn('I').hidden,true);assert.equal(ws.getColumn('H').hidden,false);
});
test('summary and export share latest-version, customer and factory scope',async()=>{
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE quotes(id INTEGER,customer TEXT,quote_no TEXT,product_name TEXT,deleted_at TEXT,factory_code TEXT);
    CREATE TABLE quote_verification_versions(id INTEGER,quote_id INTEGER,label TEXT,status TEXT,version_no INTEGER);
    CREATE TABLE quote_verification_sections(version_id INTEGER,dept TEXT,payload_json TEXT);
    CREATE TABLE user_customers(user_id INTEGER,customer TEXT);
    INSERT INTO quotes VALUES (1,'A','A1','one',NULL,'qingxi'),(2,'B','B1','two',NULL,'qingxi'),(3,'A','A2','three',NULL,'heyuan'),(4,'A','A3','deleted','x','qingxi');
    INSERT INTO quote_verification_versions VALUES(1,1,'V1','completed',1),(2,1,'V2','drafting',2),(3,1,'V3','cancelled',3),(4,2,'V1','completed',1),(5,3,'V1','completed',1),(6,4,'V1','completed',1);
    INSERT INTO user_customers VALUES(7,'A');`);
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/routes/verificationSummary.js'),'utf8'),{module:mod,require:id=>id==='../db'?db:id==='../middleware/auth'?{requireAuth:()=>{}}:id==='../services/verificationMetadata'?require('../backend/services/verificationMetadata'):id==='../services/sourceSummary'?require('../backend/services/sourceSummary'):id==='../services/verificationSummary'?{buildVerificationRow:(q,v)=>({id:q.id,version:v.label})}:require(id)});
  const load=mod.exports.loadRows,user={id:7,active_factory_code:'qingxi',perms:{}};
  assert.equal(JSON.stringify(await load(user)),JSON.stringify([{id:1,version:'V2',quantity_revision:null}]));
  assert.equal((await load(user,{customer:'B'})).length,0);
  assert.equal((await load({...user,perms:{'账号管理':{can_admin:1}}})).length,2);
  assert.equal((await load(user,{status:'completed'})).length,0);
  db.close();
});


test('confirmed quote-summary relationships drive verification values and export formulas',()=>{
  const sections=fixture(),p=JSON.parse(sections[0].payload_json);
  p.excel_native.inputs['s!C5']={v:10,f:null};
  p.excel_native.inputs['s!D5']={v:2,f:null};
  sections[0].payload_json=JSON.stringify(p);
  const r=buildVerificationRow(quote,version,sections,qty);
  assert.equal(r.values.CE,10*(1-.0826)+2);
  assert.equal(r.values.CZ,r.values.F-r.values.CY);
  assert.equal(r.values.G,r.values.F-r.values.H-r.values.L-r.values.P);
  for(const [rate,amount] of [['DL','DK'],['DN','DM'],['DY','DX'],['EA','DZ']]) {
    assert.equal(r.values[rate],r.values[amount]/r.values.DI);
    assert.equal(r.formulas[rate],`IF(DI1=0,0,${amount}1/DI1)`);
  }
  const ws=buildVerificationWorkbook([r]).getWorksheet('ZURU');
  assert.match(ws.getCell('EA5').formula,/DZ5\/DI5/);
  p.summary_order_quantity={value:0};sections[0].payload_json=JSON.stringify(p);
  const zero=buildVerificationRow(quote,version,sections,qty);
  for(const rate of ['DL','DN','DY','EA'])assert.equal(zero.values[rate],0);
});
