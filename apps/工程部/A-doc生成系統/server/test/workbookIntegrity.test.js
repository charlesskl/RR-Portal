const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const PizZip = require('pizzip');
const XlsxPopulate = require('xlsx-populate');

const { createWorkbookFixture } = require('./helpers/workbookFixture');
const { translateWorkbook } = require('../utils/excelTranslator');
const {
  assertPackageLimits,
  snapshotWorkbook,
  validateWorkbookIntegrity,
} = require('../utils/workbookIntegrity');

async function fixturePaths(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workbook-integrity-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.xlsx');
  await createWorkbookFixture(inputPath);
  return { directory, inputPath, outputPath: path.join(directory, 'output.xlsx') };
}

async function mutateZip(inputPath, outputPath, mutate) {
  const zip = new PizZip(await fs.readFile(inputPath));
  await mutate(zip);
  await fs.writeFile(outputPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function isIntegrityCode(code) {
  return error => error.name === 'WorkbookIntegrityError' && error.code === code;
}

test('rejects oversized and invalid OOXML packages', async t => {
  const { directory, inputPath } = await fixturePaths(t);
  await assert.rejects(
    () => assertPackageLimits(inputPath, { maxUncompressedBytes: 1 }),
    isIntegrityCode('package_too_large'),
  );

  const invalidPath = path.join(directory, 'not-a-workbook.xlsx');
  await fs.writeFile(invalidPath, 'plain text');
  await assert.rejects(
    () => assertPackageLimits(invalidPath),
    isIntegrityCode('invalid_ooxml_package'),
  );
});

test('rejects deletion of a protected relationship part', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  await mutateZip(inputPath, outputPath, zip => {
    zip.remove('_rels/.rels');
  });

  await assert.rejects(
    () => validateWorkbookIntegrity({ inputPath, outputPath, changedCells: new Set() }),
    isIntegrityCode('protected_part_set_changed'),
  );
});

test('rejects an internal relationship whose target part is missing', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  await mutateZip(inputPath, outputPath, zip => {
    zip.remove('xl/sharedStrings.xml');
  });

  await assert.rejects(
    () => validateWorkbookIntegrity({ inputPath, outputPath, changedCells: new Set() }),
    isIntegrityCode('relationship_target_missing'),
  );
});

test('rejects an unexpected non-target cell value change', async t => {
  const { inputPath, outputPath } = await fixturePaths(t);
  const workbook = await XlsxPopulate.fromFileAsync(inputPath);
  workbook.sheet('Visible').cell('F1').value(43);
  await workbook.toFileAsync(outputPath);

  await assert.rejects(
    () => validateWorkbookIntegrity({
      inputPath,
      outputPath,
      changedCells: new Set(['Visible!A1']),
    }),
    isIntegrityCode('unexpected_cell_change'),
  );
});

test('rejects formula and merge changes', async t => {
  const { directory, inputPath } = await fixturePaths(t);
  const formulaPath = path.join(directory, 'formula.xlsx');
  const formulaWorkbook = await XlsxPopulate.fromFileAsync(inputPath);
  formulaWorkbook.sheet('Visible').cell('A2').formula('LEN(A1)+1');
  await formulaWorkbook.toFileAsync(formulaPath);
  await assert.rejects(
    () => validateWorkbookIntegrity({ inputPath, outputPath: formulaPath, changedCells: new Set() }),
    isIntegrityCode('formula_changed'),
  );

  const mergePath = path.join(directory, 'merge.xlsx');
  const mergeWorkbook = await XlsxPopulate.fromFileAsync(inputPath);
  mergeWorkbook.sheet('Visible').range('B1:C1').merged(false);
  await mergeWorkbook.toFileAsync(mergePath);
  await assert.rejects(
    () => validateWorkbookIntegrity({ inputPath, outputPath: mergePath, changedCells: new Set() }),
    isIntegrityCode('merge_changed'),
  );
});

test('rejects number-format semantics changes but accepts attribute reordering', async t => {
  const { directory, inputPath } = await fixturePaths(t);
  const changedPath = path.join(directory, 'changed-style.xlsx');
  const workbook = await XlsxPopulate.fromFileAsync(inputPath);
  workbook.sheet('Visible').cell('A1').style('numberFormat', '0.00');
  await workbook.toFileAsync(changedPath);
  await assert.rejects(
    () => validateWorkbookIntegrity({ inputPath, outputPath: changedPath, changedCells: new Set() }),
    isIntegrityCode('styles_changed'),
  );

  const reorderedPath = path.join(directory, 'reordered-style.xlsx');
  await mutateZip(inputPath, reorderedPath, zip => {
    const styles = zip.file('xl/styles.xml').asText();
    const reordered = styles.replace(/<xf\s+([^>]+?)(\/?)>/, (tag, attributes, slash) => {
      const pairs = attributes.match(/[\w:.-]+="[^"]*"/g);
      if (!pairs || pairs.length < 2) return tag;
      return `<xf ${pairs.reverse().join(' ')}${slash}>`;
    });
    assert.notEqual(reordered, styles);
    zip.file('xl/styles.xml', reordered);
  });
  await validateWorkbookIntegrity({
    inputPath,
    outputPath: reorderedPath,
    changedCells: new Set(),
  });
});

test('accepts xlsx-populate adding an empty semantic numFmts collection', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-num-fmts-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.xlsx');
  const inputPath = path.join(directory, 'input.xlsx');
  const outputPath = path.join(directory, 'output.xlsx');
  const workbook = await XlsxPopulate.fromBlankAsync();
  workbook.sheet(0).name('Visible').cell('A1').value('卡车车身');
  await workbook.toFileAsync(sourcePath);

  await mutateZip(sourcePath, inputPath, zip => {
    const styles = zip.file('xl/styles.xml').asText();
    const withoutEmptyNumberFormats = styles.replace(
      /<numFmts(?:\s+count="0")?\s*\/>/,
      '',
    );
    assert.notEqual(withoutEmptyNumberFormats, styles);
    zip.file('xl/styles.xml', withoutEmptyNumberFormats);
  });

  const provider = {
    async translateMany(requests) {
      return new Map(requests.map(request => [request.id, {
        text: 'Truck body',
        detectedLanguage: 'zh-CN',
      }]));
    },
  };
  const summary = await translateWorkbook(inputPath, outputPath, { provider });
  assert.equal(summary.changedCells.has('Visible!A1'), true);
});

test('round-trips a calc chain referenced by workbook relationships', async t => {
  const { directory, inputPath, outputPath } = await fixturePaths(t);
  const calcInputPath = path.join(directory, 'with-calc-chain.xlsx');
  const calcChain = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<c r="A2" i="1"/>'
    + '</calcChain>',
  );
  await mutateZip(inputPath, calcInputPath, zip => {
    zip.file('xl/calcChain.xml', calcChain);
    const relationships = zip.file('xl/_rels/workbook.xml.rels').asText();
    zip.file('xl/_rels/workbook.xml.rels', relationships.replace(
      '</Relationships>',
      '<Relationship Id="rIdCalcChain" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" '
      + 'Target="calcChain.xml"/></Relationships>',
    ));
    const contentTypes = zip.file('[Content_Types].xml').asText();
    zip.file('[Content_Types].xml', contentTypes.replace(
      '</Types>',
      '<Override PartName="/xl/calcChain.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>'
      + '</Types>',
    ));
  });

  const provider = {
    async translateMany(requests) {
      return new Map(requests.map(request => [request.id, {
        text: request.to === 'en' ? 'English translation' : '中文翻译',
        detectedLanguage: request.to === 'en' ? 'zh-CN' : 'en',
      }]));
    },
  };
  await translateWorkbook(calcInputPath, outputPath, { provider });
  const output = new PizZip(await fs.readFile(outputPath));
  assert.deepEqual(
    Buffer.from(output.file('xl/calcChain.xml').asUint8Array()),
    calcChain,
  );
});

test('rejects loss of a default VBA content-type declaration', async t => {
  const { directory, inputPath, outputPath } = await fixturePaths(t);
  const macroInputPath = path.join(directory, 'macro-declaration.xlsx');
  const declaration = '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>';
  await mutateZip(inputPath, macroInputPath, zip => {
    const contentTypes = zip.file('[Content_Types].xml').asText();
    zip.file('[Content_Types].xml', contentTypes.replace('</Types>', `${declaration}</Types>`));
  });
  await mutateZip(macroInputPath, outputPath, zip => {
    const contentTypes = zip.file('[Content_Types].xml').asText();
    zip.file('[Content_Types].xml', contentTypes.replace(declaration, ''));
  });

  await assert.rejects(
    () => validateWorkbookIntegrity({
      inputPath: macroInputPath,
      outputPath,
      changedCells: new Set(),
    }),
    isIntegrityCode('macro_container_changed'),
  );
});

test('round-trips the repository macro-enabled template with its VML relationships', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xlsm-integrity-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(__dirname, '../templates/走货明细模表.xlsm');
  const outputPath = path.join(directory, 'translated.xlsm');
  const provider = {
    async translateMany(requests) {
      return new Map(requests.map(request => [request.id, {
        text: request.to === 'en' ? 'English translation' : '中文翻译',
        detectedLanguage: request.to === 'en' ? 'zh-CN' : 'en',
      }]));
    },
  };

  const summary = await translateWorkbook(inputPath, outputPath, { provider });
  const snapshot = await snapshotWorkbook(outputPath);
  assert.equal(snapshot.macro.macroWorkbook, true);
  assert.ok(summary.changedCells instanceof Set);
  await validateWorkbookIntegrity({
    inputPath,
    outputPath,
    changedCells: summary.changedCells,
  });
});
