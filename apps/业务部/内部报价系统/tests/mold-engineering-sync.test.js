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

test('旧签字行从工程来源和啤机目录同时过滤，移除选用且不影响正常零件',()=>{
 const parts=[
  {id:'good',name:'55-内棍',mold_no:'36M-转水口'},
  {id:'footer',name:'制表',material:'Mike',mold_no:'36M-转水口'},
  {id:'review',name:'审核：',mold_no:'36M-转水口'},
  {id:'real',name:'制表机外壳',mold_no:'37M'}
 ];
 const old={parts_catalog:{parts,selections:{a:parts.map(p=>({part_id:p.id,usage:1}))}}};
 for(const engineering of [{},{mixed_imported_parts:parts,mixed_part_selections:old.parts_catalog.selections}]){
  const merged=M.engineeringCatalog(old,engineering);
  assert.deepEqual(merged.parts_catalog.parts.map(p=>p.id),['good','real']);
  assert.deepEqual(merged.parts_catalog.selections.a.map(p=>p.part_id),['good','real']);
 }
 assert.equal(old.parts_catalog.parts.length,4);
});
test('旧目录中的模具标准附录只按来源清理，保留其他来源数字模号',()=>{
 const parts=[
 {id:'real',mold_no:'MNFRG-32M-01',name:'uv胶瓶盖',source_file:'a'},
 {id:'title',mold_no:'模具标准一览表',name:'uv胶瓶盖模',source_file:'a'},
 {id:'header',mold_no:'序号',name:'钢料材料',source_file:'a'},
 {id:'steel',mold_no:'1',name:'龙记LKM模胚',source_file:'a'},
 {id:'sign',mold_no:'制定Prepared by:',name:'uv胶瓶盖模',source_file:'a'},
 {id:'other',mold_no:'1',name:'正常零件',source_file:'b'}];
 const out=M.engineeringCatalog({parts_catalog:{parts,selections:{}}},{});
 assert.deepEqual(out.parts_catalog.parts.map(p=>p.id),['real','other']);
});
test('完全替换清理旧零件及覆盖值，追加保留旧零件',()=>{
 const config={enabled:true,mode:'equal',units_per_pack:1,products:[{id:'a',code:'01',name:'A'},{id:'b',code:'02',name:'B'}]};
 const old={id:'old',name:'01-旧件',mold_no:'OLD'};
 const engineering={packaging:{note:'保留'},mixed_imported_parts:[old],mixed_part_edits:{old:{weight_g:99}},mixed_part_selections:{a:[{part_id:'old',usage:1}]}};
 const molds=[{mold_no:'NEW',parts:[{name:'01、02-新件',material:'ABS',production_demand:123}]}];
 const replaced=I.importParts(config,engineering,molds,{mode:'replace',existingParts:[old]});
 assert.equal(replaced.engineering.mixed_imported_parts.length,1);
 assert.equal(replaced.engineering.packaging.note,'保留');
 assert.deepEqual(replaced.engineering.mixed_part_edits,{});
 assert.ok(replaced.engineering.mixed_deleted_part_ids.includes('old'));
 const merged=M.engineeringCatalog({parts_catalog:{parts:[old],selections:{a:[{part_id:'old',usage:1}]}}},replaced.engineering);
 assert.deepEqual(merged.parts_catalog.parts.map(p=>p.name),['01、02-新件']);
 assert.equal(merged.parts_catalog.selections.a.length,1);
 const appended=I.importParts(config,engineering,molds,{mode:'append',existingParts:[old]});
 assert.equal(appended.engineering.mixed_imported_parts.length,2);
 assert.equal(appended.engineering.mixed_part_selections.a.length,2);
 assert.throws(()=>M.prepareMoldImport({},[],'invalid'),/无效/);
});
