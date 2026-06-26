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

// 把 yTop 起到下一个订单 yBottom（不含）为止的 items 取出来
// maxHeight 限制每条订单数据带最大高度，避免吃下方说明文字
function sliceOrderItems(items, yTop, yBottom, maxHeight = 28) {
  // yBottom + 6 = 排除下一条 yTop（订单间距 ~32+）
  // yTop + 10 = 包含订单首行上方略高的字段（跨行用料名等）
  const effectiveBottom = Math.max(yBottom + 6, yTop - maxHeight);
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
function fieldInXRange(orderItems, xMin, xMax, opts = {}) {
  const matched = orderItems
    .filter(it => it.x >= xMin && it.x < xMax)
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));  // 从上到下、左到右
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
    const yBottom = i + 1 < startYs.length ? startYs[i + 1] : 360;  // 360 = 表格底
    const o = sliceOrderItems(items, yTop, yBottom);

    const product_code  = fieldInXRange(o, 20, 70);                       // 货号 (含 "总MA" 续行)
    const goods_name    = fieldInXRange(o, 70, 140);                      // 货物名称
    const ext_order_no  = fieldInXRange(o, 140, 190);                     // 生产单号 MA_RR_2314
    const mold_no       = fieldInXRange(o, 190, 230);                     // 模具编号 (含续行)
    const material_type = fieldInXRange(o, 230, 275);                     // 用料 ABS 750NSW
    const shot_weight   = safeFloat(fieldInXRange(o, 275, 305));    // 单重G
    const material_kg   = safeFloat(fieldInXRange(o, 305, 332));    // 总重量
    const color         = fieldInXRange(o, 332, 360);
    const color_powder  = fieldInXRange(o, 360, 395);
    // x=395-423 是"数量"(总套数), x=423-450 是"啤数" — 取啤数
    const quantity_needed = safeInt(fieldInXRange(o, 423, 450));
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

// ========== 模板 B：B 车间内部生产单 ==========
function parseTemplateB(items, fullText) {
  // 表头部分提取生产单号（ZWY2600200）
  const orderNoMatch = fullText.match(/生产单号[：:]\s*([A-Z]+\d+)/);
  const order_no = orderNoMatch ? orderNoMatch[1] : '';

  // 款号在 x=25, 格式如 "3026146/3026146" 或纯数字（4 位以上）
  const startYs = findOrderStartYs(items, 25, 6, /^\d{4,}(\/\d+)?$/);

  const orders = [];
  for (let i = 0; i < startYs.length; i++) {
    const yTop = startYs[i];
    const yBottom = i + 1 < startYs.length ? startYs[i + 1] : 380;
    const o = sliceOrderItems(items, yTop, yBottom);

    const product_code  = fieldInXRange(o, 20, 115);                      // 款号
    const mold_no       = fieldInXRange(o, 115, 200);                     // 模具编号
    const mold_name_part = fieldInXRange(o, 200, 300);                    // 工模名称
    // x=300-343 总套数, x=343-380 啤数 — 取啤数
    const quantity_needed = safeInt(fieldInXRange(o, 343, 380));
    const color         = fieldInXRange(o, 380, 418);
    const color_powder  = fieldInXRange(o, 418, 460);
    const material_type = fieldInXRange(o, 460, 525);  // 用料 (可能"透明ABS"+"TR558AI"拼接)
    const shot_weight   = safeFloat(fieldInXRange(o, 525, 567));    // 整啤净重G
    const material_kg   = safeFloat(fieldInXRange(o, 567, 597));    // 总净重KG
    const notes         = fieldInXRange(o, 670, 820, { sep: ' ' });

    if (!mold_no && !product_code) continue;
    orders.push({
      product_code,
      mold_no,
      mold_name: [mold_no, mold_name_part].filter(Boolean).join(' ').trim() || mold_name_part,
      color,
      color_powder_no: color_powder,
      material_type,
      shot_weight,
      material_kg,
      quantity_needed,
      order_no,
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
