const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../frontend/mixed-molds');
const config = {enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'SKU-001',name:'一'},{id:'b',code:'SKU-002',name:'二'}]};
function fixture() {
  const engineering = {mixed_imported_parts:[
    {id:'cap',name:'01-盖',mold_no:'M1',machine_model:'10A',machine:'120T',target:2400,material:'ABS',weight_g:1,cavity:2,production_demand:4000},
    {id:'body',name:'02-身',mold_no:' M1 ',machine_model:'10A',machine:'120T',target:2400,material:'ABS',weight_g:2,cavity:4,production_demand:4000},
  ],mixed_part_selections:{a:[{part_id:'cap',usage:1}],b:[{part_id:'body',usage:2}]}};
  const root = M.engineeringCatalog({machine_prices:[{model:'10A',normal:'120T',price:1000},{model:'14A',normal:'150T',price:1200}]},engineering);
  return {engineering,root};
}
test('啤机机型与日产啤次经过保存同步、JSON重载和汇总计算仍保留，不被工程原值覆盖',()=>{
  const {engineering,root}=fixture(),source=JSON.stringify(engineering),part=root.parts_catalog.parts[0];
  M.updateCatalogMoldField(root,part,'machine_model','14A');M.updateCatalogMoldField(root,part,'target',3600);
  const expected=M.catalogRows(root,config,1000).resolved.get('cap').shot_cost;
  const saved=M.applyCatalog(M.engineeringCatalog(root,engineering),config,1000);
  const loaded=M.engineeringCatalog(JSON.parse(JSON.stringify(saved)),engineering);
  for(const p of loaded.parts_catalog.parts){assert.equal(p.machine_model,'14A');assert.equal(p.machine,'150T');assert.equal(p.target,3600);}
  assert.equal(M.catalogRows(loaded,config,1000).resolved.get('cap').shot_cost,expected);
  assert.equal(JSON.stringify(engineering),source);
  assert.deepEqual(loaded.parts_catalog.selections,engineering.mixed_part_selections);
});
test('工程更新材质重量及新增同模零件继续同步，手填生产参数应用到整模，其他模和空模号独立',()=>{
  const {engineering,root}=fixture();
  root.parts_catalog.parts.push({id:'manual',mold_no:'M2',machine_model:'10A',target:1000},{id:'empty1',mold_no:'',target:1000},{id:'empty2',mold_no:'',target:1000});
  M.updateCatalogMoldField(root,root.parts_catalog.parts[0],'target',3600);
  M.updateCatalogMoldField(root,root.parts_catalog.parts[3],'target',5000);
  const updated=structuredClone(engineering);updated.mixed_imported_parts[0].weight_g=3;updated.mixed_imported_parts[0].material='PP';
  updated.mixed_imported_parts.push({id:'new',mold_no:'M1',name:'新件',target:2400});
  const loaded=M.engineeringCatalog(root,updated),parts=loaded.parts_catalog.parts;
  assert.equal(parts.find(p=>p.id==='cap').weight_g,3);assert.equal(parts.find(p=>p.id==='cap').material,'PP');
  assert.equal(parts.find(p=>p.id==='new').target,3600);assert.equal(parts.find(p=>p.id==='manual').target,1000);
  assert.equal(parts.find(p=>p.id==='empty1').target,5000);assert.equal(parts.find(p=>p.id==='empty2').target,1000);
});
test('未手动修改时沿用工程新参数；手动清空的草稿不被工程原值回填',()=>{
  const {engineering,root}=fixture();const updated=structuredClone(engineering);
  updated.mixed_imported_parts.forEach(p=>p.target=3000);
  assert.ok(M.engineeringCatalog(root,updated).parts_catalog.parts.every(p=>p.target===3000));
  M.updateCatalogMoldField(root,root.parts_catalog.parts[0],'target','');
  assert.ok(M.engineeringCatalog(root,updated).parts_catalog.parts.every(p=>p.target===''));
});
