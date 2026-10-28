/**
 * 其他客发票：从「多客人汇总出货明细表」按 sheet（客人）识别发票分组，
 * 以各模板本里的历史发票 sheet 为模版批量生成发票。
 * 规则移植自其他客 Python 工具（gen_xingxin_hk_invoices.py），并按 2026-09 文员提供的
 * 「兴信香港(1)(2).xls」新模板补充 Tigerhead / John Adams定金 的真实模版。
 *
 * 与 ZURU 流程的差异：
 * - 输入是多客人汇总明细表（一个 sheet = 一个客人的一类单据），按发票号列分组，一号一票
 * - 发票号分组按数值从小到大排序输出（REV/-2 续票跟在基号旁边）
 * - 模版数据区固定（24 行起，到 data_end），超容量拆 -2/-3 续票，不做行移位
 * - 输出按（明细表 sheet × 模板本）分文件，每个文件只含生成的 sheet
 * - 印尼票（sheet 名含「印尼」）按口径不打，不生成
 * - 未配置模板的 sheet 按表头自动识别列位，通用套用兴信香港普通型模板（带人工核对提示）；
 *   表头缺必要列或币种为 RMB 的 sheet 不适用，仍列为不支持
 *
 * 纯 ESM，浏览器 / Node 通用。
 */

import * as XLSX from 'xlsx';
import { parseRows, rowXml, styleOf, colToIdx, idxToCol, cellXml, dateToSerial } from './sheetBuilder.js';
import { XlsxPackage } from './xlsxPackage.js';
import { ymdOf, inRangeYmd } from './dateRange.js';

const { cNum, cStr, cEmpty, cFormula } = cellXml;

const RATE = 0.967;
const DATA_START = 24;
const LAST_COL = 12; // 清值/写入范围 A..L

/** 模板本（public/other-tpl/ 下的内置资产） */
export const BOOKS = {
  hk:  { file: '/other-tpl/兴信香港.xlsx',     short: '兴信香港' },
  yd:  { file: '/other-tpl/兴信远东.xlsx',     short: '兴信远东' },
  hk2: { file: '/other-tpl/兴信香港新模板.xlsx', short: '兴信香港新模板' },
};

const DEFAULT_COLMAP = { date: 1, po: 2, desc: 3, code: 4, qty: 5, price: 6, amount: 7 };

/**
 * 各明细表 sheet 的生成配置（sheet 名精确匹配，含尾部空格）。
 * book/tpl: 模板本与模板 sheet；inv_col/note_col: 发票号列/备注列（1-based）
 * kind: normal=普通型(折单价) / th_normal=Tigerhead香港型(货物全价、费用×0.967)
 *       deposit=TOMY模费50%型 / ja_auto=John Adams按备注分型 / ja_fee=JA费用票
 *       mk_full=Masterkidz全价型 / th_fee=Tigerhead模费票(按备注分100%/50%)
 *       yd_fee=远东费用票(Tokidos，按备注分100%/50%)
 * strip_hk/strip_prefix: 发票号去前缀（历史做法 HK82845→82845、FE62805→62805）
 */
export const PROFILES = {
  'Zanzoon出货':   { book: 'hk', tpl: 'Zanzoon',   inv_col: 9,  note_col: null, kind: 'normal', data_end: 45, label: 'Zanzoon' },
  'Tomy出货':      { book: 'hk', tpl: 'TOMY (4)',  inv_col: 9,  note_col: null, kind: 'normal', data_end: 45, label: 'TOMY' },
  'Tomy其他费用':  { book: 'hk', tpl: 'TOMY (9)',  inv_col: 10, note_col: 12,   kind: 'deposit', data_end: 40, label: 'TOMY模费' },
  'John Adams出货 ':    { book: null, tpl: null, inv_col: 11, note_col: 12, kind: 'ja_auto', data_end: null, label: 'JohnAdams' },
  'John Adams其他费用': { book: 'hk', tpl: 'John Adams (2)', inv_col: 10, note_col: 11, kind: 'ja_fee', data_end: 45, label: 'JohnAdams费用', strip_hk: true },
  // Masterkidz：文员 2026-09 提供的标准格式为折单价型（G==K*0.967、I==G*D），与 normal 一致
  'Masterkidz出货': { book: 'hk', tpl: 'Masterkidz', inv_col: 9, note_col: 11, kind: 'normal', data_end: 45, label: 'Masterkidz' },
  // AZAD：文员 2026-09 提供的专属模板（兴信香港 'AZAD' sheet，69290 样张，折单价型）
  'AZAD出货':     { book: 'hk', tpl: 'AZAD', inv_col: 11, note_col: 13, kind: 'normal', data_end: 45, label: 'AZAD' },
  'AZAD其他费用': { book: 'hk', tpl: 'AZAD', inv_col: 10, note_col: 12, kind: 'normal', data_end: 45, label: 'AZAD费用' },
  'Tigerhead出货': { book: 'hk2', tpl: 'Tigerhead出货', inv_col: 11, note_col: 13, kind: 'th_normal', data_end: 45, label: 'Tigerhead' },
  'Tigerhead其他费用': { book: null, tpl: null, inv_col: 10, note_col: 12, kind: 'th_fee', data_end: null, label: 'Tigerhead费用' },
  'CEPIA出货':     { book: 'yd', tpl: 'Cepia',     inv_col: 11, note_col: 13, kind: 'normal', data_end: 45, label: 'CEPIA' },
  'Moose出货':     { book: 'yd', tpl: 'Moose',     inv_col: 10, note_col: 13, kind: 'normal', data_end: 45, label: 'Moose',
                     colmap: { date: 1, po: 2, desc: 3, code: 4, qty: 6, price: 7, amount: 8 } }, // 发票货号=Item Code(D列)
  '龙昌出货':      { book: 'yd', tpl: 'Lung Cheong', inv_col: 9, note_col: 11, kind: 'normal', data_end: 45, label: '龙昌', strip_prefix: 'FE',
                     disabled: '排期目录未标框（口径：不生成）' },
  'Tokidos出货':   { book: 'yd', tpl: 'Tokidos (2)', inv_col: 11, note_col: 13, kind: 'normal', data_end: 45, label: 'Tokidos', strip_prefix: 'FE' },
  'Tokidos其他费用 ': { book: null, tpl: null, inv_col: 10, note_col: 12, kind: 'yd_fee', data_end: 41, label: 'Tokidos费用' },
  'Exceenis':      { book: 'yd', tpl: 'Exceenis',  inv_col: 10, note_col: 12, kind: 'normal', data_end: 45, label: 'Exceenis', strip_prefix: 'FE' },
};

/**
 * 客人所属公司分类（2026-09 文员提供的各客排期目录标注）：
 * 香港=AZAD/Charade/John Adams/Lifelines/Masterkidz/Tomy/ZANZOON；
 * 远东=Cepia/Character World/Exceenis/MOOSE/Tigerhead/Tokidos（JAZ/PWP/Sky Castle/智海鑫 也属远东，Toy Monster 属香港）；
 * 国际=Brybelly/Entertoyme/凯福适。费用等子单跟随主客人归类；印尼子单不打（不生成）。
 */
export const CATEGORY_NAMES = { hk: '香港', yd: '远东', intl: '国际', other: '未分类' };
const CAT_BY_LABEL = {
  Zanzoon: 'hk', Zanzoon费用: 'hk', TOMY: 'hk', TOMY模费: 'hk',
  JohnAdams: 'hk', JohnAdams费用: 'hk',
  Masterkidz: 'hk', Masterkidz费用: 'hk',
  AZAD: 'hk', AZAD费用: 'hk',
  Lifelines: 'hk', Lifelines费用: 'hk',
  'Charade-Tikino': 'hk', 'Charade-Tikino费用': 'hk',
  CEPIA: 'yd', CEPIA费用: 'yd', Moose: 'yd', Moose费用: 'yd', Exceenis: 'yd',
  Tigerhead: 'yd', Tigerhead费用: 'yd',
  Tokidos: 'yd', Tokidos费用: 'yd',
  'Character World LTD': 'yd', 智海鑫: 'yd',
  Brybelly: 'intl', Brybelly费用: 'intl', Entertoymen: 'intl', Entertoymen费用: 'intl',
  'Care Focus': 'intl', 'Care Focus费用': 'intl',
  // 龙昌在目录里未标框 → PROFILES 里 disabled，不生成（此处仅兜底）
  龙昌: 'other',
};
/** 输出文件 → 所属分类（按客人 label） */
export const categoryOfLabel = (label) => CAT_BY_LABEL[label] || 'other';

/* ---------------- 通用格式套用（未配置模板的 sheet） ---------------- */

/**
 * 明细表所有 sheet 同一格式（文员口径），未配置的 sheet 按表头自动识别列位，
 * 套用兴信香港普通型（折单价）模板生成。无历史发票对照 → 带 guess 提示人工核对。
 * 表头缺「发票号/数量/单价/金额」列，或单价/金额为 RMB（非 USD 模板）时不适用。
 */
const GENERIC_BOOK = 'hk', GENERIC_TPL = 'Zanzoon';

/** sheet 名 → 客人 label：去「出货」后缀；「其他费用」→ 客人+费用（沿用既有命名惯例） */
export function genericLabel(sheetName) {
  const n = sheetName.trim();
  if (n.endsWith('出货')) return n.slice(0, -2).trim();
  if (n.endsWith('其他费用')) return n.slice(0, -4).trim() + '费用';
  return n;
}

/**
 * 通用配置解析：返回 { prof } 或 { reason }（不适用的原因，供界面展示）。
 * prof 与 PROFILES 项同构，另带 generic: true。
 */
export function genericProfile(sheetName, rows) {
  const head = (rows[0] || []).map((v) => (v === null || v === undefined ? '' : String(v).trim()));
  const findCol = (re) => {
    const i = head.findIndex((h) => h && re.test(h));
    return i < 0 ? null : i + 1; // 1-based
  };
  const inv_col = findCol(/^发票号$/);
  if (!inv_col) return { reason: '表头缺「发票号」列（非出货明细格式）' };
  const priceH = head.find((h) => h.includes('单价')) || '';
  const amountH = head.find((h) => h.includes('金额')) || '';
  if (priceH.includes('RMB') || amountH.includes('RMB')) return { reason: '单价/金额为 RMB，非 USD 模板' };
  const qty = findCol(/数量/), price = findCol(/单价/), amount = findCol(/金额/);
  if (!qty || !price || !amount) return { reason: '表头缺「数量/单价/金额」列' };
  const prof = {
    book: GENERIC_BOOK, tpl: GENERIC_TPL,
    inv_col, note_col: findCol(/备注/),
    kind: 'normal', data_end: 45, label: genericLabel(sheetName),
    colmap: {
      date: findCol(/日期/) || 1,      // 「发票日期」在「更改日期」之前，首个命中即 A 列
      po: findCol(/PO/i) || 2,
      desc: findCol(/DESCRIPTION|描述/i) || 3,
      code: findCol(/货号/) || 4,
      qty, price, amount,
    },
    generic: true,
    guess: '通用格式套用（无历史发票对照），请人工核对金额与版式',
  };
  return { prof };
}

/** sheet 的生成配置：精确配置优先，否则通用格式套用；印尼票/空 sheet 由调用方先行排除 */
export function resolveProfile(sheetName, rows) {
  if (PROFILES[sheetName]) return { prof: PROFILES[sheetName] };
  return genericProfile(sheetName, rows);
}

// ja_auto 按备注分型 → (模板本, 模板, 明细区末行)
// balance70/ja_full 有历史对照(82842-82844)；balance30 用文员 2026-09 提供的真实定金模板
const JA_KINDS = {
  balance70: { book: 'hk',  tpl: 'John Adams (5)',    data_end: 40 },
  balance30: { book: 'hk2', tpl: 'John Adams出货 定金', data_end: 41 },
  ja_full:   { book: 'hk',  tpl: 'Masterkidz',        data_end: 45 },
};

// th_fee 按备注分型 → (子类型, 模板, 明细区末行, 合计百分比, I43标签覆盖)
// 两个模板均为文员 2026-09 提供的真实模版（62456 模费100% / 62470 模具尾期50%）
const TH_FEE_KINDS = {
  fee100: { book: 'hk2', tpl: 'Tigerhead模费100%', data_end: 45, pct: 1.0, label: null },
  fee50:  { book: 'hk2', tpl: 'Tigerhead模费50%',  data_end: 41, pct: 0.5, label: null },
};

// yd_fee 按备注分型 → (子类型, 模板, H43标签[null=模板自带], 百分比)
const YD_FEE_KINDS = {
  deposit100: { book: 'yd', tpl: 'Tigerhead (2)', label: null, pct: 1.0 },
  balance50:  { book: 'yd', tpl: 'Tokidos',       label: null, pct: 0.5 },
  deposit50:  { book: 'yd', tpl: 'Tokidos',       label: 'Deposit  50%', pct: 0.5 },
};

const KIND_NAMES = {
  normal: '普通型', th_normal: '香港全价型', deposit: 'Deposit50%型',
  balance70: '尾期70%型', balance30: '定金30%型', ja_full: '全价型',
  ja_fee: '费用票', mk_full: '全价型',
  fee100: '模费100%票', fee50: '模费50%票',
  deposit100: 'Deposit100%票', balance50: '尾期50%票', deposit50: 'Deposit50%票',
};

/* ---------------- 自定义模板本 ---------------- */

/** 每个模板本生成所需的模版 sheet 名（由 PROFILES/分型表推导，防漂移） */
export function bookTemplateNeeds() {
  const needs = { hk: new Set(), yd: new Set(), hk2: new Set() };
  for (const p of Object.values(PROFILES)) if (p.book && p.tpl) needs[p.book].add(p.tpl);
  for (const k of Object.values(JA_KINDS)) needs[k.book].add(k.tpl);
  for (const k of Object.values(TH_FEE_KINDS)) needs[k.book].add(k.tpl);
  for (const k of Object.values(YD_FEE_KINDS)) needs[k.book].add(k.tpl);
  return Object.fromEntries(Object.entries(needs).map(([k, s]) => [k, [...s]]));
}

/**
 * 检查用户上传的模板本（.xlsx ArrayBuffer）：列出 sheet 名并对每个内置本算匹配度。
 * 多余 sheet 不影响生成（生成时 stripAllSheets 只留模版），只要求所需模版 sheet 齐全。
 */
export async function inspectTemplateBook(arrayBuffer) {
  const pkg = await XlsxPackage.load(arrayBuffer);
  const names = pkg.getSheetNames();
  const needs = bookTemplateNeeds();
  const matches = {};
  for (const [key, need] of Object.entries(needs)) {
    const missing = need.filter((t) => !names.includes(t));
    matches[key] = { need: need.length, hit: need.length - missing.length, missing };
  }
  return { sheetNames: names, matches };
}

/* ---------------- 解析 ---------------- */

/** 解析明细表（ArrayBuffer）为 { sheetName: rows[][] }，全行读取（最大客人 sheet 600+ 行）。
 *  每个 rows 数组附带 rows.merges（SheetJS !merges，0-based），供 readGroups 做合并值填充 */
export function parseDetailWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const result = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    rows.merges = wb.Sheets[name]['!merges'] || [];
    result[name] = rows;
  }
  return result;
}

const toNum = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return v;
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }
  return v;
};
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 读一个明细表 sheet，按发票号分组。
 * 返回 { order, groups, skippedNoInv, skippedNoAmt, anomalies }；
 * 三类跳过/异常条目都带 date（该行 A 列发票日期，可为 null），供前端按月份归属过滤提示。
 */
export function readGroups(rows, prof) {
  const inv_c = prof.inv_col, note_c = prof.note_col;
  const cm = prof.colmap || DEFAULT_COLMAP;
  const yd_fee = prof.kind === 'yd_fee';
  const th_fee = prof.kind === 'th_fee';
  const groups = new Map();
  const order = [];
  const skippedNoInv = [], skippedNoAmt = [], anomalies = [];

  // 合并单元格填充：合并块只有首行有值，续行读到的是空。
  // 只认纵向（同列跨行）且首行含值的合并，只填发票号列和备注列；
  // 金额/数量列的合并值是整块共享总额，填到续行会双重计数，故不填。
  for (const m of rows.merges || []) {
    if (m.s.c !== m.e.c || m.e.r <= m.s.r) continue;
    const col = m.s.c + 1;
    if (col !== inv_c && col !== note_c) continue;
    const anchorRow = rows[m.s.r];
    const anchor = anchorRow ? anchorRow[m.s.c] : null;
    if (anchor === null || anchor === undefined || String(anchor).trim() === '') continue;
    for (let r = m.s.r + 1; r <= m.e.r; r++) {
      const row = rows[r];
      if (!row) continue;
      const v = row[m.s.c];
      if (v === null || v === undefined || String(v).trim() === '') row[m.s.c] = anchor;
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowNo = i + 1;
    if (row.every((v) => v === null || v === undefined || String(v).trim() === '')) continue;
    const A = row[cm.date - 1], B = row[cm.po - 1], C = row[cm.desc - 1];
    const D = row[cm.code - 1], E = numOrNull(row[cm.qty - 1]);
    const F = numOrNull(toNum(row[cm.price - 1]));
    const G = numOrNull(toNum(row[cm.amount - 1]));
    const invRaw = row[inv_c - 1];
    let inv = invRaw !== null && invRaw !== undefined ? String(invRaw).trim() : '';
    if (!inv) { skippedNoInv.push({ row: rowNo, date: A instanceof Date ? A : null }); continue; }
    if (prof.strip_hk && inv.toUpperCase().startsWith('HK')) inv = inv.slice(2);
    if (prof.strip_prefix && inv.startsWith(prof.strip_prefix)) inv = inv.slice(prof.strip_prefix.length);
    if (!groups.has(inv)) { groups.set(inv, []); order.push(inv); }
    const note = note_c && row[note_c - 1] ? String(row[note_c - 1]).trim() : '';
    const desc = C !== null && C !== undefined ? String(C).trim() : '';

    if (E === null && F === null && G === null) {
      skippedNoAmt.push({ row: rowNo, inv, desc: desc.slice(0, 40) || '<合计/统计行>', date: A instanceof Date ? A : null });
      continue;
    }
    if (E === null) {
      if (G === null) { skippedNoAmt.push({ row: rowNo, inv, desc: desc.slice(0, 40), date: A instanceof Date ? A : null }); continue; }
      groups.get(inv).push({ kind: 'fee', row: rowNo, desc, amount: G, note });
      continue;
    }
    if (F === null) {
      // 费用/模费票：有数量+金额但无单价 → 单价=金额/数量（推测）
      if ((yd_fee || th_fee) && G !== null) {
        groups.get(inv).push({ kind: 'item', row: rowNo, date: A instanceof Date ? A : null,
          po: B ? String(B).trim() : '', code: D, qty: E, unit: toNum(G / E), note, desc, guessedPrice: true });
        anomalies.push({ row: rowNo, inv, issue: '缺单价→按金额/数量推算(推测)', desc: desc.slice(0, 40), date: A instanceof Date ? A : null });
        continue;
      }
      anomalies.push({ row: rowNo, inv, issue: '缺单价', desc: desc.slice(0, 40), date: A instanceof Date ? A : null });
      continue;
    }
    if (D === null || String(D).trim() === '') {
      // 缺货号且数量=1 → 费用行（Tigerhead 惯例：费用按 数量1×单价 录入，发票上不写数量）
      if ((prof.kind === 'normal' || prof.kind === 'th_normal') && E === 1) {
        groups.get(inv).push({ kind: 'fee', row: rowNo, desc, amount: toNum(G !== null ? G : E * F), note });
        continue;
      }
      if (!['ja_fee', 'yd_fee', 'th_fee', 'deposit'].includes(prof.kind)) {
        anomalies.push({ row: rowNo, inv, issue: `缺货号(数量${E} 单价${F})`, desc: desc.slice(0, 40), date: A instanceof Date ? A : null });
      }
    }
    groups.get(inv).push({ kind: 'item', row: rowNo, date: A instanceof Date ? A : null,
      po: B ? String(B).trim() : '', code: D, qty: E, unit: toNum(F), note, desc });
  }
  return { order, groups, skippedNoInv, skippedNoAmt, anomalies };
}

/* ---------------- 分型 ---------------- */

function classifyJa(lines) {
  const joined = lines.filter((l) => l.kind === 'item' && l.note).map((l) => l.note).join(' ');
  if (joined.includes('尾期70%')) return { kindEff: 'balance70', guess: false };
  if (joined.includes('定金30%')) return { kindEff: 'balance30', guess: false };
  if (joined.includes('100%')) return { kindEff: 'ja_full', guess: false };
  return { kindEff: 'balance70', guess: true };
}

function classifyThFee(lines) {
  const joined = lines.map((l) => l.note || '').join(' ');
  if (joined.includes('50%')) {
    // 首期→Deposit 标签覆盖；尾期→模板自带 Balance 50%
    const deposit = /首期|定金/.test(joined);
    return { kindEff: 'fee50', guess: false, labelOverride: deposit ? 'Deposit 50%' : null };
  }
  if (joined.includes('100%')) return { kindEff: 'fee100', guess: joined.includes('其他100%') };
  return { kindEff: 'fee100', guess: true };
}

function classifyYdFee(lines) {
  const joined = lines.map((l) => l.note || '').join(' ');
  if (joined.includes('尾期50%')) return { kindEff: 'balance50', guess: false };
  if (joined.includes('首期50%') || joined.includes('定金50%')) return { kindEff: 'deposit50', guess: true };
  if (joined.includes('100%')) return { kindEff: 'deposit100', guess: joined.includes('其他100%') };
  return { kindEff: 'deposit100', guess: true };
}

/* ---------------- 发票号排序（从小到大） ---------------- */

/** 排序键：取首个数字段作主键（去前缀后），余下按字符串自然序；REV/-2 续票跟在基号旁 */
export function invSortKey(inv) {
  const m = String(inv).match(/\d+/);
  return { n: m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER, s: String(inv) };
}

export function sortInvoices(order) {
  return order.slice().sort((a, b) => {
    const ka = invSortKey(a), kb = invSortKey(b);
    if (ka.n !== kb.n) return ka.n - kb.n;
    return ka.s < kb.s ? -1 : ka.s > kb.s ? 1 : 0;
  });
}

/* ---------------- 模版填充 ---------------- */

/**
 * 以一张模版 sheet 的原始部件填充一张发票。
 * 数据区 24..dataEnd 的 A..L 清值后按行写入（行样式取模版 24 行），M 列及以后原样保留；
 * 合计结构（dataEnd 之下）不动；H10=发票号、H15=日期；L24 写 =I46 镜像合计。
 */
export class TemplateFiller {
  constructor(parts) {
    const xml = parts.sheetXml;
    const sdStart = xml.indexOf('<sheetData');
    const sdTagEnd = xml.indexOf('>', sdStart) + 1;
    const sdEnd = xml.indexOf('</sheetData>');
    this.prefix = xml.slice(0, sdTagEnd);
    this.suffix = xml.slice(sdEnd);
    this.rows = new Map();
    for (const row of parseRows(xml.slice(sdTagEnd, sdEnd))) this.rows.set(row.r, row);
    this.commentsXml = parts.commentsXml;
    this.vmlXml = parts.vmlXml;
    this.relsXml = parts.relsXml;

    // 行样式样板：24 行（首行）各列样式；26 行兜底
    const r24 = this.rows.get(24);
    const r26 = this.rows.get(26);
    this.st = {};
    for (let c = 1; c <= 13; c++) {
      const cell = (r24 && r24.cells.get(c)) || (r26 && r26.cells.get(c)) || null;
      this.st[c] = cell ? styleOf(cell) : 0;
    }
    this.lineAttrs = r24 ? r24.attrs : (r26 ? r26.attrs : '');
  }

  /**
   * @param spec { invNo, date, lines:[{cells:Map<colIdx,xml>}], dataEnd, totalCached,
   *               labelOverride: {row, col, text}|null }
   */
  build({ invNo, date, lineCells, dataEnd, totalCached, labelOverride }) {
    const out = [];
    const maxTplRow = Math.max(...this.rows.keys());
    // Readers such as SheetJS use cached values without calculating formulas.
    // Refresh totals from this invoice; a blank public template caches zero and
    // an uploaded historical template may cache an unrelated invoice's amount.
    const cached = new Map([['I46', totalCached], ['L24', totalCached]]);
    const formulaOf = (cell) => (cell?.match(/<f\b[^>]*>([^<]*)<\/f>/) || [])[1];
    const templateCell = (ref) => {
      const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/) || [];
      return this.rows.get(Number(row))?.cells.get(colToIdx(col || 'A'));
    };
    // Back-propagate the final total through the known subtotal/percentage chain
    // (I46=I44, I44=I42*50%, etc.) without changing those Excel formulas.
    let totalRef = 'I46', totalValue = totalCached;
    const chain = new Set();
    while (!chain.has(totalRef)) {
      chain.add(totalRef);
      const formula = formulaOf(templateCell(totalRef))?.replace(/\$/g, '').trim();
      const m = formula?.match(/^(I\d+)(?:\s*\*\s*(\d+(?:\.\d+)?)(%)?)?$/i);
      if (!m || Number(m[1].slice(1)) <= dataEnd) break;
      const factor = m[2] ? Number(m[2]) / (m[3] ? 100 : 1) : 1;
      if (!factor) break;
      totalValue /= factor;
      totalRef = m[1].toUpperCase();
      cached.set(totalRef, totalValue);
    }
    // Data cells not written below are cleared, including any old formulas in a
    // custom template. They must contribute zero to totals, never historical data.
    for (let r = DATA_START; r <= dataEnd; r++) for (let col = 1; col <= LAST_COL; col++) cached.set(`${idxToCol(col)}${r}`, 0);
    cached.set('L24', totalCached);
    for (let i = 0; i < lineCells.length; i++) for (const [col, xml] of lineCells[i]) {
      const value = xml.match(/<v>([^<]*)<\/v>/);
      if (value && Number.isFinite(Number(value[1]))) cached.set(`${idxToCol(col)}${DATA_START + i}`, Number(value[1]));
    }
    const totalCache = (ref, visiting = new Set()) => {
      if (cached.has(ref)) return cached.get(ref);
      if (visiting.has(ref)) return null;
      const formula = formulaOf(templateCell(ref))?.replace(/\$/g, '').trim();
      if (!formula) return 0; // empty cells in a SUM range
      const seen = new Set(visiting).add(ref);
      let m = formula.match(/^SUM\(([A-Z]+)(\d+):\1(\d+)\)$/i), value = null;
      if (m) {
        value = 0;
        for (let r = Number(m[2]); r <= Number(m[3]); r++) {
          const item = totalCache(`${m[1].toUpperCase()}${r}`, seen);
          if (item === null) { value = null; break; }
          value += item;
        }
      } else if ((m = formula.match(/^([A-Z]+\d+)(?:\s*\*\s*(\d+(?:\.\d+)?)(%)?)?$/i))) {
        const base = totalCache(m[1].toUpperCase(), seen);
        if (base !== null) value = base * (m[2] ? Number(m[2]) / (m[3] ? 100 : 1) : 1);
      }
      if (value !== null) cached.set(ref, value);
      return value;
    };

    for (let r = 1; r <= maxTplRow; r++) {
      const row = this.rows.get(r);
      if (r < DATA_START) {
        if (!row) continue;
        const cells = new Map(row.cells);
        if (r === 10) {
          const old = cells.get(8);
          const s = old ? styleOf(old) : 0;
          cells.set(8, /^\d+$/.test(String(invNo)) ? cNum('H', 10, s, invNo) : cStr('H', 10, s, String(invNo)));
        }
        if (r === 15 && date) {
          const old = cells.get(8);
          const s = old ? styleOf(old) : 0;
          cells.set(8, cNum('H', 15, s, dateToSerial(date)));
        }
        out.push(rowXml(r, row.attrs, cells));
        continue;
      }
      if (r <= dataEnd) {
        const i = r - DATA_START;
        const cells = new Map();
        if (row) for (const [ci, x] of row.cells) if (ci > LAST_COL) cells.set(ci, x);  // M+ 原样
        if (i < lineCells.length) {
          for (const [ci, x] of lineCells[i]) cells.set(ci, x);
          // L 列：首行写 =I46 镜像合计，其余清空
          if (r === DATA_START) cells.set(12, cFormula('L', r, this.st[12], 'I46', totalCached));
          else if (!cells.has(12)) cells.set(12, cEmpty('L', r, this.st[12]));
          for (let c = 1; c <= LAST_COL; c++) if (!cells.has(c)) cells.set(c, cEmpty(idxToCol(c), r, this.st[c]));
          out.push(rowXml(r, row ? row.attrs : this.lineAttrs, cells));
        } else {
          // 未用的数据行：A..L 清空（保留样式），M+ 原样
          for (let c = 1; c <= LAST_COL; c++) {
            const old = row ? row.cells.get(c) : null;
            cells.set(c, cEmpty(idxToCol(c), r, old ? styleOf(old) : this.st[c]));
          }
          if (!row) continue;
          out.push(rowXml(r, row.attrs, cells));
        }
        continue;
      }
      // 合计区保留公式和样式，替换缓存值，避免读回模板里的零/历史金额。
      if (!row) continue;
      const cells = new Map(row.cells);
      if (r <= 46) for (const [ci, xml] of cells) {
        if (!formulaOf(xml)) continue;
        const value = totalCache(`${idxToCol(ci)}${r}`);
        const cleared = xml.replace(/<v>[^<]*<\/v>/g, '');
        cells.set(ci, value === null ? cleared : cleared.replace('</c>', `<v>${value}</v></c>`));
      }
      if (labelOverride && r === labelOverride.row) {
        const ci = colToIdx(labelOverride.col);
        const old = cells.get(ci);
        cells.set(ci, cStr(labelOverride.col, r, old ? styleOf(old) : 0, labelOverride.text));
      }
      out.push(rowXml(r, row.attrs, cells));
    }

    const prefix = this.prefix.replace(/tabSelected="true"/, 'tabSelected="false"');
    return prefix + out.join('') + this.suffix;
  }
}

/* ---------------- 行公式 ---------------- */

/**
 * 生成一行明细的单元格 Map（colIdx→xml）。
 * kindEff 决定公式形态；st 为模版 24 行各列样式。
 */
function lineToCells(ln, r, kindEff, st, ctx) {
  const cells = new Map();
  const set = (c, x) => cells.set(c, x);
  const codeCell = (code) => {
    if (code === null || code === undefined || String(code).trim() === '') return null;
    const v = toNum(code);
    return typeof v === 'number' ? cNum('C', r, st[3], v) : cStr('C', r, st[3], String(v).trim());
  };

  if (kindEff === 'fee100') {
    // Tigerhead 模费100%：B=描述, D=数量, E=PCS, F=USD, G==K, H=USD, I==D*G, J=1, K=单价（全价不折）
    set(2, cStr('B', r, st[2], ln.desc));
    if (ln.kind !== 'fee') {
      set(4, cNum('D', r, st[4], ln.qty));
      set(5, cStr('E', r, st[5], 'PCS'));
      set(6, cStr('F', r, st[6], 'USD'));
      set(7, cFormula('G', r, st[7], `K${r}`, ln.unit));
      set(9, cFormula('I', r, st[9], `D${r}*G${r}`, ln.qty * ln.unit));
    } else {
      set(9, cFormula('I', r, st[9], `K${r}`, ln.amount));
    }
    set(8, cStr('H', r, st[8], 'USD'));
    set(10, cNum('J', r, st[10], 1));
    set(11, cNum('K', r, st[11], ln.kind === 'fee' ? ln.amount : ln.unit));
    return cells;
  }
  if (kindEff === 'fee50') {
    // Tigerhead 模费50%：货物按数量×单价，费用按直接金额（合计区再×50%）。
    set(2, cStr('B', r, st[2], ln.desc));
    if (ln.kind !== 'fee') { set(4, cNum('D', r, st[4], ln.qty)); set(5, cStr('E', r, st[5], 'PCS')); }
    set(8, cStr('H', r, st[8], 'USD'));
    set(9, cFormula('I', r, st[9], ln.kind === 'fee' ? `K${r}` : `K${r}*D${r}`,
      ln.kind === 'fee' ? ln.amount : ln.unit * ln.qty));
    set(10, cNum('J', r, st[10], 1));
    set(11, cNum('K', r, st[11], ln.kind === 'fee' ? ln.amount : ln.unit));
    return cells;
  }
  if (kindEff === 'deposit100' || kindEff === 'balance50' || kindEff === 'deposit50') {
    // 远东费用票：模费行 A=描述, D=数量, E=PCS, H=USD, I==K*D, J=1, K=单价；
    // 无数量费用行 C=描述, H=USD, I==K, J=1, K=明细金额/百分比（恢复全价，合计区再乘百分比）
    if (ln.kind === 'fee') {
      set(3, cStr('C', r, st[3], ln.desc));
      set(8, cStr('H', r, st[8], 'USD'));
      set(9, cFormula('I', r, st[9], `K${r}`, ln.amount / ctx.pct));
      set(10, cNum('J', r, st[10], 1));
      set(11, cNum('K', r, st[11], ln.amount / ctx.pct));
    } else {
      set(1, cStr('A', r, st[1], ln.desc));
      set(4, cNum('D', r, st[4], ln.qty));
      set(5, cStr('E', r, st[5], 'PCS'));
      set(8, cStr('H', r, st[8], 'USD'));
      set(9, cFormula('I', r, st[9], `K${r}*D${r}`, ln.unit * ln.qty));
      set(10, cNum('J', r, st[10], 1));
      set(11, cNum('K', r, st[11], ln.unit));
    }
    return cells;
  }
  // 普通/折扣/全价货物型
  const discounted = kindEff === 'normal';
  const thNormal = kindEff === 'th_normal';
  const jaDep30 = kindEff === 'balance30'; // JA定金30% 真实样张口径: G==K*0.967, I==D*G（金额与全价×0.967等价）
  const full = ['balance70', 'balance30', 'ja_full', 'ja_fee', 'mk_full', 'deposit'].includes(kindEff);
  if (ln.kind === 'fee') {
    if (kindEff === 'deposit') return cells; // deposit 型费用行跳过（调用方已剔除并报告）
    set(3, cStr('C', r, st[3], ln.desc));
    set(8, cStr('H', r, st[8], 'USD'));
    if (discounted || thNormal) {
      set(9, cFormula('I', r, st[9], `K${r}*${RATE}`, ln.amount * RATE));
      if (discounted) set(10, cNum('J', r, st[10], 1));
    } else {
      set(9, cFormula('I', r, st[9], `K${r}`, ln.amount));
      set(10, cNum('J', r, st[10], 1));
    }
    set(11, cNum('K', r, st[11], ln.amount));
    return cells;
  }
  if (ctx.poToWrite) set(1, cStr('A', r, st[1], ctx.poToWrite));
  const cc = codeCell(ln.code);
  if (cc) set(3, cc);
  set(4, cNum('D', r, st[4], ln.qty));
  set(5, cStr('E', r, st[5], 'PCS'));
  set(6, cStr('F', r, st[6], 'USD'));
  if (discounted || jaDep30) set(7, cFormula('G', r, st[7], `K${r}*${RATE}`, ln.unit * RATE));
  else set(7, cFormula('G', r, st[7], `K${r}`, ln.unit));
  set(8, cStr('H', r, st[8], 'USD'));
  if (full && kindEff !== 'deposit' && kindEff !== 'th_normal' && !jaDep30)
    set(9, cFormula('I', r, st[9], `G${r}*D${r}*${RATE}`, ln.unit * ln.qty * RATE));
  else
    set(9, cFormula('I', r, st[9], `D${r}*G${r}`, ln.unit * ln.qty * ((discounted || jaDep30) ? RATE : 1)));
  set(10, cNum('J', r, st[10], 1));
  set(11, cNum('K', r, st[11], ln.unit));
  return cells;
}

/** 一行 I 列金额（用于计算合计缓存值/报告） */
function lineAmount(ln, kindEff, ctx) {
  if (ln.kind === 'fee') {
    if (kindEff === 'normal' || kindEff === 'th_normal') return ln.amount * RATE;
    if (['deposit100', 'balance50', 'deposit50'].includes(kindEff)) return ln.amount / ctx.pct;
    return ln.amount; // fee100/fee50/ja 系：I==K
  }
  switch (kindEff) {
    case 'normal': return ln.unit * RATE * ln.qty;
    case 'th_normal': case 'deposit': return ln.unit * ln.qty;
    case 'fee100': case 'fee50': return ln.unit * ln.qty;
    case 'deposit100': case 'balance50': case 'deposit50': return ln.unit * ln.qty;
    default: return ln.unit * ln.qty * RATE; // ja 系 / mk_full
  }
}

/** 整票（一个分片）的合计行值（I46 最终值，含百分比型合计区换算） */
function chunkTotal(lines, kindEff, ctx) {
  const sum = lines.reduce((s, ln) => s + lineAmount(ln, kindEff, ctx), 0);
  switch (kindEff) {
    case 'deposit': return sum * 0.5;
    case 'balance70': return sum * 0.7;
    case 'balance30': return sum * 0.3;
    case 'fee50': case 'balance50': case 'deposit50': return sum * 0.5;
    default: return sum;
  }
}

/* ---------------- 生成计划 ---------------- */

/**
 * 按日期范围过滤一个 sheet 的生成计划（range 来自 dateRange.normRange）。
 * 发票日期取明细行的发票日期；启用筛选时日期缺失的发票排除并计数。
 * 返回 { plan, kept, dropped, noDate }；range 未启用时原样返回（kept=全部）。
 */
export function filterPlanByDate(plan, range) {
  if (!range || !range.active) {
    return { plan, kept: plan.invoices.length, dropped: 0, noDate: 0 };
  }
  const inR = (d) => inRangeYmd(ymdOf(d), range);
  const invoices = plan.invoices.filter((v) => inR(v.date));
  const keepInv = new Set(invoices.map((v) => v.inv));
  const chunks = plan.chunks.filter((c) => inR(c.date));
  const splits = plan.splits.filter((s) => keepInv.has(s.inv));
  const noDate = plan.invoices.filter((v) => !ymdOf(v.date)).length;
  return {
    plan: { ...plan, invoices, chunks, splits },
    kept: invoices.length,
    dropped: plan.invoices.length - invoices.length,
    noDate,
  };
}

/**
 * 为一个明细表 sheet 制定生成计划。
 * 返回 { sheetName, label, prof, invoices:[{inv, kindEff, kindName, date, lineCount, total, flags}],
 *        chunks:[{outName, book, tpl, dataEnd, kindEff, ctx, lines, date, labelOverride, flags}],
 *        skippedNoInv, skippedNoAmt, anomalies, skippedFee, splits }
 */
export function planSheet(sheetName, rows) {
  const { prof } = resolveProfile(sheetName, rows);
  if (!prof) return null;
  const { order, groups, skippedNoInv, skippedNoAmt, anomalies } = readGroups(rows, prof);
  const sorted = sortInvoices(order);
  const invoices = [], chunks = [], skippedFee = [], splits = [];

  for (const inv of sorted) {
    let lines = groups.get(inv);
    let kindEff, book, tpl, dataEnd, ctx = {}, labelOverride = null;
    const flags = [];

    if (prof.kind === 'ja_auto') {
      const c = classifyJa(lines);
      kindEff = c.kindEff;
      ({ book, tpl, data_end: dataEnd } = JA_KINDS[kindEff]);
      if (c.guess) flags.push('分型为推测（无备注对照），请人工核对');
    } else if (prof.kind === 'th_fee') {
      const c = classifyThFee(lines);
      kindEff = c.kindEff;
      const k = TH_FEE_KINDS[kindEff];
      book = k.book; tpl = k.tpl; dataEnd = k.data_end; ctx.pct = k.pct;
      if (c.labelOverride) labelOverride = { row: 43, col: 'I', text: c.labelOverride };
      if (c.guess) flags.push('分型为推测（如「其他100%」无历史对照），请人工核对');
    } else if (prof.kind === 'yd_fee') {
      const c = classifyYdFee(lines);
      kindEff = c.kindEff;
      const k = YD_FEE_KINDS[kindEff];
      book = k.book; tpl = k.tpl; dataEnd = prof.data_end; ctx.pct = k.pct;
      if (k.label) labelOverride = { row: 43, col: 'H', text: k.label };
      if (c.guess) flags.push('分型为推测，请人工核对');
    } else {
      kindEff = prof.kind;
      book = prof.book; tpl = prof.tpl; dataEnd = prof.data_end;
    }
    if (prof.guess) flags.push(prof.guess);

    if (kindEff === 'deposit') {
      // fee 行保持无 date 字段：planSheet 用 lines.find(l => l.date) 定发票日期，fee 行带日期会改变费用票口径
      for (const l of lines.filter((x) => x.kind === 'fee')) skippedFee.push({ inv, row: l.row, desc: l.desc, amount: l.amount });
      lines = lines.filter((x) => x.kind !== 'fee');
    }
    if (!lines.length) { flags.push('无有效明细行，未生成'); invoices.push({ inv, kindEff, kindName: KIND_NAMES[kindEff] || kindEff, date: null, lineCount: 0, total: 0, flags }); continue; }

    const capacity = dataEnd - DATA_START + 1;
    const parts = [];
    if (lines.length > capacity) {
      for (let ci = 0; ci < lines.length; ci += capacity) {
        parts.push({ name: inv + (ci === 0 ? '' : `-${ci / capacity + 1}`), lines: lines.slice(ci, ci + capacity) });
      }
      splits.push({ inv, lineCount: lines.length, chunkCount: parts.length });
      flags.push(`超容量拆 ${parts.length} 张续票`);
    } else {
      parts.push({ name: inv, lines });
    }

    const date = (lines.find((l) => l.date) || {}).date || null;
    invoices.push({
      inv, kindEff, kindName: KIND_NAMES[kindEff] || kindEff, date,
      lineCount: lines.length, total: parts.reduce((s, p) => s + chunkTotal(p.lines, kindEff, ctx), 0), flags,
    });
    for (const p of parts) {
      chunks.push({
        outName: p.name.slice(0, 31), book, tpl, dataEnd, kindEff, ctx, lines: p.lines, date,
        labelOverride, total: chunkTotal(p.lines, kindEff, ctx), flags,
      });
    }
  }
  return { sheetName, label: prof.label, prof, invoices, chunks, skippedNoInv, skippedNoAmt, anomalies, skippedFee, splits };
}

/** 汇总整张明细表的 sheet 状态（支持/不适用/未标框不生成/印尼不打 + 发票数） */
export function scanDetailSheets(sheetRowsMap) {
  const supported = [], unsupported = [], excluded = [], indonesia = [];
  for (const [name, rows] of Object.entries(sheetRowsMap)) {
    const dataRows = rows.slice(1).filter((r) => (r || []).some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
    if (!dataRows.length) continue; // 空 sheet 不列
    if (name.includes('印尼')) { indonesia.push({ name, rows: dataRows.length }); continue; } // 印尼票不打
    const { prof, reason } = resolveProfile(name, rows);
    if (!prof) { unsupported.push({ name, rows: dataRows.length, reason }); continue; }
    const { order } = readGroups(rows, prof);
    if (prof.disabled) {
      excluded.push({ name, label: prof.label, reason: prof.disabled, invoiceCount: order.length, invoices: order });
      continue;
    }
    supported.push({ name, label: prof.label, invoiceCount: order.length, guess: !!prof.guess });
  }
  return { supported, unsupported, excluded, indonesia };
}

/* ---------------- 生成执行 ---------------- */

/**
 * 生成全部选中 sheet 的发票。
 * @param bookBuffers { hk:ArrayBuffer, yd:ArrayBuffer, hk2:ArrayBuffer }
 * @param plans planSheet 结果数组
 * 返回 { files:[{name, buffer, bookShort, label, sheetCount}], report:[...], summary:{...} }
 */
export async function generateOther({ bookBuffers, plans, timestamp, onProgress }) {
  // 按（明细表 sheet × 模板本）分组输出
  const fileGroups = new Map();
  for (const plan of plans) {
    for (const chunk of plan.chunks) {
      const key = `${plan.sheetName}${chunk.book}`;
      if (!fileGroups.has(key)) fileGroups.set(key, { plan, book: chunk.book, chunks: [] });
      fileGroups.get(key).chunks.push(chunk);
    }
  }

  const files = [], report = [];
  let done = 0, totalChunks = plans.reduce((s, p) => s + p.chunks.length, 0);
  for (const { plan, book, chunks } of fileGroups.values()) {
    const pkg = await XlsxPackage.load(bookBuffers[book]);
    // 先取模版部件（strip 后模版 sheet 就不在了），按模板名缓存
    const fillers = new Map();
    for (const chunk of chunks) {
      if (!fillers.has(chunk.tpl)) fillers.set(chunk.tpl, new TemplateFiller(await pkg.getTemplateParts(chunk.tpl)));
    }
    await pkg.stripAllSheets();

    for (const chunk of chunks) {
      const filler = fillers.get(chunk.tpl);
      const poAware = !['fee100', 'fee50', 'deposit100', 'balance50', 'deposit50'].includes(chunk.kindEff);
      let prevPo = null;
      const lineCells = chunk.lines.map((ln, i) => {
        const r = DATA_START + i;
        let poToWrite = null;
        if (poAware && ln.kind === 'item') {
          if (i === 0 || ln.po !== prevPo) poToWrite = ln.po;  // 首行必写，之后仅 PO 变化行
          prevPo = ln.po;
        }
        return lineToCells(ln, r, chunk.kindEff, filler.st, { pct: chunk.ctx.pct, poToWrite });
      });
      const sheetXml = filler.build({
        invNo: chunk.outName, date: chunk.date, lineCells, dataEnd: chunk.dataEnd,
        totalCached: chunk.total, labelOverride: chunk.labelOverride,
      });
      pkg.addSheet({
        name: chunk.outName, sheetXml,
        commentsXml: filler.commentsXml, vmlXml: filler.vmlXml, relsXml: filler.relsXml,
        definedNames: true, printArea: '$A$8:$I$46', // 文员口径：打印区域与「格式/兴信香港.xls」一致
      });
      report.push({
        file: '', sheet: chunk.outName, customer: plan.label, srcSheet: plan.sheetName,
        kind: KIND_NAMES[chunk.kindEff] || chunk.kindEff, tpl: chunk.tpl, book: BOOKS[book].short,
        lines: chunk.lines.length, total: chunk.total, flags: chunk.flags,
      });
      done++;
      if (onProgress && done % 10 === 0) onProgress(done, totalChunks);
    }

    const buffer = await pkg.save({ fullCalcOnLoad: true });
    const fname = `${BOOKS[book].short}_${plan.label}发票_${timestamp}.xlsx`;
    files.push({ name: fname, buffer, bookShort: BOOKS[book].short, label: plan.label, cat: categoryOfLabel(plan.label), sheetCount: chunks.length });
    for (let i = report.length - chunks.length; i < report.length; i++) report[i].file = fname;
  }
  return { files, report };
}
