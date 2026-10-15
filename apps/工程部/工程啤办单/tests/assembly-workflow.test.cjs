const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

// Only a temporary synthetic database is used. Never copy or open the app's data/.
const APP_DIR = path.resolve(__dirname, '..');
const SUPERVISOR = '段新辉';
const OTHER_SUPERVISOR = '唐海林';
const MANAGER = '易东存';
const TEST_PIN = '917482';
const TEST_SALT = 'isolated-assembly-workflow-test';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('assembly workflow uses isolated real HTTP storage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-assembly-test-'));
  const dataFile = path.join(dir, 'data.json');
  const hash = crypto.createHash('sha256').update(TEST_SALT + TEST_PIN).digest('hex');
  fs.writeFileSync(dataFile, JSON.stringify({
    injection_orders: [], injection_items: [], slush_orders: [], slush_items: [],
    spray_orders: [], spray_items: [], assembly_orders: [], assembly_items: [],
    material_prices: [], material_requisitions: [], assembly_users: [], problems: [], nextId: 1,
    auth_pins: { supervisors: { [SUPERVISOR]: hash, [OTHER_SUPERVISOR]: hash }, manager: { [MANAGER]: hash } }
  }));
  // Freeze the server clock to exercise same-millisecond revisions, including header-only edits.
  const clockFile = path.join(dir, 'fixed-clock.cjs');
  fs.writeFileSync(clockFile, `const NativeDate = Date; global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [1792022400000])); } static now() { return 1792022400000; } };`);
  let child;
  let base;
  let output = '';
  async function start() {
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--require', clockFile, path.join(APP_DIR, 'server.js')], {
      cwd: APP_DIR,
      env: { ...process.env, DATA_PATH: dir, PIN_SALT: TEST_SALT, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode != null) throw new Error(`server exited: ${output}`);
      try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`server did not start: ${output}`);
  }
  async function stop() {
    if (child && child.exitCode == null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  }
  async function request(url, method = 'GET', body, user) {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['X-User'] = encodeURIComponent(user);
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { code: res.status, data: await res.json() };
  }
  async function create() {
    const result = await request('/api/assembly', 'POST', {
      order_number: '', product_name: '合成测试产品', client_name: '合成测试客户', supervisor: SUPERVISOR,
      eng_name: '合成工程师', reason: '需保留的工程备注', new_images: [IMAGE],
      items: [
        { product_name: '夹具甲', quantity: '2', required_date: '2026-10-20', new_image: IMAGE, notes: '需保留的行备注' },
        { product_name: '夹具乙', quantity: '3', required_date: '2026-10-21', new_image: IMAGE }
      ]
    }, '合成工程师');
    assert.equal(result.code, 201);
    assert.equal(result.data.status, '待审核');
    return result.data;
  }
  async function status(order, value, role = 'supervisor', reviewer = SUPERVISOR, pin = TEST_PIN, reason) {
    return request(`/api/assembly/${order.id}/status`, 'PATCH', { status: value, reviewer_role: role, reviewer_name: reviewer, pin, reason });
  }
  async function ready() {
    const order = await create();
    assert.equal((await status(order, '待报价')).code, 200);
    return (await request(`/api/assembly/${order.id}`)).data;
  }
  function quoteBody(order) {
    return { expected_updated_at: order.updated_at, items: order.items.map((it, i) => ({ id: it.id, price: i === 0 ? 0 : '25.50', completion_time: '2026-10-23' })) };
  }
  try {
    await start();
    await t.test('new orders require product/client and begin at supervisor review; product number remains optional', async () => {
      const input = { product_name: '合成产品', client_name: '合成客户', supervisor: SUPERVISOR, items: [{ product_name: '夹具甲' }] };
      for (const body of [{ ...input, product_name: '' }, { ...input, client_name: '' }, { ...input, items: [] }, { ...input, status: '待生产' }, ...[undefined, null, '', '合成未知主管'].map(supervisor => ({ ...input, supervisor }))]) {
        assert.equal((await request('/api/assembly', 'POST', body, '合成工程师')).code, 400);
      }
      const order = await create();
      for (const supervisor of [null, '', '合成未知主管']) {
        assert.equal((await request(`/api/assembly/${order.id}`, 'PUT', { supervisor }, '合成工程师')).code, 400);
      }
    });
    await t.test('PIN, reviewer assignment, stage, and edit locks prevent skipping quote or manager approval', async () => {
      const order = await create();
      assert.equal((await status(order, '待报价', 'supervisor', SUPERVISOR, '')).code, 403);
      assert.equal((await status(order, '待报价', 'supervisor', OTHER_SUPERVISOR)).code, 403);
      assert.equal((await status(order, '待生产', 'manager', MANAGER)).code, 409);
      assert.equal((await request(`/api/assembly/${order.id}`, 'PUT', { status: '待生产' }, SUPERVISOR)).code, 403);
      assert.equal((await status(order, '待报价')).code, 200);
      assert.equal((await request(`/api/assembly/${order.id}/status`, 'PATCH', { status: '待经理审核' }, '夹具部')).code, 403);
      assert.equal((await request(`/api/assembly/${order.id}`, 'PUT', { reason: '越权更改' }, '合成工程师')).code, 403);
      assert.equal((await status(order, '待生产', 'supervisor', SUPERVISOR)).code, 409);
    });
    await t.test('invalid, incomplete, foreign, and stale quotes leave both disk and order unchanged', async () => {
      const order = await ready();
      const good = quoteBody(order);
      const disk = fs.readFileSync(dataFile, 'utf8');
      const url = `/api/assembly/${order.id}/quote`;
      assert.equal((await request(url, 'POST', good)).code, 401);
      assert.equal((await request(url, 'POST', good, '合成工程师')).code, 403);
      for (const invalid of [null, '', -1, 'NaN', 'Infinity', {}, true]) {
        const body = structuredClone(good); body.items[0].price = invalid;
        assert.equal((await request(url, 'POST', body, '夹具部')).code, 400);
      }
      for (const invalid of ['', null, '2026-02-30', '2026-13-01', '0000-10-23', '2026-1-2', '明天']) {
        const body = structuredClone(good); body.items[0].completion_time = invalid;
        assert.equal((await request(url, 'POST', body, '夹具部')).code, 400);
      }
      for (const body of [
        { ...good, expected_updated_at: '2020-01-01T00:00:00.000Z' },
        { ...good, items: [good.items[0], good.items[0]] },
        { ...good, items: [{ ...good.items[0], id: 9999999 }, good.items[1]] }
      ]) assert.equal((await request(url, 'POST', body, '夹具部')).code, 409);
      assert.equal((await request(url, 'POST', { ...good, items: [] }, '夹具部')).code, 400);
      assert.equal(fs.readFileSync(dataFile, 'utf8'), disk);
      assert.deepEqual((await request(`/api/assembly/${order.id}`)).data, order);
    });
    await t.test('same-stage edits invalidate a quote version and preserve its images', async () => {
      const order = await ready();
      const edited = await request(`/api/assembly/${order.id}`, 'PUT', { reason: '主管更新合成备注' }, SUPERVISOR);
      assert.equal(edited.code, 200);
      assert.ok(edited.data.updated_at > order.updated_at);
      assert.deepEqual(edited.data.items.map(it => it.image), order.items.map(it => it.image));
      assert.equal((await request(`/api/assembly/${order.id}/quote`, 'POST', quoteBody(order), '夹具部')).code, 409);
    });
    await t.test('disk failure cannot partially save quote fields, state, or cached data', async () => {
      const order = await ready();
      const disk = fs.readFileSync(dataFile, 'utf8');
      fs.mkdirSync(dataFile + '.tmp');
      try {
        assert.equal((await request(`/api/assembly/${order.id}/quote`, 'POST', quoteBody(order), '夹具部')).code, 500);
        assert.deepEqual((await request(`/api/assembly/${order.id}`)).data, order);
        assert.equal(fs.readFileSync(dataFile, 'utf8'), disk);
      } finally { fs.rmdirSync(dataFile + '.tmp'); }
      assert.equal((await request(`/api/assembly/${order.id}/quote`, 'POST', quoteBody(order), '夹具部')).code, 200);
    });
    await t.test('concurrent submissions atomically keep quote fields, IDs, engineering data, and images through restart', async () => {
      const order = await ready();
      const body = quoteBody(order);
      // Extra client fields must not replace the engineering part or row image.
      body.items[0].product_name = '不应覆盖工程名称'; body.items[0].image = null;
      const results = await Promise.all([1, 2].map(() => request(`/api/assembly/${order.id}/quote`, 'POST', body, '夹具部')));
      assert.deepEqual(results.map(r => r.code).sort(), [200, 409]);
      const saved = results.find(r => r.code === 200).data;
      assert.equal(saved.status, '待经理审核');
      assert.equal(saved.items[0].price, 0);
      assert.equal(saved.items[1].price, 25.5);
      assert.ok(saved.updated_at > order.updated_at);
      assert.deepEqual(saved.images, order.images);
      for (let i = 0; i < saved.items.length; i++) {
        const { price, completion_time, ...rest } = saved.items[i];
        assert.equal(completion_time, '2026-10-23');
        assert.deepEqual(rest, order.items[i]);
      }
      assert.equal(saved.reason, order.reason);
      const reviews = await request('/api/pending-reviews?role=manager');
      assert.ok(reviews.data.orders.some(o => o.id === order.id && o.type === 'assembly'));
      await stop(); await start();
      assert.deepEqual((await request(`/api/assembly/${order.id}`)).data, saved);
      for (const filename of [...saved.images, ...saved.items.map(it => it.image)]) {
        const image = await fetch(`${base}/api/assembly-images/${order.id}/${filename}`);
        assert.equal(image.status, 200);
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(IMAGE.split(',')[1], 'base64'));
      }
      assert.equal((await status(saved, '待生产', 'supervisor', SUPERVISOR)).code, 409);
      assert.equal((await status(saved, '待生产', 'manager', MANAGER)).code, 200);
      assert.equal((await request(`/api/assembly/${order.id}/status`, 'PATCH', { status: '已完成' }, '夹具部')).code, 409);
      assert.equal((await request(`/api/assembly/${order.id}/status`, 'PATCH', { status: '生产中' })).code, 401);
      assert.equal((await request(`/api/assembly/${order.id}/status`, 'PATCH', { status: '生产中' }, '夹具部')).code, 200);
      assert.equal((await request(`/api/assembly/${order.id}/status`, 'PATCH', { status: '已完成' }, '夹具部')).code, 200);
      assert.ok((await request(`/api/assembly/${order.id}`)).data.completed_date);
    });
    await t.test('PIN rejection preserves images and engineer can resubmit for a new full review', async () => {
      const order = await create();
      assert.equal((await status(order, '已驳回', 'supervisor', SUPERVISOR, TEST_PIN, '合成驳回原因')).code, 200);
      const rejected = (await request(`/api/assembly/${order.id}`)).data;
      assert.equal(rejected.reject_reason, '合成驳回原因');
      assert.deepEqual(rejected.items, order.items);
      assert.equal((await request(`/api/assembly/${order.id}`, 'PUT', { status: '待审核', reason: '合成修订原因' }, '合成工程师')).code, 200);
      assert.equal((await status(order, '待报价')).code, 200);
      const current = (await request(`/api/assembly/${order.id}`)).data;
      assert.equal((await request(`/api/assembly/${order.id}/quote`, 'POST', quoteBody(current), '夹具部')).code, 200);
      assert.equal((await status(order, '已驳回', 'manager', MANAGER, TEST_PIN, '合成经理驳回原因')).code, 200);
      assert.equal((await request(`/api/assembly/${order.id}`)).data.reject_reason, '合成经理驳回原因');
    });
  } finally { await stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
