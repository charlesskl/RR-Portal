/**
 * Rebuild public templates from a private source directory without transaction data.
 * Usage: ARTIFACT_NODE_MODULES=/path/to/node_modules node scripts/sanitize-public-templates.mjs SOURCE_PUBLIC [--preview]
 * @oai/artifact-tool authors/recalculates contents. A minimal OOXML package preserves
 * the original style indices, blank sample cells, merges, row heights and print setup,
 * which the invoice generators intentionally use as their layout contract.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Pass the private source public/ directory. Originals are never modified.');
const runtime = process.env.ARTIFACT_NODE_MODULES;
const requireRuntime = createRequire(runtime ? path.join(runtime, '_resolver.cjs') : import.meta.url);
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
const { default: JSZip } = await import(pathToFileURL(requireRuntime.resolve('jszip')).href);
const previewOnly = process.argv.includes('--preview');
const scratch = process.env.TEMPLATE_AUDIT_DIR || '/tmp/xingxin-template-audit';
await fs.mkdir(scratch, { recursive: true });
const specs = [
  ['base-master.xlsx', '98631'],
  ['miandan-tpl.xlsx'],
  ['zuru-tpl/兴信-zuru.xlsx'],
  ['other-tpl/兴信香港.xlsx'],
  ['other-tpl/兴信远东.xlsx'],
  ['other-tpl/兴信香港新模板.xlsx'],
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (s, k) => (s.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
const textOf = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
const sheetCells = (xml, sst) => new Map([...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
  const ref = attr(m[1], 'r'), type = attr(m[1], 't'), body = m[2] || '';
  const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  const formula = (body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/) || [])[1];
  const value = type === 's' ? sst[Number(v)] : type === 'inlineStr' ? textOf(body) : v == null ? null : type === 'str' ? unesc(v) : Number(v);
  return [ref, { value, formula: formula && unesc(formula), type }];
}));
const staticLabel = /^(?:USD|PCS|TOTAL|原单价[:：]?|本页合计：|(?:Deposit|Balance)\s+(?:30|50|70|100)%)$/i;
const zuruHeader = new Set(['A1','A2','A4','A5','C7','E7','E8','C10','E10','E11','E13','A14','E14','A16','B16','C16','D16','F16','H16','K18']);

function allowedContents(file, cells) {
  const kept = new Map();
  for (const [ref, cell] of cells) {
    const [, col, rowText] = ref.match(/^([A-Z]+)(\d+)$/);
    const row = Number(rowText), text = typeof cell.value === 'string' ? cell.value.trim() : '';
    // M+ columns are off-print scratch notes, never part of the invoice template.
    if (col.length > 1 || col > 'L') continue;
    // This exact contract identifier is constant across all 510 historical base
    // sheets and all 18 other-customer templates. No other H5 values are retained.
    if ((file === 'base-master.xlsx' || file.startsWith('other-tpl/')) && ref === 'H5' && text === '330783') {
      kept.set(ref, { value: cell.value });
      continue;
    }
    if (file === 'miandan-tpl.xlsx') {
      if (row === 2 && text) kept.set(ref, { value: cell.value });
      if (row === 4 && text === '本页合计：') kept.set(ref, { value: cell.value });
      continue;
    }
    if (file.startsWith('zuru-tpl/') && zuruHeader.has(ref) && text) kept.set(ref, { value: cell.value });
    else if (text && staticLabel.test(text)) kept.set(ref, { value: cell.value });
    // All invoice numbers, dates, PO/item codes, quantities, prices and cached totals
    // are cleared. Only the established totals-area formulas remain.
    if (file.startsWith('other-tpl/') && row >= 41 && row <= 46 && ['I','L'].includes(col) && cell.formula) {
      if (!/^[A-Z0-9:$()+*.,%\s-]+$/i.test(cell.formula) || /\[|!/.test(cell.formula)) throw new Error(`Unexpected total formula at ${file}:${ref}`);
      kept.set(ref, { formula: cell.formula });
    }
  }
  return kept;
}

async function minimalPackage(original, sheets, originalWorkbook, withSourceStrings = false) {
  const zip = new JSZip();
  const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const docNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  zip.file('_rels/.rels', `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${docNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  let rels = '', overrides = '', names = '';
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet.xml);
    rels += `<Relationship Id="rId${i + 1}" Type="${docNs}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
    overrides += `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    // Keep print configuration only, removing all unrelated or historical names.
    for (const m of originalWorkbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
      const name = attr(m[1], 'name');
      if (Number(attr(m[1], 'localSheetId')) === sheet.oldIndex && ['_xlnm.Print_Area', '_xlnm.Print_Titles'].includes(name)) {
        names += `<definedName name="${name}" localSheetId="${i}">${m[2]}</definedName>`;
      }
    }
  }
  const styles = await original.file('xl/styles.xml').async('string');
  zip.file('xl/styles.xml', styles);
  rels += `<Relationship Id="rIdStyles" Type="${docNs}/styles" Target="styles.xml"/>`;
  overrides += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  if (original.file('xl/theme/theme1.xml')) {
    zip.file('xl/theme/theme1.xml', await original.file('xl/theme/theme1.xml').async('string'));
    rels += `<Relationship Id="rIdTheme" Type="${docNs}/theme" Target="theme/theme1.xml"/>`;
    overrides += '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
  }
  if (withSourceStrings && original.file('xl/sharedStrings.xml')) {
    zip.file('xl/sharedStrings.xml', await original.file('xl/sharedStrings.xml').async('string'));
    rels += `<Relationship Id="rIdStrings" Type="${docNs}/sharedStrings" Target="sharedStrings.xml"/>`;
    overrides += '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>';
  }
  zip.file('xl/workbook.xml', `<workbook xmlns="${mainNs}" xmlns:r="${docNs}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" state="visible" r:id="rId${i + 1}"/>`).join('')}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}<calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${relNs}">${rels}</Relationships>`);
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`);
  return zip;
}

function removeAncillary(xml) {
  return xml.replace(/<(?:legacyDrawing|legacyDrawingHF|drawing)\b[^>]*\/>/g, '')
    .replace(/<extLst\b[^>]*>[\s\S]*?<\/extLst>/g, '')
    .replace(/<hyperlinks\b[^>]*>[\s\S]*?<\/hyperlinks>/g, '')
    .replace(/<headerFooter\b[^>]*>[\s\S]*?<\/headerFooter>/g, '');
}

let totalSheets = 0;
for (let bookIndex = 0; bookIndex < specs.length; bookIndex++) {
  const [file, onlySheet] = specs[bookIndex];
  const original = await JSZip.loadAsync(await fs.readFile(path.join(source, file)));
  const wbXml = await original.file('xl/workbook.xml').async('string');
  const relXml = await original.file('xl/_rels/workbook.xml.rels').async('string');
  const relationships = new Map([...relXml.matchAll(/<Relationship\b([^>]+)\/>/g)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const sstXml = original.file('xl/sharedStrings.xml') ? await original.file('xl/sharedStrings.xml').async('string') : '';
  const sst = [...sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheets = [];
  for (const [oldIndex, m] of [...wbXml.matchAll(/<sheet\b([^>]+)\/>/g)].entries()) {
    const name = unesc(attr(m[1], 'name'));
    if (onlySheet && onlySheet !== name) continue;
    let target = relationships.get(attr(m[1], 'r:id')).replace(/^\//, '');
    if (!target.startsWith('xl/')) target = `xl/${target}`;
    const xml = removeAncillary(await original.file(target).async('string'));
    sheets.push({ name, oldIndex, xml, kept: allowedContents(file, sheetCells(xml, sst)) });
  }
  if (!sheets.length) throw new Error(`No required templates in ${file}`);
  const inputZip = await minimalPackage(original, sheets, wbXml, true);
  const inputPath = path.join(scratch, `private-input-${bookIndex}.xlsx`);
  await fs.writeFile(inputPath, await inputZip.generateAsync({ type: 'nodebuffer' }));
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
  if (previewOnly) {
    const png = await workbook.render({ sheetName: sheets[0].name, range: file === 'miandan-tpl.xlsx' ? 'A1:M4' : 'A1:L48', scale: 1, format: 'png' });
    await fs.writeFile(path.join(scratch, `before-${bookIndex}.png`), new Uint8Array(await png.arrayBuffer()));
    console.log(`Preview ${bookIndex}: ${file} (${sheets.length} template sheets)`);
    continue;
  }
  for (const s of sheets) {
    const sheet = workbook.worksheets.getItem(s.name);
    sheet.getUsedRange().clear({ applyTo: 'contents' });
    sheet.deleteAllDrawings();
    for (const [ref, cell] of s.kept) {
      if (cell.formula) sheet.getRange(ref).formulas = [[`=${cell.formula}`]];
      else sheet.getRange(ref).values = [[cell.value]];
    }
  }
  workbook.recalculate();
  const failures = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 20 }, maxChars: 1000 });
  const draft = await SpreadsheetFile.exportXlsx(workbook);
  const draftPath = path.join(scratch, `sanitized-content-${bookIndex}.xlsx`);
  await draft.save(draftPath);
  // Authoritative values were set through Artifact Tool. Retain the original style
  // IDs and exact XML layout required by the existing invoice builders.
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i], sheet = workbook.worksheets.getItem(s.name);
    const computed = new Map();
    for (const [ref, cell] of s.kept) {
      const value = sheet.getRange(ref).values[0][0];
      if (cell.formula && (typeof value !== 'number' || value !== 0)) throw new Error(`Nonzero/invalid blank template total: ${file}:${s.name}!${ref}`);
      computed.set(ref, { ...cell, value });
    }
    s.xml = s.xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_, attrs) => {
      const ref = attr(attrs, 'r'), cell = computed.get(ref), cleanAttrs = attrs.replace(/\s+t="[^"]*"/g, '').replace(/\/$/, '');
      if (!cell) return `<c${cleanAttrs}/>`;
      if (cell.formula) return `<c${cleanAttrs}><f>${esc(cell.formula)}</f><v>${cell.value}</v></c>`;
      return `<c${cleanAttrs} t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`;
    });
  }
  const finalZip = await minimalPackage(original, sheets, wbXml);
  const dest = path.join(root, 'public', file);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, await finalZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const finalWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(dest));
  for (let i = 0; i < sheets.length; i++) {
    const png = await finalWorkbook.render({ sheetName: sheets[i].name, range: file === 'miandan-tpl.xlsx' ? 'A1:M4' : 'A1:L48', scale: 0.75, format: 'png' });
    await fs.writeFile(path.join(scratch, `after-${bookIndex}-${i}.png`), new Uint8Array(await png.arrayBuffer()));
  }
  totalSheets += sheets.length;
  console.log(JSON.stringify({ file, sheets: sheets.length, formulaScan: failures.ndjson, bytes: (await fs.stat(dest)).size }));
}
if (!previewOnly) console.log(`Published ${specs.length} sanitized template workbooks (${totalSheets} sheets).`);
