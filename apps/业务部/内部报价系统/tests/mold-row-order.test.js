const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const scriptSource=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
const context=vm.createContext({crypto:require('node:crypto')});
vm.runInContext(scriptSource.slice(scriptSource.indexOf('function canMoveMoldRow('),scriptSource.indexOf('function renderMolds(')),context);

test('moving a mold preserves its parts, images, prices and stable identities',()=>{
  const molds=[
    {id:'body',name:'车身',mold_no:'P01',price_rmb:100,images:['body.png'],parts:[{id:'part-body',name:'车身'}]},
    {id:'wheel',name:'前/后轮',mold_no:'P03',price_usd:20,images:['wheel.png'],parts:[{id:'part-wheel',cavity:8}]},
    {id:'fence',name:'栅栏',mold_no:'P04',price_rmb:300,images:['fence.png']},
  ];
  const original=new Map(molds.map(m=>[m.id,JSON.stringify(m)]));
  const wheel=molds[1];
  assert.equal(context.moveMoldRow(molds,1,-1),true);
  assert.equal(molds[0],wheel);
  assert.deepEqual(molds.map(m=>m.id),['wheel','body','fence']);
  const restored=JSON.parse(JSON.stringify({molds}));
  assert.deepEqual(restored.molds.map(m=>m.id),['wheel','body','fence']);
  for(const mold of restored.molds)assert.equal(JSON.stringify(mold),original.get(mold.id));
  assert.equal(context.moveMoldRow(molds,0,1),true);
  assert.deepEqual(molds.map(m=>m.id),['body','wheel','fence']);
});

test('invalid moves do not change the array or cross product group boundaries',()=>{
  const molds=[{id:1,product_group_id:'a'},{id:2,product_group_id:'a'},{id:3,product_group_id:'b'}];
  const before=JSON.stringify(molds);
  for(const [index,direction] of [[0,-1],[2,1],[1,1],[2,-1],[-1,1],[0,2],[0.5,1]]){
    assert.equal(context.moveMoldRow(molds,index,direction),false);
    assert.equal(JSON.stringify(molds),before);
  }
  assert.equal(context.moveMoldRow(molds,1,-1),true);
  assert.deepEqual(molds.map(m=>m.id),[2,1,3]);
});

test('copy inserts an independent mold within the same product group',()=>{
  const source={id:'m1',name:'车身',mold_no:'P01',product_group_id:'a',product_group_name:'产品A',price_rmb:85,images:['mold.png'],detail:{mold_size:'100*200'},parts:[{id:'p1',name:'车身',weight_g:30.4,images:['part.png']}]};
  const original=JSON.stringify(source);
  const molds=[source,{id:'m2',product_group_id:'b'}];
  const copy=context.copyMoldRow(molds,0);
  assert.equal(molds[1],copy);assert.equal(molds[2].id,'m2');
  assert.notEqual(copy.id,source.id);assert.notEqual(copy.parts[0].id,source.parts[0].id);
  assert.equal(copy.product_group_id,'a');assert.equal(copy.price_rmb,85);
  assert.equal(copy.images[0],'mold.png');assert.equal(copy.parts[0].images[0],'part.png');
  copy.images.push('other.png');copy.parts[0].weight_g=2;copy.parts[0].images.length=0;copy.detail.mold_size='300*400';
  assert.equal(JSON.stringify(source),original);
  assert.equal(context.copyMoldRow(molds,-1),null);
  const restored=JSON.parse(JSON.stringify({molds}));
  assert.equal(restored.molds[1].id,copy.id);assert.equal(restored.molds[1].parts[0].weight_g,2);
  // The deployed site also runs over HTTP, where randomUUID may be unavailable.
  const insecureContext=vm.createContext({crypto:{}});
  vm.runInContext(scriptSource.slice(scriptSource.indexOf('function canMoveMoldRow('),scriptSource.indexOf('function renderMolds(')),insecureContext);
  const insecureCopy=insecureContext.copyMoldRow([source],0);
  assert.notEqual(insecureCopy.id,source.id);
  assert.notEqual(insecureCopy.parts[0].id,source.parts[0].id);
});
