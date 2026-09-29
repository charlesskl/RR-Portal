const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const MixedMolds = require('../frontend/mixed-molds');
const { calculateMixedQuote } = require('../backend/services/mixedQuotation');

function setup() {
  const cfg = { enabled: true, mode: 'equal', units_per_pack: 1, products: [
    { id: 'a', code: 'A', name: 'A', ratio: 1 }, { id: 'b', code: 'B', name: 'B', ratio: 1 },
  ] };
  const molding = { mixed_products: { a: { injection: [{ shot_price: .2 }] }, b: {} }, mixed_shared: {}, mixed_molds: [
    { mold_no: 'AB', machine_price: 1200, target: 3000, parts: [
      { product_id: 'a', name: 'A主体', cavity: 2, usage: 1 }, { product_id: 'b', name: 'B主体', cavity: 4, usage: 1 },
    ] },
  ] };
  const sections = [{ dept: 'sales', payload_json: JSON.stringify({ mixed_quote: cfg }) },
    { dept: 'molding', payload_json: JSON.stringify(molding) }];
  const element = () => ({ innerHTML: '', textContent: '', children: [], nodes: {},
    appendChild(node) { this.children.push(node); }, append(...nodes) { this.children.push(...nodes); }, setAttribute(key,value) { this[key]=value; }, prepend(node) { this.children.unshift(node); },
    querySelector(selector) { return this.nodes[selector] ||= element(); },
  });
  const window = { MixedMolds, __data: { quote: { id: 3, qty: 2000 }, mixed_quote: cfg, sections } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/mixed-quotation.js'), 'utf8'), {
    window, document: { createElement: element }, sessionStorage: { getItem() { return 'a'; }, setItem() {} },
  });
  return { api: window.MixedQuotation, element, molding, sections };
}

test('小产品页分摊与后端报价一致，切换和重复渲染不写入注塑行、不重复收费', () => {
  const { api, element, molding, sections } = setup();
  const before = JSON.stringify(molding), host = element(), rendered = [];
  api.wrap((box, payload) => {
    rendered.push({ payload, result: api.renderMoldingAllocation(box, payload), html: box.innerHTML });
  }, 'molding')(host, molding, false, () => {});
  assert.match(rendered[0].html, /A主体/);
  assert.doesNotMatch(rendered[0].html, /B主体/);
  assert.match(rendered[0].html, /0\.1333/);
  const backend = calculateMixedQuote({ qty: 2000 }, sections);
  assert.equal(rendered[0].result.amount, backend.products[0].shared_labor);
  assert.ok(Math.abs(backend.products[0].components.injection_labor - (.2 + rendered[0].result.amount)) < 1e-10);
  host.querySelector('select').onchange({ target: { value: 'b' } });
  assert.match(rendered[1].html, /B主体/);
  assert.match(rendered[1].html, /0\.0667/);
  host.querySelector('select').onchange({ target: { value: 'a' } });
  assert.equal(rendered[2].result.amount, rendered[0].result.amount);
  assert.equal(JSON.stringify(molding), before);
  molding.mixed_molds[0].target = '';
  const invalid = api.renderMoldingAllocation(element(), rendered[0].payload);
  assert.match(invalid.error, /日啤次/);
});

test('工程模具页同步同一模号及两款出模数，保留独立模具数据，缺少价格仍能显示结构', () => {
  const { api, element, molding, sections } = setup();
  const root = { mixed_products: { a: { molds: [{ name: '独立模具' }] }, b: {} }, mixed_shared: {} };
  const before = JSON.stringify(root), host = element(), rendered = [];
  const section = sections.find(s => s.dept === 'molding');
  molding.mixed_molds[0].target = '';
  section.payload_json = JSON.stringify(molding);
  api.wrap((box, payload) => { api.renderEngineeringSharedMolds(box, payload); rendered.push(box.innerHTML); }, 'engineering')(host, root, false, () => {});
  assert.match(rendered[0], /AB/);
  assert.match(rendered[0], /A主体：2 出/);
  assert.match(rendered[0], /B主体：4 出/);
  molding.mixed_molds[0].parts[1].cavity = 6;
  section.payload_json = JSON.stringify(molding);
  host.querySelector('select').onchange({ target: { value: 'b' } });
  assert.match(rendered[1], /B主体：6 出/);
  assert.equal(JSON.stringify(root), before);
  host.querySelector('select').onchange({ target: { value: '__shared__' } });
  assert.equal(rendered[2], '');
});
