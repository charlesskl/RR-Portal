'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Run the production declarations with an in-memory provider; never start the
// server, read AI credentials, open a database or make a model request.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const block = source.slice(source.indexOf('const OCR_READ_PROMPT ='), source.indexOf('/* ── 记录表列顺序'));
const plain = value => JSON.parse(JSON.stringify(value));
function runtime(responses = []) {
  const calls = [];
  const context = vm.createContext({
    AI: { ready: true, ocrModel: 'fixture-model', baseURL: 'https://fixture.invalid/v1', apiKey: 'fixture' },
    console: { warn() {} }, setTimeout: callback => callback(),
    fetch: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      const response = responses.shift();
      assert.ok(response, 'Unexpected provider attempt');
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: response } }] }) };
    },
  });
  vm.runInContext(block + ';globalThis.actual = { parseDeliveryNote, aiVisionExtract };', context);
  return { parse: text => plain(context.actual.parseDeliveryNote(text)), extract: () => context.actual.aiVisionExtract('data:image/png;base64,fixture'), calls };
}
const parse = text => runtime().parse(text);
const item = (productNo, productName, qty, unit = '个') => ({ productNo, productName, qty, unit });
const table = rows => '| 货号 | 品名 | 数量 | 单位 |\n| --- | --- | --- | --- |\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n');
const goodRow = ['P-001', '塑胶零件', '1000', '个'];

test('packaging materials remain goods, with and without product numbers', () => {
  const rows = [goodRow, ['P-002', '胶袋', '1000', '个'], ['P-003', '纸箱', '100', '箱'], ['P-004', '吸塑托盘', '500', '个']];
  assert.deepEqual(parse(table(rows)).items, rows.map(row => item(...row)));
  assert.deepEqual(parse('| 品名 | 数量 | 单位 |\n| 胶袋 | 1000 | 个 |').items, [item('', '胶袋', '1000')]);
});
test('footer packaging labels and total rows are still excluded', () => {
  assert.deepEqual(parse(table([goodRow, ['胶箱', '', '2', '箱'], ['合计', '', '1000', '个'], ['', '备注', '', ''], ['', '签收后请通知业务员', '', '']])).items, [item(...goodRow)]);
});
test('goods named after delivery instructions retain their quantities instead of being treated as footer prose', () => {
  const rows = [goodRow, ['P-002', '签收贴纸', '500', '张'], ['P-003', '通知标签', '600', '张']];
  assert.deepEqual(parse(table(rows)).items, rows.map(row => item(...row)));
});
test('instruction-named goods use the same quantity extraction for combined quantity/unit cells', () => {
  const rows = [['P-002', '签收贴纸', '500张', ''], ['P-003', '通知标签', '600PCS', '']];
  assert.deepEqual(parse(table(rows)).items, [item('P-002', '签收贴纸', '500', ''), item('P-003', '通知标签', '600', '')]);
});
test('a header or metadata row without goods cannot become a headerless item', () => {
  for (const text of [
    '| 订单号 | 货号 | 品名 | 数量 | 单位 |',
    '| 订单号 | 货号 | 品名 | 数量 | 单位 |\n| --- | --- | --- | --- | --- |',
    '| 客户 | 收货公司 | 日期 | 2026-10-23 |',
  ]) assert.deepEqual(parse(text).items, [], text);
});
test('a header-only provider response triggers another prompt instead of reporting a fake item', async () => {
  const r = runtime(['| 订单号 | 货号 | 品名 | 数量 | 单位 |', table([goodRow])]);
  const result = await r.extract();
  assert.equal(r.calls.length, 2);
  assert.deepEqual(plain(result.fields.items), [item(...goodRow)]);
});
test('the third prompt can recover goods and retain first-pass document metadata', async () => {
  const r = runtime(['宏福制品厂\n日期：26/09/23\n送货单号：DN-123456\n订单号：PO-123456', '| 订单号 | 货号 | 品名 | 数量 | 单位 |', table([goodRow])]);
  const result = await r.extract();
  assert.equal(r.calls.length, 3);
  assert.deepEqual(plain(result.fields), { date: '2026-09-23', supplier: '宏福制品厂', deliveryNo: 'DN-123456', orderNo: 'PO-123456', type: '来料', items: [item(...goodRow)] });
});
test('headerless quantities use their unit instead of a numeric PO, product code or amount', () => {
  for (const [text, productNo] of [
    ['20261023001 | 77772贴纸 | 4500 | 张', '77772'],
    ['PO-123456 | 77772 | 贴纸 | 4500 | 张', '77772'],
    ['PO-123456 | 贴纸 | 2500 | 4500 | 张', ''],
    ['PO-123456 | 贴纸 | 张 | 4500', ''],
    ['PO-123456 | 77772-8#唱片背面贴纸 | 1,000 | 个', '77772-8#'],
  ]) {
    const fields = parse(text);
    assert.equal(fields.items.length, 1, text);
    assert.equal(fields.items[0].productNo, productNo, text);
    assert.equal(fields.items[0].qty, text.includes('1,000') ? '1000' : '4500', text);
    assert.equal(fields.items[0].unit, text.includes('1,000') ? '个' : '张', text);
    assert.equal(fields.orderNo, text.split(' | ')[0], text);
  }
});
test('headerless rows with no reliable quantity or competing quantity/unit pairs defer to another OCR prompt', () => {
  for (const text of ['PO-123456 | 贴纸 | 100 | 2500', 'PO-123456 | 贴纸 | 10 | 箱 | 1000 | 个']) assert.deepEqual(parse(text).items, [], text);
});
test('English product names and real ITEM/DESCRIPTION prefixes survive header filtering', () => {
  assert.deepEqual(parse(table([['', 'WASHER', '100', 'PCS'], ['ITEM12345', 'DESCRIPTION LABEL', '200', 'PCS']])).items, [item('', 'WASHER', '100', 'PCS'), item('ITEM12345', 'DESCRIPTION LABEL', '200', 'PCS')]);
  assert.deepEqual(parse(table([goodRow, ['ITEM NO.', 'DESCRIPTION', '数量', '单位']])).items, [item(...goodRow)]);
});
test('different quantity units remain separate; equivalent unit casing can still be deduplicated', () => {
  assert.deepEqual(parse(table([['P001', '玩具', '10', '箱'], ['P001', '玩具', '10', '个']])).items, [item('P001', '玩具', '10', '箱'), item('P001', '玩具', '10', '个')]);
  assert.deepEqual(parse(table([['P001', '玩具', '10', 'pcs'], ['P001', '玩具', '10', 'PCS']])).items, [item('P001', '玩具', '10', 'pcs')]);
});
test('table units retain supported traditional characters and equivalent letter casing', () => {
  for (const unit of ['个', '個', '張', '條', '顆', 'Pcs', 'pCs', 'Kg', 'KG', 'g', 'G', '千克', '克']) {
    assert.deepEqual(parse(table([['P001', '塑胶零件', '1000', unit]])).items,
      [item('P001', '塑胶零件', '1000', unit)], unit);
  }
});
test('numeric or shifted-column junk still cannot become a table unit', () => {
  for (const unit of ['960/960', '1000', 'PO-123456', '未完成']) {
    assert.deepEqual(parse(table([['P001', '塑胶零件', '1000', unit]])).items,
      [item('P001', '塑胶零件', '1000', '')], unit);
  }
});
test('stickers and numeric product names retain their anchored goods rows', () => {
  const rows = [['P002', '贴纸', '1000', '张'], ['P003', '504/504', '1000', '个'],
    ['', '505/505', '1000', '个'], ['P004', '504/504', '', '个']];
  for (const row of rows) assert.deepEqual(parse(table([row])).items, [item(...row)]);
});
test('unanchored numeric and header fragments remain excluded, and copied quantities remain blank', () => {
  const fields = parse(table([goodRow, ['', '504/504', '', ''], ['', '数量', '', ''],
    ['', '已送货数/总箱数/总数', '', ''], ['1000', '塑胶零件', '1000', '个']]));
  assert.deepEqual(fields.items, [item(...goodRow), item('1000', '塑胶零件', '', '个')]);
});
test('repeat fragments without quantity are removed when the complete same product row exists', () => {
  assert.deepEqual(parse(table([goodRow, ['P-001', '塑胶零件', '', '个']])).items, [item(...goodRow)]);
});
const htmlTable = '<table><tr><th>货号</th><th>品名</th><th>数量</th><th>单位</th></tr><tr><td>P-001</td><td>塑胶零件</td><td>1000</td><td>个</td></tr></table>';
test('HTML normalization keeps supplier, date and delivery number on their original lines', () => {
  const fields = parse('宏福制品厂\n客户：收货公司\n日期：2026-10-23\nDN-123456\n' + htmlTable);
  assert.equal(fields.supplier, '宏福制品厂'); assert.equal(fields.date, '2026-10-23'); assert.equal(fields.deliveryNo, 'DN-123456');
  assert.deepEqual(fields.items, [item(...goodRow)]);
});
test('HTML tables do not collapse surrounding Markdown rows', () => {
  assert.deepEqual(parse('宏福制品厂\n' + table([goodRow]) + '\n<table><tr><td>备注</td></tr></table>').items, [item(...goodRow)]);
});
test('HTML rowspan preserves quantity and unit alignment in subsequent goods rows', () => {
  const text = '<table><tr><th>货号</th><th>品名</th><th>数量</th><th>单位</th></tr><tr><td rowspan="2">P001</td><td>红色零件</td><td>1000</td><td>个</td></tr><tr><td>蓝色零件</td><td>2000</td><td>个</td></tr></table>';
  assert.deepEqual(parse(text).items, [item('P001', '红色零件', '1000'), item('P001', '蓝色零件', '2000')]);
});
test('HTML colspan keeps later quantity columns aligned', () => {
  const text = '<table><tr><th>货号</th><th>品名</th><th>规格</th><th>数量</th><th>单位</th></tr><tr><td>P001</td><td colspan="2">塑胶零件</td><td>1000</td><td>个</td></tr></table>';
  assert.deepEqual(parse(text).items, [item('P001', '塑胶零件', '1000')]);
});
test('HTML numeric and named entities decode before quantity parsing', () => {
  const text = htmlTable.replace('塑胶零件', '塑胶&amp;金属零件').replace('<td>1000</td>', '<td>&#x31;&#44;000</td>');
  assert.deepEqual(parse(text).items, [item('P-001', '塑胶&金属零件', '1000')]);
});
test('literal and entity-encoded pipes stay inside their original HTML product-name cell', () => {
  for (const name of ['PVC|ABS零件', 'PVC&#124;ABS零件']) {
    assert.deepEqual(parse(htmlTable.replace('塑胶零件', name)).items, [item('P-001', 'PVC|ABS零件', '1000')]);
  }
});
test('HTML cell newline entities normalize as cell whitespace without creating extra document lines', () => {
  const fields = parse(htmlTable.replace('塑胶零件', '塑胶&#10;零件'));
  assert.equal(fields.supplier, '');
  assert.deepEqual(fields.items, [item('P-001', '塑胶 零件', '1000')]);
});
test('HTML escaping preserves original backslashes and entity literals without changing Markdown backslashes', () => {
  const name = String.raw`模具\型号\\部件|ABS &amp;#124;`;
  assert.deepEqual(parse(htmlTable.replace('塑胶零件', name)).items, [item('P-001', String.raw`模具\型号\\部件|ABS &#124;`, '1000')]);
  assert.deepEqual(parse(table([['P-001', String.raw`模具\型号`, '1000', '个']])).items, [item('P-001', String.raw`模具\型号`, '1000')]);
});
test('ordinary supplier names retain their ampersand', () => {
  const fields = parse('R&D塑胶有限公司\n' + table([goodRow]));
  assert.equal(fields.supplier, 'R&D塑胶有限公司'); assert.deepEqual(fields.items, [item(...goodRow)]);
});
test('HTML supplier names decode ampersands without splitting the company name', () => {
  const fields = parse('<h1>R&amp;D塑胶有限公司</h1>\n' + htmlTable);
  assert.equal(fields.supplier, 'R&D塑胶有限公司'); assert.deepEqual(fields.items, [item(...goodRow)]);
});
test('LaTeX ampersands separate columns outside text wrappers while preserving ampersands inside company names', () => {
  for (const name of [String.raw`R&D塑胶有限公司`, String.raw`R\&D塑胶有限公司`]) {
    const text = String.raw`\begin{array}{l}\text{送货单} & \text{${name}} \\ \text{品名 数量 单位} \\ \text{A12345 塑胶零件 个 1000}\end{array}`;
    const fields = parse(text);
    assert.equal(fields.supplier, 'R&D塑胶有限公司'); assert.deepEqual(fields.items, [item('A12345', '塑胶零件', '1000')]);
  }
});
test('LaTeX goods do not make an ordinary or HTML supplier header a LaTeX column row', () => {
  const goods = String.raw`\begin{array}{l}\text{品名 数量 单位} \\ \text{A12345 塑胶零件 个 1000}\end{array}`;
  for (const text of ['R&D塑胶有限公司\n' + goods, '<h1>R&amp;D塑胶有限公司</h1>\n' + goods + '\n<table><tr><td>备注</td></tr></table>', goods + '\nR&D塑胶有限公司']) {
    const fields = parse(text);
    assert.equal(fields.supplier, 'R&D塑胶有限公司'); assert.deepEqual(fields.items, [item('A12345', '塑胶零件', '1000')]);
  }
});
test('LaTeX wrappers, two-digit years and unit-before-quantity text keep their new recognition paths', () => {
  const fields = parse(String.raw`\begin{array}{l}\text{测试供应商有限公司} \\ \text{日期：26/09/23} \\ \text{品名 数量 单位} \\ \text{A12345 塑胶零件 个 1000}\end{array}`);
  assert.equal(fields.supplier, '测试供应商有限公司'); assert.equal(fields.date, '2026-09-23');
  assert.deepEqual(fields.items, [item('A12345', '塑胶零件', '1000')]);
});
test('delivered quantity still outranks order balance and price columns', () => {
  const fields = parse('| 客户订单号 | 货号 | 品名 | 订单数量 | 交货数量 | 欠货数量 | 单位 | 单价 |\n| PO-123456 | P001 | 塑胶零件 | 3000 | 1000 | 2000 | 个 | 2.5 |');
  assert.equal(fields.orderNo, 'PO-123456'); assert.deepEqual(fields.items, [{ ...item('P001', '塑胶零件', '1000'), orderNo: 'PO-123456' }]);
});

test('different POs retain identical goods and quantities while repeated rows in one PO still deduplicate', () => {
  const fields = parse('| 订单号 | 货号 | 品名 | 数量 | 单位 |\n' +
    '| PO-100001 | P001 | 塑胶零件 | 100 | PCS |\n' +
    '| PO-100002 | P001 | 塑胶零件 | 100 | pcs |\n' +
    '| PO-100002 | P001 | 塑胶零件 | 100 | PCS |');
  assert.deepEqual(fields.items, [
    { ...item('P001', '塑胶零件', '100', 'PCS'), orderNo: 'PO-100001' },
    { ...item('P001', '塑胶零件', '100', 'pcs'), orderNo: 'PO-100002' },
  ]);
});
test('PO inheritance keeps merged cells and alphabetic identifiers, including across blank page rows', () => {
  const fields = parse('| 订单号 | 货号 | 品名 | 送货数/总单数 | 单位 |\n' +
    '| PO-ALPHA | P001 | 塑胶零件 | 100/500 | 个 |\n| | | | | |\n| | | | | |\n' +
    '| | P002 | 胶袋 | 200/600 | 个 |\n| PO-BETA | P003 | 纸箱 | 300/700 | 箱 |');
  assert.equal(fields.orderNo, 'PO-ALPHA');
  assert.deepEqual(fields.items.map(r => [r.productNo, r.qty, r.orderNo]), [
    ['P001', '100', 'PO-ALPHA'], ['P002', '200', 'PO-ALPHA'], ['P003', '300', 'PO-BETA'],
  ]);
});
test('full-width delivered/ordered separators do not concatenate both quantities', () => {
  const fields = parse('| 订单号 | 货号 | 品名 | 送貨數／總單數 | 單位 |\n| PO-100001 | P001 | 塑胶零件 | 100／500 | 個 |');
  assert.equal(fields.items[0].qty, '100'); assert.equal(fields.items[0].orderNo, 'PO-100001');
});
test('explicit Chinese and full-width PO values retain their own identity instead of inheriting another order', () => {
  const fields = parse('| 订单号 | 货号 | 品名 | 数量 | 单位 |\n' +
    '| PO-100001 | P001 | 塑胶零件 | 100 | 个 |\n| 兴信-100001 | P001 | 塑胶零件 | 100 | 个 |\n| ＰＯ－１００００２ | P001 | 塑胶零件 | 100 | 个 |');
  assert.deepEqual(fields.items.map(r => r.orderNo), ['PO-100001','兴信-100001','ＰＯ－１００００２']);
});
test('an anchored goods row with unreadable quantity remains available for manual correction', () => {
  assert.deepEqual(parse(table([['P001', '塑胶零件', '', '个']])).items,
    [item('P001', '塑胶零件', '', '个')]);
});
