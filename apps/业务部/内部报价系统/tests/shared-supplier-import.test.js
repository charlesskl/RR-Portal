const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sku = require('../frontend/mixed-sku');

async function setup(selected = '__shared__', confirmResult = true, totalCode, extraItems = [], options = {}) {
  const nodes = new Map();
  const host = { querySelector(key) {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', value: '', querySelector: k => host.querySelector(k), querySelectorAll: () => [] });
    return nodes.get(key);
  } };
  const items = options.items || [
    { product_code: '77957', name: '外收缩膜', qty: 1, unit_price_rmb: .124, moq_qty: 100000 },
    { product_code: '77957', name: '内收缩膜', qty: 1, unit_price_rmb: .105, moq_qty: 100000 },
    ...extraItems,
  ];
  const root = options.root || { mixed_products: { a: { packaging_materials: [{ name: '独立材料' }] } }, mixed_shared: { packaging_materials: [{ name: '已有共用' }], hardware: [{ name: '共用五金' }] } };
  const payload = options.payload || {};
  let changes = 0;
  const context = vm.createContext({ window: { MixedSku: sku }, FormData: class { append() {} },
    fetch: async () => ({ ok: true, json: async () => ({ items, sheet_used: '系统格式' }) }),
    escapeHtml: x => String(x ?? ''), formatNum: String, freeUnitHkd: item => item.unit_price_rmb / .85,
    confirm: () => confirmResult,
    renderEngineering() {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function attachSupplierMaterialImportUI('), source.indexOf('\nfunction renderEngineering(')), context);
  context.attachSupplierMaterialImportUI(host, payload, options.canEdit ?? true, () => changes++, .85, 7.8, 12000, '', {
    inputId: 'file', previewId: 'preview', targetKey: 'packaging_materials', label: '包装材料',
    mixedConfig: options.single ? null : { products: [{ id: 'a', code: 'A' }] }, mixedRoot: root, mixedTotalCode: totalCode, getMixedImportTarget: () => selected,
  });
  await host.querySelector('file').onchange({ target: { files: [{}] } });
  return { root, payload, host, changes: () => changes, switchTo(value) { selected = value; } };
}

test('共有费用导入整套货号的包装材料一次，保留小产品和其他分类', async () => {
  const s = await setup();
  assert.match(s.host.querySelector('preview').innerHTML, /每包装共有费用/);
  assert.doesNotMatch(s.host.querySelector('preview').innerHTML, /无法分配/);
  s.host.querySelector('[data-action="replace"]').onclick();
  assert.equal(s.root.mixed_shared.packaging_materials.length, 2);
  assert.equal(s.root.mixed_shared.packaging_materials[0].product_code, '77957');
  assert.equal(s.root.mixed_shared.packaging_materials[0].moq_qty, 100000);
  assert.equal(s.root.mixed_products.a.packaging_materials[0].name, '独立材料');
  assert.equal(s.root.mixed_shared.hardware[0].name, '共用五金');
  assert.equal(s.changes(), 1);
});
test('共有费用追加保留原明细', async () => {
  const s = await setup();
  s.host.querySelector('[data-action="append"]').onclick();
  assert.equal(s.root.mixed_shared.packaging_materials.length, 3);
});
test('切换报价对象后旧预览不可写入', async () => {
  const s = await setup(); s.switchTo('a');
  s.host.querySelector('[data-action="append"]').onclick();
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials.length, 1);
});
test('普通产品分配仍阻止未知货号', async () => {
  const s = await setup('__overall__');
  assert.match(s.host.querySelector('preview').innerHTML, /无法分配/);
  s.host.querySelector('[data-action="append"]').onclick();
  assert.equal(s.changes(), 0);
});
test('取消替换不会覆盖已有共有费用', async () => {
  const s = await setup('__shared__', false);
  s.host.querySelector('[data-action="replace"]').onclick();
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials.length, 1);
});


test('整体视图按总货号自动归共用，同表小产品独立分配', async () => {
  const s = await setup('__overall__', true, '77957', [{ product_code: 'A', name: '独立新材料', qty: 2 }]);
  assert.doesNotMatch(s.host.querySelector('preview').innerHTML, /无法分配/);
  assert.match(s.host.querySelector('preview').innerHTML, /总货号共用项目 2 条/);
  s.host.querySelector('[data-action="replace"]').onclick();
  assert.equal(s.root.mixed_shared.packaging_materials.length, 2);
  assert.equal(s.root.mixed_products.a.packaging_materials.length, 1);
  assert.equal(s.root.mixed_products.a.packaging_materials[0].name, '独立新材料');
  assert.equal(s.changes(), 1);
});

test('只有总货号的表可直接导入共用，保留原小产品资料', async () => {
  const s = await setup('__overall__', true, '77957');
  s.host.querySelector('[data-action="replace"]').onclick();
  assert.equal(s.root.mixed_shared.packaging_materials.length, 2);
  assert.equal(s.root.mixed_products.a.packaging_materials[0].name, '独立材料');
});

test('总货号和小产品混合导入遇到未知货号时整批阻止', async () => {
  const s = await setup('__overall__', true, '77957', [{ product_code: 'unknown', name: '未知' }]);
  s.host.querySelector('[data-action="append"]').onclick();
  assert.equal(s.changes(), 0);
  assert.equal(s.root.mixed_shared.packaging_materials.length, 1);
});

test('总货号完整匹配，统一全角和大小写，但不按前缀误分配', () => {
  const result = sku.planSupplier({ products: [] }, [{ product_code: ' ａｂ７７９５７ ' }, { product_code: 'AB77957-1' }, {}], 'AB77957');
  assert.equal(result.sharedItems.length, 1);
  assert.equal(result.unmatched.length, 2);
  assert.equal(sku.planSupplier({ products: [] }, [{}], '').sharedItems.length, 0);
});

test('更新纸袋保留收缩膜、其他小产品和本地分类，重复上传不会重复新增', async () => {
  const film = { name: '外收缩膜', spec: '50x60', qty: 1, unit_price_rmb: .1 };
  const otherProduct = { packaging_materials: [{ name: '纸袋', spec: '80X100', qty: 4 }] };
  const s = await setup('__overall__', true, '77957', [], {
    items: [{product_code:'A', name:'纸袋', spec:'80×100', qty:2, unit_price_rmb:.2}],
    root: {mixed_shared:{packaging_materials:[film]}, mixed_products:{a:{packaging_materials:[film,
      {id:'old-paper', name:'纸袋', spec:'80X100', qty:1, unit_price_rmb:.1, category:'其他外购', images:['kept.png']}]}, b:otherProduct}},
  });
  assert.match(s.host.querySelector('preview').innerHTML, /预计更新 1 条、新增 0 条/);
  s.host.querySelector('[data-action="update"]').onclick();
  let rows = s.root.mixed_products.a.packaging_materials;
  assert.equal(rows.length, 2);
  assert.equal(rows[0], film);
  assert.equal(rows[1].id, 'old-paper');
  assert.equal(rows[1].category, '其他外购');
  assert.equal(rows[1].images[0], 'kept.png');
  assert.equal(rows[1].qty, 2);
  assert.equal(rows[1].unit_price_rmb, .2);
  assert.equal(s.root.mixed_shared.packaging_materials[0], film);
  assert.equal(s.root.mixed_products.b, otherProduct);
  await s.host.querySelector('file').onchange({target:{files:[{}]}});
  s.host.querySelector('[data-action="update"]').onclick();
  assert.equal(s.root.mixed_products.a.packaging_materials.length, 2);
  assert.equal(s.changes(), 2);
});

test('更新同批小产品和共用物料，新物料新增，旧重复资料需确认后才合并', async () => {
  const root = () => ({mixed_shared:{packaging_materials:[
    {product_code:'77957',name:'纸袋',spec:'大'}, {product_code:'77957',name:'纸袋',spec:'大'},
    {product_code:'other',name:'纸袋',spec:'大'}]}, mixed_products:{a:{packaging_materials:[{name:'旧彩盒'}]}}});
  const items = [{product_code:'77957',name:'纸袋',spec:'大',qty:2,unit_price_rmb:.2},
    {product_code:'A',name:'纸袋',spec:'小',qty:1,unit_price_rmb:.1}];
  const cancelled = await setup('__overall__', false, '77957', [], {root:root(),items});
  assert.match(cancelled.host.querySelector('preview').innerHTML, /合并 1 条旧重复资料/);
  cancelled.host.querySelector('[data-action="update"]').onclick();
  assert.equal(cancelled.root.mixed_shared.packaging_materials.length, 3);
  assert.equal(cancelled.root.mixed_products.a.packaging_materials.length, 1);
  assert.equal(cancelled.changes(), 0);
  const s = await setup('__overall__', true, '77957', [], {root:root(),items});
  s.host.querySelector('[data-action="update"]').onclick();
  assert.equal(s.root.mixed_shared.packaging_materials.length, 2);
  assert.equal(s.root.mixed_shared.packaging_materials[0].qty, 2);
  assert.equal(s.root.mixed_shared.packaging_materials[1].product_code, 'other');
  assert.equal(s.root.mixed_products.a.packaging_materials.length, 2);
  assert.equal(s.root.mixed_products.a.packaging_materials[0].name, '旧彩盒');
});

test('本次物料匹配冲突整批阻止，不能先改共用再因小产品冲突失败', async () => {
  const s = await setup('__overall__', true, '77957', [], {items:[
    {product_code:'77957',name:'已有共用',unit_price_rmb:99},
    {product_code:'A',name:'纸袋',spec:'小',unit_price_rmb:.1},
    {product_code:'A',name:'纸袋',spec:'小',unit_price_rmb:.2},
  ]});
  assert.match(s.host.querySelector('preview').innerHTML, /有多条相同名称和规格/);
  s.host.querySelector('[data-action="update"]').onclick();
  assert.equal(s.root.mixed_shared.packaging_materials[0].unit_price_rmb, undefined);
  assert.equal(s.root.mixed_products.a.packaging_materials.length, 1);
  assert.equal(s.changes(), 0);
});

test('单品及强制共有费用视图也支持更新，保留不同来源货号和其他规格', async () => {
  for (const single of [true,false]) {
    const old = [{product_code:'A',name:'纸袋',spec:'小',qty:1}, {product_code:'B',name:'纸袋',spec:'小',qty:3}, {name:'收缩膜'}];
    const s = await setup('__shared__', true, null, [], {single,
      payload:{packaging_materials:old}, root:{mixed_shared:{packaging_materials:old}},
      items:[{product_code:'A',name:'纸袋',spec:'小',qty:2}, {product_code:'A',name:'纸袋',spec:'大',qty:4}],
    });
    s.host.querySelector('[data-action="update"]').onclick();
    const rows = single ? s.payload.packaging_materials : s.root.mixed_shared.packaging_materials;
    assert.equal(rows.length, 4);
    assert.equal(rows[0].qty, 2);
    assert.equal(rows[1].qty, 3);
    assert.equal(rows[2].name, '收缩膜');
    assert.equal(rows[3].spec, '大');
  }
});

test('更新模式继续阻止未知货号、只读页面和切换报价对象后的旧预览', async () => {
  for (const options of [{unknown:true}, {canEdit:false}, {switch:true}]) {
    const s = await setup('__overall__', true, '77957', [], {canEdit:options.canEdit,
      items:[{product_code:options.unknown?'unknown':'A',name:'纸袋',qty:2}]});
    if (options.switch) s.switchTo('__shared__');
    s.host.querySelector('[data-action="update"]').onclick();
    assert.equal(s.changes(), 0);
    assert.equal(s.root.mixed_products.a.packaging_materials[0].name, '独立材料');
  }
});


test('更新匹配数值时清除旧算式，保留未更新材料及本地分类图片', async () => {
  for (const scope of ['single', 'shared', 'product']) {
    const untouched = {product_code:'A',name:'收缩膜',qty:6,qty_raw:'2*3',unit_price_rmb:0.5,unit_price_rmb_raw:'1/2'};
    const matched = {product_code:'A',name:'纸袋',spec:'小',qty:6,qty_raw:'2*3',unit_price_rmb:0.5,unit_price_rmb_raw:'1/2',unit_price_usd:2.5,unit_price_usd_raw:'5/2',category:'其他外购',images:['kept.png']};
    const rows = [untouched, matched];
    const s = await setup(scope === 'shared' ? '__shared__' : '__overall__', true, null, [], {
      single:scope === 'single', payload:{packaging_materials:rows},
      root:{mixed_shared:{packaging_materials:rows},mixed_products:{a:{packaging_materials:rows}}},
      items:[{product_code:'A',name:'纸袋',spec:'小',qty:2,unit_price_rmb:0.2,unit_price_usd:null,source_currency:'RMB'}],
    });
    s.host.querySelector('[data-action="update"]').onclick();
    const next = scope === 'single' ? s.payload.packaging_materials : scope === 'shared' ? s.root.mixed_shared.packaging_materials : s.root.mixed_products.a.packaging_materials;
    assert.equal(next[1].qty,2);assert.equal(next[1].unit_price_rmb,0.2);
    if (scope === 'single') {
      const {buildWorkbook} = require('../backend/services/exportInternal');
      const wb = await buildWorkbook({quote:{quote_no:'IMPORT-UPDATE',qty:1},sections:[{dept:'engineering',payload_json:JSON.stringify({packaging_materials:next})}]});
      let exported;
      wb.worksheets[0].eachRow(row => { if (row.getCell(3).value === '纸袋') exported = row; });
      assert.ok(exported,'导出包含本次更新的纸袋');
      assert.equal(exported.getCell(8).formula,undefined);assert.equal(exported.getCell(8).value,2);
      assert.equal(exported.getCell(9).formula,undefined);assert.equal(exported.getCell(9).value,0.2);
    }
    assert.equal(next[1].qty_raw,undefined);assert.equal(next[1].unit_price_rmb_raw,undefined);assert.equal(next[1].unit_price_usd_raw,undefined);
    assert.equal(next[1].category,'其他外购');assert.equal(next[1].images[0],'kept.png');
    assert.equal(next[0],untouched);assert.equal(next[0].qty_raw,'2*3');
  }
});
