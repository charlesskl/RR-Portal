import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import core from '../shared/business-sync.cjs';
import {startBusinessSync} from '../collector/business-sync.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const MiB = 1024 * 1024;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
const token = 'synthetic-large-sync-token-'.padEnd(48, 'x');
const password = 'synthetic-large-sync-admin';
const station = 'large-fixture';
const clientId = '11111111-1111-1111-1111-111111111111';
const image = 'data:image/png;base64,' + 'A'.repeat(512 * 1024);
const healthProbe = "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";
const empty = () => ({products: [], materials: [], records: {}, inventory: {}, settings: {}});

// The request client and all fixtures live outside the container memory budget.
// No real backup, station credentials, images or business data are used.
function fixture() {
  const source = {...empty(), products: Array.from({length: 42}, (_, index) => ({
    id: index + 1, name: `Synthetic product ${index + 1}`, price: 10, image
  })), materials: [{id: 1, name: 'PETG'}], inventory: {PETG: {stockG: 1000, minStockG: 50}},
  fixtureLocalMetadata: 'C'.repeat(Math.round(0.4 * MiB))};
  const remote = core.project(source);
  remote.products['1'].name = 'Synthetic Windows product 1';
  return {source, remote, baseline: JSON.stringify(core.project(empty()))};
}

async function listen(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function unusedPort() {
  const server = http.createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function docker(args) {
  const result = spawnSync('docker', args, {encoding: 'utf8', maxBuffer: 2 * MiB});
  assert.equal(result.status, 0, `docker ${args[0]} failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

function inspectContainer(id) {
  // Only lifecycle/resource fields; never serialize container configuration or env.
  return JSON.parse(docker(['inspect', '--format',
    '{"running":{{.State.Running}},"oom":{{.State.OOMKilled}},"restarts":{{.RestartCount}},"pid":{{.State.Pid}},"started":{{json .State.StartedAt}},"health":{{json .State.Health.Status}},"memory":{{.HostConfig.Memory}},"swap":{{.HostConfig.MemorySwap}}}', id]));
}

function parseAppProcesses(output) {
  const files = {'start.mjs': 'supervisor', 'cloud/server.mjs': 'cloud', 'production/server.js': 'production'};
  const roles = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)/);
    if (!match || !/(^|\/)node$/.test(match[3])) continue;
    const file = match[4].replace(/^\/app\//, '').replace(/^\.\//, '');
    if (!Object.hasOwn(files, file)) continue;
    // Keep only fixed synthetic service names, never the complete command or env.
    roles.push({pid: Number(match[1]), ppid: Number(match[2]), file, role: files[file]});
  }
  const supervisor = roles.find(row => row.role === 'supervisor');
  const valid = roles.length === 3 && new Set(roles.map(row => row.role)).size === 3 &&
    roles.every(row => row === supervisor || row.ppid === supervisor.pid);
  return {roles, pids: valid ? roles.map(row => row.pid).sort((a, b) => a - b) : []};
}

function appProcesses(id) {
  // Linux Node 24 may name its comm MainThread. Match the known entry-point
  // arguments instead, excluding concurrent healthcheck Node processes.
  return parseAppProcesses(docker(['top', id, '-eo', 'pid,ppid,args']));
}

test('Docker process parsing identifies the three service roles and excludes healthchecks', () => {
  const output = `PID PPID COMMAND
200 1 node start.mjs --cloud-only
201 200 /usr/local/bin/node /app/production/server.js
202 200 /usr/local/bin/node cloud/server.mjs
203 1 sh -c node -e healthcheck
204 203 node -e fetch('http://127.0.0.1:3100/api/health')
205 1 node -e start.mjs cloud/server.mjs production/server.js DO_NOT_OUTPUT_EXTRA_ARGS`;
  const parsed = parseAppProcesses(output);
  assert.deepEqual(parsed.pids, [200, 201, 202]);
  assert.deepEqual(parsed.roles.map(row => row.role), ['supervisor', 'production', 'cloud']);
  assert.ok(!JSON.stringify(parsed).includes('DO_NOT_OUTPUT_EXTRA_ARGS'));
  assert.deepEqual(parseAppProcesses(output.replace('202 200', '202 999')).pids, []);
  assert.deepEqual(parseAppProcesses(output.replace('202 200 /usr/local/bin/node cloud/server.mjs', '')).pids, []);
});

function watchRss(parentPid) {
  let peakKiB = 0, lastKiB = 0;
  const processPeakKiB = {};
  const sample = () => {
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,args='], {encoding: 'utf8'});
    if (result.status !== 0) return;
    const rows = result.stdout.trim().split('\n').map(line => {
      const [pid, ppid, rss, ...args] = line.trim().split(/\s+/);
      return [Number(pid), Number(ppid), Number(rss), args];
    });
    const app = rows.filter(([pid, ppid]) => pid === parentPid || ppid === parentPid);
    lastKiB = app.reduce((sum, row) => sum + row[2], 0);
    peakKiB = Math.max(peakKiB, lastKiB);
    for (const [, , rss, args] of app) {
      const role = ['start.mjs', 'cloud/server.mjs', 'production/server.js'].find(file => args.includes(file));
      if (role) processPeakKiB[role] = Math.max(processPeakKiB[role] || 0, rss);
    }
  };
  sample();
  const timer = setInterval(sample, 30);
  return {sample, read: () => ({currentMiB: lastKiB / 1024, peakMiB: peakKiB / 1024,
    processPeakMiB: Object.fromEntries(Object.entries(processPeakKiB).map(([role, rss]) => [role, rss / 1024]))}),
    close: () => clearInterval(timer)};
}

async function launch(dir) {
  const stations = JSON.stringify([{id: station, name: 'Synthetic station', factories: ['清溪'], machines: ['101'], token}]);
  const dockerImage = process.env.PRINTLINK_LARGE_TEST_DOCKER_IMAGE;
  if (dockerImage) {
    assert.equal(process.platform, 'linux', 'The cgroup test must run on Linux');
    // USER node (uid 1000) must be able to create SQLite and lock files in this
    // synthetic mount, even when the GHA runner uses a different host uid.
    chmodSync(dir, 0o777);
    const health = `node -e "${healthProbe}"`;
    const id = docker(['run', '--detach', '--init', '--memory=512m', '--memory-swap=512m', '--restart=no',
      '--health-cmd', health, '--health-interval=10s', '--health-timeout=5s', '--health-retries=3',
      '--publish', '127.0.0.1::3100', '--mount', `type=bind,src=${dir},dst=/app/runtime`,
      '--env', 'APP_MODE=production', '--env', 'COOKIE_SECURE=false',
      '--env', `ADMIN_PASSWORD=${password}`, '--env', `BUSINESS_SYNC_STATION=${station}`,
      '--env', `COLLECTOR_STATIONS=${stations}`, dockerImage]);
    const address = docker(['port', id, '3100/tcp']).split('\n')[0];
    return {base: `http://${address}`, id, state: () => inspectContainer(id), processes: () => appProcesses(id),
      peak: () => Number(docker(['exec', id, 'sh', '-c',
        'if [ -r /sys/fs/cgroup/memory.peak ]; then cat /sys/fs/cgroup/memory.peak; else cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes; fi'])) / MiB,
      concurrentHealth: () => new Promise((resolve, reject) => {
        const child = spawn('docker', ['exec', id, 'node', '-e', healthProbe], {stdio: 'ignore'});
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`Concurrent healthcheck failed: code=${code} signal=${signal}`)));
      }),
      logs: () => docker(['logs', '--tail', '30', id]),
      stop: async () => {
        docker(['rm', '--force', id]);
        // The production USER node owns nested directories/0700 locks. Return
        // this synthetic mount to the runner even if the app exited from OOM.
        docker(['run', '--rm', '--user', '0:0', '--mount', `type=bind,src=${dir},dst=/app/runtime`,
          dockerImage, 'chown', '-R', `${process.getuid()}:${process.getgid()}`, '/app/runtime']);
      }};
  }
  const port = await unusedPort(), internalPort = await unusedPort();
  // Do not tune NODE_OPTIONS: this must use the same heap policy as production.
  const env = {...process.env, APP_MODE: 'production', PLATFORM_DATA_DIR: dir, PORT: String(port),
    PRODUCTION_PORT: String(internalPort), COOKIE_SECURE: 'false', ADMIN_PASSWORD: password,
    BUSINESS_SYNC_STATION: station, COLLECTOR_STATIONS: stations};
  delete env.NODE_OPTIONS;
  let logs = '';
  const child = spawn(process.execPath, ['start.mjs', '--cloud-only'], {cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', value => {logs = (logs + value).slice(-8192);});
  child.stderr.on('data', value => {logs = (logs + value).slice(-8192);});
  const rss = watchRss(child.pid);
  return {base: `http://127.0.0.1:${port}`, child, rss, logs: () => logs,
    stop: async () => {
      rss.close();
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        child.once('exit', () => {clearTimeout(timer); resolve();});
      });
    }};
}

function readState(dir) {
  const db = new DatabaseSync(path.join(dir, 'production.sqlite'), {readOnly: true});
  const cloudDb = new DatabaseSync(path.join(dir, 'orders', 'printlink.sqlite'), {readOnly: true});
  try {
    const raw = db.prepare('SELECT value FROM snapshot WHERE id=1').get().value;
    const snapshot = JSON.parse(raw), state = JSON.parse(db.prepare('SELECT value FROM business_sync_state WHERE id=1').get()?.value || '{}');
    return {snapshotSha: sha(raw), businessSha: core.fingerprint(core.project(snapshot)),
      imagesSha: sha(JSON.stringify(snapshot.products.map(row => [row.id, row.image]))),
      inventorySha: core.fingerprint(snapshot.inventory), localMetadataSha: sha(snapshot.fixtureLocalMetadata),
      name: snapshot.products.find(row => row.id === 1).name,
      ledgerSha: sha(JSON.stringify(db.prepare('SELECT * FROM source_inventory_ledger ORDER BY item').all())),
      usersSha: sha(JSON.stringify(cloudDb.prepare('SELECT * FROM users ORDER BY id').all())),
      ordersSha: sha(JSON.stringify(cloudDb.prepare('SELECT * FROM orders ORDER BY id').all())),
      backupCount: db.prepare('SELECT COUNT(*) count FROM business_sync_backups').get().count,
      receipt: state.receipt, conflicts: state.conflicts?.length || 0, lastSuccess: state.lastSuccess};
  } finally {db.close(); cloudDb.close();}
}

async function request(base, route, {data, body, headers = {}, timeoutMs = 120000} = {}) {
  const response = await fetch(base + route, {method: data || body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json', ...headers}, body: body || (data ? JSON.stringify(data) : undefined),
    signal: AbortSignal.timeout(timeoutMs)});
  const text = await response.text();
  return {status: response.status, data: JSON.parse(text), bytes: Buffer.byteLength(text), headers: response.headers};
}

async function waitForCloud(app) {
  // Docker can publish its port before the cloud listener starts, resetting
  // connections in that interval. Only the startup health check retries them.
  const deadline = Date.now() + 15000;
  let ready = false;
  do {
    try {
      ready = (await fetch(app.base + '/api/health', {signal: AbortSignal.timeout(
        Math.max(1, Math.min(1000, deadline - Date.now())))})).status === 200;
    } catch {}
    if (ready || Date.now() >= deadline || app.child?.exitCode !== null && app.child?.exitCode !== undefined) break;
    await delay(Math.min(100, deadline - Date.now()));
  } while (Date.now() < deadline);
  assert.ok(ready, app.logs());
}

test('real three-process app preserves images through 21/42 MiB sync, conflicts, success and receipt retry', {timeout: 180000}, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'printlink-large-http-'));
  const {source, remote, baseline} = fixture();
  const sourceText = JSON.stringify(source), remoteSha = core.fingerprint(remote);
  assert.ok(Buffer.byteLength(sourceText) > 21.39 * MiB && Buffer.byteLength(sourceText) < 21.45 * MiB);
  writeFileSync(path.join(dir, 'production-source.json'), sourceText, {mode: 0o644});
  let app, windows;
  const bridgeDb = new DatabaseSync(':memory:');
  bridgeDb.exec('CREATE TABLE business_sync_base(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE business_sync_client(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
  bridgeDb.prepare('INSERT INTO business_sync_base VALUES(1,?)').run(baseline);
  bridgeDb.prepare('INSERT INTO business_sync_client VALUES(1,?)').run(clientId);
  let localWrites = 0, runner;
  const results = [];
  const exchangeBody = JSON.stringify({clientId, base: JSON.parse(baseline), remote});
  assert.ok(Buffer.byteLength(exchangeBody) > 21 * MiB && Buffer.byteLength(exchangeBody) < 21.1 * MiB);
  try {
    app = await launch(dir);
    await waitForCloud(app);
    // Cloud health is independent of production startup. Wait for the real,
    // non-mutating sync probe before inspecting production-owned tables.
    const auth = {Authorization: 'Bearer ' + token};
    const productionDeadline = Date.now() + 15000;
    let probe;
    do {
      probe = await request(app.base, '/api/collector/business-sync', {headers: auth, data: {
        clientId, probe: true, baseHash: remoteSha, remoteHash: remoteSha},
        timeoutMs: Math.max(1, productionDeadline - Date.now())});
      if (probe.status !== 502 || Date.now() >= productionDeadline) break;
      await delay(Math.min(100, productionDeadline - Date.now()));
    } while (Date.now() < productionDeadline);
    assert.equal(probe.status, 200, app.logs()); assert.equal(probe.data.unchanged, false);
    const before = readState(dir), initialContainer = app.id ? app.state() : null;
    const initialProcessInfo = app.id ? app.processes() : null;
    const initialProcesses = initialProcessInfo?.pids;
    if (app.id) {assert.equal(initialProcesses.length, 3, JSON.stringify(initialProcessInfo.roles)); assert.equal(initialContainer.memory, 512 * MiB); assert.equal(initialContainer.swap, 512 * MiB);}
    app.rss?.sample();
    const beforeRss = app.rss?.read();

    // Real collector implementation against an isolated synthetic Windows HTTP
    // endpoint. The baseline must remain exact when reconciliation is blocked.
    windows = http.createServer((req, res) => {
      if (req.method === 'POST') localWrites++;
      res.writeHead(req.method === 'GET' ? 200 : 500, {'Content-Type': 'application/json'});
      res.end(req.method === 'GET' ? JSON.stringify({data: remote, fingerprint: core.fingerprint(remote)}) : '{"error":"Unexpected fixture write"}');
    });
    const windowsUrl = await listen(windows);
    runner = startBusinessSync({config: {url: windowsUrl, username: 'synthetic', password: 'synthetic'}, db: bridgeDb, autoStart: false,
      call: async (route, data) => {
        const result = await request(app.base, route, {headers: auth, data});
        results.push({status: result.status, ok: result.data.ok, conflicts: result.data.conflicts, bytes: result.bytes,
          requestBytes: Buffer.byteLength(JSON.stringify(data))});
        assert.equal(result.status, 200);
        return result.data;
      }});
    await runner.sync();
    assert.equal(results[0].status, 200); assert.equal(results[0].ok, false); assert.equal(results[0].conflicts, 1);
    assert.match(runner().error, /未写入/);
    assert.equal(bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value, baseline);
    assert.equal(localWrites, 0); assert.equal(core.fingerprint(remote), remoteSha);
    const blocked = readState(dir);
    for (const key of ['snapshotSha', 'imagesSha', 'inventorySha', 'localMetadataSha', 'ledgerSha', 'usersSha', 'ordersSha', 'backupCount']) assert.equal(blocked[key], before[key], key);

    const login = await request(app.base, '/api/login', {data: {username: 'admin', password}});
    assert.equal(login.status, 200);
    const admin = {Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': login.data.csrf};
    const status = await request(app.base, '/api/platform/business-sync', {headers: admin});
    assert.equal(status.status, 200); assert.equal(status.data.conflicts.length, 1);
    const choices = status.data.conflicts.map(conflict => ({id: conflict.id, signature: conflict.signature, side: 'windows'}));
    assert.equal((await request(app.base, '/api/platform/business-sync', {headers: admin, data: {choices}})).status, 200);
    await runner.sync();
    assert.equal(results[1].ok, true); assert.ok(results[1].bytes > 21 * MiB);
    assert.equal(runner().uploaded, 1); assert.equal(runner().error, '');
    assert.equal(core.fingerprint(JSON.parse(bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value)), remoteSha);
    assert.equal(localWrites, 0);
    const succeeded = readState(dir);
    assert.equal(succeeded.name, remote.products['1'].name); assert.equal(succeeded.businessSha, remoteSha);
    assert.equal(succeeded.backupCount, before.backupCount + 1); assert.ok(succeeded.receipt && succeeded.lastSuccess);
    for (const key of ['imagesSha', 'inventorySha', 'localMetadataSha', 'ledgerSha', 'usersSha', 'ordersSha']) assert.equal(succeeded[key], before[key], key);

    const retry = await request(app.base, '/api/collector/business-sync', {headers: auth, body: exchangeBody});
    assert.equal(retry.status, 200); assert.equal(retry.data.ok, true); assert.ok(retry.bytes > 21 * MiB);
    assert.equal(core.fingerprint(retry.data.data), remoteSha);
    const retried = readState(dir);
    assert.equal(retried.snapshotSha, succeeded.snapshotSha); assert.equal(retried.backupCount, succeeded.backupCount);
    assert.deepEqual(retried.receipt, succeeded.receipt);
    await runner.sync();
    assert.equal(results.at(-1).status, 200); assert.equal(runner().uploaded, 1); assert.equal(runner().error, '');

    // The next normal synchronization carries the established 21 MiB baseline
    // plus a 21 MiB Windows snapshot, not just the small initial baseline.
    const establishedBaseline = bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value;
    remote.products['2'].name = 'Synthetic Windows product 2';
    const updatedRemoteSha = core.fingerprint(remote);
    await Promise.all([runner.sync(), app.concurrentHealth?.()]);
    const subsequent = results.at(-1);
    assert.equal(subsequent.ok, true); assert.ok(subsequent.requestBytes > 42 * MiB && subsequent.requestBytes < 42.2 * MiB);
    assert.ok(subsequent.bytes > 21 * MiB); assert.equal(runner().uploaded, 2); assert.equal(runner().error, '');
    assert.equal(core.fingerprint(JSON.parse(bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value)), updatedRemoteSha);
    assert.equal(localWrites, 0);
    const subsequentState = readState(dir);
    assert.equal(subsequentState.businessSha, updatedRemoteSha); assert.equal(subsequentState.backupCount, succeeded.backupCount + 1);
    for (const key of ['imagesSha', 'inventorySha', 'localMetadataSha', 'ledgerSha', 'usersSha', 'ordersSha']) assert.equal(subsequentState[key], before[key], key);
    const subsequentRetry = await request(app.base, '/api/collector/business-sync', {headers: auth,
      data: {clientId, base: JSON.parse(establishedBaseline), remote}});
    assert.equal(subsequentRetry.status, 200); assert.equal(subsequentRetry.data.ok, true);
    assert.equal(core.fingerprint(subsequentRetry.data.data), updatedRemoteSha);
    const finalState = readState(dir);
    assert.equal(finalState.snapshotSha, subsequentState.snapshotSha); assert.equal(finalState.backupCount, subsequentState.backupCount);
    assert.deepEqual(finalState.receipt, subsequentState.receipt);
    assert.equal((await fetch(app.base + '/api/health')).status, 200);
    if (app.id) {
      // Wait for at least one production-style healthcheck, counted inside the
      // same cgroup, before claiming the 512 MiB resource regression passed.
      for (let i = 0; i < 150 && app.state().health !== 'healthy'; i++) await delay(100);
      const after = app.state();
      assert.equal(after.health, 'healthy'); assert.equal(after.running, true); assert.equal(after.oom, false); assert.equal(after.restarts, 0);
      assert.equal(after.pid, initialContainer.pid); assert.equal(after.started, initialContainer.started);
      const finalProcessInfo = app.processes();
      assert.deepEqual(finalProcessInfo.pids, initialProcesses, JSON.stringify(finalProcessInfo.roles));
      const peak = app.peak(); assert.ok(peak > 0 && peak <= 512);
      t.diagnostic(JSON.stringify({mode: 'linux-cgroup', cloudSnapshotBytes: Buffer.byteLength(sourceText), requestBytes: Buffer.byteLength(exchangeBody),
        responseBytes: results[1].bytes, subsequentRequestBytes: subsequent.requestBytes, subsequentResponseBytes: subsequent.bytes,
        cgroupPeakMiB: Number(peak.toFixed(1)), memoryMiB: 512, memoryAndSwapMiB: 512, restarts: after.restarts, oomKilled: after.oom, health: after.health}));
    } else {
      app.rss.sample();
      assert.equal(app.child.exitCode, null); assert.equal(app.child.signalCode, null);
      t.diagnostic(JSON.stringify({mode: 'local-rss-not-cgroup-proof', cloudSnapshotBytes: Buffer.byteLength(sourceText), requestBytes: Buffer.byteLength(exchangeBody),
        responseBytes: results[1].bytes, subsequentRequestBytes: subsequent.requestBytes, subsequentResponseBytes: subsequent.bytes,
        rssBeforeMiB: Number(beforeRss.currentMiB.toFixed(1)), rssAfterMiB: Number(app.rss.read().currentMiB.toFixed(1)),
        rssPeakMiB: Number(app.rss.read().peakMiB.toFixed(1)), exitCode: app.child.exitCode, exitSignal: app.child.signalCode}));
    }
    assert.ok(!/子服务退出|heap out of memory|FATAL ERROR/i.test(app.logs()), 'Unexpected child exit or V8 failure');
  } catch (error) {
    if (app) {
      t.diagnostic(app.logs());
      if (app.id) {
        const state = app.state();
        t.diagnostic(JSON.stringify(state));
        if (state.running) t.diagnostic(JSON.stringify({processRoles: app.processes().roles}));
      }
    }
    throw error;
  } finally {
    runner?.close();
    if (windows) {windows.closeAllConnections(); await new Promise(resolve => windows.close(resolve));}
    bridgeDb.close();
    await app?.stop();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('real large keep-both sync survives lost response, collector restart and Windows CAS without duplicating images', {timeout: 180000}, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'printlink-large-both-http-'));
  const {source, remote, baseline} = fixture();
  remote.records['split-record'] = {_id: 'split-record', date: '2026-10-19', productId: 1, productName: remote.products['1'].name};
  remote.days['2026-10-19'] = {off: false};
  writeFileSync(path.join(dir, 'production-source.json'), JSON.stringify(source), {mode: 0o644});
  const bridgeDb = new DatabaseSync(path.join(dir, 'collector.sqlite'));
  bridgeDb.exec('CREATE TABLE business_sync_base(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE business_sync_client(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
  bridgeDb.prepare('INSERT INTO business_sync_base VALUES(1,?)').run(baseline);
  bridgeDb.prepare('INSERT INTO business_sync_client VALUES(1,?)').run(clientId);
  // Use the real installed Windows adapter, including its disk verification and
  // compare-and-swap check, with an isolated synthetic business file.
  for (const [source, target] of [['../legacy/business-sync-adapter.cjs', 'adapter.cjs'],
    ['../shared/business-sync.cjs', 'business-sync-core.cjs'], ['../shared/json-stream.cjs', 'json-stream.cjs']]) {
    copyFileSync(new URL(source, import.meta.url), path.join(dir, target));
  }
  const adapter = createRequire(import.meta.url)(path.join(dir, 'adapter.cjs'));
  const windowsFile = path.join(dir, 'windows.json');
  let windowsData = core.apply(empty(), remote), localWrites = 0, loseResponse = false;
  writeFileSync(windowsFile, JSON.stringify(windowsData));
  const initialWindowsSha = sha(readFileSync(windowsFile));
  const localAuth = 'Basic ' + Buffer.from('synthetic:synthetic').toString('base64');
  const windows = http.createServer((req, res) => {
    if (req.headers.authorization !== localAuth) {res.writeHead(401); res.end('{}'); return;}
    adapter(req, res, {enabled: true, load: () => windowsData,
      readDisk: () => JSON.parse(readFileSync(windowsFile, 'utf8')),
      save: next => {localWrites++; windowsData = next; writeFileSync(windowsFile, JSON.stringify(next));}});
  });
  let app, runner;
  const results = [];
  let clientPeakRss = 0, clientPeakHeap = 0;
  const sampleClient = () => {const memory = process.memoryUsage(); clientPeakRss = Math.max(clientPeakRss, memory.rss); clientPeakHeap = Math.max(clientPeakHeap, memory.heapUsed);};
  const clientTimer = setInterval(sampleClient, 30);
  sampleClient();
  try {
    app = await launch(dir);
    await waitForCloud(app);
    const auth = {Authorization: 'Bearer ' + token};
    let probe;
    const deadline = Date.now() + 15000;
    do {
      probe = await request(app.base, '/api/collector/business-sync', {headers: auth,
        data: {clientId, probe: true, baseHash: 'not-equal', remoteHash: 'not-equal'}, timeoutMs: Math.max(1, deadline - Date.now())});
      if (probe.status !== 502 || Date.now() >= deadline) break;
      await delay(Math.min(100, deadline - Date.now()));
    } while (Date.now() < deadline);
    assert.equal(probe?.status, 200, app.logs()); assert.equal(probe.data.unchanged, false);
    const before = readState(dir), initialContainer = app.id ? app.state() : null;
    const initialProcesses = app.id ? app.processes().pids : null;
    if (app.id) {assert.equal(initialProcesses.length, 3); assert.equal(initialContainer.memory, 512 * MiB); assert.equal(initialContainer.swap, 512 * MiB);}
    const windowsUrl = await listen(windows);
    const makeRunner = () => startBusinessSync({config: {url: windowsUrl, username: 'synthetic', password: 'synthetic'}, db: bridgeDb, autoStart: false,
      call: async (route, data) => {
        const result = await request(app.base, route, {headers: auth, data});
        results.push({status: result.status, ok: result.data.ok, requestBytes: Buffer.byteLength(JSON.stringify(data)), responseBytes: result.bytes});
        assert.equal(result.status, 200);
        sampleClient();
        if (loseResponse && !data.probe) {loseResponse = false; throw Error('synthetic response lost after cloud commit');}
        return result.data;
      }});
    runner = makeRunner();
    await runner.sync();
    assert.match(runner().error, /未写入/); assert.equal(localWrites, 0);
    assert.equal(bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value, baseline);
    const blocked = readState(dir);
    for (const key of ['snapshotSha', 'imagesSha', 'inventorySha', 'localMetadataSha', 'ledgerSha', 'usersSha', 'ordersSha', 'backupCount']) assert.equal(blocked[key], before[key], key);
    const login = await request(app.base, '/api/login', {data: {username: 'admin', password}});
    assert.equal(login.status, 200);
    const admin = {Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': login.data.csrf};
    const status = await request(app.base, '/api/platform/business-sync', {headers: admin});
    assert.equal(status.status, 200); assert.equal(status.data.conflicts.length, 1);
    assert.ok(core.canKeepBoth(status.data.conflicts[0]));
    const choices = status.data.conflicts.map(({id, signature}) => ({id, signature, side: 'both'}));
    assert.equal((await request(app.base, '/api/platform/business-sync', {headers: admin, data: {choices}})).status, 200);
    loseResponse = true;
    await Promise.all([runner.sync(), app.concurrentHealth?.()]);
    assert.match(runner().error, /response lost/); assert.equal(localWrites, 0);
    assert.equal(sha(readFileSync(windowsFile)), initialWindowsSha);
    assert.equal(bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value, baseline);
    const committed = readState(dir);
    assert.equal(committed.backupCount, before.backupCount + 1); assert.ok(committed.receipt && committed.lastSuccess);
    runner.close(); runner = makeRunner();
    await runner.sync();
    assert.equal(runner().error, ''); assert.equal(runner().uploaded, 1); assert.equal(localWrites, 1);
    assert.equal(windowsData.products.length, 43);
    assert.equal(windowsData.products.find(row => row.id === 1).name, source.products[0].name);
    assert.equal(windowsData.products.find(row => row.id === 43).name, remote.products['1'].name);
    assert.equal(windowsData.products.find(row => row.id === 43).image, remote.products['1'].image);
    for (const product of source.products) assert.equal(windowsData.products.find(row => row.id === product.id).image, product.image);
    assert.equal(windowsData.records['2026-10-19'].items[0].productId, 43);
    const common = core.project(windowsData);
    assert.equal(core.fingerprint(common), core.fingerprint(JSON.parse(bridgeDb.prepare('SELECT value FROM business_sync_base WHERE id=1').get().value)));
    const retried = readState(dir);
    assert.equal(retried.snapshotSha, committed.snapshotSha); assert.equal(retried.backupCount, committed.backupCount);
    assert.deepEqual(retried.receipt, committed.receipt); assert.equal(retried.businessSha, core.fingerprint(common));
    for (const key of ['inventorySha', 'localMetadataSha', 'ledgerSha', 'usersSha', 'ordersSha']) assert.equal(retried[key], before[key], key);
    const staleCas = await fetch(windowsUrl + '/api/business-sync', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: localAuth},
      body: JSON.stringify({expected: core.fingerprint(remote), data: common})});
    assert.equal(staleCas.status, 409); assert.equal(localWrites, 1);
    windowsData.products.find(row => row.id === 2).name = 'Synthetic Windows edit after keep-both';
    writeFileSync(windowsFile, JSON.stringify(windowsData));
    await Promise.all([runner.sync(), app.concurrentHealth?.()]);
    assert.equal(runner().error, ''); assert.equal(localWrites, 1);
    const subsequent = results.at(-1);
    assert.ok(subsequent.requestBytes > 43 * MiB && subsequent.requestBytes < 43.2 * MiB);
    assert.ok(subsequent.responseBytes > 21.5 * MiB);
    const after = readState(dir);
    assert.equal(after.businessSha, core.fingerprint(core.project(windowsData)));
    assert.equal(after.backupCount, committed.backupCount + 1);
    await runner.sync();
    assert.equal(runner().error, ''); assert.equal(localWrites, 1);
    assert.equal(windowsData.products.length, 43); assert.equal(readState(dir).backupCount, after.backupCount);
    for (const key of ['inventorySha', 'localMetadataSha', 'ledgerSha', 'usersSha', 'ordersSha']) assert.equal(after[key], before[key], key);
    sampleClient(); app.rss?.sample();
    const diagnostic = {mode: app.id ? 'linux-cgroup' : 'local-rss-not-cgroup-proof', scenario: 'keep-both-lost-response-cas',
      requestBytes: results.map(row => row.requestBytes), responseBytes: results.map(row => row.responseBytes),
      clientOutsideAppCgroup: true,
      clientPeakRssMiB: Number((clientPeakRss / MiB).toFixed(1)), clientPeakHeapMiB: Number((clientPeakHeap / MiB).toFixed(1)),
      appRss: app.rss?.read()};
    if (app.id) {
      for (let i = 0; i < 150 && app.state().health !== 'healthy'; i++) await delay(100);
      const state = app.state();
      assert.equal(state.health, 'healthy'); assert.equal(state.running, true); assert.equal(state.oom, false); assert.equal(state.restarts, 0);
      assert.equal(state.pid, initialContainer.pid); assert.equal(state.started, initialContainer.started);
      assert.deepEqual(app.processes().pids, initialProcesses);
      diagnostic.cgroupPeakMiB = app.peak(); assert.ok(diagnostic.cgroupPeakMiB > 0 && diagnostic.cgroupPeakMiB <= 512);
    } else {assert.equal(app.child.exitCode, null); assert.equal(app.child.signalCode, null);}
    assert.ok(!/子服务退出|heap out of memory|FATAL ERROR/i.test(app.logs()));
    t.diagnostic(JSON.stringify(diagnostic));
  } catch (error) {
    if (app) {
      t.diagnostic(app.logs());
      t.diagnostic(JSON.stringify({mode: app.id ? 'linux-cgroup' : 'local-rss-not-cgroup-proof',
        scenario: 'keep-both-lost-response-cas', appRss: app.rss?.read(), clientOutsideAppCgroup: true,
        clientPeakRssMiB: clientPeakRss / MiB, clientPeakHeapMiB: clientPeakHeap / MiB}));
      if (app.id) {
        const state = app.state(); t.diagnostic(JSON.stringify(state));
        if (state.running) t.diagnostic(JSON.stringify({processRoles: app.processes().roles, cgroupPeakMiB: app.peak()}));
      }
    }
    throw error;
  }
  finally {
    clearInterval(clientTimer); runner?.close();
    windows.closeAllConnections(); await new Promise(resolve => windows.close(resolve));
    bridgeDb.close(); await app?.stop(); rmSync(dir, {recursive: true, force: true});
  }
});
