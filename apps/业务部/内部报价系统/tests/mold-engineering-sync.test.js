const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../frontend/mixed-molds'),I=require('../backend/services/mixedPartImport');
test('工程更新和删除同步，保留啤机价格及手工零件并排除五金',()=>{
 const old={parts_catalog:{parts:[{id:'numbered_a',weight_g:1,production_demand:3000,shot_price:.3,loss_pct:5},{id:'numbered_removed'},{id:'hardware',mold_no:'五金',name:'弹簧'},{id:'manual',name:'塑胶弹簧座',mold_no:'M2'}],selections:{a:[{part_id:'numbered_a',usage:1},{part_id:'numbered_removed',usage:1},{part_id:'hardware',usage:1}]}}};
 const out=M.engineeringCatalog(old,{mixed_imported_parts:[{id:'numbered_a',weight_g:2,production_demand:3890,shot_price:0,loss_pct:3}]});
 assert.deepEqual(out.parts_catalog.parts.map(p=>p.id),['numbered_a','manual']);
 assert.equal(out.parts_catalog.parts[0].production_demand,3890);
 assert.equal(out.parts_catalog.parts[0].weight_g,2);
 assert.equal(out.parts_catalog.parts[0].shot_price,.3);
 assert.equal(out.parts_catalog.parts[0].loss_pct,5);
 assert.equal(out.parts_catalog.selections.a.length,1);
 assert.equal(old.parts_catalog.parts.length,4);
});
test('重复导入更新材质及需求但保留零件ID和价格',()=>{
 const config={enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'01',name:'A'},{id:'b',code:'02',name:'B'}]};
 const molds=[{mold_no:'M1',parts:[{name:'01-盖',material:'ABS',production_demand:3890}]}];
 const eng={mixed_imported_parts:[{id:'numbered_old',name:'01-盖',mold_no:'M1',material:'PP',production_demand:3000,shot_price:.5,source_file:'same.xlsx'}]};
 const out=I.importParts(config,eng,molds,{sourceFile:'same.xlsx'});
 assert.equal(out.engineering.mixed_imported_parts.length,1);
 const p=out.engineering.mixed_imported_parts[0];
 assert.equal(p.id,'numbered_old');assert.equal(p.material,'ABS');assert.equal(p.production_demand,3890);assert.equal(p.shot_price,.5);
 assert.equal(I.summarize([...molds,{mold_no:'五金',parts:[{name:'02-弹簧'}]}]).part_count,1);
});
test('没有工程来源目录时保留旧注塑零件',()=>{
 assert.equal(M.engineeringCatalog({parts_catalog:{parts:[{id:'numbered_old'}],selections:{}}},{}).parts_catalog.parts.length,1);
});
