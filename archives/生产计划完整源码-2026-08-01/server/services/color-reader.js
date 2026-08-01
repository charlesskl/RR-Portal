const JSZip = require('jszip');

const YELLOW_COLORS = new Set([
  'FFFFFF00', 'FFFFC000', 'FFFFF2CC', 'FFFFEB9C', 'FFFFFF99',
  'FFFFD966', 'FFFFFFE0', 'FFFFED00', 'FFFFCC00',
]);

const BLUE_COLORS = new Set([
  'FF9DC3E6', 'FF4472C4', 'FFBDD7EE', 'FF2E75B6', 'FF9BC2E6',
  'FF00B0F0', 'FF0070C0', 'FFB8CCE4', 'FFDAE3F3', 'FF1F77B4',
]);

function isYellowColor(rgb) {
  if (!rgb) return false;
  const upper = rgb.toUpperCase().replace(/^#/, '');
  const argb = upper.length === 6 ? 'FF' + upper : upper;
  return YELLOW_COLORS.has(argb);
}

function isBlueColor(rgb) {
  if (!rgb) return false;
  const upper = rgb.toUpperCase().replace(/^#/, '');
  const argb = upper.length === 6 ? 'FF' + upper : upper;
  return BLUE_COLORS.has(argb);
}

function parseThemeColors(themeXml) {
  const colors = [];
  const schemeMatch = themeXml.match(/<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/);
  if (!schemeMatch) return colors;
  const entries = schemeMatch[1].match(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g);
  if (!entries) return colors;
  const ordered = [];
  for (const entry of entries) {
    const sysMatch = entry.match(/lastClr="([^"]+)"/);
    const srgbMatch = entry.match(/srgbClr val="([^"]+)"/);
    ordered.push(sysMatch ? sysMatch[1] : (srgbMatch ? srgbMatch[1] : '000000'));
  }
  if (ordered.length >= 4) {
    colors[0] = ordered[1];
    colors[1] = ordered[0];
    colors[2] = ordered[3];
    colors[3] = ordered[2];
    for (let i = 4; i < ordered.length; i++) {
      colors[i] = ordered[i];
    }
  }
  return colors;
}

function applyTint(hexColor, tint) {
  if (!tint || tint === 0) return hexColor;
  const r = parseInt(hexColor.substring(0, 2), 16);
  const g = parseInt(hexColor.substring(2, 4), 16);
  const b = parseInt(hexColor.substring(4, 6), 16);
  let nr, ng, nb;
  if (tint > 0) {
    nr = Math.round(r + (255 - r) * tint);
    ng = Math.round(g + (255 - g) * tint);
    nb = Math.round(b + (255 - b) * tint);
  } else {
    nr = Math.round(r * (1 + tint));
    ng = Math.round(g * (1 + tint));
    nb = Math.round(b * (1 + tint));
  }
  const toHex = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return toHex(nr) + toHex(ng) + toHex(nb);
}

function parseStyles(stylesXml, themeColors) {
  const fills = [];
  const fillMatches = stylesXml.match(/<fill>[\s\S]*?<\/fill>/g) || [];
  for (const f of fillMatches) {
    const patternMatch = f.match(/patternType="([^"]+)"/);
    if (!patternMatch || patternMatch[1] !== 'solid') {
      fills.push(null);
      continue;
    }
    const rgbMatch = f.match(/fgColor rgb="([^"]+)"/);
    const themeMatch = f.match(/fgColor theme="([^"]+)"/);
    const tintMatch = f.match(/fgColor[^>]*tint="([^"]+)"/);
    if (rgbMatch) {
      fills.push(rgbMatch[1]);
    } else if (themeMatch) {
      const themeIdx = parseInt(themeMatch[1]);
      const baseColor = themeColors[themeIdx] || '000000';
      const tint = tintMatch ? parseFloat(tintMatch[1]) : 0;
      const resolved = applyTint(baseColor, tint);
      fills.push('FF' + resolved.toUpperCase());
    } else {
      fills.push(null);
    }
  }

  const styleColorMap = {};
  const xfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (xfsMatch) {
    const xfEntries = xfsMatch[1].match(/<xf[^>]*\/?>/g) || [];
    xfEntries.forEach((xf, i) => {
      const fillIdMatch = xf.match(/fillId="(\d+)"/);
      if (fillIdMatch) {
        const fillId = parseInt(fillIdMatch[1]);
        if (fills[fillId]) {
          styleColorMap[i] = fills[fillId];
        }
      }
    });
  }
  return styleColorMap;
}

/**
 * 解析 sharedStrings.xml 获取共享字符串表
 */
function parseSharedStrings(ssXml) {
  const strings = [];
  const siMatches = ssXml.match(/<si>([\s\S]*?)<\/si>/g) || [];
  for (const si of siMatches) {
    // 可能是 <t>text</t> 或 <r><t>text</t></r> (rich text)
    const tMatches = si.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
    let text = '';
    for (const t of tMatches) {
      const val = t.match(/<t[^>]*>([^<]*)<\/t>/);
      if (val) text += val[1];
    }
    // 解码 XML 实体
    strings.push(text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n'));
  }
  return strings;
}

/**
 * 将 Excel 列字母转换为 0-based 索引 (A=0, B=1, ..., Z=25, AA=26)
 */
function colLetterToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * 从 sheet XML 中提取行数据和颜色（优化版：快速跳过无颜色无表头的行）
 * async — 每 500 行 yield 一次 event loop，让 /health 等请求能跑（防 autoheal 误杀）
 */
async function parseSheetData(sheetXml, styleColorMap, sharedStrings) {
  const headerCandidates = []; // { rowNum, cellData, score }
  const coloredRows = []; // { rowNum, color, cells: {colIndex: value} }

  // 预先把样式映射按颜色类型分组（用于快速检测）
  const yellowStyleIds = new Set();
  const blueStyleIds = new Set();
  for (const [sId, color] of Object.entries(styleColorMap)) {
    if (isYellowColor(color)) yellowStyleIds.add(sId);
    else if (isBlueColor(color)) blueStyleIds.add(sId);
  }

  // 用索引手动遍历，避免大正则的回溯开销
  let pos = 0;
  let rowIdx = 0;
  while (true) {
    if (rowIdx > 0 && rowIdx % 500 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
    rowIdx++;
    const rowStart = sheetXml.indexOf('<row ', pos);
    if (rowStart === -1) break;
    const tagEnd = sheetXml.indexOf('>', rowStart);
    if (tagEnd === -1) break;
    // 查找 </row>
    const rowEnd = sheetXml.indexOf('</row>', tagEnd);
    if (rowEnd === -1) break;
    const rowOpenTag = sheetXml.substring(rowStart, tagEnd + 1);
    const row = sheetXml.substring(rowStart, rowEnd + 6);
    pos = rowEnd + 6;

    const rowNumMatch = rowOpenTag.match(/ r="(\d+)"/);
    if (!rowNumMatch) continue;
    const rowNum = parseInt(rowNumMatch[1]);
    const isHeaderRow = rowNum <= 6;

    // 快速跳过：非表头行 + 不含任何颜色样式 ID 的行
    if (!isHeaderRow) {
      // 检查是否包含任何 colored style id
      let hasColor = false;
      // 用简单 indexOf 快速检测
      for (const sId of yellowStyleIds) {
        if (row.indexOf(`s="${sId}"`) !== -1) { hasColor = true; break; }
      }
      if (!hasColor) {
        for (const sId of blueStyleIds) {
          if (row.indexOf(`s="${sId}"`) !== -1) { hasColor = true; break; }
        }
      }
      if (!hasColor) continue;
    }

    // 用 indexOf 手动遍历单元格（避免正则回溯）
    const cells = [];
    let cp = 0;
    while (true) {
      const cs = row.indexOf('<c ', cp);
      if (cs === -1) break;
      // 找到属性区结束（`/>` 或 `>`）
      const gtIdx = row.indexOf('>', cs);
      if (gtIdx === -1) break;
      if (row[gtIdx - 1] === '/') {
        // 自闭合，无内容
        cells.push(row.substring(cs, gtIdx + 1));
        cp = gtIdx + 1;
      } else {
        const ce = row.indexOf('</c>', gtIdx);
        if (ce === -1) break;
        cells.push(row.substring(cs, ce + 4));
        cp = ce + 4;
      }
    }

    let yellowCount = 0;
    let blueCount = 0;
    let rowColor = null;

    for (const cell of cells) {
      const refMatch = cell.match(/r="([A-Z]+)\d+"/);
      if (refMatch && colLetterToIndex(refMatch[1]) >= 10) continue;
      const sMatch = cell.match(/ s="(\d+)"/);
      if (sMatch) {
        if (yellowStyleIds.has(sMatch[1])) yellowCount++;
        else if (blueStyleIds.has(sMatch[1])) blueCount++;
      }
    }
    if (yellowCount >= 3) rowColor = 'yellow';
    else if (blueCount >= 3) rowColor = 'blue';

    if (!isHeaderRow && !rowColor) continue;

    const cellData = {};
    for (const cell of cells) {
      const refMatch = cell.match(/r="([A-Z]+)(\d+)"/);
      if (!refMatch) continue;
      const colIdx = colLetterToIndex(refMatch[1]);
      // 自闭合单元格无值
      if (cell.endsWith('/>')) continue;
      const typeMatch = cell.match(/ t="([^"]+)"/);
      const valMatch = cell.match(/<v>([^<]*)<\/v>/);

      let value = '';
      if (valMatch) {
        if (typeMatch && typeMatch[1] === 's') {
          const ssIdx = parseInt(valMatch[1]);
          value = sharedStrings[ssIdx] || '';
        } else if (typeMatch && typeMatch[1] === 'inlineStr') {
          const tMatch = cell.match(/<t[^>]*>([^<]*)<\/t>/);
          value = tMatch ? tMatch[1] : '';
        } else {
          value = valMatch[1];
        }
      } else {
        const isMatch = cell.match(/<is>\s*<t[^>]*>([^<]*)<\/t>\s*<\/is>/);
        if (isMatch) value = isMatch[1];
      }

      cellData[colIdx] = value;
    }

    if (isHeaderRow) {
      // 收集表头候选行：前10列中有多个短中文值（连续的、非括号开头的）
      const frontCols = Object.entries(cellData).filter(([k]) => parseInt(k) < 10);
      const headerLikeCols = frontCols.filter(([, v]) =>
        typeof v === 'string' && /[\u4e00-\u9fff]/.test(v) && v.length < 15
        && !v.startsWith('(') && !v.startsWith('（') // 排除颜色说明行
      );
      if (headerLikeCols.length >= 4) {
        headerCandidates.push({
          rowNum,
          cellData,
          score: headerLikeCols.length,
        });
      }
    }

    if (rowColor) {
      coloredRows.push({ rowNum, color: rowColor, cells: cellData });
    }
  }

  // 选择评分最高的候选行作为表头（平手时选行号大的，更可能是真正表头）
  let headerData = {};
  if (headerCandidates.length > 0) {
    headerCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.rowNum - a.rowNum;
    });
    headerData = headerCandidates[0].cellData;
  }

  return { headerData, coloredRows };
}

// 不需要读的 sheet 名关键词
// 半成品 sheet 要读：同一 PO 的半成品 + 成品 是两条独立订单，半成品早一周完成，必须排进生产计划
const SKIP_SHEET_KEYWORDS = ['MA', '包装', '包裝', '车缝', '布料', '取消', '转', '樣板', '样板', 'Sheet', '_xlnm', 'microsoft'];

function shouldSkipSheet(name) {
  return SKIP_SHEET_KEYWORDS.some(kw => name.includes(kw));
}

/**
 * 获取 workbook 中的 sheet 名称和对应文件路径（过滤掉不需要的 sheet）
 */
function parseWorkbook(wbXml) {
  const sheets = [];
  const sheetMatches = wbXml.match(/<sheet[^>]+\/>/g) || [];
  for (const s of sheetMatches) {
    const nameMatch = s.match(/name="([^"]+)"/);
    const idMatch = s.match(/r:id="([^"]+)"/);
    if (nameMatch && idMatch) {
      if (!shouldSkipSheet(nameMatch[1])) {
        sheets.push({ name: nameMatch[1], rId: idMatch[1] });
      }
    }
  }
  return sheets;
}

function parseRels(relsXml) {
  const rels = {};
  const relMatches = relsXml.match(/<Relationship[^>]+\/>/g) || [];
  for (const r of relMatches) {
    const idMatch = r.match(/Id="([^"]+)"/);
    const targetMatch = r.match(/Target="([^"]+)"/);
    if (idMatch && targetMatch) {
      rels[idMatch[1]] = targetMatch[1];
    }
  }
  return rels;
}

async function parseExcelWithColors(fileBuffer, fileName) {
  const results = [];
  const header = fileBuffer.slice(0, 4).toString('hex');
  const isXlsx = header === '504b0304';
  const isXls = header === 'd0cf11e0';

  if (isXls) {
    // 老 .xls 二进制格式，JSZip 读不了 — 走 SheetJS 路径
    return parseXlsWithSheetJS(fileBuffer, fileName);
  }
  if (!isXlsx) {
    return results;
  }

  const zip = await JSZip.loadAsync(fileBuffer);

  // 解析 theme
  let themeColors = [];
  const themeFile = zip.file('xl/theme/theme1.xml');
  if (themeFile) {
    const themeXml = await themeFile.async('string');
    themeColors = parseThemeColors(themeXml);
  }

  // 解析 styles
  const stylesFile = zip.file('xl/styles.xml');
  let styleColorMap = {};
  if (stylesFile) {
    const stylesXml = await stylesFile.async('string');
    styleColorMap = parseStyles(stylesXml, themeColors);
  }

  // 解析 sharedStrings
  let sharedStrings = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ssXml = await ssFile.async('string');
    sharedStrings = parseSharedStrings(ssXml);
  }

  // 获取 sheet 列表
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) return results;
  const wbXml = await wbFile.async('string');
  const sheets = parseWorkbook(wbXml);

  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  let rels = {};
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    rels = parseRels(relsXml);
  }

  // 逐个 sheet 解析
  for (let sheetIdx = 0; sheetIdx < sheets.length; sheetIdx++) {
    const sheet = sheets[sheetIdx];
    const target = rels[sheet.rId];
    if (!target) continue;
    const sheetPath = 'xl/' + target.replace(/^\//, '');
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;

    const sheetXml = await sheetFile.async('string');
    // 每个 sheet 之前让出 event loop，避免多 sheet 大文件把主线程卡住
    if (sheetIdx > 0) await new Promise(resolve => setImmediate(resolve));
    const { headerData, coloredRows } = await parseSheetData(sheetXml, styleColorMap, sharedStrings);

    if (coloredRows.length === 0) continue;

    // 构建表头映射（清理换行符和多余空格）
    const headers = {};
    for (const [colIdx, val] of Object.entries(headerData)) {
      headers[colIdx] = String(val).replace(/[\n\r]/g, '').replace(/\s+/g, '').trim();
    }
    const headerNames = Object.values(headers);

    for (const { rowNum, color, cells } of coloredRows) {
      const rowData = {};
      for (const [colIdx, val] of Object.entries(cells)) {
        const headerName = headers[colIdx];
        if (headerName) {
          rowData[headerName] = val;
        }
      }

      // 跳过空行
      if (Object.values(rowData).every(v => v === '' || v === null || v === undefined)) continue;

      results.push({
        type: color === 'yellow' ? 'new' : 'modified',
        file: fileName,
        sheet: sheet.name,
        row: rowNum,
        headers: headerNames,
        data: rowData,
      });
    }
  }

  return results;
}

// .xls (老二进制) — 用 SheetJS 读 cellStyles，套用和 .xlsx 同样的颜色识别算法
function parseXlsWithSheetJS(fileBuffer, fileName) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(fileBuffer, { type: 'buffer', cellStyles: true, cellFormula: false });
  const results = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);

    // 1) 找表头行（行号 0..5，前 10 列里有 >=4 个短中文且非"("开头）
    const headerCandidates = [];
    for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
      let score = 0;
      const rowData = {};
      for (let c = range.s.c; c <= Math.min(9, range.e.c); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const v = cell?.v;
        if (typeof v === 'string' && /[一-鿿]/.test(v) && v.length < 15
            && !v.startsWith('(') && !v.startsWith('（')) {
          score++;
        }
        if (v != null) rowData[c] = v;
      }
      if (score >= 4) headerCandidates.push({ r, score });
    }
    if (headerCandidates.length === 0) continue;
    headerCandidates.sort((a, b) => (b.score - a.score) || (b.r - a.r));
    const headerRow = headerCandidates[0].r;

    // 2) 收完整表头（全列）
    const headers = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      if (cell?.v != null) {
        headers[c] = String(cell.v).replace(/[\n\r]/g, '').replace(/\s+/g, '').trim();
      }
    }
    const headerNames = Object.values(headers);

    // 3) 扫数据行 — 前 10 列里黄/蓝格子 >=3 个 → 这行被选中
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      let yellowCount = 0;
      let blueCount = 0;
      for (let c = range.s.c; c <= Math.min(9, range.e.c); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const rgb = cell?.s?.fgColor?.rgb;
        if (!rgb) continue;
        if (isYellowColor(rgb)) yellowCount++;
        else if (isBlueColor(rgb)) blueCount++;
      }
      let rowColor = null;
      if (yellowCount >= 3) rowColor = 'yellow';
      else if (blueCount >= 3) rowColor = 'blue';
      if (!rowColor) continue;

      // 收整行数据
      const rowData = {};
      let nonEmpty = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const hn = headers[c];
        if (!hn) continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const v = cell?.v;
        if (v == null) { rowData[hn] = ''; continue; }
        rowData[hn] = v;
        if (v !== '' && v !== null && v !== undefined) nonEmpty = true;
      }
      if (!nonEmpty) continue;

      results.push({
        type: rowColor === 'yellow' ? 'new' : 'modified',
        file: fileName,
        sheet: sheetName,
        row: r + 1,
        headers: headerNames,
        data: rowData,
      });
    }
  }

  return results;
}

module.exports = { parseExcelWithColors };
