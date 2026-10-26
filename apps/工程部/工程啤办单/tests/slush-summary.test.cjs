const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the shipped page functions. No server, user data or browser storage is opened.
const html = fs.readFileSync(path.join(__dirname, '../public/slush.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const suffix = /\nloadOrders\(\);\nsetInterval\(loadOrders, 30000\);\s*$/;
assert.match(script, suffix);
const esc = fs.readFileSync(path.join(__dirname, '../public/utils.js'), 'utf8')
  .match(/function esc\(s\) \{[\s\S]*?\n\}/)[0];
function page() {
  const nodes = {};
  const context = vm.createContext({
    document: { getElementById: id => nodes[id] ||= { value: '', innerHTML: '', classList: { toggle() {} } } },
    window: { print() {} }, setTimeout: fn => fn(),
  });
  vm.runInContext(esc + '\n' + script.replace(suffix, ''), context);
  return { context, nodes, run: code => vm.runInContext(code, context) };
}

test('summary groups workshop names without inherited object properties or HTML execution', () => {
  const p = page();
  p.context.fixture = ['__proto__', 'constructor', 'toString', '<img src=x onerror=alert(1)>', ''].map((workshop, i) => ({
    id: i + 1, workshop, order_number: `P${i}`, status: '待生产',
    items: [{ mold_id: 'M1', mold_name: '<script>bad()</script>', quantity: '3' }],
  }));
  p.run('renderSummary(fixture)');
  const result = p.nodes.orderList.innerHTML;
  for (const label of ['__proto__', 'constructor', 'toString', '未分配']) assert.ok(result.includes(label));
  assert.ok(result.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(result.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!result.includes('<img') && !result.includes('<script>'));
  assert.equal((result.match(/<tbody>/g) || []).length, 5);
  assert.equal((result.match(/>3<\/td>/g) || []).length, 5);
});

test('list and summary share the combined workshop, status, month, product, document and client filters', () => {
  const p = page();
  p.context.fixture = [
    { id: 1, workshop: 'A车间', status: '待生产', date: '2026-10-01', order_number: 'AbC', doc_number: 'Doc-1', client_name: '客户一' },
    { id: 2, workshop: 'B车间', status: '待生产', date: '2026-10-01', order_number: 'AbC', doc_number: 'Doc-1', client_name: '客户一' },
    { id: 3, workshop: 'A车间', status: '已完成', date: '2026-09-01', order_number: 'AbC', doc_number: 'Doc-1', client_name: '客户一' },
    { id: 4, workshop: 'A车间', status: '待生产', date: '2026-10-01', order_number: 'XYZ', doc_number: 'Doc-2', client_name: '客户二' },
  ];
  p.context.collect = rows => { p.context.ids = rows.map(r => r.id); };
  p.run('allOrders = fixture; renderOrders = collect; renderSummary = collect; currentFilter = "待生产"; applyFilters()');
  Object.assign(p.nodes.workshopFilter, { value: 'A车间' });
  Object.assign(p.nodes.monthFilter, { value: '2026-10' });
  Object.assign(p.nodes.orderNoFilter, { value: ' abc ' });
  Object.assign(p.nodes.docNoFilter, { value: 'doc-1' });
  Object.assign(p.nodes.clientFilter, { value: '客户一' });
  p.run('applyFilters()'); assert.deepEqual(Array.from(p.context.ids), [1]);
  p.run('currentView = "summary"; applyFilters()'); assert.deepEqual(Array.from(p.context.ids), [1]);
  p.nodes.monthFilter.value = '2026-09';
  p.run('applyFilters()'); assert.deepEqual(Array.from(p.context.ids), []);
  p.run('clearMonthFilter()'); assert.equal(p.nodes.monthFilter.value, ''); assert.deepEqual(Array.from(p.context.ids), [1]);
});

test('empty result has the same safe placeholder in the summary', () => {
  const p = page(); p.run('renderSummary([])'); assert.ok(p.nodes.orderList.innerHTML.includes('暂无搪胶任务'));
});
