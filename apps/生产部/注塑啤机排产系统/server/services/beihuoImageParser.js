const path = require('path');
const zlib = require('zlib');
const { createWorker, PSM } = require('tesseract.js');
const { parseBeihuoRawRows } = require('./beihuoOrderParser');

const TESSDATA_DIR = path.join(__dirname, '..');
const TABLE_TEMPLATES = [
  {
    name: 'beihuo-grid-v1',
    ratios: [
      0, 0.0637, 0.1534, 0.2918, 0.3685,
      0.4275, 0.4817, 0.5282, 0.6044, 0.6592,
      0.7250, 0.7813, 0.8575, 0.9134, 1,
    ],
    columns: {
      product_code: 0,
      mold_no: 1,
      mold_name_part: 2,
      total_sets: 3,
      quantity_needed: 4,
      color: 5,
      color_powder_no: 6,
      material_type: 7,
      shot_weight: 8,
      material_kg: 9,
      delivery_date: 12,
      notes: 13,
    },
  },
  {
    name: 'production-order-grid-v1',
    ratios: [
      0, 0.0525, 0.1436, 0.3169, 0.3943, 0.4913,
      0.5469, 0.5935, 0.6317, 0.6820, 0.7393, 0.7769,
      0.8373, 0.8755, 0.9136, 1,
    ],
    columns: {
      product_code: 0,
      mold_no: 1,
      mold_name_part: 2,
      color: 3,
      color_powder_no: 3,
      material_type: 4,
      shot_weight: 5,
      total_sets: 6,
      quantity_needed: 8,
      material_kg: 9,
      notes: 14,
    },
    combinedColorColumn: true,
    dataStartLineIndex: 3,
    headerBottomLineIndex: 2,
  },
];

let chiWorkerPromise;
let engWorkerPromise;
let ocrQueue = Promise.resolve();

function createLocalWorker(lang) {
  return createWorker(lang, undefined, {
    langPath: TESSDATA_DIR,
    cachePath: TESSDATA_DIR,
    gzip: false,
  });
}

function getChiWorker() {
  if (!chiWorkerPromise) {
    chiWorkerPromise = createLocalWorker('chi_sim').catch((error) => {
      chiWorkerPromise = null;
      throw error;
    });
  }
  return chiWorkerPromise;
}

function getEngWorker() {
  if (!engWorkerPromise) {
    engWorkerPromise = createLocalWorker('eng').catch((error) => {
      engWorkerPromise = null;
      throw error;
    });
  }
  return engWorkerPromise;
}

function runSerially(task) {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.catch(() => undefined);
  return run;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodeGreyPng(dataUrl) {
  const encoded = String(dataUrl || '').split(',')[1];
  if (!encoded) throw new Error('OCR 没有返回灰度图');

  const png = Buffer.from(encoded, 'base64');
  const signature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('OCR 灰度图格式无效');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) break;

    if (type === 'IHDR') {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
      interlace = png[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(png.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || bitDepth !== 8 || colorType !== 0 || interlace !== 0) {
    throw new Error('OCR 灰度图参数不受支持');
  }

  const packed = zlib.inflateSync(Buffer.concat(idat));
  const stride = width;
  const pixels = new Uint8Array(width * height);
  let source = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = packed[source];
    source += 1;
    const rowStart = y * stride;
    const previousRow = rowStart - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source];
      source += 1;
      const left = x > 0 ? pixels[rowStart + x - 1] : 0;
      const up = y > 0 ? pixels[previousRow + x] : 0;
      const upLeft = x > 0 && y > 0 ? pixels[previousRow + x - 1] : 0;
      let value = raw;

      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error('OCR 灰度图使用了未知滤镜');

      pixels[rowStart + x] = value;
    }
  }

  return { width, height, pixels };
}

function groupPositions(positions) {
  const groups = [];
  for (const position of positions) {
    const last = groups[groups.length - 1];
    if (last && position <= last[last.length - 1] + 1) last.push(position);
    else groups.push([position]);
  }
  return groups.map((group) => Math.round((group[0] + group[group.length - 1]) / 2));
}

function findHorizontalLines(image) {
  const positions = [];
  const { width, height, pixels } = image;
  const required = Math.floor(width * 0.68);

  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    const start = y * width;
    for (let x = 0; x < width; x += 1) {
      if (pixels[start + x] < 110) dark += 1;
    }
    if (dark >= required) positions.push(y);
  }
  return groupPositions(positions);
}

function selectTableLines(lines, height) {
  const minHeader = Math.max(18, height * 0.035);
  const maxHeader = height * 0.20;
  const minRow = Math.max(14, height * 0.02);
  const maxRow = height * 0.14;

  for (let i = 0; i + 3 < lines.length; i += 1) {
    const headerGap = lines[i + 1] - lines[i];
    const rowGap1 = lines[i + 2] - lines[i + 1];
    const rowGap2 = lines[i + 3] - lines[i + 2];
    if (headerGap < minHeader || headerGap > maxHeader) continue;
    if (rowGap1 < minRow || rowGap1 > maxRow) continue;
    if (rowGap2 < minRow || rowGap2 > maxRow) continue;

    const selected = [lines[i]];
    for (let j = i + 1; j < lines.length; j += 1) {
      const gap = lines[j] - selected[selected.length - 1];
      if (gap < minRow * 0.65 || gap > maxHeader) break;
      selected.push(lines[j]);
    }
    if (selected.length >= 4) return selected;
  }
  return [];
}

function findVerticalLines(image, tableLines) {
  const { width, pixels } = image;
  const top = tableLines[0];
  const bottom = tableLines[Math.min(tableLines.length - 1, 8)];
  const span = Math.max(1, bottom - top + 1);
  const required = Math.floor(span * 0.46);
  const positions = [];

  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = top; y <= bottom; y += 1) {
      if (pixels[y * width + x] < 110) dark += 1;
    }
    if (dark >= required) positions.push(x);
  }
  return groupPositions(positions);
}

function matchColumns(lines, width, ratios) {
  const maxX = width - 1;
  const tolerance = Math.max(5, width * 0.018);
  const matched = [];

  for (const ratio of ratios) {
    const expected = ratio * maxX;
    let best = null;
    let bestDistance = Infinity;
    for (const line of lines) {
      const distance = Math.abs(line - expected);
      if (distance < bestDistance) {
        best = line;
        bestDistance = distance;
      }
    }
    if (best == null || bestDistance > tolerance || matched.includes(best)) return [];
    matched.push(best);
  }
  return matched;
}

function matchTableTemplate(lines, width) {
  for (const template of TABLE_TEMPLATES) {
    const columns = matchColumns(lines, width, template.ratios);
    if (columns.length === template.ratios.length) return { ...template, matchedColumns: columns };
  }
  return null;
}

function hasInk(image, rectangle) {
  const { width, pixels } = image;
  const left = Math.max(0, rectangle.left);
  const top = Math.max(0, rectangle.top);
  const right = Math.min(width, left + rectangle.width);
  const bottom = Math.min(image.height, top + rectangle.height);
  const area = Math.max(1, (right - left) * (bottom - top));
  const required = Math.max(5, Math.floor(area * 0.001));
  let dark = 0;

  for (let y = top; y < bottom; y += 1) {
    const offset = y * width;
    for (let x = left; x < right; x += 1) {
      if (pixels[offset + x] < 165) {
        dark += 1;
        if (dark >= required) return true;
      }
    }
  }
  return false;
}

function makeRectangle(columns, row, columnIndex, padding = 2) {
  const left = columns[columnIndex] + padding;
  const right = columns[columnIndex + 1] - padding;
  const top = row.top + padding;
  const bottom = row.bottom - padding;
  return {
    left,
    top,
    width: Math.max(2, right - left),
    height: Math.max(2, bottom - top),
  };
}

function findDataRows(image, tableLines, columns, startIndex = 1) {
  const rows = [];
  const contentColumns = [0, 1, 2, 3, 4, 7, 8, 9];
  for (let index = startIndex; index + 1 < tableLines.length && rows.length < 100; index += 1) {
    const row = { top: tableLines[index], bottom: tableLines[index + 1] };
    if (row.bottom - row.top < 12) continue;

    const occupied = contentColumns.some((columnIndex) => (
      hasInk(image, makeRectangle(columns, row, columnIndex, 3))
    ));
    if (occupied) rows.push(row);
    else if (rows.length > 0) break;
  }
  return rows;
}

function cleanCell(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanNumber(value) {
  return cleanCell(value)
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9.-]/g, '');
}

function cleanProductCode(value) {
  return cleanCell(value)
    .toUpperCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

function normalizeDigitLike(value) {
  return String(value || '').replace(/[OQ]/g, '0').replace(/[IL]/g, '1');
}

function cleanMoldNo(value) {
  const code = cleanProductCode(value);
  const rcMatch = code.match(/^RC([A-Z0-9]{5,6})$/);
  if (rcMatch) {
    let digits = rcMatch[1]
      .replace(/[OQ]/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/T/g, '7');
    if (/^00\d{4}$/.test(digits)) digits = digits.slice(1);
    if (/^\d{5}$/.test(digits)) return 'RC' + digits;
  }
  return code.split('-').map((segment) => {
    if (/^[0-9OQIL]+$/.test(segment)) return normalizeDigitLike(segment);
    const mixed = segment.match(/^([A-Z]+?)([0-9OQIL]+)$/);
    if (mixed) return mixed[1] + normalizeDigitLike(mixed[2]);
    return segment;
  }).join('-');
}

function cleanColorPowder(value) {
  const cleaned = cleanNumber(value);
  const match = cleaned.match(/\d{4,6}/);
  return match ? match[0] : cleaned;
}

function cleanColor(value) {
  return cleanCell(value)
    .replace(/^[“”"'|]+/g, '')
    .replace(/[，。,.]+$/g, '')
    .replace(/栖色/g, '橙色')
    .replace(/楼色/g, '橙色')
    .replace(/桔色/g, '橙色');
}

function cleanCombinedColor(value) {
  return cleanColor(value)
    .replace(/[0-9OQIL]{4,6}[A-Z]{0,2}/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

function cleanName(value) {
  return cleanCell(value)
    .replace(/^[“”"'|]+/g, '')
    .replace(/[，。,.]+$/g, '')
    .replace(/^叶尺转动轴$/, '咬尺转动轴')
    .replace(/^后轮(?:区|忆|臣)$/, '后轮芯')
    .replace(/^收割机[站部]荷钻$/, '收割机卸荷钻')
    .replace(/^收割机驾驶室左(?:和镇|镜.*)$/, '收割机驾驶室左镜')
    .replace(/^收割机前指示(?:简|得)$/, '收割机前指示镜')
    .replace(/^前轮(?:区|忆|臣|忌|达辣)$/, '前轮芯');
}

function cleanMaterial(chineseValue, englishValue) {
  const chineseText = cleanCell(chineseValue)
    .replace(/[，。,.]+$/g, '')
    .replace(/本和白/g, '本白');
  let englishText = cleanCell(englishValue)
    .toUpperCase()
    .replace(/\s*#\s*/g, '# ')
    .replace(/\s+/g, ' ')
    .trim();
  englishText = englishText
    .replace(/^1\s+PP\b/, '1# PP')
    .replace(/\b557A1\b/g, '557AI');

  const chineseParts = chineseText.match(/[\u4e00-\u9fff]+/g) || [];
  const chineseWords = chineseParts.join('');
  if (englishText && /(?:ABS|PP|PVC|PA|PE|POM|TPE|TPR)/i.test(englishText)) {
    const meaningfulPrefix = chineseWords.match(/本白|透明|原色|尼龙|加纤/);
    if (meaningfulPrefix?.[0] === '本白' && /PVC/i.test(englishText)) {
      const degree = (englishText.match(/\d{2,3}/g) || [])
        .map(Number)
        .find(value => value >= 40 && value <= 100);
      return ['本白', 'PVC', degree ? degree + '度' : ''].filter(Boolean).join(' ');
    }
    return [meaningfulPrefix ? meaningfulPrefix[0] : '', englishText].filter(Boolean).join(' ');
  }
  if (chineseParts.length > 0 && /[A-Z]{2,}/i.test(chineseText)) {
    return chineseText
      .toUpperCase()
      .replace(/^1\s+PP\b/, '1# PP')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (chineseParts.length > 0 && englishText) {
    return (chineseParts.join('') + ' ' + englishText).trim();
  }
  return englishText || chineseText;
}

function cleanDeliveryDate(value) {
  const text = cleanCell(value).replace(/\s+/g, '');
  const match = text.match(/(\d{1,2})[月./-](\d{1,2})日?/);
  return match ? Number(match[1]) + '月' + Number(match[2]) + '日' : text;
}

function cleanNotes(value) {
  return cleanCell(value).replace(/[，。,.]+$/g, '');
}

function looksLikeDataRow(row) {
  const moldNo = cleanProductCode(row.mold_no);
  const quantity = Number(cleanNumber(row.quantity_needed));
  const shotWeight = Number(cleanNumber(row.shot_weight));
  return Boolean(cleanProductCode(row.product_code))
    && /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(moldNo)
    && quantity >= 10
    && shotWeight > 0;
}

function normalizeColorsByPowder(rows) {
  const knownColor = /^(?:黑|白|红|蓝|绿|黄|灰|棕|橙|紫|粉|银|透明|啡|咖|本白|浅|深)/;
  const counts = new Map();
  for (const row of rows) {
    if (!row.color_powder_no || !knownColor.test(row.color)) continue;
    const key = row.color_powder_no;
    const values = counts.get(key) || new Map();
    values.set(row.color, (values.get(row.color) || 0) + 1);
    counts.set(key, values);
  }
  for (const row of rows) {
    if (!row.color_powder_no || knownColor.test(row.color)) continue;
    const values = counts.get(row.color_powder_no);
    if (!values) continue;
    row.color = [...values.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return rows;
}

function extractHeaderInfo(text) {
  const compact = cleanCell(text).replace(/\s+/g, '');
  const labelled = compact.match(/(?:生产单号|单号|编号)[：:,，]?([A-Z0-9/-]{6,})/i);
  const fallback = compact.match(/[A-Z]{1,6}\d{6,}\/[A-Z]/i)
    || compact.match(/\d{8,}\/[A-Z]/i);
  return {
    order_no: (labelled ? labelled[1] : fallback ? fallback[0] : '').toUpperCase(),
  };
}

function isBeihuoHeader(text) {
  const compact = cleanCell(text).replace(/\s+/g, '');
  return compact.includes('啤机部生产啤货表')
    || compact.includes('生产啤货表')
    || compact.includes('啤货表')
    || compact.includes('啤机生产单');
}

async function recognizeCellWithConfidence(worker, imagePath, image, columns, row, columnIndex) {
  const rectangle = makeRectangle(columns, row, columnIndex);
  if (!hasInk(image, rectangle)) return { text: '', confidence: 0 };
  const result = await worker.recognize(imagePath, { rectangle });
  return {
    text: cleanCell(result.data.text),
    confidence: Number(result.data.confidence) || 0,
  };
}

async function recognizeCell(worker, imagePath, image, columns, row, columnIndex) {
  const result = await recognizeCellWithConfidence(
    worker,
    imagePath,
    image,
    columns,
    row,
    columnIndex,
  );
  return result.text;
}

function makeUpscaledPgm(image, rectangle, scale = 4) {
  const padding = 12;
  const sourceWidth = rectangle.width;
  const sourceHeight = rectangle.height;
  const width = sourceWidth * scale + padding * 2;
  const height = sourceHeight * scale + padding * 2;
  const pixels = Buffer.alloc(width * height, 255);

  for (let targetY = 0; targetY < sourceHeight * scale; targetY += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (targetY + 0.5) / scale - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let targetX = 0; targetX < sourceWidth * scale; targetX += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (targetX + 0.5) / scale - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const top = image.pixels[(rectangle.top + y0) * image.width + rectangle.left + x0]
        * (1 - xWeight)
        + image.pixels[(rectangle.top + y0) * image.width + rectangle.left + x1] * xWeight;
      const bottom = image.pixels[(rectangle.top + y1) * image.width + rectangle.left + x0]
        * (1 - xWeight)
        + image.pixels[(rectangle.top + y1) * image.width + rectangle.left + x1] * xWeight;
      pixels[(padding + targetY) * width + padding + targetX] = Math.round(
        top * (1 - yWeight) + bottom * yWeight,
      );
    }
  }

  return Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii'),
    pixels,
  ]);
}

async function recognizeUpscaledCell(worker, image, columns, row, columnIndex) {
  const rectangle = makeRectangle(columns, row, columnIndex, 3);
  if (!hasInk(image, rectangle)) return { text: '', confidence: 0 };
  const result = await worker.recognize(makeUpscaledPgm(image, rectangle));
  return {
    text: cleanCell(result.data.text),
    confidence: Number(result.data.confidence) || 0,
  };
}

async function recognizeBestMoldName(worker, imagePath, image, columns, row, columnIndex) {
  const regular = await recognizeCellWithConfidence(
    worker,
    imagePath,
    image,
    columns,
    row,
    columnIndex,
  );
  const upscaled = await recognizeUpscaledCell(worker, image, columns, row, columnIndex);
  return upscaled.confidence >= regular.confidence + 2 ? upscaled.text : regular.text;
}

async function parseBeihuoImageInternal(imagePath) {
  const chiWorker = await getChiWorker();
  const greyResult = await chiWorker.recognize(
    imagePath,
    { skipRecognition: true },
    { imageGrey: true },
  );
  const image = decodeGreyPng(greyResult.data.imageGrey);
  const horizontalLines = findHorizontalLines(image);
  const tableLines = selectTableLines(horizontalLines, image.height);
  if (tableLines.length < 4) {
    console.log('[啤货表图片] 未找到连续横线:', horizontalLines);
    return null;
  }

  const verticalLines = findVerticalLines(image, tableLines);
  const tableTemplate = matchTableTemplate(verticalLines, image.width);
  if (!tableTemplate) {
    console.log('[啤货表图片] 竖线未匹配:', verticalLines);
    return null;
  }
  const columns = tableTemplate.matchedColumns;

  await chiWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
  });
  const engWorker = await getEngWorker();
  const headerBottom = Number.isInteger(tableTemplate.headerBottomLineIndex)
    ? tableLines[tableTemplate.headerBottomLineIndex]
    : tableLines[0];
  const headerHeight = Math.max(30, headerBottom - 2);
  const leftHeaderResult = await chiWorker.recognize(imagePath, {
    rectangle: {
      left: 0,
      top: 0,
      width: Math.floor(image.width * 0.36),
      height: headerHeight,
    },
  });
  const titleResult = await chiWorker.recognize(imagePath, {
    rectangle: {
      left: Math.floor(image.width * 0.28),
      top: 0,
      width: Math.floor(image.width * 0.44),
      height: headerHeight,
    },
  });
  const orderNoResult = await chiWorker.recognize(imagePath, {
    rectangle: {
      left: Math.floor(image.width * 0.72),
      top: 0,
      width: image.width - Math.floor(image.width * 0.72),
      height: headerHeight,
    },
  });
  await engWorker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/: ',
  });
  const headerCodeResult = await engWorker.recognize(imagePath, {
    rectangle: {
      left: 0,
      top: 0,
      width: image.width,
      height: headerHeight,
    },
  });
  const headerText = cleanCell(
    leftHeaderResult.data.text + ' ' + titleResult.data.text + ' '
      + orderNoResult.data.text + ' ' + headerCodeResult.data.text,
  );
  if (!isBeihuoHeader(headerText)) {
    if (tableTemplate.name !== 'production-order-grid-v1') {
      console.log('[啤货表图片] 表头未命中:', headerText);
      return null;
    }
    console.log('[啤货表图片] 中文表头未命中，按生产单网格继续:', headerText);
  }

  const rows = findDataRows(
    image,
    tableLines,
    columns,
    tableTemplate.dataStartLineIndex || 1,
  );
  if (rows.length === 0) {
    console.log('[啤货表图片] 未找到有内容的数据行');
    return null;
  }

  const englishValues = rows.map(() => ({}));
  const chineseValues = rows.map(() => ({}));
  const fieldColumns = tableTemplate.columns;

  await engWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.#%+ ',
  });
  const englishColumns = [...new Set([
    fieldColumns.product_code,
    fieldColumns.mold_no,
    fieldColumns.total_sets,
    fieldColumns.quantity_needed,
    fieldColumns.color_powder_no,
    fieldColumns.material_type,
    fieldColumns.shot_weight,
    fieldColumns.material_kg,
  ].filter(Number.isInteger))];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const columnIndex of englishColumns) {
      englishValues[rowIndex][columnIndex] = await recognizeCell(
        engWorker,
        imagePath,
        image,
        columns,
        rows[rowIndex],
        columnIndex,
      );
    }
  }
  await engWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.#%+ ',
  });
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].bottom - rows[rowIndex].top <= 32) continue;
    englishValues[rowIndex][fieldColumns.material_type] = await recognizeCell(
      engWorker,
      imagePath,
      image,
      columns,
      rows[rowIndex],
      fieldColumns.material_type,
    );
  }

  await chiWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: '1',
  });
  const chineseColumns = [...new Set([
    fieldColumns.mold_name_part,
    fieldColumns.color,
    fieldColumns.delivery_date,
    fieldColumns.notes,
  ].filter(Number.isInteger))];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const columnIndex of chineseColumns) {
      chineseValues[rowIndex][columnIndex] = columnIndex === fieldColumns.mold_name_part
        ? await recognizeBestMoldName(
          chiWorker,
          imagePath,
          image,
          columns,
          rows[rowIndex],
          columnIndex,
        )
        : await recognizeCell(
          chiWorker,
          imagePath,
          image,
          columns,
          rows[rowIndex],
          columnIndex,
        );
    }
  }
  await chiWorker.setParameters({
    tessedit_pageseg_mode: PSM.RAW_LINE,
    preserve_interword_spaces: '1',
  });
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    chineseValues[rowIndex][fieldColumns.material_type] = await recognizeCell(
      chiWorker,
      imagePath,
      image,
      columns,
      rows[rowIndex],
      fieldColumns.material_type,
    );
  }

  const rawRows = rows.map((row, rowIndex) => {
    const englishAt = (field) => englishValues[rowIndex][fieldColumns[field]];
    const chineseAt = (field) => chineseValues[rowIndex][fieldColumns[field]];
    const colorText = chineseAt('color');
    const powderFromColor = tableTemplate.combinedColorColumn
      ? cleanColorPowder(colorText)
      : '';
    return {
      product_code: cleanProductCode(englishAt('product_code')),
      mold_no: cleanMoldNo(englishAt('mold_no')),
      mold_name_part: cleanName(chineseAt('mold_name_part')),
      total_sets: cleanNumber(englishAt('total_sets')),
      quantity_needed: cleanNumber(englishAt('quantity_needed')),
      color: tableTemplate.combinedColorColumn
        ? cleanCombinedColor(colorText)
        : cleanColor(colorText),
      color_powder_no: powderFromColor || cleanColorPowder(englishAt('color_powder_no')),
      material_type: cleanMaterial(
        chineseAt('material_type'),
        englishAt('material_type'),
      ),
      shot_weight: cleanNumber(englishAt('shot_weight')),
      material_kg: cleanNumber(englishAt('material_kg')),
      delivery_date: cleanDeliveryDate(chineseAt('delivery_date')),
      notes: cleanNotes(chineseAt('notes')),
    };
  });

  // A vertically merged product-code cell is often OCR'd on the middle row.
  // Backfill only the leading blank rows; normal downward inheritance remains unchanged.
  const firstProductIndex = rawRows.findIndex(row => row.product_code);
  if (firstProductIndex > 0) {
    const leadingProductCode = rawRows[firstProductIndex].product_code;
    for (let index = 0; index < firstProductIndex; index += 1) {
      rawRows[index].product_code = leadingProductCode;
    }
  }

  const filteredRows = tableTemplate.name === 'production-order-grid-v1'
    ? rawRows.filter(looksLikeDataRow)
    : rawRows;
  const dataRows = normalizeColorsByPowder(filteredRows);
  const orders = parseBeihuoRawRows(dataRows, extractHeaderInfo(headerText));
  if (orders.length === 0) return null;

  return {
    template: 'beihuo-image-grid',
    orders,
    rawText: headerText,
    diagnostics: {
      imageSize: [image.width, image.height],
      rows: rows.length,
      layout: tableTemplate.name,
    },
  };
}

function parseBeihuoImage(imagePath) {
  return runSerially(() => parseBeihuoImageInternal(imagePath));
}

module.exports = { parseBeihuoImage };
