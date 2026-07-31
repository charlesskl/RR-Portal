import test from 'node:test';
import assert from 'node:assert/strict';

let helperModule = {};
try {
  helperModule = await import('../src/utils/sameMoldMachineSync.js');
} catch {
  // RED 阶段：实现文件尚不存在时，让测试以明确断言失败。
}

function decide(items, record, newMachineNo) {
  assert.equal(
    typeof helperModule.getSameMoldMachineChange,
    'function',
    'must export getSameMoldMachineChange'
  );
  return helperModule.getSameMoldMachineChange(items, record, newMachineNo);
}

test('requires confirmation when an exact same mold name appears more than once', () => {
  const items = [
    { id: 1, machine_no: '15#', mold_name: 'RBCEZ2-06M-01 猫窝上盖' },
    { id: 2, machine_no: '20#', mold_name: 'RBCEZ2-06M-01 猫窝上盖' },
    { id: 3, machine_no: '24#', mold_name: 'RBCEZ2-07M-01 猫窝底座' },
  ];

  assert.deepEqual(decide(items, items[0], '26#'), {
    sameMoldCount: 2,
    shouldConfirm: true,
    shouldSync: true,
  });
});

test('does not group similar but non-identical mold names', () => {
  const items = [
    { id: 1, machine_no: '15#', mold_name: 'RBCEZ2-06M-01 猫窝上盖' },
    { id: 2, machine_no: '20#', mold_name: 'RBCEZ2-06M-01  猫窝上盖' },
  ];

  assert.deepEqual(decide(items, items[0], '26#'), {
    sameMoldCount: 1,
    shouldConfirm: false,
    shouldSync: false,
  });
});

test('does not group records with an empty mold name', () => {
  const items = [
    { id: 1, machine_no: '15#', mold_name: '' },
    { id: 2, machine_no: '20#', mold_name: '' },
  ];

  assert.deepEqual(decide(items, items[0], '26#'), {
    sameMoldCount: 1,
    shouldConfirm: false,
    shouldSync: false,
  });
});

test('does not confirm or sync when the machine has not changed', () => {
  const items = [
    { id: 1, machine_no: '15#', mold_name: 'RBCEZ2-06M-01 猫窝上盖' },
    { id: 2, machine_no: '20#', mold_name: 'RBCEZ2-06M-01 猫窝上盖' },
  ];

  assert.deepEqual(decide(items, items[0], '15#'), {
    sameMoldCount: 2,
    shouldConfirm: false,
    shouldSync: false,
  });
});
