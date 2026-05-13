// 用百炼(Bailian / DashScope)的 qwen-vl-max 视觉模型,从订单照片/截图里抽出
//   { header:{order_no,order_date,due_date}, code, items:[{part_name, qty}] }
// 跟 pdf-order-parser 返回结构对齐,后续可以走同一套匹配/alias 流程。

const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = 'qwen-vl-max';

const SYSTEM_PROMPT = `你是工厂订单图片识别助手。用户会发一张工厂订单的照片或截图,
请抽取以下字段并以严格 JSON 输出(不要 markdown 代码块,不要任何额外文字):
{
  "header": {
    "order_no": "订单号/单号(找不到给空串)",
    "order_date": "下单日期 YYYY-MM-DD(找不到给空串)",
    "due_date": "交货日期 YYYY-MM-DD(找不到给空串)"
  },
  "code": "产品货号(只取主货号,不带后缀如 -总MA;找不到给空串)",
  "items": [
    { "part_name": "部位名(或工序名,按订单上的写法原样输出)", "qty": 数字 }
  ]
}
注意:
- items 里数量必须是纯数字。
- 同一部位/工序的不同款/颜色,如果只有一个汇总数,合并成一行。
- 不要编造没看见的字段,空就给空串或 0。`;

async function parseImageOrder(buffer, mimeType) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置(server/.env)');

  const b64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${b64}`;

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: '请按系统指令把这张订单图里的内容抽成 JSON 输出。' },
        ],
      },
    ],
    temperature: 0,
  };

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bailian ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';

  // 模型偶尔会包 ```json ... ```;剥掉
  const cleaned = String(content)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Bailian 返回的不是合法 JSON: ${cleaned.slice(0, 300)}`);
  }

  // 规整 items
  const items = Array.isArray(parsed.items) ? parsed.items.map(it => ({
    part_name: String(it.part_name || '').trim(),
    qty: Number(it.qty) || 0,
  })).filter(it => it.part_name) : [];

  return {
    header: {
      order_no: String(parsed?.header?.order_no || '').trim(),
      order_date: String(parsed?.header?.order_date || '').trim(),
      due_date: String(parsed?.header?.due_date || '').trim(),
      technique_label: '',
    },
    code: String(parsed.code || '').trim(),
    items,
    raw_text: content,
  };
}

module.exports = { parseImageOrder };
