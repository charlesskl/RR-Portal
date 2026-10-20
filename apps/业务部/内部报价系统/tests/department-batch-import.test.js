const test=require('node:test'),assert=require('node:assert/strict');
const Batch=require('../frontend/department-batch-import');
const cfg={products:[{id:'p37',code:'BEAUTYM-S3-037',name:'瓶盖',source_number:36},{id:'p38',code:'BEAUTYM-S3-038',name:'瓶身',source_number:37}]};
test('formal item numbers win over worksheet order and file hints',()=>{
 assert.equal(Batch.match(cfg,'77957','BEAUTYM-S3-037',['BEAUTYM-S3-038.xlsx']),'p37');
 assert.equal(Batch.match(cfg,'77957','37',['BEAUTYM-S3-038.xlsx']),'');
 assert.equal(Batch.match(cfg,'77957','',['BEAUTYM-S3-037-报价.xlsx']),'p37');
 assert.equal(Batch.match(cfg,'77957','',['BEAUTYM-S3-037和BEAUTYM-S3-038.xlsx']),'');
 assert.equal(Batch.match(cfg,'77957','77957',[]),'__shared__');
 assert.equal(Batch.match(cfg,'77957','',['瓶身']),'p38');
});
test('slush and sewing workbooks split into individually matched rows without changing input',()=>{
 const files=[{name:'总报价.xlsx',data:{items:[{item_code:'BEAUTYM-S3-037',name:'瓶盖',unit_price_hkd:2},{item_code:'77957',name:'共有件'}]}}];
 const entries=Batch.entriesFor('slush',files,cfg,'77957');
 assert.deepEqual(entries.map(r=>r.target),['p37','__shared__']);
 entries[0].data.name='edited';assert.equal(files[0].data.items[0].name,'瓶盖');
 const sewing=Batch.entriesFor('sewing',[{name:'BEAUTYM-S3-038车缝.xlsx',data:{groups:[{name:'布衣',items:[{material:'电绣',qty:2,unit_price:3}]}]}}],cfg,'77957');
 assert.equal(sewing[0].target,'p38');assert.equal(sewing[0].count,1);
});
test('batch application preserves other products and settings; shared cost stays shared',()=>{
 const root={indo_pct:10,mixed_products:{p37:{existing:'keep',slush_items:[{name:'old'}]},p38:{slush_items:[{name:'untouched'}]}},mixed_shared:{notes:'shared'}};
 const before=JSON.stringify(root);
 const entries=Batch.entriesFor('slush',[{name:'quote.xlsx',data:{items:[{item_code:'BEAUTYM-S3-037',name:'new',qty:0,images:['uploads/mold/test.png']},{item_code:'77957',name:'shared'}]}}],cfg,'77957');
 const result=Batch.apply(root,'slush',entries,cfg);
 assert.equal(result.count,2);assert.equal(JSON.stringify(root),before);
 assert.equal(result.next.mixed_products.p37.slush_items[0].qty,0);
 assert.equal(result.next.mixed_products.p37.existing,'keep');
 assert.equal(result.next.mixed_products.p38.slush_items[0].name,'untouched');
 assert.equal(result.next.mixed_shared.slush_items[0].name,'shared');assert.equal(result.next.indo_pct,10);
});
test('sewing batch keeps individual tax labels, zero prices and embroidery',()=>{
 const result=Batch.apply({},'sewing',[{file:'a.xlsx',target:'p37',data:{name:'车发',tax_label:'不含税',category:'车发',product_qty:2,labor_amount:0,items:[{material:'电绣',qty:0,unit_price:0,markup:0,note:'test'}]}}],cfg);
 const group=result.next.mixed_products.p37.sewing_groups[0];
 assert.equal(group.tax_label,'不含税');assert.equal(group.category,'车发');assert.equal(group.product_qty,2);assert.equal(group.items[0].craft,'电绣');assert.equal(group.items[0].usage,0);assert.equal(group.items[0].markup,0);
});
test('duplicate electronic offers and unresolved items block the entire batch',()=>{
 const root={mixed_products:{p37:{note:'keep'}}},before=JSON.stringify(root);let calls=0;
 const entries=[{file:'a.xlsx',target:'p37',data:{}},{file:'b.xlsx',target:'p37',data:{}}];
 assert.throws(()=>Batch.apply(root,'electronic',entries,cfg,()=>calls++),/多份电子报价/);
 assert.equal(calls,0);
 entries[1].target='missing';assert.throws(()=>Batch.apply(root,'electronic',entries,cfg,()=>calls++),/请先选择/);
 assert.equal(JSON.stringify(root),before);assert.equal(calls,0);
});
test('an electronic conversion failure cannot partly replace an earlier product',()=>{
 const root={mixed_products:{p37:{note:'keep'}}},before=JSON.stringify(root);
 assert.throws(()=>Batch.apply(root,'electronic',[{file:'a',target:'p37',data:{}},{file:'b',target:'p38',data:{}}],cfg,(payload)=>{payload.note='changed';throw Error('failed');}),/failed/);
 assert.equal(JSON.stringify(root),before);
});
test('batch electronic application uses the single-file currency and manual-row protection rules',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const context=vm.createContext({num:value=>Number(value)||0,sum:(rows,fn)=>(rows||[]).reduce((n,r)=>n+fn(r),0)});
 vm.runInContext(source.slice(source.indexOf('function elecDetailRowCount'),source.indexOf('function renderHierElectronics')),context);
 vm.runInContext(source.slice(source.indexOf('function applyElectronicQuoteImport'),source.indexOf('function renderElectronic')),context);
 const original={mixed_products:{p37:{electronics:[{name:'手工费用',qty:1,unit_price_rmb:99}]},p38:{note:'unchanged'}}};
 const data={source_currency:'USD',parts:[{name:'IC',qty:1,source_unit_price:1,unit_price:1}],extras:{profit_pct:0}};
 const result=Batch.apply(original,'electronic',[{file:'a.xlsx',target:'p37',data}],cfg,(p,d)=>context.applyElectronicQuoteImport(p,d,.85,7.8));
 const p=result.next.mixed_products.p37;
 assert.equal(p.electronics[0].unit_price_rmb,99);
 assert.equal(p.electronics_doc.source_currency,'USD');
 assert.equal(p.electronics_doc.parts[0].unit_price,6.63);
 assert.equal(result.next.mixed_products.p38.note,'unchanged');
 assert.equal(original.mixed_products.p37.electronics.length,1);
});
