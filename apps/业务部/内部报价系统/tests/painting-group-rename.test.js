const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
const code=source.slice(source.indexOf('function renamePaintingProductGroup('),source.indexOf('function renderPaintingTable('));
const context=vm.createContext({crypto:require('node:crypto')});
vm.runInContext(code,context);
const rename=context.renamePaintingProductGroup;
test('rename preserves stable group identity, ratios, costs and custom row names',()=>{
 const p={painting_items:[{product_group_id:'a',product_group_name:'旧名',name:'旧名',pad_qty:3},{product_group_id:'a',product_group_name:'旧名',name:'独立部件'}],product_mix_ratios:{a:2}};
 rename(p,'a','新名');
 assert.equal(p.painting_items[0].name,'新名');
 assert.equal(p.painting_items[1].name,'独立部件');
 assert.equal(p.painting_items[0].pad_qty,3);
 assert.equal(p.painting_items[0].product_group_id,'a');
 assert.equal(p.product_mix_ratios.a,2);
});
test('unnamed and legacy name-only groups migrate their ratios without merging',()=>{
 for(const old of ['', '旧名']) {
  const key=old || '__ungrouped__';
  const p={painting_items:[{product_group_name:old,name:old},{product_group_id:'b',product_group_name:'其他'}],product_mix_ratios:{[key]:0,b:2}};
  rename(p,key,'新名');
  const id=p.painting_items[0].product_group_id;
  assert.ok(id.startsWith('manual-product-'));
  assert.equal(p.product_mix_ratios[id],0);
  assert.equal(p.product_mix_ratios[key],undefined);
  assert.equal(p.painting_items[1].product_group_name,'其他');
  assert.throws(()=>rename(p,id,''),/请填写/);
  assert.throws(()=>rename(p,id,'其他'),/已存在/);
 }
});
