const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const PizZip = require('pizzip');
const XlsxPopulate = require('xlsx-populate');

const { translateWorkbook } = require('../utils/excelTranslator');
const {
  assertPackageLimits,
  snapshotWorkbook,
  validateWorkbookIntegrity,
} = require('../utils/workbookIntegrity');

const execFileAsync = promisify(execFile);
const ONE_MIB = 1024 * 1024;
const TWO_MIB = 2 * ONE_MIB;
const VBA_PART = 'xl/Macros/VbAProject.BIN';
const XLSX_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const XLSM_WORKBOOK_CONTENT_TYPE =
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const XLTX_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml';
const XLTM_WORKBOOK_CONTENT_TYPE =
  'application/vnd.ms-excel.template.macroEnabled.main+xml';
const SHARED_STRINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';

function isIntegrityCode(code) {
  return error => error.name === 'WorkbookIntegrityError' && error.code === code;
}

async function temporaryPaths(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory };
}

async function createWorkbook(filePath, values = ['卡车车身']) {
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet(0).name('Visible');
  values.forEach((value, index) => sheet.cell(1, index + 1).value(value));
  await workbook.toFileAsync(filePath);
}

async function mutatePackage(inputPath, outputPath, mutate) {
  const zip = new PizZip(await fs.readFile(inputPath));
  await mutate(zip);
  await fs.writeFile(outputPath, zip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  }));
}

function xmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escapedName}=(['"])(.*?)\\1`, 'i'));
  return match && match[2];
}

function xmlTags(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*\\/?\\s*>`, 'gi'))]
    .map(match => match[0]);
}

function removeXmlTags(xml, name, predicate) {
  let removed = 0;
  const output = xml.replace(
    new RegExp(`<${name}\\b[^>]*\\/\\s*>`, 'gi'),
    tag => {
      if (!predicate(tag)) return tag;
      removed += 1;
      return '';
    },
  );
  return { output, removed };
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return {
        offset,
        entryCount: buffer.readUInt16LE(offset + 10),
        centralSize: buffer.readUInt32LE(offset + 12),
        centralOffset: buffer.readUInt32LE(offset + 16),
      };
    }
  }
  throw new Error('zip_eocd_not_found');
}

function centralDirectoryRecords(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const records = [];
  const endOffset = eocd.centralOffset + eocd.centralSize;
  let offset = eocd.centralOffset;
  while (offset < endOffset) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'central directory signature');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, 'local header signature');
    records.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      centralOffset: offset,
      localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset, 'central directory byte length');
  return { eocd, records };
}

function zipRecord(buffer, name) {
  const record = centralDirectoryRecords(buffer).records.find(item => item.name === name);
  assert.ok(record, `ZIP entry ${name}`);
  return record;
}

function translationProvider() {
  return {
    async translateMany(requests) {
      return new Map(requests.map(request => [request.id, {
        text: request.to === 'en' ? 'Truck body' : '卡车车身',
        detectedLanguage: request.to === 'en' ? 'zh-CN' : 'en',
      }]));
    },
  };
}

function enableMacroContainer(zip) {
  let contentTypes = zip.file('[Content_Types].xml').asText();
  const workbookOverride = xmlTags(contentTypes, 'Override').find(
    tag => xmlAttribute(tag, 'PartName') === '/xl/workbook.xml',
  );
  assert.ok(workbookOverride, 'workbook Content-Type override');
  assert.equal(xmlAttribute(workbookOverride, 'ContentType'), XLSX_WORKBOOK_CONTENT_TYPE);
  contentTypes = contentTypes.replace(
    workbookOverride,
    workbookOverride.replace(
      /\bContentType=(['"])[^'"]*\1/,
      `ContentType="${XLSM_WORKBOOK_CONTENT_TYPE}"`,
    ),
  );
  contentTypes = contentTypes.replace(
    '</Types>',
    `<Override PartName="/${VBA_PART}" `
      + 'ContentType="application/vnd.ms-office.vbaProject"/></Types>',
  );
  zip.file('[Content_Types].xml', contentTypes);

  const relationshipPath = 'xl/_rels/workbook.xml.rels';
  let relationships = zip.file(relationshipPath).asText();
  relationships = relationships.replace(
    '</Relationships>',
    '<Relationship Id="rIdMixedCaseVba" '
      + 'Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" '
      + 'Target="Macros/VbAProject.BIN"/></Relationships>',
  );
  zip.file(relationshipPath, relationships);
  zip.file(VBA_PART, Buffer.from('original-vba-bytes'));
}

function replaceWorkbookContentType(zip, expected, replacement) {
  const contentTypes = zip.file('[Content_Types].xml').asText();
  assert.match(contentTypes, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  zip.file('[Content_Types].xml', contentTypes.replace(expected, replacement));
}

async function createInlineStringWorkbook(filePath) {
  const seedPath = `${filePath}.seed.xlsx`;
  await createWorkbook(seedPath);
  await mutatePackage(seedPath, filePath, zip => {
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    const worksheet = zip.file(worksheetPath).asText();
    const cellPattern = /<c\b(?=[^>]*\br="A1")[^>]*>[\s\S]*?<\/c>/;
    assert.match(worksheet, cellPattern);
    zip.file(worksheetPath, worksheet.replace(
      cellPattern,
      '<c r="A1" t="inlineStr"><is><t>卡车车身</t></is></c>',
    ));

    const relationshipPath = 'xl/_rels/workbook.xml.rels';
    const relationships = removeXmlTags(
      zip.file(relationshipPath).asText(),
      'Relationship',
      tag => String(xmlAttribute(tag, 'Type')).toLowerCase().endsWith('/sharedstrings'),
    );
    assert.equal(relationships.removed, 1);
    zip.file(relationshipPath, relationships.output);

    const contentTypes = removeXmlTags(
      zip.file('[Content_Types].xml').asText(),
      'Override',
      tag => String(xmlAttribute(tag, 'PartName')).toLowerCase() === '/xl/sharedstrings.xml',
    );
    assert.equal(contentTypes.removed, 1);
    zip.file('[Content_Types].xml', contentTypes.output);
    zip.remove('xl/sharedStrings.xml');
  });
  await fs.rm(seedPath, { force: true });
}

async function createSparseWorkbook(filePath) {
  const seedPath = `${filePath}.seed.xlsx`;
  await createWorkbook(seedPath, ['Alpha', 'Omega']);
  await mutatePackage(seedPath, filePath, zip => {
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    let worksheet = zip.file(worksheetPath).asText();
    const cell = address => {
      const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = worksheet.match(
        new RegExp(`<c\\b(?=[^>]*\\br="${escaped}")[^>]*>[\\s\\S]*?<\\/c>`),
      );
      assert.ok(match, `worksheet cell ${address}`);
      return match[0];
    };
    const first = cell('A1');
    const last = cell('B1').replace(/\br="B1"/, 'r="XFD1048576"');
    const sheetData = '<sheetData>'
      + `<row r="1">${first}</row>`
      + `<row r="1048576">${last}</row>`
      + '</sheetData>';
    const withSparseData = worksheet.replace(
      /<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,
      sheetData,
    );
    assert.notEqual(withSparseData, worksheet);
    worksheet = withSparseData;
    const withSparseDimension = /<dimension\b/.test(worksheet)
      ? worksheet.replace(
        /<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/,
        '<dimension ref="A1:XFD1048576"/>',
      )
      : worksheet.replace(
        /(<worksheet\b[^>]*>)/,
        '$1<dimension ref="A1:XFD1048576"/>',
      );
    assert.notEqual(withSparseDimension, worksheet);
    zip.file(worksheetPath, withSparseDimension);
  });
  await fs.rm(seedPath, { force: true });
}

test('rejects a forged central size that hides a 2 MiB entry from a 1 MiB limit', async t => {
  const { directory } = await temporaryPaths(t, 'forged-workbook-zip-');
  const inputPath = path.join(directory, 'padded.xlsx');
  const forgedPath = path.join(directory, 'forged.xlsx');
  const seedPath = path.join(directory, 'seed.xlsx');
  await createWorkbook(seedPath);
  await mutatePackage(seedPath, inputPath, zip => {
    const styles = zip.file('xl/styles.xml').asText();
    assert.ok(Buffer.byteLength(styles) < TWO_MIB);
    const padded = styles.replace(
      '</styleSheet>',
      `${' '.repeat(TWO_MIB - Buffer.byteLength(styles))}</styleSheet>`,
    );
    assert.equal(Buffer.byteLength(padded), TWO_MIB);
    zip.file('xl/styles.xml', padded);
  });

  const forged = Buffer.from(await fs.readFile(inputPath));
  const stylesRecord = zipRecord(forged, 'xl/styles.xml');
  assert.equal(forged.readUInt32LE(stylesRecord.localOffset + 22), TWO_MIB);
  assert.equal(forged.readUInt32LE(stylesRecord.centralOffset + 24), TWO_MIB);
  forged.writeUInt32LE(1, stylesRecord.centralOffset + 24);
  await fs.writeFile(forgedPath, forged);

  await assert.rejects(
    () => assertPackageLimits(forgedPath, { maxUncompressedBytes: ONE_MIB }),
    isIntegrityCode('package_too_large'),
  );
});

test('enforces ZIP entry limits and rejects inconsistent ZIP metadata', async t => {
  const { directory } = await temporaryPaths(t, 'workbook-zip-metadata-');
  const inputPath = path.join(directory, 'input.xlsx');
  await createWorkbook(inputPath);
  const original = await fs.readFile(inputPath);
  const directoryInfo = centralDirectoryRecords(original);
  assert.ok(directoryInfo.records.length > 2);

  await t.test('entry count limit', async () => {
    await assert.rejects(
      () => assertPackageLimits(inputPath, { maxEntryCount: 2 }),
      isIntegrityCode('package_too_large'),
    );
  });

  await t.test('EOCD entry count mismatch', async () => {
    const malformed = Buffer.from(original);
    const declaredCount = directoryInfo.records.length - 1;
    malformed.writeUInt16LE(declaredCount, directoryInfo.eocd.offset + 8);
    malformed.writeUInt16LE(declaredCount, directoryInfo.eocd.offset + 10);
    const malformedPath = path.join(directory, 'entry-count-mismatch.xlsx');
    await fs.writeFile(malformedPath, malformed);
    await assert.rejects(
      () => assertPackageLimits(malformedPath),
      isIntegrityCode('invalid_ooxml_package'),
    );
  });

  await t.test('CRC mismatch', async () => {
    const malformed = Buffer.from(original);
    const record = zipRecord(malformed, 'xl/styles.xml');
    const wrongCrc = (malformed.readUInt32LE(record.centralOffset + 16) ^ 0xffffffff) >>> 0;
    malformed.writeUInt32LE(wrongCrc, record.centralOffset + 16);
    malformed.writeUInt32LE(wrongCrc, record.localOffset + 14);
    const malformedPath = path.join(directory, 'crc-mismatch.xlsx');
    await fs.writeFile(malformedPath, malformed);
    await assert.rejects(
      () => assertPackageLimits(malformedPath),
      isIntegrityCode('invalid_ooxml_package'),
    );
  });

  await t.test('local and central size declaration mismatch', async () => {
    const malformed = Buffer.from(original);
    const record = zipRecord(malformed, 'xl/styles.xml');
    const localSize = malformed.readUInt32LE(record.localOffset + 22);
    malformed.writeUInt32LE(localSize + 1, record.localOffset + 22);
    const malformedPath = path.join(directory, 'size-declaration-mismatch.xlsx');
    await fs.writeFile(malformedPath, malformed);
    await assert.rejects(
      () => assertPackageLimits(malformedPath),
      isIntegrityCode('invalid_ooxml_package'),
    );
  });
});

test('inlineStr translation emits a valid sharedStrings relationship and Content-Type', async t => {
  const { directory } = await temporaryPaths(t, 'inline-string-workbook-');
  const inputPath = path.join(directory, 'inline.xlsx');
  const outputPath = path.join(directory, 'translated.xlsx');
  await createInlineStringWorkbook(inputPath);
  await assertPackageLimits(inputPath, { expectedExtension: '.xlsx' });

  const summary = await translateWorkbook(inputPath, outputPath, {
    provider: translationProvider(),
  });
  assert.equal(summary.changedCells.has('Visible!A1'), true);

  const output = new PizZip(await fs.readFile(outputPath));
  const relationships = xmlTags(
    output.file('xl/_rels/workbook.xml.rels').asText(),
    'Relationship',
  );
  const sharedStringsRelationship = relationships.find(
    tag => String(xmlAttribute(tag, 'Type')).toLowerCase().endsWith('/sharedstrings'),
  );
  assert.ok(sharedStringsRelationship, 'sharedStrings workbook relationship');
  const target = String(xmlAttribute(sharedStringsRelationship, 'Target')).replace(/\\/g, '/');
  const targetPart = target.startsWith('/')
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join('xl', target));
  assert.ok(output.file(targetPart), `sharedStrings target ${targetPart}`);

  const sharedStringsOverride = xmlTags(
    output.file('[Content_Types].xml').asText(),
    'Override',
  ).find(tag => String(xmlAttribute(tag, 'PartName')).toLowerCase() === '/xl/sharedstrings.xml');
  assert.ok(sharedStringsOverride, 'sharedStrings Content-Type override');
  assert.equal(xmlAttribute(sharedStringsOverride, 'ContentType'), SHARED_STRINGS_CONTENT_TYPE);
  await assertPackageLimits(outputPath, { expectedExtension: '.xlsx' });
});

test('rejects a sharedStrings relationship outside the parser-supported standard part', async t => {
  const { directory } = await temporaryPaths(t, 'custom-shared-strings-');
  const inputPath = path.join(directory, 'input.xlsx');
  const customPath = path.join(directory, 'custom-shared-strings.xlsx');
  await createWorkbook(inputPath);
  await mutatePackage(inputPath, customPath, zip => {
    const sharedStrings = Buffer.from(zip.file('xl/sharedStrings.xml').asUint8Array());
    zip.remove('xl/sharedStrings.xml');
    zip.file('xl/strings/custom.xml', sharedStrings);
    zip.file(
      'xl/_rels/workbook.xml.rels',
      zip.file('xl/_rels/workbook.xml.rels').asText()
        .replace('Target="sharedStrings.xml"', 'Target="strings/custom.xml"'),
    );
    zip.file(
      '[Content_Types].xml',
      zip.file('[Content_Types].xml').asText()
        .replace('/xl/sharedStrings.xml', '/xl/strings/custom.xml'),
    );
  });

  await assert.rejects(
    () => assertPackageLimits(customPath, { expectedExtension: '.xlsx' }),
    isIntegrityCode('invalid_ooxml_package'),
  );
});

test('rejects invalid shared-string indexes before workbook loading', async t => {
  const { directory } = await temporaryPaths(t, 'invalid-shared-string-index-');
  const inputPath = path.join(directory, 'input.xlsx');
  await createWorkbook(inputPath);

  const cases = [
    { name: 'index beyond the shared-string table', value: '9999' },
    { name: 'negative index', value: '-1' },
    { name: 'fractional index', value: '0.5' },
    { name: 'leading-zero index', value: '00' },
    { name: 'whitespace-padded index', value: ' 0 ' },
    { name: 'decimal spelling of an integer', value: '0.0' },
    { name: 'missing value', value: null },
  ];

  for (const [index, item] of cases.entries()) {
    await t.test(item.name, async () => {
      const malformedPath = path.join(directory, `malformed-${index}.xlsx`);
      await mutatePackage(inputPath, malformedPath, zip => {
        const worksheetPath = 'xl/worksheets/sheet1.xml';
        const worksheet = zip.file(worksheetPath).asText();
        const replacement = item.value === null ? '' : `<v>${item.value}</v>`;
        const mutated = worksheet.replace(
          /(<c\b(?=[^>]*\br="A1")(?=[^>]*\bt="s")[^>]*>)[\s\S]*?(<\/c>)/,
          `$1${replacement}$2`,
        );
        assert.notEqual(mutated, worksheet);
        zip.file(worksheetPath, mutated);
      });

      await assert.rejects(
        () => assertPackageLimits(malformedPath, { expectedExtension: '.xlsx' }),
        isIntegrityCode('invalid_ooxml_package'),
      );
    });
  }
});

test('accepts and round-trips a worksheet row extension list', async t => {
  const { directory } = await temporaryPaths(t, 'row-extension-list-');
  const seedPath = path.join(directory, 'seed.xlsx');
  const inputPath = path.join(directory, 'input.xlsx');
  const outputPath = path.join(directory, 'translated.xlsx');
  await createWorkbook(seedPath);
  await mutatePackage(seedPath, inputPath, zip => {
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    const worksheet = zip.file(worksheetPath).asText();
    const extension = '<extLst><ext uri="{F6A5EED7-CF5E-4D3E-A23D-6DFE63A92127}">'
      + '<test:payload xmlns:test="urn:zouhuo:test">row-extension-payload'
      + '<![CDATA[row-extension-cdata<>&]]></test:payload>'
      + '</ext></extLst>';
    const mutated = worksheet.replace(
      /(<row\b(?=[^>]*\br="1")[^>]*>[\s\S]*?)(<\/row>)/,
      `$1${extension}$2`,
    );
    assert.notEqual(mutated, worksheet);
    zip.file(worksheetPath, mutated);
  });

  await assertPackageLimits(inputPath, { expectedExtension: '.xlsx' });
  const summary = await translateWorkbook(inputPath, outputPath, {
    provider: translationProvider(),
  });
  assert.equal(summary.changedCells.has('Visible!A1'), true);
  const output = new PizZip(await fs.readFile(outputPath));
  assert.match(
    output.file('xl/worksheets/sheet1.xml').asText(),
    /row-extension-payload/,
  );
  assert.match(
    output.file('xl/worksheets/sheet1.xml').asText(),
    /<!\[CDATA\[row-extension-cdata<>&\]\]>/,
  );

  const tamperedPath = path.join(directory, 'tampered.xlsx');
  await mutatePackage(outputPath, tamperedPath, zip => {
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    zip.file(
      worksheetPath,
      zip.file(worksheetPath).asText().replace(
        'row-extension-cdata<>&',
        'changed-extension-cdata<>&',
      ),
    );
  });
  await assert.rejects(
    () => validateWorkbookIntegrity({
      inputPath,
      outputPath: tamperedPath,
      changedCells: summary.changedCells,
    }),
    isIntegrityCode('dimensions_changed'),
  );
});

test('restores a row extension list when its sanitized row becomes self-closing', async t => {
  const { directory } = await temporaryPaths(t, 'empty-row-extension-list-');
  const seedPath = path.join(directory, 'seed.xlsx');
  const inputPath = path.join(directory, 'input.xlsx');
  const outputPath = path.join(directory, 'translated.xlsx');
  await createWorkbook(seedPath);
  await mutatePackage(seedPath, inputPath, zip => {
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    const worksheet = zip.file(worksheetPath).asText();
    const extension = '<extLst><ext uri="{1C12BDD8-5E3C-4B1E-8C60-487AF0B58E50}">'
      + '<test:payload xmlns:test="urn:zouhuo:test"><![CDATA[empty-row-cdata]]>'
      + '</test:payload></ext></extLst>';
    const mutated = worksheet.replace(
      /(<row\b(?=[^>]*\br="1")[^>]*>)[\s\S]*?(<\/row>)/,
      `$1${extension}$2`,
    );
    assert.notEqual(mutated, worksheet);
    zip.file(worksheetPath, mutated);
  });

  await assertPackageLimits(inputPath, { expectedExtension: '.xlsx' });
  const summary = await translateWorkbook(inputPath, outputPath, {
    provider: translationProvider(),
  });
  assert.equal(summary.candidateCellCount, 0);
  const worksheet = new PizZip(await fs.readFile(outputPath))
    .file('xl/worksheets/sheet1.xml')
    .asText();
  assert.match(worksheet, /<row\b[^>]*\br="1"[^>]*>\s*<extLst>/);
  assert.match(worksheet, /<!\[CDATA\[empty-row-cdata\]\]>/);
});

test('translates sheets whose workbook order differs from worksheet part numbering', async t => {
  const { directory } = await temporaryPaths(t, 'reordered-workbook-sheets-');
  const seedPath = path.join(directory, 'seed.xlsx');
  const inputPath = path.join(directory, 'input.xlsx');
  const outputPath = path.join(directory, 'translated.xlsx');
  const workbook = await XlsxPopulate.fromBlankAsync();
  workbook.sheet(0).name('First').cell('A1').value('卡车车身');
  workbook.addSheet('Second').cell('A1').value('卡车车身');
  await workbook.toFileAsync(seedPath);
  await mutatePackage(seedPath, inputPath, zip => {
    const workbookPath = 'xl/workbook.xml';
    const workbookXml = zip.file(workbookPath).asText();
    const sheetsMatch = workbookXml.match(/<sheets\b[^>]*>([\s\S]*?)<\/sheets>/);
    assert.ok(sheetsMatch, 'workbook sheets');
    const sheets = xmlTags(sheetsMatch[1], 'sheet');
    assert.equal(sheets.length, 2);
    zip.file(
      workbookPath,
      workbookXml.replace(sheetsMatch[1], [...sheets].reverse().join('')),
    );
  });

  await assertPackageLimits(inputPath, { expectedExtension: '.xlsx' });
  const summary = await translateWorkbook(inputPath, outputPath, {
    provider: translationProvider(),
  });
  assert.deepEqual(
    [...summary.changedCells].sort(),
    ['First!A1', 'Second!A1'],
  );
  const outputSnapshot = await snapshotWorkbook(outputPath);
  assert.deepEqual(outputSnapshot.sheets.map(sheet => sheet.name), ['Second', 'First']);
  for (const sheet of outputSnapshot.sheets) {
    assert.deepEqual(sheet.values[0], [
      'A1',
      { kind: 'string', value: '卡车车身 / Truck body' },
    ]);
  }
  const inputZip = new PizZip(await fs.readFile(inputPath));
  const outputZip = new PizZip(await fs.readFile(outputPath));
  assert.equal(
    outputZip.file('xl/workbook.xml').asText(),
    inputZip.file('xl/workbook.xml').asText(),
  );
});

test('rejects duplicate worksheet row and cell coordinates', async t => {
  const { directory } = await temporaryPaths(t, 'duplicate-worksheet-coordinates-');
  const inputPath = path.join(directory, 'input.xlsx');
  await createWorkbook(inputPath);

  const cases = [
    {
      name: 'duplicate row reference',
      mutate(worksheet) {
        const row = worksheet.match(/<row\b(?=[^>]*\br="1")[^>]*>[\s\S]*?<\/row>/)?.[0];
        assert.ok(row, 'worksheet row 1');
        return worksheet.replace('</sheetData>', `${row}</sheetData>`);
      },
    },
    {
      name: 'duplicate cell reference',
      mutate(worksheet) {
        const cell = worksheet.match(/<c\b(?=[^>]*\br="A1")[^>]*>[\s\S]*?<\/c>/)?.[0];
        assert.ok(cell, 'worksheet cell A1');
        return worksheet.replace(cell, `${cell}${cell}`);
      },
    },
  ];

  for (const [index, item] of cases.entries()) {
    await t.test(item.name, async () => {
      const malformedPath = path.join(directory, `malformed-${index}.xlsx`);
      await mutatePackage(inputPath, malformedPath, zip => {
        const worksheetPath = 'xl/worksheets/sheet1.xml';
        const worksheet = zip.file(worksheetPath).asText();
        const mutated = item.mutate(worksheet);
        assert.notEqual(mutated, worksheet);
        zip.file(worksheetPath, mutated);
      });

      await assert.rejects(
        () => assertPackageLimits(malformedPath, { expectedExtension: '.xlsx' }),
        isIntegrityCode('invalid_ooxml_package'),
      );
    });
  }
});

test('rejects duplicate sharedStrings workbook relationships', async t => {
  const { directory } = await temporaryPaths(t, 'duplicate-shared-strings-relationship-');
  const inputPath = path.join(directory, 'input.xlsx');
  const malformedPath = path.join(directory, 'duplicate-relationship.xlsx');
  await createWorkbook(inputPath);
  await mutatePackage(inputPath, malformedPath, zip => {
    const relationshipPath = 'xl/_rels/workbook.xml.rels';
    const relationships = zip.file(relationshipPath).asText();
    const sharedStrings = xmlTags(relationships, 'Relationship').find(
      tag => String(xmlAttribute(tag, 'Type')).toLowerCase().endsWith('/sharedstrings'),
    );
    assert.ok(sharedStrings, 'sharedStrings relationship');
    const duplicate = sharedStrings.replace(
      /\bId=(['"])[^'"]*\1/,
      'Id="rIdDuplicateSharedStrings"',
    );
    assert.notEqual(duplicate, sharedStrings);
    zip.file(
      relationshipPath,
      relationships.replace('</Relationships>', `${duplicate}</Relationships>`),
    );
  });

  await assert.rejects(
    () => assertPackageLimits(malformedPath, { expectedExtension: '.xlsx' }),
    isIntegrityCode('invalid_ooxml_package'),
  );
  await assert.rejects(
    () => validateWorkbookIntegrity({
      inputPath,
      outputPath: malformedPath,
      changedCells: new Set(),
    }),
    isIntegrityCode('invalid_ooxml_package'),
  );
});

test('rejects duplicate relationship IDs', async t => {
  const { directory } = await temporaryPaths(t, 'duplicate-relationship-id-');
  const inputPath = path.join(directory, 'input.xlsx');
  const malformedPath = path.join(directory, 'duplicate-id.xlsx');
  await createWorkbook(inputPath);
  await mutatePackage(inputPath, malformedPath, zip => {
    const relationshipPath = 'xl/_rels/workbook.xml.rels';
    const relationships = zip.file(relationshipPath).asText();
    const styles = xmlTags(relationships, 'Relationship').find(
      tag => String(xmlAttribute(tag, 'Type')).toLowerCase().endsWith('/styles'),
    );
    assert.ok(styles, 'styles relationship');
    zip.file(
      relationshipPath,
      relationships.replace('</Relationships>', `${styles}</Relationships>`),
    );
  });

  await assert.rejects(
    () => assertPackageLimits(malformedPath, { expectedExtension: '.xlsx' }),
    isIntegrityCode('invalid_ooxml_package'),
  );
});

test('sparse A1 and XFD1048576 cells validate within a bounded child process', {
  timeout: 10_000,
}, async t => {
  const { directory } = await temporaryPaths(t, 'sparse-workbook-');
  const inputPath = path.join(directory, 'sparse.xlsx');
  await createSparseWorkbook(inputPath);

  const integrityModule = require.resolve('../utils/workbookIntegrity');
  const childScript = `
    const { snapshotWorkbook, validateWorkbookIntegrity } = require(process.argv[1]);
    const filePath = process.argv[2];
    (async () => {
      const snapshot = await snapshotWorkbook(filePath);
      const count = snapshot.sheets[0].values.length;
      if (count !== 2) throw new Error('expected_two_actual_cells:' + count);
      await validateWorkbookIntegrity({ inputPath: filePath, outputPath: filePath });
      process.stdout.write('validated:' + count);
    })().catch(error => {
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    });
  `;
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['-e', childScript, integrityModule, inputPath],
    { timeout: 5_000, killSignal: 'SIGKILL', maxBuffer: ONE_MIB },
  );
  assert.equal(stderr, '');
  assert.equal(stdout, 'validated:2');
});

test('rejects invalid or inconsistent worksheet coordinates before workbook loading', {
  timeout: 10_000,
}, async t => {
  const { directory } = await temporaryPaths(t, 'invalid-worksheet-coordinates-');
  const inputPath = path.join(directory, 'input.xlsx');
  await createWorkbook(inputPath);

  const cases = [
    {
      name: 'row beyond the Excel limit',
      rowReference: '4294967294',
      cellReference: 'A4294967294',
    },
    { name: 'column beyond XFD', rowReference: '1', cellReference: 'XFE1' },
    { name: 'zero row in a cell reference', rowReference: '1', cellReference: 'A0' },
    { name: 'non-A1 cell reference', rowReference: '1', cellReference: 'R1C1' },
    { name: 'row and cell row mismatch', rowReference: '2', cellReference: 'A1' },
  ];

  for (const [index, item] of cases.entries()) {
    await t.test(item.name, async () => {
      const malformedPath = path.join(directory, `malformed-${index}.xlsx`);
      await mutatePackage(inputPath, malformedPath, zip => {
        const worksheetPath = 'xl/worksheets/sheet1.xml';
        const worksheet = zip.file(worksheetPath).asText();
        const mutated = worksheet
          .replace(/<row\b[^>]*\br="1"/, `<row r="${item.rowReference}"`)
          .replace(/<c\b[^>]*\br="A1"/, `<c r="${item.cellReference}"`);
        assert.notEqual(mutated, worksheet);
        zip.file(worksheetPath, mutated);
      });

      await assert.rejects(
        () => assertPackageLimits(malformedPath, { expectedExtension: '.xlsx' }),
        isIntegrityCode('invalid_ooxml_package'),
      );
    });
  }
});

test('mixed-case VBA targets discovered from package metadata are byte-protected', async t => {
  const { directory } = await temporaryPaths(t, 'mixed-case-vba-');
  const seedPath = path.join(directory, 'seed.xlsx');
  const inputPath = path.join(directory, 'input.xlsm');
  const outputPath = path.join(directory, 'output.xlsm');
  await createWorkbook(seedPath);
  await mutatePackage(seedPath, inputPath, enableMacroContainer);
  await mutatePackage(inputPath, outputPath, zip => {
    zip.file(VBA_PART, Buffer.from('mutated-vba-bytes'));
  });

  const snapshot = await snapshotWorkbook(inputPath);
  assert.equal(snapshot.protectedParts.has(VBA_PART), true);
  await assert.rejects(
    () => validateWorkbookIntegrity({
      inputPath,
      outputPath,
      changedCells: new Set(),
    }),
    isIntegrityCode('protected_part_changed'),
  );
});

test('rejects removal of the required styles Content-Type mapping', async t => {
  const { directory } = await temporaryPaths(t, 'styles-content-type-');
  const inputPath = path.join(directory, 'input.xlsx');
  const malformedPath = path.join(directory, 'missing-styles-content-type.xlsx');
  await createWorkbook(inputPath);
  await assertPackageLimits(inputPath, { expectedExtension: '.xlsx' });
  await mutatePackage(inputPath, malformedPath, zip => {
    const contentTypes = removeXmlTags(
      zip.file('[Content_Types].xml').asText(),
      'Override',
      tag => String(xmlAttribute(tag, 'PartName')).toLowerCase() === '/xl/styles.xml',
    );
    assert.equal(contentTypes.removed, 1);
    zip.file('[Content_Types].xml', contentTypes.output);
  });

  await assert.rejects(
    () => assertPackageLimits(malformedPath, { expectedExtension: '.xlsx' }),
    isIntegrityCode('content_types_changed'),
  );
});

test('rejects .xlsx and .xlsm extension/container mismatches', async t => {
  const { directory } = await temporaryPaths(t, 'workbook-type-');
  const xlsxPath = path.join(directory, 'plain.xlsx');
  const xlsmPath = path.join(directory, 'macro.xlsm');
  const xltxAsXlsxPath = path.join(directory, 'template-as-xlsx.xlsx');
  const xltmAsXlsmPath = path.join(directory, 'template-as-xlsm.xlsm');
  await createWorkbook(xlsxPath);
  await mutatePackage(xlsxPath, xlsmPath, enableMacroContainer);
  await mutatePackage(xlsxPath, xltxAsXlsxPath, zip => {
    replaceWorkbookContentType(zip, XLSX_WORKBOOK_CONTENT_TYPE, XLTX_WORKBOOK_CONTENT_TYPE);
  });
  await mutatePackage(xlsmPath, xltmAsXlsmPath, zip => {
    replaceWorkbookContentType(zip, XLSM_WORKBOOK_CONTENT_TYPE, XLTM_WORKBOOK_CONTENT_TYPE);
  });

  await assertPackageLimits(xlsxPath, { expectedExtension: '.xlsx' });
  await assertPackageLimits(xlsmPath, { expectedExtension: '.xlsm' });
  await assert.rejects(
    () => assertPackageLimits(xlsxPath, { expectedExtension: '.xlsm' }),
    isIntegrityCode('workbook_type_mismatch'),
  );
  await assert.rejects(
    () => assertPackageLimits(xlsmPath, { expectedExtension: '.xlsx' }),
    isIntegrityCode('workbook_type_mismatch'),
  );
  await assert.rejects(
    () => assertPackageLimits(xltxAsXlsxPath, { expectedExtension: '.xlsx' }),
    isIntegrityCode('workbook_type_mismatch'),
  );
  await assert.rejects(
    () => assertPackageLimits(xltmAsXlsmPath, { expectedExtension: '.xlsm' }),
    isIntegrityCode('workbook_type_mismatch'),
  );
});
