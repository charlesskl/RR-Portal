'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

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
  const records = [{
    id: 1,
    date: '2026-07-14',
    supplier: '=HYPERLINK("https://example.invalid","click")',
    productNo: '+1+1',
    productName: 'formula test',
    deliveryNo: 'DN-2026-001',
    orderNo: 'PO-2026-001',
    result: 'PASS',
  }];
  const saveResponse = await fetch(baseUrl + '/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  assert.equal(saveResponse.status, 200);

  const csvResponse = await fetch(baseUrl + '/api/export/records.csv');
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid"",""click""\)"/);
  assert.match(csv, /"'\+1\+1"/);
  assert.match(csv, /"PO号"/);
  assert.match(csv, /"PO-2026-001"/);
  assert.doesNotMatch(csv, /(?:^|,)"[=+\-@]/m);

  const excelResponse = await fetch(baseUrl + '/api/export/factory-excel.xls');
  assert.equal(excelResponse.status, 200);
  const excel = await excelResponse.text();
  assert.match(excel, /<th class="head">PO号<\/th>/);
  assert.match(excel, /<td>PO-2026-001<\/td>/);
});
