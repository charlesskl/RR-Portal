import ExcelJS from 'exceljs';

function argbToRgb(argb) {
  if (!argb) return null;
  const hex = String(argb).toUpperCase().replace(/[^0-9A-F]/g, '');
  const rgb = hex.length >= 8 ? hex.slice(-6) : hex;
  if (rgb.length !== 6) return null;
  return {
    r: parseInt(rgb.slice(0, 2), 16),
    g: parseInt(rgb.slice(2, 4), 16),
    b: parseInt(rgb.slice(4, 6), 16)
  };
}

// 字体红色：覆盖标准红 #FF0000、深红 #C00000 / #9C0006、暗红 #800000 等
function isRedFromArgb(argb) {
  const c = argbToRgb(argb);
  if (!c) return false;
  if (c.r < 120) return false;
  if (c.g > 120 || c.b > 120) return false;
  if (c.r - c.g < 70 || c.r - c.b < 70) return false;
  return true;
}

// 填充红色：覆盖 Excel 内置"差"风格的浅红 #FFC7CE，规则更宽松
function isRedFillFromArgb(argb) {
  const c = argbToRgb(argb);
  if (!c) return false;
  if (c.r < 200) return false;
  if (c.r <= c.g || c.r <= c.b) return false;
  if (c.r - c.g < 25 || c.r - c.b < 25) return false;
  return true;
}

export function isRedFont(font) {
  if (!font || !font.color) return false;
  const c = font.color;
  if (c.argb) return isRedFromArgb(c.argb);
  if (typeof c.indexed === 'number') {
    return [2, 3, 10].includes(c.indexed);
  }
  return false;
}

function isRedFill(fill) {
  if (!fill) return false;
  const c = fill.fgColor || fill.bgColor;
  if (!c || !c.argb) return false;
  return isRedFillFromArgb(c.argb);
}

// 合并单元格从属位置取数据需要回到 master，否则 cell.text 会抛 MergeValue.toString 错误
function effectiveCell(cell) {
  if (!cell) return cell;
  try {
    if (cell.master && cell.master !== cell) return cell.master;
  } catch { /* ignore */ }
  return cell;
}

function safeText(cell) {
  if (!cell) return '';
  const src = effectiveCell(cell);
  try {
    if (src && src.text != null) return String(src.text);
  } catch { /* fall through */ }
  // 兜底：直接读 value
  try {
    const v = src && src.value;
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (v.richText && Array.isArray(v.richText)) return v.richText.map(r => r.text || '').join('');
    if (v.text) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.formula) return '';
  } catch { /* ignore */ }
  return '';
}

function cellIsRed(cell) {
  const src = effectiveCell(cell);
  if (!src) return false;
  try {
    if (isRedFont(src.font)) return true;
    const v = src.value;
    if (v && typeof v === 'object' && Array.isArray(v.richText)) {
      for (const run of v.richText) {
        if (isRedFont(run.font)) return true;
      }
    }
    if (isRedFill(src.fill)) return true;
  } catch { /* ignore */ }
  return false;
}

const CHECK_MARK_RE = /^[■□☐✓×√◇◆▲△○●—\-_\s]+$/;
const STRONG_FAIL_RE = /FAIL|NG\b|不合格|不通过|异常|超差|超标|缺陷|损坏|破损|裂|起锈|划痕|磨花|擦花|脱漆|偏差/i;
const WEAK_PASS_RE = /\b(PASS(ED)?|OK|TRUE)\b|合\s*格|通\s*过|完\s*成/i;
// 整体结论模板行 —— "Conclusion 結論：□PASSED ■FAILED □INF.ONLY" 这种带选项框的行，不计入条目
const CONCLUSION_LINE_RE = /Conclusion|結\s*論|结\s*论|INF\.?ONLY|僅\s*供\s*參\s*考|仅供参考/i;

function isCheckmarkOnly(text) {
  const t = (text || '').trim();
  return !t || CHECK_MARK_RE.test(t);
}

function classifyRow(aggregateText) {
  const t = (aggregateText || '').trim();
  if (!t) return 'empty';
  if (CHECK_MARK_RE.test(t)) return 'noise';
  if (CONCLUSION_LINE_RE.test(t)) return 'noise';
  if (STRONG_FAIL_RE.test(t)) return 'fail';
  if (WEAK_PASS_RE.test(t)) return 'noise';
  return 'fail';
}

// 智能找表头：跳过全行同值的合并标题行，找到第一个内容差异化的行
function detectHeaderRow(sheet, maxCol) {
  const limit = Math.min(sheet.rowCount, 15);
  for (let r = 1; r <= limit; r++) {
    const row = sheet.getRow(r);
    const values = [];
    let nonEmpty = 0;
    for (let c = 1; c <= maxCol; c++) {
      const t = safeText(row.getCell(c)).trim();
      values.push(t);
      if (t) nonEmpty++;
    }
    if (nonEmpty < 2) continue;
    const unique = new Set(values.filter(Boolean));
    // 如果该行不同内容数 >= 2 且不全是同一个合并标题文本，作为表头
    if (unique.size >= 2) {
      return { rowNumber: r, headers: values.map((t, i) => t || `第${i + 1}列`) };
    }
  }
  // 找不到合适表头：用列号
  const fallback = [];
  for (let c = 1; c <= maxCol; c++) fallback.push(`第${c}列`);
  return { rowNumber: 0, headers: fallback };
}

// 把连续同 header 的列合并成 group（合并单元格表头展开后会出现这种情况）
function computeHeaderGroups(rawHeaders) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i];
    const col = i + 1;
    if (cur && cur.header === h) {
      cur.cols.push(col);
    } else {
      cur = { header: h, cols: [col] };
      groups.push(cur);
    }
  }
  return groups;
}

function compactCellsByGroups(headerGroups, snapByCol, redColSet) {
  return headerGroups.map(g => {
    const present = g.cols.map(c => snapByCol.get(c)).filter(Boolean);
    const texts = present.map(s => s.text).filter(t => t !== '');
    const unique = [...new Set(texts)];
    let value;
    if (unique.length === 0) value = '';
    else if (unique.length === 1) value = unique[0];
    else value = unique.join(' / ');
    const isRed = present.some(s => redColSet.has(s.colNumber));
    return {
      col: g.cols[0],
      header: g.header,
      value,
      isRed,
      mergedColCount: g.cols.length
    };
  });
}

function extractSheetImages(wb, sheet) {
  const out = [];
  let raw = [];
  try { raw = sheet.getImages() || []; } catch { raw = []; }
  for (const img of raw) {
    try {
      const data = wb.getImage(img.imageId);
      if (!data || !data.buffer) continue;
      const r = img.range || {};
      const tl = r.tl || { col: 0, row: 0 };
      const br = r.br || tl;
      out.push({
        sheetName: sheet.name,
        imageId: img.imageId,
        extension: (data.extension || 'png').toLowerCase(),
        buffer: data.buffer,
        fromRow: Math.floor(tl.row) + 1,
        toRow: Math.ceil(br.row) + 1,
        fromCol: Math.floor(tl.col) + 1,
        toCol: Math.ceil(br.col) + 1
      });
    } catch { /* skip broken image */ }
  }
  return out;
}

// 把连续 fail rows 分组，每组配对该组之后到下一组之前的图片
// 第一个 fail row 之前的图片视为"样板图"（通常是 sheet 顶部产品参考区），跟"未关联"区分开
export function groupImagesByFailRows(failRows, images) {
  const sortedFails = [...failRows].sort((a, b) => a.rowNumber - b.rowNumber);
  const groups = [];
  let cur = null;
  for (const fr of sortedFails) {
    if (!cur || fr.rowNumber > cur.endRow + 1) {
      cur = { rows: [fr.rowNumber], startRow: fr.rowNumber, endRow: fr.rowNumber, images: [] };
      groups.push(cur);
    } else {
      cur.rows.push(fr.rowNumber);
      cur.endRow = fr.rowNumber;
    }
  }
  const used = new Set();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const imgStart = g.endRow + 1;
    const imgEnd = i + 1 < groups.length ? groups[i + 1].startRow - 1 : Infinity;
    g.images = images
      .filter(img => img.fromRow >= imgStart && img.fromRow <= imgEnd)
      .map(img => { used.add(img); return img; });
  }
  const allOrphan = images.filter(img => !used.has(img));
  const firstFailRow = groups.length > 0 ? groups[0].startRow : Infinity;
  const sampleImages = allOrphan.filter(img => img.fromRow < firstFailRow);
  const orphan = allOrphan.filter(img => img.fromRow >= firstFailRow);
  return { groups, sampleImages, orphan };
}

export async function parseExcelRedRows(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets = [];
  const rawImages = [];
  wb.eachSheet((sheet, sheetId) => {
    // 跳过隐藏 sheet
    if (sheet.state === 'hidden' || sheet.state === 'veryHidden') return;
    rawImages.push(...extractSheetImages(wb, sheet));

    const maxCol = sheet.actualColumnCount || sheet.columnCount || 0;
    const { rowNumber: headerRowNumber, headers: rawHeaders } = detectHeaderRow(sheet, maxCol);
    const headerGroups = computeHeaderGroups(rawHeaders);
    const headers = headerGroups.map(g => g.header);

    const failRows = [];
    let dataRowCount = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      dataRowCount++;

      const redCellsRaw = [];
      const cellSnapshots = [];

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = safeText(cell);
        const isRedRaw = cellIsRed(cell) && text.trim() !== '';
        cellSnapshots.push({ colNumber, text, isRedRaw });
        if (isRedRaw) redCellsRaw.push({ colNumber, text });
      });

      if (redCellsRaw.length === 0) return;

      // 行级判定：拼起来所有红字内容看是否包含强不合格信号 vs 弱通过信号
      const seenForAggregate = new Set();
      const uniqueRedTexts = [];
      for (const c of redCellsRaw) {
        const key = c.text.trim();
        if (!key || isCheckmarkOnly(key)) continue;
        if (seenForAggregate.has(key)) continue;
        seenForAggregate.add(key);
        uniqueRedTexts.push(key);
      }
      const aggregate = uniqueRedTexts.join(' ');
      const verdict = classifyRow(aggregate);
      if (verdict !== 'fail') return;

      // 构造去重后的 redCols（按 cell 文本去重，已经把合并区里的重复消掉）
      const seen = new Set();
      const redCols = [];
      const colToHeader = (col) => {
        const g = headerGroups.find(hg => hg.cols.includes(col));
        return g ? g.header : `第${col}列`;
      };
      for (const c of redCellsRaw) {
        const key = c.text.trim();
        if (!key || isCheckmarkOnly(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        redCols.push({
          col: c.colNumber,
          header: colToHeader(c.colNumber),
          value: c.text
        });
      }
      if (redCols.length === 0) return;

      const redColSet = new Set(redCellsRaw.map(c => c.colNumber));
      const snapByCol = new Map(cellSnapshots.map(s => [s.colNumber, s]));
      const cells = compactCellsByGroups(headerGroups, snapByCol, redColSet);

      failRows.push({ rowNumber, redCols, cells });
    });

    sheets.push({
      sheetId,
      name: sheet.name,
      headerRowNumber,
      headers,
      failRows,
      totalRows: dataRowCount,
      failCount: failRows.length
    });
  });

  return { sheets, rawImages };
}
