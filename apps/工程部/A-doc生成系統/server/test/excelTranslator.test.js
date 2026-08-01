const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const PizZip = require('pizzip');
const XlsxPopulate = require('xlsx-populate');

const { createWorkbookFixture } = require('./helpers/workbookFixture');
const { scanWorkbook, translateWorkbook } = require('../utils/excelTranslator');
const { assertPackageLimits } = require('../utils/workbookIntegrity');

const TRANSLATIONS = {
  '卡车车身|en': { text: 'Truck body', detectedLanguage: 'zh-CN' },
  'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
  'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
  'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
  '产品 47193C|en': { text: 'Product 47193C', detectedLanguage: 'zh-CN' },
  'Product 47193C|zh-CN': { text: '产品 47193C', detectedLanguage: 'en' },
  '产品名称|en': { text: 'Product Name', detectedLanguage: 'zh-CN' },
};

function fakeProvider({ failTexts = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    async translateMany(requests) {
      calls.push(requests.map(request => ({ ...request })));
      const responses = new Map();
      for (const request of requests) {
        if (failTexts.has(request.text)) {
          responses.set(request.id, { error: 'translation_failed' });
          continue;
        }
        const translated = TRANSLATIONS[`${request.text}|${request.to}`];
        if (translated) responses.set(request.id, { ...translated });
      }
      return responses;
    },
  };
}

function visibleRichText(rich) {
  let value = '';
  for (let index = 0; index < rich.length; index += 1) {
    value += String(rich.get(index).value() ?? '');
  }
  return value;
}

async function fixturePaths(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-translator-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.xlsx');
  await createWorkbookFixture(inputPath);
  return {
    directory,
    inputPath,
    outputPath: path.join(directory, 'output.xlsx'),
  };
}

test('scans every visible and hidden sheet but skips formulas and non-text', async t => {
  const { inputPath } = await fixturePaths(t);
  const visited = [];
  const summary = await scanWorkbook(inputPath, {
    onSheet: progress => visited.push(progress.sheetName),
  });

  assert.deepEqual(summary, {
    sheetCount: 3,
    formulaCount: 1,
    candidateCellCount: 5,
    candidateUniqueCount: 4,
  });
  assert.deepEqual(visited, ['Visible', 'Hidden', 'VeryHidden']);
});

test('writes translations without flattening rich text or changing formulas', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  const progressEvents = [];
  const summary = await translateWorkbook(inputPath, outputPath, {
    provider: fakeProvider(),
    onProgress: event => progressEvents.push(event),
  });
  const output = await XlsxPopulate.fromFileAsync(outputPath);

  assert.equal(output.sheet('Visible').cell('A1').value(), '卡车车身 / Truck body');
  assert.equal(output.sheet('Visible').cell('A1').style('bold'), true);
  assert.equal(output.sheet('Visible').cell('A2').formula(), 'LEN(A1)');
  assert.equal(output.sheet('Hidden').cell('A1').value(), 'Truck body / 卡车车身');
  assert.equal(output.sheet('Hidden').hidden(), true);
  assert.equal(output.sheet('VeryHidden').hidden(), 'very');

  const rich = output.sheet('Visible').cell('D1').value();
  assert.ok(rich instanceof XlsxPopulate.RichText);
  assert.equal(rich.get(0).style('bold'), true);
  assert.equal(rich.get(1).style('italic'), true);
  assert.match(rich.text(), /^Nama Produk \/ 产品名称 \/ Product Name$/);
  assert.equal(rich.get(rich.length - 1).style('italic'), true);

  assert.equal(summary.succeededCells, 5);
  assert.equal(summary.failedCells, 0);
  assert.equal(summary.skippedCells, 0);
  assert.equal(summary.totalUnique, 4);
  assert.equal(summary.processedUnique, 4);
  assert.equal(summary.changedCells.size, 5);
  assert.ok(summary.changedCells.has('Visible!D1'));
  const serializedProgress = JSON.stringify(progressEvents);
  assert.equal(serializedProgress.includes('卡车车身'), false);
  assert.equal(serializedProgress.includes('Nama Produk'), false);
});

test('a second pass is idempotent', async t => {
  const { directory, inputPath, outputPath } = await fixturePaths(t);
  const secondOutputPath = path.join(directory, 'second.xlsx');
  await translateWorkbook(inputPath, outputPath, { provider: fakeProvider() });
  const second = await translateWorkbook(outputPath, secondOutputPath, { provider: fakeProvider() });
  const firstWorkbook = await XlsxPopulate.fromFileAsync(outputPath);
  const secondWorkbook = await XlsxPopulate.fromFileAsync(secondOutputPath);

  for (const [sheetName, address] of [
    ['Visible', 'A1'],
    ['Visible', 'B1'],
    ['Visible', 'D1'],
    ['Hidden', 'A1'],
    ['VeryHidden', 'A1'],
  ]) {
    const firstValue = firstWorkbook.sheet(sheetName).cell(address).value();
    const secondValue = secondWorkbook.sheet(sheetName).cell(address).value();
    const firstText = firstValue instanceof XlsxPopulate.RichText ? firstValue.text() : firstValue;
    const secondText = secondValue instanceof XlsxPopulate.RichText ? secondValue.text() : secondValue;
    assert.equal(secondText, firstText, `${sheetName}!${address}`);
  }
  assert.equal(second.changedCells.size, 0);
  assert.equal(second.failedCells, 0);
});

test('continues after one unique text fails and keeps that cell unchanged', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  const provider = fakeProvider({ failTexts: new Set(['Truck body']) });
  const summary = await translateWorkbook(inputPath, outputPath, { provider });
  const output = await XlsxPopulate.fromFileAsync(outputPath);

  assert.equal(output.sheet('Hidden').cell('A1').value(), 'Truck body');
  assert.equal(output.sheet('Visible').cell('A1').value(), '卡车车身 / Truck body');
  assert.equal(summary.failedCells, 1);
  assert.equal(summary.succeededCells, 4);
  assert.equal(summary.changedCells.size, 4);
});

test('rich text suffix inherits the last nonempty fragment style', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  const workbook = await XlsxPopulate.fromFileAsync(inputPath);
  const rich = new XlsxPopulate.RichText()
    .add('产品名称', { bold: true, superscript: true, fontColor: 'FFFF0000' })
    .add('', { italic: true, fontColor: 'FF0000FF' });
  workbook.sheet('Visible').cell('G1').value(rich);
  await workbook.toFileAsync(inputPath);

  await translateWorkbook(inputPath, outputPath, { provider: fakeProvider() });
  const output = await XlsxPopulate.fromFileAsync(outputPath);
  const translated = output.sheet('Visible').cell('G1').value();
  const suffix = translated.get(translated.length - 1);

  assert.equal(visibleRichText(translated), '产品名称 / Product Name');
  assert.equal(suffix.style('bold'), true);
  assert.equal(suffix.style('superscript'), true);
  assert.deepEqual(suffix.style('fontColor'), { rgb: 'FFFF0000' });
  assert.equal(suffix.style('italic'), false);
});

test('deletes an output that fails the post-write package limit gate', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  const inputSize = await assertPackageLimits(inputPath);

  await assert.rejects(
    () => translateWorkbook(inputPath, outputPath, {
      provider: fakeProvider(),
      maxUncompressedBytes: inputSize.uncompressedBytes,
    }),
    error => error.name === 'WorkbookIntegrityError' && error.code === 'package_too_large',
  );
  await assert.rejects(() => fs.stat(outputPath), error => error.code === 'ENOENT');
});

test('accepts xlsx-populate adding an empty semantic sheetPr node', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  const zip = new PizZip(await fs.readFile(inputPath));
  const sheetPart = 'xl/worksheets/sheet1.xml';
  const worksheet = zip.file(sheetPart).asText();
  const withoutEmptySheetProperties = worksheet.replace(/<sheetPr\s*\/>/, '');
  assert.notEqual(withoutEmptySheetProperties, worksheet);
  zip.file(sheetPart, withoutEmptySheetProperties);
  await fs.writeFile(inputPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const summary = await translateWorkbook(inputPath, outputPath, { provider: fakeProvider() });
  assert.equal(summary.failedCells, 0);
  await fs.stat(outputPath);
});
