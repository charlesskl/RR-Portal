const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sku = require('../frontend/mixed-sku');

async function setup(selected = '__shared__', confirmResult = true, totalCode, extraItems = []) {
  const nodes = new Map();
  const host = { querySelector(key) {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', value: '', querySelector: k => host.querySelector(k), querySelectorAll: () => [] });
    return nodes.get(key);
  } };
  const items = [
    { product_code: '77957', name: '外收缩膜', qty: 1, unit_price_rmb: .124, moq_qty: 100000 },
    { product_code: '77957', name: '内收缩膜', qty: 1, unit_price_rmb: .105, moq_qty: 100000 },
    ...extraItems,
  ];
  const root = { mixed_products: { a: { packaging_materials: [{ name: '独立材料' }] } }, mixed_shared: { packaging_materials: [{ name: '已有共用' }], hardware: [{ name: '共用五金' }] } };
  let changes = 0;
  const context = vm.createContext({ window: { MixedSku: sku }, FormData: class { append() {} },
    fetch: async () => ({ ok: true, json: async () => ({ items, sheet_used: '系统格式' }) }),
    escapeHtml: x => String(x ?? ''), formatNum: String, freeUnitHkd: item => item.unit_price_rmb / .85,
    confirm: () => confirmResult,
  });
  const source = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function attachSupplierMaterialImportUI('), source.indexOf('\nfunction renderEngineering(')), context);
  context.attachSupplierMaterialImportUI(host, {}, true, () => changes++, .85, 7.8, 12000, '', {
    inputId: 'file', previewId: 'preview', targetKey: 'packaging_materials', label: '包装材料',
    mixedConfig: { products: [{ id: 'a', code: 'A' }] }, mixedRoot: root, mixedTotalCode: totalCode, getMixedImportTarget: () => selected,
  });
  await host.querySelector('file').onchange({ target: { files: [{}] } });
  return { root, host, changes: () => changes, switchTo(value) { selected = value; } };
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
