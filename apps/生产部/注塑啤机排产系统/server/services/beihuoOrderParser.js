const XLSX = require('xlsx');

const LABELS = [
  { key: 'product_code', names: ['\u8d27\u53f7', '\u6b3e\u53f7'] },
  { key: 'mold_no', names: ['\u6a21\u5177\u7f16\u53f7', '\u6a21\u5177\u53f7'] },
  { key: 'mold_name_part', names: ['\u6a21\u5177\u540d\u79f0', '\u5de5\u6a21\u540d\u79f0'] },
  { key: 'total_sets', names: ['\u603b\u5957\u6570'] },
  { key: 'quantity_needed', names: ['\u5564\u6570', '\u9700\u5564\u6570'] },
  { key: 'color', names: ['\u989c\u8272'] },
  { key: 'color_powder_no', names: ['\u8272\u7c89\u53f7', '\u8272\u7c89\u7f16\u53f7'] },
  { key: 'material_type', names: ['\u7528\u6599\u540d\u79f0', '\u7528\u6599', '\u6599\u578b'] },
  { key: 'shot_weight', names: ['\u6574\u5564\u51c0\u91cd', '\u6574\u5564\u91cd\u91cf', '\u5564\u51c0\u91cd', '\u5564\u91cd'] },
  { key: 'material_kg', names: ['\u603b\u51c0\u91cdKG', '\u603b\u51c0\u91cd', '\u7528\u6599\u91cd\u91cf', '\u603b\u7528\u6599'] },
  { key: 'unit_price', names: ['\u52a0\u5de5\u5355\u4ef7'] },
  { key: 'amount', names: ['\u52a0\u5de5\u91d1\u989d'] },
  { key: 'delivery_date', names: ['\u4ea4\u8d27\u65e5\u671f', '\u4ea4\u671f'] },
  { key: 'notes', names: ['\u5907\u6ce8'] },
];

const FOOTER_WORDS = [
  '\u7279\u522b\u6ce8\u660e',
  '\u5907\u6ce8',
  '\u64cd\u4f5c\u5458',
  '\u6536\u8d27\u4eba',
  '\u4e0b\u5355\u4eba',
  '\u63a5\u5355\u4eba',
  '\u603b\u51c0\u91cd',
  '\u53d1\u6599\u5305\u6570',
];

function compact(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()（）:：]/g, '')
    .toUpperCase();
}

function plain(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function labelForText(value) {
  const s = compact(value);
  for (const label of LABELS) {
    if (label.names.some(name => s.includes(compact(name)))) return label.key;
  }
  return null;
}

function headerScore(values) {
  const keys = new Set();
  for (const value of values) {
    const key = labelForText(value);
    if (key) keys.add(key);
  }
  return keys.size;
}

function detectBeihuoText(text) {
  const s = compact(text);
  const titleHit = s.includes(compact('\u5564\u673a\u90e8\u751f\u4ea7\u5564\u8d27\u8868'))
    || s.includes(compact('\u751f\u4ea7\u5564\u8d27\u8868'))
    || s.includes(compact('\u5564\u8d27\u8868'));
  const hitKeys = new Set();
  for (const label of LABELS) {
    if (label.names.some(name => s.includes(compact(name)))) hitKeys.add(label.key);
  }
  const labelHits = hitKeys.size;
  return titleHit || labelHits >= 6;
}

function toNumber(value) {
  const s = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return s ? Number(s[0]) : 0;
}

function toInt(value) {
  const n = toNumber(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeMaterialKg(value, shotWeight, totalSets, shots) {
  const materialKg = toNumber(value);
  const quantity = shots > 0 ? shots : totalSets;
  if (!(materialKg > 0 && shotWeight > 0 && quantity > 0)) return materialKg;

  const expectedKg = shotWeight * quantity / 1000;
  const deviation = (candidate) => Math.abs(candidate - expectedKg) / Math.max(expectedKg, 1);
  const originalDeviation = deviation(materialKg);
  if (originalDeviation <= 0.25) return materialKg;

  let best = { value: materialKg, scale: 1, deviation: originalDeviation };
  for (const scale of [10, 100, 1000, 10000]) {
    const candidate = materialKg / scale;
    const candidateDeviation = deviation(candidate);
    if (candidateDeviation < best.deviation) {
      best = { value: candidate, scale, deviation: candidateDeviation };
    }
  }

  if (best.scale > 1 && best.deviation <= 0.12) {
    return Number(best.value.toFixed(2));
  }
  return materialKg;
}

function weightDeviation(shotWeight, materialKg, totalSets, shots) {
  if (!(shotWeight > 0 && materialKg > 0)) return Infinity;
  const quantities = [shots, totalSets]
    .filter(quantity => Number.isFinite(quantity) && quantity > 0);
  if (quantities.length === 0) return Infinity;
  return Math.min(...quantities.map((quantity) => {
    const expectedKg = shotWeight * quantity / 1000;
    return Math.abs(expectedKg - materialKg) / Math.max(expectedKg, materialKg, 1);
  }));
}

function leadingNumber(value) {
  const match = String(value || '').trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)(?:\s|$)/);
  return match ? Number(match[1]) : 0;
}

function recoverShiftedWeightColumns(raw, totalSets, shots) {
  let materialType = plain(raw.material_type || '');
  let shotWeight = toNumber(raw.shot_weight);
  let materialKg = toNumber(raw.material_kg);
  const shiftedMaterialKg = leadingNumber(raw.delivery_date);

  if (shotWeight > 0 && !(materialKg > 0)
      && weightDeviation(shotWeight, shiftedMaterialKg, totalSets, shots) <= 0.12) {
    materialKg = shiftedMaterialKg;
  }

  if (!(shotWeight > 0) || !(materialKg > 0)) {
    const twoNumbers = materialType.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/);
    if (twoNumbers) {
      const candidateShotWeight = Number(twoNumbers[2]);
      const candidateMaterialKg = Number(twoNumbers[3]);
      if (weightDeviation(candidateShotWeight, candidateMaterialKg, totalSets, shots) <= 0.12) {
        materialType = plain(twoNumbers[1]);
        shotWeight = candidateShotWeight;
        materialKg = candidateMaterialKg;
      }
    }
  }

  if (!(shotWeight > 0) || !(materialKg > 0)) {
    const oneNumber = materialType.match(/^(.*?)(-?\d+(?:\.\d+)?)\s*$/);
    if (oneNumber) {
      const candidateShotWeight = Number(oneNumber[2]);
      const candidateMaterialKg = materialKg > 0 ? materialKg : shiftedMaterialKg;
      if (weightDeviation(candidateShotWeight, candidateMaterialKg, totalSets, shots) <= 0.12) {
        materialType = plain(oneNumber[1]);
        shotWeight = candidateShotWeight;
        materialKg = candidateMaterialKg;
      }
    }
  }

  return { materialType, shotWeight, materialKg };
}

function cleanDeliveryDate(value) {
  const text = plain(value);
  const match = text.match(/(20\d{2})\s*(?:\u5e74|[-/.])\s*(\d{1,2})\s*(?:\u6708|[-/.])\s*(\d{1,2})\s*\u65e5?/);
  if (!match) return text;
  return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
}

function cleanProductCode(value) {
  const s = plain(value);
  const match = s.match(/[A-Z0-9][A-Z0-9-]{2,}/i);
  return match ? match[0].toUpperCase() : s;
}

function cleanMoldNo(value) {
  const s = plain(value).replace(/\s+/g, '');
  const match = s.match(/[A-Z0-9]+(?:-[A-Z0-9]+){1,}/i);
  return match ? match[0].toUpperCase() : s;
}

function cleanColorPowder(value) {
  const s = plain(value);
  const match = s.match(/\d{4,6}[A-Z]{0,2}/i);
  return match ? match[0].toUpperCase() : s;
}

function looksLikeFooter(values) {
  const s = compact(values.join(' '));
  if (!s) return true;
  return FOOTER_WORDS.some(word => s.includes(compact(word)));
}

function pickQuantity(totalSets, shots, shotWeight, materialKg) {
  const candidates = [shots, totalSets].filter(n => Number.isFinite(n) && n > 0);
  if (candidates.length === 0) {
    if (shotWeight > 0 && materialKg > 0) return Math.round(materialKg * 1000 / shotWeight);
    return 0;
  }
  if (!(shotWeight > 0 && materialKg > 0)) return shots || totalSets || 0;

  const expected = materialKg * 1000 / shotWeight;
  let best = candidates[0];
  let bestDiff = Math.abs(candidates[0] - expected);
  for (const candidate of candidates.slice(1)) {
    const diff = Math.abs(candidate - expected);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return Math.round(best);
}

function inferCavity(totalSets, quantity) {
  if (!(totalSets > 0 && quantity > 0)) return 1;
  const ratio = totalSets / quantity;
  const rounded = Math.round(ratio);
  return rounded >= 1 && Math.abs(ratio - rounded) < 0.05 ? rounded : 1;
}

function appendNote(notes, extra) {
  const parts = [plain(notes), plain(extra)].filter(Boolean);
  return [...new Set(parts)].join(' ');
}

function normalizeOrder(raw, inherited, headerInfo = {}) {
  const totalSets = toInt(raw.total_sets);
  const shots = toInt(raw.quantity_needed);
  const recoveredWeights = recoverShiftedWeightColumns(raw, totalSets, shots);
  const shotWeight = recoveredWeights.shotWeight;
  const materialKg = normalizeMaterialKg(
    recoveredWeights.materialKg,
    shotWeight,
    totalSets,
    shots,
  );
  const quantity = pickQuantity(totalSets, shots, shotWeight, materialKg);

  const productCode = cleanProductCode(raw.product_code || inherited.product_code || '');
  const moldNo = cleanMoldNo(raw.mold_no || '');
  const moldNamePart = plain(raw.mold_name_part || '');
  const color = plain(raw.color || inherited.color || '');
  const ownColor = plain(raw.color || '');
  const colorPowder = cleanColorPowder(
    raw.color_powder_no || (ownColor ? '' : inherited.color_powder_no) || '',
  );
  const materialType = plain(recoveredWeights.materialType || inherited.material_type || '');
  const deliveryDate = cleanDeliveryDate(raw.delivery_date || '');
  const orderNo = plain(raw.order_no || headerInfo.order_no || inherited.order_no || '');

  if (productCode) inherited.product_code = productCode;
  if (color) inherited.color = color;
  if (colorPowder) inherited.color_powder_no = colorPowder;
  if (materialType) inherited.material_type = materialType;
  if (orderNo) inherited.order_no = orderNo;

  const notes = appendNote(raw.notes, deliveryDate ? `\u4ea4\u671f:${deliveryDate}` : '');
  return {
    product_code: productCode,
    mold_no: moldNo,
    mold_name: [moldNo, moldNamePart].filter(Boolean).join(' ').trim() || moldNamePart || moldNo,
    color,
    color_powder_no: colorPowder,
    material_type: materialType,
    shot_weight: shotWeight,
    material_kg: materialKg,
    sprue_pct: 0,
    ratio_pct: 0,
    quantity_needed: quantity,
    accumulated: 0,
    cavity: inferCavity(totalSets, quantity),
    cycle_time: 0,
    order_no: orderNo,
    is_three_plate: 0,
    packing_qty: 0,
    notes,
  };
}

function validOrder(order) {
  if (!order.mold_no && !order.mold_name) return false;
  if (compact(order.mold_no).length > 40) return false;
  if (!order.quantity_needed && !order.shot_weight && !order.material_kg) return false;
  return true;
}

function extractHeaderInfoFromText(text) {
  const orderNoMatch = String(text || '').match(/(?:\u751f\u4ea7\u5355\u53f7|\u5355\u53f7)\s*[:：]?\s*([A-Z0-9/-]{6,})/i);
  return {
    order_no: orderNoMatch ? orderNoMatch[1].trim().toUpperCase() : '',
  };
}

function findHeaderRowIndex(rows) {
  let best = { idx: -1, score: 0 };
  rows.forEach((row, idx) => {
    const values = (row || []).map(v => String(v || ''));
    const score = headerScore(values);
    if (score > best.score) best = { idx, score };
  });
  return best.score >= 5 ? best.idx : -1;
}

function buildColumnMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((value, idx) => {
    const key = labelForText(value);
    if (key && map[key] == null) map[key] = idx;
  });
  return map;
}

function parseRowsWithColumnMap(rows, columnMap, headerInfo = {}) {
  const orders = [];
  const inherited = {};
  for (const row of rows) {
    const values = (row || []).map(v => String(v == null ? '' : v).trim());
    if (looksLikeFooter(values)) continue;

    const raw = {};
    for (const [key, idx] of Object.entries(columnMap)) {
      raw[key] = values[idx] || '';
    }
    const order = normalizeOrder(raw, inherited, headerInfo);
    if (validOrder(order)) orders.push(order);
  }
  return orders;
}

function parseBeihuoRawRows(rawRows, headerInfo = {}) {
  const orders = [];
  const inherited = {};
  for (const raw of rawRows || []) {
    const order = normalizeOrder(raw || {}, inherited, headerInfo);
    if (validOrder(order)) orders.push(order);
  }
  return orders;
}

function parseBeihuoExcel(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const orders = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const checkText = rows.slice(0, 20).map(r => (r || []).join(' ')).join(' ');
    if (!detectBeihuoText(checkText)) continue;

    const headerIdx = findHeaderRowIndex(rows.slice(0, 20));
    if (headerIdx < 0) continue;
    const columnMap = buildColumnMap(rows[headerIdx]);
    const headerInfo = extractHeaderInfoFromText(checkText);
    orders.push(...parseRowsWithColumnMap(rows.slice(headerIdx + 1), columnMap, headerInfo));
  }
  return orders;
}

async function extractPdfItems(buffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const items = [];
  let text = '';
  for (let page = 1; page <= pdf.numPages; page++) {
    const p = await pdf.getPage(page);
    const content = await p.getTextContent();
    for (const item of content.items) {
      const s = String(item.str || '').trim();
      if (!s) continue;
      items.push({
        page,
        s,
        x: Math.round(item.transform[4] * 10) / 10,
        y: Math.round(item.transform[5] * 10) / 10,
        width: Math.round((item.width || 0) * 10) / 10,
      });
      text += s + ' ';
    }
  }
  return { items, text };
}

function groupPdfRows(items, tolerance = 3) {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item);
      last.y = (last.y + item.y) / 2;
    } else {
      rows.push({ page: item.page, y: item.y, items: [item] });
    }
  }
  rows.forEach(row => row.items.sort((a, b) => a.x - b.x));
  return rows;
}

function findPdfHeaderRows(rows) {
  const byPage = {};
  for (const row of rows) {
    const values = row.items.map(item => item.s);
    const score = headerScore(values);
    if (score < 5) continue;
    const current = byPage[row.page];
    if (!current || score > current.score) byPage[row.page] = { row, score };
  }
  return Object.values(byPage).map(v => v.row);
}

function headerItemsOverlap(left, right) {
  const leftWidth = Math.max(Number(left.width) || 0, 1);
  const rightWidth = Math.max(Number(right.width) || 0, 1);
  const overlap = Math.min(left.x + leftWidth, right.x + rightWidth) - Math.max(left.x, right.x);
  return overlap / Math.min(leftWidth, rightWidth) >= 0.35;
}

function expandPdfHeaderRow(rows, headerRow) {
  const nearbyItems = rows
    .filter(row => row.page === headerRow.page && Math.abs(row.y - headerRow.y) <= 8)
    .flatMap(row => row.items)
    .sort((a, b) => a.x - b.x || b.y - a.y);
  const clusters = [];

  for (const item of nearbyItems) {
    const cluster = clusters.find(candidate => (
      candidate.items.some(existing => headerItemsOverlap(existing, item))
    ));
    if (cluster) cluster.items.push(item);
    else clusters.push({ items: [item] });
  }

  const items = clusters.map((cluster) => {
    const ordered = [...cluster.items].sort((a, b) => b.y - a.y || a.x - b.x);
    return {
      s: ordered.map(item => item.s).join(''),
      x: ordered.reduce((sum, item) => sum + item.x, 0) / ordered.length,
    };
  }).filter(item => labelForText(item.s));

  return { ...headerRow, items };
}

function buildPdfColumnRanges(headerRow) {
  const anchors = [];
  for (const item of headerRow.items) {
    const key = labelForText(item.s);
    if (key && !anchors.some(anchor => anchor.key === key)) anchors.push({ key, x: item.x });
  }
  anchors.sort((a, b) => a.x - b.x);
  const ranges = {};
  anchors.forEach((anchor, idx) => {
    const prev = anchors[idx - 1];
    const next = anchors[idx + 1];
    ranges[anchor.key] = {
      left: prev ? (prev.x + anchor.x) / 2 : Math.max(0, anchor.x - 40),
      right: next ? (anchor.x + next.x) / 2 : anchor.x + 80,
    };
  });
  return ranges;
}

const COMPACT_PDF_FIELDS = new Set([
  'product_code',
  'mold_no',
  'mold_name_part',
  'color',
  'color_powder_no',
]);

function valueInRange(row, range, key) {
  if (!range) return '';
  const matchingItems = row.items.filter(item => item.x >= range.left && item.x < range.right);
  if (matchingItems.length === 0) return '';
  const lines = groupPdfRows(matchingItems)
    .sort((a, b) => b.y - a.y)
    .map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.s).join(' ').trim())
    .filter(Boolean);
  return lines.join(COMPACT_PDF_FIELDS.has(key) ? '' : ' ').trim();
}

function buildLogicalPdfRows(dataRows, headerRow, ranges) {
  const primaryRows = dataRows.filter((row) => {
    if (looksLikeFooter(row.items.map(item => item.s))) return false;
    const moldNo = cleanMoldNo(valueInRange(row, ranges.mold_no, 'mold_no'));
    const totalSets = toNumber(valueInRange(row, ranges.total_sets, 'total_sets'));
    const shots = toNumber(valueInRange(row, ranges.quantity_needed, 'quantity_needed'));
    const shotWeight = toNumber(valueInRange(row, ranges.shot_weight, 'shot_weight'));
    const materialKg = toNumber(valueInRange(row, ranges.material_kg, 'material_kg'));
    return Boolean(moldNo) && (totalSets > 0 || shots > 0 || shotWeight > 0 || materialKg > 0);
  });
  if (primaryRows.length === 0) return dataRows;

  const gaps = primaryRows.slice(1).map((row, index) => primaryRows[index].y - row.y);
  const typicalGap = gaps.length > 0
    ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : Math.max(20, headerRow.y - primaryRows[0].y);

  return primaryRows.map((primaryRow, index) => {
    const previous = primaryRows[index - 1];
    const next = primaryRows[index + 1];
    const upper = previous ? (previous.y + primaryRow.y) / 2 : headerRow.y - 4;
    const lower = next
      ? (primaryRow.y + next.y) / 2
      : primaryRow.y - Math.min(30, Math.max(10, typicalGap / 2));
    const items = dataRows
      .filter(row => row.y <= upper && row.y > lower)
      .flatMap(row => row.items);
    return { ...primaryRow, items };
  });
}

function parsePdfPageRows(rows, headerRow, ranges, headerInfo) {
  const dataRows = rows
    .filter(row => row.page === headerRow.page && row.y < headerRow.y - 4)
    .sort((a, b) => b.y - a.y);

  const logicalRows = buildLogicalPdfRows(dataRows, headerRow, ranges);
  const orders = [];
  const inherited = {};
  for (const row of logicalRows) {
    const values = row.items.map(item => item.s);
    if (looksLikeFooter(values)) continue;

    const raw = {};
    for (const key of Object.keys(ranges)) {
      raw[key] = valueInRange(row, ranges[key], key);
    }
    const order = normalizeOrder(raw, inherited, headerInfo);
    if (validOrder(order)) orders.push(order);
  }
  return orders;
}

function extractHeaderInfoFromPdfItems(items, text) {
  for (const item of items) {
    const label = compact(item.s);
    if (!['\u751f\u4ea7\u5355\u53f7', '\u751f\u7522\u55ae\u865f', '\u751f\u4ea7\u55ae\u865f'].some(name => label.includes(compact(name)))) {
      continue;
    }
    const inlineMatch = plain(item.s).match(/[A-Z0-9][A-Z0-9/-]{5,}/i);
    if (inlineMatch) return { order_no: inlineMatch[0].toUpperCase() };
    const candidates = items
      .filter(candidate => (
        candidate.page === item.page
        && Math.abs(candidate.y - item.y) <= 3
        && candidate.x > item.x
      ))
      .sort((a, b) => a.x - b.x);
    for (const candidate of candidates) {
      const match = plain(candidate.s).match(/[A-Z0-9][A-Z0-9/-]{5,}/i);
      if (match) return { order_no: match[0].toUpperCase() };
    }
  }
  return extractHeaderInfoFromText(text);
}

async function parseBeihuoPdfBuffer(buffer) {
  const { items, text } = await extractPdfItems(buffer);
  if (!detectBeihuoText(text)) return null;

  const rows = groupPdfRows(items);
  const headerRows = findPdfHeaderRows(rows);
  if (headerRows.length === 0) return null;

  const headerInfo = extractHeaderInfoFromPdfItems(items, text);
  const orders = [];
  for (const headerRow of headerRows) {
    const expandedHeaderRow = expandPdfHeaderRow(rows, headerRow);
    const ranges = buildPdfColumnRanges(expandedHeaderRow);
    if (!ranges.mold_no || !ranges.quantity_needed || !ranges.shot_weight || !ranges.material_kg) {
      continue;
    }
    orders.push(...parsePdfPageRows(rows, headerRow, ranges, headerInfo));
  }
  return orders.length > 0 ? { template: 'beihuo-fixed-table', orders } : null;
}

module.exports = {
  detectBeihuoText,
  normalizeMaterialKg,
  parseBeihuoExcel,
  parseBeihuoPdfBuffer,
  parseBeihuoRawRows,
};
