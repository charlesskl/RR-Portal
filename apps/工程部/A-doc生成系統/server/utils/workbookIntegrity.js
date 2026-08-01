const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createInflateRaw } = require('node:zlib');
const PizZip = require('pizzip');
const crc32 = require('pizzip/js/crc32');
const XlsxPopulate = require('xlsx-populate');
const XmlBuilder = require('xlsx-populate/lib/XmlBuilder');
const XmlParser = require('xlsx-populate/lib/XmlParser');

let sax;
try {
  sax = require('sax');
} catch {
  sax = require(require.resolve('sax', {
    paths: [path.dirname(require.resolve('xlsx-populate/package.json'))],
  }));
}

const DEFAULT_MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_COUNT = 10_000;
const DEFAULT_MAX_CELL_COUNT = 1_000_000;
const WORKBOOK_RELATIONSHIPS_PART = 'xl/_rels/workbook.xml.rels';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const XLSX_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const XLSM_WORKBOOK_CONTENT_TYPE =
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const MAX_WORKSHEET_ROW = 1_048_576;
const MAX_WORKSHEET_COLUMN = 16_384;
const RELATIONSHIP_PART = /_rels\/.*\.rels$/;

const PROTECTED = [
  /^xl\/workbook\.xml$/,
  /^xl\/media\//,
  /^xl\/drawings\//,
  /^xl\/charts\//,
  /^xl\/externalLinks\//,
  /^xl\/pivotTables\//,
  /^xl\/pivotCache\//,
  /^xl\/embeddings\//,
  /^xl\/activeX\//,
  /^xl\/ctrlProps\//,
  /^xl\/(?:comments\d+\.xml|threadedComments\/)/,
  /^xl\/persons\/person\.xml$/,
  /^customXml\//,
  /^xl\/calcChain\.xml$/,
  /^xl\/vbaProject.*\.bin$/i,
];

const WORKSHEET_STRUCTURE_NODES = new Set([
  'sheetPr',
  'sheetViews',
  'sheetFormatPr',
  'dataValidations',
  'conditionalFormatting',
  'hyperlinks',
  'autoFilter',
  'sortState',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'picture',
  'oleObjects',
  'controls',
  'tableParts',
  'extLst',
]);

const STYLE_COUNT_NODES = new Set([
  'numFmts',
  'fonts',
  'fills',
  'borders',
  'cellStyleXfs',
  'cellXfs',
  'cellStyles',
  'dxfs',
]);

class WorkbookIntegrityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WorkbookIntegrityError';
    this.code = code;
  }
}

function fail(code) {
  throw new WorkbookIntegrityError(code);
}

function preflightZipDirectory(buffer, maxEntryCount) {
  const minimumEocdSize = 22;
  if (!Buffer.isBuffer(buffer) || buffer.length < minimumEocdSize) {
    fail('invalid_ooxml_package');
  }
  const minimumOffset = Math.max(0, buffer.length - 65_535 - minimumEocdSize);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + minimumEocdSize + commentLength !== buffer.length) continue;
    eocdOffset = offset;
    break;
  }
  if (eocdOffset < 0) fail('invalid_ooxml_package');

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail('invalid_ooxml_package');
  }
  if (entryCount > maxEntryCount) fail('package_too_large');
  if (centralOffset + centralSize > eocdOffset) fail('invalid_ooxml_package');

  let centralCursor = centralOffset;
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (centralCursor + 46 > eocdOffset || buffer.readUInt32LE(centralCursor) !== 0x02014b50) {
      fail('invalid_ooxml_package');
    }
    const flags = buffer.readUInt16LE(centralCursor + 8);
    const method = buffer.readUInt16LE(centralCursor + 10);
    const expectedCrc = buffer.readUInt32LE(centralCursor + 16);
    const compressedSize = buffer.readUInt32LE(centralCursor + 20);
    const uncompressedSize = buffer.readUInt32LE(centralCursor + 24);
    const nameLength = buffer.readUInt16LE(centralCursor + 28);
    const extraLength = buffer.readUInt16LE(centralCursor + 30);
    const commentLength = buffer.readUInt16LE(centralCursor + 32);
    const localOffset = buffer.readUInt32LE(centralCursor + 42);
    const centralEnd = centralCursor + 46 + nameLength + extraLength + commentLength;
    if (
      centralEnd > eocdOffset
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
      || ![0, 8].includes(method)
      || (flags & 0x1) !== 0
    ) fail('invalid_ooxml_package');

    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      fail('invalid_ooxml_package');
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const centralName = buffer.subarray(centralCursor + 46, centralCursor + 46 + nameLength);
    const localNameStart = localOffset + 30;
    const localName = buffer.subarray(localNameStart, localNameStart + localNameLength);
    const dataStart = localNameStart + localNameLength + localExtraLength;
    if (
      localFlags !== flags
      || localMethod !== method
      || !centralName.equals(localName)
      || dataStart + compressedSize > centralOffset
    ) fail('invalid_ooxml_package');
    const entryName = centralName.toString((flags & 0x800) !== 0 ? 'utf8' : 'binary');
    if (entries.has(entryName)) fail('invalid_ooxml_package');
    entries.set(entryName, {
      usesDataDescriptor: (flags & 0x8) !== 0,
      localCrc,
      localCompressedSize,
      localUncompressedSize,
      centralCrc: expectedCrc,
      centralCompressedSize: compressedSize,
      centralUncompressedSize: uncompressedSize,
    });
    centralCursor = centralEnd;
  }
  if (centralCursor !== centralOffset + centralSize) fail('invalid_ooxml_package');
  return { entryCount, entries };
}

function compressionMethodCode(method) {
  const value = String(method || '');
  return (value.charCodeAt(0) || 0) | ((value.charCodeAt(1) || 0) << 8);
}

function countWorksheetCells(state, chunk, flush = false) {
  if (!state) return;
  const text = `${state.tail}${chunk ? chunk.toString('utf8') : ''}`;
  const retainedCharacters = flush ? 0 : Math.min(32, text.length);
  const scanLength = text.length - retainedCharacters;
  const scan = text.slice(0, scanLength);
  const matches = scan.match(/<(?:[A-Za-z_][\w.-]*:)?c(?:\s|\/?>)/g);
  state.count += matches ? matches.length : 0;
  if (state.count > state.max) fail('package_too_large');
  state.tail = text.slice(scanLength);
}

async function measureZipEntry(file, remainingBytes, cellState, directoryEntry) {
  const data = file && file._data;
  if (!data || typeof data.getCompressedContent !== 'function') {
    fail('invalid_ooxml_package');
  }
  const declaredSize = Number(data.uncompressedSize);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
    fail('invalid_ooxml_package');
  }
  if (declaredSize > remainingBytes) fail('package_too_large');

  let compressed;
  try {
    compressed = Buffer.from(data.getCompressedContent());
  } catch {
    fail('invalid_ooxml_package');
  }
  if (compressed.length !== Number(data.compressedSize)) fail('invalid_ooxml_package');

  const method = compressionMethodCode(data.compressionMethod);
  let stream;
  if (method === 0) {
    stream = Readable.from([compressed]);
  } else if (method === 8) {
    const inflater = createInflateRaw();
    Readable.from([compressed]).pipe(inflater);
    stream = inflater;
  } else {
    fail('invalid_ooxml_package');
  }

  let actualSize = 0;
  let actualCrc = 0;
  try {
    for await (const chunk of stream) {
      actualSize += chunk.length;
      if (actualSize > remainingBytes) fail('package_too_large');
      actualCrc = crc32(chunk, actualCrc);
      countWorksheetCells(cellState, chunk);
    }
    countWorksheetCells(cellState, null, true);
  } catch (error) {
    stream.destroy();
    if (error instanceof WorkbookIntegrityError) throw error;
    fail('invalid_ooxml_package');
  }

  if (actualSize !== declaredSize) fail('invalid_ooxml_package');
  if ((actualCrc >>> 0) !== (Number(data.crc32) >>> 0)) fail('invalid_ooxml_package');
  if (!directoryEntry || (
    directoryEntry.centralCrc !== (Number(data.crc32) >>> 0)
    || directoryEntry.centralCompressedSize !== compressed.length
    || directoryEntry.centralUncompressedSize !== declaredSize
  )) fail('invalid_ooxml_package');
  if (!directoryEntry.usesDataDescriptor && (
    directoryEntry.localCrc !== (actualCrc >>> 0)
    || directoryEntry.localCompressedSize !== compressed.length
    || directoryEntry.localUncompressedSize !== actualSize
  )) fail('invalid_ooxml_package');
  return actualSize;
}

function localName(name) {
  return String(name || '').split(':').pop();
}

function attribute(node, name) {
  if (!node || !node.attributes) return undefined;
  if (Object.hasOwn(node.attributes, name)) return node.attributes[name];
  const match = Object.keys(node.attributes).find(key => localName(key) === localName(name));
  return match === undefined ? undefined : node.attributes[match];
}

function elementChildren(node, name) {
  if (!node || !Array.isArray(node.children)) return [];
  return node.children.filter(child => (
    child && typeof child === 'object' && (!name || localName(child.name) === name)
  ));
}

function descendants(node, name, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (localName(node.name) === name) output.push(node);
  for (const child of elementChildren(node)) descendants(child, name, output);
  return output;
}

function firstDescendant(node, name) {
  return descendants(node, name, [])[0];
}

function canonicalNode(node) {
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(canonicalNode);

  const attributes = Object.entries(node.attributes || {})
    .map(([name, value]) => [name, String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  let children = (node.children || []).map(canonicalNode);
  const name = localName(node.name);
  if (name === 'numFmts') {
    children = children.sort((left, right) => {
      const leftId = left && left.attributes
        ? left.attributes.find(([key]) => localName(key) === 'numFmtId')?.[1]
        : '';
      const rightId = right && right.attributes
        ? right.attributes.find(([key]) => localName(key) === 'numFmtId')?.[1]
        : '';
      return String(leftId).localeCompare(String(rightId), undefined, { numeric: true });
    });
  } else if (name === 'cellStyles') {
    children = children.sort((left, right) => {
      const leftName = left && left.attributes
        ? left.attributes.find(([key]) => localName(key) === 'name')?.[1]
        : '';
      const rightName = right && right.attributes
        ? right.attributes.find(([key]) => localName(key) === 'name')?.[1]
        : '';
      return String(leftName).localeCompare(String(rightName));
    });
  }
  return { name, attributes, children };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalStyles(root) {
  const styles = canonicalNode(root);
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (STYLE_COUNT_NODES.has(node.name)) {
      node.attributes = node.attributes.filter(([name]) => localName(name) !== 'count');
    }
    for (const child of node.children || []) visit(child);
  };
  visit(styles);
  styles.children = (styles.children || []).filter(node => !(
    node.name === 'numFmts'
    && node.attributes.length === 0
    && node.children.length === 0
  ));
  return styles;
}

async function parseXml(zip, partName) {
  const file = zip.file(partName);
  if (!file) fail('invalid_ooxml_package');
  try {
    return await new XmlParser().parseAsync(file.asText());
  } catch {
    fail('invalid_ooxml_package');
  }
}

function worksheetColumnNumber(name) {
  if (!/^[A-Z]{1,3}$/.test(name)) fail('invalid_ooxml_package');
  let column = 0;
  for (const character of name) {
    column = (column * 26) + character.charCodeAt(0) - 64;
  }
  if (column > MAX_WORKSHEET_COLUMN) fail('invalid_ooxml_package');
  return column;
}

function worksheetRowNumber(reference) {
  const text = String(reference ?? '');
  if (!/^[1-9]\d*$/.test(text)) fail('invalid_ooxml_package');
  const row = Number(text);
  if (!Number.isSafeInteger(row) || row > MAX_WORKSHEET_ROW) {
    fail('invalid_ooxml_package');
  }
  return row;
}

function worksheetCellReference(reference) {
  const match = String(reference ?? '').match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) fail('invalid_ooxml_package');
  worksheetColumnNumber(match[1]);
  return { row: worksheetRowNumber(match[2]) };
}

function worksheetRows(root) {
  if (localName(root?.name) !== 'worksheet') fail('invalid_ooxml_package');
  const sheetData = elementChildren(root, 'sheetData');
  if (sheetData.length !== 1) fail('invalid_ooxml_package');
  const rows = elementChildren(sheetData[0]);
  if (rows.some(node => localName(node.name) !== 'row')) fail('invalid_ooxml_package');
  return rows;
}

function worksheetRowXmlRecords(xml) {
  const rows = new Map();
  const extensions = new Map();
  const stack = [];
  const parser = sax.parser(true);
  parser.onerror = () => fail('invalid_ooxml_package');
  parser.onopentag = node => {
    const parent = stack[stack.length - 1];
    const grandparent = stack[stack.length - 2];
    const name = String(node.name || '');
    const nodeLocalName = localName(name);
    const isWorksheetRow = nodeLocalName === 'row'
      && parent?.localName === 'sheetData'
      && grandparent?.localName === 'worksheet';
    const record = {
      name,
      localName: nodeLocalName,
      start: parser.startTagPosition - 1,
      startTagEnd: parser.position,
      selfClosing: Boolean(node.isSelfClosing),
      isWorksheetRow,
      worksheetRowNumber: isWorksheetRow
        ? worksheetRowNumber(attribute(node, 'r'))
        : parent?.worksheetRowNumber,
      isRowExtension: nodeLocalName === 'extLst' && Boolean(parent?.isWorksheetRow),
    };
    if (isWorksheetRow) {
      if (rows.has(record.worksheetRowNumber)) fail('invalid_ooxml_package');
      rows.set(record.worksheetRowNumber, record);
    }
    stack.push(record);
  };
  parser.onclosetag = name => {
    const record = stack.pop();
    if (!record || record.name !== String(name || '')) fail('invalid_ooxml_package');
    record.closeStart = record.selfClosing ? null : parser.startTagPosition - 1;
    record.end = parser.position;
    if (record.isRowExtension) {
      if (extensions.has(record.worksheetRowNumber)) fail('invalid_ooxml_package');
      extensions.set(record.worksheetRowNumber, {
        start: record.start,
        end: record.end,
        xml: xml.slice(record.start, record.end),
      });
    }
  };
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof WorkbookIntegrityError) throw error;
    fail('invalid_ooxml_package');
  }
  if (stack.length > 0) fail('invalid_ooxml_package');
  return { rows, extensions };
}

function replaceXmlRanges(xml, replacements) {
  let output = xml;
  const ordered = [...replacements].sort((left, right) => right.start - left.start);
  for (const { start, end, value } of ordered) {
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end < start
      || end > output.length
    ) fail('invalid_ooxml_package');
    output = `${output.slice(0, start)}${value}${output.slice(end)}`;
  }
  return output;
}

async function assertWorksheetCoordinates(zip) {
  const worksheetParts = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/[^/]+\.xml$/i.test(name) && !zip.files[name].dir)
    .sort();
  const sharedStringIndexes = [];
  const worksheetRoots = new Map();
  const rowExtensionLists = new Map();
  const rowXmlParts = new Map();
  for (const partName of worksheetParts) {
    const worksheetXml = zip.file(partName).asText();
    const rowXml = worksheetRowXmlRecords(worksheetXml);
    const root = await parseXml(zip, partName);
    const rows = worksheetRows(root);
    worksheetRoots.set(partName, root);
    const rowReferences = new Set();
    const cellReferences = new Set();
    const extensionsByRow = new Map();
    for (const rowNode of rows) {
      const row = worksheetRowNumber(attribute(rowNode, 'r'));
      if (rowReferences.has(row)) fail('invalid_ooxml_package');
      rowReferences.add(row);
      let hasExtensionList = false;
      for (const cellNode of elementChildren(rowNode)) {
        const childName = localName(cellNode.name);
        if (childName === 'extLst') {
          if (hasExtensionList) fail('invalid_ooxml_package');
          hasExtensionList = true;
          extensionsByRow.set(row, cellNode);
          continue;
        }
        if (childName !== 'c' || hasExtensionList) fail('invalid_ooxml_package');
        const reference = String(attribute(cellNode, 'r') ?? '');
        const cell = worksheetCellReference(reference);
        if (cell.row !== row) fail('invalid_ooxml_package');
        if (cellReferences.has(reference)) fail('invalid_ooxml_package');
        cellReferences.add(reference);

        if (String(attribute(cellNode, 't') || '') === 's') {
          const values = elementChildren(cellNode, 'v');
          if (values.length !== 1 || elementChildren(values[0]).length > 0) {
            fail('invalid_ooxml_package');
          }
          const valueChildren = values[0].children || [];
          const index = valueChildren[0];
          if (
            valueChildren.length !== 1
            || typeof index !== 'number'
            || !Number.isSafeInteger(index)
            || index < 0
          ) fail('invalid_ooxml_package');
          sharedStringIndexes.push(index);
        }
      }
    }
    if (extensionsByRow.size > 0) rowExtensionLists.set(partName, extensionsByRow);
    if (
      rowXml.rows.size !== rowReferences.size
      || [...rowReferences].some(row => !rowXml.rows.has(row))
      || rowXml.extensions.size !== extensionsByRow.size
      || [...extensionsByRow.keys()].some(row => !rowXml.extensions.has(row))
    ) fail('invalid_ooxml_package');
    rowXmlParts.set(partName, rowXml);
  }
  return {
    sharedStringIndexes,
    worksheetRoots,
    rowExtensionLists,
    rowXmlParts,
  };
}

function relationshipBaseDirectory(partName) {
  if (partName === '_rels/.rels') return '';
  const marker = '/_rels/';
  const markerIndex = partName.indexOf(marker);
  if (markerIndex < 0 || !partName.endsWith('.rels')) fail('invalid_ooxml_package');
  const sourceDirectory = partName.slice(0, markerIndex);
  return sourceDirectory;
}

function internalRelationshipTarget(partName, target) {
  let decoded;
  try {
    decoded = decodeURI(String(target || '').replace(/\\/g, '/')).split('#')[0];
  } catch {
    fail('relationship_target_missing');
  }
  if (!decoded || /^[a-z][a-z\d+.-]*:/i.test(decoded)) {
    fail('relationship_target_missing');
  }
  if (decoded.startsWith('/')) return path.posix.normalize(decoded.slice(1));
  return path.posix.normalize(path.posix.join(
    relationshipBaseDirectory(partName),
    decoded,
  ));
}

function relationshipRecords(root, partName) {
  const records = descendants(root, 'Relationship').map(node => {
    const targetMode = String(attribute(node, 'TargetMode') || '');
    const target = String(attribute(node, 'Target') || '');
    return {
      id: String(attribute(node, 'Id') || ''),
      type: String(attribute(node, 'Type') || ''),
      target,
      targetMode,
      resolvedTarget: targetMode.toLowerCase() === 'external'
        ? null
        : internalRelationshipTarget(partName, target),
    };
  });
  const relationshipIds = new Set();
  for (const record of records) {
    if (!record.id || relationshipIds.has(record.id)) fail('invalid_ooxml_package');
    relationshipIds.add(record.id);
  }
  return records.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function contentTypeMaps(root) {
  const overrides = new Map();
  for (const node of descendants(root, 'Override')) {
    const partName = String(attribute(node, 'PartName') || '').replace(/^\//, '');
    const contentType = String(attribute(node, 'ContentType') || '');
    if (!partName || !contentType || overrides.has(partName)) fail('invalid_ooxml_package');
    overrides.set(partName, contentType);
  }
  const defaults = new Map();
  for (const node of descendants(root, 'Default')) {
    const extension = String(attribute(node, 'Extension') || '').toLowerCase();
    const contentType = String(attribute(node, 'ContentType') || '');
    if (!extension || !contentType || defaults.has(extension)) fail('invalid_ooxml_package');
    defaults.set(extension, contentType);
  }
  return { overrides, defaults };
}

function contentTypeForPart(maps, partName) {
  if (maps.overrides.has(partName)) return maps.overrides.get(partName);
  const basename = path.posix.basename(partName);
  const standardExtension = path.posix.extname(basename).slice(1);
  const extension = (standardExtension || (basename.startsWith('.') ? basename.slice(1) : ''))
    .toLowerCase();
  return maps.defaults.get(extension) || null;
}

function partContentTypes(zip, root) {
  const maps = contentTypeMaps(root);
  const result = new Map();
  for (const name of Object.keys(zip.files).sort()) {
    if (zip.files[name].dir || name === '[Content_Types].xml') continue;
    result.set(name, contentTypeForPart(maps, name));
  }
  return result;
}

async function vbaPartNames(zip, contentTypesRoot) {
  const names = new Set();
  const maps = contentTypeMaps(contentTypesRoot);
  for (const [partName, contentType] of maps.overrides) {
    if (/vbaProject/i.test(contentType)) names.add(partName);
  }
  for (const [extension, contentType] of maps.defaults) {
    if (!/vbaProject/i.test(contentType)) continue;
    for (const name of Object.keys(zip.files)) {
      if (path.posix.extname(name).slice(1).toLowerCase() === extension) names.add(name);
    }
  }
  for (const partName of Object.keys(zip.files)) {
    if (!partName.endsWith('.rels') || zip.files[partName].dir) continue;
    const root = await parseXml(zip, partName);
    for (const record of relationshipRecords(root, partName)) {
      if (/\/vbaProject$/i.test(record.type) && record.resolvedTarget) {
        names.add(record.resolvedTarget);
      }
    }
  }
  return names;
}

async function assertRelationshipTargets(zip) {
  const relationshipParts = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && name.endsWith('.rels'))
    .sort();
  for (const partName of relationshipParts) {
    const root = await parseXml(zip, partName);
    for (const relationship of relationshipRecords(root, partName)) {
      if (relationship.targetMode.toLowerCase() === 'external') continue;
      if (!zip.file(relationship.resolvedTarget)) fail('relationship_target_missing');
    }
  }
}

async function assertRequiredWorkbookRelationships(
  zip,
  contentTypesRoot,
  { sharedStringIndexes = [] } = {},
) {
  const relationshipsRoot = await parseXml(zip, WORKBOOK_RELATIONSHIPS_PART);
  const records = relationshipRecords(relationshipsRoot, WORKBOOK_RELATIONSHIPS_PART);
  const contentTypes = contentTypeMaps(contentTypesRoot);
  const sharedStringsRelationships = records.filter(
    record => /\/sharedStrings$/i.test(record.type),
  );
  if (
    sharedStringsRelationships.length > 1
    || sharedStringsRelationships.some(
    record => record.resolvedTarget !== SHARED_STRINGS_PART,
    )
  ) fail('invalid_ooxml_package');

  const sharedStrings = sharedStringsRelationships[0];
  if (sharedStringIndexes.length > 0 && !sharedStrings) fail('invalid_ooxml_package');
  if (sharedStrings) {
    if (
      !sharedStrings.resolvedTarget
      || !zip.file(sharedStrings.resolvedTarget)
      || contentTypeForPart(contentTypes, sharedStrings.resolvedTarget)
        !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'
    ) fail('invalid_ooxml_package');

    const sharedStringsRoot = await parseXml(zip, sharedStrings.resolvedTarget);
    if (localName(sharedStringsRoot.name) !== 'sst') fail('invalid_ooxml_package');
    const sharedStringCount = elementChildren(sharedStringsRoot, 'si').length;
    if (sharedStringIndexes.some(index => index >= sharedStringCount)) {
      fail('invalid_ooxml_package');
    }
  }

  if (zip.file('xl/styles.xml')) {
    const styles = records.find(record => /\/styles$/i.test(record.type));
    if (!styles || styles.resolvedTarget !== 'xl/styles.xml') fail('invalid_ooxml_package');
    if (contentTypeForPart(contentTypes, 'xl/styles.xml')
      !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml') {
      fail('content_types_changed');
    }
  }
}

async function inspectWorkbookSheets(zip) {
  const workbookRoot = await parseXml(zip, 'xl/workbook.xml');
  if (localName(workbookRoot.name) !== 'workbook') fail('invalid_ooxml_package');
  const sheetsNodes = elementChildren(workbookRoot, 'sheets');
  if (sheetsNodes.length !== 1) fail('invalid_ooxml_package');
  const sheetNodes = elementChildren(sheetsNodes[0]);
  if (
    sheetNodes.length === 0
    || sheetNodes.some(node => localName(node.name) !== 'sheet')
  ) fail('invalid_ooxml_package');

  const relationshipsRoot = await parseXml(zip, WORKBOOK_RELATIONSHIPS_PART);
  const relationships = new Map(relationshipRecords(
    relationshipsRoot,
    WORKBOOK_RELATIONSHIPS_PART,
  ).map(record => [record.id, record]));
  const sheetNames = new Set();
  const sheetIds = new Set();
  const partIndexes = new Set();
  const sheetRecords = sheetNodes.map(node => {
    const name = String(attribute(node, 'name') || '');
    const sheetId = Number(attribute(node, 'sheetId'));
    const relationshipId = String(attribute(node, 'r:id') || '');
    const relationship = relationships.get(relationshipId);
    const partMatch = relationship?.resolvedTarget?.match(
      /^xl\/worksheets\/sheet([1-9]\d*)\.xml$/,
    );
    if (
      !name
      || !Number.isSafeInteger(sheetId)
      || sheetId < 1
      || sheetNames.has(name)
      || sheetIds.has(sheetId)
      || !relationship
      || !/\/worksheet$/i.test(relationship.type)
      || !partMatch
    ) fail('invalid_ooxml_package');
    const partIndex = Number(partMatch[1]);
    if (
      !Number.isSafeInteger(partIndex)
      || partIndex < 1
      || partIndex > sheetNodes.length
      || partIndexes.has(partIndex)
    ) fail('invalid_ooxml_package');
    sheetNames.add(name);
    sheetIds.add(sheetId);
    partIndexes.add(partIndex);
    return { node, relationshipId, partIndex };
  });
  if (partIndexes.size !== sheetNodes.length) fail('invalid_ooxml_package');

  return {
    workbookRoot,
    sheetsNode: sheetsNodes[0],
    sheetRecords,
    needsCanonicalOrder: sheetRecords.some(
      (record, index) => record.partIndex !== index + 1,
    ),
  };
}

async function protectedHashes(zip, contentTypesRoot) {
  const hashes = new Map();
  const dynamicVbaParts = await vbaPartNames(zip, contentTypesRoot);
  for (const name of Object.keys(zip.files).sort()) {
    const file = zip.files[name];
    const relationshipProtected = RELATIONSHIP_PART.test(name)
      && name !== WORKBOOK_RELATIONSHIPS_PART;
    if (
      file.dir
      || (!relationshipProtected
        && !dynamicVbaParts.has(name)
        && !PROTECTED.some(pattern => pattern.test(name)))
    ) continue;
    const data = Buffer.from(file.asUint8Array());
    hashes.set(name, crypto.createHash('sha256').update(data).digest('hex'));
  }
  return hashes;
}

async function loadPackage(filePath, {
  maxCompressedBytes = DEFAULT_MAX_COMPRESSED_BYTES,
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
  maxEntryCount = DEFAULT_MAX_ENTRY_COUNT,
  maxCellCount = DEFAULT_MAX_CELL_COUNT,
  validateRelationships = true,
} = {}) {
  let buffer;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxCompressedBytes) fail('package_too_large');
    buffer = await fs.readFile(filePath);
  } catch (error) {
    if (error instanceof WorkbookIntegrityError) throw error;
    fail('invalid_ooxml_package');
  }

  const zipDirectory = preflightZipDirectory(buffer, maxEntryCount);

  let zip;
  try {
    zip = new PizZip(buffer);
  } catch {
    fail('invalid_ooxml_package');
  }
  if (!zip.file('[Content_Types].xml') || !zip.file('xl/workbook.xml')) {
    fail('invalid_ooxml_package');
  }

  let uncompressedBytes = 0;
  const entryNames = Object.keys(zip.files);
  if (entryNames.length > maxEntryCount) fail('package_too_large');
  const cellCounter = { count: 0, max: maxCellCount, tail: '' };
  for (const name of entryNames) {
    const file = zip.files[name];
    if (file.dir) continue;
    const worksheetCounter = /^xl\/worksheets\/[^/]+\.xml$/i.test(name)
      ? cellCounter
      : null;
    uncompressedBytes += await measureZipEntry(
      file,
      maxUncompressedBytes - uncompressedBytes,
      worksheetCounter,
      zipDirectory.entries.get(name),
    );
  }

  const contentTypesRoot = await parseXml(zip, '[Content_Types].xml');
  const contentTypes = partContentTypes(zip, contentTypesRoot);
  if ([...contentTypes.values()].some(contentType => !contentType)) {
    fail('invalid_ooxml_package');
  }
  const worksheetInspection = await assertWorksheetCoordinates(zip);
  let workbookSheetInspection = null;
  if (validateRelationships) {
    await assertRelationshipTargets(zip);
    await assertRequiredWorkbookRelationships(zip, contentTypesRoot, worksheetInspection);
    workbookSheetInspection = await inspectWorkbookSheets(zip);
  }

  return {
    buffer,
    zip,
    compressedBytes: buffer.length,
    uncompressedBytes,
    cellCount: cellCounter.count,
    contentTypesRoot,
    contentTypes,
    workbookSheetInspection,
    worksheetInspection,
    protectedParts: await protectedHashes(zip, contentTypesRoot),
  };
}

async function assertExpectedWorkbookType(loaded, expectedExtension) {
  if (expectedExtension === undefined) return;
  const normalizedExtension = String(expectedExtension).toLowerCase();
  if (!['.xlsx', '.xlsm'].includes(normalizedExtension)) fail('workbook_type_mismatch');
  const vbaParts = await vbaPartNames(loaded.zip, loaded.contentTypesRoot);
  const expectedContentType = normalizedExtension === '.xlsm'
    ? XLSM_WORKBOOK_CONTENT_TYPE
    : XLSX_WORKBOOK_CONTENT_TYPE;
  const matches = loaded.contentTypes.get('xl/workbook.xml') === expectedContentType
    && (normalizedExtension === '.xlsm' || vbaParts.size === 0);
  if (!matches) fail('workbook_type_mismatch');
}

async function xlsxPopulateCompatibleBuffer(loaded) {
  const rowXmlParts = loaded.worksheetInspection.rowXmlParts;
  const hasRowExtensions = [...rowXmlParts.values()].some(
    part => part.extensions.size > 0,
  );
  const needsCanonicalSheetOrder = Boolean(
    loaded.workbookSheetInspection?.needsCanonicalOrder,
  );
  if (!hasRowExtensions && !needsCanonicalSheetOrder) {
    return loaded.buffer;
  }

  const zip = new PizZip(loaded.buffer);
  for (const [partName, rowXml] of rowXmlParts) {
    if (rowXml.extensions.size === 0) continue;
    const xml = zip.file(partName).asText();
    zip.file(partName, replaceXmlRanges(
      xml,
      [...rowXml.extensions.values()].map(extension => ({
        start: extension.start,
        end: extension.end,
        value: '',
      })),
    ));
  }
  if (needsCanonicalSheetOrder) {
    const workbookRoot = await parseXml(zip, 'xl/workbook.xml');
    const sheetsNodes = elementChildren(workbookRoot, 'sheets');
    if (sheetsNodes.length !== 1) fail('invalid_ooxml_package');
    const partIndexByRelationship = new Map(
      loaded.workbookSheetInspection.sheetRecords.map(record => [
        record.relationshipId,
        record.partIndex,
      ]),
    );
    sheetsNodes[0].children = [...sheetsNodes[0].children].sort((left, right) => {
      const leftIndex = partIndexByRelationship.get(String(attribute(left, 'r:id') || ''));
      const rightIndex = partIndexByRelationship.get(String(attribute(right, 'r:id') || ''));
      if (!leftIndex || !rightIndex) fail('invalid_ooxml_package');
      return leftIndex - rightIndex;
    });
    zip.file('xl/workbook.xml', new XmlBuilder().build(workbookRoot));
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function loadWorkbookForProcessing(filePath, limits = {}) {
  const { expectedExtension, ...packageLimits } = limits;
  const loaded = await loadPackage(filePath, packageLimits);
  await assertExpectedWorkbookType(loaded, expectedExtension);
  try {
    return await XlsxPopulate.fromDataAsync(await xlsxPopulateCompatibleBuffer(loaded));
  } catch (error) {
    if (error instanceof WorkbookIntegrityError) throw error;
    fail('invalid_ooxml_package');
  }
}

async function assertPackageLimits(filePath, limits = {}) {
  const { expectedExtension, ...packageLimits } = limits;
  const loaded = await loadPackage(filePath, packageLimits);
  await assertExpectedWorkbookType(loaded, expectedExtension);
  return {
    compressedBytes: loaded.compressedBytes,
    uncompressedBytes: loaded.uncompressedBytes,
    entryCount: Object.keys(loaded.zip.files).length,
    cellCount: loaded.cellCount,
  };
}

function restoreWorksheetRowExtensions(input, output) {
  const inputParts = input.worksheetInspection.rowXmlParts;
  const outputParts = output.worksheetInspection.rowXmlParts;
  for (const [partName, outputPart] of outputParts) {
    const inputPart = inputParts.get(partName);
    for (const [rowNumber, extension] of outputPart.extensions) {
      if (inputPart?.extensions.get(rowNumber)?.xml !== extension.xml) {
        fail('sheet_structure_changed');
      }
    }
  }

  for (const [partName, inputPart] of inputParts) {
    if (inputPart.extensions.size === 0) continue;
    const outputPart = outputParts.get(partName);
    const outputFile = output.zip.file(partName);
    if (!outputPart || !outputFile) fail('sheet_structure_changed');
    const xml = outputFile.asText();
    const replacements = [];
    for (const [rowNumber, extension] of inputPart.extensions) {
      const existing = outputPart.extensions.get(rowNumber);
      if (existing) {
        replacements.push({ start: existing.start, end: existing.end, value: extension.xml });
        continue;
      }
      const row = outputPart.rows.get(rowNumber);
      if (!row) fail('sheet_structure_changed');
      if (row.selfClosing) {
        const startTag = xml.slice(row.start, row.startTagEnd);
        if (!/\/\s*>$/.test(startTag)) fail('sheet_structure_changed');
        replacements.push({
          start: row.start,
          end: row.startTagEnd,
          value: `${startTag.replace(/\/\s*>$/, '>')}${extension.xml}</${row.name}>`,
        });
      } else {
        if (!Number.isInteger(row.closeStart)) fail('sheet_structure_changed');
        replacements.push({ start: row.closeStart, end: row.closeStart, value: extension.xml });
      }
    }
    output.zip.file(partName, replaceXmlRanges(xml, replacements));
  }
}

async function restoreProtectedParts(inputPath, outputPath) {
  const [input, output] = await Promise.all([
    loadPackage(inputPath),
    loadPackage(outputPath, { validateRelationships: false }),
  ]);
  const inputNames = [...input.protectedParts.keys()];
  const outputNames = [...output.protectedParts.keys()];
  const inputNameSet = new Set(inputNames);
  if (outputNames.some(name => !inputNameSet.has(name))) {
    fail('protected_part_set_changed');
  }

  for (const name of inputNames) {
    output.zip.file(name, Buffer.from(input.zip.file(name).asUint8Array()));
  }
  restoreWorksheetRowExtensions(input, output);
  await fs.writeFile(outputPath, output.zip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  }));
}

function macroSnapshot(contentTypesRoot) {
  const overrides = descendants(contentTypesRoot, 'Override');
  const overrideDeclarations = overrides.map(node => ({
    kind: 'override',
    partName: String(attribute(node, 'PartName') || ''),
    contentType: String(attribute(node, 'ContentType') || ''),
  }));
  const defaultDeclarations = descendants(contentTypesRoot, 'Default').map(node => ({
    kind: 'default',
    extension: String(attribute(node, 'Extension') || ''),
    contentType: String(attribute(node, 'ContentType') || ''),
  }));
  const declarations = [...overrideDeclarations, ...defaultDeclarations];
  const workbookDeclaration = overrideDeclarations.find(
    item => item.partName === '/xl/workbook.xml',
  );
  return {
    macroWorkbook: Boolean(
      workbookDeclaration
      && /macroEnabled\.main\+xml$/i.test(workbookDeclaration.contentType)
    ),
    vbaDeclarations: declarations
      .filter(item => (
        /vbaProject/i.test(item.contentType)
        || /vbaProject/i.test(item.partName || '')
        || /vbaProject/i.test(item.extension || '')
      ))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
}

function normalizeRichText(richText) {
  return {
    kind: 'rich-text',
    fragments: canonicalNode(richText.toXml()),
  };
}

function normalizeValue(value) {
  if (value === undefined) return { kind: 'undefined' };
  if (value === null) return { kind: 'null' };
  if (value instanceof Date) return { kind: 'date', value: value.toISOString() };
  if (value instanceof XlsxPopulate.RichText) return normalizeRichText(value);
  if (Buffer.isBuffer(value)) return { kind: 'buffer', value: value.toString('base64') };
  if (typeof value === 'object') {
    const normalized = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeValue(item)]);
    return { kind: 'object', value: normalized };
  }
  return { kind: typeof value, value: String(value) };
}

function relationTarget(target) {
  const raw = String(target || '').replace(/\\/g, '/');
  if (raw.startsWith('/')) return raw.slice(1);
  return path.posix.normalize(path.posix.join('xl', raw));
}

function worksheetXmlSnapshot(root, rowXml) {
  const rowNodes = worksheetRows(root);
  const cells = rowNodes.flatMap(row => elementChildren(row, 'c'));
  if (cells.length > DEFAULT_MAX_CELL_COUNT) fail('package_too_large');
  const formulas = [];
  const cellStyles = [];
  const cellReferences = [];
  for (const cell of cells) {
    const reference = String(attribute(cell, 'r') || '');
    if (!reference) fail('invalid_ooxml_package');
    cellReferences.push(reference);
    cellStyles.push([reference, String(attribute(cell, 's') ?? '0')]);
    const formula = elementChildren(cell, 'f')[0];
    if (formula) formulas.push([reference, canonicalNode(formula)]);
  }
  formulas.sort(([left], [right]) => left.localeCompare(right));
  cellStyles.sort(([left], [right]) => left.localeCompare(right));
  cellReferences.sort((left, right) => left.localeCompare(right));

  const mergeCellsNode = elementChildren(root, 'mergeCells')[0];
  const merges = elementChildren(mergeCellsNode, 'mergeCell')
    .map(node => String(attribute(node, 'ref') || ''))
    .sort();
  const rows = rowNodes
    .map(node => ({
      reference: String(attribute(node, 'r') || ''),
      attributes: canonicalNode({ name: 'row', attributes: node.attributes, children: [] }).attributes,
      extensionList: rowXml.extensions.get(
        worksheetRowNumber(attribute(node, 'r')),
      )?.xml || null,
    }))
    .sort((left, right) => left.reference.localeCompare(right.reference, undefined, { numeric: true }));
  const columnsNode = elementChildren(root, 'cols')[0];
  const structures = elementChildren(root)
    .filter(node => WORKSHEET_STRUCTURE_NODES.has(localName(node.name)))
    .map(canonicalNode)
    .filter(node => !(
      node.name === 'sheetPr'
      && node.attributes.length === 0
      && node.children.length === 0
    ));

  return {
    merges,
    formulas,
    cellStyles,
    cellReferences,
    dimensions: {
      rows,
      columns: columnsNode ? canonicalNode(columnsNode) : null,
    },
    structures,
  };
}

function displayedCellValues(sheet, formulaReferences, cellReferences) {
  const values = [];
  const formulas = new Set(formulaReferences);
  for (const reference of cellReferences) {
    if (formulas.has(reference)) continue;
    const cell = sheet.cell(reference);
    values.push([reference, normalizeValue(cell.value())]);
  }
  values.sort(([left], [right]) => left.localeCompare(right));
  return values;
}

async function snapshotFromPackage(loaded) {
  const { zip } = loaded;
  const contentTypes = loaded.contentTypesRoot;
  const workbookRoot = await parseXml(zip, 'xl/workbook.xml');
  const relationshipsRoot = await parseXml(zip, 'xl/_rels/workbook.xml.rels');
  const workbookRelationships = relationshipRecords(
    relationshipsRoot,
    WORKBOOK_RELATIONSHIPS_PART,
  );
  const relationshipMap = new Map(descendants(relationshipsRoot, 'Relationship').map(node => [
    String(attribute(node, 'Id') || ''),
    relationTarget(attribute(node, 'Target')),
  ]));
  const sheetNodes = descendants(workbookRoot, 'sheet');
  let workbook;
  try {
    workbook = await XlsxPopulate.fromDataAsync(await xlsxPopulateCompatibleBuffer(loaded));
  } catch (error) {
    if (error instanceof WorkbookIntegrityError) throw error;
    fail('invalid_ooxml_package');
  }
  const sheets = [];

  for (const sheetNode of sheetNodes) {
    const name = String(attribute(sheetNode, 'name') || '');
    const relationshipId = String(attribute(sheetNode, 'r:id') || '');
    const partName = relationshipMap.get(relationshipId);
    if (!partName || !zip.file(partName)) fail('invalid_ooxml_package');
    const worksheetRoot = await parseXml(zip, partName);
    const rowXml = loaded.worksheetInspection.rowXmlParts.get(partName);
    if (!rowXml) fail('invalid_ooxml_package');
    const xmlSnapshot = worksheetXmlSnapshot(worksheetRoot, rowXml);
    const sheet = workbook.sheet(name);
    if (!sheet) fail('invalid_ooxml_package');
    sheets.push({
      name,
      state: String(attribute(sheetNode, 'state') || 'visible'),
      relationshipId,
      partName,
      merges: xmlSnapshot.merges,
      formulas: xmlSnapshot.formulas,
      cellStyles: xmlSnapshot.cellStyles,
      dimensions: xmlSnapshot.dimensions,
      structures: xmlSnapshot.structures,
      values: displayedCellValues(
        sheet,
        xmlSnapshot.formulas.map(([reference]) => reference),
        xmlSnapshot.cellReferences,
      ),
    });
  }

  const definedNames = firstDescendant(workbookRoot, 'definedNames');
  const stylesFile = zip.file('xl/styles.xml');
  const styles = stylesFile
    ? canonicalStyles(await parseXml(zip, 'xl/styles.xml'))
    : null;
  return {
    macro: macroSnapshot(contentTypes),
    contentTypes: loaded.contentTypes,
    workbookRelationships,
    protectedParts: loaded.protectedParts,
    sheetMetadata: sheets.map(sheet => ({
      name: sheet.name,
      state: sheet.state,
      relationshipId: sheet.relationshipId,
      partName: sheet.partName,
    })),
    definedNames: definedNames ? canonicalNode(definedNames) : null,
    styles,
    sheets,
  };
}

async function snapshotWorkbook(filePath, limits = {}) {
  return snapshotFromPackage(await loadPackage(filePath, limits));
}

function compareProtectedParts(input, output) {
  const inputNames = [...input.keys()];
  const outputNames = [...output.keys()];
  if (!same(inputNames, outputNames)) fail('protected_part_set_changed');
  for (const name of inputNames) {
    if (input.get(name) !== output.get(name)) fail('protected_part_changed');
  }
}

function compareContentTypes(input, output) {
  for (const [partName, contentType] of input) {
    if (output.get(partName) !== contentType) fail('content_types_changed');
  }
  for (const partName of output.keys()) {
    if (input.has(partName)) continue;
    if (partName !== 'xl/sharedStrings.xml') fail('content_types_changed');
  }
}

function compareWorkbookRelationships(input, output) {
  const outputRecords = new Set(output.map(record => JSON.stringify(record)));
  for (const record of input) {
    if (!outputRecords.has(JSON.stringify(record))) fail('workbook_relationships_changed');
  }
  const inputRecords = new Set(input.map(record => JSON.stringify(record)));
  for (const record of output) {
    if (inputRecords.has(JSON.stringify(record))) continue;
    if (!/\/sharedStrings$/i.test(record.type)) fail('workbook_relationships_changed');
  }
}

function compareCellValues(inputSheet, outputSheet, changedCells) {
  const inputValues = new Map(inputSheet.values);
  const outputValues = new Map(outputSheet.values);
  const references = new Set([...inputValues.keys(), ...outputValues.keys()]);
  for (const reference of references) {
    if (same(inputValues.get(reference), outputValues.get(reference))) continue;
    if (!changedCells.has(`${inputSheet.name}!${reference}`)) {
      fail('unexpected_cell_change');
    }
  }
}

async function validateWorkbookIntegrity({
  inputPath,
  outputPath,
  changedCells = new Set(),
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
} = {}) {
  const limits = { maxUncompressedBytes };
  const inputPackage = await loadPackage(inputPath, limits);
  const outputPackage = await loadPackage(outputPath, limits);
  compareProtectedParts(inputPackage.protectedParts, outputPackage.protectedParts);

  const [input, output] = await Promise.all([
    snapshotFromPackage(inputPackage),
    snapshotFromPackage(outputPackage),
  ]);
  if (!same(input.macro, output.macro)) fail('macro_container_changed');
  compareContentTypes(input.contentTypes, output.contentTypes);
  compareWorkbookRelationships(input.workbookRelationships, output.workbookRelationships);
  if (!same(input.sheetMetadata, output.sheetMetadata)) fail('sheet_structure_changed');
  if (!same(input.definedNames, output.definedNames)) fail('defined_names_changed');
  if (!same(input.styles, output.styles)) fail('styles_changed');

  for (let index = 0; index < input.sheets.length; index += 1) {
    const inputSheet = input.sheets[index];
    const outputSheet = output.sheets[index];
    if (!outputSheet) fail('sheet_structure_changed');
    if (!same(inputSheet.merges, outputSheet.merges)) fail('merge_changed');
    if (!same(inputSheet.dimensions, outputSheet.dimensions)) fail('dimensions_changed');
    if (!same(inputSheet.formulas, outputSheet.formulas)) fail('formula_changed');
    if (!same(inputSheet.cellStyles, outputSheet.cellStyles)) fail('cell_style_changed');
    if (!same(inputSheet.structures, outputSheet.structures)) fail('worksheet_structure_changed');
    compareCellValues(inputSheet, outputSheet, changedCells);
  }
  return true;
}

module.exports = {
  DEFAULT_MAX_COMPRESSED_BYTES,
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
  DEFAULT_MAX_ENTRY_COUNT,
  DEFAULT_MAX_CELL_COUNT,
  PROTECTED,
  WorkbookIntegrityError,
  assertPackageLimits,
  loadWorkbookForProcessing,
  restoreProtectedParts,
  snapshotWorkbook,
  validateWorkbookIntegrity,
};
