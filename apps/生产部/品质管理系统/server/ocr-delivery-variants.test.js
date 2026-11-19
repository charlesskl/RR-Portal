'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Exercise the production parser without starting a server, loading private
// configuration/databases, or making model requests. All goods below are synthetic.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const start = source.indexOf('const OCR_READ_PROMPT =');
const end = source.indexOf('/* ── 记录表列顺序');
assert.ok(start >= 0 && end > start, 'Production OCR declarations must be identifiable');
const context = vm.createContext({
  console: { warn() {} },
  fetch() { throw new Error('Parser tests must not request an OCR provider'); },
});
vm.runInContext(source.slice(start, end) + ';globalThis.parseActual = parseDeliveryNote;', context);
const parse = text => JSON.parse(JSON.stringify(context.parseActual(text)));

const header = ['序号', 'PO/NO', '货号', '货品名称', '订单数量', '单位', '送货数量', '包装方式', '备注'];
const row = ['10', 'PO2026/10080', 'SKU3013', '合成吊牌(J1款)', '5000', 'PCS', '1200', '1包*5000', '核对'];
const pipe = cells => '|' + cells.join('|') + '|';
const markdown = (headers = header, rows = [row]) => [
  pipe(headers), pipe(headers.map(() => '---')), ...rows.map(pipe),
].join('\n');
const tabular = (headers = header, rows = [row]) => [headers, ...rows].map(cells => cells.join('\t')).join('\n');
const project = item => ({ orderNo: item.orderNo || '', productNo: item.productNo || '',
  productName: item.productName || '', qty: item.qty, unit: item.unit || '' });
const expected = { orderNo: 'PO2026/10080', productNo: 'SKU3013', productName: '合成吊牌(J1款)', qty: '1200', unit: 'PCS' };

function oneExact(raw, overrides = {}) {
  const fields = parse(raw);
  assert.equal(fields.items.length, 1);
  assert.deepEqual(project(fields.items[0]), { ...expected, ...overrides });
  assert.equal(fields.items[0].quantityNeedsReview, undefined);
  assert.ok(!fields.manualReviewRequired);
  return fields;
}

function needsReview(raw) {
  const fields = parse(raw);
  assert.ok(fields.items.length > 0, 'Uncertain source must remain available for review');
  for (const item of fields.items) {
    assert.equal(item.qty, '', 'Uncertain columns must not supply a guessed delivered quantity');
    assert.ok(item.quantityNeedsReview === true || fields.manualReviewRequired === true,
      'An empty/uncertain quantity requires an explicit review signal');
  }
  return fields;
}

test('delivery table maps a later actual-delivery column instead of the order quantity', () => {
  const fields = oneExact(markdown());
  assert.equal(fields.orderNo, expected.orderNo);
});

test('fenced markdown, CRLF, and pipe padding preserve the same delivery fields', () => {
  const padded = markdown().split('\n').map(line => '  ' + line.replace(/\|/g, ' | ') + '  ').join('\r\n');
  oneExact('```markdown\r\n' + padded + '\r\n```');
});

test('pipe-delimited tables do not require optional outside pipes', () => {
  oneExact(markdown().split('\n').map(line => line.slice(1, -1)).join('\n'));
});

test('OCR spaces within Chinese column labels do not change the delivered column', () => {
  const spaced = header.map(label => /[\u4e00-\u9fff]/.test(label) ? [...label].join(' ') : label);
  oneExact(markdown(spaced));
});

test('reordered explicit delivery columns follow unique header semantics', () => {
  const order = [8, 6, 3, 0, 5, 2, 1, 4, 7];
  oneExact(markdown(order.map(index => header[index]), [order.map(index => row[index])]));
});

test('an explicit actual-delivery column outranks an earlier generic quantity column', () => {
  const headers = header.map(label => label === '订单数量' ? '数量' : label);
  oneExact(markdown(headers));
});

test('TSV preserves empty final cells and a blank SKU without shifting or inheriting it', () => {
  const rows = [row.slice(0, 7).concat('', ''),
    ['11', 'PO2026/10081', '', '合成吊牌(R1款)', '5000', 'PCS', '600', '', '']];
  const fields = parse(tabular(header, rows));
  assert.equal(fields.items.length, 2);
  assert.deepEqual(fields.items.map(project), [expected,
    { orderNo: 'PO2026/10081', productNo: '', productName: '合成吊牌(R1款)', qty: '600', unit: 'PCS' }]);
  assert.equal(fields.orderNo, '');
  assert.ok(fields.items.every(item => !item.quantityNeedsReview));
  assert.ok(!fields.manualReviewRequired);
});

for (const [name, build] of [['Markdown', markdown], ['TSV', tabular]]) {
  test(name + ' physical PO and name cell newlines retain their own column boundaries', () => {
    const wrapped = row.map((value, index) => index === 1 ? 'PO2026/\n10080' :
      index === 3 ? '合成吊牌\n(J1款)' : value);
    oneExact(build(header, [wrapped]), { productName: '合成吊牌 (J1款)' });
  });
}

test('positioned HTML break tags preserve complete PO and name values', () => {
  const wrapped = row.map((value, index) => index === 1 ? 'PO2026/<br/>10080' :
    index === 3 ? '合成吊牌<br>(J1款)' : value);
  oneExact(markdown(header, [wrapped]), { productName: '合成吊牌 (J1款)' });
});

test('nine explicit goods rows retain row-local PO SKU name and actual delivery quantities', () => {
  const rows = Array.from({ length: 9 }, (_, index) => [String(index + 1),
    index < 5 ? 'PO2026/10080' : 'PO2026/10081', 'SKU' + (3013 + index),
    '合成吊牌(J' + (index + 1) + '款)', '5000', 'PCS', String(1200 + index * 10), '', '']);
  const fields = parse(markdown(header, rows));
  assert.equal(fields.items.length, rows.length);
  assert.deepEqual(fields.items.map(project), rows.map(cells => ({ orderNo: cells[1],
    productNo: cells[2], productName: cells[3], qty: cells[6], unit: cells[5] })));
  assert.equal(fields.orderNo, '');
  assert.ok(fields.items.every(item => !item.quantityNeedsReview));
});

for (const [label, cells] of [
  ['short row with an omitted order-quantity cell', row.slice(0, 4).concat(row.slice(5))],
  ['long row with an extra numeric cell', row.concat('9999')],
]) {
  test(label + ' is reviewed instead of reading a shifted packing number', () => {
    needsReview(markdown(header, [cells]));
  });
}

test('an order quantity without an actual-delivery header never becomes delivered quantity', () => {
  needsReview(markdown(header.filter((_value, index) => index !== 6),
    [row.filter((_value, index) => index !== 6)]));
});

for (const [label, extraHeader, quantity] of [
  ['duplicate actual delivery', '送货数量', '1200'],
  ['conflicting duplicate actual delivery', '送货数量', '1300'],
  ['competing actual-delivery aliases', '本次交货数量', '1300'],
]) {
  test(label + ' requires review instead of selecting the first number', () => {
    needsReview(markdown(header.concat(extraHeader), [row.concat(quantity)]));
  });
}

for (const [label, value] of [['missing', ''], ['unreadable', '不清楚'], ['uncertain', '1200?']]) {
  test(label + ' actual-delivery quantity keeps the order quantity and packing number out', () => {
    needsReview(markdown(header, [row.map((cell, index) => index === 6 ? value : cell)]));
  });
}

for (const [label, extraHeader, value] of [
  ['PO alias', '订单号', 'PO2026/10081'],
  ['SKU', '货号', 'SKU9999'],
  ['product name', '货品名称', '另一合成吊牌'],
]) {
  test('duplicate recognized ' + label + ' headers cannot silently choose an identity', () => {
    needsReview(markdown(header.concat(extraHeader), [row.concat(value)]));
  });
}

test('plain whitespace with ambiguous PO fragments and a missing SKU remains review-only', () => {
  const raw = header.join(' ') + '\n10 PO2026/ 10080 合成吊牌 (J1款) 5000 PCS 1200 1 包*5000 核对';
  needsReview(raw);
});

test('a broken physical row cannot consume the next independently numbered goods row', () => {
  const next = ['11', 'PO2026/10081', 'SKU3014', '合成吊牌(R1款)', '5000', 'PCS', '600', '', ''];
  const raw = [pipe(header), pipe(header.map(() => '---')), '|10|PO2026/', pipe(next)].join('\n');
  const fields = parse(raw);
  assert.equal(fields.items.length, 2);
  assert.equal(fields.items[0].qty, '');
  assert.ok(fields.items[0].quantityNeedsReview || fields.manualReviewRequired);
  assert.deepEqual(project(fields.items[1]), { orderNo: 'PO2026/10081', productNo: 'SKU3014',
    productName: '合成吊牌(R1款)', qty: '600', unit: 'PCS' });
});

for (const [name, convert] of [
  ['fullwidth outside and inside rules', text => text.replace(/\|/g, '｜')],
  ['ASCII outside rules and fullwidth inside rules', text => text.split('\n')
    .map(line => '|' + line.slice(1, -1).replace(/\|/g, '｜') + '|').join('\n')],
  ['fullwidth inside rules without outside rules', text => text.split('\n')
    .map(line => line.slice(1, -1).replace(/\|/g, '｜')).join('\n')],
]) {
  test(name + ' keep order quantity and actual-delivery quantity in separate cells', () => {
    oneExact(convert(markdown()));
  });
}

test('fullwidth PO and sequence header syntax is folded only for header matching', () => {
  const headers = header.map(label => label === 'PO/NO' ? 'ＰＯ／ＮＯ' : label === '序号' ? 'ＮＯ．' : label);
  oneExact(markdown(headers));
});

test('fullwidth PO and SKU source values remain distinct instead of receiving NFKC folding', () => {
  const fullwidth = row.map((value, index) => index === 0 ? '11' :
    index === 1 ? 'ＰＯ２０２６／１００８０' : index === 2 ? 'ＳＫＵ３０１３' : value);
  const fields = parse(markdown(header, [row, fullwidth]));
  assert.equal(fields.items.length, 2);
  assert.deepEqual(fields.items.map(project), [expected,
    { ...expected, orderNo: 'ＰＯ２０２６／１００８０', productNo: 'ＳＫＵ３０１３' }]);
  assert.equal(fields.orderNo, '');
  assert.ok(fields.items.every(item => !item.quantityNeedsReview));
});

test('fullwidth quantity text stays for review unless explicitly supported as a quantity format', () => {
  needsReview(markdown(header, [row.map((value, index) => index === 6 ? '１２００' : value)]));
});

test('a closed short physical row cannot borrow a following unframed fragment to fill its columns', () => {
  const raw = [pipe(header), '|10|PO2026/10080|SKU3013|合成吊牌(J1款)|',
    '5000|PCS|1200|1包*5000|核对|'].join('\n');
  needsReview(raw);
});

for (const [name, separator, framed] of [['Markdown', '|', true], ['TSV', '\t', false]]) {
  test(name + ' incomplete PO cannot absorb a complete next row without outside pipes', () => {
    const next = ['11', 'PO2026/10081', 'SKU3014', '合成吊牌(R1款)', '5000', 'PCS', '600', '1包*600', '核对'];
    const raw = [framed ? pipe(header) : header.join(separator),
      (framed ? '|' : '') + ['10', 'PO2026/'].join(separator), next.join(separator)].join('\n');
    const fields = parse(raw);
    assert.equal(fields.items.length, 2);
    assert.equal(fields.items[0].qty, '');
    assert.ok(fields.items[0].quantityNeedsReview || fields.manualReviewRequired);
    assert.deepEqual(project(fields.items[1]), { orderNo: 'PO2026/10081', productNo: 'SKU3014',
      productName: '合成吊牌(R1款)', qty: '600', unit: 'PCS' });
  });
}

test('a later reordered delivery header cannot reuse earlier PO SKU or quantity indices', () => {
  const order = [0, 2, 1, 3, 6, 5, 4, 7, 8];
  const next = ['11', 'PO2026/10081', 'SKU3014', '合成吊牌(R1款)', '5000', 'PCS', '600', '', ''];
  const raw = [pipe(header), pipe(row), pipe(order.map(index => header[index])),
    pipe(order.map(index => next[index]))].join('\n');
  const fields = parse(raw);
  assert.deepEqual(project(fields.items[0]), expected);
  const expectedNext = { orderNo: 'PO2026/10081', productNo: 'SKU3014',
    productName: '合成吊牌(R1款)', qty: '600', unit: 'PCS' };
  const later = fields.items.slice(1);
  assert.ok(later.length > 0, 'The later goods source must remain available');
  // A new table may be parsed by its own schema or retained for explicit review.
  // Neither policy may silently apply the previous table's column positions.
  for (const item of later) {
    if (item.qty !== '') assert.deepEqual(project(item), expectedNext);
    else assert.ok(item.quantityNeedsReview || fields.manualReviewRequired);
  }
  assert.ok(later.some(item => item.qty === '600' ||
    item.qty === '' && JSON.stringify(item).includes('PO2026/10081')),
  'The next row must be mapped correctly or retained as its own review source');
});

for (const [format, build] of [['Markdown', markdown], ['TSV', tabular]]) {
  for (const [label, wrapped] of [['货品名称', '货品\n名称'], ['送货数量', '送货\n数量']]) {
    test(format + ' physical newline inside the ' + label + ' header preserves proven cell boundaries', () => {
      oneExact(build(header.map(value => value === label ? wrapped : value)));
    });
  }
}

for (const [format, frame] of [
  ['TSV', cells => cells.join('\t')],
  ['fullwidth pipes', cells => '｜' + cells.join('｜') + '｜'],
]) {
  test(format + ' retains a complete next-page row after a total without a repeated header', () => {
    const next = ['11', 'PO2026/10081', 'SKU3014', '合成吊牌(R1款)', '5000', 'PCS', '600', '', ''];
    const fields = parse([frame(header), frame(row), '合计：1200', frame(next)].join('\n'));
    assert.equal(fields.items.length, 2);
    assert.deepEqual(fields.items.map(project), [expected,
      { orderNo: 'PO2026/10081', productNo: 'SKU3014', productName: '合成吊牌(R1款)', qty: '600', unit: 'PCS' }]);
    assert.equal(fields.orderNo, '');
    assert.ok(fields.items.every(item => !item.quantityNeedsReview));
  });
}

test('a later renamed and reordered delivery header cannot reuse earlier order quantities', () => {
  const order = [0, 2, 1, 3, 6, 5, 4, 7, 8];
  const renamed = header.map(label => label === '货品名称' ? '产品名称' :
    label === '送货数量' ? '本次送货数量' : label);
  const next = ['11', 'PO2026/10081', 'SKU3014', '合成吊牌(R1款)', '5000', 'PCS', '600', '', ''];
  const fields = parse([pipe(header), pipe(row), pipe(order.map(index => renamed[index])),
    pipe(order.map(index => next[index]))].join('\n'));
  assert.deepEqual(project(fields.items[0]), expected);
  const expectedNext = { orderNo: 'PO2026/10081', productNo: 'SKU3014',
    productName: '合成吊牌(R1款)', qty: '600', unit: 'PCS' };
  const later = fields.items.slice(1);
  assert.ok(later.length > 0);
  for (const item of later) {
    if (item.qty !== '') assert.deepEqual(project(item), expectedNext);
    else assert.ok(item.quantityNeedsReview || fields.manualReviewRequired);
  }
  assert.ok(later.some(item => item.qty === '600' ||
    item.qty === '' && JSON.stringify(item).includes('PO2026/10081')),
  'A renamed later section must be mapped correctly or retain the complete goods source for review');
});

// A damaged delivery header must not fall back to the generic first-match parser.
test('missing SKU header with competing actual-delivery columns requires review', () => {
  needsReview('|序号|PO/NO|货品名称|订单数量|单位|送货数量|送货数量|\n' +
    '|1|PO-SYNTH|合成件|5000|PCS|1200|600|');
});
test('missing unit header and shifted numeric packing cannot supply delivery quantity', () => {
  needsReview('|序号|PO/NO|货号|货品名称|订单数量|送货数量|包装方式|\n' +
    '|1|PO-SYNTH|SKU-SYNTH|合成件|5000|900|');
});
