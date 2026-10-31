const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const {DatabaseSync} = require('node:sqlite');

test('direct costing stays separate from quotation reports and preserves real workflow data', {timeout: 60000}, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-costing-api-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const database = path.join(temporary, 'test.db'), pgUrl = process.env.TEST_DATABASE_URL;
  const schema = `direct_costing_${process.pid}_${Math.random().toString(16).slice(2)}`;
  let pgAdmin, pgRead, native;
  if (pgUrl) {
    const {Pool} = require('pg');
    pgAdmin = new Pool({connectionString: pgUrl});
    await pgAdmin.query(`CREATE SCHEMA ${schema}`);
    pgRead = new Pool({connectionString: pgUrl, options: `-c search_path=${schema},public`});
  }
  const child = spawn(process.execPath, ['backend/server.js'], {cwd: path.join(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', DB_DRIVER: pgUrl ? 'postgres' : 'sqlite', DB_FILE: pgUrl ? '' : database,
    DATABASE_URL: pgUrl || '', DB_SCHEMA: schema, PORT: String(port), HOST: '127.0.0.1',
    SESSION_SECRET: 'direct-costing-synthetic-only', COOKIE_SECURE: '0', ADMIN_INITIAL_PASSWORD: 'direct-costing-synthetic-only',
  }, stdio: ['ignore', 'pipe', 'pipe']});
  let errors = '';
  child.stderr.on('data', value => { errors += value; });
  t.after(async () => {
    if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
    if (native) native.close();
    if (pgRead) await pgRead.end();
    if (pgAdmin) { await pgAdmin.query(`DROP SCHEMA ${schema} CASCADE`); await pgAdmin.end(); }
    fs.rmSync(temporary, {recursive: true, force: true});
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('synthetic server startup timed out: ' + errors)), 15000);
    child.stdout.on('data', value => { if (String(value).includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`synthetic server exit ${code}: ${errors}`)); });
  });
  if (!pgUrl) native = new DatabaseSync(database);
  async function rows(sql, args = []) {
    if (!pgUrl) return native.prepare(sql).all(...args);
    let index = 0;
    return (await pgRead.query(sql.replace(/\?/g, () => `$${++index}`), args)).rows;
  }
  async function run(sql, args = []) {
    if (!pgUrl) return native.prepare(sql).run(...args);
    let index = 0;
    return pgRead.query(sql.replace(/\?/g, () => `$${++index}`), args);
  }
  const one = async (sql, args) => (await rows(sql, args))[0];
  function session() {
    let cookie = '';
    return async (url, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${url}`, {method,
        headers: {Cookie: cookie, 'Content-Type': 'application/json'}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
      if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      return {status: response.status, body: (response.headers.get('content-type') || '').includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer())};
    };
  }
  const api = session();
  assert.equal((await api('/auth/login', 'POST', {username: 'admin', password: 'direct-costing-synthetic-only'})).status, 200);
  const ordinary = await api('/quotes', 'POST', {quote_no: 'DIRECT-API-ORDINARY', product_name: 'Ordinary quote', customer: 'TEST', qty: 10});
  assert.equal(ordinary.status, 200);
  const input = {quote_no: 'DIRECT-API-TASK', product_name: 'Direct costing', customer: 'TEST', qty: 1234, quote_type: 'mixed'};
  const made = await api('/verifications', 'POST', input);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.id, versionId = made.body.version_id;

  await t.test('creation persists eight initialized departments, explicit origin, audit, and no customer confirmation', async () => {
    const record = await one('SELECT * FROM quote_verifications WHERE quote_id=?', [id]);
    assert.equal(record.origin, 'direct');
    assert.equal((await rows('SELECT * FROM quote_customer_confirmations WHERE quote_id=?', [id])).length, 0);
    const sections = await rows('SELECT * FROM quote_verification_sections WHERE version_id=?', [versionId]);
    assert.equal(sections.length, 8);
    assert.ok(sections.every(section => section.status === 'empty'));
    const baseline = JSON.parse(record.baseline_json);
    assert.equal(baseline.quote.qty, 1234);
    const sales = JSON.parse(sections.find(section => section.dept === 'sales').payload_json);
    assert.equal(sales.header.qty, 1234);
    assert.equal(sales.mixed_quote.enabled, true);
    assert.equal((await one("SELECT COUNT(*) AS n FROM audit_log WHERE quote_id=? AND action='verification_direct_create'", [id])).n, pgUrl ? '1' : 1);
  });

  await t.test('ordinary ledger, quotation summary, completion counts and downloaded workbook exclude direct costing', async () => {
    assert.deepEqual((await api('/quotes')).body.map(row => row.id), [ordinary.body.id]);
    const summary = await api('/quote-summary');
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.rows.map(row => row.id), [ordinary.body.id]);
    const complete = await api('/quote-summary/completion');
    assert.deepEqual(complete.body.totals, {total: 1, incomplete: 1, completed: 0});
    const workbook = new (require('exceljs').Workbook)();
    await workbook.xlsx.load((await api('/quote-summary/completion/xlsx')).body);
    assert.equal(workbook.worksheets[0].getCell('B4').value.result, 1);
    assert.equal((await api('/verifications')).body.rows.find(row => row.id === id).verification_origin, 'direct');
    assert.ok((await api('/verification-summary')).body.rows.some(row => row.quote_id === id || row.id === id));
  });

  await t.test('department save, submit, review, reopen, complete and version copy persist without rewriting baseline', async () => {
    const before = (await one('SELECT baseline_json FROM quote_verifications WHERE quote_id=?', [id])).baseline_json;
    let detail = (await api(`/verifications/${id}`)).body;
    let sales = detail.sections.find(section => section.dept === 'sales');
    const payload = JSON.parse(sales.payload_json); payload.review_test_note = 'persisted synthetic draft';
    const saved = await api(`/verifications/versions/${versionId}/sections/${sales.id}`, 'PUT', {payload, base_revision: sales.revision, submit: false});
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    detail = (await api(`/verifications/${id}`)).body;
    sales = detail.sections.find(section => section.dept === 'sales');
    assert.equal(JSON.parse(sales.payload_json).review_test_note, payload.review_test_note);
    for (const section of detail.sections) {
      const submitted = await api(`/verifications/versions/${versionId}/sections/${section.id}`, 'PUT', {payload: JSON.parse(section.payload_json), base_revision: section.revision, submit: true});
      assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
      const refreshed = (await api(`/verifications/${id}`)).body.sections.find(row => row.id === section.id);
      const reviewed = await api(`/verifications/versions/${versionId}/sections/${section.id}/review`, 'POST', {action: 'approve', base_revision: refreshed.revision});
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    }
    detail = (await api(`/verifications/${id}`)).body;
    assert.equal(detail.selected_version.status, 'ready');
    const reopened = await api(`/verifications/versions/${versionId}/sections/${sales.id}/reopen`, 'POST', {reason: 'synthetic review correction'});
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal((await one('SELECT status FROM quote_verification_sections WHERE id=?', [sales.id])).status, 'filled');
    assert.equal((await api(`/verifications/versions/${versionId}/sections/${sales.id}/review`, 'POST', {action: 'approve'})).status, 200);
    const completed = await api(`/verifications/versions/${versionId}/complete`, 'POST', {});
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    const frozen = await rows('SELECT * FROM quote_verification_sections WHERE version_id=? ORDER BY id', [versionId]);
    const next = await api(`/verifications/${id}/versions`, 'POST', {source_type: 'version', source_version_id: versionId});
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.deepEqual(await rows('SELECT * FROM quote_verification_sections WHERE version_id=? ORDER BY id', [versionId]), frozen);
    assert.equal((await one('SELECT baseline_json FROM quote_verifications WHERE quote_id=?', [id])).baseline_json, before);
    assert.equal((await rows('SELECT * FROM quote_customer_confirmations WHERE quote_id=?', [id])).length, 0);
    assert.equal((await api(`/quotes/${id}/header`, 'PUT', {product_name: 'must stay frozen'})).status, 409);
  });

  await t.test('duplicate, invalid, unauthorized and anonymous requests create no partial records', async () => {
    const count = () => one('SELECT COUNT(*) AS n FROM quotes');
    const before = await count();
    assert.equal((await api('/verifications', 'POST', input)).status, 409);
    assert.equal((await api('/verifications', 'POST', {...input, quote_no: 'INVALID', qty: 1.2})).status, 400);
    const anonymous = session();
    assert.equal((await anonymous('/verifications', 'POST', {...input, quote_no: 'ANONYMOUS'})).status, 401);
    const uid = (await one("SELECT id FROM users WHERE username='admin'")).id;
    await run("UPDATE users SET role='staff',dept='sewing' WHERE id=?", [uid]);
    await run('DELETE FROM user_perms WHERE user_id=?', [uid]);
    assert.equal((await api('/verifications', 'POST', {...input, quote_no: 'DENIED'})).status, 403);
    await run("UPDATE users SET dept='sales' WHERE id=?", [uid]);
    assert.equal((await api('/verifications', 'POST', {...input, quote_no: 'NO-CUSTOMER'})).status, 403);
    assert.deepEqual(await count(), before);
    assert.equal((await rows("SELECT * FROM quotes WHERE quote_no IN ('INVALID','ANONYMOUS','DENIED','NO-CUSTOMER')")).length, 0);
  });
  assert.ok(!/cannot start a transaction|SQLITE_BUSY|no transaction is active|\[error\]/.test(errors), errors);
});
