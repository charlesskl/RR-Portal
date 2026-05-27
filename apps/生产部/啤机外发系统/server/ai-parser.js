// AI-powered PDF parser using 阿里百炼 (Qwen) via OpenAI-compatible API.
// Use as a fallback when the rule-based parser fails or for unknown templates.

const { PDFParse } = require('pdf-parse');

const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

async function extractPdfText(buf) {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const { text } = await parser.getText();
    return text;
  } finally {
    await parser.destroy();
  }
}

const SYSTEM_PROMPT = `你是一个专业的工厂订单 PDF 数据提取助手，服务于东莞兴信塑胶制品有限公司的「啤机外发」业务。

用户会给你一份「啤机外发 / 委托加工合同 / 啤货表 / 采购单」类 PDF 的纯文本内容。
PDF 排版会因 OCR 读取顺序产生错乱，请理解全文语义后提取结构化数据。

【角色定义 - 非常重要】
- "customer" 字段固定填【委托方/出单方】，通常是发起加工订单的公司（如"东莞兴信塑胶制品有限公司"、"东莞华登塑胶制品有限公司"）。
- "supplier" 字段固定填【加工方/承接方】，即接受外发加工的工厂（如"俊豪塑胶厂"、"东莞市稳当五金塑胶制品有限公司"、"东莞市旭凯..."、"兴信B车间" 等）。
- 在"委托加工合同"模板里，抬头是兴信，下方"供應商：XXX"才是真正的承接加工方→supplier。
- 在"啤货表"模板里，抬头是华登，下方"供应商：XXX"是承接加工方→supplier。

必须返回严格 JSON（无任何其他文字），格式：
{
  "header": {
    "bill_no": "单据编号（生产单号 / 採購單編號）",
    "place_date": "出单日期 YYYY-MM-DD",
    "delivery_date": "交货日期 YYYY-MM-DD",
    "customer": "委托方公司名称（见上）",
    "supplier": "加工方公司名称（见上）",
    "deliver_to": "交货地点（仅地点，不含日期）",
    "placer": "下单人姓名",
    "receiver": "接单人姓名",
    "operator": "操作员姓名",
    "goods_receiver": "收货人姓名",
    "note": "PDF 上单据本身的备注，通常很短（如 PO 号、'更改单'、'XX 产品 更改单'）。不要把法律条款、付款说明、玩具安全标准等长段落塞进来。"
  },
  "rows": [
    {
      "order_no": "款号/货号",
      "mold_code": "模具编号（如 1126169-M01, FNT-0571-001-01, RABTB-12M-01(热流道), MNVN-05M-01-1）",
      "mold_name": "工模名称/品名/货物名称",
      "total_sets": 总套数(整数),
      "shots": 啤数(整数),
      "color": "颜色（含色卡号，如 '黑色/Black7C' '红色/2347U'）",
      "color_powder": "色粉号（4-6位数字，如 7726, 63451, 89954）",
      "material": "用料名称（如 ABS 750NSW, 1#PP EP332K, PC-182S, TPR 40度）",
      "shot_weight_g": 整啤净重G(数字,单位克),
      "total_weight_kg": 总净重KG(数字),
      "unit_price": 加工单价(数字),
      "amount": 加工金额(数字),
      "production_no": "生产单号（采购单上会有，如 MA-RR-2280-2；若 PDF 没有则填空字符串）",
      "row_note": "该行的简短备注（如'喷印'、'合装'、'更改单'），不要塞入数量/单价等数字数据",
      "delivery_date": "该行交货日期 YYYY-MM-DD"
    }
  ]
}

规则：
- 找不到的字段填空字符串或 null，不要瞎编。
- color_powder 是色粉号（纯数字代码），material 是用料名称（化学名/牌号），两者不要混淆。
- 数字字段不能填字符串。
- 日期统一 YYYY-MM-DD（2026年4月17日 → 2026-04-17；26/5/12 → 2026-05-12；2026/4/27 → 2026-04-27）。
- 颜色字段把跨行拆开的色卡号还原合并（如"黑色/B" + "lack7C" → "黑色/Black7C"）。
- 模具编号字段跨行的也要合并（如 "RABTB-12M" + "-01(热流" + "道)" → "RABTB-12M-01(热流道)"）。
- note/row_note 只放单据真正的备注信息（如 PO 号、特殊工艺标注），绝不放法律条款、付款条款、玩具安全标准等模板化的长段落。
- 不要包含 markdown 代码块标记，直接输出 JSON 对象。`;

async function aiParse(text) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) throw new Error('BAILIAN_API_KEY not configured');
  const model = process.env.BAILIAN_MODEL || 'qwen-plus';

  const resp = await fetch(`${BAILIAN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Bailian API ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('Empty response from Bailian');

  // Some models wrap JSON in ```json ... ```; strip if present
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Cannot parse AI JSON: ${e.message}\n---\n${content.slice(0, 500)}`);
  }
  if (!parsed.header) parsed.header = {};
  if (!Array.isArray(parsed.rows)) parsed.rows = [];
  return {
    header: parsed.header,
    rows: parsed.rows,
    model_used: model,
    usage: data.usage,
  };
}

async function aiParsePdfBuffer(buf) {
  const text = await extractPdfText(buf);
  const result = await aiParse(text);
  return { template: 'ai', ...result };
}

module.exports = { aiParsePdfBuffer, aiParse };
