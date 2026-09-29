const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ratioValue, weights } = require('../frontend/mixed-molds');
test('NA比例支持分数、算式、百分数并按权重求平均', () => {
  assert.equal(ratioValue('= (1+2)/6'), 0.5);
  assert.equal(ratioValue('25%'), 0.25);
  assert.equal(ratioValue('0/2'), 0);
  const config = { enabled: true, mode: 'ratio', units_per_pack: 6, products: [
    { id: 'p1', code: 'P1', name: 'A', ratio: '=1/3' },
    { id: 'p2', code: 'P2', name: 'B', ratio: '2/3' },
  ] };
  const w = weights(config);
  assert.equal(3*w.p1+6*w.p2, 5);
  assert.equal(config.products[0].ratio, '=1/3');
});
test('NA比例拒绝零分母、无效表达式与代码', () => {
  for (const text of ['1/0', '1/(1/0)', '-1', '1+', '(1/2', 'Math.random()', '1;alert(1)', '']) {
    assert.throws(() => ratioValue(text));
  }
});

test('手填NA比例直接求和，合计不为1也不归一化', () => {
  const { pricingWeights } = require('../frontend/mixed-molds');
  const config = { enabled: true, mode: 'ratio', na_direct: true, units_per_pack: 6, products: [
    { id: 'p1', code: 'P1', name: 'A', ratio: '=1/4' },
    { id: 'p2', code: 'P2', name: 'B', ratio: '1/4' },
  ] };
  const w = pricingWeights(config);
  assert.equal(4*w.p1 + 8*w.p2, 3);
  assert.equal(w.p1 + w.p2, 0.5);
  assert.equal(weights(config).p1, 0.5);
});
test('NA汇总作为算价底价，不再乘包装数量', () => {
  const { calculateMixedQuote } = require('../backend/services/mixedQuotation');
  const config = { enabled: true, mode: 'equal', na_direct: true, units_per_pack: 6, products: [
    { id: 'a', code: 'A', name: 'A', na_ratio: '1/4' },
    { id: 'b', code: 'B', name: 'B', na_ratio: '1/2' },
  ] };
  const payloads = { sales: { mixed_quote: config, shipping: { markup_x: 1.2, divisor: .98 }, mixed_pricing: { surtax_pct: .4 } },
    molding: { parts_catalog: { version: 1, parts: [
      { id: 'a', name: 'A', mold_no: 'M', cavity: 2, machine_price: 360, target: 1000, production_demand: 4000 },
      { id: 'b', name: 'B', mold_no: 'M', cavity: 4, machine_price: 360, target: 1000, production_demand: 4000 },
    ], selections: { a: [{ part_id: 'a', usage: 1 }], b: [{ part_id: 'b', usage: 1 }] } } } };
  const result = calculateMixedQuote({ qty: 8000 }, Object.entries(payloads).map(([dept,p]) => ({dept,payload_json:JSON.stringify(p)})));
  assert.equal(result.cost_units, 1);
  assert.ok(Math.abs(result.components.injection_labor - (.12*.25+.06*.5)) < 1e-10);
  assert.ok(Math.abs(result.before_surtax_usd-result.average_usd-result.common_usd) < 1e-10);
});

test('独立NA比例允许单款为零，但不能所有款全为零', () => {
  const { validateConfig } = require('../frontend/mixed-molds');
  const config={enabled:true,mode:'equal',na_direct:true,units_per_pack:6,products:[
    {id:'a',code:'A',name:'A',ratio:1,na_ratio:'0'}, {id:'b',code:'B',name:'B',ratio:1,na_ratio:'0'}
  ]};
  assert.throws(()=>validateConfig(config),/NA比例合计/);
  config.products[1].na_ratio='1/2';assert.doesNotThrow(()=>validateConfig(config));
});
