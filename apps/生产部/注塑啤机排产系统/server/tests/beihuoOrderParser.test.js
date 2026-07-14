const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBeihuoRawRows } = require('../services/beihuoOrderParser');

test('recovers shot weight and material kg shifted into the material column', () => {
  const [order] = parseBeihuoRawRows([{
    product_code: '1126169',
    mold_no: '1126169-M01',
    mold_name_part: '面壳',
    total_sets: '9036',
    quantity_needed: '4518',
    material_type: 'ABS 750NSW 52.5 237.2',
    delivery_date: '0 0.0 2026/4/27',
  }]);

  assert.equal(order.material_type, 'ABS 750NSW');
  assert.equal(order.shot_weight, 52.5);
  assert.equal(order.material_kg, 237.2);
  assert.equal(order.quantity_needed, 4518);
  assert.equal(order.cavity, 2);
  assert.match(order.notes, /2026-04-27/);
});

test('recovers material kg shifted past the shot weight column', () => {
  const [order] = parseBeihuoRawRows([{
    product_code: '1126169',
    mold_no: '1126169-M03',
    mold_name_part: '中框',
    total_sets: '4200',
    quantity_needed: '2100',
    material_type: 'ABS 750NSW 22.4',
    delivery_date: '47.0 0 0.0 2026-05-11',
  }]);

  assert.equal(order.material_type, 'ABS 750NSW');
  assert.equal(order.shot_weight, 22.4);
  assert.equal(order.material_kg, 47);
});

test('does not mistake a material grade for shot weight without a consistent kg value', () => {
  const [order] = parseBeihuoRawRows([{
    product_code: '15714',
    mold_no: 'FUGG-05M-01',
    mold_name_part: '牙齿模',
    quantity_needed: '1875',
    material_type: 'ABS 750',
    delivery_date: '2026-05-11',
  }]);

  assert.equal(order.material_type, 'ABS 750');
  assert.equal(order.shot_weight, 0);
  assert.equal(order.material_kg, 0);
});
