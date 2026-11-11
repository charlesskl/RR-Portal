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
    console: { warn() {} }, setTimeout: callback => callback(), AbortSignal,
    fetch: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      const response = responses.shift();
      assert.ok(response, 'Unexpected provider attempt');
      return { status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: response } }] }) };
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
  const r = runtime(['| 订单号 | 货号 | 品名 | 数量 | 单位 |', table([goodRow]), '没有可确认的表头']);
  const result = await r.extract();
  assert.equal(r.calls.length, 3); // one table retry, then one optional header-only attempt
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
test('truncated HTML retains complete goods rows without inventing the unfinished row', () => {
  const complete = htmlTable.replace(/<\/table>$/, '');
  for (const unfinished of [
    '<tr><td>P-002',
    '<tr><td>P-002</td><td>半截零件</td><td>999',
    '<tr><td>P-002</td><td>半截零件</td><td>999</td><td>个</td>',
  ]) {
    const fields = parse('宏福制品厂\n日期：2026-11-03\n' + complete + unfinished);
    assert.equal(fields.supplier, '宏福制品厂');
    assert.equal(fields.date, '2026-11-03');
    assert.deepEqual(fields.items, [item(...goodRow)]);
  }
});
test('an unfinished HTML goods row alone cannot manufacture a parsed item or quantity', () => {
  const header = '<table><tr><th>货号</th><th>品名</th><th>数量</th><th>单位</th></tr>';
  assert.deepEqual(parse(header + '<tr><td>P-002</td><td>半截零件</td><td>999').items, []);
  assert.deepEqual(parse('<table><tr><th>货号</th><th>品名</th><th>数量').items, []);
});
test('truncated HTML rowspan does not create another goods row from its pending spans', () => {
  const text = '<table><tr><th>货号</th><th>品名</th><th>数量</th><th>单位</th></tr>' +
    '<tr><td rowspan="2">P001</td><td>完整零件</td><td>1000</td><td>个</td></tr>' +
    '<tr><td>半截零件</td><td>2000</td><td>个</td>';
  assert.deepEqual(parse(text).items, [item('P001', '完整零件', '1000')]);
});
test('the production OCR prompt retains its empty-row instruction without skipping nonempty goods', async () => {
  const r = runtime([htmlTable, '没有可确认的表头']);
  const result = await r.extract();
  assert.match(r.calls[0].messages[0].content[0].text, /Skip fully empty table rows\./);
  assert.deepEqual(plain(result.fields.items), [item(...goodRow)]);
});
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

test('packaging and signature-prefixed product names are never blanket-filtered as footer text', () => {
  const names = ['胶箱', '膠箱', '钙箱', '鈣箱', '胶袋', '膠袋', '纸箱', '紙箱', '平卡', '大平卡',
    '卡板', '胶卡板', '膠卡板', '木卡板', '吸塑托盘', '周转箱', '送货人标签', '收货人贴纸', '开单人记录纸', '制单贴纸', '审核标签'];
  const rows = names.map((name, i) => ['P-' + (i + 10), name, String(i + 100), '个']);
  assert.deepEqual(parse(table(rows)).items, rows.map(row => item(...row)));
  for (const name of ['胶袋', '纸箱', '胶卡板']) {
    assert.deepEqual(parse('| 品名 | 数量 | 单位 |\n| ' + name + ' | 1000 | 个 |').items, [item('', name, '1000')]);
    assert.deepEqual(parse(table([['P-001', name, '', '个']])).items, [item('P-001', name, '', '个')]);
  }
  // Some suppliers use the product-number column as the only goods description.
  // Its missing name COLUMN is different from a blank name CELL beside a footer label.
  for (const name of ['胶袋', '胶卡板', '木卡板']) {
    assert.deepEqual(parse('| 货号 | 数量 | 单位 |\n| ' + name + ' | 1000 | 个 |').items, [item(name, name, '1000')]);
  }
});

test('only structurally empty footer labels are excluded, while ambiguous goods remain for correction', () => {
  const footerRows = ['胶卡板', '膠卡板', '木卡板', '大平卡', '送货人', '收貨人', '开单人', '製單人', '審核人']
    .map(label => [label, '', '2', '']);
  assert.deepEqual(parse(table([goodRow, ...footerRows, ['', '送货人', '', ''], ['', '審核', '', '']])).items, [item(...goodRow)]);
  assert.deepEqual(parse(table([['P-SIGN', '送货人', '12', '张'], ['P-REVIEW', '审核标签', '', '张']])).items,
    [item('P-SIGN', '送货人', '12', '张'), item('P-REVIEW', '审核标签', '', '张')]);
});

test('three actual row POs and delivered slash quantities remain exact alongside packaging goods and footer labels', () => {
  for (const [header, slash] of [['送货数/总单数', '/'], ['送貨數／總單數', '／'],
    ['发货数/总单数', '/'], ['發貨數／總單數', '／'], ['送貨数/总单数', '/'], ['发貨數／總單數', '／']]) {
    const fields = parse('| 订单号 | 货号 | 品名 | ' + header + ' | 单位 |\n' +
      '| PO-ONE | P01 | 胶箱部件 | 984' + slash + '1000 | 个 |\n' +
      '| PO-TWO | P02 | 胶袋 | 204' + slash + '300 | 个 |\n' +
      '| PO-THREE | P03 | 吸塑托盘 | 588' + slash + '600 | 个 |\n' +
      '| | 胶箱 | | 2 | 箱 |\n| | | 收货人 | | |');
    assert.deepEqual(fields.items, [
      { ...item('P01', '胶箱部件', '984'), orderNo: 'PO-ONE' },
      { ...item('P02', '胶袋', '204'), orderNo: 'PO-TWO' },
      { ...item('P03', '吸塑托盘', '588'), orderNo: 'PO-THREE' },
    ]);
  }
});

test('split-name columns keep actual delivered quantity instead of amount for both slash widths', () => {
  for (const nameHeaders of [['货', '名'], ['貨', '名']]) {
    for (const heading of ['送货数/总单数', '发货数/总单数', '送貨數／總單數', '發貨數／總單數']) {
      for (const slash of ['/', '／']) {
        for (const mergedName of [false, true]) {
          const head = ['订单号', '货号', ...nameHeaders, heading, '金额', '单位'];
          const row = ['PO-ONE', 'P01', '塑胶零件', ...(mergedName ? [] : ['']), '984' + slash + '3000', '9.99', '个'];
          const text = '| ' + head.join(' | ') + ' |\n| ' + row.join(' | ') + ' |';
          assert.deepEqual(parse(text).items,
            [{ ...item('P01', '塑胶零件', '984'), orderNo: 'PO-ONE' }],
            heading + ', separator ' + slash + ', merged name ' + mergedName);
        }
      }
    }
  }
});

test('the known dot-matrix delivery layout keeps all ten sequenced goods and leading-zero codes', () => {
  // Synthetic rows only: no customer documents or production records are used.
  const rows = [
    ['1', '0254', '8.760', '个'], ['2', 'C031', '2.400', 'PCS'],
    ['3', '0031', '84', '个'], ['4', '0031', '84', '个'],
    ['5', 'A011', '0.650', 'KG'], ['6', 'A012', '8.760', 'KG'],
    ['7', 'A013', '0.650', '个'], ['8', '0032', '1.234.567', '個'],
    ['9', '0040', '0.06', '个'], ['10', '0041', '1,234', '个'],
  ];
  const text = '晶源激光制品厂\n送货单\n0254\n| 序号 | 品名及规格 | 数量 | 单位 |\n' +
    rows.map(row => '| ' + row.join(' | ') + ' |').join('\n');
  const fields = parse(text);
  assert.equal(fields.supplier, '晶源激光制品厂');
  assert.equal(fields.deliveryNo, '', 'a four-digit goods code is not a delivery number');
  assert.deepEqual(fields.items, rows.map((row, i) => item(row[1], '',
    ['8760', '2400', '84', '84', '0.650', '8.760', '0.650', '1234567', '0.06', '1234'][i], row[3])));
});

test('dot grouping conversion requires the known supplier, delivery document and discrete unit together', () => {
  for (const prefix of ['其他供应商有限公司\n送货单\n', '晶源激光制品厂\n']) {
    assert.deepEqual(parse(prefix + table([['P001', '塑胶零件', '8.760', '个']])).items,
      [item('P001', '塑胶零件', '8.760')], prefix);
  }
  for (const unit of ['KG', 'Kg', 'G', '千克', '克', '米', '卷', '桶', '']) {
    assert.deepEqual(parse('晶源激光制品厂\n发货单\n' + table([['P001', '原材料', '8.760', unit]])).items,
      [item('P001', '原材料', '8.760', unit)], unit);
  }
  for (const qty of ['0.650', '0.006', '0.06', '08.760', '8.76']) {
    assert.equal(parse('晶源激光制品厂\n送货单\n' + table([['P001', '塑胶零件', qty, '个']])).items[0].qty, qty);
  }
});

test('unknown multiple-dot quantities retain their whole original token for manual correction', () => {
  assert.deepEqual(parse(table([['P001', '塑胶零件', '1.234.567', '个']])).items,
    [item('P001', '塑胶零件', '1.234.567')]);
  for (const row of ['P001 塑胶零件 1.234.567 个', 'P001 塑胶零件 个 1.234.567']) {
    assert.deepEqual(parse('品名 数量 单位\n' + row).items,
      [item('P001', '塑胶零件', '1.234.567')], row);
  }
  assert.deepEqual(parse('| 品名 | 数量 | 单位 |\n| 0254 | 1.234.567 | 个 |').items,
    [item('', '0254', '1.234.567')], 'an explicit but ambiguous quantity cannot delete a numeric-named goods row');
});

test('plain-text quantities retain real fractions, and known count units alone use dotted grouping', () => {
  for (const qty of ['0.650', '8.760', '0.06', '1.234.567']) {
    for (const row of ['P001 原材料 ' + qty + ' KG', 'P001 原材料 KG ' + qty]) {
      assert.deepEqual(parse('品名 数量 单位\n' + row).items,
        [item('P001', '原材料', qty, 'KG')], row);
    }
  }
  for (const row of ['0254 塑胶零件 8.760 個', '0254 塑胶零件 個 8.760']) {
    assert.deepEqual(parse('晶源激光制品厂\n送货单\n品名 数量 单位\n' + row).items,
      [item('0254', '塑胶零件', '8760', '個')], row);
  }
});

test('numeric-looking product names only become codes in the known code-only layout', () => {
  for (const name of ['0254', 'C031', '504/504']) {
    assert.deepEqual(parse('| 品名 | 数量 | 单位 |\n| ' + name + ' | 100 | 个 |').items,
      [item('', name, '100')], name);
    assert.deepEqual(parse(table([['P001', name, '100', '个']])).items,
      [item('P001', name, '100')], name);
  }
  assert.deepEqual(parse('晶源激光制品厂\n送货单\n| 序号 | 品名及规格 | 数量 | 单位 |\n' +
    '| 1 | 0254 | | 个 |\n| 2 | C031 | | 个 |\n| 3 | 0032 | 0032 | 个 |\n| 4 | 001234 | | 个 |').items,
    [item('0254', '', ''), item('C031', '', ''), item('0032', '', ''), item('001234', '', '')], 'known code-only rows remain available when quantity is unreadable or copied from their code');
});

test('embedded name quantities do not throw and preserve explicit quantity and unit columns', () => {
  assert.deepEqual(parse(table([['P001', '折CDU: 1120个', '', '']])).items,
    [item('P001', '折CDU', '1120')]);
  assert.deepEqual(parse(table([['P001', '折CDU：1120PCS', '', '张']])).items,
    [item('P001', '折CDU', '1120', '张')]);
  assert.deepEqual(parse(table([['P001', '折CDU: 1120个', '900', '个']])).items,
    [item('P001', '折CDU: 1120个', '900')]);
});

test('a PO-looking product name cannot override an explicit row order', () => {
  const fields = parse('| 订单号 | 货号 | 品名 | 数量 | 单位 |\n' +
    '| PO-ACTUAL | P001 | PO:OTHER-100 | 100 | 个 |\n' +
    '| PO-NEXT | P002 | PO12345 | 200 | 个 |');
  assert.equal(fields.orderNo, 'PO-ACTUAL');
  assert.deepEqual(fields.items, [
    { ...item('P001', 'PO:OTHER-100', '100'), orderNo: 'PO-ACTUAL' },
    { ...item('P002', 'PO12345', '200'), orderNo: 'PO-NEXT' },
  ]);
});

test('explicit PO metadata in a product-name cell still provides its row order', () => {
  const fields = parse(table([['P001', 'PO：ABC-1000', '100', '个'], ['P002', 'PO: ABC-2000', '200', '个']]));
  assert.equal(fields.orderNo, 'ABC-1000');
  assert.deepEqual(fields.items, [
    { ...item('P001', '', '100'), orderNo: 'ABC-1000' },
    { ...item('P002', '', '200'), orderNo: 'ABC-2000' },
  ]);
});

test('explicit sequence identity preserves repeated physical goods through every deduplication stage', () => {
  for (const header of ['序号', '序號', 'NO.']) {
    const fields = parse('| ' + header + ' | 货号 | 品名 | 数量 | 单位 |\n' +
      '| 1 | P001 | ABS1L零件 | 84 | 个 |\n' +
      '| 2 | P001 | ABS1L零件 | 84 | 个 |\n' +
      '| 02 | P001 | ABS1L零件 | 84 | 个 |');
    assert.deepEqual(fields.items, [item('P001', 'ABS1L零件', '84'), item('P001', 'ABS1L零件', '84')], header);
    assert.ok(fields.items.every(row => !('_seq' in row)), 'internal sequence is not part of the record payload');
  }
  assert.deepEqual(parse(table([['P001', '塑胶零件', '84', '个'], ['P001', '塑胶零件', '84', '个']])).items,
    [item('P001', '塑胶零件', '84')], 'a nonempty product number is not a sequence marker');
  assert.deepEqual(parse('| 序号 | 货号 | 品名 | 数量 | 单位 |\n' +
    '| 1 | P001 | 塑胶零件 | 84 | 个 |\n| 2 | P001 | 塑胶零件 | | 个 |').items,
    [item('P001', '塑胶零件', '84'), item('P001', '塑胶零件', '')], 'a separate sequence with unreadable quantity remains for correction');
});

test('supplier fallback excludes addresses, department fields and arbitrary English headers', () => {
  for (const lines of ['九龙工业区\nKOWLOON HONG KONG\nTEL 12345678\n品名\n件数',
    '半成品入库单\n装配部\n提货批次\n数量\n尺寸', 'SHIPMENT\nREFERENCE\n123456',
    '送货单\n送貨單\n发货单\n發貨單']) {
    const fields = parse(lines + '\n' + table([goodRow]));
    assert.equal(fields.supplier, '', lines);
    assert.deepEqual(fields.items, [item(...goodRow)]);
  }
  assert.equal(parse('ACME CO LTD\n' + table([goodRow])).supplier, 'ACME CO LTD');
  assert.equal(parse('攀登\n' + table([goodRow])).supplier, '攀登');
});

test('numeric delivery labels retain the whole value including DN12 and parenthesized labels', () => {
  for (const label of ['送货单号(DN#)', '送貨單號（DN#）', '发货单号(DN#)', 'NO.']) {
    for (const value of ['DN12', '1ABC', 'A2026-07/09', '20261103001', 'DGHD.2673728']) {
      assert.equal(parse(label + ': ' + value + '\n' + table([goodRow])).deliveryNo, value, label + ' / ' + value);
    }
  }
  assert.equal(parse('送货单号(DN#): DELIVERY\n' + table([goodRow])).deliveryNo, '');
});
test('a labeled document PO precedes line tokens without treating name-cell PO text as header metadata', () => {
  const fields = parse('订单号(PO#): DOC/123456\n品名 数量 单位\nP001 塑胶零件 100 个');
  assert.equal(fields.orderNo, 'DOC/123456');
  const rows = parse('| 订单号 | 货号 | 品名 | 数量 | 单位 |\n| PO-ACTUAL | P001 | PO:OTHER-100 | 100 | 个 |');
  assert.equal(rows.orderNo, 'PO-ACTUAL');
  assert.equal(rows.items[0].orderNo, 'PO-ACTUAL');
  assert.equal(rows.items[0].productName, 'PO:OTHER-100');
});
test('explicit complex column positions keep PO, SKU, quantity and fractional trailing measurements distinct', () => {
  const fields = parse('伟成合成测试制品厂\n订单号(PO#): DOC/123456\n' +
    '序号 P/I NO. ITEM Description 数量 尺寸(mm) 重量(KG)\n' +
    '1 PI/20261103-01 000123 合成零件 1000 12.5*20*3 0.650 KG\n' +
    '2 PI/20261103-02 A031/2 S3 合成零件 20 300 10x20 3.75');
  assert.equal(fields.orderNo, 'DOC/123456');
  assert.deepEqual(fields.items, [
    { ...item('000123', '合成零件', '1000', ''), orderNo: 'PI/20261103-01' },
    { ...item('A031/2', 'S3 合成零件 20', '300', ''), orderNo: 'PI/20261103-02' },
  ]);
});
test('unknown unitless layouts preserve the full row and require review rather than guessing price, PO or SKU', () => {
  const examples = [
    ['ITEM Description 数量', '1 PO100001 SKU001 合成零件 12345 20 1.50'],
    ['序号 PO 货号 品名 数量 单价 尺寸 重量', '1 PO100001 SKU001 合成零件 1000 20 10*20 0.650'],
    ['序号 PO 货号 品名 数量 重量', '1 PO100001 SKU001 合成零件 1000 0.650 KG'],
    ['序号 PO 货号 品名 数量 尺寸 重量', '1 PO100001 SKU001 合成零件 1000 10*20'],
    ['序号 PO 货号 品名 数量 单位', '1 PO100001 SKU001 合成零件 100 个'],
  ];
  for (const [header, raw] of examples) {
    const fields = parse('其他合成供应商有限公司\n' + header + '\n' + raw);
    assert.equal(fields.orderNo, '', raw);
    assert.deepEqual(fields.items, [{ ...item('', '待核对原行：' + raw, '', ''), quantityNeedsReview: true }], raw);
  }
});
test('an uncertain row remains beside a complete unit row without acquiring the preceding SKU', () => {
  const raw = '1 PO100001 SKU001 合成零件 12345 20 1.50';
  const fields = parse('品名 数量 单位\nP001 完整零件 100 个\n' + raw);
  assert.deepEqual(fields.items, [item('P001', '完整零件', '100'),
    { ...item('', '待核对原行：' + raw, '', ''), quantityNeedsReview: true }]);
});
test('ordinary sequence and quantity-unit headers retain the existing reliable unit parsing', () => {
  for (const header of ['序号 货号 品名 数量 单位', 'NO. ITEM Description QTY 单位']) {
    assert.deepEqual(parse(header + '\n1 P001 合成零件 100 个').items, [item('P001', '合成零件', '100')], header);
  }
});
test('pipe document metadata remains ahead of the actual goods-table header for PO extraction', () => {
  const fields = parse('| 订单号：PO-123456 |\n| 货号 | 品名 | 数量 |\n| P001 | 合成零件 | 100 |');
  assert.equal(fields.orderNo, 'PO-123456');
  assert.deepEqual(fields.items, [item('P001', '合成零件', '100', '')]);
});
test('a malformed or missing sequence under complex columns cannot fall back to interpreting weight as quantity', () => {
  const header = '序号 PO 货号 品名 数量 尺寸 重量';
  for (const raw of ['1.0 PO100001 SKU001 合成零件 1000 10*20 650 KG',
    '① PO100001 SKU001 合成零件 1000 10*20 650 KG',
    'PO100001 SKU001 合成零件 1000 10*20 650 KG']) {
    const fields = parse('其他合成供应商有限公司\n' + header + '\n' + raw);
    assert.deepEqual(fields.items, [{ ...item('', '待核对原行：' + raw, '', ''), quantityNeedsReview: true }], raw);
    assert.equal(fields.orderNo, '', raw);
  }
  const valid = parse(header + '\n1 PO100001 SKU001 合成零件 1000 10*20 650 KG');
  assert.deepEqual(valid.items, [{ ...item('SKU001', '合成零件', '1000', ''), orderNo:'PO100001' }]);
});

test('the first production recognition request preserves original table columns and empty cells', async () => {
  const r = runtime(['|货号|品名|数量|单位|\n|SKU001|合成件|12|PCS|']);
  await r.extract();
  const prompt = r.calls[0].messages[0].content[0].text;
  assert.match(prompt, /original column headers and column order/);
  assert.match(prompt, /every empty cell, including empty leading cells/);
  assert.match(prompt, /carton counts and remarks/i);
});
