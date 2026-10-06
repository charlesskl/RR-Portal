const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
test('混装小产品删除：确认、版本检查、保留共有资料和恢复备份', { timeout: 30000 }, async t => {
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
  const created = await api('/quotes', 'POST', {quote_no:'REMOVE-TEST',product_name:'删除测试',customer:'TEST',quote_type:'mixed'});
  let data = await api('/quotes/'+created.id);
  assert.deepEqual(data.mixed_quote.products, []);
  const cfg={...data.mixed_quote,products:[1,2,3].map(n=>({id:`p${n}`,code:`P${n}`,name:`小产品 ${n}`,ratio:1}))};
  const url='/quotes/'+created.id+'/mixed';
  await api(url,'PUT',{config:cfg,expected_config:data.mixed_quote});
  data=await api('/quotes/'+created.id);
  const eng=data.sections.find(s=>s.dept==='engineering');
  const payload={mixed_products:{p1:{hardware:[{name:'P1物料',qty:1,unit_price:2}]},p2:{hardware:[{name:'保留',qty:1,unit_price:3}]}},mixed_shared:{hardware:[{name:'共用',qty:1,unit_price:1}]},mixed_imported_parts:[{id:'shared-part',name:'共用零件'}],mixed_part_selections:{p1:[{part_id:'shared-part',usage:1}],p2:[{part_id:'shared-part',usage:2}]}};
  await api('/sections/'+eng.id,'PUT',{payload,submit:false,base_filled_at:eng.filled_at});
  data=await api('/quotes/'+created.id);
  const next={...cfg,products:cfg.products.slice(1)};
  await api(url,'PUT',{config:next,expected_config:cfg},409);
  await api(url,'PUT',{config:next,expected_config:cfg,confirmed_removed_ids:['p1'],expected_sections:{}},409);
  assert.deepEqual((await api('/quotes/'+created.id)).mixed_quote,cfg);
  const versions=Object.fromEntries(data.sections.filter(s=>s.dept!=='sales').map(s=>[s.id,s.filled_at||'']));
  await api(url,'PUT',{config:next,expected_config:cfg,confirmed_removed_ids:['p1'],expected_sections:versions});
  data=await api('/quotes/'+created.id);
  const after=JSON.parse(data.sections.find(s=>s.dept==='engineering').payload_json);
  assert.equal(after.mixed_products.p1,undefined);
  assert.equal(after.mixed_part_selections.p1,undefined);
  assert.deepEqual(after.mixed_products.p2,payload.mixed_products.p2);
  assert.deepEqual(after.mixed_shared,payload.mixed_shared);
  assert.deepEqual(after.mixed_imported_parts,payload.mixed_imported_parts);
  assert.deepEqual(after.mixed_part_selections.p2,payload.mixed_part_selections.p2);
  assert.deepEqual(data.mixed_quote,next);
  const {DatabaseSync}=require('node:sqlite');
  const database=new DatabaseSync(path.join(temporary,'test.db'));
  const backup=JSON.parse(database.prepare("SELECT detail FROM audit_log WHERE quote_id=? AND action='mixed_product_delete_backup'").get(created.id).detail);
  assert.deepEqual(JSON.parse(backup.sections.find(s=>s.dept==='engineering').payload_json),payload);
  database.close();
});
