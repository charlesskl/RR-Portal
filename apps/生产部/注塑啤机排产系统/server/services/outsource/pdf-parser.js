// Multi-template PDF parser for 啤机外发 source documents.
// Uses pdfjs-dist for positional text extraction (x/y per fragment).

// pdf-parse v1 API (paiji 已装 ^1.1.1)
const pdfParse = require('pdf-parse');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// ---------- helpers ----------
function pad2(n) { return String(n).padStart(2, '0'); }
function cnDateToISO(s) {
  if (!s) return '';
  const m1 = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m1) return `${m1[1]}-${pad2(m1[2])}-${pad2(m1[3])}`;
  const m2 = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m2) return `${m2[1]}-${pad2(m2[2])}-${pad2(m2[3])}`;
  const m3 = s.match(/^(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m3) return `20${m3[1]}-${pad2(m3[2])}-${pad2(m3[3])}`;
  return '';
}

async function readPdfText(buf) {
  const data = await pdfParse(buf);
  return data.text;
}

async function readPdfPositions(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const all = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      all.push({
        str: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        w: Math.round(it.width || 0),
        page: p,
      });
    }
  }
  return all;
}

function clusterRows(items, yGap) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= yGap) {
      last.items.push(it);
      last.y = Math.min(last.y, it.y);
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  return rows;
}

function snapToColumns(items, anchors) {
  const out = {};
  for (const a of anchors) out[a.key] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    let best = anchors[0], bestDist = Math.abs(it.x - anchors[0].x);
    for (const a of anchors) {
      const d = Math.abs(it.x - a.x);
      if (d < bestDist) { best = a; bestDist = d; }
    }
    if (it.preSpace && out[best.key].length) out[best.key].push(' ');
    out[best.key].push(it.str);
  }
  const merged = {};
  for (const a of anchors) merged[a.key] = out[a.key].join('').trim();
  return merged;
}

function num(s) {
  if (s === undefined || s === null || s === '') return null;
  const cleaned = String(s).replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

// Pick the value for a given label.
// Supports two layouts:
//   1) label and value in the same text fragment: "交货地点：华登塑胶仓"
//   2) label fragment, then value in the next non-empty fragment to the right.
// Stops at the next label (a fragment that ends with ：/: but has no value after it).
function valueRightOf(rowItems, labelRe) {
  const sorted = [...rowItems].sort((a, b) => a.x - b.x);
  const idx = sorted.findIndex((it) => labelRe.test(it.str));
  if (idx < 0) return '';
  // Inline value: label string contains "：value"
  const labelStr = sorted[idx].str;
  const inline = labelStr.match(/[：:]\s*([^：:]+?)\s*$/);
  if (inline && inline[1].trim()) {
    const v = inline[1].trim();
    if (v) return v;
  }
  // Otherwise scan right
  for (let i = idx + 1; i < sorted.length; i++) {
    const raw = sorted[i].str.trim();
    if (!raw) continue;
    const s = raw.replace(/^[：:\s]+/, '').trim();
    if (!s) continue;
    if (/[：:]/.test(s)) return ''; // next label
    return s;
  }
  return '';
}

// ---------- template detection ----------
function detectTemplate(text) {
  if (/委托加工合同/.test(text)) return 'C_purchase';
  if (/华\s*登\s*塑\s*胶/.test(text)) return 'B_huadeng';
  if (/啤\s*机\s*部\s*生\s*产\s*啤\s*货\s*表/.test(text)) return 'A_xinxin';
  return 'unknown';
}

// ============================================================
// TEMPLATE A: 旧兴信 啤货表 (text-based, already works)
// ============================================================
function parseA_header(text) {
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const billNoMatch = text.match(/生产单号[：:][\s\S]{0,80}?([A-Z]{2,4}\d{5,})/);
  return {
    bill_no: billNoMatch ? billNoMatch[1] : '',
    place_date: cnDateToISO(grab(/(\d{4}年\d{1,2}月\d{1,2}日)\s*出单日期[：:]/)),
    delivery_date: cnDateToISO(grab(/(\d{4}年\d{1,2}月\d{1,2}日)\s*交货日期[：:]/)),
    accept_date: cnDateToISO(grab(/(\d{4}年\d{1,2}月\d{1,2}日)\s*接单日期[：:]/)),
    customer: grab(/([A-Z][A-Z0-9]*)\s*公司名称[：:]/),
    deliver_to: grab(/([^\s：:]+)\s*交货地点[：:]/),
    supplier: grab(/(\S+?)\s*供应商[：:]/),
    placer: grab(/(\S+?)\s*下单人[：:]/),
    receiver: grab(/(\S+?)\s*接单人[：:]/),
    operator: grab(/(\S+?)\s*操作员[：:]/),
    goods_receiver: grab(/(\S+?)\s*收货人[：:]/),
    note: (text.match(/备\s+注\s+([^\n]+)/) || [, ''])[1].trim(),
  };
}

function parseA_rows(text) {
  const rows = [];
  const flat = text.replace(/\s+/g, ' ');
  const moldRe = /(\d{6,7}-M\d{1,3})/g;
  const matches = [];
  let m;
  while ((m = moldRe.exec(flat)) !== null) matches.push({ code: m[1], idx: m.index, end: moldRe.lastIndex });
  if (matches.length === 0) return rows;

  const tailCands = ['总净重:', '〖', '特别注明'].map((k) => flat.indexOf(k)).filter((x) => x > 0);
  const tailIdx = tailCands.length ? Math.min(...tailCands) : flat.length;

  const dateTokenRe = /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?$/;
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const segEnd = (i + 1 < matches.length) ? matches[i + 1].idx : tailIdx;
    const all = flat.slice(cur.end, segEnd).trim().split(/\s+/).filter(Boolean);
    if (all.length < 6) continue;
    const dateIdx = all.findIndex((tok, k) => k >= 3 && dateTokenRe.test(tok));
    if (dateIdx < 0) continue;
    const t = all.slice(0, dateIdx + 1);
    if (!/^\d+(\.\d+)?$/.test(t[t.length - 2])) continue;
    const mold_name = t[0];
    if (!/^\d+$/.test(t[1]) || !/^\d+$/.test(t[2])) continue;
    const mid = t.slice(3, t.length - 2);
    let wIdx = -1;
    for (let k = mid.length - 1; k >= 0; k--) if (/^\d+\.\d+$/.test(mid[k])) { wIdx = k; break; }
    if (wIdx < 0) continue;
    rows.push({
      mold_code: cur.code,
      mold_name,
      total_sets: num(t[1]),
      shots: num(t[2]),
      color: mid.slice(0, wIdx).join('').replace(/\s+/g, ''),
      total_weight_kg: num(mid[wIdx]),
      unit_price: num(t[t.length - 2]),
      row_note: mid.slice(wIdx + 1).join(' ').trim(),
      delivery_date: cnDateToISO(t[t.length - 1]),
    });
  }
  return rows;
}

// ============================================================
// TEMPLATE B: 华登塑胶 啤货表 — positional, dynamic anchors
// ============================================================
const TPL_B_LABEL_TO_KEY = [
  [/^款号$/,         'order_no'],
  [/^模具编号$/,     'mold_code'],
  [/^工模名称$/,     'mold_name'],
  [/^总套数$/,       'total_sets'],
  [/^啤数$/,         'shots'],
  [/^颜色$/,         'color'],
  [/^色粉号$/,       'color_powder'],
  [/^用料名称$/,     'material'],
  [/^整啤净/,        'shot_weight_g'],
  [/^总净重/,        'total_weight_kg'],
  [/^加工单价$/,     'unit_price'],
  [/^加工金额$/,     'amount'],
  [/^交货日期$/,     'delivery_date'],
  [/^备注$/,         'row_note'],
];

function extractAnchorsFromHeaderRows(rows, headerCenterIdx, labelMap, yWindow = 12) {
  const centerY = rows[headerCenterIdx].y;
  const nearby = [];
  for (const r of rows) {
    if (Math.abs(r.y - centerY) <= yWindow) nearby.push(...r.items);
  }
  const anchors = [];
  for (const item of nearby) {
    for (const [re, key] of labelMap) {
      if (re.test(item.str) && !anchors.find((a) => a.key === key)) {
        anchors.push({ key, x: item.x });
        break;
      }
    }
  }
  anchors.sort((a, b) => a.x - b.x);
  return anchors;
}

function parseB_header(items, text) {
  // Try to extract via positional labels first
  const rows = clusterRows(items, 4);
  const findRow = (re) => rows.find((r) => r.items.some((i) => re.test(i.str)));
  const grab = (rowRe, valRe) => {
    const r = findRow(rowRe);
    return r ? valueRightOf(r.items, valRe) : '';
  };
  // Bill no: 生产单号
  const billRow = findRow(/生产单号/);
  let bill_no = '';
  if (billRow) {
    const after = [...billRow.items].sort((a, b) => a.x - b.x);
    const labelIdx = after.findIndex((i) => /生产单号/.test(i.str));
    if (labelIdx >= 0) {
      for (const it of after.slice(labelIdx + 1)) {
        const s = it.str.replace(/^[：:\s]+/, '').trim();
        if (s && /^[A-Za-z0-9\-]+$/.test(s)) { bill_no = s; break; }
      }
    }
  }
  return {
    bill_no,
    place_date: cnDateToISO(grab(/出单日期/, /出单日期/)),
    delivery_date: cnDateToISO(grab(/交货日期/, /交货日期/)),
    accept_date: cnDateToISO(grab(/接单日期/, /接单日期/)),
    customer: grab(/公司名称/, /公司名称/),
    deliver_to: grab(/交货地点/, /交货地点/),
    supplier: grab(/^供应商[：:]/, /供应商/),
    placer: grab(/下单人/, /下单人/),
    receiver: grab(/接单人/, /接单人/),
    operator: grab(/操作员/, /操作员/),
    goods_receiver: grab(/收货人/, /收货人/),
    note: (text.match(/备\s+注[：:]?\s+([^\n]+)/) || [, ''])[1].trim(),
  };
}

function parseB(items, headerText) {
  const header = parseB_header(items, headerText);
  const rows = clusterRows(items, 4);
  const headerRowIdx = rows.findIndex((r) =>
    r.items.some((i) => /^模具编号$/.test(i.str)) &&
    r.items.some((i) => /^工模名称$/.test(i.str))
  );
  if (headerRowIdx < 0) return { header, rows: [] };

  const anchors = extractAnchorsFromHeaderRows(rows, headerRowIdx, TPL_B_LABEL_TO_KEY);
  if (anchors.length < 8) return { header, rows: [] };

  let footerIdx = rows.length;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const txt = rows[i].items.map((x) => x.str).join('');
    if (/〖|特别注明|^操作员/.test(txt)) { footerIdx = i; break; }
  }

  const out = [];
  let lastOrderNo = '', lastDate = header.delivery_date || '';
  for (let i = headerRowIdx + 1; i < footerIdx; i++) {
    const r = rows[i];
    const fields = snapToColumns(r.items, anchors);
    if (!fields.mold_code || !/[A-Za-z]/.test(fields.mold_code)) continue;
    if (fields.order_no) lastOrderNo = fields.order_no;
    const dateNorm = cnDateToISO(fields.delivery_date) || fields.delivery_date || lastDate;
    if (dateNorm) lastDate = dateNorm;
    out.push({
      order_no: fields.order_no || lastOrderNo,
      mold_code: fields.mold_code,
      mold_name: fields.mold_name,
      total_sets: num(fields.total_sets),
      shots: num(fields.shots),
      color: fields.color,
      color_powder: fields.color_powder,
      material: fields.material,
      shot_weight_g: num(fields.shot_weight_g),
      total_weight_kg: num(fields.total_weight_kg),
      unit_price: num(fields.unit_price),
      amount: num(fields.amount),
      row_note: fields.row_note,
      delivery_date: dateNorm,
    });
  }
  return { header, rows: out };
}

// ============================================================
// TEMPLATE C: 兴信/华登 委托加工合同 — 动态列锚点 + 换行单元格归并
// ============================================================
// 旧版固定像素锚点（不同供应商的合同列位置不同，仅作动态锚点失败时的回退）
const TPL_C_ANCHORS = [
  { key: 'goods_no',         x: 50  },
  { key: 'goods_name',       x: 95  },
  { key: 'production_no',    x: 155 },
  { key: 'mold_code',        x: 200 },
  { key: 'material',         x: 248 },
  { key: 'shot_weight_g',    x: 282 },
  { key: 'total_weight_kg',  x: 312 },
  { key: 'color',            x: 342 },
  { key: 'color_powder',     x: 372 },
  { key: 'quantity',         x: 405 },
  { key: 'shots',            x: 432 },
  { key: 'unit_price',       x: 462 },
  { key: 'amount',           x: 495 },
  { key: 'row_note',         x: 555 },
];

// 表头标签 → 字段（繁简兼容），用于从实际表头行动态取 x 坐标
const TPL_C_LABEL_TO_KEY = [
  [/^(貨號|货号)$/,          'goods_no'],
  [/^(貨物名稱|货物名称)$/,   'goods_name'],
  [/^(生产单号|生產單號)$/,   'production_no'],
  [/^(模具编号|模具編號)$/,   'mold_code'],
  [/^(用料名称|用料名稱)$/,   'material'],
  [/^单重G?$/,               'shot_weight_g'],
  [/^(总重量|總重量)$/,       'total_weight_kg'],
  [/^(颜色|顏色)$/,           'color'],
  [/^(色粉号|色粉號)$/,       'color_powder'],
  [/^(数量|數量)$/,           'quantity'],
  [/^啤数$/,                 'shots'],
  [/^(單價|单价)/,           'unit_price'],
  [/^(金額|金额)/,           'amount'],
  [/^(備註|备注)$/,           'row_note'],
];

function parseC_header(items, text) {
  const rows = clusterRows(items, 4);
  const findRow = (re) => rows.find((r) => r.items.some((i) => re.test(i.str)));
  const grab = (rowRe, labelRe) => {
    const r = findRow(rowRe);
    return r ? valueRightOf(r.items, labelRe) : '';
  };
  return {
    bill_no: grab(/採購單編號/, /採購單編號/),
    place_date: cnDateToISO((text.match(/日\s*期[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日)/) || [])[1] || ''),
    delivery_date: cnDateToISO((text.match(/(\d{4}年\d{1,2}月\d{1,2}日)\s*前交货/) || [])[1] || ''),
    supplier: grab(/^供應商[：:]/, /^供應商[：:]?$/),
    customer: '东莞兴信塑胶制品有限公司',
    deliver_to: (text.match(/前交货货送\s+(\S+?)\s+处/) || [, ''])[1].trim(),
    // 委托加工合同 上方"聯繫人" = 加工厂联系人 (e.g. 毛小姐, 一个完整 item)
    // 下方"聯 系 人" = 兴信内部 PMC (e.g. 陈梦楚) — 被拆成 ["聯","系","人："] 3 个独立 item，
    //   值"陈梦楚"在同行右侧。所以唯一独立的 "人：" 一定指 PMC 那一行
    placer: grab(/^人[：:]$/, /^人[：:]$/),
    supplier_contact: grab(/聯繫人/, /聯繫人/),
    receiver: '',
    accept_date: '',
    operator: '',
    goods_receiver: '',
    note: '',
  };
}

// 将含 ASCII 空格的合并碎片按字符比例拆成子碎片
// （pdfjs 常把多列合并成一个碎片，如 "SR800-M15 ABS 750NSW"、"生产单号 模具编号 用料名称"）
function splitFragments(items) {
  const out = [];
  for (const it of items) {
    if (!it.str.includes(' ') || !it.w) { out.push(it); continue; }
    const tokens = it.str.split(/ +/).filter(Boolean);
    if (tokens.length < 2) { out.push(it); continue; }
    let cursor = 0;
    for (const tok of tokens) {
      const off = it.str.indexOf(tok, cursor);
      cursor = off + tok.length;
      // preSpace: 非首个子碎片，拼回同列时需补空格（如用料 "PP CI571"）
      out.push({ ...it, str: tok, x: Math.round(it.x + it.w * (off / it.str.length)), w: 0, preSpace: off > 0 });
    }
  }
  return out;
}

// 模板 C 专用：不依赖表头文字对齐（部分合同表头与数据列错位），
// 直接对数据区所有碎片做 x 聚类得到列，再按内容特征 + 固定列序推断每列含义
const TPL_C_EXPECTED_ORDER = [
  ['goods_no',        ['alnum']],
  ['goods_name',      ['cjk']],
  ['production_no',   ['prod_no', 'alnum']],
  ['mold_code',       ['alnum', 'prod_no']],
  ['material',        ['material', 'alnum']],
  ['shot_weight_g',   ['dec']],
  ['total_weight_kg', ['dec']],
  ['color',           ['cjk']],
  ['color_powder',    ['powder']],
  ['quantity',        ['int']],
  ['shots',           ['int']],
  ['unit_price',      ['dec']],
  ['amount',          ['dec']],
  ['row_note',        ['cjk', 'alnum']],
];

function deriveAnchorsC(rows, fromIdx, toIdx) {
  const pts = [];
  for (let i = fromIdx; i < toIdx; i++) pts.push(...rows[i].items);
  if (!pts.length) return [];
  pts.sort((a, b) => a.x - b.x);
  const clusters = [];
  for (const p of pts) {
    const c = clusters[clusters.length - 1];
    if (c && p.x - c.maxX <= 14) {
      c.items.push(p);
      c.maxX = Math.max(c.maxX, p.x);
      c.sum += p.x;
    } else {
      clusters.push({ maxX: p.x, sum: p.x, items: [p] });
    }
  }
  const sigOf = (c) => {
    const ss = c.items.map((i) => i.str);
    const any = (re) => ss.some((s) => re.test(s));
    const all = (re) => ss.every((s) => re.test(s));
    if (any(/-M\d+/i)) return 'prod_no';
    if (any(/^(PP|PE|ABS|MABS|PC|PA|POM|PVC|TPU|TPE|PMMA|PS|透明)/i) && any(/[A-Za-z]/)) return 'material';
    if (all(/^\d{5}$/)) return 'powder';
    if (all(/^-?[\d,]+$/)) return 'int';
    if (all(/^-?[\d,]*\d(\.\d+)?$/) && any(/\./)) return 'dec';
    if (any(/[一-鿿]/)) return 'cjk';
    return 'alnum';
  };
  const anchors = [];
  let e = 0;
  for (const c of clusters) {
    const s = sigOf(c);
    while (e < TPL_C_EXPECTED_ORDER.length && !TPL_C_EXPECTED_ORDER[e][1].includes(s)) e++;
    if (e >= TPL_C_EXPECTED_ORDER.length) break;
    anchors.push({ key: TPL_C_EXPECTED_ORDER[e][0], x: Math.round(c.sum / c.items.length) });
    e++;
  }
  return anchors;
}

function parseC(items, headerText) {
  const header = parseC_header(items, headerText);
  // 先拆合并碎片，再用小间距按物理行聚类
  const rows = clusterRows(splitFragments(items), 3);
  const headerRowIdx = rows.findIndex((r) => {
    const txt = r.items.map((x) => x.str).join('');
    return /模具编号|模具編號/.test(txt) && /啤数/.test(txt);
  });
  if (headerRowIdx < 0) return { header, rows: [] };

  let footerIdx = rows.length;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const txt = rows[i].items.map((x) => x.str).join('');
    if (/合計|附送|〖|前交货货送/.test(txt)) { footerIdx = i; break; }
  }

  const anchors = deriveAnchorsC(rows, headerRowIdx + 1, footerIdx);
  const keys = new Set(anchors.map((a) => a.key));
  const anchorsOk = ['goods_name', 'production_no', 'quantity', 'shots'].every((k) => keys.has(k));

  // ---- 回退路径：列推断失败时用固定像素锚点 + 旧向上归并（兼容旧兴信合同）----
  if (!anchorsOk) {
    const isContinuation = (f) => !num(f.quantity) && !num(f.shots) && !f.goods_no;
    const out = [];
    for (let i = headerRowIdx + 1; i < footerIdx; i++) {
      const fields = snapToColumns(rows[i].items, TPL_C_ANCHORS);
      const hasAny = Object.values(fields).some((v) => v);
      if (!hasAny) continue;
      if (isContinuation(fields) && out.length > 0) {
        const prev = out[out.length - 1];
        if (fields.goods_name) prev.mold_name = (prev.mold_name || '') + fields.goods_name;
        if (fields.material)   prev.material = (prev.material || '') + ' ' + fields.material;
        if (fields.row_note)   prev.row_note = (prev.row_note || '') + ' ' + fields.row_note;
        continue;
      }
      if (!fields.mold_code && !fields.goods_no && !fields.goods_name) continue;
      out.push({
        order_no: fields.goods_no || (out.length ? out[out.length - 1].order_no : ''),
        mold_code: fields.mold_code,
        mold_name: fields.goods_name,
        total_sets: num(fields.quantity),
        shots: num(fields.shots),
        color: fields.color,
        color_powder: fields.color_powder,
        material: fields.material,
        shot_weight_g: num(fields.shot_weight_g),
        total_weight_kg: num(fields.total_weight_kg),
        unit_price: num(fields.unit_price),
        amount: num(fields.amount),
        production_no: fields.production_no,
        row_note: fields.row_note,
        delivery_date: header.delivery_date,
      });
    }
    return { header, rows: out };
  }

  // ---- 主路径：数据驱动列锚点 + 换行碎片就近归并 ----
  const snapped = [];
  for (let i = headerRowIdx + 1; i < footerIdx; i++) {
    const f = snapToColumns(rows[i].items, anchors);
    if (!Object.values(f).some((v) => v)) continue;
    snapped.push({ y: rows[i].y, f, isData: num(f.quantity) != null || num(f.shots) != null });
  }
  const dataIdxs = [];
  snapped.forEach((s, idx) => { if (s.isData) dataIdxs.push(idx); });

  // 非数据行（换行碎片）归并到 y 距离最近的数据行：
  //   在数据行上方 = 品名前缀（如 "C绿色恐龙"），下方 = 后缀（如 "书包"）；用料/备注同理
  const pre = {}, post = {};
  snapped.forEach((s, idx) => {
    if (s.isData || !dataIdxs.length) return;
    let best = dataIdxs[0];
    for (const d of dataIdxs) {
      if (Math.abs(snapped[d].y - s.y) < Math.abs(snapped[best].y - s.y)) best = d;
    }
    const bag = best > idx ? (pre[best] = pre[best] || []) : (post[best] = post[best] || []);
    bag.push(s.f);
  });

  const out = [];
  snapped.forEach((s, idx) => {
    if (!s.isData) return;
    const f = s.f;
    const preArr = pre[idx] || [], postArr = post[idx] || [];
    const name =
      preArr.map((p) => p.goods_name || '').join('') +
      (f.goods_name || '') +
      postArr.map((p) => p.goods_name || '').join('');
    const material = [...preArr.map((p) => p.material), f.material, ...postArr.map((p) => p.material)]
      .filter(Boolean).join(' ');
    const row_note = [f.row_note, ...preArr.map((p) => p.row_note), ...postArr.map((p) => p.row_note)]
      .filter(Boolean).join(' ');
    if (!name && !f.mold_code && !f.production_no) return;
    out.push({
      order_no: f.goods_no || (out.length ? out[out.length - 1].order_no : ''),
      mold_code: f.mold_code || '',
      mold_name: name,
      total_sets: num(f.quantity),
      shots: num(f.shots),
      color: f.color || '',
      color_powder: f.color_powder || '',
      material,
      shot_weight_g: num(f.shot_weight_g),
      total_weight_kg: num(f.total_weight_kg),
      unit_price: num(f.unit_price),
      amount: num(f.amount),
      production_no: f.production_no || '',
      row_note,
      delivery_date: header.delivery_date,
    });
  });
  return { header, rows: out };
}

// ============================================================
// Public API
// ============================================================
async function parsePdfBuffer(buf) {
  const text = await readPdfText(buf);
  const template = detectTemplate(text);
  if (template === 'A_xinxin') {
    return { template, header: parseA_header(text), rows: parseA_rows(text) };
  }
  const items = await readPdfPositions(buf);
  if (template === 'B_huadeng') {
    const r = parseB(items, text);
    return { template, ...r };
  }
  if (template === 'C_purchase') {
    const r = parseC(items, text);
    return { template, ...r };
  }
  return { template: 'unknown', header: {}, rows: [], raw_text: text };
}

module.exports = { parsePdfBuffer, detectTemplate };
