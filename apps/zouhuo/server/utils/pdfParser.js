'use strict';
const PDFParser = require('pdf2json');

function parseTomyPDF(pdfBuffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataError', reject);
    parser.on('pdfParser_dataReady', pdfData => {
      try { resolve(extractRecords(pdfData)); }
      catch (e) { reject(e); }
    });
    parser.parseBuffer(pdfBuffer);
  });
}

function extractRecords(pdfData) {
  const allItems = [];
  pdfData.Pages.forEach((page, pi) => {
    page.Texts.forEach(t => {
      const txt = t.R.map(r => { try { return decodeURIComponent(r.T); } catch { return r.T; } }).join('');
      if (txt.trim()) allItems.push({ x: t.x, y: t.y + pi * 200, txt });
    });
  });
  allItems.sort((a, b) => a.y - b.y || a.x - b.x);

  // Group into rows by Y (tolerance 0.35)
  const rows = [];
  for (const item of allItems) {
    const row = rows.find(r => Math.abs(r.y - item.y) < 0.35);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));

  const getRange = (items, xMin, xMax) =>
    items.filter(i => i.x >= xMin && i.x < xMax)
      .map(i => i.txt.trim()).filter(Boolean).join(' ').trim();

  // ── Auto-calibrate column positions from data rows ────────────────────────
  // Strategy: find rows that have a material code (2+ letters + 2+ digits) in
  // the broad x range 14–22, detect its left edge → xMatCode.
  // Then derive other column positions proportionally.
  const matCodePattern = /^[A-Z]{2,}\d{2,}/;
  let xMatCodeSum = 0, xMatCodeCount = 0;

  for (const row of rows) {
    // Look in broad range to find material code
    const candidates = row.items.filter(i => i.x >= 13.5 && i.x <= 22);
    if (!candidates.length) continue;
    const text = candidates.map(i => i.txt.trim()).join('').trim();
    if (!matCodePattern.test(text)) continue;
    // x of the first character
    xMatCodeSum += candidates[0].x;
    xMatCodeCount++;
    if (xMatCodeCount >= 10) break; // enough samples
  }

  // Fall back to E73622A default if no data rows detected yet
  const xMatCode = xMatCodeCount > 0 ? xMatCodeSum / xMatCodeCount : 16.23;

  // Column bounds derived from detected xMatCode
  // These offsets are averaged from E73622A and E73635A measurements
  const xCas        = xMatCode - 10.9;  // ~5.3 for both
  const xCasEnd     = xCas + 2.1;       // wider to capture hyphen at ~xCas+1.8
  const xCat        = xCas + 2.9;       // skip EINECS column
  const xConcProd   = xMatCode - 5.05;  // 11.23 / 10.34 → offset ~5.05
  const xConcHM     = xMatCode - 2.47;  // 13.80 / 13.01 → offset ~2.47
  const xConcProdEnd = xConcHM - 0.1;
  const xConcHMEnd  = xMatCode - 0.2;
  const xMatCodeEnd = xMatCode + 2.5;
  const xDesc       = xMatCode + 4.5;   // 20.68 / 20.14 → offset ~4.5
  const xCatEnd     = xConcProd - 0.1;
  const xDescEnd    = xDesc + 2.5;

  const isDataRow = row => {
    const mid = getRange(row.items, xMatCode - 0.3, xMatCodeEnd).replace(/\s/g, '');
    return matCodePattern.test(mid);
  };

  const dataRowIndices = rows.reduce((acc, row, ri) => {
    if (isDataRow(row)) acc.push(ri);
    return acc;
  }, []);

  const getMaterialCode = row => {
    const raw = getRange(row.items, xMatCode - 0.3, xMatCodeEnd).replace(/\s/g, '');
    return raw.match(/^[A-Z]+\d+/i)?.[0] || raw;
  };

  const getConcentrations = row => ({
    concProduct: getRange(row.items, xConcProd - 0.2, xConcProdEnd).replace(/\s/g, ''),
    concHM:      getRange(row.items, xConcHM - 0.2, xConcHMEnd).replace(/\s/g, ''),
  });

  // Words that indicate a table header row rather than real description data
  const HEADER_RE = /^(Description|Remark|Material|Substance|Concentration|Homogeneous|Accessible|Packing|Document|Supplier|Action|Category|EINECS|CAS|No\.|YES|NO\.?)$/i;

  // Description helper rows
  const descByDataIdx = {};
  for (let ri = 0; ri < rows.length; ri++) {
    if (dataRowIndices.includes(ri)) continue;
    const descText = getRange(rows[ri].items, xDesc - 0.2, xDescEnd);
    if (!descText) continue;
    // Skip rows whose description-column text is just a header word
    if (descText.split(/\s+/).every(w => HEADER_RE.test(w))) continue;
    let bestIdx = null, bestDist = Infinity;
    for (const di of dataRowIndices) {
      const dist = Math.abs(rows[di].y - rows[ri].y);
      if (dist < bestDist) { bestDist = dist; bestIdx = di; }
    }
    if (bestIdx !== null && bestDist < 3.0) {
      if (!descByDataIdx[bestIdx]) descByDataIdx[bestIdx] = [];
      descByDataIdx[bestIdx].push({ y: rows[ri].y, text: descText });
    }
  }

  const getDescription = dataRowIdx => {
    const dataRow = rows[dataRowIdx];
    const parts = [...(descByDataIdx[dataRowIdx] || [])];
    const ownDesc = getRange(dataRow.items, xDesc - 0.2, xDescEnd);
    if (ownDesc) parts.push({ y: dataRow.y, text: ownDesc });
    return parts.sort((a, b) => a.y - b.y).map(p => p.text).join(' ').trim();
  };

  // Substance NO. rows (single integer at x≈1.5–2.3)
  const substanceNoRows = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const noText = getRange(rows[ri].items, 1.5, 2.3).replace(/\s/g, '');
    if (/^\d{1,3}$/.test(noText) && !dataRowIndices.includes(ri)) {
      substanceNoRows.push({ ri, no: parseInt(noText) });
    }
  }

  // Build substance blocks
  const substances = [];
  for (let si = 0; si < substanceNoRows.length; si++) {
    const noRi = substanceNoRows[si].ri;
    const nextNoRi = si + 1 < substanceNoRows.length ? substanceNoRows[si + 1].ri : rows.length;
    const myDataRowIndices = dataRowIndices.filter(di => di > noRi && di < nextNoRi);
    const firstDataRi = myDataRowIndices[0] !== undefined ? myDataRowIndices[0] : nextNoRi;

    let headerStart;
    if (si === 0) {
      headerStart = Math.max(0, noRi - 2);
    } else {
      const prevSubst = substances[si - 1];
      const prevLastDataRi = prevSubst.dataRowIndices.length > 0
        ? prevSubst.dataRowIndices[prevSubst.dataRowIndices.length - 1]
        : prevSubst.noRi;
      headerStart = prevLastDataRi + 1;
    }

    const nameParts = [], casParts = [], catParts = [];
    for (let ri = headerStart; ri <= firstDataRi - 1 && ri < rows.length; ri++) {
      if (isDataRow(rows[ri])) continue;
      const name = getRange(rows[ri].items, 2.2, xCas);
      // Substance names sometimes overflow just past xCas boundary.
      // Only non-digit/non-hyphen chars there belong to the name (digits belong to CAS).
      const boundary = rows[ri].items
        .filter(i => i.x >= xCas && i.x < xCas + 0.5)
        .map(i => i.txt.trim()).join('');
      const nameOverflow = boundary.replace(/[\d-]/g, '');
      const cas  = getRange(rows[ri].items, xCas, xCasEnd);
      const cat  = getRange(rows[ri].items, xCat, xCatEnd);
      // Only append overflow if there's real name content in [2.2, xCas) on this row
      // (avoids pulling in "Nu" from column header "Number" when the name zone is empty)
      const fullName = name ? (name + nameOverflow).trim() : name;
      if (fullName) nameParts.push(fullName);
      if (cas)  casParts.push(cas);
      if (cat)  catParts.push(cat);
    }

    substances.push({
      no: substanceNoRows[si].no,
      noRi,
      substanceName: nameParts.join(' '),
      casNumber: (() => {
        const raw = casParts.join('').replace(/\s/g, '');
        const cleaned = raw.replace(/[^0-9-]/g, '');
        return cleaned.match(/\d{2,7}-\d{2}-\d/)?.[0] || raw;
      })(),
      category: catParts.join(''),
      dataRowIndices: myDataRowIndices,
    });
  }

  const records = [];
  for (const subst of substances) {
    for (const di of subst.dataRowIndices) {
      const row = rows[di];
      const { concProduct, concHM } = getConcentrations(row);
      const materialCode = getMaterialCode(row);
      const materialDescription = getDescription(di);
      records.push({
        substanceName: subst.substanceName,
        casNumber: subst.casNumber,
        category: subst.category,
        concProduct,
        concHM,
        materialCode,
        materialDescription,
      });
    }
  }

  return records;
}

module.exports = { parseTomyPDF };
