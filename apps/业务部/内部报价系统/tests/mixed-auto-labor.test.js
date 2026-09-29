const test=require('node:test'), assert=require('node:assert/strict');
const M=require('../frontend/mixed-molds');
const cfg={enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'A',name:'A'},{id:'b',code:'B',name:'B'}]};
function root(){return {parts_catalog:{version:1,parts:[{id:'a',name:'A',mold_no:'M',machine_price:360,target:1000,cavity:2,production_demand:4000,shot_price:999},{id:'b',name:'B',mold_no:'M',machine_price:360,target:1000,cavity:4,production_demand:4000,shot_price:999}],selections:{a:[{part_id:'a',usage:1}],b:[{part_id:'b',usage:1}]}}};}
test('2出/4出各需求4000，完成封穴；忽略原啤价，费用守恒',()=>{const r=M.catalogRows(root(),cfg,8000);assert.ok(Math.abs(r.resolved.get('a').shot_price-.12)<1e-12);assert.ok(Math.abs(r.resolved.get('b').shot_price-.06)<1e-12);assert.ok(Math.abs([...r.resolved.values()].reduce((n,p)=>n+p.shot_price*p.labor_demand,0)-720)<1e-9);});
test('用量只乘零件成本，不改变手填需求；共有选用和订单变动也不改变需求',()=>{
 const r=root();r.parts_catalog.selections.b[0].usage=2;
 const v=M.catalogRows(r,cfg,8000);
 assert.ok(Math.abs(v.rows.b[0].shot_price-.12)<1e-12);
 assert.equal(v.resolved.get('b').labor_demand,4000);
 r.parts_catalog.selections.__shared__=[{part_id:'a',usage:1}];
 assert.equal(M.catalogRows(r,cfg,16000).resolved.get('a').labor_demand,4000);
});
test('缺少参数禁止沿用历史啤价',()=>{const r=root();delete r.parts_catalog.parts[0].target;assert.throws(()=>M.catalogRows(r,cfg,8000),/待补参数/);});
test('原表生产需求独立于混装比例，水瓶封穴啤工可重算',()=>{
 const r=root();const [a,b]=r.parts_catalog.parts;
 Object.assign(a,{cavity:6,machine_price:1160,target:3400,shared_source:{mold_no:'M',product_id:'a',name:'A'}});
 Object.assign(b,{cavity:2,machine_price:1160,target:3400,production_demand:2421});
 delete a.production_demand;
 r.mixed_molds=[{mold_no:'M',parts:[{product_id:'a',name:'A',demand:12396}]}];
 assert.ok(Math.abs(M.catalogRows(r,cfg,8000).resolved.get('a').shot_price-.04853356395801)<1e-14);
 a.production_demand=6000;assert.equal(M.catalogRows(r,cfg,8000).resolved.get('a').labor_demand,6000);
 a.production_demand='';assert.throws(()=>M.catalogRows(r,cfg,8000),/A 未填写生产需求量/);
});

test('已填生产需求量无需订单数量，空白需求仍提示具体零件',()=>{
 const r=root();r.parts_catalog.parts[0].production_demand=1345;r.parts_catalog.parts[1].production_demand=245;
 const expected=M.catalogRows(r,cfg,1000).resolved;
 for(const qty of [0,null,undefined,'']) {
   const actual=M.catalogRows(r,cfg,qty).resolved;
   assert.equal(actual.get('a').shot_price,expected.get('a').shot_price);
   assert.equal(actual.get('b').shot_price,expected.get('b').shot_price);
 }
 r.parts_catalog.parts[1].production_demand='';
 assert.throws(()=>M.catalogRows(r,cfg,0),/B 未填写生产需求量/);
 assert.throws(()=>M.catalogRows(r,cfg,1000),/B 未填写生产需求量/);
});

test('共有零件啤工直接按日费用除啤次除出模数，不需要需求量',()=>{
 const r=root();const a=r.parts_catalog.parts[0];a.production_demand='';
 delete r.parts_catalog.selections.a;
 r.parts_catalog.selections.__shared__=[{part_id:'a',usage:2}];
 for(const qty of [0,1000]) {
   const v=M.catalogRows(r,cfg,qty);
   assert.equal(v.resolved.get('a').shot_price,.18);
   assert.equal(v.rows.__shared__[0].shot_price,.36);
   assert.equal(v.resolved.get('a').direct_labor,true);
 }
 a.production_demand=1234;
 assert.equal(M.catalogRows(r,cfg,0).resolved.get('a').shot_price,.18);
});
