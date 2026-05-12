const { PDFParse } = require('pdf-parse');

// 从文本里抽订单头字段
function extractHeader(text) {
  const out = {};
  const orderNoMatch = text.match(/(ZWZ\d+|[A-Z]{2,}\d{6,})/);
  if (orderNoMatch) out.order_no = orderNoMatch[1];

  const dateMatch = text.match(/日\s*期\s*[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    out.order_date = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2,'0')}-${String(dateMatch[3]).padStart(2,'0')}`;
  }

  // 交货日期可能在前在后
  let dueMatch = text.match(/交货日期\s*[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!dueMatch) dueMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日[\s\t]*交货日期/);
  if (dueMatch) {
    out.due_date = `${dueMatch[1]}-${String(dueMatch[2]).padStart(2,'0')}-${String(dueMatch[3]).padStart(2,'0')}`;
  }

  const techMatch = text.match(/工序\s*[:：]\s*(\S+)/);
  if (techMatch) out.technique_label = techMatch[1];

  return out;
}

// 抽款号(从物料行里频繁出现的款号取众数,兜底)
function extractCode(text) {
  // 形如 77773-总MA / 77773 / E73907-XX
  const codeRe = /([A-Z]?\d{4,}(?:-\S+)?)/g;
  const counts = new Map();
  let m;
  while ((m = codeRe.exec(text)) !== null) {
    const c = m[1];
    // 排除明显的电话号码、订单号等
    if (/^076\d|^\d{4}年|^\d{4}月|^ZWZ/.test(c)) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  // 找出现次数最多的
  let best = null, bestN = 0;
  for (const [k, v] of counts) {
    if (v > bestN) { best = k; bestN = v; }
  }
  return best;
}

// 抽物料行: 每个 "印喷件" 标记一行,前面是数量,中间是物料名
// 方法: 把 \n \t 都换成 | ,在结果上找 "印喷件" 的位置,向前回溯找数量+物料名
function extractItems(text) {
  // 规整空白
  const flat = text.replace(/[\t\r\n]+/g, '|').replace(/\s+/g, ' ');
  // 把每段 "印喷件" 切出
  // 模式: <数字带逗号或纯数字>\s*\|?\s*<物料名>\s*\(?\s*印喷件\s*\)?
  const re = /(\d{1,3}(?:,\d{3})+|\d{2,})\s*\|?\s*([^|()]+?)\s*\|?\s*\(?\s*印喷件\s*\)?/g;
  const items = [];
  let m;
  while ((m = re.exec(flat)) !== null) {
    const qty = Number(m[1].replace(/,/g, ''));
    let partName = (m[2] || '').trim();
    // 物料名清理:去掉前导款号(如 "77773-总MA ")
    partName = partName.replace(/[A-Z]?\d{4,}(?:-\S+)?\s*/g, '').trim();
    // 去掉「单价」「数量」「金额」等表头噪声
    if (/^(物料名称|款号|单价|数量|金额|颜色|TEL|Fax|备注)$/.test(partName)) continue;
    if (!partName) continue;
    // 数量上限合理性(不要把电话号码当数量)
    if (qty < 10 || qty > 10_000_000) continue;
    items.push({ part_name: partName, qty });
  }
  // 物料名相同的不去重(订单可能有 4#馕A 4#馕B 这种独立行)
  return items;
}

// 总入口:读 PDF buffer 返回 { header, code, items }
async function parsePDFOrder(buffer) {
  const parser = new PDFParse({ data: buffer });
  const r = await parser.getText();
  const text = r.text || '';
  const header = extractHeader(text);
  const code = extractCode(text);
  const items = extractItems(text);
  return { header, code, items, raw_text: text };
}

module.exports = { parsePDFOrder, extractHeader, extractCode, extractItems };
