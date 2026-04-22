const XlsxPopulate = require('xlsx-populate');
const path = require('path');

const TEMPLATE = process.pkg
  ? path.join(path.dirname(process.execPath), 'templates', 'BOM图.xlsx')
  : path.join(__dirname, '..', 'templates', 'BOM图.xlsx');

// Template grid layout (confirmed via XLSX scan):
// - Slots in columns B,D,F,H,J,L,N (7 per band)
// - Bands start at row 7, height 4
// - Within band: +0=index label, +1=qty, +2=partName, +3=material
const COLS = ['B', 'D', 'F', 'H', 'J', 'L', 'N'];
const BAND_START_ROW = 7;
const BAND_HEIGHT = 4;
const SLOTS_PER_BAND = 7;
const MAX_SLOTS = 147;

async function generateBom(rows) {
  const wb = await XlsxPopulate.fromFileAsync(TEMPLATE);
  const sheet = wb.sheet('BOM图');

  rows.slice(0, MAX_SLOTS).forEach((row, i) => {
    const band    = Math.floor(i / SLOTS_PER_BAND);
    const col     = COLS[i % SLOTS_PER_BAND];
    const baseRow = BAND_START_ROW + band * BAND_HEIGHT;

    sheet.cell(`${col}${baseRow + 1}`).value(row.qty      || '');
    sheet.cell(`${col}${baseRow + 2}`).value(row.partName || '');
    sheet.cell(`${col}${baseRow + 3}`).value(row.material || '');
  });

  const buf = await wb.outputAsync();
  return buf;
}

module.exports = { generateBom };
