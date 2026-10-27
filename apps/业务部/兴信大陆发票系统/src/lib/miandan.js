/**
 * 面单生成器:从 ZURU 源簿提取每张发票的末版 sheet 总额与日期,按月分块生成面单。
 *  - 美国簿(减价40%后模版,ZB 系列 sheet)→「华登亚洲1-12月」
 *  - 国际簿(ZURU(国际),纯数字 sheet)→「华登(国际)1-12月」
 * 两本可同时上传,输出双 sheet;只传一本就只生成对应 sheet。
 *
 * 规则(第一阶段/第三阶段从真实面单簿全量推导,证据见 /tmp/miandan/verify_final.py、
 * /tmp/miandan/intl_whitelist.json):
 * - 金额 USD = 末版 sheet 总额,截断保留 2 位。美国簿=Total (Net )?Amount 行首个 H 列以右数值;
 *   国际簿=最后一个 USD$/USD 标记(H→I 或 J→K)右一格的数值
 * - 改版链取末版(不是求和):美国簿 …折-2/-3、…-2折(版本号在折前也算);国际簿 …-2/-3( sheet 名可带空格)
 * - 日期:美国簿=Date: 标签右侧首个非空值;国际簿=G/H 列前 9 行的日期(兼容右移版式),均写成 M/D 文本
 * - 发票号:美国簿=ZB 基号;国际簿=纯数字基号,末版 sheet 第 1 行含 (REVn) 标注时加 REVn 后缀
 * - 不静默漏票:缺总额/日期的候选 sheet、带「取消」标记的 sheet、名像发票号但内容不完整的草稿 sheet
 *   都会按名列入 warnings;前端按所选日期范围过滤展示（归不了月份的进「未注明月份」折叠组）
 * - 客名:亚洲 sheet 固定 ZURU INC;国际 sheet=末版 sheet A2(去首尾空格)
 * - 行结构:A 日期 / B 客名 / C 发票号 / D 金额USD / E=D*7.75 / G 序号 /
 *   H==A / I==C / J=D*0.967 / 亚洲 K=E*0.967、国际 K=7.75*J / 亚洲 M=序号、国际 M==G
 * - 块内(日期,发票号)升序,序号每块从 1;块末合计行 SUM;国际块数据区不足 10 行补到 10 行
 * - 标题行 兴信{年}年{月}月份(华登制品亚洲|国际香港发票) / (…大陆发票)
 *
 * 纯 ESM,浏览器 / Node 通用。不依赖 SheetJS——直接读 zip 内 XML(24MB/3600+ sheet 的源簿
 * 用 SheetJS 全量解析太慢;这里只扫候选 sheet 的关键行)。
 */

import JSZip from 'jszip';
import { XlsxPackage } from './xlsxPackage.js';
import { parseRows, styleOf, cellXml, esc } from './sheetBuilder.js';
import { ymdOfParts, inRangeYmd } from './dateRange.js';

const { cNum, cStr, cEmpty, cFormula } = cellXml;

const TPL_SHEET = '面单模版';
const TPL_SHEET_INTL = '面单模版国际';
export const TPL_FILE = '/miandan-tpl.xlsx';
const OUT_SHEET = '华登亚洲1-12月';
const OUT_SHEET_INTL = '华登（国际）1-12月';
const RATE = 0.967;
const HK_RATE = 7.75;

/** 美国簿发票 sheet 名:ZB05928折 / ZB05932折 / ZB06316折T-2 / ZB7714折-2 / ZB07047折 -2 / ZB06828-2折(版本号在折前) … */
const SHEET_RE = /^(ZB\d+(?:[（(]?REV\d[）)]?)?)\s*(?:-\s*(\d+))?\s*折?\s*T?\s*(?:-\s*(\d+))?\s*$/i;
/** 国际簿发票 sheet 名:97438 / 97525-4 / 97569 (尾空格) / 98476 -3 … */
const SHEET_RE_INTL = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/;

/** 规范化基号:去空白/全半角括号,大写(R1 不改写——sheet 名里没有 R1 写法) */
const normBase = (s) => s.replace(/[\s（）()]/g, '').toUpperCase();

/**
 * 从 sheet 名尽力提取发票基号（用于跳过/取消/草稿提示条目的月份归属）。
 * 取消 sheet 先去「取消」标记再按正常版式匹配；草稿等不合规名取首个发票号样式 token。
 * 匹配不到返回 null（调用方归入「未注明月份」）。
 */
export function baseOfSheetName(name) {
  const s = String(name || '').replace(/取消/g, '');
  let m = s.match(SHEET_RE);
  if (m) return normBase(m[1]);
  m = s.match(SHEET_RE_INTL);
  if (m) return m[1];
  m = s.match(/ZB\d+(?:[（(]?REV\d[）)]?)?/i) || s.match(/\d{4,}/);
  return m ? normBase(m[0]) : null;
}

const round2 = (v) => Math.trunc((v + 1e-9) * 100) / 100; // 截断保留两位，不四舍五入

/** Excel 序列号 → { y, m, d }(1899-12-30 起,UTC 换算避免时区漂移) */
function serialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** 解析 sharedStrings.xml 为文本数组(<si> 内所有 <t> 拼接) */
function parseSharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) =>
      t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    out.push(texts.join(''));
  }
  return out;
}

/** 列字母 → 列号 */
const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

/** 打开 zip,列出 sheet(名→部件路径)与 sharedStrings */
async function openBook(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relMap = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="(rId\d+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g))
    relMap.set(m[1], m[2]);
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="(rId\d+)"[^>]*\/?>/g)) {
    const target = relMap.get(m[2]);
    if (!target) continue;
    const p = target.replace(/^\//, '');
    sheets.push({ name: m[1], path: p.startsWith('xl/') ? p : `xl/${p}` });
  }
  let strings = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) strings = parseSharedStrings(await ssFile.async('string'));
  return { zip, sheets, strings };
}

/* ---------------- 美国簿解析 ---------------- */

async function parseUsBook({ zip, sheets, strings }, fileName) {
  const totalIdx = new Set(), dateIdx = new Set();
  strings.forEach((t, i) => {
    const ts = t.trim();
    if (/^Total (Net )?Amount$/.test(ts)) totalIdx.add(i);
    if (/^Date[:：]/.test(ts)) dateIdx.add(i);
  });

  const groups = new Map(); // base -> [{ n, name, path }]
  let ignored = 0;
  const cancelled = [], drafts = [];
  for (const s of sheets) {
    if (/取消/.test(s.name)) { cancelled.push(s.name); continue; }
    const m = s.name.match(SHEET_RE);
    if (!m) {
      ignored++;
      // 名像发票号（纯数字/数字-数字）但不合规：多半是缺发票号/日期的草稿，要点名
      if (/^\s*\d+\s*(?:-\s*\d+)?\s*$/.test(s.name)) drafts.push(s.name);
      continue;
    }
    const base = normBase(m[1]);
    const n = m[2] ? parseInt(m[2], 10) : m[3] ? parseInt(m[3], 10) : 1;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ n, name: s.name, path: s.path });
  }

  const bases = new Map();
  const skipped = [];
  for (const [base, versions] of groups) {
    versions.sort((a, b) => a.n - b.n);
    const last = versions[versions.length - 1];
    const xml = await zip.file(last.path).async('string');
    const { total, date } = extractTotalAndDate(xml, totalIdx, dateIdx, strings);
    if (total === null || !date) {
      skipped.push({ sheet: last.name, reason: total === null ? '缺 Total 行' : '缺 Date' });
      continue;
    }
    bases.set(base, { inv: base, total, date, versions: versions.length, sheetName: last.name });
  }
  return {
    kind: 'us', bases, skipped, ignored, cancelled, drafts,
    stats: {
      fileName, kind: 'us',
      sheetCount: sheets.length,
      candidates: [...groups.values()].reduce((s, g) => s + g.length, 0),
      finalCount: bases.size,
      revised: [...bases.values()].filter((b) => b.versions > 1).length,
    },
  };
}

/** 从 sheet XML 抽 Total (Net )?Amount 行首个 H 列以右数值 与 Date: 右侧首个非空值 */
function extractTotalAndDate(xml, totalIdx, dateIdx, strings) {
  let total = null, date = null;
  const rowRe = /<row\b[^>]*>[\s\S]*?<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const row = rm[0];
    // Total 行
    if (total === null) {
      let hit = false;
      for (const i of totalIdx) { if (row.includes(`t="s"><v>${i}</v>`)) { hit = true; break; } }
      if (hit) {
        const cellRe = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cellRe.exec(row))) {
          if (colNum(cm[1]) < 8) continue;
          const vm = cm[2] && cm[2].match(/<v>(-?[\d.]+)<\/v>/);
          if (vm) { total = parseFloat(vm[1]); break; }
        }
      }
    }
    // Date 行
    if (!date) {
      let labelCol = -1, hit = false;
      const cellRe = /<c r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
      let cm;
      const cells = [];
      while ((cm = cellRe.exec(row))) cells.push({ col: colNum(cm[1]), xml: cm[0] });
      for (const c of cells) {
        const sm = c.xml.match(/t="s"><v>(\d+)<\/v>/);
        if (sm && dateIdx.has(+sm[1])) { hit = true; labelCol = c.col; break; }
      }
      if (hit) {
        for (const c of cells) {
          if (c.col <= labelCol) continue;
          const nm = c.xml.match(/<v>(-?[\d.]+)<\/v>/);
          if (nm && !c.xml.includes('t="s"')) { date = serialToDate(parseFloat(nm[1])); break; }
          const sm = c.xml.match(/t="s"><v>(\d+)<\/v>/);
          if (sm) {
            const parsed = parseDateString(strings[+sm[1]]);
            if (parsed) { date = parsed; break; }
          }
          const im = c.xml.match(/<is><t[^>]*>([^<]+)<\/t><\/is>/);
          if (im) {
            const parsed = parseDateString(im[1]);
            if (parsed) { date = parsed; break; }
          }
        }
      }
    }
    if (total !== null && date) break;
  }
  return { total, date };
}

const EN_MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseDateString(s) {
  const m = String(s).match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  // 英文简写月份:1-Aug-26 / 1 Aug 2026
  const e = String(s).match(/(\d{1,2})\s*[-/\s]\s*([A-Za-z]{3,9})\s*[-/\s]\s*(\d{2,4})/);
  if (e) {
    const mon = EN_MONTH[e[2].slice(0, 3).toLowerCase()];
    if (mon) return { y: e[3].length === 2 ? 2000 + +e[3] : +e[3], m: mon, d: +e[1] };
  }
  return null;
}

/* ---------------- 国际簿解析 ---------------- */

async function parseIntlBook({ zip, sheets, strings }, fileName) {
  const usdIdx = new Set(), revIdx = new Map();
  strings.forEach((t, i) => {
    const ts = t.trim();
    if (ts === 'USD$' || ts === 'USD') usdIdx.add(i);
    const rm = ts.match(/[（(]\s*REV\s*(\d)\s*[）)]/i);
    if (rm && /\d{4}/.test(ts)) revIdx.set(i, parseInt(rm[1], 10));
  });

  const groups = new Map(); // base -> [{ n, name, path }]
  let ignored = 0;
  const cancelled = [], drafts = [];
  for (const s of sheets) {
    if (/取消/.test(s.name)) { cancelled.push(s.name); continue; }
    const m = s.name.match(SHEET_RE_INTL);
    if (!m) {
      ignored++;
      if (/折|\d{4,}/.test(s.name)) drafts.push(s.name);
      continue;
    }
    const base = m[1];
    const n = m[2] ? parseInt(m[2], 10) : 1;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ n, name: s.name, path: s.path });
  }

  const bases = new Map();
  const skipped = [];
  for (const [base, versions] of groups) {
    versions.sort((a, b) => a.n - b.n);
    const last = versions[versions.length - 1];
    const xml = await zip.file(last.path).async('string');
    const info = extractIntlInfo(xml, usdIdx, revIdx, strings);
    if (info.total === null || !info.date) {
      skipped.push({ sheet: last.name, reason: !info.date ? '缺 G3 日期' : '缺 USD 总额行' });
      continue;
    }
    const inv = info.rev ? `${base}REV${info.rev}` : base;
    bases.set(base, {
      inv, total: info.total, date: info.date, customer: info.customer,
      versions: versions.length, sheetName: last.name,
    });
  }
  return {
    kind: 'intl', bases, skipped, ignored, cancelled, drafts,
    stats: {
      fileName, kind: 'intl',
      sheetCount: sheets.length,
      candidates: [...groups.values()].reduce((s, g) => s + g.length, 0),
      finalCount: bases.size,
      revised: [...bases.values()].filter((b) => b.versions > 1).length,
    },
  };
}

/** 国际簿 sheet:总额=最后一个 USD$/USD 标记(H→I 或 J→K，右一格为金额)的行的金额;日期=G/H 列前 9 行;客名=A2;REV=第 1 行标注 */
function extractIntlInfo(xml, usdIdx, revIdx, strings) {
  let total = null, date = null, customer = '', rev = null;
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rn = +rm[1], row = rm[2];
    const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let amtCol = -1, ival = null;
    while ((cm = cellRe.exec(row))) {
      const col = cm[1], attrs = cm[2], inner = cm[3] || '';
      const sm = attrs.includes('t="s"') && inner.match(/<v>(\d+)<\/v>/);
      if (rn === 1 && sm && revIdx.has(+sm[1])) rev = revIdx.get(+sm[1]);
      if (col === 'A' && rn === 2 && sm) customer = strings[+sm[1]].trim();
      else if ((col === 'G' || col === 'H') && rn <= 9 && !date) {
        // 日期: G/H 列前 9 行（兼容 97805 右移一列的版式）；序列号限定 43000-49000(≈2017-2034)
        // 避开 G1/H3 上的发票号数字；H 列若实为 USD 标记则照常记 husd
        let got = false;
        if (sm) { const p = parseDateString(strings[+sm[1]]); if (p) { date = p; got = true; } }
        else {
          const nm = inner.match(/<v>(-?[\d.]+)<\/v>/);
          if (nm) { const v = parseFloat(nm[1]); if (v >= 43000 && v <= 49000) { date = serialToDate(v); got = true; } }
        }
        if (!got && col === 'H' && sm && usdIdx.has(+sm[1])) { amtCol = 9; ival = null; }
      }
      // USD$/USD 标记(H 或 J 列)右边一格的数值即该行金额;取最后一处(合计在明细下方)
      else if (sm && usdIdx.has(+sm[1]) && (col === 'H' || col === 'J')) { amtCol = colNum(col) + 1; ival = null; }
      else if (amtCol > 0 && colNum(col) === amtCol && !sm) {
        const nm = inner.match(/<v>(-?[\d.]+)<\/v>/);
        if (nm) ival = parseFloat(nm[1]);
      }
    }
    if (amtCol > 0 && ival !== null) total = ival; // 取最后一处(合计在明细下方)
  }
  return { total, date, customer, rev };
}

/* ---------------- 入口:自动识别簿型 ---------------- */

function detectKind(sheets) {
  let us = 0, intl = 0;
  for (const s of sheets) {
    if (SHEET_RE.test(s.name)) us++;
    else if (SHEET_RE_INTL.test(s.name)) intl++;
  }
  if (us > 0) return 'us';
  if (intl > 0) return 'intl';
  return null;
}

/**
 * 解析一个源簿(自动识别美国簿/国际簿)。
 * 返回 { kind:'us'|'intl', bases: Map, skipped, ignored, stats }
 * bases 只含末版;stats.skipped 记录缺总额/日期的候选 sheet。
 */
export async function parseAnySourceBook(arrayBuffer, fileName = '') {
  const book = await openBook(arrayBuffer);
  const kind = detectKind(book.sheets);
  if (kind === 'us') return parseUsBook(book, fileName);
  if (kind === 'intl') return parseIntlBook(book, fileName);
  throw new Error('源簿里没有识别到 ZB(美国)或纯数字(国际)发票 sheet');
}

/** 兼容旧入口:只按美国簿(ZB)解析 */
export async function parseSourceBook(arrayBuffer, fileName = '') {
  return parseUsBook(await openBook(arrayBuffer), fileName);
}

/** 合并同源簿的解析结果(同号取版本链更长的;并列取后者) */
export function mergeSources(parsedList) {
  const bases = new Map();
  const warnings = [];
  for (const p of parsedList) {
    for (const [base, v] of p.bases) {
      const old = bases.get(base);
      if (!old || v.versions >= old.versions) bases.set(base, v);
    }
    for (const s of p.skipped) warnings.push(`${p.stats.fileName}:${s.sheet} ${s.reason},已跳过`);
    for (const c of p.cancelled || []) warnings.push(`${p.stats.fileName}:${c} 标记「取消」,未进面单(如属误标请改名后重新上传)`);
    for (const d of p.drafts || []) warnings.push(`${p.stats.fileName}:${d} 名像发票号但内容不完整(疑似草稿),未进面单`);
  }
  return { bases, warnings };
}

/* ---------------- 面单样式(亚洲 / 国际) ---------------- */

const STYLE_ASIA = {
  tplSheet: TPL_SHEET,
  outSheet: OUT_SHEET,
  titleHk: (y, m) => `兴信${y}年${m}月份(华登制品亚洲香港发票)`,
  titleDl: (y, m) => `兴信${y}年${m}月份(华登制品亚洲大陆发票)`,
  header: ['日期', '客名', '发票NO:', '金额(USD)', '实收金额(HK$)', '备注', null,
           '日期', '发 票 NO:', '金额(USD)', '金  额 (HK$)', '备注', null],
  kFormula: (r) => `E${r}*${RATE}`,
  mCell: 'num',        // M 列写静态序号
  minSlots: 1,         // 数据区 = n 行 + 1 空行
  cust: () => 'ZURU INC',
};
const STYLE_INTL = {
  tplSheet: TPL_SHEET_INTL,
  outSheet: OUT_SHEET_INTL,
  titleHk: (y, m) => `兴信${y}年${m}月份(华登制品国际香港发票)`,
  titleDl: (y, m) => `兴信${y}年${m}月份(华登制品国际大陆发票)`,
  header: ['日期', '客名', '发票NO:', '金额(USD)', '实收金额(HK$)', '备注', null,
           '日期', '发票NO:', '金额(USD)', '实收金额 (HK$)', '备注', null],
  kFormula: (r) => `${HK_RATE}*J${r}`,
  mCell: 'formula',    // M 列 ==G(国际 sheet 惯例)
  minSlots: 10,        // 数据区不足 10 行补到 10 行(SUM 范围含空行)
  cust: (row) => row.cust || '',
};

/** bases → 按月分块(块内按发票号数字升序,小的在上;同号 REVn 跟在基号后按 REV 数字升序,ZB 前缀忽略) */
function buildBlocks(bases) {
  const rows = [...bases.values()].map((b) => ({
    inv: b.inv,
    cust: b.customer,
    y: b.date.y, m: b.date.m, d: b.date.d,
    dateStr: `${b.date.m}/${b.date.d}`,
    D: round2(b.total),
    num: parseInt(b.inv.match(/\d+/)[0], 10),
    rev: (b.inv.match(/REV\s*(\d+)/i) || [])[1] ? +b.inv.match(/REV\s*(\d+)/i)[1] : 0,
  }));
  const blockMap = new Map();
  for (const r of rows) {
    const key = `${r.y}-${String(r.m).padStart(2, '0')}`;
    if (!blockMap.has(key)) blockMap.set(key, []);
    blockMap.get(key).push(r);
  }
  return [...blockMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => {
      list.sort((a, b) => (a.num - b.num) || (a.rev - b.rev));
      const [y, m] = key.split('-').map(Number);
      return { year: y, month: m, rows: list };
    });
}

/** 按样式生成一个面单 sheet 的 XML + 合计数据 + 自检 */
function buildSheet({ tplParts, blocks, style }) {
  const xml = tplParts.sheetXml;
  const sdStart = xml.indexOf('<sheetData');
  const sdTagEnd = xml.indexOf('>', sdStart) + 1;
  const sdEnd = xml.indexOf('</sheetData>');
  const tplPrefix = xml.slice(0, sdTagEnd);
  let tplSuffix = xml.slice(sdEnd);
  const tplRows = new Map();
  for (const row of parseRows(xml.slice(sdTagEnd, sdEnd))) tplRows.set(row.r, row);
  const stOf = (rowR, col) => {
    const row = tplRows.get(rowR);
    const cell = row && row.cells.get(col);
    return cell ? styleOf(cell) : 0;
  };
  const attrsOf = (rowR) => (tplRows.get(rowR) || { attrs: '' }).attrs;
  // 模板行:1 标题 / 2 表头 / 3 数据 / 4 合计
  const S = {
    title: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, stOf(1, i + 1)])),
    header: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, stOf(2, i + 1)])),
    data: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, stOf(3, i + 1)])),
    total: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, stOf(4, i + 1)])),
  };
  const ATTRS = { title: attrsOf(1), header: attrsOf(2), data: attrsOf(3), total: attrsOf(4) };

  const cFormulaStr = (col, r, s, f, cached) =>
    `<c r="${col}${r}" s="${s}" t="str"><f aca="false">${esc(f)}</f><v>${esc(cached)}</v></c>`;

  const outRows = [];
  const mergeRefs = [];
  const outBlocks = [];
  let r = 1;
  for (const blk of blocks) {
    const titleR = r;
    mergeRefs.push(`<mergeCell ref="A${titleR}:G${titleR}"/>`, `<mergeCell ref="H${titleR}:M${titleR}"/>`);
    outRows.push(`<row r="${r}"${ATTRS.title}>${
      Array.from({ length: 13 }, (_, i) => {
        const col = String.fromCharCode(65 + i), s = S.title[i + 1];
        if (i === 0) return cStr(col, r, s, style.titleHk(blk.year, blk.month));
        if (i === 7) return cStr(col, r, s, style.titleDl(blk.year, blk.month));
        return cEmpty(col, r, s);
      }).join('')}</row>`);
    r++;
    outRows.push(`<row r="${r}"${ATTRS.header}>${
      style.header.map((t, i) => {
        const col = String.fromCharCode(65 + i), s = S.header[i + 1];
        return t === null ? cEmpty(col, r, s) : cStr(col, r, s, t);
      }).join('')}</row>`);
    r++;
    const firstData = r;
    const slots = Math.max(blk.rows.length + 1, style.minSlots); // 数据+空行的总槽位
    let serial = 0;
    let sumD = 0, sumE = 0;
    for (const row of blk.rows) {
      serial++;
      const E = row.D * HK_RATE;
      sumD += row.D; sumE += E;
      const s = S.data;
      outRows.push(`<row r="${r}"${ATTRS.data}>` +
        cStr('A', r, s[1], row.dateStr) +
        cStr('B', r, s[2], style.cust(row)) +
        cStr('C', r, s[3], row.inv) +
        cNum('D', r, s[4], row.D) +
        cFormula('E', r, s[5], `D${r}*${HK_RATE}`, E) +
        cEmpty('F', r, s[6]) +
        cNum('G', r, s[7], serial) +
        cFormulaStr('H', r, s[8], `A${r}`, row.dateStr) +
        cFormulaStr('I', r, s[9], `C${r}`, row.inv) +
        cFormula('J', r, s[10], `D${r}*${RATE}`, row.D * RATE) +
        cFormula('K', r, s[11], style.kFormula(r), E * RATE) +
        cEmpty('L', r, s[12]) +
        (style.mCell === 'formula'
          ? cFormula('M', r, s[13], `G${r}`, serial)
          : cNum('M', r, s[13], serial)) +
        `</row>`);
      r++;
    }
    // 补齐空槽位(国际 sheet 数据区不足 10 行时带样式补空行;亚洲只留 1 个未写出的空行)
    while (r < firstData + slots) {
      if (style.minSlots > 1) {
        outRows.push(`<row r="${r}"${ATTRS.data}>${
          Array.from({ length: 13 }, (_, i) => cEmpty(String.fromCharCode(65 + i), r, S.data[i + 1])).join('')}</row>`);
      }
      r++;
    }
    const lastData = firstData + slots - 1; // SUM 范围末行(含空槽位)
    const t = S.total;
    outRows.push(`<row r="${r}"${ATTRS.total}>` +
      cEmpty('A', r, t[1]) + cEmpty('B', r, t[2]) +
      cStr('C', r, t[3], '本页合计：') +
      cFormula('D', r, t[4], `SUM(D${firstData}:D${lastData})`, sumD) +
      cFormula('E', r, t[5], `SUM(E${firstData}:E${lastData})`, sumE) +
      cEmpty('F', r, t[6]) + cEmpty('G', r, t[7]) + cEmpty('H', r, t[8]) +
      cStr('I', r, t[9], '本页合计：') +
      cFormula('J', r, t[10], `SUM(J${firstData}:J${lastData})`, sumD * RATE) +
      cFormula('K', r, t[11], `SUM(K${firstData}:K${lastData})`, sumE * RATE) +
      cEmpty('L', r, t[12]) + cEmpty('M', r, t[13]) +
      `</row>`);
    outBlocks.push({
      year: blk.year, month: blk.month, rows: blk.rows.length,
      sumD: round2(sumD), sumJ: round2(sumD * RATE), sumE: round2(sumE), sumK: round2(sumE * RATE),
      firstData, lastData: r,
    });
    r += 3; // 合计后空 2 行到下一标题
  }
  const lastRow = r - 1;

  const prefix = tplPrefix.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:M${lastRow}"/>`);
  const mergeXml = `<mergeCells count="${mergeRefs.length}">${mergeRefs.join('')}</mergeCells>`;
  let suffix = tplSuffix.includes('<mergeCells')
    ? tplSuffix.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeXml)
    : tplSuffix.replace('<printOptions', mergeXml + '<printOptions');
  const sheetXml = prefix + outRows.join('') + suffix;
  return { sheetXml, outBlocks };
}

/** 回读生成的 sheetXML,逐格验证公式/金额/序号/排序/合计 */
function selfCheckSheet(sheetXml, blocks, style) {
  const fails = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  const dataRowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellOf = (body, col) => {
    const m = body.match(new RegExp(`<c r="${col}\\d+"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
    return m ? (m[1] || '') : null;
  };
  const valOf = (body) => { const m = body && body.match(/<v>([^<]*)<\/v>/); return m ? m[1] : null; };
  const fOf = (body) => { const m = body && body.match(/<f[^>]*>([^<]*)<\/f>/); return m ? m[1] : null; };
  const textOf = (body) => { const m = body && body.match(/<t[^>]*>([^<]*)<\/t>/); return m ? m[1] : null; };
  const seen = new Set();
  let rm2;
  const blockRows = new Map(blocks.map((b) => [`${b.year}-${b.month}`, b]));
  let prevBlock, prevNum = null, prevRev = 0, curBlock = null;
  const perBlockSum = new Map();
  while ((rm2 = dataRowRe.exec(sheetXml))) {
    const rn = +rm2[1], body = rm2[2];
    const cC = cellOf(body, 'C'), cA = cellOf(body, 'A'), cD = cellOf(body, 'D');
    const cText = cC && (textOf(cC) ?? valOf(cC));
    if (!cText || cText === '发票NO:') continue;
    if (cText === '本页合计：') {
      const dSum = parseFloat(valOf(cellOf(body, 'D')));
      const exp = perBlockSum.get(curBlock) || 0;
      ok(Math.abs(dSum - exp) < 0.011, `r${rn} 合计 ${dSum} ≠ 明细和 ${exp}`);
      continue;
    }
    const inv = textOf(cC), dRaw = valOf(cD);
    if (dRaw === null || inv === null) continue; // 补空行
    const dVal = parseFloat(dRaw);
    const dm = (textOf(cA) || '').match(/^(\d+)\/(\d+)$/);
    curBlock = null;
    if (dm) {
      for (const [k, b] of blockRows) {
        const [y, m] = k.split('-').map(Number);
        if (m === +dm[1]) { curBlock = k; break; }
      }
    }
    perBlockSum.set(curBlock, (perBlockSum.get(curBlock) || 0) + dVal);
    ok(fOf(cellOf(body, 'E')) === `D${rn}*${HK_RATE}`, `r${rn} E 公式错`);
    ok(Math.abs(parseFloat(valOf(cellOf(body, 'E'))) - dVal * HK_RATE) < 0.001, `r${rn} E 缓存值错`);
    ok(fOf(cellOf(body, 'J')) === `D${rn}*${RATE}`, `r${rn} J 公式错`);
    ok(fOf(cellOf(body, 'K')) === style.kFormula(rn), `r${rn} K 公式错`);
    ok(fOf(cellOf(body, 'H')) === `A${rn}` && fOf(cellOf(body, 'I')) === `C${rn}`, `r${rn} H/I 公式错`);
    if (style.mCell === 'formula') ok(fOf(cellOf(body, 'M')) === `G${rn}`, `r${rn} M 公式错`);
    else ok(valOf(cellOf(body, 'G')) === valOf(cellOf(body, 'M')), `r${rn} G/M 序号不一致`);
    ok(!seen.has(inv), `发票号重复:${inv}`);
    seen.add(inv);
    const invNum = parseInt(inv.match(/\d+/)[0], 10);
    const invRevM = inv.match(/REV\s*(\d+)/i);
    const invRev = invRevM ? +invRevM[1] : 0;
    if (curBlock !== prevBlock) { prevNum = null; prevRev = 0; prevBlock = curBlock; }
    ok(prevNum === null || invNum > prevNum || (invNum === prevNum && invRev > prevRev),
      `r${rn} 排序错:${inv}`);
    prevNum = invNum; prevRev = invRev;
  }
  return { checks, passed: checks - fails.length, fails };
}

/**
 * 生成面单工作簿(美国簿 → 华登亚洲1-12月,国际簿 → 华登(国际)1-12月,可双 sheet)。
 * @param tplBuffer 格式模板(public/miandan-tpl.xlsx)
 * @param parsedList parseAnySourceBook/parseSourceBook 结果数组(无 kind 视为美国簿)
 * @param dateRange 可选,normRange 结果;启用时只保留日期落在范围内的发票
 * 返回 { buffer, sheets:[{ name, kind, blocks, selfCheck }], warnings, filter }
 *   blocks:[{year, month, rows, sumD, sumE, sumJ, sumK}]
 *   filter:{ active, kept, dropped }(未启用时 active:false)
 */
export async function generateMiandan({ tplBuffer, parsedList, dateRange }) {
  const usList = [], intlList = [];
  for (const p of parsedList) (p && p.kind === 'intl' ? intlList : usList).push(p);
  const us = mergeSources(usList);
  const intl = mergeSources(intlList);
  const warnings = [...us.warnings, ...intl.warnings];
  if (!us.bases.size && !intl.bases.size) throw new Error('源簿里没有识别到任何发票 sheet');

  let filter = { active: false, kept: us.bases.size + intl.bases.size, dropped: 0 };
  if (dateRange && dateRange.active) {
    const before = us.bases.size + intl.bases.size;
    const keep = (bases) => {
      const out = new Map();
      for (const [base, v] of bases) if (inRangeYmd(ymdOfParts(v.date), dateRange)) out.set(base, v);
      return out;
    };
    us.bases = keep(us.bases);
    intl.bases = keep(intl.bases);
    const kept = us.bases.size + intl.bases.size;
    filter = { active: true, kept, dropped: before - kept };
    if (!kept) throw new Error('筛选日期范围内没有发票');
  }

  const pkg = await XlsxPackage.load(tplBuffer);
  const plans = [];
  if (us.bases.size) plans.push({ style: STYLE_ASIA, kind: 'us', bases: us.bases });
  if (intl.bases.size) plans.push({ style: STYLE_INTL, kind: 'intl', bases: intl.bases });
  const partsByName = new Map();
  for (const plan of plans) partsByName.set(plan.style.tplSheet, await pkg.getTemplateParts(plan.style.tplSheet));
  await pkg.stripAllSheets();

  const sheets = [];
  for (const plan of plans) {
    const blocks = buildBlocks(plan.bases);
    const parts = partsByName.get(plan.style.tplSheet);
    const { sheetXml, outBlocks } = buildSheet({ tplParts: parts, blocks, style: plan.style });
    const selfCheck = selfCheckSheet(sheetXml, blocks, plan.style);
    pkg.addSheet({
      name: plan.style.outSheet, sheetXml,
      relsXml: parts.relsXml || undefined, // 模版 sheet 的 drawing 关系(空 drawing);无则不加
      definedNames: false,
      printFit: false, // 面单模板用固定 scale=74% 打印，不做一页缩放规范化
    });
    sheets.push({ name: plan.style.outSheet, kind: plan.kind, blocks: outBlocks, selfCheck });
  }
  const buffer = await pkg.save({ fullCalcOnLoad: true });

  return { buffer, sheets, warnings, filter };
}
