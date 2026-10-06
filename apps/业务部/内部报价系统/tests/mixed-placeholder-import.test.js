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
 assert.deepEqual(next.engineering.mixed_imported_parts,first.engineering.mixed_imported_parts);
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
