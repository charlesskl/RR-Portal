const test = require('node:test');
const assert = require('node:assert');
const { calcPrices } = require('../lib/pricing');

test('核价 = 工价 × 2.1', () => {
  const r = calcPrices({ unit_wage: 0.03 });
  assert.strictEqual(Number(r.calc_price.toFixed(4)), 0.063);
});

test('油漆价 = 核价 × 0.35', () => {
  const r = calcPrices({ unit_wage: 0.03 });
  assert.strictEqual(Number(r.paint_price.toFixed(5)), 0.02205);
});

test('总核价 = 核价 + 油漆价', () => {
  const r = calcPrices({ unit_wage: 0.03 });
  assert.strictEqual(Number(r.total_price.toFixed(5)), 0.08505);
});

test('工价为 0 时全部为 0', () => {
  const r = calcPrices({ unit_wage: 0 });
  assert.strictEqual(r.calc_price, 0);
  assert.strictEqual(r.paint_price, 0);
  assert.strictEqual(r.total_price, 0);
});
