const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('同一部门的并发保存串行执行并携带最新版本', async () => {
  const source = fs.readFileSync(path.join(root, 'frontend', 'workbench.js'), 'utf8');
  const start = source.indexOf('const sectionSaveQueues');
  const end = source.indexOf('// ====================', start);
  assert.ok(start > 0 && end > start, '应能找到保存队列实现');

  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const requests = [];
  const context = {
    Promise,
    Map,
    alert() {},
    api: async (_url, options) => {
      const body = JSON.parse(options.body);
      const callNo = requests.push(body);
      if (callNo === 1) await firstGate;
      return { filled_at: `version-${callNo}` };
    },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.putSection = putSection;`, context);

  const section = { id: 7, filled_at: 'version-0' };
  const first = context.putSection(section, { rows: [1] }, false);
  const second = context.putSection(section, { rows: [1, 2] }, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1, '第一次未完成前不应发出第二次保存');
  assert.equal(requests[0].base_filled_at, 'version-0');

  releaseFirst();
  await first;
  await second;
  assert.equal(requests.length, 2);
  assert.equal(requests[1].base_filled_at, 'version-1', '后续保存应使用前一次成功后的新版本');
});

test('PostgreSQL 和 SQLite 使用兼容的空时间版本比较', () => {
  const route = fs.readFileSync(path.join(root, 'backend', 'routes', 'sections.js'), 'utf8');
  assert.match(route, /filled_at IS NOT DISTINCT FROM \?/);
  assert.doesNotMatch(route, /COALESCE\(filled_at, ''\)/);
});
