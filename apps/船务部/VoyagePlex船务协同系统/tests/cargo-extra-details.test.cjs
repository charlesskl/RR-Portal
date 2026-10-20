const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const ts=require('typescript');
function load(file){
 const source=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 new Function('module','exports','require',js)(module,module.exports,name=>name==='@/lib/cargo-extra-details'?load('lib/cargo-extra-details.ts'):name==='@radix-ui/react-dialog'?new Proxy({},{get:(_,key)=>`Dialog.${key}`}):require(name));
 return module.exports;
}
const {CargoExtraDetails}=load('components/cargo-extra-details.tsx');
function nodes(tree){if(!tree||typeof tree!=='object')return [];return [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];}
test('普通华登货物不因厂区显示特殊资料，普通品牌和尺寸也不触发',()=>{
 assert.equal(CargoExtraDetails({item:{brand:'ZURU',box_dimensions:'1*2*3'},company:'Huadeng',onChange:()=>{}}),null);
});
test('两条特殊货物的编辑回调和显示值彼此独立',()=>{
 const rows=[{product_code:'A',customer_item_number:'ITEM-A'},{product_code:'B',customer_item_number:'ITEM-B'}];
 const render=index=>CargoExtraDetails({item:rows[index],onChange:(key,value)=>{rows[index]={...rows[index],[key]:value};}});
 const input=tree=>nodes(tree).find(node=>node.type==='input'&&node.props['aria-label']==='客户 ITEM');
 assert.equal(input(render(0)).props.value,'ITEM-A');
 input(render(0)).props.onChange({target:{value:'NEW-A'}});
 assert.equal(input(render(0)).props.value,'NEW-A');assert.equal(input(render(1)).props.value,'ITEM-B');
 assert.ok(render(0));assert.ok(CargoExtraDetails({item:{},specialTemplate:true,onChange:()=>{}}));
});
test('历史重量核对入口不暴露特殊字段',()=>{
 const tree=CargoExtraDetails({item:{gross_weight:2},company:'Huadeng',onChange:()=>{}});
 assert.ok(nodes(tree).some(node=>node.type==='button'&&node.props.children==='核对旧重量'));
 assert.ok(!nodes(tree).some(node=>node.type==='input'&&node.props['aria-label']==='客户 ITEM'));
});
test('基础信息卡无更多制表入口，货物行入口保留',()=>{
 const source=fs.readFileSync('components/app-shell.tsx','utf8');
 assert.ok(!source.includes('HuadengExportDetails'));
 assert.ok(source.includes('<CargoExtraDetails item={item}'));
});
