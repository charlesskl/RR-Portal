const fs = require('node:fs/promises');
const path = require('node:path');
const XlsxPopulate = require('xlsx-populate');

const { analyzeText, translateUniqueTexts } = require('./translationRules');
const {
  loadWorkbookForProcessing,
  restoreProtectedParts,
  validateWorkbookIntegrity,
} = require('./workbookIntegrity');

const RICH_STYLES = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'subscript',
  'superscript',
  'fontSize',
  'fontFamily',
  'fontGenericFamily',
  'fontScheme',
  'fontColor',
];

function richTextContent(rich) {
  let text = '';
  for (let index = 0; index < rich.length; index += 1) {
    text += String(rich.get(index).value() ?? '');
  }
  return text;
}

function textFromValue(value) {
  if (typeof value === 'string') return value;
  if (value instanceof XlsxPopulate.RichText) return richTextContent(value);
  return undefined;
}

function collectWorkbookCells(workbook, { onSheet } = {}) {
  const sheets = workbook.sheets();
  const cells = [];
  let formulaCount = 0;

  sheets.forEach((sheet, sheetIndex) => {
    if (onSheet) {
      onSheet({
        sheetName: sheet.name(),
        sheetIndex,
        sheetCount: sheets.length,
      });
    }
    const existingCells = [];
    (sheet._rows || []).forEach(row => {
      if (!row) return;
      (row._cells || []).forEach(cell => {
        if (cell) existingCells.push(cell);
      });
    });

    if (!existingCells.length) return;
    existingCells.forEach(cell => {
      const formula = cell.formula();
      if (formula !== undefined && formula !== null) {
        formulaCount += 1;
        return;
      }

      const value = cell.value();
      const text = textFromValue(value);
      if (text === undefined) return;
      if (analyzeText(text).action !== 'translate') return;
      cells.push({
        sheet,
        cell,
        text,
        richText: value instanceof XlsxPopulate.RichText,
        address: `${sheet.name()}!${cell.address()}`,
      });
    });
  });

  return {
    sheetCount: sheets.length,
    formulaCount,
    cells,
  };
}

async function scanWorkbook(inputPath, { onSheet, maxUncompressedBytes } = {}) {
  const workbook = await loadWorkbookForProcessing(inputPath, {
    maxUncompressedBytes,
    expectedExtension: path.extname(inputPath).toLowerCase(),
  });
  const collected = collectWorkbookCells(workbook, { onSheet });
  return {
    sheetCount: collected.sheetCount,
    formulaCount: collected.formulaCount,
    candidateCellCount: collected.cells.length,
    candidateUniqueCount: new Set(collected.cells.map(item => item.text)).size,
  };
}

function appendRichText(cell, originalText, translatedText) {
  const rich = cell.value();
  const suffix = translatedText.slice(originalText.length);
  let styleSource;
  for (let index = rich.length - 1; index >= 0; index -= 1) {
    const fragment = rich.get(index);
    if (String(fragment.value() ?? '').trim()) {
      styleSource = fragment;
      break;
    }
  }
  if (!styleSource) throw new Error('rich_text_has_no_nonempty_fragment');
  rich.add(suffix, styleSource.style(RICH_STYLES));
}

async function translateWorkbookCore(workbook, outputPath, { provider, onProgress } = {}) {
  const collected = collectWorkbookCells(workbook, {
    onSheet: sheetProgress => {
      if (onProgress) onProgress({ phase: 'scanning', ...sheetProgress });
    },
  });
  const uniqueTexts = [...new Set(collected.cells.map(item => item.text))];

  if (onProgress) {
    onProgress({
      phase: 'translating',
      totalUnique: uniqueTexts.length,
      processedUnique: 0,
    });
  }
  const outcomes = await translateUniqueTexts(uniqueTexts, provider);
  if (onProgress) {
    onProgress({
      phase: 'translating',
      totalUnique: uniqueTexts.length,
      processedUnique: outcomes.size,
    });
  }

  let succeededCells = 0;
  let skippedCells = 0;
  let failedCells = 0;
  const changedCells = new Set();

  for (const item of collected.cells) {
    const translated = outcomes.get(item.text);
    if (!translated || translated.status === 'failed') {
      failedCells += 1;
      continue;
    }
    if (translated.status === 'skipped') {
      skippedCells += 1;
      continue;
    }

    try {
      if (item.richText) {
        const backup = item.cell.value().copy();
        try {
          appendRichText(item.cell, item.text, translated.value);
        } catch (error) {
          item.cell.value(backup);
          throw error;
        }
      } else {
        item.cell.value(translated.value);
      }
      succeededCells += 1;
      changedCells.add(item.address);
    } catch {
      failedCells += 1;
    }

    if (onProgress) {
      onProgress({
        phase: 'writing',
        sheetName: item.sheet.name(),
        processedCells: succeededCells + skippedCells + failedCells,
        candidateCellCount: collected.cells.length,
      });
    }
  }

  await workbook.toFileAsync(outputPath);
  return {
    sheetCount: collected.sheetCount,
    formulaCount: collected.formulaCount,
    candidateCellCount: collected.cells.length,
    candidateUniqueCount: uniqueTexts.length,
    totalUnique: uniqueTexts.length,
    processedUnique: outcomes.size,
    succeededCells,
    skippedCells,
    failedCells,
    changedCells,
  };
}

async function translateWorkbook(inputPath, outputPath, options = {}) {
  const { maxUncompressedBytes } = options;
  try {
    const workbook = await loadWorkbookForProcessing(inputPath, {
      maxUncompressedBytes,
      expectedExtension: path.extname(inputPath).toLowerCase(),
    });
    const summary = await translateWorkbookCore(workbook, outputPath, options);
    await restoreProtectedParts(inputPath, outputPath);
    if (options.onProgress) options.onProgress({ phase: 'validating' });
    await validateWorkbookIntegrity({
      inputPath,
      outputPath,
      changedCells: summary.changedCells,
      maxUncompressedBytes,
    });
    return summary;
  } catch (error) {
    await fs.unlink(outputPath).catch(() => {});
    throw error;
  }
}

module.exports = {
  RICH_STYLES,
  scanWorkbook,
  translateWorkbook,
};
