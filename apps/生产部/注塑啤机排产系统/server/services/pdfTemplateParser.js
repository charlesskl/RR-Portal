// PDF 模板规则解析器（兴信内部 / 华登外发 2 种固定模板）
// 失败时上层回落 AI 解析。

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// 提取 PDF 所有文字 + 坐标
async function extractItems(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const items = [];
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      items.push({
        s,
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        page: p,
      });
      fullText += s;
    }
  }
  return { items, text: fullText };
}

// 模板判别：返回 'A' / 'B' / null
function detectTemplate(text) {
  if (text.includes('委托加工合同') || text.includes('採購單編號')) return 'A';
  if (text.includes('啤机部生产啤货表') || text.includes('啤 机 部 生 产 啤 货 表')) return 'B';
  return null;
}

// 找"订单起始行"：含某 x 坐标且文本匹配 pattern 的行
function findOrderStartYs(items, anchorX, xTolerance, pattern) {
  const ys = new Set();
  for (const it of items) {
    if (Math.abs(it.x - anchorX) <= xTolerance && pattern.test(it.s)) {
      ys.add(it.y);
    }
  }
  return [...ys].sort((a, b) => b - a); // y 从大到小 = 从上到下
}

// 找"订单起始行"：x 在 [xMin, xMax] 范围内且文本匹配 pattern
function findOrderStartYsInRange(items, xMin, xMax, pattern) {
  const ys = new Set();
  for (const it of items) {
    if (it.x >= xMin && it.x < xMax && pattern.test(it.s)) {
      ys.add(it.y);
    }
  }
  return [...ys].sort((a, b) => b - a);
}

// 把 yTop 起到下一个订单 yBottom（不含）为止的 items 取出来
// maxHeight 限制每条订单数据带最大高度，避免吃下方说明文字
// 切分点：两条订单 yTop 的中点（避免邻居订单续行串入）
function sliceOrderItems(items, yTop, yBottom, maxHeight = 28) {
  // 用 yTop 和 yBottom 的中点作为切分线 — 比 yBottom+6 更稳，
  // 避免下一条订单的"款号续行"等位于 yTop+5 ~ midPoint 之间的内容被串入本订单
  const midPoint = (yTop + yBottom) / 2;
  const effectiveBottom = Math.max(midPoint + 1, yTop - maxHeight);
  return items.filter(it => it.y <= yTop + 10 && it.y >= effectiveBottom);
}

// 安全解整数：支持 "7500.0" → 7500（先 float 再 round）
function safeInt(s) {
  const n = parseFloat(String(s).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function safeFloat(s) {
  const n = parseFloat(String(s).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// 按 x 范围拼接同订单的 items
// opts.numericOnly: 数字字段，过滤掉含中文/字母的 items（避免相邻列文字粘连导致错位）
function fieldInXRange(orderItems, xMin, xMax, opts = {}) {
  let matched = orderItems
    .filter(it => it.x >= xMin && it.x < xMax)
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));  // 从上到下、左到右
  if (opts.numericOnly) {
    matched = matched.filter(it => /^[\d.\-,]+$/.test(it.s));
  }
  if (matched.length === 0) return '';
  return matched.map(it => it.s).join(opts.sep || '').trim();
}

// ========== 模板 A：华登/CMC 外发 ==========
function parseTemplateA(items) {
  // 货号在 x=30, 4-6位数字（如 15751）
  const startYs = findOrderStartYs(items, 30, 5, /^\d{4,6}$/);

  const orders = [];
  for (let i = 0; i < startYs.length; i++) {
    const yTop = startYs[i];
    const yBottom = i + 1 < startYs.length ? startYs[i + 1] : (yTop - 35);  // 最后一条用 yTop-35 兜底
    const o = sliceOrderItems(items, yTop, yBottom);

    const product_code  = fieldInXRange(o, 20, 70);                       // 货号 (含 "总MA" 续行)
    const goods_name    = fieldInXRange(o, 70, 140);                      // 货物名称
    const ext_order_no  = fieldInXRange(o, 140, 190);                     // 生产单号 MA_RR_2314
    const mold_no       = fieldInXRange(o, 190, 230);                     // 模具编号 (含续行)
    const material_type = fieldInXRange(o, 230, 275);                     // 用料 ABS 750NSW
    const shot_weight   = safeFloat(fieldInXRange(o, 275, 305, { numericOnly: true }));    // 单重G
    const material_kg   = safeFloat(fieldInXRange(o, 305, 332, { numericOnly: true }));    // 总重量
    const color         = fieldInXRange(o, 332, 360);
    const color_powder  = fieldInXRange(o, 360, 395);
    // x=395-423 是"数量"(总套数), x=423-450 是"啤数" — 取啤数
    const quantity_needed = safeInt(fieldInXRange(o, 423, 450, { numericOnly: true }));
    const notes         = fieldInXRange(o, 525, 700, { sep: ' ' });

    if (!mold_no && !product_code) continue;
    orders.push({
      product_code,
      mold_no,
      mold_name: [mold_no, goods_name].filter(Boolean).join(' ').trim() || goods_name,
      color,
      color_powder_no: color_powder,
      material_type,
      shot_weight,
      material_kg,
      quantity_needed,
      order_no: ext_order_no,
      notes,
      sprue_pct: 0,
      ratio_pct: 0,
      accumulated: 0,
      cavity: 1,
      cycle_time: 0,
      is_three_plate: 0,
      packing_qty: 0,
    });
  }
  return orders;
}

// ========== 模板 B 表头 label → 字段 key 映射 ==========
const TPL_B_LABELS = [
  [/^款号$/,       'product_code'],
  [/^模具编号$/,   'mold_no'],
  [/^工模名称$/,   'mold_name_part'],
  [/^总套数$/,     'total_sets'],
  [/^啤数$/,       'quantity_needed'],
  [/^颜色$/,       'color'],
  [/^色粉号$/,     'color_powder_no'],
  [/^用料名称$/,   'material_type'],
  [/^整啤/,        'shot_weight'],   // "整啤" 或 "整啤净重G."
  [/^总净/,        'material_kg'],    // "总净" 或 "总净重KG."
  [/^加工单价$/,   'unit_price'],
  [/^加工金额$/,   'amount'],
  [/^交货日期$/,   'delivery_date'],
  [/^备注$/,       'notes'],
];

// 动态找表头 y：含"款号"、"模具编号"、"工模名称"3 个 label 的那行
function findHeaderRow(items, requiredLabels) {
  const byY = {};
  for (const it of items) {
    if (!byY[it.y]) byY[it.y] = [];
    byY[it.y].push(it);
  }
  let bestY = null, bestCount = 0;
  for (const y of Object.keys(byY).map(Number)) {
    const strs = byY[y].map(it => it.s);
    const count = requiredLabels.filter(l => strs.includes(l)).length;
    if (count > bestCount && count >= 2) { bestY = y; bestCount = count; }
  }
  return bestY;
}

// 在 headerY ± yWindow 范围内匹配每个 label 的 x 坐标
function extractAnchors(items, headerY, labels, yWindow = 12) {
  const nearby = items.filter(it => Math.abs(it.y - headerY) <= yWindow);
  const anchors = [];
  for (const it of nearby) {
    for (const [re, key] of labels) {
      if (re.test(it.s) && !anchors.find(a => a.key === key)) {
        anchors.push({ key, x: it.x });
        break;
      }
    }
  }
  anchors.sort((a, b) => a.x - b.x);
  return anchors;
}

// 用 anchor 中点算每列 x 范围
function buildColRanges(anchors) {
  const ranges = {};
  for (let i = 0; i < anchors.length; i++) {
    const left  = i > 0                  ? (anchors[i-1].x + anchors[i].x) / 2 : Math.max(0, anchors[i].x - 30);
    const right = i + 1 < anchors.length ? (anchors[i].x + anchors[i+1].x) / 2 : anchors[i].x + 60;
    ranges[anchors[i].key] = { left, right };
  }
  return ranges;
}

// ========== 模板 B：B 车间内部生产单（动态锚点 + 硬编码 fallback） ==========
// 思路：优先用表头 label 的 x 动态识别列位置（耐 PDF 变种），
// 失败时回落到经验硬编码（这套已经端到端测准 6 份 PDF）
function parseTemplateB(items, fullText) {
  // 多页 PDF：每页单独解析（避免不同页同 y 的 items 被合并）
  const pages = [...new Set(items.map(it => it.page))];
  if (pages.length > 1) {
    const all = [];
    for (const p of pages) all.push(...parseTemplateB(items.filter(it => it.page === p), fullText));
    return all;
  }

  // 表头部分提取生产单号（fullText 拼接顺序乱，用宽松 regex 跳过中间字符）
  const orderNoMatch = fullText.match(/生产单号[：:][^A-Z]{0,30}([A-Z]{2,4}\d{4,})/);
  const order_no = orderNoMatch ? orderNoMatch[1] : '';

  // 默认硬编码 x 范围（蓝精灵/77858/77770/PTE/超级精灵球 实测准）
  let colRanges = {
    product_code:    { left: 20,  right: 115 },
    mold_no:         { left: 115, right: 200 },
    mold_name_part:  { left: 200, right: 300 },
    quantity_needed: { left: 343, right: 380 },
    color:           { left: 370, right: 418 },
    color_powder_no: { left: 418, right: 460 },
    material_type:   { left: 460, right: 525 },
    shot_weight:     { left: 525, right: 567 },
    material_kg:     { left: 567, right: 597 },
    notes:           { left: 670, right: 820 },
  };

  // 尝试动态锚点覆盖（如果表头识别成功，用动态值更准）
  const headerY = findHeaderRow(items, ['款号', '模具编号', '工模名称']);
  if (headerY != null) {
    const anchors = extractAnchors(items, headerY, TPL_B_LABELS, 12);
    if (anchors.length >= 8) {
      const dyn = buildColRanges(anchors);
      // 只覆盖识别到的列，未识别的保留硬编码兜底
      colRanges = { ...colRanges, ...dyn };
    }
  }

  // 用模号列范围找订单 yTop（不能用单点 anchor — 表头 label x 跟数据值 x 不一致）
  const startYs = findOrderStartYsInRange(items, colRanges.mold_no.left, colRanges.mold_no.right, /^[A-Z0-9][\w\-]*-M?\d/)
    .filter(y => headerY == null || Math.abs(y - headerY) > 8);

  const get = (orderItems, key, opts = {}) => {
    const r = colRanges[key];
    return r ? fieldInXRange(orderItems, r.left, r.right, opts) : '';
  };

  const orders = [];
  for (let i = 0; i < startYs.length; i++) {
    const yTop = startYs[i];
    const yBottom = i + 1 < startYs.length ? startYs[i + 1] : (yTop - 50);
    const o = sliceOrderItems(items, yTop, yBottom);

    // 款号实际渲染位置可能比表头 label 偏左很多（x=25 vs label x=61）
    const product_code    = fieldInXRange(o, 15, Math.min(115, colRanges.product_code.right));
    const mold_no         = get(o, 'mold_no');
    const mold_name_part  = get(o, 'mold_name_part');
    const quantity_needed = safeInt(get(o, 'quantity_needed', { numericOnly: true }));
    const color           = get(o, 'color');
    // 色粉号允许数字+字母后缀（如 89250A），不用 numericOnly
    const color_powder    = (() => {
      const raw = get(o, 'color_powder_no');
      // 提取首个数字串 + 可选 1-2 个字母后缀
      const m = raw.match(/(\d{4,}[A-Z]{0,2})/);
      return m ? m[1] : '';
    })();
    const material_type   = get(o, 'material_type');
    const shot_weight     = safeFloat(get(o, 'shot_weight', { numericOnly: true }));
    const material_kg     = safeFloat(get(o, 'material_kg', { numericOnly: true }));
    const notes           = get(o, 'notes', { sep: ' ' });

    if (!mold_no && !product_code) continue;

    // ===== Noise 过滤 =====
    // 合法模号：长度 5-18、不含中文、符合"字母数字-段...-段"格式
    const moldNoStr = String(mold_no).trim();
    if (moldNoStr.length < 5 || moldNoStr.length > 18) continue;       // 太长 = 串入备注 / 太短 = 不像模号
    if (/[一-龥]/.test(moldNoStr)) continue;                  // 含中文 = 收货人/总净重/凡是 等噪音
    if (!/^[A-Z0-9][\w\-]+-[A-Z0-9]+$/.test(moldNoStr)) continue;     // 不符合"段-段"格式

    orders.push({
      product_code, mold_no: moldNoStr,
      mold_name: [moldNoStr, mold_name_part].filter(Boolean).join(' ').trim() || mold_name_part,
      color, color_powder_no: color_powder,
      material_type, shot_weight, material_kg, quantity_needed,
      order_no, notes,
      sprue_pct: 0, ratio_pct: 0, accumulated: 0, cavity: 1, cycle_time: 0,
      is_three_plate: 0, packing_qty: 0,
    });
  }
  return orders;
}

// 主入口：尝试规则解析，失败返回 null（让上层回落 AI）
async function parsePdfByTemplate(buf) {
  try {
    const { items, text } = await extractItems(buf);
    const tpl = detectTemplate(text);
    if (!tpl) return null;
    const orders = tpl === 'A' ? parseTemplateA(items) : parseTemplateB(items, text);
    if (orders.length === 0) return null;
    return { template: tpl === 'A' ? '华登/CMC外发' : 'B车间内部生产单', orders };
  } catch (e) {
    console.error('[模板解析失败]', e.message);
    return null;
  }
}

module.exports = { parsePdfByTemplate, detectTemplate };
