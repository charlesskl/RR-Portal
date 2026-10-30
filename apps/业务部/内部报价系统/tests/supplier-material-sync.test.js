const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../frontend/supplier-material-sync');
const supplier={id:'A',name:'甲供应商'};
const row=(name,supplierId='A',extra={})=>({name,spec:'10X20',qty:1,unit_price_rmb:.1,...(supplierId?{supplier_id:supplierId,supplier_name:supplierId==='A'?'甲供应商':'乙供应商'}:{}),...extra});
const batch=(existing,items,id='p1',byCode=false)=>({id,label:id,existing,items,byCode});
const plan=(batches,extra={})=>S.plan({supplier,batches,sourceFile:'新版报价.xlsx',...extra});

test('同类不同供应商的同名物料隔离，更新、新增、删减均只作用本供应商',()=>{
 const other=row('纸袋','B'),old=[row('纸袋','A',{id:'keep',images:['a.png'],qty_raw:'2*3'}),row('停产纸袋'),other];
 const before=JSON.stringify(old),r=plan([batch(old,[{name:'纸袋',spec:'10×20',qty:2,unit_price_rmb:.2},{name:'新增膜',qty:1,unit_price_rmb:.3}])]);
 assert.deepEqual(r.counts,{updated:1,added:1,deleted:1,claimed:0,legacyKept:0,otherKept:1,legacyConflicts:0});
 assert.equal(r.batches[0].rows.length,3);assert.equal(r.batches[0].rows[1],other);
 const updated=r.batches[0].rows[0];assert.equal(updated.id,'keep');assert.deepEqual(updated.images,['a.png']);assert.equal(updated.qty_raw,undefined);
 assert.equal(updated.qty,2);assert.equal(updated.supplier_id,'A');assert.equal(updated.source_file,'新版报价.xlsx');
 assert.equal(JSON.stringify(old),before);
});
test('完整清单未再包含某小产品的该供应商物料时同步删除，共有费用也参与且其他产品供应商保留',()=>{
 const other=row('彩盒','B');
 const r=plan([batch([row('纸袋')],[{name:'纸袋',spec:'10X20',qty:3}]),batch([row('旧物料'),other],[],'p2'),batch([row('旧共用膜')],[],'__shared__',true)]);
 assert.equal(r.counts.deleted,2);assert.deepEqual(r.batches[1].rows,[other]);assert.deepEqual(r.batches[2].rows,[]);
});
test('未标供应商的旧物料默认保留，只能经明确归属确认纳入更新和删除',()=>{
 const matching=row('纸袋',''),omitted=row('旧膜',''),other=row('另一家旧物料','');const batches=[batch([matching,omitted,other],[{name:'纸袋',spec:'10X20',qty:2}])];
 const untouched=plan(batches);assert.equal(untouched.counts.added,1);assert.equal(untouched.counts.deleted,0);assert.equal(untouched.counts.legacyConflicts,1);
 assert.equal(untouched.batches[0].rows[0],matching);
 const claimed=plan(batches,{legacyClaims:[S.legacyToken('p1',0),S.legacyToken('p1',1)]});
 assert.equal(claimed.counts.updated,1);assert.equal(claimed.counts.deleted,1);assert.equal(claimed.counts.claimed,2);
 assert.equal(claimed.batches[0].rows[1],other);assert.equal(claimed.batches[0].rows[0].supplier_id,'A');
});
test('不能把已有其他供应商记录归为本供应商，失效的历史选择整批拒绝且不修改原数组',()=>{
 const rows=[row('乙供应商纸袋','B')],before=JSON.stringify(rows);
 assert.throws(()=>plan([batch(rows,[{name:'新品'}])],{legacyClaims:[S.legacyToken('p1',0)]}),/归属选择已失效/);
 assert.throws(()=>plan([batch(rows,[{name:'新品'}])],{legacyClaims:[S.legacyToken('p1',3)]}),/归属选择已失效/);
 assert.equal(JSON.stringify(rows),before);
});
test('空文件、无供应商、重复物料或未知分组不能先删旧物料再报错',()=>{
 const rows=[row('旧物料')],before=JSON.stringify(rows);
 assert.throws(()=>plan([batch(rows,[])]),/未识别到/);
 assert.throws(()=>plan([batch(rows,[{name:'新物料'}])],{supplier:{name:''}}),/供应商/);
 assert.throws(()=>plan([batch(rows,[{name:'新物料'},{name:'新物料'}])]),/重复/);
 assert.throws(()=>plan([batch(rows,[{name:'新物料'}]),batch([],[], 'p1')]),/同步范围重复/);
 assert.throws(()=>plan([batch([row('总计','A',{children:[{}]})],[{name:'新物料'}])]),/分组或小计/);
 assert.equal(JSON.stringify(rows),before);
});
test('重新导入同一清单不重复新增或误删，MOQ/币种变化清除旧算式并保留本地图片分类',()=>{
 const old=row('旧名','A',{material_code:'M1',category:'吸塑',unit_price_usd_raw:'5/2',images:['keep.png']});
 const incoming={name:'更新名称',spec:'新规格',material_code:'M1',qty:0,unit_price_rmb:null,unit_price_usd:.5,source_currency:'USD',moq:'20K',moq_qty:20000};
 const first=plan([batch([old],[incoming])]);const next=plan([batch(first.batches[0].rows,[incoming])]);
 assert.equal(next.counts.added,0);assert.equal(next.counts.deleted,0);assert.equal(next.batches[0].rows.length,1);
 const updated=next.batches[0].rows[0];assert.equal(updated.unit_price_usd_raw,undefined);assert.equal(updated.qty,0);
 assert.equal(updated.category,'吸塑');assert.deepEqual(updated.images,['keep.png']);assert.equal(updated.source_currency,'USD');
});
test('共有费用按来源货号区分相同物料，BeautyMini货号别名仍可更新匹配',()=>{
 const rows=[row('纸袋','A',{product_code:'BEAUTYM-S3-059'}),row('纸袋','A',{product_code:'OTHER'})];
 const r=plan([batch(rows,[{name:'纸袋',spec:'10X20',product_code:'Beauty Mini_S3-59',qty:2}], '__shared__',true)]);
 assert.equal(r.counts.updated,1);assert.equal(r.counts.added,0);assert.equal(r.counts.deleted,1);assert.equal(r.batches[0].rows[0].qty,2);
});
test('供应商识别独立于文件名，相同物料不同供应商可以各自存续',()=>{
 const old=[row('纸袋','B')];
 const first=plan([batch(old,[{name:'纸袋',spec:'10X20'}])]);
 const later=S.plan({supplier,batches:[batch(first.batches[0].rows,[{name:'纸袋',spec:'10X20',qty:2}])],sourceFile:'完全不同文件名.xlsx'});
 assert.equal(later.counts.updated,1);assert.equal(later.counts.added,0);assert.equal(later.batches[0].rows[0],old[0]);
 assert.deepEqual(S.suppliers([batch(later.batches[0].rows,[])]).map(p=>p.id).sort(),['A','B']);
});

test('完整清单读取所有报价页并保留逐项来源；缺价格会明确标出，不能被误当删除',async()=>{
 const {parseSheets}=require('../backend/services/parseHardwareSheet');
 const header=[null,'序号','货号','产品名称','规格','MOQ','单价(元)不含税'];
 const first={name:'纸袋',rows:[header,[null,1,'A','纸袋','大','5K',.1]]};
 const second={name:'彩盒',rows:[header,[null,1,'B','彩盒','小','5K',.2],[null,2,'B','未报价物料','小','5K',null]]};
 const r=await parseSheets([first,second],{allSheets:true,targetQty:5000});
 assert.equal(r.count,2);assert.deepEqual(r.items.map(p=>p.source_sheet),['纸袋','彩盒']);
 assert.equal(r.unpriced_items[0].name,'未报价物料');
 const legacy=await parseSheets([{name:'旧格式',rows:[[null,'零件名称','用量','单价RMB'],[null,'缺单价',1,null],[null,'免费物料',1,0]]}]);
 assert.deepEqual(legacy.unpriced_items.map(p=>p.name),['缺单价']);
});
