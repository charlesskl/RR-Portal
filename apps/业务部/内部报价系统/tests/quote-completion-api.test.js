const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
test('报价完成汇总权限与统计', { timeout: 30000 }, async t => {
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
  const { DatabaseSync }=require('node:sqlite');
  const local=new DatabaseSync(path.join(temporary,'test.db'));
  const ids=[];
  for(let i=0;i<5;i++) ids.push((await api('/quotes','POST',{quote_no:'COMP-'+i,product_name:'测试',customer:'TOMY',qty:1})).id);
  local.prepare("UPDATE quote_sections SET status='approved' WHERE quote_id=?").run(ids[0]);
  local.prepare("UPDATE quotes SET status='fully_approved' WHERE id=?").run(ids[1]);
  local.prepare("UPDATE quote_sections SET status='approved' WHERE quote_id=?").run(ids[2]);
  local.prepare("DELETE FROM quote_sections WHERE quote_id=? AND dept='sales'").run(ids[2]);
  local.prepare("UPDATE quotes SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(ids[3]);
  local.prepare("UPDATE quotes SET factory_code=(SELECT code FROM factories WHERE code <> quotes.factory_code LIMIT 1) WHERE id=?").run(ids[4]);
  const report=await api('/quote-summary/completion');
  assert.deepEqual(report.totals,{total:3,incomplete:2,completed:1});
  const workbook=new (require('exceljs').Workbook)();
  await workbook.xlsx.load(await api('/quote-summary/completion/xlsx'));
  const sheet=workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(2).values.slice(1),['客户','新建报价','未完成报价','已完成报价','备注']);
  assert.equal(sheet.getCell('D3').value.formula,'B3-C3');
  assert.equal(sheet.getCell('B4').value.result,3);
  const admin=local.prepare("SELECT id FROM users WHERE username='admin'").get();
  local.prepare('UPDATE user_perms SET can_admin=1 WHERE user_id=?').run(admin.id);
  for(const role of ['supervisor','staff']) {
    local.prepare('UPDATE users SET role=? WHERE id=?').run(role,admin.id);
    await api('/quote-summary/completion','GET',undefined,403);
    await api('/quote-summary/completion/xlsx','GET',undefined,403);
  }
  cookie=''; await api('/quote-summary/completion','GET',undefined,401);
  local.close();
});
