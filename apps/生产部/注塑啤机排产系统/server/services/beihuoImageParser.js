const path = require('path');
const zlib = require('zlib');
const { createWorker, PSM } = require('tesseract.js');
const { parseBeihuoRawRows } = require('./beihuoOrderParser');

const TESSDATA_DIR = path.join(__dirname, '..');
const COLUMN_RATIOS = [
  0, 0.0637, 0.1534, 0.2918, 0.3685,
  0.4275, 0.4817, 0.5282, 0.6044, 0.6592,
  0.7250, 0.7813, 0.8575, 0.9134, 1,
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

function matchColumns(lines, width) {
  const maxX = width - 1;
  const tolerance = Math.max(5, width * 0.018);
  const matched = [];

  for (const ratio of COLUMN_RATIOS) {
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

function findDataRows(image, tableLines, columns) {
  const rows = [];
  const contentColumns = [0, 1, 2, 3, 4, 7, 8, 9];
  for (let index = 1; index + 1 < tableLines.length && rows.length < 100; index += 1) {
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

function cleanName(value) {
  return cleanCell(value).replace(/^[“”"'|]+/g, '').replace(/[，。,.]+$/g, '');
}

function cleanMaterial(chineseValue, englishValue) {
  const chineseText = cleanCell(chineseValue).replace(/[，。,.]+$/g, '');
  let englishText = cleanCell(englishValue)
    .toUpperCase()
    .replace(/\s*#\s*/g, '# ')
    .replace(/\s+/g, ' ')
    .trim();
  englishText = englishText.replace(/^1\s+PP\b/, '1# PP');

  const chineseParts = chineseText.match(/[\u4e00-\u9fff]+/g) || [];
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

function extractHeaderInfo(text) {
  const compact = cleanCell(text).replace(/\s+/g, '');
  const labelled = compact.match(/(?:生产单号|单号)[：:,，]?([A-Z0-9/-]{6,})/i);
  const fallback = compact.match(/\d{8,}\/[A-Z]/i);
  return {
    order_no: (labelled ? labelled[1] : fallback ? fallback[0] : '').toUpperCase(),
  };
}

function isBeihuoHeader(text) {
  const compact = cleanCell(text).replace(/\s+/g, '');
  return compact.includes('啤机部生产啤货表')
    || compact.includes('生产啤货表')
    || compact.includes('啤货表');
}

async function recognizeCell(worker, imagePath, image, columns, row, columnIndex) {
  const rectangle = makeRectangle(columns, row, columnIndex);
  if (!hasInk(image, rectangle)) return '';
  const result = await worker.recognize(imagePath, { rectangle });
  return cleanCell(result.data.text);
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
  const columns = matchColumns(verticalLines, image.width);
  if (columns.length !== COLUMN_RATIOS.length) {
    console.log('[啤货表图片] 竖线未匹配:', verticalLines);
    return null;
  }

  await chiWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
  });
  const headerHeight = Math.max(30, Math.floor(tableLines[0] * 0.63));
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
  const headerText = cleanCell(titleResult.data.text + ' ' + orderNoResult.data.text);
  if (!isBeihuoHeader(headerText)) {
    console.log('[啤货表图片] 表头未命中:', headerText);
    return null;
  }

  const rows = findDataRows(image, tableLines, columns);
  if (rows.length === 0) {
    console.log('[啤货表图片] 未找到有内容的数据行');
    return null;
  }

  const englishValues = rows.map(() => ({}));
  const chineseValues = rows.map(() => ({}));
  const engWorker = await getEngWorker();

  await engWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.# ',
  });
  const englishColumns = [0, 1, 3, 4, 6, 7, 8, 9];
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

  await chiWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: '1',
  });
  const chineseColumns = [2, 5, 12, 13];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const columnIndex of chineseColumns) {
      chineseValues[rowIndex][columnIndex] = await recognizeCell(
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
    chineseValues[rowIndex][7] = await recognizeCell(
      chiWorker,
      imagePath,
      image,
      columns,
      rows[rowIndex],
      7,
    );
  }

  const rawRows = rows.map((row, rowIndex) => ({
    product_code: cleanProductCode(englishValues[rowIndex][0]),
    mold_no: cleanMoldNo(englishValues[rowIndex][1]),
    mold_name_part: cleanName(chineseValues[rowIndex][2]),
    total_sets: cleanNumber(englishValues[rowIndex][3]),
    quantity_needed: cleanNumber(englishValues[rowIndex][4]),
    color: cleanColor(chineseValues[rowIndex][5]),
    color_powder_no: cleanColorPowder(englishValues[rowIndex][6]),
    material_type: cleanMaterial(
      chineseValues[rowIndex][7],
      englishValues[rowIndex][7],
    ),
    shot_weight: cleanNumber(englishValues[rowIndex][8]),
    material_kg: cleanNumber(englishValues[rowIndex][9]),
    delivery_date: cleanDeliveryDate(chineseValues[rowIndex][12]),
    notes: cleanNotes(chineseValues[rowIndex][13]),
  }));

  // A vertically merged product-code cell is often OCR'd on the middle row.
  // Backfill only the leading blank rows; normal downward inheritance remains unchanged.
  const firstProductIndex = rawRows.findIndex(row => row.product_code);
  if (firstProductIndex > 0) {
    const leadingProductCode = rawRows[firstProductIndex].product_code;
    for (let index = 0; index < firstProductIndex; index += 1) {
      rawRows[index].product_code = leadingProductCode;
    }
  }

  const orders = parseBeihuoRawRows(rawRows, extractHeaderInfo(headerText));
  if (orders.length === 0) return null;

  return {
    template: 'beihuo-image-grid',
    orders,
    rawText: headerText,
    diagnostics: {
      imageSize: [image.width, image.height],
      rows: rows.length,
    },
  };
}

function parseBeihuoImage(imagePath) {
  return runSerially(() => parseBeihuoImageInternal(imagePath));
}

module.exports = { parseBeihuoImage };
