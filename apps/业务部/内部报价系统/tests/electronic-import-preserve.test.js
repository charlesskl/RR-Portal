const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('重新导入更新自动汇总且保护手动行，不重复追加',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
 const context={};vm.runInNewContext(source.slice(source.indexOf('function electronicDetailFingerprint'),source.indexOf('function isDerivedElectronicSummary')),context);
 const payload={electronics:[{name:'手填',qty:1,unit_price_rmb:9}]};
 const rows=price=>[{name:'IC',qty:1,unit_price_rmb:price,_electronic_summary_role:'ic'},{name:'PACB',qty:1,unit_price_rmb:price,_electronic_summary_role:'pacb'}];
 context.syncElectronicDetailSummary(payload,rows(2));
 payload.electronics[1].unit_price_rmb=8;
 context.syncElectronicDetailSummary(payload,rows(3));
 context.syncElectronicDetailSummary(payload,rows(3));
 assert.equal(payload.electronics.length,3);
 assert.deepEqual(Array.from(payload.electronics,r=>r.unit_price_rmb),[9,8,3]);
});
