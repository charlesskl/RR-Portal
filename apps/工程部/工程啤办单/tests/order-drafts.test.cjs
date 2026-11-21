const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-drafts-'));
test('drafts survive restart and only become orders on successful submission', async t => {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  let child; let output = '';
  async function start() {
    child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, DATA_PATH: dir, PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('server did not start: ' + output);
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  async function req(route, method = 'GET', body, auth = true) {
    const r = await fetch(`http://127.0.0.1:${port}/api${route}`, {method, headers: {'Content-Type':'application/json', ...(auth ? {'X-User':encodeURIComponent('测试工程师')} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status:r.status, body:await r.json()};
  }
  try {
    await start();
    await t.test('accepts incomplete drafts without creating or exposing orders', async () => {
      assert.equal((await req('/order-drafts','POST',{type:'injection',source:'engineering',payload:{}},false)).status,401);
      for (const type of ['injection','slush','spray','assembly']) {
        const payload = {version:1,headers:[],rows:[{values:[{value:'未完成'}]}]};
        const d = await req('/order-drafts','POST',{type,source:'engineering',title:type,payload});
        assert.equal(d.status,200);
        assert.deepEqual((await req('/order-drafts/'+d.body.id)).body.payload,payload);
        assert.equal((await req('/'+type)).body.length,0);
      }
    });
    await stop(); await start();
    await t.test('persists and atomically consumes a draft once', async () => {
      const all = (await req('/order-drafts?source=engineering')).body;
      assert.equal(all.length,4);
      const draft = all.find(d => d.type === 'injection');
      const body = {draft_id:draft.id,draft_version:1, product_name:'测试产品', status:'待审核', items:[{mold_name:'测试模'}]};
      const saved = await req('/injection','POST',body);
      assert.equal(saved.status,201); assert.equal(saved.body.status,'待审核');
      assert.equal((await req('/order-drafts/'+draft.id)).status,404);
      assert.equal((await req('/injection','POST',body)).status,409);
      assert.equal((await req('/injection')).body.length,1);
    });
    await t.test('assembly images and draft are committed together even after a disk failure', async () => {
      const draft = (await req('/order-drafts?source=engineering')).body.find(d => d.type === 'assembly');
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2p8AAAAASUVORK5CYII=';
      const body = {draft_id:draft.id,draft_version:1, product_name:'夹具测试', client_name:'测试客户', supervisor:'段新辉', items:[{product_name:'测试明细',new_image:image}]};
      fs.mkdirSync(path.join(dir,'data.json.tmp'));
      assert.equal((await req('/assembly','POST',body)).status,500);
      assert.equal((await req('/order-drafts/'+draft.id)).status,200);
      assert.equal((await req('/assembly')).body.length,0);
      fs.rmdirSync(path.join(dir,'data.json.tmp'));
      const saved = await req('/assembly','POST',body);
      assert.equal(saved.status,201);
      assert.ok(saved.body.items[0].image);
      assert.equal((await req('/order-drafts/'+draft.id)).status,404);
      assert.equal((await req('/assembly','POST',body)).status,409);
    });
    await t.test('stale draft tabs cannot overwrite, delete or submit another saved revision', async () => {
      const original = {type:'spray',source:'engineering',payload:{version:1,notes:'first'}};
      const created = (await req('/order-drafts','POST',original)).body;
      const revised = await req('/order-drafts','POST',{...original,id:created.id,base_version:1,payload:{version:1,notes:'newer'}});
      assert.equal(revised.status,200);
      assert.equal((await req('/order-drafts','POST',{...original,id:created.id,base_version:1})).status,409);
      assert.equal((await req('/order-drafts/'+created.id,'DELETE',{base_version:1})).status,409);
      assert.equal((await req('/spray','POST',{draft_id:created.id,draft_version:1,items:[]})).status,409);
      assert.equal((await req('/order-drafts/'+created.id)).body.payload.notes,'newer');
      assert.equal((await req('/order-drafts/'+created.id,'DELETE',{base_version:2})).status,200);
    });
    await t.test('invalid submissions preserve draft; conflicting edits cannot overwrite original', async () => {
      const assembly = (await req('/order-drafts','POST',{type:'assembly',source:'engineering',payload:{version:1}})).body;
      assert.equal((await req('/assembly','POST',{draft_id:assembly.id,draft_version:1,items:[]})).status,400);
      assert.equal((await req('/order-drafts/'+assembly.id)).status,200);
      const order = (await req('/injection')).body[0];
      const draft = await req('/order-drafts','POST',{type:'injection',source:'engineering',order_id:order.id,base_updated_at:order.updated_at,payload:{version:1}});
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal((await req('/injection/'+order.id,'PUT',{reason:'另一人修改'})).status,200);
      assert.equal((await req('/injection/'+order.id,'PUT',{draft_id:draft.body.id,draft_version:1,reason:'覆盖'})).status,409);
      assert.equal((await req('/injection/'+order.id)).body.reason,'另一人修改');
      assert.equal((await req('/order-drafts/'+draft.body.id)).status,200);
    });
  } finally { await stop(); fs.rmSync(dir, {recursive:true,force:true}); }
});
