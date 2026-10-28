/**
 * 面单 ↔ 发票金额核对：面单（大陆块 J=金额USD、K=金额HK$=J×7.75）对照
 * 「修改大陆发票」工作簿每票的 USD 总金额（多段票取最后一段的累计合计）。
 * 相等关系：面单K == 发票USD总额 × 7.75（等价 面单J == 发票USD总额），容差 0.02。
 *
 * 规范化：发票号统一大写去空格；全角/半角括号 REV「(REV1)」「（REV1）」→「REV1」；
 * 旧面单国际票的 A 前缀（A97438）剥掉；多段票 X/X-2/X-3 按基号归组取最后一段。
 * 面单 J/K 是活公式，一律读缓存值（我方生成与 Excel 产物都带缓存），不做公式求值。
 *
 * 纯 ESM，浏览器 / Node 通用（依赖 xlsx 读、jszip 写分析报告）。
 */

import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export const RATE = 7.75;
export const DISCOUNT = 0.967;
export const TOLERANCE = 0.02;

/** 发票号规范化：大写、去空格、全角括号 REV 归一、旧面单 A 前缀剥除 */
export function normInvKey(raw) {
  let s = String(raw ?? '').toUpperCase().replace(/\s+/g, '')
    .replace(/（/g, '(').replace(/）/g, ')');
  s = s.replace(/\(REV(\d+)\)/g, 'REV$1');
  if (/^A\d/.test(s)) s = s.slice(1);
  return s;
}

/** 剥多段后缀：'97525-4' → { base:'97525', seg:4 }；无后缀 seg=1 */
export function splitSegment(name) {
  const m = String(name).match(/^(.*?)-(\d+)$/);
  return m ? { base: m[1], seg: +m[2] } : { base: String(name), seg: 1 };
}

/**
 * 发票号解析：规范化后拆 REV 与多段后缀。
 * '97452-2(REV1)' → { key:'97452REV1', rev:1, seg:2 }（多段票核对键 = 基号+REV）
 */
export function parseInvName(raw) {
  let s = normInvKey(raw);
  let rev = 0;
  const rm = s.match(/REV(\d+)$/);
  if (rm) { rev = +rm[1]; s = s.slice(0, rm.index); }
  const { base, seg } = splitSegment(s);
  return { key: base + (rev ? `REV${rev}` : ''), rev, seg };
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 逐单元格遍历（直接按地址读，规避 sheet_to_json 受 dimension 起点影响的行偏移） */
function eachRow(ws, cb) {
  const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = ref.s.r; r <= ref.e.r; r++) {
    cb((col) => { const c = ws[`${col}${r + 1}`]; return c ? c.v : null; }, r + 1);
  }
}

/* ---------------- 面单读取 ---------------- */

/**
 * 读面单工作簿（我方生成或文员旧面单，.xlsx）。
 * 返回 { rows:[{ key, inv, year, month, dateStr, dUsd, jUsd, kHk, sheetName }], dupKeys:[], sheetNames }
 * 数据行 = A 列 'm/d' 且 C 列有发票号且 D 列是金额；月份取自「兴信2026年6月份」块标题。
 */
export function parseMiandanBook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const rows = [], dupKeys = [];
  const seen = new Set();
  for (const sheetName of wb.SheetNames) {
    let year = null, month = null;
    eachRow(wb.Sheets[sheetName], (cell, r) => {
      const a = str(cell('A')).trim();
      const tm = a.match(/兴信(\d{4})年(\d{1,2})月份/);
      if (tm) { year = +tm[1]; month = +tm[2]; return; }
      if (!/^(\d{1,2})\/(\d{1,2})$/.test(a)) return;
      const inv = str(cell('C')).trim();
      const d = num(cell('D'));
      if (!inv || d === null) return;
      const j = num(cell('J')) ?? d * DISCOUNT;
      const k = num(cell('K')) ?? j * RATE;
      const key = parseInvName(inv).key;
      if (seen.has(`${sheetName}${key}`)) dupKeys.push(key);
      seen.add(`${sheetName}${key}`);
      rows.push({ key, inv, year, month, dateStr: a, dUsd: d, jUsd: j, kHk: k, sheetName });
    });
  }
  if (!rows.length) throw new Error('面单里没有识别到任何发票行（请确认是二车间大陆面单 .xlsx）');
  return { rows, dupKeys, sheetNames: wb.SheetNames };
}

/* ---------------- 发票工作簿读取 ---------------- */

/**
 * 读「修改大陆发票」工作簿，逐 sheet 找 USD 总金额。
 * 合计行 = H 列 'USD'、I 列数值、D 列空 的最后一行（多段票的非最后一段合计留空，自然跳过；
 * 历史母版同样适用）。发票号取新版 H9 或旧版 H10（含 REV 后缀），回退 sheet 名。
 * 多段按基号归组取最后一段（段号最大者）。
 * 返回 { map: key → { inv, usd, seg, sheetName }, sheetCount, noTotalSheets }
 */
export function parseInvoiceBook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const map = new Map();
  let noTotalSheets = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const h9 = str(ws['H9']?.v).trim();
    const h10 = str(ws['H10']?.v).trim();
    const invoiceName = [h9, h10].find((value) => /^(ZB)?\d+(?:-\d+)?(?:REV\d+)?$/.test(normInvKey(value))) || sheetName;
    let total = null;
    eachRow(ws, (cell) => {
      if (str(cell('H')).trim() !== 'USD') return;
      const v = num(cell('I'));
      if (v === null) return;
      const d = cell('D');
      if (d !== null && str(d).trim() !== '') return; // 明细行（D 有数量）
      total = v; // 取最后一个满足条件的行
    });
    if (total === null) { noTotalSheets++; continue; }
    const { key, seg } = parseInvName(invoiceName);
    if (!/^(ZB)?\d/.test(key)) { noTotalSheets++; continue; } // 模版/格式说明类 sheet（如「发票格式REV1」）
    const old = map.get(key);
    if (!old || seg >= old.seg) map.set(key, { inv: invoiceName, usd: total, seg, sheetName });
  }
  return { map, sheetCount: wb.SheetNames.length, noTotalSheets };
}

/* ---------------- 核对 ---------------- */

/**
 * 核对：返回 { rows, summary }
 * rows: [{ key, inv, year, month, dateStr, jUsd, kHk, invUsd, expectHk, diffUsd, diffHk, result }]
 * 判定口径：|面单J(USD) − 发票USD总额| ≤ tol（面单 D 列先两位舍入，HK 口径会放大 ×7.75）；
 * HK 差异列照常输出供人工参考。result: 一致 | 差异 | 仅面单有 | 仅发票有；按发票号数字升序（REV 跟在基号后）。
 */
export function reconcile(miandanRows, invMap, tol = TOLERANCE) {
  const used = new Set();
  const rows = [];
  const unmatchedM = [];
  const pair = (m, inv, revFallback) => {
    used.add(inv.key);
    const expectHk = inv.usd * RATE;
    const diffUsd = m.jUsd - inv.usd;
    rows.push({
      key: m.key, inv: m.inv, year: m.year, month: m.month, dateStr: m.dateStr, sheetName: m.sheetName,
      jUsd: m.jUsd, kHk: m.kHk, invUsd: inv.usd, expectHk,
      diffUsd, diffHk: m.kHk - expectHk,
      revFallback: !!revFallback,
      result: Math.abs(diffUsd) <= tol ? '一致' : '差异',
    });
  };
  // 第一遍：精确匹配（发票号规范化后）
  for (const m of miandanRows) {
    const inv = invMap.get(m.key);
    if (!inv) { unmatchedM.push(m); continue; }
    pair(m, { ...invMap.get(m.key), key: m.key }, false);
  }
  // 第二遍：REV 规范化匹配——面单与发票一侧带 REV 一侧不带的，按去 REV 基号双方唯一时配对
  const mByBase = new Map();
  for (const m of unmatchedM) {
    const b = m.key.replace(/REV\d+$/, '');
    if (!mByBase.has(b)) mByBase.set(b, []);
    mByBase.get(b).push(m);
  }
  const invByBase = new Map();
  for (const [key, inv] of invMap) {
    if (used.has(key)) continue;
    const b = key.replace(/REV\d+$/, '');
    if (!invByBase.has(b)) invByBase.set(b, []);
    invByBase.get(b).push({ ...inv, key });
  }
  for (const m of unmatchedM) {
    const b = m.key.replace(/REV\d+$/, '');
    const ms = mByBase.get(b) || [];
    const is = invByBase.get(b) || [];
    if (ms.length === 1 && is.length === 1) {
      pair(m, is[0], true);
      mByBase.delete(b); invByBase.delete(b);
    }
  }
  for (const m of unmatchedM) {
    const b = m.key.replace(/REV\d+$/, '');
    if (mByBase.has(b) && mByBase.get(b).includes(m)) {
      rows.push({ key: m.key, inv: m.inv, year: m.year, month: m.month, dateStr: m.dateStr, sheetName: m.sheetName, jUsd: m.jUsd, kHk: m.kHk, invUsd: null, expectHk: null, diffUsd: null, diffHk: null, result: '仅面单有' });
    }
  }
  for (const [key, inv] of invMap) {
    if (used.has(key)) continue;
    rows.push({ key, inv: inv.inv, year: null, month: null, dateStr: '', jUsd: null, kHk: null, invUsd: inv.usd, expectHk: inv.usd * RATE, diffUsd: null, diffHk: null, result: '仅发票有' });
  }
  const numOf = (k) => { const m = k.match(/\d+/); return m ? +m[0] : Infinity; };
  rows.sort((a, b) => (numOf(a.key) - numOf(b.key)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const summary = {
    total: rows.length,
    miandanCount: miandanRows.length,
    invoiceCount: invMap.size,
    match: rows.filter((r) => r.result === '一致').length,
    diff: rows.filter((r) => r.result === '差异').length,
    onlyMiandan: rows.filter((r) => r.result === '仅面单有').length,
    onlyInvoice: rows.filter((r) => r.result === '仅发票有').length,
    revFallback: rows.filter((r) => r.revFallback).length,
    tolerance: tol,
  };
  return { rows, summary };
}

/* ---------------- 分析 Excel 输出 ---------------- */

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => String.fromCharCode(65 + i);
// 样式号：0 默认 1 表头 2 金额 3 文本红 4 金额红 5 文本黄 6 金额黄
const STYLE_TEXT = { 差异: 3, 仅面单有: 5, 仅发票有: 5 };
const STYLE_MONEY = { 差异: 4, 仅面单有: 6, 仅发票有: 6 };

function cellXml(r, c, v, s) {
  const ref = `${colName(c)}${r}`;
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
  if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
}

/**
 * 生成「面单发票核对分析」xlsx（ArrayBuffer）。
 * 汇总行在顶部；明细列：发票号 | 月份 | 面单日期 | 面单USD(J) | 面单HK(K) | 发票USD总额(末段) | ×7.75 | HK差异 | 结果
 * 差异行红底、缺边（仅单边）黄底。
 */
export async function buildReportBuffer({ rows, summary }, generatedAt = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  const stamp = `${generatedAt.getFullYear()}-${p(generatedAt.getMonth() + 1)}-${p(generatedAt.getDate())} ${p(generatedAt.getHours())}:${p(generatedAt.getMinutes())}`;
  const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

  const xmlRows = [];
  let r = 1;
  xmlRows.push(`<row r="${r}">${cellXml(r, 0, `面单发票核对分析（判定：|面单J−发票USD| ≤ ${summary.tolerance} USD） 生成于 ${stamp}`, 1)}</row>`); r++;
  xmlRows.push(`<row r="${r}">${cellXml(r, 0, `面单 ${summary.miandanCount} 行 / 发票 ${summary.invoiceCount} 张 · 一致 ${summary.match} · 差异 ${summary.diff} · 仅面单有 ${summary.onlyMiandan} · 仅发票有 ${summary.onlyInvoice}`, 0)}</row>`); r++;
  r++; // 空行
  const head = ['发票号', '月份', '面单日期', '面单USD(J)', '面单HK(K)', '发票USD总额(末段)', '×7.75', 'HK差异', '结果'];
  xmlRows.push(`<row r="${r}">${head.map((h, c) => cellXml(r, c, h, 1)).join('')}</row>`); r++;
  for (const row of rows) {
    const st = STYLE_TEXT[row.result] || 0;
    const sm = STYLE_MONEY[row.result] || 2;
    const month = row.year ? `${row.year}-${p(row.month)}` : '';
    const cells = [
      cellXml(r, 0, row.inv, st),
      cellXml(r, 1, month, st),
      cellXml(r, 2, row.dateStr, st),
      cellXml(r, 3, r2(row.jUsd), sm),
      cellXml(r, 4, r2(row.kHk), sm),
      cellXml(r, 5, r2(row.invUsd), sm),
      cellXml(r, 6, r2(row.expectHk), sm),
      cellXml(r, 7, r2(row.diffHk), sm),
      cellXml(r, 8, row.result, st),
    ];
    xmlRows.push(`<row r="${r}">${cells.join('')}</row>`); r++;
  }
  const lastRow = r - 1;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${[16, 9, 9, 13, 13, 17, 13, 11, 10].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${xmlRows.join('')}</sheetData></worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>invoice-generator</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt.toISOString()}</dcterms:created></cp:coreProperties>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="核对分析" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', stylesXml);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
