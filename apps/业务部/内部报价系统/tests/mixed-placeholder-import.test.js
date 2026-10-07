const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importParts, unusedPlaceholders } = require('../backend/services/mixedPartImport');
const config = () => ({ enabled:true, mode:'equal', units_per_pack:1, products:[1,2].map(n=>({id:`p${n}`,code:`P${n}`,name:`小产品 ${n}`,ratio:1})) });
const molds = [{mold_no:'01M',parts:[{name:'01-瓶盖'},{name:'02-瓶身'}]}];
test('empty mixed quote derives only actual numbered products',()=>{
 const result=importParts({...config(),products:[]},{},molds);
 assert.deepEqual(result.config.products.map(p=>p.code),['01','02']);
 assert.equal(result.summary.total_products,2);
});
test('reimport removes unused defaults even after numbered products exist',()=>{
 const first=importParts(config(),{},molds);
 const ids=unusedPlaceholders(first.config,[first.engineering]);
 const next=importParts(first.config,first.engineering,molds,{placeholderIds:ids});
 assert.deepEqual(next.config.products.map(p=>p.code),['01','02']);
 // 按持久化口径比较：undefined 键在 JSON 保存时会被丢弃，不参与深比较
 assert.deepEqual(JSON.parse(JSON.stringify(next.engineering.mixed_imported_parts)),JSON.parse(JSON.stringify(first.engineering.mixed_imported_parts)));
 assert.equal(next.summary.added,0);
});
test('saved data, pending data, selection and edited names protect placeholders',()=>{
 assert.deepEqual(unusedPlaceholders(config(),[{mixed_products:{p1:{electronics:[{name:'IC',price:2}]}}}]),['p2']);
 assert.deepEqual(unusedPlaceholders(config(),[{parts_catalog:{selections:{p2:[{part_id:'x'}]}}}]),['p1']);
 const cfg=config(); cfg.products[0].name='客户产品';
 assert.deepEqual(unusedPlaceholders(cfg,[{}]),['p2']);
});
test('removing a product keeps other mold ownership and shared catalog definitions',()=>{
 const {removeMixedProducts}=require('../backend/services/removeMixedProducts');
 const data={parts_catalog:{parts:[{id:'a'}],selections:{p1:[{part_id:'a'}],p2:[{part_id:'a'}]}},mixed_molds:[{mold_no:'shared',parts:[{product_id:'p1'},{product_id:'p2'}]},{mold_no:'p1-only',parts:[{product_id:'p1'}]}]};
 const after=removeMixedProducts(data,['p1']);
 assert.deepEqual(after.parts_catalog.parts,data.parts_catalog.parts);
 assert.deepEqual(after.parts_catalog.selections,{p2:[{part_id:'a'}]});
 assert.deepEqual(after.mixed_molds,[{mold_no:'shared',parts:[{product_id:'p2'}]}]);
 assert.equal(data.mixed_molds[0].parts.length,2);
});

test('P-prefixed names group matching parts and shared parts by product code',()=>{
 const {productNumbers,summarize}=require('../backend/services/mixedPartImport');
 assert.deepEqual(productNumbers('P66水瓶'),['P66']);
 assert.deepEqual(productNumbers('ｐ０９-瓶盖'),['P09']);
 assert.deepEqual(productNumbers('P25大披萨盒子/P51鸡蛋盒子'),['P25','P51']);
 assert.deepEqual(productNumbers('04、21-共用盖'),['04','21']);
 assert.deepEqual(productNumbers('PP塑料'),[]);
 const input=[{mold_no:'MNFRG-03M-01',parts:[{name:'P62康普茶'},{name:'P48千层饼上件'},{name:'P48千层饼下件'}]}];
 assert.equal(summarize(input).product_count,2);
 const first=importParts({...config(),products:[]},{},input);
 const product=first.config.products.find(p=>p.code==='P48');
 assert.equal(first.engineering.mixed_part_selections[product.id].length,2);
 const again=importParts(first.config,first.engineering,input);
 assert.equal(again.summary.added,0);
 assert.equal(again.summary.assigned,0);
 assert.equal(again.config.products.length,2);
});

test('replace rebuilds products by file codes, preserving matching product data; append keeps old products',()=>{
 const cfg={...config(),products:[{id:'old',code:'01',name:'旧款',ratio:1},{id:'keep',code:'P48',name:'千层饼',ratio:1}]};
 const engineering={mixed_products:{old:{packaging:[{name:'旧包装'}]},keep:{note:'保留'}},mixed_pricing:{old:{price:3}}};
 const input=[{mold_no:'03M',parts:[{name:'P48千层饼上件'},{name:'P48千层饼下件'},{name:'P66水瓶'}]}];
 const result=importParts(cfg,engineering,input,{mode:'replace'});
 assert.deepEqual(result.config.products.map(p=>p.code),['P48','P66']);
 assert.equal(result.config.products[0].id,'keep');
 assert.deepEqual(result.engineering.mixed_products,{keep:{note:'保留'}});
 assert.deepEqual(result.engineering.mixed_pricing,{});
 assert.deepEqual(result.summary.removed_product_ids,['old']);
 assert.equal(result.engineering.mixed_part_selections.keep.length,2);
 const append=importParts(cfg,engineering,input,{mode:'append'});
 assert.equal(append.config.products.length,3);
 assert.deepEqual(append.summary.removed_product_ids,[]);
 assert.ok(engineering.mixed_products.old);
});
