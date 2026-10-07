const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('let productFiles = null');
const end = html.indexOf('let editingProdId=-1;', start);
assert.ok(start >= 0 && end > start, 'The product file UI functions must be present');
const source = html.slice(start, end);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const response = files => ({ ok: true, json: async () => ({ ok: true, files }) });
const file = {
  id: '0123456789abcdef0123456789abcdef', productId: '1',
  name: '模型.stl', size: 123, uploadedAt: '2026-09-08T00:00:00.000Z'
};

// 执行真实前端流程，仅模拟状态提示和忙碌按钮所需的 DOM。
function fixture(fetch) {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    fetch, AbortController, console,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    confirm: () => true,
    window: { addEventListener() {} },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { style: {} });
        return elements.get(id);
      },
      querySelectorAll: () => []
    }
  });
  vm.runInContext(source, context);
  vm.runInContext('productFilesProductId="1"; updateProductFileViews=()=>{};', context);
  context.uploadOneProductFile = async () => ({ ...file });
  return {
    context, elements, timers,
    read(expression) { return vm.runInContext(expression, context); },
    setFiles(files) { context.initialFiles = files; vm.runInContext('productFiles=initialFiles', context); }
  };
}

test('上传后的强制刷新会重新请求，旧列表不能覆盖刚保存的文件', async () => {
  const oldList = deferred();
  let calls = 0;
  const ui = fixture(() => ++calls === 1 ? oldList.promise : Promise.resolve(response([file])));
  const initialLoad = ui.context.refreshProductFiles(true);
  const upload = ui.context.uploadProductFiles([{ name: file.name, size: file.size }]);
  await new Promise(setImmediate);
  assert.equal(ui.read('productFiles.length'), 1);
  oldList.resolve(response([]));
  await Promise.all([initialLoad, upload]);
  assert.equal(calls, 2, 'After saving, refresh must issue a new request');
  assert.equal(ui.read('productFiles[0].id'), file.id);
  assert.equal(ui.read('productFilesBusy'), false);
  assert.match(ui.elements.get('productFilesStatus').textContent, /已上传 1 个文件/);
});

test('删除后的强制刷新不会保留删除前正在加载的旧条目', async () => {
  const oldList = deferred();
  let listCalls = 0;
  const ui = fixture((url, options) => {
    if (options.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return ++listCalls === 1 ? oldList.promise : Promise.resolve(response([]));
  });
  ui.setFiles([{ ...file }]);
  const initialLoad = ui.context.refreshProductFiles(true);
  const deletion = ui.context.deleteProductFile(file.id);
  await new Promise(setImmediate);
  assert.equal(ui.read('productFiles.length'), 0);
  oldList.resolve(response([file]));
  await Promise.all([initialLoad, deletion]);
  assert.equal(listCalls, 2);
  assert.equal(ui.read('productFiles.length'), 0);
  assert.equal(ui.read('productFilesBusy'), false);
  assert.equal(ui.elements.get('productFilesStatus').textContent, '文件已删除');
});

test('上传成功后的列表刷新超时会释放忙碌状态，允许关闭和重试', async () => {
  const ui = fixture((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('The request was aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }));
  const upload = ui.context.uploadProductFiles([{ name: file.name, size: file.size }]);
  await new Promise(setImmediate);
  assert.equal(ui.read('productFilesBusy'), true);
  assert.equal(ui.timers.size, 1, 'The pending list request must have a deadline');
  for (const callback of ui.timers.values()) callback();
  await upload;
  assert.equal(ui.read('productFilesBusy'), false);
  assert.equal(ui.read('productFilesRequest'), null);
  assert.equal(ui.read('productFilesError'), '文件列表加载超时');
  assert.equal(ui.read('productFiles[0].id'), file.id, 'A refresh timeout must not erase the saved file');
  assert.equal(ui.elements.get('productFilesClose').disabled, false);
  assert.equal(ui.elements.get('productFilesUpload').disabled, false);
  assert.equal(ui.elements.get('productFilesRefresh').disabled, false);
  assert.equal(ui.timers.size, 0);
});
