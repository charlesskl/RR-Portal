const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const { translateWorkbook } = require('../utils/excelTranslator');
const { snapshotWorkbook, validateWorkbookIntegrity } = require('../utils/workbookIntegrity');

const goldenXlsx = process.env.GOLDEN_XLSX;
const macroXlsm = process.env.MACRO_XLSM;
const outputRoot = '/tmp/zouhuo-translation-verification';

function deterministicProvider() {
  return {
    async translateMany(requests) {
      return new Map(requests.map(request => {
        const toEnglish = request.to === 'en';
        return [request.id, {
          text: toEnglish ? 'English translation' : '中文翻译',
          detectedLanguage: toEnglish ? 'zh-CN' : 'en',
        }];
      }));
    },
  };
}

function protectedEntries(snapshot, pattern) {
  return [...snapshot.protectedParts.entries()]
    .filter(([name]) => pattern.test(name))
    .sort(([left], [right]) => left.localeCompare(right));
}

async function runGoldenXlsxGate() {
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, '29-sheet_中英翻译.xlsx');
  const secondPath = path.join(outputRoot, '29-sheet_中英翻译_二次.xlsx');
  const provider = deterministicProvider();
  const inputSnapshot = await snapshotWorkbook(goldenXlsx);
  assert.equal(inputSnapshot.sheetMetadata.length, 29);

  const summary = await translateWorkbook(goldenXlsx, outputPath, { provider });
  const outputSnapshot = await snapshotWorkbook(outputPath);
  assert.deepEqual(outputSnapshot.sheetMetadata, inputSnapshot.sheetMetadata);
  await validateWorkbookIntegrity({
    inputPath: goldenXlsx,
    outputPath,
    changedCells: summary.changedCells,
  });

  const second = await translateWorkbook(outputPath, secondPath, { provider });
  assert.equal(second.changedCells.size, 0);
  await validateWorkbookIntegrity({
    inputPath: outputPath,
    outputPath: secondPath,
    changedCells: second.changedCells,
  });
  console.log(JSON.stringify({
    gate: 'golden_xlsx',
    sheetCount: summary.sheetCount,
    formulaCount: summary.formulaCount,
    candidateCellCount: summary.candidateCellCount,
    succeededCells: summary.succeededCells,
    failedCells: summary.failedCells,
    outputPath,
  }));
}

async function runMacroXlsmGate() {
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, 'macro_中英翻译.xlsm');
  const secondPath = path.join(outputRoot, 'macro_中英翻译_二次.xlsm');
  const provider = deterministicProvider();
  const inputSnapshot = await snapshotWorkbook(macroXlsm);
  assert.equal(inputSnapshot.macro.macroWorkbook, true);
  const inputVba = protectedEntries(inputSnapshot, /^xl\/vbaProject.*\.bin$/);
  assert.ok(inputVba.length > 0);
  assert.ok(protectedEntries(inputSnapshot, /^xl\/media\//).length > 0);
  assert.ok(protectedEntries(inputSnapshot, /^xl\/charts\//).length > 0);
  assert.ok(protectedEntries(inputSnapshot, /_rels\/.*\.rels$/).length > 0);

  const summary = await translateWorkbook(macroXlsm, outputPath, { provider });
  const outputSnapshot = await snapshotWorkbook(outputPath);
  assert.deepEqual(outputSnapshot.macro, inputSnapshot.macro);
  assert.deepEqual(protectedEntries(outputSnapshot, /^xl\/vbaProject.*\.bin$/), inputVba);
  assert.deepEqual(
    [...outputSnapshot.protectedParts.entries()],
    [...inputSnapshot.protectedParts.entries()],
  );
  await validateWorkbookIntegrity({
    inputPath: macroXlsm,
    outputPath,
    changedCells: summary.changedCells,
  });

  const second = await translateWorkbook(outputPath, secondPath, { provider });
  assert.equal(second.changedCells.size, 0);
  console.log(JSON.stringify({
    gate: 'macro_xlsm',
    sheetCount: summary.sheetCount,
    formulaCount: summary.formulaCount,
    candidateCellCount: summary.candidateCellCount,
    succeededCells: summary.succeededCells,
    failedCells: summary.failedCells,
    outputPath,
  }));
}

test('29-sheet golden workbook round trip', { skip: !goldenXlsx }, runGoldenXlsxGate);
test('macro workbook round trip', { skip: !macroXlsm }, runMacroXlsmGate);

module.exports = { runGoldenXlsxGate, runMacroXlsmGate };
