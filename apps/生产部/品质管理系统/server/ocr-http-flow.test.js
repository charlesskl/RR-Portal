'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const Auth = require('./auth');

test('isolated real OCR HTTP, explicit save, SQLite and reopen retain rows and permission boundaries', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qms-ocr-http-'));
  const serverDir = path.join(root, 'server'), dataDir = path.join(root, 'data');
  fs.mkdirSync(serverDir); fs.mkdirSync(dataDir);
  let child, model;
  t.after(async () => {
    if (child && child.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
    if (model) { model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const raw = '|订单号|货号|品名|数量|单位|\n|PO-SYNTH-1|SKU001|同名合成件|100|PCS|\n|PO-SYNTH-2|SKU001|同名合成件|100|PCS|';
  const replies = [raw, '供应商：合成供应商有限公司\n日期：2026-11-06\n送货单号：DN-SYNTH-01'];
  let modelCalls = 0;
  model = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); assert.equal(payload.model, 'synthetic');
    assert.equal(payload.messages[0].content[1].image_url.url, 'data:image/png;base64,c3ludGhldGlj');
    modelCalls++;
    assert.ok(replies.length, 'no unbounded provider retry');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: replies.shift() } }] }));
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  for (const filename of ['server.js', 'auth.js']) {
    let body = fs.readFileSync(path.join(__dirname, filename), 'utf8');
    if (filename === 'server.js') {
      assert.ok(body.includes("server.listen(PORT, undefined"));
      body = body.replace("server.listen(PORT, undefined", "server.listen(PORT, '127.0.0.1'");
    }
    fs.writeFileSync(path.join(serverDir, filename), body);
  }
  const password = 'synthetic-ocr-password';
  fs.writeFileSync(path.join(serverDir, 'seed.json'), JSON.stringify({ records: [], defectLib: [], users:
    ['jc', 'viewer'].map(username => ({ username, password: Auth.legacyHash(password), role: username === 'jc' ? 'admin' : 'viewer',
      enabled: true, ...(username === 'viewer' ? { perms: { records: { v: 1, e: 0, a: 0, m: 0 } } } : {}) })) }));
  fs.writeFileSync(path.join(serverDir, 'ai-config.json'), JSON.stringify({ enabled: true, apiKey: 'synthetic-key',
    ocrModel: 'synthetic', baseURL: 'http://127.0.0.1:' + model.address().port + '/v1' }));
  child = spawn(process.execPath, [path.join(serverDir, 'server.js')], { cwd: root,
    env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, NODE_ENV: 'test', NODE_NO_WARNINGS: '1', DATA_PATH: dataDir, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', base;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic OCR server startup timeout')), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)\/index.html/.exec(output);
      if (match && output.includes('AI(百炼):')) { base = 'http://127.0.0.1:' + match[1]; clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Synthetic OCR server exited ' + code)); });
  });
  async function request(route, method = 'GET', body, session) {
    const response = await fetch(base + route + '?company=dg-xingxin', { method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { cookie: session.cookie, 'X-QC-CSRF': session.csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json(), headers: response.headers };
  }
  async function login(username) {
    const r = await request('/api/login', 'POST', { username, password }); assert.equal(r.status, 200);
    return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.json.csrfToken };
  }
  const admin = await login('jc'), viewer = await login('viewer'), image = { image: 'data:image/png;base64,c3ludGhldGlj' };
  assert.equal((await request('/api/ai/ocr-extract', 'POST', image)).status, 401);
  assert.equal((await request('/api/ai/ocr-extract', 'POST', image, viewer)).status, 403);
  assert.equal(modelCalls, 0);
  // Two independent browser sessions use the same server parser. No provider call
  // is needed to reparse text, even when the table has empty continuation cells.
  const otherComputer = await login('jc');
  const columns = '|订单号|货号|配件名称|颜色|数量|单位|本单送货数/本单欠数|箱数|备注|';
  const componentRaw = [columns, '|PO-SYNTH|SKU001|甲身体||40|PCS||4|4*10|',
    '|||乙身体||16|PCS||1||', '|||丙身体||42|PCS||3|2*16+10|',
    '胶箱: 8', '收货人: QC: 送货人:合成人员'].join('\n');
  const left = await request('/api/ai/ocr-parse', 'POST', {text:componentRaw}, admin);
  const right = await request('/api/ai/ocr-parse', 'POST', {text:componentRaw}, otherComputer);
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  assert.deepEqual(left.json, right.json);
  assert.deepEqual(left.json.fields.items.map(row => [row.orderNo,row.productNo,row.productName,row.qty,row.cartons,row.remark]),
    [['PO-SYNTH','SKU001','甲身体','40','4','4*10'], ['PO-SYNTH','SKU001','乙身体','16','1',''], ['PO-SYNTH','SKU001','丙身体','42','3','2*16+10']]);
  assert.equal((await request('/api/ai/ocr-parse', 'POST', {text:componentRaw}, viewer)).status,403);
  const paperRaw = '订单号 产品名称 规格型号 数量 单价 金额 重量 备注\nPO-26001 30721 甲贴纸 80 1.5\nPO-26001 30721 LED贴纸 80 1.5\n备注：\n制单人：合成人员';
  const paper = await request('/api/ai/ocr-parse', 'POST', {text:paperRaw}, admin);
  assert.equal(paper.status,200); assert.equal(paper.json.fields.items.length,2);
  assert.deepEqual(paper.json.fields.items.map(i=>[i.orderNo,i.productNo,i.productName,i.qty]),
    [['PO-26001','30721','甲贴纸','80'],['PO-26001','30721','LED贴纸','80']]);
  assert.ok(paper.json.fields.items.every(i=>/右侧原文.*1\.5$/.test(i.remark)));
  assert.equal(modelCalls, 0);
  const ocr = await request('/api/ai/ocr-extract', 'POST', image, admin);
  assert.equal(ocr.status, 200); assert.equal(ocr.json.ok, true); assert.equal(modelCalls, 2);
  assert.equal(ocr.json.rawText, raw); assert.equal(ocr.json.needsManualReview, false);
  assert.equal(ocr.json.fields.supplier, '合成供应商有限公司'); assert.equal(ocr.json.fields.deliveryNo, 'DN-SYNTH-01');
  assert.deepEqual(ocr.json.fields.items.map(it => [it.orderNo, it.qty]), [['PO-SYNTH-1', '100'], ['PO-SYNTH-2', '100']]);
  assert.equal((await request('/api/bootstrap', 'GET', undefined, admin)).json.records.length, 0, 'recognition cannot auto-save');
  const records = ocr.json.fields.items.map((row, i) => ({ ...row, id: 580001 + i, qty: Number(row.qty),
    supplier: ocr.json.fields.supplier, deliveryNo: ocr.json.fields.deliveryNo, date: ocr.json.fields.date,
    status: 'pending', updatedAt: '2026-11-06T01:00:00.000Z' }));
  assert.equal((await request('/api/records', 'POST', { records }, viewer)).status, 403);
  assert.equal((await request('/api/records', 'POST', { records }, admin)).status, 200);
  const reopened = (await request('/api/bootstrap', 'GET', undefined, admin)).json.records;
  assert.deepEqual(reopened.map(row => [row.id, row.orderNo, row.productNo, row.qty, row.status]),
    [[580001, 'PO-SYNTH-1', 'SKU001', 100, 'pending'], [580002, 'PO-SYNTH-2', 'SKU001', 100, 'pending']]);
  const db = new DatabaseSync(path.join(dataDir, 'dg-xingxin', 'qc.db'), { readOnly: true });
  try {
    const saved = db.prepare('SELECT id,orderNo,qty,supplier,deliveryNo FROM records ORDER BY id').all();
    assert.deepEqual(saved.map(row => [row.id, row.orderNo, row.qty, row.supplier, row.deliveryNo]),
      records.map(row => [row.id, row.orderNo, row.qty, row.supplier, row.deliveryNo]));
  } finally { db.close(); }
  assert.equal(modelCalls, 2);
});
