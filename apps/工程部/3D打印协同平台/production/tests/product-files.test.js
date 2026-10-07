const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createProductFileHandler } = require('../product-files');

// 使用临时目录与随机端口，避免加载真实服务器、业务数据或打印机配置。
async function fixture(t, options = {}) {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'product-files-test-'));
  const products = [{ id: 1 }, { id: 2 }];
  const events = new EventEmitter();
  const errors = [];
  let handler = createProductFileHandler({ storageDir, getProducts: () => products, ...options });
  const server = http.createServer(async (req, res) => {
    try {
      if (!await handler(req, res)) {
        res.writeHead(404);
        res.end('unhandled');
      }
    } catch (error) {
      errors.push(error);
      res.destroy(error);
    } finally {
      events.emit('handled');
    }
  });
  t.after(async () => {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await fs.rm(storageDir, { recursive: true, force: true });
    assert.deepEqual(errors, [], '文件处理器不应抛出未处理错误');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  async function request(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, method, path: url, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          const json = String(res.headers['content-type']).includes('application/json')
            ? JSON.parse(data.toString('utf8')) : null;
          resolve({ status: res.statusCode, headers: res.headers, data, json });
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('测试请求超时')));
      if (typeof body === 'function') {
        Promise.resolve(body(req)).catch(error => { req.destroy(error); reject(error); });
      } else if (Array.isArray(body)) {
        for (const chunk of body) req.write(chunk);
        req.end();
      } else {
        req.end(body);
      }
    });
  }
  const upload = (productId, name, body) => request('POST',
    `/api/products/${productId}/files?name=${encodeURIComponent(name)}`, body,
    { 'Content-Type': 'application/octet-stream' });
  const fileUrl = (productId, id) => `/api/products/${productId}/files/${id}`;
  return {
    storageDir, server, events, port, products, request, upload, fileUrl,
    clearProductFiles(productId) { handler.removeProductFiles(productId); },
    restart() {
      handler = createProductFileHandler({ storageDir, getProducts: () => products, ...options });
    }
  };
}

test('二进制文件及中文文件名可完整下载，重建处理器后仍可用', async t => {
  const f = await fixture(t);
  const original = Buffer.from([0, 255, 128, 13, 10, 26, 42, 0, 1]);
  const name = '底板 模型（第二版）.STL';
  const upload = await f.upload(1, name, original);
  assert.equal(upload.status, 201);
  assert.equal(upload.json.ok, true);
  const file = upload.json.file;
  assert.ok(file.id);
  assert.equal(String(file.productId), '1');
  assert.equal(file.name, name);
  assert.equal(file.size, original.length);
  assert.ok(Number.isFinite(new Date(file.uploadedAt).getTime()));

  f.restart();
  const list = await f.request('GET', '/api/products/files');
  assert.equal(list.status, 200);
  assert.equal(list.json.ok, true);
  assert.deepEqual(list.json.files, [file]);
  assert.ok(list.json.maxFileSize >= original.length);
  assert.ok(list.json.extensions.includes('.stl'));
  assert.ok(list.json.extensions.includes('.3mf'));

  const download = await f.request('GET', f.fileUrl(1, file.id));
  assert.equal(download.status, 200);
  assert.deepEqual(download.data, original);
  assert.equal(Number(download.headers['content-length']), original.length);
  const disposition = download.headers['content-disposition'];
  assert.match(disposition, /^attachment;/);
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  assert.ok(encodedName, '中文文件名应通过 filename* 返回');
  assert.equal(decodeURIComponent(encodedName[1]), name);
});

test('并发上传同名文件不覆盖，产品之间隔离，删除只影响指定附件', async t => {
  const f = await fixture(t);
  const bodies = [Buffer.from('first'), Buffer.from('second'), Buffer.from('other product')];
  const uploads = await Promise.all([
    f.upload(1, 'model.3mf', bodies[0]),
    f.upload(1, 'model.3mf', bodies[1]),
    f.upload(2, 'model.3mf', bodies[2])
  ]);
  uploads.forEach(result => assert.equal(result.status, 201));
  const files = uploads.map(result => result.json.file);
  assert.equal(new Set(files.map(file => file.id)).size, 3);
  for (let i = 0; i < files.length; i++) {
    const download = await f.request('GET', f.fileUrl(files[i].productId, files[i].id));
    assert.equal(download.status, 200);
    assert.deepEqual(download.data, bodies[i]);
  }
  assert.equal((await f.request('GET', f.fileUrl(2, files[0].id))).status, 404);
  assert.equal((await f.request('DELETE', f.fileUrl(2, files[0].id))).status, 404);

  const removal = await f.request('DELETE', f.fileUrl(1, files[0].id));
  assert.equal(removal.status, 200);
  assert.equal(removal.json.ok, true);
  assert.equal((await f.request('GET', f.fileUrl(1, files[0].id))).status, 404);
  f.restart();
  const remaining = (await f.request('GET', '/api/products/files')).json.files;
  assert.deepEqual(new Set(remaining.map(file => file.id)), new Set(files.slice(1).map(file => file.id)));
  assert.deepEqual((await f.request('GET', f.fileUrl(1, files[1].id))).data, bodies[1]);
});

test('拒绝不支持的文件、空文件、未知产品和无效上传类型', async t => {
  const f = await fixture(t);
  assert.equal((await f.upload(1, 'script.html', Buffer.from('<script>'))).status, 400);
  assert.equal((await f.upload(1, 'empty.stl', Buffer.alloc(0))).status, 400);
  assert.equal((await f.upload(999, 'missing.stl', Buffer.from('model'))).status, 404);
  assert.equal((await f.request('POST', '/api/products/1/files?name=model.stl', 'model',
    { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('GET', f.fileUrl(1, '0'.repeat(32)))).status, 404);
  assert.deepEqual((await f.request('GET', '/api/products/files')).json.files, []);
});

test('文件大小限制同时适用于带长度和流式上传，达到限制的文件可保存', async t => {
  const f = await fixture(t, { maxFileSize: 16 });
  assert.equal((await f.request('GET', '/api/products/files')).json.maxFileSize, 16);
  const oversized = Buffer.alloc(17, 1);
  const fixed = await f.request('POST', '/api/products/1/files?name=fixed.stl', oversized, {
    'Content-Type': 'application/octet-stream', 'Content-Length': oversized.length
  });
  assert.equal(fixed.status, 413);
  const streamed = await f.request('POST', '/api/products/1/files?name=streamed.stl',
    [Buffer.alloc(8), Buffer.alloc(9)], {
      'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked'
    });
  assert.equal(streamed.status, 413);
  assert.deepEqual((await f.request('GET', '/api/products/files')).json.files, []);
  const exact = await f.upload(1, 'exact.stl', Buffer.alloc(16, 42));
  assert.equal(exact.status, 201);
  assert.deepEqual((await f.request('GET', f.fileUrl(1, exact.json.file.id))).data, Buffer.alloc(16, 42));
});

test('文件名和下载路径不能穿越存储目录或注入响应头', async t => {
  const f = await fixture(t);
  for (const name of ['../outside.stl', '..\\outside.stl', '/outside.stl', 'bad\r\nX-Injected: yes.stl', 'null\0.stl']) {
    const result = await f.upload(1, name, Buffer.from('model'));
    assert.equal(result.status, 400, `应拒绝文件名 ${JSON.stringify(name)}`);
  }
  for (const url of [
    '/api/products/1/files/%2e%2e%2foutside.stl',
    '/api/products/1/files/%2e%2e%5coutside.stl',
    '/api/products/%2e%2e%2f1/files?name=model.stl'
  ]) {
    const result = await f.request('GET', url);
    assert.ok(result.status >= 400 && result.status < 500);
  }
  assert.deepEqual((await f.request('GET', '/api/products/files')).json.files, []);
});

test('上传中断不会留下可见附件，之后仍能正常上传', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const incoming = once(f.server, 'request');
  const handled = once(f.events, 'handled');
  const req = http.request({
    hostname: '127.0.0.1', port: f.port, method: 'POST',
    path: '/api/products/1/files?name=partial.stl',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 100 }
  });
  req.on('error', () => {});
  req.write(Buffer.from('partial'));
  await incoming;
  req.destroy();
  await handled;
  assert.deepEqual(await fs.readdir(f.storageDir), [], '中断上传应清理临时文件');
  f.restart();
  assert.deepEqual((await f.request('GET', '/api/products/files')).json.files, []);
  assert.equal((await f.upload(1, 'complete.stl', Buffer.from('complete'))).status, 201);
});

test('删除并复用产品编号时清理旧附件，同时拒绝旧产品尚未完成的上传', async t => {
  const f = await fixture(t);
  const other = (await f.upload(2, 'other.stl', Buffer.from('other'))).json.file;
  const retainedEntries = (await fs.readdir(f.storageDir)).sort();
  const old = (await f.upload(1, 'old.stl', Buffer.from('old'))).json.file;
  const incoming = once(f.server, 'request');
  const interrupted = await f.request('POST', '/api/products/1/files?name=pending.stl', async req => {
    req.write('partial');
    await incoming;
    f.clearProductFiles(1);
    f.products.splice(0, 1, { id: 1 });
    req.end('end');
  }, { 'Content-Type': 'application/octet-stream', 'Content-Length': 10 });
  assert.equal(interrupted.status, 404);
  assert.equal((await f.request('GET', f.fileUrl(1, old.id))).status, 404);
  assert.deepEqual((await f.request('GET', '/api/products/files')).json.files, [other]);
  assert.deepEqual((await fs.readdir(f.storageDir)).sort(), retainedEntries, '旧附件与未完成文件应清理干净');
  assert.equal((await f.upload(1, 'new.stl', Buffer.from('new'))).status, 201);
});
