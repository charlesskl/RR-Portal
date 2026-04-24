const fs = require('fs');
const path = require('path');

// 用阿里云百炼（Bailian）OpenAI 兼容端点 + Qwen-VL 视觉模型识别订单图片。
// 直接让 LLM 返回结构化 JSON 数组，不再依赖 OCR + 正则后处理。
const ORDER_FIELDS = [
  'product_code', 'mold_no', 'mold_name', 'color', 'color_powder_no',
  'material_type', 'shot_weight', 'quantity_needed', 'material_kg',
  'cavity', 'order_no', 'notes',
];

const SYSTEM_PROMPT = `你是注塑啤机订单表识别专家。用户会上传一张订单/啤货表/生产单的图片，请把表格中的每一行物料提取成结构化 JSON。

只输出一个 JSON 数组，每个元素是一张订单，字段严格用下面这些英文 key（缺失字段用空字符串或 0，不要省略 key）：
- product_code: 产品货号（4-5 位数字或字母数字，如 "12345"、"P123A"）
- mold_no: 模具编号（如 "RC-1234"、"PASR-567"）
- mold_name: 模具名称（含前缀编号，格式 "<mold_no> <中文名称>"）
- color: 颜色（中文，如 "黑色"、"浅蓝"）
- color_powder_no: 色粉编号（4-5 位数字，可为空）
- material_type: 料型（如 "ABS"、"PP"、"PC"）
- shot_weight: 啤净重（克，数字）
- quantity_needed: 需啤数量（数字）
- material_kg: 用料 KG（数字，可为 0）
- cavity: 出模数（数字，默认 1）
- order_no: 下单单号（字符串，可为空）
- notes: 备注（字符串，可为空）

规则：
1. 跳过表头、合计行、制表/审核等签名行
2. 不要编造数字；看不清的数字字段填 0，字符串字段填 ""
3. 只输出 JSON 数组本身，不要 markdown 代码围栏、不要解释文字`;

/**
 * 通过 Bailian qwen-vl 识别订单图片
 * @param {string} imagePath - 本地图片文件路径
 * @returns {Promise<{orders: Array, rawText: string}>}
 */
async function parseImageOrders(imagePath) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) throw new Error('BAILIAN_API_KEY 未配置，无法识别图片订单');

  const baseUrl = (process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const model = process.env.BAILIAN_VISION_MODEL || 'qwen-vl-max';

  const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'png';
  const mimeType = ext === 'jpg' ? 'jpeg' : ext;
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const dataUrl = `data:image/${mimeType};base64,${b64}`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: '请识别这张图片中的订单数据，输出 JSON 数组。' },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Bailian ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || '';
  console.log('[图片识别] Bailian 返回长度:', raw.length);

  const orders = parseJsonArray(raw);
  console.log('[图片识别] 解析出', orders.length, '条订单');

  return { orders, rawText: raw };
}

// LLM 有时会包 ```json ... ``` 或前后加说明，宽松剥一下
function parseJsonArray(text) {
  let s = text.trim();
  // 剥 markdown 代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 取第一个 [ 到最后一个 ]
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('Bailian 返回不是合法 JSON 数组: ' + s.slice(0, 200));
  s = s.slice(start, end + 1);

  let arr;
  try {
    arr = JSON.parse(s);
  } catch (e) {
    throw new Error('JSON 解析失败: ' + e.message + ' | 内容: ' + s.slice(0, 200));
  }
  if (!Array.isArray(arr)) throw new Error('Bailian 返回不是数组');

  // 规整字段：补齐缺失 key + 数字字段转 number
  return arr.map(item => {
    const out = {};
    for (const k of ORDER_FIELDS) out[k] = item[k] ?? (isNumeric(k) ? 0 : '');
    for (const k of ['shot_weight', 'quantity_needed', 'material_kg', 'cavity']) {
      const v = out[k];
      out[k] = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
    }
    if (!out.cavity) out.cavity = 1;
    return out;
  }).filter(o => o.quantity_needed && o.quantity_needed >= 10);
}

function isNumeric(key) {
  return ['shot_weight', 'quantity_needed', 'material_kg', 'cavity'].includes(key);
}

module.exports = { parseImageOrders };
