const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const PizZip = require('pizzip');
const XlsxPopulate = require('xlsx-populate');
const XmlParser = require('xlsx-populate/lib/XmlParser');

const DEFAULT_MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

const PROTECTED = [
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
  /^xl\/vbaProject.*\.bin$/,
  /_rels\/.*\.rels$/,
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

async function assertRelationshipTargets(zip) {
  const relationshipParts = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && name.endsWith('.rels'))
    .sort();
  for (const partName of relationshipParts) {
    const root = await parseXml(zip, partName);
    for (const relationship of descendants(root, 'Relationship')) {
      if (String(attribute(relationship, 'TargetMode') || '').toLowerCase() === 'external') {
        continue;
      }
      const targetPart = internalRelationshipTarget(
        partName,
        attribute(relationship, 'Target'),
      );
      if (!zip.file(targetPart)) fail('relationship_target_missing');
    }
  }
}

function protectedHashes(zip) {
  const hashes = new Map();
  for (const name of Object.keys(zip.files).sort()) {
    const file = zip.files[name];
    if (file.dir || !PROTECTED.some(pattern => pattern.test(name))) continue;
    const data = Buffer.from(file.asUint8Array());
    hashes.set(name, crypto.createHash('sha256').update(data).digest('hex'));
  }
  return hashes;
}

async function loadPackage(filePath, {
  maxCompressedBytes = DEFAULT_MAX_COMPRESSED_BYTES,
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
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
  try {
    for (const file of Object.values(zip.files)) {
      if (file.dir) continue;
      const recordedSize = file._data && Number(file._data.uncompressedSize);
      const size = Number.isFinite(recordedSize)
        ? recordedSize
        : file.asUint8Array().byteLength;
      uncompressedBytes += size;
      if (uncompressedBytes > maxUncompressedBytes) fail('package_too_large');
    }
  } catch (error) {
    if (error instanceof WorkbookIntegrityError) throw error;
    fail('invalid_ooxml_package');
  }

  if (validateRelationships) await assertRelationshipTargets(zip);

  return {
    buffer,
    zip,
    compressedBytes: buffer.length,
    uncompressedBytes,
    protectedParts: protectedHashes(zip),
  };
}

async function assertPackageLimits(filePath, limits = {}) {
  const loaded = await loadPackage(filePath, limits);
  return {
    compressedBytes: loaded.compressedBytes,
    uncompressedBytes: loaded.uncompressedBytes,
  };
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

function worksheetXmlSnapshot(root) {
  const cells = descendants(root, 'c');
  const formulas = [];
  const cellStyles = [];
  for (const cell of cells) {
    const reference = String(attribute(cell, 'r') || '');
    cellStyles.push([reference, String(attribute(cell, 's') ?? '0')]);
    const formula = elementChildren(cell, 'f')[0];
    if (formula) formulas.push([reference, canonicalNode(formula)]);
  }
  formulas.sort(([left], [right]) => left.localeCompare(right));
  cellStyles.sort(([left], [right]) => left.localeCompare(right));

  const merges = descendants(root, 'mergeCell')
    .map(node => String(attribute(node, 'ref') || ''))
    .sort();
  const rows = descendants(root, 'row')
    .map(node => ({
      reference: String(attribute(node, 'r') || ''),
      attributes: canonicalNode({ name: 'row', attributes: node.attributes, children: [] }).attributes,
    }))
    .sort((left, right) => left.reference.localeCompare(right.reference, undefined, { numeric: true }));
  const columnsNode = firstDescendant(root, 'cols');
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
    dimensions: {
      rows,
      columns: columnsNode ? canonicalNode(columnsNode) : null,
    },
    structures,
  };
}

function displayedCellValues(sheet, formulaReferences) {
  const values = [];
  const range = sheet.usedRange();
  if (!range) return values;
  const formulas = new Set(formulaReferences);
  range.forEach(cell => {
    const reference = cell.address();
    if (formulas.has(reference)) return;
    values.push([reference, normalizeValue(cell.value())]);
  });
  values.sort(([left], [right]) => left.localeCompare(right));
  return values;
}

async function snapshotFromPackage(loaded) {
  const { zip, buffer } = loaded;
  const contentTypes = await parseXml(zip, '[Content_Types].xml');
  const workbookRoot = await parseXml(zip, 'xl/workbook.xml');
  const relationshipsRoot = await parseXml(zip, 'xl/_rels/workbook.xml.rels');
  const relationshipMap = new Map(descendants(relationshipsRoot, 'Relationship').map(node => [
    String(attribute(node, 'Id') || ''),
    relationTarget(attribute(node, 'Target')),
  ]));
  const sheetNodes = descendants(workbookRoot, 'sheet');
  const workbook = await XlsxPopulate.fromDataAsync(buffer);
  const sheets = [];

  for (const sheetNode of sheetNodes) {
    const name = String(attribute(sheetNode, 'name') || '');
    const relationshipId = String(attribute(sheetNode, 'r:id') || '');
    const partName = relationshipMap.get(relationshipId);
    if (!partName || !zip.file(partName)) fail('invalid_ooxml_package');
    const worksheetRoot = await parseXml(zip, partName);
    const xmlSnapshot = worksheetXmlSnapshot(worksheetRoot);
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
      values: displayedCellValues(sheet, xmlSnapshot.formulas.map(([reference]) => reference)),
    });
  }

  const definedNames = firstDescendant(workbookRoot, 'definedNames');
  const stylesFile = zip.file('xl/styles.xml');
  const styles = stylesFile
    ? canonicalStyles(await parseXml(zip, 'xl/styles.xml'))
    : null;
  return {
    macro: macroSnapshot(contentTypes),
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
  PROTECTED,
  WorkbookIntegrityError,
  assertPackageLimits,
  restoreProtectedParts,
  snapshotWorkbook,
  validateWorkbookIntegrity,
};
