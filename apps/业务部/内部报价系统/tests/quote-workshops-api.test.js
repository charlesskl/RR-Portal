const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
test('报价车间：新增、去重、持久化及选用', { timeout: 30000 }, async t => {
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
  let summary=await api('/quote-summary');
  assert.ok(summary.workshops.some(w=>w.name==='RRI-印'));
  assert.ok(summary.workshops.some(w=>w.name==='RRM-印'));
  const custom=await api('/quote-summary/workshops','POST',{name:' 测试车间 '});
  assert.equal(custom.name,'测试车间');
  assert.deepEqual(await api('/quote-summary/workshops','POST',{name:'测试车间'}),custom);
  await api('/quote-summary/workshops','POST',{name:' '},400);
  await api('/quote-summary/workshops','POST',{name:'X'.repeat(41)},400);
  summary=await api('/quote-summary');
  assert.equal(summary.workshops.filter(w=>w.name==='测试车间').length,1);
  const created=await api('/quotes','POST',{quote_no:'WORKSHOP-TEST',product_name:'车间测试',customer:'TEST'});
  await api('/quote-summary/'+created.id+'/confirmation','PUT',{workshop:custom.code});
  summary=await api('/quote-summary');
  assert.deepEqual(summary.rows.find(r=>r.id===created.id).confirmation.workshops,[custom.code]);
  await api('/quote-summary/workshops','PUT',{code:custom.code,name:'新车间名称'});
  await api('/quote-summary/workshops','PUT',{code:'rri_id',name:'RRI新名称'});
  await api('/quote-summary/workshops','PUT',{code:custom.code,name:'RRI新名称'},409);
  await api('/quote-summary/workshops','PUT',{code:custom.code,name:' '},400);
  await api('/quote-summary/workshops','PUT',{code:'missing',name:'不存在'},404);
  summary=await api('/quote-summary');
  assert.equal(summary.workshops.find(w=>w.code===custom.code).name,'新车间名称');
  assert.equal(summary.workshops.find(w=>w.code==='rri_id').name,'RRI新名称');
  assert.deepEqual(summary.rows.find(r=>r.id===created.id).confirmation.workshops,[custom.code]);
  const workbook=new (require('exceljs').Workbook)();
  await workbook.xlsx.load(await api('/quote-summary/export/xlsx'));
  const cells=[];workbook.eachSheet(ws=>ws.eachRow(row=>row.eachCell(cell=>cells.push(cell.value))));
  assert.ok(cells.includes('新车间名称'));

});
