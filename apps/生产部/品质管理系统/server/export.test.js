'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const Auth = require('./auth');

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl + '/api/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('QC test server did not become healthy');
}

test('CSV export neutralizes spreadsheet formulas in text fields', async t => {
  const port = await getFreePort();
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-export-test-'));
  const serverPath = path.join(__dirname, 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const schema = vm.runInNewContext(source.slice(source.indexOf('const RECORD_COLS'), source.indexOf('const toNum')) + ';SCHEMA_SQL');
  const companyPath = path.join(dataPath, 'dg-xingxin'); fs.mkdirSync(companyPath);
  const fixtureDb = new DatabaseSync(path.join(companyPath, 'qc.db'));
  fixtureDb.exec(schema);
  fixtureDb.prepare('INSERT INTO users(username,password,role,enabled) VALUES(?,?,?,1)').run('jc', Auth.legacyHash('export-fixture-password'), 'admin');
  fixtureDb.close();
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), DATA_PATH: dataPath },
    stdio: 'ignore',
  });

  t.after(async () => {
    if (child.exitCode == null) {
      child.kill();
      await once(child, 'exit');
    }
    fs.rmSync(dataPath, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  const login = await fetch(baseUrl + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'jc', password: 'export-fixture-password' }) });
  assert.equal(login.status, 200);
  const csrf = (await login.json()).csrfToken, cookie = login.headers.get('set-cookie').split(';')[0];
  const authenticatedFetch = (url, options = {}) => fetch(url, { ...options, headers: { cookie, 'X-QC-CSRF': csrf, ...options.headers } });
  const records = [{
    // POST now merges records; do not overwrite the freshly seeded id 1 with
    // an intentionally historical timestamp used by this export fixture.
    id: 10001,
    date: '2026-07-14',
    supplier: '=HYPERLINK("https://example.invalid","click")',
    productNo: '+1+1',
    productName: 'formula test',
    deliveryNo: 'DN-2026-001',
    orderNo: 'PO-2026-001',
    result: 'PASS',
    updatedAt: '2026-07-16T09:30:00.000Z',
  }];
  const saveResponse = await authenticatedFetch(baseUrl + '/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  assert.equal(saveResponse.status, 200);

  const csvResponse = await authenticatedFetch(baseUrl + '/api/export/records.csv');
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid"",""click""\)"/);
  assert.match(csv, /"'\+1\+1"/);
  assert.match(csv, /"PO号"/);
  assert.match(csv, /"PO-2026-001"/);
  assert.match(csv, /"修改日期"/);
  assert.match(csv, /"2026-07-16"/);
  assert.doesNotMatch(csv, /(?:^|,)"[=+\-@]/m);

  const searchResponse = await authenticatedFetch(baseUrl + '/api/export/records.csv?search=2026-07-16');
  assert.equal(searchResponse.status, 200);
  assert.match(await searchResponse.text(), /"PO-2026-001"/);

  const excelResponse = await authenticatedFetch(baseUrl + '/api/export/factory-excel.xls');
  assert.equal(excelResponse.status, 200);
  const excel = await excelResponse.text();
  assert.match(excel, /<th class="head">PO号<\/th>/);
  assert.match(excel, /<td>PO-2026-001<\/td>/);
});
