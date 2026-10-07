const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, validateConfig } = require('../frontend/mixed-molds');
const { calculateMixedQuote, projectSections } = require('../backend/services/mixedQuotation');
const { calculateQuoteCosts, calculateSingleQuoteCosts } = require('../backend/services/quoteCostSummary');
const { buildMixedWorkbook } = require('../backend/services/exportMixedQuotation');
const cfg = () => ({ enabled: true, mode: 'equal', units_per_pack: 1, products: [
  { id: 'a', code: 'A', name: '水瓶', ratio: 1 }, { id: 'b', code: 'B', name: '蜂蜜瓶', ratio: 3 },
] });
function fixture(config = cfg()) {
  const payloads = {
    sales: { mixed_quote: config, header: { fx_hkd_usd: 1, fx_rmb_hkd: 1 }, shipping: { markup_x: 1, divisor: 1 }, mixed_pricing: { surtax_pct: 0 } },
    engineering: { hardware: [{ name: '旧单品费用不应计入', qty: 1, unit_price: 999 }], mixed_products: {
      a: { hardware: [{ name: 'A材料', qty: 1, unit_price: 10 }] }, b: { hardware: [{ name: 'B材料', qty: 1, unit_price: 20 }] },
    }, mixed_shared: { packaging_materials: [{ name: '共有彩盒', qty: 1, unit_price: 2 }] } },
    molding: { mixed_molds: [] },
  };
  return Object.entries(payloads).map(([dept, payload]) => ({ dept, payload_json: JSON.stringify(payload) }));
}
function edit(sections, dept, change) {
  const s = sections.find(s => s.dept === dept), p = JSON.parse(s.payload_json); change(p); s.payload_json = JSON.stringify(p);
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test('完整小产品报价取等量平均，共有包装只计一次，旧根数据不重复计入', () => {
  const c = cfg(); c.units_per_pack = 6;
  const sections = fixture(c), before = JSON.stringify(sections);
  const r = calculateMixedQuote({ qty: 100 }, sections, { strict: true });
  assert.deepEqual(r.products.map(p => p.price_usd), [10, 20]);
  assert.equal(r.average_usd, 15); assert.equal(r.final_usd, 92);
  assert.equal(r.components.hardware, 90); assert.equal(r.components.color_box, 2);
  assert.equal(calculateQuoteCosts({ qty: 100 }, sections).quotedPrice, 92);
  assert.equal(JSON.stringify(sections), before);
});
test('不等量混装按归一化比例计算，切换等量模式忽略旧比例', () => {
  const c = cfg(); c.mode = 'ratio';
  const r = calculateMixedQuote({}, fixture(c)); near(r.average_usd, 17.5); near(r.final_usd, 19.5);
  c.mode = 'equal'; near(calculateMixedQuote({}, fixture(c)).average_usd, 15);
});
test('共模参考表 01M-01：6穴水瓶和2穴蜂蜜瓶，分阶段堵穴且费用守恒', () => {
  const r = calculate(cfg(), [{ mold_no: '01M-01', machine_price: 1160, target: 3400, parts: [
    { product_id: 'a', cavity: 6, usage: 1, demand: 12396 }, { product_id: 'b', cavity: 2, usage: 1, demand: 2421 },
  ] }]);
  const m = r.molds[0];
  assert.deepEqual(m.stages.map(s => [s.cycles, s.cavities]), [[1210.5, 8], [855.5, 6]]);
  near(m.parts[0].unit_labor, (1210.5 * 6 / 8 + 855.5) * 1160 / 3400 / 12396);
  near(m.parts[1].unit_labor, 1160 / 3400 / 8);
  near(m.parts.reduce((s, p) => s + p.labor_total, 0), m.total_cost);
});
test('自动需求量考虑包装件数、混装比例、每款零件用量，共模价计入本款', () => {
  const c = cfg(); c.mode = 'ratio'; c.units_per_pack = 6;
  const sections = fixture(c);
  edit(sections, 'molding', p => { p.mixed_molds = [{ machine_price: 100, target: 100, parts: [
    { product_id: 'a', cavity: 1, usage: 2 }, { product_id: 'b', cavity: 1, usage: 1 },
  ] }]; });
  const r = calculateMixedQuote({ qty: 100 }, sections, { strict: true });
  assert.deepEqual(r.molds[0].parts.map(p => p.demand), [300, 450]);
  near(r.products[0].shared_labor, 1); near(r.products[1].shared_labor, 2 / 3);
  near(r.products[0].price_usd, 11); near(r.products[1].price_usd, 20 + 2 / 3);
});
test('同模 A 每啤2件、B 每啤4件，各需1000件：先完成 B 后堵穴，啤价不同且整模只计一次', () => {
  const config = cfg(), sections = fixture(config);
  edit(sections, 'engineering', p => {
    p.mixed_products.a.hardware[0].unit_price = .8;
    p.mixed_products.b.hardware[0].unit_price = 1.2;
    p.mixed_shared = {};
  });
  edit(sections, 'molding', p => { p.mixed_molds = [{ mold_no: 'AB-2-4', machine_price: 1200, target: 3000, parts: [
    { product_id: 'a', name: 'A主体', cavity: 2, usage: 1 },
    { product_id: 'b', name: 'B主体', cavity: 4, usage: 1 },
  ] }]; });
  const r = calculateMixedQuote({ qty: 2000 }, sections, { strict: true });
  const mold = r.molds[0];
  assert.deepEqual(mold.stages.map(s => [s.cycles, s.cavities]), [[250, 6], [250, 2]]);
  near(mold.shot_cost, .4); near(mold.total_cost, 200);
  near(mold.parts[0].unit_labor, 2 / 15); near(mold.parts[1].unit_labor, 1 / 15);
  near(mold.parts.reduce((n, p) => n + p.demand * p.unit_labor, 0), mold.total_cost);
  near(r.products[0].price_hkd, .8 + 2 / 15);
  near(r.products[1].price_hkd, 1.2 + 1 / 15);
  near(r.average_hkd, 1.1); near(r.components.injection_labor, .1);
});
test('同模出模数2:4、需求量1000:2000，两款同时完成时每件啤价相同', () => {
  const config = cfg(); config.mode = 'ratio'; config.products[1].ratio = 2;
  const result = calculate(config, [{ machine_price: 1200, target: 3000, parts: [
    { product_id: 'a', cavity: 2, usage: 1 }, { product_id: 'b', cavity: 4, usage: 1 },
  ] }], 3000);
  const mold = result.molds[0];
  assert.deepEqual(mold.stages.map(s => [s.cycles, s.cavities]), [[500, 6]]);
  assert.deepEqual(mold.parts.map(p => p.demand), [1000, 2000]);
  mold.parts.forEach(p => near(p.unit_labor, .4 / 6));
  near(mold.parts.reduce((n, p) => n + p.labor_total, 0), 200);
});
test('出模数分摊导出保留原始出模数和不同单件啤价', async () => {
  const sections = fixture();
  edit(sections, 'molding', p => { p.mixed_molds = [{ mold_no: 'AB-2-4', machine_price: 1200, target: 3000, parts: [
    { product_id: 'a', cavity: 2, usage: 1 }, { product_id: 'b', cavity: 4, usage: 1 },
  ] }]; });
  const wb = await buildMixedWorkbook({ dept:'molding', quote: { qty: 2000 }, sections });
  const ws = wb.getWorksheet('共模啤价分摊');
  assert.equal(ws.getCell('D1').value, '出模数（件/啤）');
  assert.equal(ws.getCell('D2').value, 2); assert.equal(ws.getCell('D3').value, 4);
  near(ws.getCell('G2').value, 2 / 15); near(ws.getCell('G3').value, 1 / 15);
  near(ws.getCell('I2').value + ws.getCell('I3').value, 200);
});
test('不同部门码点、除数、汇率和附加费沿用出货价顺序，运费和摊费只加一次', () => {
  const sections = fixture();
  sections.push({ dept: 'electronic', payload_json: JSON.stringify({ mixed_products: { a: { electronics: [{ qty: 1, unit_price: 4 }] } } }) });
  edit(sections, 'sales', p => { p.header.fx_hkd_usd = 2; p.shipping = { markup_x: 1.1, elec_markup_x: 1.5, divisor: .99, container_key: 'yt40', scenarios: [{ _freight_rate: 999 }] }; p.freight_calc = { cap_40: 100, yt40: 3000 }; p.mixed_pricing = { freight_hkd: 999, amortization_usd: .2, surtax_pct: .4 }; });
  edit(sections, 'engineering', p => { p.carton_calc = { cuft: 1, qty: 10 }; });
  const r = calculateMixedQuote({}, sections);
  near(r.components.freight, 1.44); near(r.components.cabinet, 1.56);
  const average = ((10 * 1.1 + 4 * 1.5) + 20 * 1.1) / .99 / 2 / 2;
  near(r.average_usd, average);
  const total = average + (2 + 3) * 1.1 / .99 / 2 + .2;
  near(r.final_usd, total + total * .004 * 1.1 / .99);
});
test('缺失小产品不会作为免费产品完成审核，显式零价明细可以报价', () => {
  const sections = fixture(); edit(sections, 'engineering', p => { delete p.mixed_products.b; });
  assert.equal(calculateMixedQuote({}, sections).valid, false);
  assert.throws(() => calculateMixedQuote({}, sections, { strict: true }), /B.*尚未填写/);
  edit(sections, 'engineering', p => { p.mixed_products.b = { hardware: [{ name: '客户提供', qty: 1, unit_price: 0 }] }; });
  assert.equal(calculateMixedQuote({}, sections, { strict: true }).valid, true);
});
test('无效比例、汇率、穴数及未知小产品不能被悄悄按0计算', () => {
  const c = cfg(); c.mode = 'ratio'; c.products[0].ratio = -1;
  assert.throws(() => validateConfig(c), /NA比例/);
  c.products[0].ratio = 0; assert.doesNotThrow(() => validateConfig(c));
  c.products[1].ratio = 0; assert.throws(() => validateConfig(c), /比例/); c.products[1].ratio = 1;
  c.products[0].ratio = 1; c.products[1].id = 'a'; assert.throws(() => validateConfig(c), /重复/);
  const sections = fixture(); edit(sections, 'sales', p => { p.header.fx_hkd_usd = 0; });
  assert.throws(() => calculateMixedQuote({}, sections, { strict: true }), /汇率/);
  assert.throws(() => calculate(cfg(), [{ machine_price: 100, target: 0, parts: [] }], 100), /日啤次/);
  assert.throws(() => calculate(cfg(), [{ machine_price: 100, target: 100, parts: [{ product_id: 'missing', cavity: 1, usage: 1 }] }], 100), /有效的小产品/);
});
test('普通单品计算不受混装功能影响', () => {
  const sections = projectSections(fixture(), 'a');
  assert.deepEqual(calculateQuoteCosts({}, sections), calculateSingleQuoteCosts({}, sections));
  assert.equal(calculateQuoteCosts({}, sections).quotedPrice, 10);
});
test('空纸箱占位不产生费用，也不能替代缺失的小产品明细', () => {
  const sections = fixture();
  edit(sections, 'engineering', p => { p.mixed_products.b = { carton_calc: { paper_rate: 3, cartons: [{ name: '主纸箱', qty: 1, flat_cards: [{ name: '主平卡', qty: 1 }] }] } }; });
  const r = calculateMixedQuote({}, sections);
  assert.equal(r.valid, false); assert.equal(r.products[1].price_usd, 0); assert.equal(r.components.carton, 0);
});
test('工程模具/手办/测试摊费按各款和每包装分别计入，零分摊数量阻止完成', () => {
  const sections = fixture();
  edit(sections, 'engineering', p => {
    p.mixed_products.a.mold_costs = { items: [{ price_rmb: 85 }], fx_rmb_usd: 1, amortization_qty: 100 };
    p.mixed_products.b.mold_costs = { prototype_fee_usd: 200, prototype_amortization_qty: 100 };
    p.mixed_shared.mold_costs = { testing_fee_usd: 30, testing_amortization_qty: 10 };
  });
  const r = calculateMixedQuote({}, sections, { strict: true });
  assert.equal(r.products[0].price_usd, 11); assert.equal(r.products[1].price_usd, 22);
  assert.equal(r.average_usd, 16.5); assert.equal(r.common_usd, 5); assert.equal(r.final_usd, 21.5);
  edit(sections, 'engineering', p => { p.mixed_products.a.mold_costs.amortization_qty = 0; });
  assert.throws(() => calculateMixedQuote({}, sections, { strict: true }), /分摊数量/);
});
test('混装导出平均与最终价公式可重算，部门导出和客户导出不暴露其他部门明细', async () => {
  const quote = { quote_no: 'MIX-1', product_name: '混装测试' }, sections = fixture();
  const wb = await buildMixedWorkbook({ consolidate:false, quote, sections });
  const ws = wb.getWorksheet('混装报价汇总');
  assert.deepEqual(ws.getCell('B5').value, { formula: 'SUMPRODUCT(C2:C3,E2:E3)', result: 15 });
  assert.deepEqual(ws.getCell('B9').value, { formula: 'B5*B6+B7+B8', result: 17 });
  assert.ok((await wb.xlsx.writeBuffer()).byteLength > 1000);
  const customer = await buildMixedWorkbook({ quote, sections, customerOnly: true });
  assert.deepEqual(customer.worksheets.map(s => s.name), ['混装报客价']);
  const dept = await buildMixedWorkbook({ quote, sections, dept: 'assembly' });
  assert.deepEqual(dept.worksheets.map(s => s.name), ['部门成本汇总']);
  assert.equal(dept.getWorksheet(1).getCell('C1').value, '装配人工 HKD');
});

test('货柜缺少箱规不可生成有效报价，切换出厂价不含运费', () => {
  const sections = fixture();
  edit(sections, 'sales', p => { p.shipping.container_key = 'yt40'; p.freight_calc = { cap_40: 1980, yt40: 7200 }; });
  assert.equal(calculateMixedQuote({}, sections).valid, false);
  edit(sections, 'sales', p => { p.shipping.container_key = 'factory'; });
  const r = calculateMixedQuote({}, sections, { strict: true });
  near(r.components.freight, 0); near(r.components.cabinet, 0);
});

test('附加税4%只按比例计收，忽略旧固定金额且支持税率修改', () => {
  const sections = fixture();
  edit(sections, 'sales', p => { p.mixed_pricing = { fixed_charge_hkd: 1, surtax_pct: 4, tax_mode: 'fixed' }; });
  const r = calculateMixedQuote({}, sections, { strict: true });
  near(r.pricing.fixed_charge_hkd, 0);
  near(r.surcharge_usd, r.before_surtax_usd * .04 * r.pricing.markup / r.pricing.divisor);
  edit(sections, 'sales', p => { p.mixed_pricing.surtax_pct = 0; });
  near(calculateMixedQuote({}, sections, { strict: true }).surcharge_usd, 0);
});

test('independent surtax markup leaves mixed product base pricing unchanged',()=>{
 const sections=fixture();
 edit(sections,'sales',p=>{p.shipping.markup_x=1.2;p.mixed_pricing.surtax_pct=0.4;});
 const first=calculateMixedQuote({qty:1000},sections);
 edit(sections,'sales',p=>{p.shipping.surtax_markup_x=2;});
 const next=calculateMixedQuote({qty:1000},sections);
 assert.equal(next.before_surtax_usd,first.before_surtax_usd);
 assert.equal(next.pricing.markup,1.2);
 near(next.surcharge_usd,first.surcharge_usd*2/1.2);
 edit(sections,'sales',p=>{p.shipping.surtax_markup_x=0;});
 assert.equal(calculateMixedQuote({qty:1000},sections).surcharge_usd,0);
});
