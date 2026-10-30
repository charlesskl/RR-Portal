const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../frontend/mixed-molds');
const {calculateMixedQuote}=require('../backend/services/mixedQuotation');
function calculations(){
 const source=fs.readFileSync(require.resolve('../frontend/workbench.js'),'utf8');
 const names=['hasFreeRmbPrice','hasFreeUsdPrice','hasFreeUsdRawPrice','usesFreeUsdPrice','freeUsdSourcePrice','freeUnitHkd','freeAmountHkd','cartonBoxPrice','cartonFlatPrice','engineeringCartonDetails','engineeringMoldCostTotals','engineeringSummaryTotals'];
 const context={num:value=>Number(value)||0,sum:(rows,get)=>(rows||[]).reduce((total,row)=>total+get(row),0),parseFormulaInput:Number,defaultCartonRate:()=>2.75};
 vm.createContext(context);
 for(const name of names){const start=source.indexOf('function '+name+'('),next=source.slice(start+1).search(/^function /m);assert.ok(start>=0&&next>=0,name);vm.runInContext(source.slice(start,start+1+next),context);}
 return context;
}
const calculators=calculations(),totals=calculators.engineeringSummaryTotals;
test('旧报价未存纸价时按服务端固定回退计算，不套用今日工厂默认值',()=>{
 const oldDefault=calculators.defaultCartonRate;
 calculators.defaultCartonRate=()=>9.5;
 try {
  const c={cartons:[{cl:10,cw:8,ch:6,qty:12,flat_cards:[]}]};
  assert.equal(calculators.engineeringCartonDetails(c)[0].rate,2.75);
  assert.equal(totals({carton_calc:c},.85,7.8).carton,(10+8+2)*(8+6+1)*2*2.75/1000/12);
 } finally {calculators.defaultCartonRate=oldDefault;}
});
const cfg={enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'SKU-001',name:'第一款',ratio:1},{id:'b',code:'SKU-002',name:'第二款',ratio:1}]};
const fixture=()=>({mixed_products:{a:{hardware:[{name:'螺丝',qty:2,unit_price_rmb:.85}],aux_materials:[{name:'其他',is_subtotal:true,amount:.3}],packaging_materials:[{name:'彩盒',qty:1,source_currency:'USD',unit_price_usd:.2}],indo_pct:10,molds:[{mold_no:'M1',name:'瓶',parts:[{name:'盖'},{name:'身'}]}],mold_costs:{items:[{price_rmb:100}]}},b:{}},mixed_shared:{packaging_materials:[{name:'胶袋',qty:1,unit_price:.1}]}});

test('工程概览金额沿用明细币种换算、纸箱和平卡公式，不更改草稿',()=>{
 const root=fixture(),payload=root.mixed_products.a;
 root.mixed_products.b.hardware=[{name:'其他五金',qty:1,unit_price:1}];
 payload.carton_calc={paper_rate:2.75,cartons:[{cl:10,cw:8,ch:6,qty:12,flat_cards:[{l:0,w:0,qty:2}]},{cl:0,cw:0,ch:0,qty:1,flat_cards:[]}]};
 const before=JSON.stringify(root),cost=totals(payload,.85,7.8);
 assert.equal(cost.hardware,2);assert.equal(cost.auxiliary,.3);assert.equal(cost.packaging,1.56);assert.equal(cost.mold_rmb,100);
 const box=(10+8+2)*(8+6+1)*2*2.75/1000/12+(10+1)*(8+1)*2/1000*2;
 assert.ok(Math.abs(cost.carton-box)<1e-12);
 const sections=Object.entries({sales:{mixed_quote:cfg,header:{fx_rmb_hkd:.85,fx_hkd_usd:7.8}},engineering:root}).map(([dept,p])=>({dept,payload_json:JSON.stringify(p)}));
 const result=calculateMixedQuote({qty:100},sections,{strict:true});
 const sum=Object.entries(result.products[0].components).reduce((total,[key,value])=>total+(key==='abs_material'?0:value),0);
 assert.ok(Math.abs(cost.total-sum)<1e-12);
 assert.equal(JSON.stringify(root),before);
 assert.equal(totals({},.85,7.8).total,0);
});

function element(){return {nodes:{},children:[],_html:'',dataset:{},style:{},rows:[],textContent:'',value:'',selectedOptions:[{textContent:'包装材料'}],
 get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.nodes={};this.children=[];},
 addEventListener(){},appendChild(node){this.children.push(node);},append(...nodes){this.children.push(...nodes);},insertBefore(node){this.children.push(node);},
 querySelector(key){return this.nodes[key] ||= element();},
 querySelectorAll(key){
  const attributes={'[data-engineering-product]':['data-engineering-product','engineeringProduct'],'[data-open-engineering-product]':['data-open-engineering-product','openEngineeringProduct']};
  if(!attributes[key])return [];
  const [attribute,name]=attributes[key];
  return this.nodes[key] ||= [...this._html.matchAll(new RegExp(attribute+'="([^"]+)"','g'))].map(match=>({dataset:{[name]:match[1]},hidden:false}));
 },
};}
function setup(configuration=cfg,{root=fixture(),molding={}}={}){
 const host=element(),rendered=[],session=new Map();let changes=0;
 const window={MixedMolds:M,...calculators,renderMolds(){},renderImageCell(){},attachSupplierMaterialImportUI(){},__data:{quote:{id:12,qty:100},mixed_quote:configuration,sections:[{dept:"molding",payload_json:JSON.stringify(molding)}]}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/mixed-quotation.js'),'utf8'),{window,document:{createElement:element},sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value)}});
 window.MixedQuotation.wrap((box,payload,edit,onChange)=>rendered.push({payload,edit,onChange}),'engineering')(host,root,true,()=>changes++,.85,7.8,100);
 return {window,host,root,rendered,detail:host.querySelector('.mixed-detail'),get tables(){return host.querySelector('.mixed-detail').querySelector('[data-engineering-tables]');},changes:()=>changes};
}

test('60款工程完整明细集中展示，保留六类明细、每款小计、分类合计和各款汇总',()=>{
 const products=Array.from({length:60},(_,index)=>({id:index===0?'a':index===1?'b':'p'+index,code:'SKU-'+String(index+1).padStart(3,'0'),name:'产品'+index,ratio:1}));
 const s=setup({...cfg,products});
 assert.equal(s.rendered.length,0);assert.equal(s.detail.children.length,0);
 const html=s.tables.innerHTML;
 const overview=html.slice(html.indexOf('<details class="mixed-engineering-product-totals"'));
 assert.equal([...overview.matchAll(/data-engineering-product=/g)].length,61);
 assert.deepEqual([...overview.matchAll(/data-engineering-product="([^"]+)"/g)].map(match=>match[1]),[...products.map(p=>p.id),'__shared__']);
 for(const label of ['模具及零件明细','生产模具费用明细','五金明细','辅助材料明细','包装材料明细','纸箱及平卡明细','规格','用量 / 公式','原币单价 / 公式','本款小计','当前产品分类合计','螺丝','彩盒','胶袋'])assert.ok(html.includes(label),label);
 assert.match(html,/mixed-engineering-detail-book/);
 assert.equal(s.changes(),0);
});

test('工程货号进入对应草稿，返回刷新汇总并保留搜索和滚动，共有费用可单独打开',()=>{
 const s=setup(),open=id=>s.tables.querySelectorAll('[data-open-engineering-product]').find(button=>button.dataset.openEngineeringProduct===id).onclick();
 s.detail.querySelector('[data-engineering-search]').oninput({target:{value:'第二款'}});
 s.tables.querySelector('.mixed-scroll').scrollTop=120;
 open('b');assert.equal(s.rendered[0].payload,s.root.mixed_products.b);assert.equal(s.rendered[0].edit,true);
 s.rendered[0].payload.hardware=[{name:'新物料',qty:1,unit_price:3}];s.rendered[0].onChange();
 s.detail.children[0].querySelector('button').onclick();
 assert.match(s.tables.innerHTML,/3\.0000/);
 assert.equal(s.detail.querySelector('[data-engineering-search]').value,'第二款');
 assert.equal(s.tables.querySelector('.mixed-scroll').scrollTop,120);
 assert.ok(!s.tables.innerHTML.includes('SKU-001'));assert.ok(s.tables.innerHTML.includes('SKU-002'));
 assert.equal(s.changes(),1);s.detail.querySelector('[data-engineering-search]').oninput({target:{value:''}});open('__shared__');assert.equal(s.rendered[1].payload,s.root.mixed_shared);
});

test('完整明细筛选同步分类合计，不重复共有费用，转义物料内容',()=>{
 const s=setup();
 s.root.mixed_products.b.hardware=[{name:'<script>危险</script>',spec:'完整规格',qty:2,unit_price:3}];
 const before=JSON.stringify(s.root);
 s.detail.querySelector('[data-engineering-search]').oninput({target:{value:'第二款'}});
 assert.match(s.tables.innerHTML,/&lt;script&gt;危险&lt;\/script&gt;/);
 assert.ok(!s.tables.innerHTML.includes('<script>'));
 assert.match(s.tables.innerHTML,/当前产品原值合计 HKD 6\.0000/);
 assert.ok(!s.tables.innerHTML.includes('胶袋'));
 assert.equal(JSON.stringify(s.root),before);
});

test('纸箱平卡逐行合计与总计相同；模费分摊沿用单款公式',()=>{
 const carton={paper_rate:2.75,cartons:[{name:'主箱',cl:10,cw:8,ch:6,qty:12,flat_cards:[{name:'衬卡',qty:2}]}]};
 const rows=calculators.engineeringCartonDetails(carton);
 assert.equal(rows.length,2);assert.equal(rows[1].l,10);assert.equal(rows[1].qty,2);
 assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),totals({carton_calc:carton},.85,7.8).carton);
 const c=calculators.engineeringMoldCostTotals({items:[{price_rmb:850}],fx_rmb_usd:8,customer_subsidy_usd:25,amortization_qty:100,prototype_fee_usd:10,prototype_amortization_qty:200,testing_fee_usd:20,testing_amortization_qty:400});
 assert.equal(c.sumUsd,125);assert.equal(c.perPcsUsd,1);assert.equal(c.perPcsRmb,8.5);assert.equal(c.prototypePerPcsUsd,.05);assert.equal(c.testingPerPcsUsd,.05);
});

test('新小产品不创建模费，历史本款模费保留可见编辑且按原比例计费，共有模费计一次',()=>{
 const s=setup();
 s.root.mixed_shared.mold_costs={items:[{name:'共用模费',price_rmb:200}]};
 s.detail.querySelector('[data-engineering-search]').oninput({target:{value:''}});
 const html=s.tables.innerHTML;
 const fees=html.slice(html.indexOf('<section data-engineering-category="mold_costs">'),html.indexOf('<section data-engineering-category="hardware">'));
 assert.match(fees,/共用模费/);assert.match(fees,/200\.0000/);
 assert.match(fees,/SKU-001/);assert.match(fees,/100\.0000/);assert.match(fees,/历史本款费用，按本款比例计入/);
 assert.match(html,/模具费用 RMB 300\.0000/);
 const source=fs.readFileSync(require.resolve('../frontend/workbench.js'),'utf8');
 const start=source.indexOf('function renderEngineering('),next=source.slice(start+1).search(/^function /m);
 const stop=new Error('stop after form rendering');
 const context={window:s.window,num:value=>Number(value)||0,cleanupMoldNumberObservers(){},renderLegacyItems(){},renderMolds(){throw stop;}};
 vm.createContext(context);vm.runInContext(source.slice(start,start+1+next),context);
 const inspect=payload=>{
   const host=element();
   assert.throws(()=>context.renderEngineering(host,payload,true,()=>{},.85,7.8),error=>error===stop);
   return host.innerHTML;
 };
 s.tables.querySelectorAll('[data-open-engineering-product]').find(button=>button.dataset.openEngineeringProduct==='b').onclick();
 assert.equal(s.window.MixedQuotation.showsEngineeringMoldCosts(s.root.mixed_products.b),false);
 assert.ok(!inspect(s.root.mixed_products.b).includes('生产模具费用'));
 assert.equal(s.root.mixed_products.b.mold_costs,undefined);
 s.detail.children[0].querySelector('button').onclick();
 s.tables.querySelectorAll('[data-open-engineering-product]').find(button=>button.dataset.openEngineeringProduct==='a').onclick();
 assert.equal(s.window.MixedQuotation.showsEngineeringMoldCosts(s.root.mixed_products.a),true);
 assert.match(inspect(s.root.mixed_products.a),/生产模具费用/);
 s.root.mixed_products.b.hardware=[{name:'第二款五金',qty:1,unit_price:1}];
 const sections=Object.entries({sales:{mixed_quote:cfg,header:{fx_rmb_hkd:.85,fx_hkd_usd:7.8}},engineering:s.root}).map(([dept,p])=>({dept,payload_json:JSON.stringify(p)}));
 const result=calculateMixedQuote({qty:100},sections,{strict:true});
 assert.ok(result.products[0].amortization_usd>0);
 assert.ok(result.amortization_usd>0);
 // Return and open the shared editor through the normal selector workflow.
 s.detail.children[0].querySelector('button').onclick();
 s.tables.querySelectorAll('[data-open-engineering-product]').find(button=>button.dataset.openEngineeringProduct==='__shared__').onclick();
 assert.equal(s.window.MixedQuotation.showsEngineeringMoldCosts(s.root.mixed_shared),true);
 assert.match(inspect(s.root.mixed_shared),/生产模具费用/);
 const ordinary={};assert.match(inspect(ordinary),/生产模具费用/);assert.ok(ordinary.mold_costs);
});

function moldSection(s){return s.tables.innerHTML.split('<section data-engineering-category="molds">')[1].split('</section>')[0];}
const catalogPart=(id,name)=>({id,mold_no:'14M',name,material:'ABS',color:'红色',weight_g:1,cavity:2});
test('零件库存在时，共有费用中直接导入的共用模具仍展示，金额与原资料保持不变',()=>{
 const root=fixture();
 root.mixed_shared.molds=[{mold_no:'COMMON-01',price_rmb:850,parts:[{name:'共用模具零件',material:'PP'}]}];
 const before=JSON.stringify(root),molding={parts_catalog:{parts:[catalogPart('selected','已关联零件')],selections:{a:[{part_id:'selected',usage:1}]}}};
 const s=setup(cfg,{root,molding}),html=moldSection(s);
 assert.match(html,/COMMON-01/);assert.match(html,/共用模具零件/);assert.match(html,/850/);
 assert.match(html,/1000\.0000/);assert.match(html,/已关联零件/);
 assert.match(s.tables.innerHTML,/模具费用 RMB 100\.0000/);
 assert.equal(JSON.stringify(root),before);assert.equal(s.changes(),0);
});
test('未分配的导入零件在总览中明确显示，链接进入全部模具且不改动费用或关联',()=>{
 const root=fixture(),part={...catalogPart('upload_pending','待分配共用零件'),source_file:'<来源>.xlsx',price_rmb:170};
 root.mixed_imported_parts=[part];root.mixed_imported_molds=[{mold_no:'14M',parts:[part]}];
 const before=JSON.stringify(root),s=setup(cfg,{root}),html=moldSection(s);
 assert.match(html,/待分配共用零件/);assert.match(html,/已导入 · 待分配/);
 assert.match(html,/尚未分配到小产品或每包装共有费用/);
 assert.match(html,/&lt;来源&gt;\.xlsx/);assert.ok(!html.includes('<来源>'));
 assert.match(html,/data-open-engineering-product="__all_molds__"/);
 assert.match(s.tables.innerHTML,/模具费用 RMB 100\.0000/);
 assert.equal(JSON.stringify(root),before);assert.equal(s.changes(),0);
});
test('同一共用零件分别选入两个产品时保留两款引用，不误报待分配或重复旧行',()=>{
 const root=fixture(),part={...catalogPart('shared','双方共用零件'),price_rmb:170};
 root.mixed_products.a.molds=[{mold_no:'14M',parts:[{...part,price_rmb:85}]}];
 const molding={parts_catalog:{parts:[part],selections:{a:[{part_id:'shared',usage:1}],b:[{part_id:'shared',usage:2}]}}};
 const before=JSON.stringify({root,molding}),s=setup(cfg,{root,molding}),html=moldSection(s);
 assert.equal([...html.matchAll(/双方共用零件/g)].length,2);
 assert.ok(!html.includes('已导入 · 待分配'));
 assert.ok(!html.includes('<td>85</td>'));assert.equal([...html.matchAll(/<td>170<\/td>/g)].length,2);
 assert.equal(JSON.stringify({root,molding}),before);
});
test('已删除零件不会重新出现在待分配区，失效产品引用不会藏起现存零件',()=>{
 const root=fixture(),deleted=catalogPart('old','已删除零件'),orphan=catalogPart('current','现存未分配零件');
 root.mixed_deleted_part_ids=['old'];
 const molding={parts_catalog:{parts:[deleted,orphan],selections:{removed:[{part_id:'current',usage:1}]}}};
 const s=setup(cfg,{root,molding}),html=moldSection(s);
 assert.ok(!html.includes('已删除零件'));assert.match(html,/现存未分配零件/);
 assert.match(html,/已导入 · 待分配/);
});

test('共有模具同时保存在旧明细和未选零件库时仅显示一次，明确提示用量未配置',()=>{
 const root=fixture();
 const parts=[{id:'upload_upper',mold_no:'01M',name:'球上壳',weight_g:15,cavity:6,sets:6,material:'再生PP+PP',source_file:'共用球壳.xlsx'},
  {id:'upload_lower',mold_no:'02M',name:'球下壳',weight_g:19,cavity:6,sets:6,material:'再生PP+PP',source_file:'共用球壳.xlsx'}];
 root.mixed_shared.molds=parts.map(({id,source_file,...part})=>({...part,parts:[{name:part.name,weight_g:part.weight_g,material:part.material,cavity:String(part.cavity)}]}));
 root.mixed_imported_parts=parts;
 root.mixed_imported_molds=parts.map(part=>({...part,parts:[part]}));
 root.mixed_part_selections={a:[],b:[]};
 const before=JSON.stringify(root),s=setup(cfg,{root}),html=moldSection(s);
 for(const name of ['球上壳','球下壳'])assert.equal([...html.matchAll(new RegExp('<td>'+name+'</td>','g'))].length,1,name);
 assert.match(html,/共用球壳\.xlsx/);assert.match(html,/尚未配置零件库用量/);
 assert.ok(!html.includes('已导入 · 待分配'));
 assert.equal(JSON.stringify(root),before);assert.equal(s.changes(),0);
});

test('进入共有费用编辑时展开缺失用量配置，共用球壳在未选零件前列出，仍需正常保存',()=>{
 const root=fixture(),shared={...catalogPart('upload_shell','共用球壳'),mold_no:'COMMON'};
 root.mixed_shared.molds=[{...shared,parts:[shared]}];
 root.mixed_imported_parts=[shared];root.mixed_part_selections={a:[],b:[]};
 const molding={parts_catalog:{version:1,parts:[catalogPart('other','其他未选零件')],selections:{}}};
 const before=JSON.stringify(root),s=setup(cfg,{root,molding});
 s.tables.querySelectorAll('[data-open-engineering-product]').find(button=>button.dataset.openEngineeringProduct==='__shared__').onclick();
 const panel=s.detail.children.find(child=>child.className==='mixed-config');
 assert.ok(panel.open);assert.match(panel.innerHTML,/尚未配置每包装用量：共用球壳/);
 const html=panel.children[0].innerHTML;
 assert.ok(html.indexOf('data-part-id="upload_shell"')<html.indexOf('data-part-id="other"'));
 assert.match(html,/aria-label="共用球壳 用量"/);assert.match(html,/保存草稿/);
 assert.equal(JSON.stringify(root),before);assert.equal(s.changes(),0);
});
