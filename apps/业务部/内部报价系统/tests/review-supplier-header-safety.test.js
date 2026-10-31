'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const { parseWorkbook } = require('../backend/services/parseHardwareSheet');
const { parsePdf } = require('../backend/services/parseSupplierPdf');
const Sync = require('../frontend/supplier-material-sync');

function hardwareHandler() {
  const source = fs.readFileSync(path.join(__dirname, '../backend/routes/uploads.js'), 'utf8');
  const code = source.slice(source.indexOf("router.post('/hardware-sheet'"), source.indexOf('// POST /api/uploads/sewing-sheet'));
  let handler;
  vm.runInNewContext(code, {router:{post(_route,_auth,_upload,callback){handler=callback;}}, requireAuth(){}, memUpload:{single(){return ()=>{};}},
    parseHardwareWorkbook:parseWorkbook, parseSupplierPdf:parsePdf});
  return async (buffer, extension='xlsx') => {
    let status=200, body;
    await handler({user:{role:'admin',dept:'engineering'},file:{originalname:'synthetic.'+extension,buffer},body:{full_supplier_snapshot:'1'}},
      {status(value){status=value;return this;},json(value){body=value;return this;}});
    return {status,body};
  };
}
async function workbook(rows) {
  const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('完整报价');sheet.addRows(rows);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const legacyHeader=['序号','零件名称','用量','单价RMB'];
const oldRows=[{name:'甲方保留旧料',spec:'',qty:1,unit_price_rmb:1,supplier_id:'A',supplier_name:'甲供应商'}];

async function importer(response, existing=oldRows) {
  const nodes=new Map();let changes=0;
  const host={querySelector(key){
    if(!nodes.has(key))nodes.set(key,{innerHTML:'',value:'',dataset:{},querySelector:selector=>host.querySelector(selector),querySelectorAll:()=>[]});
    return nodes.get(key);
  }};
  const payload={hardware:existing.map(row=>({...row}))};
  const context={window:{SupplierMaterialSync:Sync},FormData:class{append(){}},
    fetch:async()=>({ok:response.status===200,json:async()=>response.body}),
    escapeHtml:value=>String(value??''),formatNum:String,freeUnitHkd:row=>Number(row.unit_price_rmb||0),confirm:()=>true,renderEngineering(){}};
  vm.createContext(context);
  const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function attachSupplierMaterialImportUI('),source.indexOf('\nfunction renderEngineering(')),context);
  context.attachSupplierMaterialImportUI(host,payload,true,()=>changes++,.85,7.8,100,'',{inputId:'file',previewId:'preview',targetKey:'hardware',label:'五金'});
  await host.querySelector('file').onchange({target:{files:[{name:'synthetic.xlsx'}]}});
  return {payload,changes:()=>changes,select:value=>host.querySelector('[data-sync-supplier]').onchange({target:{value}}),apply:()=>host.querySelector('[data-action="supplier-sync"]').onclick()};
}

test('later explicit supplier section must block one-supplier destructive synchronization',async()=>{
  const bytes=await workbook([
    ['供应商名称：甲供应商'],legacyHeader,[1,'甲方螺丝',1,.1],
    ['供应商名称：乙供应商'],[2,'乙方纸袋',1,.2],
  ]);
  const response=await hardwareHandler()(bytes);
  const result=response.body;
  assert.equal(response.status,200);
  assert.deepEqual(result.supplier_names,['甲供应商','乙供应商']);
  assert.equal(result.supplier_name,'');
  assert.equal(result.supplier_snapshot_version,1);
  assert.deepEqual(result.items.map(item=>item.name),['甲方螺丝','乙方纸袋']);
  const ui=await importer(response);ui.select('A');ui.apply();
  assert.equal(ui.changes(),0);
  assert.deepEqual(ui.payload.hardware,oldRows,'conflicting suppliers must preserve the saved supplier snapshot');
  const ordinary=await parseWorkbook(bytes);
  assert.deepEqual(ordinary.supplier_names,['甲供应商'],'ordinary import retains its former before-header supplier lookup');
});

// Actual text PDF bytes, with readable supplier labels in the upper page margin.
function pdf(pages){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const escape=text=>String(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  pages.forEach(cells=>{
    const content=cells.map(([x,y,text])=>`BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`).join('\n')+'\n';
    const n=objects.length+1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${n+1} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  });
  let body='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(body);body+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
const pdfPage=(supplier,name)=>[[20,780,`SUPPLIER NAME: ${supplier}`],[20,740,'No'],[80,740,'Product code'],[190,740,'Product name'],[330,740,'MOQ'],[420,740,'Unit Price RMB EXCL'],[20,710,'1'],[80,710,'A'],[190,710,name],[330,710,'5K'],[420,710,'.1']];
test('readable supplier headers on different PDF pages must reach supplier conflict validation',async()=>{
  const response=await hardwareHandler()(pdf([pdfPage('Supplier A','Bolt'),pdfPage('Supplier B','Bag')]),'pdf');
  assert.equal(response.status,200);
  assert.deepEqual(response.body.supplier_names,['Supplier A','Supplier B']);
  assert.equal(response.body.supplier_name,'');
  const ui=await importer(response);ui.select('A');ui.apply();
  assert.equal(ui.changes(),0);
  assert.deepEqual(ui.payload.hardware,oldRows);
  const single=await hardwareHandler()(pdf([pdfPage('Supplier A','Bolt')]),'pdf');
  assert.equal(single.body.supplier_name,'Supplier A');
  assert.equal(single.body.items[0].name,'Bolt');
});

test('PDF text fragments preserve the full supplier name and stop at the next labelled field',async()=>{
  const page=pdfPage('discarded','Bolt').slice(1);
  page.unshift([20,780,'SUPPLIER'],[75,780,'NAME:'],[120,780,'A'],[135,780,'B Limited'],[300,780,'Quote No:'],[370,780,'Q123']);
  const response=await hardwareHandler()(pdf([page]),'pdf');
  assert.equal(response.status,200);
  assert.equal(response.body.supplier_name,'A B Limited');
  assert.deepEqual(response.body.supplier_names,['A B Limited']);
});

test('PDF split supplier caption can include the first name fragment and a split Quote No field stays separate',async()=>{
  const page=pdfPage('discarded','Bolt').slice(1);
  page.unshift([20,780,'SUPPLIER'],[75,780,'NAME: A'],[135,780,'B Limited'],[300,780,'Quote'],[345,780,'No:'],[370,780,'Q123']);
  const response=await hardwareHandler()(pdf([page]),'pdf');
  assert.equal(response.status,200);
  assert.equal(response.body.supplier_name,'A B Limited');
  assert.deepEqual(response.body.supplier_names,['A B Limited']);
  assert.equal(response.body.items[0].name,'Bolt');
});

test('empty supplier value must stop at next unpunctuated customer label',async()=>{
  for(const caption of ['Company','COMPANY NAME','BUYER','CUSTOMER','客户名称：甲供应商','联系人','报价单号：Q123']) {
    const response=await hardwareHandler()(await workbook([['供应商名称：',null,caption,'甲供应商'],legacyHeader,[1,'纸袋',1,.1]]));
    assert.equal(response.body.supplier_name,'',caption+' is another field label, never a supplier name');
    assert.deepEqual(response.body.supplier_names,[]);
  }
});

test('supplier identity preserves English internal word boundaries across quotation sheets',async()=>{
  const book=new ExcelJS.Workbook();
  for(const [index,supplier] of ['A B Limited','AB Limited'].entries()){
    book.addWorksheet('报价'+index).addRows([['SUPPLIER NAME: '+supplier],legacyHeader,[index+1,'物料'+index,1,.1]]);
  }
  const response=await hardwareHandler()(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(response.status,200);
  assert.deepEqual(response.body.supplier_names,['A B Limited','AB Limited']);
  assert.equal(response.body.supplier_name,'');
  const ui=await importer(response);ui.select('A');ui.apply();
  assert.equal(ui.changes(),0);
  assert.deepEqual(ui.payload.hardware,oldRows);
});
