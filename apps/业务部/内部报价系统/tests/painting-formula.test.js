const test=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../backend/services/paintingFormula');
test('喷油公式保留原文并将计算值用于单品及混装',()=>{
 const p={painting_items:[{pad_qty_raw:'2+2',pad_qty:999,pad_unit_raw:'=0.04*1.2'}],mixed_products:{a:{painting_items:[{mask_qty_raw:'(3+1)/2',mask_unit_raw:'0.1'}]}}};
 normalize(p);
 assert.equal(p.painting_items[0].pad_qty,4);
 assert.equal(p.painting_items[0].pad_unit,.048);
 assert.equal(p.painting_items[0].pad_qty_raw,'2+2');
 assert.equal(p.mixed_products.a.painting_items[0].mask_qty,2);
 const saved=JSON.parse(JSON.stringify(p));normalize(saved);assert.deepEqual(saved,p);
});
test('错误公式和负值不能保存为零；普通数字不变',()=>{
 for(const raw of ['1/0','2+','alert(1)','-1'])assert.throws(()=>normalize({painting_items:[{pad_qty_raw:raw}]}),/算式无效/);
 assert.deepEqual(normalize({painting_items:[{pad_qty:4,pad_unit:.04}]}),{painting_items:[{pad_qty:4,pad_unit:.04}]});
});
