const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const source=fs.readFileSync(require.resolve('../frontend/workbench.js'),'utf8');
 const start=source.indexOf('function renderShipping('),end=source.indexOf('\nfunction renderSales(',start);
 const nodes=new Map(),host={innerHTML:'',querySelector(key){if(!nodes.has(key))nodes.set(key,{style:{},value:'',textContent:''});return nodes.get(key);},querySelectorAll(){return [];}};
 const context={num:value=>Number(value)||0,sum:(rows,get)=>rows.reduce((total,row)=>total+get(row),0),escapeHtml:value=>String(value??''),parseFormulaInput:Number,
 FREIGHT_TYPES:[{key:'yt40',label:'盐田40柜'}],matchFreightByName:name=>name==='盐田40柜'?'yt40':null,document:{activeElement:null}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 let changes=0;
 return {host,render(payload,edit=false){return context.renderShipping(host,payload,{fx_rmb_hkd:.84,fx_hkd_usd:7.8},edit,()=>changes++,{yt40:10},5,null,{},{});},changes:()=>changes};
}
test('部分保存的运费参数缺少scenarios时可完整渲染，保留原码点和除数且不自动保存',()=>{
 for(const edit of [false,true]){
 const s=setup(),payload={shipping:{markup_x:1.15,divisor:.97}};
 const result=s.render(payload,edit);
 assert.equal(payload.shipping.markup_x,1.15);assert.equal(payload.shipping.divisor,.97);
 assert.equal(payload.shipping.scenarios.length,1);assert.equal(payload.shipping.scenarios[0].is_factory,true);
 assert.equal(result.rows.length,1);assert.ok(Number.isFinite(result.customerUSD));
 assert.match(s.host.innerHTML,/出厂价/);assert.match(s.host.innerHTML,/TOTAL \(USD\)/);assert.equal(s.changes(),0);
 }
});
test('空运费对象和非数组场景使用缺省值，多次渲染只保留一个出厂价',()=>{
 for(const shipping of [undefined,{}, {scenarios:null},{scenarios:{}}]){
 const s=setup(),payload={shipping};s.render(payload);const result=s.render(payload);
 assert.equal(payload.shipping.scenarios.length,1);assert.equal(payload.shipping.markup_x,1.2);assert.equal(payload.shipping.divisor,.98);
 assert.ok(Number.isFinite(result.customerUSD));assert.equal(s.changes(),0);
 }
});
test('已有运费场景和明确的零值保留，正常报价计算结果不变',()=>{
 const s=setup(),scenario={name:'盐田40柜',base_rmb:3,mold_share_rmb:2,custom:'keep'};
 const payload={shipping:{scenarios:[scenario],freight_pct:0,lifting_pct:0,markup_x:0,divisor:1,target_usd:0}};
 const result=s.render(payload);
 assert.equal(payload.shipping.scenarios.length,2);assert.equal(payload.shipping.scenarios[1],scenario);
 assert.equal(payload.shipping.freight_pct,0);assert.equal(payload.shipping.lifting_pct,0);assert.equal(payload.shipping.markup_x,0);
 assert.equal(scenario.custom,'keep');assert.equal(result.customerUSD,0);assert.equal(s.changes(),0);
});
