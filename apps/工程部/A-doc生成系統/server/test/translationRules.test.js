const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCandidateText,
  analyzeText,
  translateUniqueTexts,
} = require('../utils/translationRules');

function fakeProvider(fixtures) {
  const calls = [];
  return {
    calls,
    async translateMany(requests) {
      calls.push(requests.map(request => ({ ...request })));
      const result = new Map();
      for (const request of requests) {
        assert.match(request.id, /^translation-\d+$/);
        assert.equal(request.id.includes(request.text), false);
        const fixture = fixtures[`${request.text}|${request.to}`];
        if (fixture) result.set(request.id, { ...fixture });
      }
      return result;
    },
  };
}

test('skips codes, paths, errors and non-text tokens', () => {
  for (const value of [
    '47193C',
    'https://example.com',
    'www.example.com',
    'a@b.com',
    '123.45',
    '---',
    '#N/A',
    'C:\\orders\\sample.xlsx',
    'folder/sample.xlsx',
  ]) {
    assert.equal(isCandidateText(value), false, value);
  }
  assert.equal(isCandidateText(123), false);
  assert.equal(isCandidateText('产品 47193C'), true);
});

test('keeps canonical bilingual and trilingual text idempotent', async () => {
  const provider = fakeProvider({
    'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Product Name|zh-CN': { text: '产品名称', detectedLanguage: 'en' },
  });
  const input = ['卡车车身 / Truck body', 'Nama Produk / 产品名称 / Product Name'];
  const result = await translateUniqueTexts(input, provider);

  assert.deepEqual(result.get(input[0]), {
    status: 'skipped',
    value: input[0],
    reason: 'already-complete',
  });
  assert.equal(result.get(input[1]).value, input[1]);
  assert.equal(result.get(input[1]).status, 'skipped');
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(
    provider.calls[0].map(request => request.text),
    ['Truck body', 'Nama Produk', 'Product Name'],
  );
});

test('adds English to Chinese, Chinese to English, and both to other languages', async () => {
  const provider = fakeProvider({
    '卡车车身|en': { text: 'Truck body', detectedLanguage: 'zh-CN' },
    'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
    '製品名|en': { text: 'Product Name', detectedLanguage: 'ja' },
    '製品名|zh-CN': { text: '产品名称', detectedLanguage: 'ja' },
  });
  const result = await translateUniqueTexts(
    ['卡车车身', 'Truck body', 'Nama Produk', '製品名'],
    provider,
  );

  assert.equal(result.get('卡车车身').value, '卡车车身 / Truck body');
  assert.equal(result.get('Truck body').value, 'Truck body / 卡车车身');
  assert.equal(result.get('Nama Produk').value, 'Nama Produk / 产品名称 / Product Name');
  assert.equal(result.get('製品名').value, '製品名 / 产品名称 / Product Name');
  for (const value of result.values()) assert.equal(value.status, 'translated');
});

test('handles embedded codes, mixed text, and one missing target language', async () => {
  const provider = fakeProvider({
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
    'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
  });
  const input = ['Nama Produk / 产品名称', '卡车车身 / Truck body'];
  const result = await translateUniqueTexts(input, provider);

  assert.equal(analyzeText('产品 47193C').action, 'translate');
  assert.equal(analyzeText('透明胶纸 transparent tape').action, 'translate');
  assert.equal(result.get(input[0]).value, 'Nama Produk / 产品名称 / Product Name');
  assert.equal(result.get(input[1]).status, 'skipped');
});

test('adds only Chinese when English already exists in a later segment', async () => {
  const provider = fakeProvider({
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Product Name|zh-CN': { text: '产品名称', detectedLanguage: 'en' },
    'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
  });
  const input = 'Nama Produk / Product Name';
  const result = await translateUniqueTexts([input], provider);

  assert.deepEqual(result.get(input), {
    status: 'translated',
    value: 'Nama Produk / Product Name / 产品名称',
    reason: 'translated',
  });
  assert.deepEqual(
    provider.calls[0].map(request => request.text),
    ['Nama Produk', 'Product Name'],
  );
  assert.equal(provider.calls.flat().some(request => request.to === 'en'), false);
});

test('adds English when every non-Chinese segment is confirmed non-English', async () => {
  const provider = fakeProvider({
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Deskripsi|zh-CN': { text: '描述', detectedLanguage: 'id' },
    'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
  });
  const input = 'Nama Produk / 产品名称 / Deskripsi';
  const result = await translateUniqueTexts([input], provider);

  assert.deepEqual(result.get(input), {
    status: 'translated',
    value: 'Nama Produk / 产品名称 / Deskripsi / Product Name',
    reason: 'translated',
  });
  assert.deepEqual(
    provider.calls[0].map(request => request.text),
    ['Nama Produk', 'Deskripsi'],
  );
});

test('adds only English when multi-segment Han text already contains Chinese', async () => {
  const provider = fakeProvider({
    '製品名|en': { text: 'Product Name', detectedLanguage: 'ja' },
    '製品名|zh-CN': { text: '产品名称', detectedLanguage: 'ja' },
  });
  const input = '製品名 / 产品名称';
  const result = await translateUniqueTexts([input], provider);

  assert.deepEqual(result.get(input), {
    status: 'translated',
    value: '製品名 / 产品名称 / Product Name',
    reason: 'translated',
  });
  assert.equal(provider.calls.flat().some(request => request.to === 'zh-CN'), false);
});

test('keeps canonical text when one successful detection confirms English', async () => {
  const provider = fakeProvider({
    'Product Name|zh-CN': { text: '产品名称', detectedLanguage: 'en' },
  });
  const input = 'Nama Produk / 产品名称 / Product Name';
  const result = await translateUniqueTexts([input], provider);

  assert.deepEqual(result.get(input), {
    status: 'skipped',
    value: input,
    reason: 'already-complete',
  });
});

test('leaves multi-segment text unchanged when missing English is not confirmed', async () => {
  const provider = fakeProvider({
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
  });
  const input = 'Nama Produk / 产品名称 / Product Name';
  const result = await translateUniqueTexts([input], provider);

  assert.deepEqual(result.get(input), {
    status: 'skipped',
    value: input,
    reason: 'language-unconfirmed',
  });
});

test('deduplicates source text and preserves the complete untrimmed original', async () => {
  const input = '  卡车车身  ';
  const provider = fakeProvider({
    '卡车车身|en': { text: 'Truck body', detectedLanguage: 'zh-CN' },
  });
  const result = await translateUniqueTexts([input, input], provider);

  assert.equal(provider.calls.flat().length, 1);
  assert.equal(result.size, 1);
  assert.equal(result.get(input).value.startsWith(input), true);
  assert.equal(result.get(input).value, '  卡车车身   / Truck body');
});

test('deduplicates repeated language segments across different cells and phases', async () => {
  const provider = fakeProvider({
    'Nama|zh-CN': { text: '名称', detectedLanguage: 'id' },
    'Nama|en': { text: 'Name', detectedLanguage: 'id' },
  });
  const first = 'Nama / 产品';
  const second = 'Nama / 说明';
  const result = await translateUniqueTexts([first, second], provider);

  assert.equal(result.get(first).value, 'Nama / 产品 / Name');
  assert.equal(result.get(second).value, 'Nama / 说明 / Name');
  assert.deepEqual(
    provider.calls.map(call => call.map(request => `${request.text}|${request.to}`)),
    [['Nama|zh-CN'], ['Nama|en']],
  );
});

test('keeps the original when a translation fails or would exceed the Excel cell limit', async () => {
  const tooLong = '中'.repeat(32764);
  const provider = fakeProvider({
    '需要失败|en': { error: 'provider-failed' },
    [`${tooLong}|en`]: { text: 'English', detectedLanguage: 'zh-CN' },
  });
  const result = await translateUniqueTexts(['需要失败', tooLong], provider);

  assert.equal(result.get('需要失败').status, 'failed');
  assert.equal(result.get('需要失败').value, '需要失败');
  assert.equal(result.get(tooLong).status, 'failed');
  assert.equal(result.get(tooLong).value, tooLong);
  assert.equal(result.get(tooLong).reason, 'excel-cell-limit');
});
