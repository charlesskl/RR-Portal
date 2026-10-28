const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Tax=require('../frontend/sewing-tax');
const {buildQuoteSummary,buildSummaryWorkbook,SUMMARY_COLUMNS,BASE_SUMMARY_COLUMNS}=require('../backend/services/quoteSummary');
const {buildWorkbook}=require('../backend/services/exportInternal');
const {calculateMixedQuote}=require('../backend/services/mixedQuotation');
const sections=p=>Object.entries(p).map(([dept,data])=>({dept,payload_json:JSON.stringify(data)}));
const quote={id:1,quote_no:'SEW',product_name:'车缝测试',customer:'TOMY',qty:100,factory_code:'qingxi'};
const group=(price,tax_label,category='车衣',qty=1)=>({category,tax_label,product_qty:qty,items:[{fabric:'布料',usage:1,mat_price:price,markup:1}]});
const payload=sewing=>({sales:{header:{fx_rmb_hkd:1,fx_hkd_usd:7.8},shipping:{markup_x:1.2,divisor:.98,scenarios:[{name:'出厂价',is_factory:true}]}},sewing});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function taxCells(ws){let row;ws.eachRow(r=>{if(r.getCell(1).value==='四、减税明细')row=r.number+2;});assert.ok(row);return {amount:ws.getCell(row,6),deduction:ws.getCell(row+2,6)};}

test('不含税车缝成本保留且没有退税，含税状态切回后恢复退税',async()=>{
 for(const label of ['不含税','含税']){
  const s=sections(payload({tax_label:label,sewing_groups:[group(20)]}));
  const r=buildQuoteSummary(quote,s),expected=label==='不含税'?0:20;
  assert.equal(r.components_before_tax.sewing_cloth,20);
  assert.equal(r.sewing_taxable.sewing_cloth,expected);
  near(r.components.sewing_cloth,20-expected*.115);
  near(r.summary_values.cloth_13_cost,expected);
  const wb=await buildWorkbook({quote,sections:s});
  const cell=taxCells(wb.getWorksheet('报价明细'));
  near(cell.amount.result,expected);near(cell.deduction.result,expected*.115);
  assert.match(cell.amount.formula,label==='不含税'?/\*0$/:/\*1$/);
 }
});

test('同类含税与不含税按组用量加权，人工不重复，车发与车衣分开',()=>{
 const sew={sewing_groups:[group(10,'含税','车衣',2),group(30,'不含税','车衣',1),group(40,'不含税','车发',1)]};
 near(Tax.fractions(sew).sewing_cloth,.4);assert.equal(Tax.fractions(sew).sewing_hair,0);
 const r=buildQuoteSummary(quote,sections(payload(sew)));
 near(r.components_before_tax.sewing_cloth,12.5);near(r.sewing_taxable.sewing_cloth,5);
 near(r.components.sewing_cloth,11.925);near(r.components.sewing_hair,10);
 const labor={sewing_groups:[{...group(10,'含税'),items:[{fabric:'人工',usage:1,mat_price:10}],labor_amount:10},group(10,'不含税')]};
 near(Tax.fractions(labor).sewing_cloth,.5);
 assert.equal(Tax.taxed({price_type:'RMB_UNTAXED'}),false);
 assert.equal(Tax.taxed({tax_pct:0}),false);
 assert.equal(Tax.taxed({}),true);
});

test('报价详情网页使用已选税项，仅含税基数参与退税',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const host={innerHTML:'',querySelector:()=>null};
 const context=vm.createContext({window:{SewingTax:Tax,__data:{sections:sections({sewing:{tax_label:'不含税'}})}},num:v=>Number(v)||0,sum:obj=>Object.values(obj||{}).reduce((a,b)=>a+(Number(b)||0),0),formatNum:String});
 vm.runInContext(source.slice(source.indexOf('function renderTaxDeductionBlock('),source.indexOf('\nfunction hasSlushCostingInputs(')),context);
 const sales={};
 context.renderTaxDeductionBlock(host,sales,null,{}, {base_price:40,sewing_hair:10,sewing_cloth:20});
 assert.equal(sales.pricing_summary.t1.sewing_hair,10);assert.equal(sales.pricing_summary.t1.sewing_cloth,20);
 assert.equal(sales.pricing_summary.t4.sewhair13.amt,0);assert.equal(sales.pricing_summary.t4.sewcloth13.amt,0);
});

test('核价页面入口加载税项模块，未税车缝在页面汇总中不退税',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../frontend/verification.html'),'utf8');
 const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const context=vm.createContext({window:{__data:{sections:sections({sewing:{tax_label:'不含税'}})}},num:v=>Number(v)||0,sum:obj=>Object.values(obj||{}).reduce((a,b)=>a+(Number(b)||0),0),formatNum:String});
 if (/<script\s+src="\.\/sewing-tax\.js(?:\?[^\"]*)?"/.test(html)) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/sewing-tax.js'),'utf8'),context);
 }
 vm.runInContext(source.slice(source.indexOf('function renderTaxDeductionBlock('),source.indexOf('\nfunction hasSlushCostingInputs(')),context);
 const sales={};context.renderTaxDeductionBlock({innerHTML:'',querySelector:()=>null},sales,null,{}, {base_price:40,sewing_hair:0,sewing_cloth:20});
 assert.equal(sales.pricing_summary.t4.sewcloth13.amt,0);
 assert.ok(html.indexOf('./sewing-tax.js')<html.indexOf('./workbench.js'));
});

test('报价汇总导出公式和保存值保持不含税结果',async()=>{
 const r=buildQuoteSummary(quote,sections(payload({tax_label:'不含税',sewing_groups:[group(20)]})));
 const wb=buildSummaryWorkbook([r]),saved=new(require('exceljs').Workbook)();await saved.xlsx.load(await wb.xlsx.writeBuffer());
 const ws=saved.getWorksheet('各客报价汇总');
 const keys=[...BASE_SUMMARY_COLUMNS,...SUMMARY_COLUMNS];
 const cell=key=>ws.getCell(5,keys.findIndex(c=>c[0]===key)+1);
 near(cell('sewing_cloth_after_tax').result,20);assert.match(cell('sewing_cloth_after_tax').formula,/1-0\*11.5%/);
 near(cell('cloth_13_cost').result,0);assert.match(cell('cloth_13_cost').formula,/\*0$/);
});

test('混装按NA比例及共用一次合并含税基数，网页和导出共用结果',async()=>{
 const p=payload({mixed_products:{a:{tax_label:'不含税',sewing_groups:[group(20)]},b:{tax_label:'含税',sewing_groups:[group(10)]}},mixed_shared:{tax_label:'不含税',sewing_groups:[group(5)]}});
 p.sales.mixed_quote={enabled:true,na_direct:true,mode:'ratio',units_per_pack:1,products:[{id:'a',code:'A',name:'A',ratio:.25,na_ratio:.25},{id:'b',code:'B',name:'B',ratio:.75,na_ratio:.75}]};
 p.molding={mixed_molds:[]};
 const s=sections(p),r=calculateMixedQuote(quote,s,{strict:true});
 near(r.components.sewing_cloth,17.5);near(r.sewing_taxable.sewing_cloth,7.5);
 const summary=buildQuoteSummary(quote,s);near(summary.summary_values.cloth_13_cost,7.5);
 const wb=await buildWorkbook({quote,sections:s}),saved=new(require('exceljs').Workbook)();await saved.xlsx.load(await wb.xlsx.writeBuffer());
 const cells=taxCells(saved.getWorksheet('总报价表'));near(cells.amount.result,7.5);near(cells.deduction.result,7.5*.115);
});

test('核价汇总及客户Excel按显式不含税设置移除原表车缝退税',async()=>{
 const {buildVerificationRow,buildVerificationWorkbook}=require('../backend/services/verificationSummary');
 const cells={},groups=[];
 const add=(title,row,labels,values)=>{const h=labels.map((_,i)=>'s!'+String.fromCharCode(65+i)+row),v=h.map(id=>id.replace(String(row),String(row+1)));h.forEach((id,i)=>cells[id]={v:labels[i]});v.forEach((id,i)=>cells[id]={v:values[i]});groups.push({title,rows:[h,v]});};
 add('货价与材料',1,['货价','车衣','车发'],[30,10,0]);
 add('包装与外购',4,['纸箱'],[0]);
 add('人工与成本',7,['总成本','不含人工成本'],[10,10]);
 add('减税与税后结果',10,['车衣类13%','车发类13%'],[.115,.115]);
 groups[3].rows.push(['s!A13','s!B13']);cells['s!A13']={v:1.15};cells['s!B13']={v:0};cells['s!K1']={v:1.15};cells['s!K2']={v:8.85};
 const model={cells,groups,metrics:{price:'s!A2',total:'s!A8',no_labor:'s!B8',deduction:'s!K1',after_cost:'s!K2'}};
 const s=sections({sales:{legacy_import:{excel_model:model}},sewing:{tax_label:'不含税'}});
 const r=buildVerificationRow(quote,{id:1,label:'V1',status:'drafting'},s,[{customer:'TOMY',sku:'SEW',qty:100,source:'test'}]);
 assert.equal(r.values.BM,10);assert.equal(r.values.BN,10);near(r.values.CY,0);near(r.values.CZ,10);assert.equal(r.values.CW,0);
 const wb=buildVerificationWorkbook([r]),saved=new(require('exceljs').Workbook)();await saved.xlsx.load(await wb.xlsx.writeBuffer());
 const ws=saved.getWorksheet('TOMY');assert.equal(ws.getCell('BN5').result,10);assert.equal(ws.getCell('CW5').result,0);
 assert.match(ws.getCell('BN5').formula,/BM5-CW5\*11.5%/);
});

test('车缝编辑器可以保存整单及分组的不含税选择',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const node=()=>({innerHTML:'',textContent:'',style:{},children:[],nodes:new Map(),appendChild(v){this.children.push(v);},querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,node());return this.nodes.get(k);},querySelectorAll(){return [];}});
 const host=node(),data={sewing_groups:[group(10)]};let changed=0;
 const context=vm.createContext({window:{},document:{createElement:node},num:v=>Number(v)||0,formatNum:String,escapeHtml:String,sum:(rows,fn)=>(rows||[]).reduce((a,b)=>a+fn(b),0),renderLegacyItems(){},renderTable(){},isSewLaborRow:()=>false,sewLaborToAdd:()=>0});
 vm.runInContext(source.slice(source.indexOf('function renderSewing('),source.indexOf('\nfunction renderCartonCalc(')),context);
 context.renderSewing(host,data,true,()=>changed++,1);
 assert.match(host.innerHTML,/不含税（不退税）/);
 host.querySelector('#sw-tax-label').onchange({target:{value:'不含税'}});
 assert.equal(data.tax_label,'不含税');assert.equal(changed,1);
});

test('旧表只有车衣时，未税设置同步移除合计退税和Excel税后成本',async()=>{
 const {buildVerificationRow,buildVerificationWorkbook}=require('../backend/services/verificationSummary');
 const cells={},groups=[];
 const add=(title,row,labels,values)=>{const h=labels.map((_,i)=>'s!'+String.fromCharCode(65+i)+row),v=h.map(id=>id.replace(String(row),String(row+1)));h.forEach((id,i)=>cells[id]={v:labels[i]});v.forEach((id,i)=>cells[id]={v:values[i]});groups.push({title,rows:[h,v]});};
 add('货价与材料',1,['货价','车衣'],[30,10]);add('包装与外购',4,['纸箱'],[0]);
 add('人工与成本',7,['总成本','不含人工成本'],[10,10]);add('减税与税后结果',10,['车衣类13%'],[.115]);
 groups[3].rows.push(['s!A13']);cells['s!A13']={v:1.15};cells['s!K1']={v:1.15};cells['s!K2']={v:8.85};
 const model={cells,groups,metrics:{price:'s!A2',total:'s!A8',no_labor:'s!B8',deduction:'s!K1',after_cost:'s!K2'}};
 const s=sections({sales:{legacy_import:{excel_model:model}},sewing:{tax_label:'不含税'}});
 const r=buildVerificationRow(quote,{id:1,label:'V1',status:'drafting'},s,[{customer:'TOMY',sku:'SEW',qty:100,source:'test'}]);
 assert.equal(r.values.BI,null);assert.equal(r.values.BJ,null);assert.equal(r.values.CV,null);
 assert.equal(r.values.BN,10);assert.equal(r.values.CW,0);near(r.values.CY,0);near(r.values.CZ,10);
 const saved=new(require('exceljs').Workbook)();await saved.xlsx.load(await buildVerificationWorkbook([r]).xlsx.writeBuffer());
 const ws=saved.getWorksheet('TOMY');near(ws.getCell('CY5').result,0);near(ws.getCell('CZ5').result,10);
 assert.match(ws.getCell('CY5').formula,/CW5\*11.5%/);assert.doesNotMatch(ws.getCell('CY5').formula,/CV5/);
});

test('SPIN四种工艺及单列人工保留成本，仅布料参与退税；其他客户保持原口径', async()=>{
 const sewing={tax_label:'含税',sewing_groups:[{category:'车衣',product_qty:1,labor_amount:6,items:[
  {fabric:'布料',usage:1,mat_price:10},
  ...['电绣','裁床','车缝','手工'].map((craft,i)=>({fabric:'工费',craft,usage:1,mat_price:i+2})),
 ]}]};
 assert.equal(Tax.hasSetting({...sewing,tax_label:''},'SPIN'),true);
 for(const customer of ['SPIN','SpinMaster-毛绒（印尼）','SPINMASTER','TOMY']){
  const q={...quote,customer}, s=sections(payload(sewing)), r=buildQuoteSummary(q,s);
  const eligible=customer==='TOMY'?30:10;
  near(r.components_before_tax.sewing_cloth,30);
  near(r.sewing_taxable.sewing_cloth,eligible);
  near(r.components.sewing_cloth,30-eligible*.115);
  near(r.summary_values.cloth_13_cost,eligible);
  const wb=await buildWorkbook({quote:q,sections:s});
  const tax=taxCells(wb.getWorksheet('报价明细'));
  near(tax.amount.result,eligible);near(tax.deduction.result,eligible*.115);
 }
 const allLabor={sewing_groups:[{items:[{fabric:'裁床人工',usage:1,mat_price:3},{fabric:'车缝人工',usage:1,mat_price:4},{fabric:'手工人工',usage:1,mat_price:5},{fabric:'绣花',usage:1,mat_price:2}],labor_amount:12}]};
 near(Tax.fractions(allLabor,'SPIN').sewing_cloth,0);
});

test('SPIN按产品用量、车衣车发分别计算可退税材料，含税选择不能让工费参与退税',()=>{
 const sew={sewing_groups:[
  {category:'车衣',product_qty:2,items:[{fabric:'布料',usage:1,mat_price:10},{fabric:'工费',craft:'电绣',usage:1,mat_price:10}]},
  {...group(20,'不含税'),product_qty:1},
  {category:'车发',product_qty:1,items:[{fabric:'头发',usage:1,mat_price:8},{fabric:'手工',usage:1,mat_price:4}]},
 ]};
 const r=buildQuoteSummary({...quote,customer:'SPIN'},sections(payload(sew)));
 near(r.components_before_tax.sewing_cloth,15);near(r.sewing_taxable.sewing_cloth,5);
 near(r.components_before_tax.sewing_hair,3);near(r.sewing_taxable.sewing_hair,2);
 assert.equal(Tax.craftFor({craft:'手工',fabric:'电绣'}),'手工');
 assert.equal(Tax.craftFor({material:'裁床人工'}),'裁床');
 assert.equal(Tax.isSpin('TOMY'),false);
});

test('SPIN网页和汇总Excel一致使用材料退税基数，工艺下拉提供四项',async()=>{
 const sew={sewing_groups:[{items:[{fabric:'布料',usage:1,mat_price:10},{fabric:'加工',craft:'电绣',usage:1,mat_price:10}]}]};
 const q={...quote,customer:'SPIN'},s=sections(payload(sew)),r=buildQuoteSummary(q,s);
 const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const host={innerHTML:'',querySelector:()=>null};
 const context=vm.createContext({window:{SewingTax:Tax,__data:{quote:q,sections:s}},num:v=>Number(v)||0,sum:obj=>Object.values(obj||{}).reduce((a,b)=>a+(Number(b)||0),0),formatNum:String});
 vm.runInContext(source.slice(source.indexOf('function renderTaxDeductionBlock('),source.indexOf('\nfunction hasSlushCostingInputs(')),context);
 const sales={};context.renderTaxDeductionBlock(host,sales,null,{}, {base_price:40,sewing_hair:0,sewing_cloth:20});
 near(sales.pricing_summary.t4.sewcloth13.amt,10);
 const wb=buildSummaryWorkbook([r]),keys=[...BASE_SUMMARY_COLUMNS,...SUMMARY_COLUMNS],ws=wb.getWorksheet('各客报价汇总');
 const cell=key=>ws.getCell(5,keys.findIndex(c=>c[0]===key)+1);
 near(cell('cloth_13_cost').result,10);near(cell('sewing_cloth_after_tax').result,18.85);
 assert.match(source,/spinSewing \? \['电绣', '裁床', '车缝', '手工'\]/);
});

test('SPIN混装按各小产品和共用费用分别排除工费退税',()=>{
 const make=(material,labor)=>({sewing_groups:[{items:[{fabric:'布料',usage:1,mat_price:material},{fabric:'加工',craft:'手工',usage:1,mat_price:labor}]}]});
 const p=payload({mixed_products:{a:make(10,10),b:make(4,6)},mixed_shared:make(0,5)});
 p.sales.mixed_quote={enabled:true,na_direct:true,mode:'ratio',units_per_pack:1,products:[{id:'a',code:'A',name:'A',ratio:.25,na_ratio:.25},{id:'b',code:'B',name:'B',ratio:.75,na_ratio:.75}]};
 p.molding={mixed_molds:[]};
 const r=buildQuoteSummary({...quote,customer:'SPIN'},sections(p));
 near(r.components_before_tax.sewing_cloth,17.5);near(r.sewing_taxable.sewing_cloth,5.5);
 near(r.components.sewing_cloth,17.5-5.5*.115);
});

test('SPIN原表核价汇总即使未设置整单不含税，也排除已识别电绣工费',()=>{
 const {buildVerificationRow}=require('../backend/services/verificationSummary');
 const cells={},groups=[];
 const add=(title,row,labels,values)=>{const h=labels.map((_,i)=>'s!'+String.fromCharCode(65+i)+row),v=h.map(id=>id.replace(String(row),String(row+1)));h.forEach((id,i)=>cells[id]={v:labels[i]});v.forEach((id,i)=>cells[id]={v:values[i]});groups.push({title,rows:[h,v]});};
 add('货价与材料',1,['货价','车衣','车发'],[30,10,0]);
 add('包装与外购',4,['纸箱'],[0]);
 add('人工与成本',7,['总成本','不含人工成本'],[10,10]);
 add('减税与税后结果',10,['车衣类13%','车发类13%'],[.115,.115]);
 groups[3].rows.push(['s!A13','s!B13']);cells['s!A13']={v:1.15};cells['s!B13']={v:0};cells['s!K1']={v:1.15};cells['s!K2']={v:8.85};
 const model={cells,groups,metrics:{price:'s!A2',total:'s!A8',no_labor:'s!B8',deduction:'s!K1',after_cost:'s!K2'}};
 const s=sections({sales:{legacy_import:{excel_model:model}},sewing:{sewing_groups:[{items:[{fabric:'布料',usage:1,mat_price:5},{craft:'电绣',usage:1,mat_price:5}]}]}});
 const q={...quote,customer:'SPIN'};
 const r=buildVerificationRow(q,{id:1,label:'V1',status:'drafting'},s,[{customer:'SPIN',sku:'SEW',qty:100,source:'test'}]);
 near(r.values.BM,10);near(r.values.CW,5);near(r.values.BN,9.425);
});

test('SPIN截图四行：名称为裁床、车缝、手工而工艺留空时也不退税',()=>{
 const sewing={tax_label:'含税',sewing_groups:[{items:[
  {fabric:'其余材料合计',usage:1,mat_price:16.1172},
  {fabric:'脸部 密绣眼睛',craft:'电绣',usage:1,mat_price:1.6995},
  {fabric:'裁床',craft:'',usage:1,mat_price:2.3697},
  {fabric:'车缝',craft:'',usage:1,mat_price:4.93},
  {fabric:'手工',craft:'',usage:1,mat_price:1.995},
 ]}]};
 const result=buildQuoteSummary({...quote,customer:'SPIN'},sections(payload(sewing)));
 near(result.components_before_tax.sewing_cloth,27.1114);
 near(result.sewing_taxable.sewing_cloth,16.1172);
 near(result.components.sewing_cloth,27.1114-16.1172*.115);
});
