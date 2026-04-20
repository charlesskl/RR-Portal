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
 * 从 sheet XML 中提取行数据和颜色
 * 只解析有颜色的行 + 第一行(表头)
 */
function parseSheetData(sheetXml, styleColorMap, sharedStrings) {
  const rows = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  const headerCandidates = []; // { rowNum, cellData, score }
  const coloredRows = []; // { rowNum, color, cells: {colIndex: value} }

  for (const row of rows) {
    const rowNumMatch = row.match(/r="(\d+)"/);
    if (!rowNumMatch) continue;
    const rowNum = parseInt(rowNumMatch[1]);

    // 检测行颜色 — 需要前10列中至少3个单元格是同一颜色才算整行涂色
    let rowColor = null;
    const cells = row.match(/<c[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    let yellowCount = 0;
    let blueCount = 0;

    for (const cell of cells) {
      // 只检查前10列
      const refMatch = cell.match(/r="([A-Z]+)\d+"/);
      if (refMatch && colLetterToIndex(refMatch[1]) >= 10) continue;

      const sMatch = cell.match(/ s="(\d+)"/);
      if (sMatch) {
        const color = styleColorMap[parseInt(sMatch[1])];
        if (color) {
          if (isYellowColor(color)) yellowCount++;
          else if (isBlueColor(color)) blueCount++;
        }
      }
    }
    if (yellowCount >= 3) rowColor = 'yellow';

    // 只处理表头候选行(前5行)和有颜色的行
    if (rowNum > 5 && !rowColor) continue;

    const cellData = {};
    for (const cell of cells) {
      const refMatch = cell.match(/r="([A-Z]+)(\d+)"/);
      if (!refMatch) continue;
      const colIdx = colLetterToIndex(refMatch[1]);
      const typeMatch = cell.match(/ t="([^"]+)"/);
      const valMatch = cell.match(/<v>([^<]*)<\/v>/);

      let value = '';
      if (valMatch) {
        if (typeMatch && typeMatch[1] === 's') {
          // 共享字符串
          const ssIdx = parseInt(valMatch[1]);
          value = sharedStrings[ssIdx] || '';
        } else if (typeMatch && typeMatch[1] === 'inlineStr') {
          const tMatch = cell.match(/<t[^>]*>([^<]*)<\/t>/);
          value = tMatch ? tMatch[1] : '';
        } else {
          value = valMatch[1];
        }
      } else {
        // inline string without <v>
        const isMatch = cell.match(/<is>\s*<t[^>]*>([^<]*)<\/t>\s*<\/is>/);
        if (isMatch) value = isMatch[1];
      }

      cellData[colIdx] = value;
    }

    if (rowNum <= 6) {
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
const SKIP_SHEET_KEYWORDS = ['MA', '包装', '包裝', '半成品', '车缝', '布料', '取消', '转', '樣板', '样板', 'Sheet', '_xlnm', 'microsoft'];

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

  if (!isXlsx) {
    // .xls 格式无法读颜色，跳过
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
  for (const sheet of sheets) {
    const target = rels[sheet.rId];
    if (!target) continue;
    const sheetPath = 'xl/' + target.replace(/^\//, '');
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;

    const sheetXml = await sheetFile.async('string');
    const { headerData, coloredRows } = parseSheetData(sheetXml, styleColorMap, sharedStrings);

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

module.exports = { parseExcelWithColors };
