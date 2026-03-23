'use strict';
const fs     = require('fs');
const path   = require('path');
const PizZip = require('pizzip');

const TEMPLATE_PATH = process.pkg
  ? path.join(path.dirname(process.execPath), 'templates', 'TOMY-A-DOC-template.docx')
  : path.join(__dirname, '..', 'templates', 'TOMY-A-DOC-template.docx');

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Extract all <w:tc>...</w:tc> blocks from a row XML
function getCells(rowXml) {
  const cells = [];
  let pos = 0;
  while (true) {
    const s = rowXml.indexOf('<w:tc>', pos);
    if (s === -1) break;
    const e = rowXml.indexOf('</w:tc>', s) + 7;
    cells.push(rowXml.slice(s, e));
    pos = e;
  }
  return cells;
}

// Replace ONLY the first <w:t>...</w:t> content in a cell — keeps all XML intact
// Also fix w:hint to "default" so Latin chars use Times New Roman, CJK chars use 等线
function fillCell(cellXml, text) {
  const escaped = escapeXml(text);
  let done = false;
  let result = cellXml.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/, (_, attrs) => {
    if (done) return _;
    done = true;
    return `<w:t xml:space="preserve">${escaped}</w:t>`;
  });
  // Fix hint so Word/WPS uses the correct font per character type
  result = result.replace(/w:hint="eastAsia"/g, 'w:hint="default"');
  return result;
}

// Build one data row from the template row XML
function buildRow(templateRowXml, no, r) {
  const cells = getCells(templateRowXml);
  if (cells.length < 8) return templateRowXml;

  const filled = [
    fillCell(cells[0], no),
    fillCell(cells[1], r.substanceName         || ''),
    fillCell(cells[2], r.casNumber             || ''),
    fillCell(cells[3], r.category              || ''),
    fillCell(cells[4], r.concProduct           || ''),
    fillCell(cells[5], r.concHM               || ''),
    fillCell(cells[6], r.materialDescription   || ''),
    fillCell(cells[7], 'Yes'),
  ];

  // Preserve trPr (row height etc.) from template
  const trPrMatch = templateRowXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/);
  const trPr = trPrMatch ? trPrMatch[0] : '';
  return `<w:tr>${trPr}${filled.join('')}</w:tr>`;
}

/**
 * Generate A-DOC by filling the TOMY Word template.
 */
async function generateAdoc(records, supplierName, _materialName, signerName) {
  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip  = new PizZip(templateBuf);
  let   xml  = zip.file('word/document.xml').asText();

  // ── 1. Replace supplier name placeholder ─────────────────────────────────
  // Template has: 供应商名称（[blank runs]）
  // Strategy: remove all runs between end-of-（-run and start-of-）-run,
  // then insert a single run with the supplier name (using indexOf, no regex).
  const openChar  = '\uff08'; // （
  const closeChar = '\uff09'; // ）

  const openTIdx  = xml.indexOf(`${openChar}</w:t>`);
  const closeTIdx = xml.indexOf(`${closeChar}</w:t>`);

  if (openTIdx !== -1 && closeTIdx !== -1 && openTIdx < closeTIdx) {
    const openRunEnd    = xml.indexOf('</w:r>', openTIdx)  + 6;  // end of （ run
    const r1 = xml.lastIndexOf('<w:r>', closeTIdx);
    const r2 = xml.lastIndexOf('<w:r ', closeTIdx);
    const closeRunStart = Math.max(r1, r2);                       // start of ） run

    // Extract rPr from the ） run to keep font style
    const closeRunXml = xml.slice(closeRunStart, closeTIdx);
    const rPrM = closeRunXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr  = rPrM ? `<w:rPr>${rPrM[1]}</w:rPr>` : '';

    const nameText = supplierName ? escapeXml(supplierName) : '                    ';
    const newRun   = `<w:r>${rPr}<w:t xml:space="preserve">${nameText}</w:t></w:r>`;

    // Remove blank runs between （ and ）, insert supplier name
    xml = xml.slice(0, openRunEnd) + newRun + xml.slice(closeRunStart);
  }

  // ── 1b. Fill Signed Date with today's date ───────────────────────────────
  const dateAteIdx = xml.indexOf('ate\uff1a</w:t>');
  if (dateAteIdx !== -1) {
    const uIdx = xml.indexOf('<w:u w:val="single"/>', dateAteIdx);
    if (uIdx !== -1) {
      const tOpen  = xml.indexOf('<w:t', uIdx);
      const tClose = xml.indexOf('</w:t>', tOpen) + 6;
      const now = new Date();
      const dateStr = `${now.getFullYear()}.${now.getMonth()+1}.${now.getDate()}`;
      xml = xml.slice(0, tOpen)
        + `<w:t xml:space="preserve">${escapeXml(dateStr)}</w:t>`
        + xml.slice(tClose);
    }
  }

  // ── 2. Replace data rows in the second table ─────────────────────────────
  const tbl1End   = xml.indexOf('</w:tbl>') + 8;
  const tbl2Start = xml.indexOf('<w:tbl>', tbl1End);
  const tbl2End   = xml.indexOf('</w:tbl>', tbl2Start) + 8;
  let   tbl2      = xml.slice(tbl2Start, tbl2End);



  const allRows = [...tbl2.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)];
  if (allRows.length < 2) {
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  const headerRow   = allRows[0][0];   // keep unchanged
  const templateRow = allRows[1][0];   // use as template for all data rows

  const newRows = records.map((r, i) => buildRow(templateRow, i + 1, r));

  // Rebuild table: tblPr + tblGrid + header + data rows
  const tblPrEnd = tbl2.indexOf('</w:tblPr>') + 10;
  // Include tblGrid if present
  const gridEnd  = tbl2.indexOf('</w:tblGrid>');
  const prefix   = gridEnd !== -1
    ? tbl2.slice(0, gridEnd + 12)
    : tbl2.slice(0, tblPrEnd);

  const newTbl2 = `${prefix}${headerRow}${newRows.join('')}</w:tbl>`;
  xml = xml.slice(0, tbl2Start) + newTbl2 + xml.slice(tbl2End);

  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { generateAdoc };
