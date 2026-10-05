const test = require('node:test');
const assert = require('node:assert/strict');
const {productNumbers,summarize,importParts} = require('../backend/services/mixedPartImport');
const config = {enabled:true,mode:'equal',units_per_pack:6,products:[{id:'p1',code:'P1',name:'小产品 1'},{id:'p2',code:'P2',name:'小产品 2'}]};
const molds = [{mold_no:'M1',material:'ABS',parts:[{name:'52、53、54-瓶盖',cavity:4,weight_g:2},{name:'52-瓶身',cavity:2},{name:'无序号配件'}]}, {mold_no:'M2',parts:[{name:'53-瓶身'},{name:'54-瓶身'}]}];
test('多个前缀序号全量归属，保留前导零，不误读模号或尺寸',()=>{
 assert.deepEqual(productNumbers('52、53、54-瓶盖'),['52','53','54']);
 assert.deepEqual(productNumbers('０１，02/01－瓶盖'),['01','02']);
 assert.deepEqual(productNumbers('33M-转水口'),[]);
 assert.deepEqual(productNumbers('瓶盖52'),[]);
 assert.deepEqual(productNumbers('52-瓶身2'),['52']);
});
test('按去重产品数统计，共用配件一个实体多个引用，重复导入保留用量和改价',()=>{
 const summary = summarize(molds);
 assert.equal(summary.product_count,3);assert.equal(summary.part_count,5);assert.deepEqual(summary.unmatched,['无序号配件']);
 const first = importParts(config,{},molds,{replacePlaceholders:true,sourceFile:'test.xlsx'});
 assert.deepEqual(first.config.products.map(p=>p.code),['52','53','54']);assert.equal(first.config.units_per_pack,6);
 const cap=first.engineering.mixed_imported_parts.find(p=>p.name.includes('瓶盖'));
 for(const p of first.config.products) assert.equal(first.engineering.mixed_part_selections[p.id][0].part_id,cap.id);
 first.engineering.mixed_part_selections.number_52[0].usage=3;cap.material_unit_price=.25;
 const second=importParts(first.config,first.engineering,molds,{sourceFile:'test.xlsx'});
 assert.equal(second.summary.added,0);assert.equal(second.summary.assigned,0);
 assert.equal(second.engineering.mixed_part_selections.number_52[0].usage,3);
 assert.equal(second.engineering.mixed_imported_parts.find(p=>p.id===cap.id).material_unit_price,.25);
 assert.equal(second.engineering.mixed_imported_molds.length,2);
});
test('保留已有产品名称和比例；同名不同模具保持独立；拒绝歧义货号',()=>{
 const cfg={...config,products:[{id:'a',code:'52',name:'已有产品',ratio:.3},{id:'b',code:'99',name:'其他产品',ratio:.7}]};
 const r=importParts(cfg,{},[...molds,{mold_no:'M3',parts:[{name:'52-瓶身'}]}]);
 assert.equal(r.config.products[0].name,'已有产品');assert.equal(r.config.products[0].ratio,.3);
 assert.equal(r.engineering.mixed_part_selections.a.length,3);
 assert.throws(()=>importParts({...cfg,products:[...cfg.products,{id:'c',code:'052',name:'重复'}]}, {}, molds),/多个现有小产品/);
});
