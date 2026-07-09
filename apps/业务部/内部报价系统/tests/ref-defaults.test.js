const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeMissingRefDefaults } = require('../backend/db/ref-defaults');

test('mergeMissingRefDefaults appends missing material defaults without replacing existing rows', () => {
  const existing = [
    { name: 'ABS', model: '750SW', price: 8.8 },
    { name: 'C-ABS', model: 'TR558/920', price: 12.5 },
  ];
  const defaults = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ];

  const merged = mergeMissingRefDefaults(existing, defaults);

  assert.deepEqual(merged, [
    { name: 'ABS', model: '750SW', price: 8.8 },
    { name: 'C-ABS', model: 'TR558/920', price: 12.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ]);
});

test('mergeMissingRefDefaults is idempotent', () => {
  const existing = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ];
  const defaults = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ];

  assert.deepEqual(mergeMissingRefDefaults(existing, defaults), existing);
});
