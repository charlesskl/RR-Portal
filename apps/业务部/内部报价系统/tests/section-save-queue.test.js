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

test('报价和核价入口一致加载带版本的共享工作台与供应商同步依赖', () => {
  const entries = ['quote.html', 'verification.html'].map(page => {
    const html = fs.readFileSync(path.join(root, 'frontend', page), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1]);
    const workbench = scripts.find(value => /^\.\/workbench\.js\?v=/.test(value));
    assert.match(workbench || '', /^\.\/workbench\.js\?v=\d{8}-[A-Za-z0-9-]+$/);
    const sync = scripts.findIndex(value => /^\.\/supplier-material-sync\.js\?v=/.test(value));
    assert.ok(sync >= 0 && sync < scripts.indexOf(workbench), '供应商同步依赖在工作台之前加载');
    return workbench;
  });
  assert.equal(entries[0], entries[1], '报价和核价复用同一工作台版本');
});


test('PostgreSQL 保存版本保留微秒，JSON 往返不会造成虚假冲突', () => {
  const source = fs.readFileSync(path.join(root, 'backend', 'db', 'postgres.js'), 'utf8');
  const registrations = source.slice(source.indexOf('types.setTypeParser'), source.indexOf('if (!process.env.DATABASE_URL)'));
  const parsers = new Map();
  vm.runInNewContext(registrations, { types: { setTypeParser: (oid, parser) => parsers.set(oid, parser) } });
  const parse = parsers.get(1184);
  assert.equal(typeof parse, 'function');
  const stored = '2026-10-05 12:28:47.757123+00';
  const read = parse(stored);
  const request = JSON.parse(JSON.stringify({ base_filled_at: read }));
  assert.equal(request.base_filled_at, stored);
  assert.notEqual(parse('2026-10-05 12:28:47.757124+00'), read, '同毫秒内的新版本仍须检测为冲突');
  assert.equal(Date.parse(read), Date.parse('2026-10-05T12:28:47.757Z'), '仍兼容现有时间显示及递增逻辑');
  assert.equal(parse('2026-10-05 12:28:47+00'), '2026-10-05 12:28:47+00');
});
