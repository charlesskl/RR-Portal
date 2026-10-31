const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../frontend/supplier-material-sync'),MixedSku=require('../frontend/mixed-sku');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unescape=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
async function setup({targetKey='packaging_materials',items=[],root={mixed_products:{},mixed_shared:{}},payload={},single=false,selected='__overall__',canEdit=true,confirmed=true,unpricedItems=[],snapshotVersion=1,supplierName='',supplierNames=[]}={}){
 const nodes=new Map();let changes=0;const confirmations=[];
 const host={querySelector(key){
  if(!nodes.has(key))nodes.set(key,{innerHTML:'',value:'',dataset:{},querySelector:k=>host.querySelector(k),querySelectorAll(selector){
   if(selector!=='[data-claim-supplier]')return [];
   return [...this.innerHTML.matchAll(/data-claim-supplier="([^"]+)"([^>]*)>/g)].map(match=>{
    const token=unescape(match[1]),box=host.querySelector('claim:'+token);box.dataset.claimSupplier=token;box.checked=/\bchecked\b/.test(match[2]);return box;
   });
  }});return nodes.get(key);
 }};
 const window={MixedSku,SupplierMaterialSync:S};
 const context={window,FormData:class{append(){}},fetch:async()=>({ok:true,json:async()=>({items,supplier_name:supplierName,supplier_names:supplierNames,sheet_used:'完整报价',unpriced_items:unpricedItems,supplier_snapshot_version:snapshotVersion})}),escapeHtml,formatNum:String,
  freeUnitHkd:r=>Number(r.unit_price_rmb||0)/.85,confirm:text=>{confirmations.push(text);return confirmed;},renderEngineering(){}};
 vm.createContext(context);
 const source=fs.readFileSync(require.resolve('../frontend/workbench.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function attachSupplierMaterialImportUI('),source.indexOf('\nfunction renderEngineering(')),context);
 context.attachSupplierMaterialImportUI(host,payload,canEdit,()=>changes++,.85,7.8,100,'',{
  inputId:'file',previewId:'preview',targetKey,label:targetKey,mixedRoot:root,mixedConfig:single?null:{products:[{id:'a',code:'A'},{id:'b',code:'B'}]},mixedTotalCode:'TOTAL',getMixedImportTarget:()=>selected
 });
 const load=()=>host.querySelector('file').onchange({target:{files:[{name:'本次供应商报价.xlsx'}]}});
 await load();
 return {host,root,payload,load,confirmations,changes:()=>changes,select:value=>host.querySelector('[data-sync-supplier]').onchange({target:{value}}),
  name:value=>host.querySelector('[data-new-supplier]').onchange({target:{value}}),apply:()=>host.querySelector('[data-action="supplier-sync"]').onclick(),
  claim(token){const box=host.querySelector('claim:'+token);box.checked=true;box.onchange();},switchTo:value=>{selected=value;}};
}
const row=(name,id='A',extra={})=>({name,spec:'小',qty:1,unit_price_rmb:.1,supplier_id:id,supplier_name:id==='A'?'甲供应商':'乙供应商',...extra});

test('五金、辅助材料、包装材料分别选择供应商，完整同步不覆盖其他供应商或其他类别',async()=>{
 for(const targetKey of ['hardware','aux_materials','packaging_materials']){
  const other=row('同名物料','B'),unrelated=[row('其他类别')];
  const root={mixed_products:{a:{[targetKey]:[row('同名物料'),row('删减物料'),other],unrelated},b:{[targetKey]:[row('整款取消'),row('乙方保留','B')]}},mixed_shared:{[targetKey]:[row('旧共用物料')]}};
  const s=await setup({targetKey,root,items:[{product_code:'A',name:'同名物料',spec:'小',qty:2},{product_code:'A',name:'新增物料',qty:3}]});
  const before=JSON.stringify(root);s.select('A');assert.equal(JSON.stringify(root),before);assert.match(s.host.querySelector('preview').innerHTML,/删除 3 条/);
  s.apply();assert.equal(s.changes(),1);assert.equal(root.mixed_products.a[targetKey].length,3);assert.equal(root.mixed_products.a[targetKey][1],other);
  assert.equal(root.mixed_products.a[targetKey][0].qty,2);assert.equal(root.mixed_products.b[targetKey].length,1);assert.equal(root.mixed_products.b[targetKey][0].supplier_id,'B');
  assert.equal(root.mixed_shared[targetKey].length,0);assert.equal(root.mixed_products.a.unrelated,unrelated);
  assert.match(s.confirmations[0],/甲供应商/);assert.match(s.confirmations[0],/删除 3 条/);
 }
});
test('首次供应商导入可确认历史归属，历史删减进入预览，其余旧物料保留',async()=>{
 const root={mixed_products:{a:{packaging_materials:[{name:'旧纸袋',spec:'小',qty:1},{name:'停用纸袋'},{name:'收缩膜'}]}},mixed_shared:{}};
 const s=await setup({root,items:[{product_code:'A',name:'旧纸袋',spec:'小',qty:2}]});
 s.select('__new__');s.name('新供应商');
 assert.match(s.host.querySelector('preview').innerHTML,/同名历史物料/);
 s.claim(S.legacyToken('a',0));s.claim(S.legacyToken('a',1));
 assert.match(s.host.querySelector('preview').innerHTML,/更新 1 条、新增 0 条、删除 1 条/);
 s.apply();const rows=root.mixed_products.a.packaging_materials;
 assert.equal(rows.length,2);assert.equal(rows[0].qty,2);assert.equal(rows[0].supplier_name,'新供应商');assert.equal(rows[1].name,'收缩膜');assert.equal(rows[1].supplier_id,undefined);
});
test('供应商选择留空、取消确认、只读、未知货号、切换对象或预览后修改都不能写入',async()=>{
 for(const situation of ['blank','cancel','readonly','unknown','switch','stale']){
  const root={mixed_products:{a:{packaging_materials:[row('纸袋')]}},mixed_shared:{}};
  const s=await setup({root,confirmed:situation!=='cancel',canEdit:situation!=='readonly',items:[{product_code:situation==='unknown'?'UNKNOWN':'A',name:'纸袋',spec:'小',qty:2}]});
  if(situation!=='blank')s.select('A');
  if(situation==='switch')s.switchTo('__shared__');
  if(situation==='stale')root.mixed_products.a.packaging_materials[0].qty=9;
  const before=JSON.stringify(root);s.apply();assert.equal(JSON.stringify(root),before,situation);assert.equal(s.changes(),0,situation);
 }
});
test('有供应商归属后旧的整体替换、追加和更新入口无法绕过供应商范围',async()=>{
 const root={mixed_products:{a:{packaging_materials:[row('纸袋')]}},mixed_shared:{}};
 for(const action of ['replace','append','update']){
  const s=await setup({root,items:[{product_code:'A',name:'纸袋',spec:'小',qty:2}]});
  s.host.querySelector(`[data-action="${action}"]`).onclick();assert.equal(s.changes(),0);assert.equal(root.mixed_products.a.packaging_materials[0].qty,1);
 }
});
test('单品及共有费用同步限于本产品范围，文件名或供应商文字安全转义',async()=>{
 for(const single of [false,true]){
  const payload={packaging_materials:[row('旧物料'),row('另一供应商','B')]};
  const root={mixed_shared:payload,mixed_products:{a:{packaging_materials:[row('其他小产品')]}}};
  const s=await setup({single,selected:'__shared__',root,payload,items:[{product_code:'ANY',name:'<新物料>',qty:1}]});
  s.select('A');assert.match(s.host.querySelector('preview').innerHTML,/&lt;新物料&gt;/);s.apply();
  assert.equal(payload.packaging_materials.length,2);assert.equal(payload.packaging_materials[0].supplier_id,'B');assert.equal(payload.packaging_materials[1].supplier_id,'A');
  assert.equal(root.mixed_products.a.packaging_materials[0].name,'其他小产品');
 }
});

test('存在未识别价格时禁止完整清单同步，不能误删旧物料',async()=>{
 const root={mixed_products:{a:{packaging_materials:[row('纸袋'),row('缺价格物料')]}},mixed_shared:{}};
 const s=await setup({root,items:[{product_code:'A',name:'纸袋',spec:'小',qty:2}],unpricedItems:[{name:'缺价格物料'}]});
 s.select('A');assert.match(s.host.querySelector('preview').innerHTML,/缺少可识别报价/);s.apply();
 assert.equal(s.changes(),0);assert.equal(root.mixed_products.a.packaging_materials.length,2);
});

test('旧解析服务未确认完整清单能力时禁止同步删除',async()=>{
 const root={mixed_products:{a:{packaging_materials:[row('旧物料')]}},mixed_shared:{}};
 const s=await setup({root,items:[{product_code:'A',name:'新物料'}],snapshotVersion:null});
 s.select('A');assert.match(s.host.querySelector('preview').innerHTML,/解析服务尚未加载/);s.apply();
 assert.equal(s.changes(),0);assert.equal(root.mixed_products.a.packaging_materials[0].name,'旧物料');
});

test('识别文件抬头后自动匹配已有供应商，整份清单增改删且保留乙方',async()=>{
 const other=row('乙方保留','B');
 const root={mixed_products:{a:{packaging_materials:[row('纸袋'),row('旧彩盒'),other]},b:{packaging_materials:[row('整款删减')]}},mixed_shared:{}};
 const s=await setup({root,supplierName:'甲供应商',supplierNames:['甲供应商'],items:[{product_code:'A',name:'纸袋',spec:'小',qty:2},{product_code:'A',name:'新纸袋',qty:1}]});
 assert.match(s.host.querySelector('preview').innerHTML,/文件识别供应商：<b>甲供应商/);
 assert.match(s.host.querySelector('preview').innerHTML,/更新 1 条、新增 1 条、删除 2 条/);
 s.apply();assert.equal(s.changes(),1);assert.equal(root.mixed_products.a.packaging_materials.length,3);
 assert.equal(root.mixed_products.a.packaging_materials[1],other);assert.equal(root.mixed_products.a.packaging_materials[0].supplier_id,'A');
 assert.equal(root.mixed_products.b.packaging_materials.length,0);
});

test('首次识别新供应商，确认匹配旧物料后更新无重复，未确认及其他供应商保留',async()=>{
 const other=row('纸袋','B');
 const root={mixed_products:{a:{packaging_materials:[{name:'纸袋',spec:'小',qty:1},{name:'收缩膜'},other]}},mixed_shared:{}};
 const s=await setup({root,supplierName:'新供应商',supplierNames:['新供应商'],items:[{product_code:'A',name:'纸袋',spec:'小',qty:2}]});
 assert.match(s.host.querySelector('preview').innerHTML,/value="新供应商"/);
 s.host.querySelector('[data-claim-matching]').onclick();
 assert.equal(s.changes(),0);assert.equal(root.mixed_products.a.packaging_materials[0].qty,1);
 assert.match(s.host.querySelector('preview').innerHTML,/更新 1 条、新增 0 条、删除 0 条/);
 s.apply();const rows=root.mixed_products.a.packaging_materials;
 assert.equal(rows.length,3);assert.equal(rows[0].qty,2);assert.equal(rows[0].supplier_name,'新供应商');
 assert.equal(rows[1].name,'收缩膜');assert.equal(rows[1].supplier_name,undefined);assert.equal(rows[2],other);
 assert.match(s.confirmations[0],/均属于“新供应商”/);
});

test('拒绝历史归属确认或多供应商混合文件时不误认领、不写入',async()=>{
 const root={mixed_products:{a:{packaging_materials:[{name:'纸袋',spec:'小',qty:1}]}},mixed_shared:{}};
 const s=await setup({root,confirmed:false,supplierName:'新供应商',items:[{product_code:'A',name:'纸袋',spec:'小',qty:2}]});
 s.host.querySelector('[data-claim-matching]').onclick();
 assert.match(s.host.querySelector('preview').innerHTML,/更新 0 条、新增 1 条/);
 s.apply();assert.equal(s.changes(),0);
 const mixed=await setup({root,supplierNames:['甲','乙'],items:[{product_code:'A',name:'纸袋',spec:'小',qty:2}]});
 mixed.select('__new__');mixed.name('甲');
 assert.match(mixed.host.querySelector('preview').innerHTML,/多个供应商/);mixed.apply();assert.equal(mixed.changes(),0);
});
