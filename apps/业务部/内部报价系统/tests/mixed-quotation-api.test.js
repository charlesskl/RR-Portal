const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
test('混装报价：新建、保存、拆价、权限、审核锁、确认锁和导出完整流程', { timeout: 30000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mixed-quotation-'));
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['backend/server.js'], { cwd: path.join(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', DB_DRIVER: 'sqlite', DB_FILE: path.join(temporary, 'test.db'),
    DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', SESSION_SECRET: 'mixed-test-only-secret', COOKIE_SECURE: '0', ADMIN_INITIAL_PASSWORD: 'mixed-test-only',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', data => { logs += data; });
  t.after(async () => { child.kill(); await new Promise(resolve => child.once('exit', resolve)); fs.rmSync(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out: ' + logs)), 15000);
    child.stdout.on('data', data => { if (String(data).includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/uploads/mold/audit-missing.png`)).status, 401);
  let cookie = '';
  async function api(url, method = 'GET', body, status = 200) {
    const res = await fetch(`http://127.0.0.1:${port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    if (res.headers.getSetCookie().length) cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const json = (res.headers.get('content-type') || '').includes('json');
    const data = json ? await res.json() : Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, status, `${method} ${url}: ${JSON.stringify(data)}`); return data;
  }
  await api('/auth/login', 'POST', { username: 'admin', password: 'mixed-test-only' });
  const created = await api('/quotes', 'POST', { quote_no: 'MIX-TEST', product_name: '混装测试', customer: 'TEST', qty: 1000, quote_type: 'mixed' });
  let data = await api('/quotes/' + created.id);
  assert.equal(data.mixed_quote.enabled, true);
  const sales = data.sections.find(s => s.dept === 'sales'), eng = data.sections.find(s => s.dept === 'engineering'), molding = data.sections.find(s => s.dept === 'molding');
  await api('/sections/' + sales.id, 'PUT', { payload: {}, submit: false }, 409);
  await api('/quotes/' + created.id + '/mixed', 'PUT', { config: data.mixed_quote, expected_config: null }, 409);
  const next = structuredClone(data.mixed_quote); next.units_per_pack = 6;
  await api('/quotes/' + created.id + '/mixed', 'PUT', { config: next, expected_config: data.mixed_quote });
  data = await api('/quotes/' + created.id);
  assert.equal(data.mixed_quote.units_per_pack, 6);
  const salesPayload = { mixed_quote: next, header: { fx_hkd_usd: 1, fx_rmb_hkd: 1 }, shipping: { markup_x: 1, divisor: 1 }, mixed_pricing: { surtax_pct: 0 } };
  await api('/sections/' + sales.id, 'PUT', { payload: salesPayload, submit: true }, 400);
  const initialSales = (await api('/quotes/' + created.id)).sections.find(s => s.dept === 'sales');
  const firstSave = await api('/sections/' + sales.id, 'PUT', { payload: salesPayload, submit: false, base_filled_at: initialSales.filled_at });
  await api('/sections/' + sales.id, 'PUT', { payload: { ...salesPayload, shipping: { ...salesPayload.shipping, markup_x: 9 } }, submit: false, base_filled_at: initialSales.filled_at }, 409);
  const afterConflict = (await api('/quotes/' + created.id)).sections.find(s => s.dept === 'sales');
  assert.equal(JSON.parse(afterConflict.payload_json).shipping.markup_x, 1);
  assert.equal(afterConflict.filled_at, firstSave.filled_at);

  await api('/sections/' + eng.id, 'PUT', { payload: { mixed_products: {
    p1: { hardware: [{ qty: 1, unit_price: 10 }], molds: [{ mold_no: 'A', name: 'A专用模' }] },
    p2: { hardware: [{ qty: 1, unit_price: 20 }], molds: [{ mold_no: 'B', name: 'B专用模' }] },
  }, mixed_shared: { hardware: [{ qty: 1, unit_price: 2 }] } }, submit: true });
  await api('/sections/' + molding.id, 'PUT', { payload: { mixed_molds: [{ mold_no: 'AB', machine_price: 100, target: 100, parts: [
    { product_id: 'p1', cavity: 1, usage: 1 }, { product_id: 'p2', cavity: 1, usage: 1 },
  ] }] }, submit: true });
  await api('/sections/' + sales.id, 'PUT', { payload: salesPayload, submit: true });
  const result = await api('/quotes/' + created.id + '/mixed');
  assert.equal(result.valid, true); assert.equal(result.final_usd, 95);
  const fresh = await api('/quotes/' + created.id);
  assert.equal(fresh.mixed_engineering_molds.p1[0].mold_no, 'A');
  assert.equal(fresh.mixed_engineering_molds.p2[0].mold_no, 'B');
  const { DatabaseSync } = require('node:sqlite');
  const local = new DatabaseSync(path.join(temporary, 'test.db'));
  const staff = local.prepare("INSERT INTO users (username,password_hash,display_name,dept,role,factory_code) VALUES (?,?,?,'molding','staff','qingxi')")
    .run('mold-test', require('bcryptjs').hashSync('mixed-staff-only', 4), '啤机测试账号').lastInsertRowid;
  local.prepare('INSERT INTO user_customers (user_id,customer) VALUES (?,?)').run(staff, 'TEST');
  local.close();
  const adminCookie = cookie; cookie = '';
  await api('/quotes/' + created.id + '/mixed', 'GET', undefined, 401);
  await api('/auth/login', 'POST', { username: 'mold-test', password: 'mixed-staff-only' });
  await api('/uploads/mold-sheet', 'POST', {}, 403);
  const restricted = await api('/quotes/' + created.id);
  assert.equal(restricted.sections.find(s => s.dept === 'sales').payload_json, null);
  assert.equal(restricted.mixed_quote.enabled, true);
  assert.equal(restricted.quotation_rates.fx_hkd_usd, 1);
  await api('/quotes/' + created.id + '/mixed', 'GET', undefined, 403);
  await api('/quotes/' + created.id + '/mixed', 'PUT', { config: next, expected_config: next }, 403);
  await api('/sections/' + eng.id, 'PUT', { payload: {}, submit: false }, 403);
  cookie = adminCookie;
  await api('/reviews/' + eng.id, 'POST', { action: 'approve' });
  const changed = structuredClone(next); changed.units_per_pack = 3;
  await api('/quotes/' + created.id + '/mixed', 'PUT', { config: changed, expected_config: next }, 409);
  await api('/sections/' + eng.id, 'PUT', { payload: {}, submit: false }, 409);
  for (const s of fresh.sections.filter(s => s.dept !== 'engineering')) {
    if (!['sales', 'molding'].includes(s.dept)) await api('/sections/' + s.id, 'PUT', { payload: {}, submit: true });
    await api('/reviews/' + s.id, 'POST', { action: 'approve' });
  }
  const buffer = await api('/quotes/' + created.id + '/export'); assert.ok(buffer.length > 1000);
  const customer = await api('/quotes/' + created.id + '/export-vq'); assert.ok(customer.length > 1000);
  const dept = await api('/quotes/' + created.id + '/export-department/molding'); assert.ok(dept.length > 1000);
  await api('/quote-summary/' + created.id + '/confirmation', 'PUT', { status: 'confirmed', confirmed_price: 95, confirmed_qty: 1000 });
  await api('/quotes/' + created.id + '/mixed', 'PUT', { config: changed, expected_config: next }, 409);
  await api('/sections/' + molding.id, 'PUT', { payload: {}, submit: false }, 409);
  // 已有单品升级时把完整资料归入首款，配置变化不删除历史资料。
  const single = await api('/quotes', 'POST', { quote_no: 'OLD-TEST', product_name: '旧报价', customer: 'TEST' });
  const old = await api('/quotes/' + single.id), oldEng = old.sections.find(s => s.dept === 'engineering');
  await api('/sections/' + oldEng.id, 'PUT', { payload: { hardware: [{ qty: 1, unit_price: 12 }] } });
  await api('/quotes/' + single.id + '/mixed', 'PUT', { config: next, expected_config: null });
  const converted = await api('/quotes/' + single.id);
  const engPayload = JSON.parse(converted.sections.find(s => s.dept === 'engineering').payload_json);
  assert.equal(engPayload.mixed_products.p1.hardware[0].unit_price, 12);
  const removed = structuredClone(next); removed.products[0].id = 'new-id';
  await api('/quotes/' + single.id + '/mixed', 'PUT', { config: removed, expected_config: next }, 409);
  const customerQuotes = {};
  for (const [index, name] of ['TOMY', 'SPIN', 'SPINMASTER-毛绒（印尼）', 'ZURU'].entries()) {
    await t.test(`${name}：混装报价、审核和客户导出金额一致`, async () => {
      cookie = adminCookie;
      const copy = await api('/quotes/' + created.id + '/clone', 'POST', { quote_no: `CUSTOMER-${index}`, customer: name });
      customerQuotes[name] = copy.id;
      const details = await api('/quotes/' + copy.id);
      assert.equal(details.quote.customer, name);
      for (const s of details.sections) {
        await api('/sections/' + s.id, 'PUT', { payload: JSON.parse(s.payload_json), submit: true });
        await api('/reviews/' + s.id, 'POST', { action: 'approve' });
      }
      const calculation = await api('/quotes/' + copy.id + '/mixed');
      assert.equal(calculation.final_usd, 95);
      const download = await api('/quotes/' + copy.id + '/export-vq');
      const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(download);
      assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['混装报客价']);
      const sheet = workbook.worksheets[0];
      const rows = sheet.getSheetValues().filter(Boolean);
      assert.equal(rows.find(row => row[1] === '每包装最终报价 USD')[2].result, calculation.final_usd);
      assert.equal(rows.find(row => row[1] === '客户')?.[2], name, '客户报客表必须标明客户');
    });
  }
  const accounts = new DatabaseSync(path.join(temporary, 'test.db'));
  const salesUser = accounts.prepare("INSERT INTO users (username,password_hash,display_name,dept,role,factory_code) VALUES (?,?,?,'sales','staff','qingxi')")
    .run('customer-scope', require('bcryptjs').hashSync('customer-scope-only', 4), '客户范围测试').lastInsertRowid;
  accounts.prepare('INSERT INTO user_customers (user_id,customer) VALUES (?,?)').run(salesUser, 'TOMY');
  accounts.prepare('INSERT INTO user_factories (user_id,factory_code) VALUES (?,?)').run(salesUser, 'qingxi');
  accounts.close(); cookie = '';
  await api('/auth/login', 'POST', { username: 'customer-scope', password: 'customer-scope-only' });
  await t.test('业务可上传并解析模具报价表', async () => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('模具报价');
    sheet.addRow(['模号', '零件名称', '材质', '出模数', '套数', '净重(g)', '模价RMB']);
    sheet.addRow(['M1', '共用盒子', 'PP', 4, 4, 2, 1000]);
    const form = new FormData();
    form.append('file', new Blob([await workbook.xlsx.writeBuffer()]), 'molds.xlsx');
    const response = await fetch(`http://127.0.0.1:${port}/api/uploads/mold-sheet`, {
      method: 'POST', headers: { Cookie: cookie }, body: form,
    });
    assert.equal(response.status, 200);
    const parsed = await response.json();
    assert.equal(parsed.molds.length, 1);
    assert.equal(parsed.molds[0].mold_no, 'M1');
  });

  await t.test('客户权限：选择、列表、汇总、详情、导出、新建和修改表头均限定授权客户', async () => {
    assert.deepEqual((await api('/quotes/customers')).customers, ['TOMY']);
    assert.ok((await api('/quotes')).every(q => q.customer === 'TOMY'));
    assert.ok((await api('/quote-summary')).rows.every(q => q.customer === 'TOMY'));
    const forbidden = customerQuotes.ZURU;
    for (const suffix of ['', '/mixed', '/export', '/export-vq', '/export-department/molding']) {
      await api('/quotes/' + forbidden + suffix, 'GET', undefined, 403);
    }
    await api('/quotes', 'POST', { quote_no: 'NOT-ALLOWED', product_name: '测试', customer: 'ZURU', quote_type: 'mixed' }, 403);
    const allowed = await api('/quotes', 'POST', { quote_no: 'ALLOWED', product_name: '测试', customer: 'TOMY', quote_type: 'mixed' });
    await api('/quotes/' + allowed.id + '/header', 'PUT', { customer: 'ZURU' }, 403);
    const unchanged = await api('/quotes/' + allowed.id);
    assert.equal(unchanged.quote.customer, 'TOMY');
  });
  await t.test('复制报价不能通过更改客户自动获得未授权客户的访问权', async () => {
    await api('/quotes/' + customerQuotes.TOMY + '/clone', 'POST', { quote_no: 'UNAUTHORIZED-CLONE', customer: 'ZURU' }, 403);
    assert.deepEqual((await api('/quotes/customers')).customers, ['TOMY']);
    const allowed = await api('/quotes/' + customerQuotes.TOMY + '/clone', 'POST', { quote_no: 'AUTHORIZED-CLONE', customer: ' TOMY ' });
    assert.equal((await api('/quotes/' + allowed.id)).quote.customer, 'TOMY');
  });
});
