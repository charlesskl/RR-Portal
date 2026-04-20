const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const CONFIRMED_PATH = path.join(__dirname, '../data/confirmed.json');

// Color sets for detection (ARGB format, case-insensitive)
const YELLOW_COLORS = new Set([
  'FFFFFF00', 'FFFFC000', 'FFFFF2CC', 'FFFFEB9C', 'FFFFFF99',
  'FFFFD966', 'FFFFFFE0', 'FFFFED00', 'FFFFCC00'
]);

const BLUE_COLORS = new Set([
  'FF9DC3E6', 'FF4472C4', 'FFBDD7EE', 'FF2E75B6', 'FF9BC2E6',
  'FF00B0F0', 'FF0070C0', 'FFB8CCE4', 'FFDAE3F3', 'FF1F77B4'
]);

function getConfirmed() {
  try {
    return JSON.parse(fs.readFileSync(CONFIRMED_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function isYellow(argb) {
  if (!argb) return false;
  return YELLOW_COLORS.has(argb.toUpperCase());
}

function isBlue(argb) {
  if (!argb) return false;
  return BLUE_COLORS.has(argb.toUpperCase());
}

function getRowColor(row) {
  // Check first 10 cells for color
  for (let col = 1; col <= 10; col++) {
    const cell = row.getCell(col);
    const fill = cell.fill;
    if (fill && fill.type === 'pattern' && fill.fgColor) {
      const argb = fill.fgColor.argb;
      if (isYellow(argb)) return 'yellow';
      if (isBlue(argb)) return 'blue';
    }
  }
  return null;
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  // ExcelJS rich text: { richText: [{ text: '...' }, ...] }
  if (value && typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map(r => r.text || '').join('');
  }
  // ExcelJS formula result: { formula: '...', result: ... }
  if (value && typeof value === 'object' && 'result' in value) {
    return cellToString(value.result);
  }
  // Date
  if (value instanceof Date) {
    return value.toLocaleDateString('zh-CN');
  }
  return String(value);
}

function rowToData(row, headers) {
  const data = {};
  headers.forEach((header, index) => {
    if (header) {
      const cell = row.getCell(index + 1);
      data[header] = cellToString(cell.value);
    }
  });
  return data;
}

function makeKey(clientName, rowData) {
  const po = rowData['合同'] || rowData['PO'] || rowData['订单号'] || '';
  const itemNo = rowData['货号'] || rowData['产品编号'] || '';
  return `${clientName}|${po}|${itemNo}`.toLowerCase().replace(/\s+/g, '');
}

async function scanFile(filePath, clientName) {
  const confirmed = getConfirmed();
  const results = [];

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    for (const worksheet of workbook.worksheets) {
      let headers = [];
      let headerRowIndex = 0;

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (headerRowIndex === 0) {
          const rowValues = row.values.slice(1);
          if (rowValues.some(v => v !== null && v !== undefined)) {
            headers = rowValues.map(v => (v ? String(v).trim() : null));
            headerRowIndex = rowNumber;
          }
          return;
        }

        const color = getRowColor(row);
        if (!color) return;

        const data = rowToData(row, headers);
        const key = makeKey(clientName, data);

        if (confirmed.includes(key)) return;

        results.push({
          key,
          type: color === 'yellow' ? 'new' : 'modified',
          client: clientName,
          file: path.basename(filePath),
          sheet: worksheet.name,
          data
        });
      });
    }
  } catch (err) {
    console.error(`Error scanning ${filePath}:`, err.message);
  }

  return results;
}

async function scanAllClients(scanDir) {
  const allResults = [];
  const errors = [];

  let clientFolders;
  try {
    clientFolders = fs.readdirSync(scanDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    throw new Error(`Cannot read scan directory: ${scanDir} - ${err.message}`);
  }

  for (const clientName of clientFolders) {
    const clientDir = path.join(scanDir, clientName);
    let files;
    try {
      files = fs.readdirSync(clientDir)
        .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(clientDir, file);
      try {
        const results = await scanFile(filePath, clientName);
        allResults.push(...results);
      } catch (err) {
        errors.push({ file, error: err.message });
      }
    }
  }

  return { results: allResults, errors };
}

function confirmOrders(keys) {
  const confirmed = getConfirmed();
  const newConfirmed = [...new Set([...confirmed, ...keys])];
  fs.writeFileSync(CONFIRMED_PATH, JSON.stringify(newConfirmed, null, 2));
  return newConfirmed.length - confirmed.length;
}

module.exports = { scanAllClients, confirmOrders };
