const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('record edits and deletions persist and adjust only the linked equipment', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-records-'));
  process.env.AUTOMATION_DATA_DIR = directory;
  let server;
  let base;
  async function start() {
    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    base = `http://127.0.0.1:${server.address().port}/api`;
  }
  const close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  t.after(async () => { await close(); delete process.env.AUTOMATION_DATA_DIR; fs.rmSync(directory, { recursive: true, force: true }); });
  async function request(route, method = 'GET', body) {
    const response = await fetch(`${base}/${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  await start();
  const original = (await request('state')).data;
  const eq = original.equipment.find(e => e.id === 8);
  const edit = { date: '2026-08-16', production: 20000, line: '3号机', note: '调整产量' };
  await t.test('edit applies the delta, preserves other records and strips credentials', async () => {
    const result = await request('records/1', 'PUT', edit);
    assert.equal(result.status, 200);
    const updated = result.data.equipment.find(e => e.id === 8);
    near(updated.orders, eq.orders + .14);
    near(updated.saved, eq.saved + 1400 * eq.unitSave / 10000);
    near(updated.balance, eq.balance + 1400 * eq.unitSave / 10000);
    assert.deepEqual(result.data.equipment.filter(e => e.id !== 8), original.equipment.filter(e => e.id !== 8));
    assert.equal(result.data.records.find(r => r.id === 1).note, edit.note);
    assert.ok(result.data.users.every(u => !('passwordHash' in u)));
  });
  await t.test('invalid input and unknown IDs leave persisted data unchanged', async () => {
    const before = fs.readFileSync(path.join(directory, 'data.json'), 'utf8');
    for (const invalid of [{ production: 0 }, { production: -1 }, { production: 1.5 }, { date: '2026-02-30' }, { note: {} }]) {
      assert.equal((await request('records/1', 'PUT', { ...edit, ...invalid })).status, 400);
    }
    assert.equal((await request('records/99999', 'DELETE')).status, 404);
    assert.equal(fs.readFileSync(path.join(directory, 'data.json'), 'utf8'), before);
  });
  await t.test('edits survive a fresh server instance', async () => {
    await close(); await start();
    assert.equal((await request('state')).data.records.find(r => r.id === 1).production, 20000);
  });
  await t.test('equipment rename preserves record linkage', async () => {
    const current = (await request('state')).data.equipment.find(e => e.id === 8);
    const result = await request('equipment/8', 'PUT', { department: current.factory, workshop: current.workshop, name: '更名贴标机', quantity: current.qty, unitPrice: current.unitPrice, unitSave: current.unitSave, orders: current.orders, maOrder: current.maOrder });
    assert.equal(result.status, 200);
    assert.equal(result.data.records.find(r => r.id === 1).equipment, '更名贴标机');
  });
  await t.test('delete subtracts current production exactly once and survives restart', async () => {
    const before = (await request('state')).data.equipment.find(e => e.id === 8);
    const result = await request('records/1', 'DELETE');
    assert.equal(result.status, 200);
    assert.equal(result.data.records.length, 2);
    const after = result.data.equipment.find(e => e.id === 8);
    near(after.orders, before.orders - 2);
    near(after.saved, before.saved - 2 * eq.unitSave);
    near(after.balance, before.balance - 2 * eq.unitSave);
    assert.equal((await request('records/1', 'DELETE')).status, 404);
    await close(); await start();
    assert.deepEqual((await request('state')).data, result.data);
  });
  await t.test('missing equipment and inconsistent totals reject without writing', async () => {
    await close();
    const file = path.join(directory, 'data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.equipment = data.equipment.filter(e => e.id !== 10);
    data.equipment.find(e => e.id === 2).orders = 0;
    fs.writeFileSync(file, JSON.stringify(data));
    await start();
    const before = fs.readFileSync(file, 'utf8');
    assert.equal((await request('records/2', 'DELETE')).status, 409);
    assert.equal((await request('records/3', 'DELETE')).status, 409);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
  await t.test('cost prices persist, distinguish zero from missing, and preserve omitted values', async () => {
    const input = { department: '测试部门', workshop: '装配', name: '单价测试设备', quantity: 1, unitPrice: 100, manualPrice: .25, machinePrice: 0, orders: 1 };
    const created = await request('equipment', 'POST', input);
    assert.equal(created.status, 201);
    let eq = created.data.equipment.find(e => e.name === input.name);
    const id = eq.id;
    assert.equal(eq.manualPrice, .25);
    assert.equal(eq.machinePrice, 0);
    assert.equal(eq.unitSave, .25);
    const edit = { department: eq.factory, workshop: eq.workshop, name: eq.name, quantity: eq.qty, unitPrice: eq.unitPrice, orders: eq.orders, unitSave: eq.unitSave };
    let result = await request(`equipment/${id}`, 'PUT', { ...edit, manualPrice: .3, machinePrice: .05 });
    assert.equal(result.status, 200);
    result = await request(`equipment/${id}`, 'PUT', edit);
    eq = result.data.equipment.find(e => e.id === id);
    assert.equal(eq.manualPrice, .3);
    assert.equal(eq.machinePrice, .05);
    await close(); await start();
    eq = (await request('state')).data.equipment.find(e => e.id === id);
    assert.equal(eq.manualPrice, .3);
    assert.equal(eq.machinePrice, .05);
    const before = fs.readFileSync(path.join(directory, 'data.json'), 'utf8');
    for (const value of [-1, 'oops', {}, true, ' ']) {
      assert.equal((await request(`equipment/${id}`, 'PUT', { ...edit, manualPrice: value })).status, 400);
      assert.equal((await request('equipment', 'POST', { ...input, name: '非法数据', machinePrice: value })).status, 400);
    }
    assert.equal(fs.readFileSync(path.join(directory, 'data.json'), 'utf8'), before);
    result = await request(`equipment/${id}`, 'PUT', { ...edit, manualPrice: null, machinePrice: 0 });
    eq = result.data.equipment.find(e => e.id === id);
    assert.equal(eq.manualPrice, null);
    assert.equal(eq.machinePrice, 0);
    assert.equal(result.data.equipment.find(e => e.id === 1).manualPrice, .214);
  });

});
