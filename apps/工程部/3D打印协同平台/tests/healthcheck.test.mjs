import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {checkHealth} from '../ops/healthcheck.mjs';

async function listen(server, t) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return {port: server.address().port, sockets};
}

test('healthy response succeeds and closes its socket without retaining the body', async t => {
  let requested;
  const server = http.createServer((req, res) => { requested = req.url; res.writeHead(200); res.write('healthy'); });
  const {port, sockets} = await listen(server, t);
  assert.equal(await checkHealth({port, timeoutMs: 200}), true);
  assert.equal(requested, '/api/health');
  for (let i = 0; i < 20 && sockets.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sockets.size, 0);
});

test('a non-2xx response and connection error fail', async t => {
  const server = http.createServer((req, res) => { res.writeHead(503); res.end(); });
  const {port} = await listen(server, t);
  assert.equal(await checkHealth({port, timeoutMs: 200}), false);
  const closed = net.createServer();
  closed.listen(0, '127.0.0.1'); await once(closed, 'listening');
  const unused = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  assert.equal(await checkHealth({port: unused, timeoutMs: 200}), false);
});

test('a listener that never replies hits its own deadline and closes the connection', async t => {
  const {port, sockets} = await listen(net.createServer(socket => socket.resume()), t);
  const start = performance.now();
  assert.equal(await checkHealth({port, timeoutMs: 100}), false);
  assert.ok(performance.now() - start < 1000);
  for (let i = 0; i < 20 && sockets.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sockets.size, 0);
});

test('direct executable exits by itself on an unresponsive listener', async t => {
  const {port} = await listen(net.createServer(socket => socket.resume()), t);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../ops/healthcheck.mjs', import.meta.url))],
    {env: {...process.env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const start = performance.now();
  const result = await Promise.race([once(child, 'exit'), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error('healthcheck did not exit')), 4000); timer.unref();
  })]);
  assert.deepEqual(result, [1, null]);
  assert.ok(performance.now() - start < 3500);
  assert.equal(output, '');
});

test('invalid healthcheck bounds fail without an HTTP request', async () => {
  assert.equal(await checkHealth({port: 0}), false);
  assert.equal(await checkHealth({timeoutMs: 2001}), false);
});
