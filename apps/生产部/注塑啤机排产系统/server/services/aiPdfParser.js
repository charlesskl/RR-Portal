// AI-powered PDF parser using 阿里百炼 (Qwen) via OpenAI-compatible API.
// 从原 pi-outsource 系统的 ai-parser.js 移植，适配 paiji 已有的 pdf-parse v1 API。

const pdfParse = require('pdf-parse');

const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

async function extractPdfText(buf) {
  const data = await pdfParse(buf);
  return data.text;
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
    "customer": "委托方公司名称",
    "supplier": "加工方公司名称",
    "deliver_to": "交货地点",
    "placer": "下单人姓名",
    "receiver": "接单人姓名",
    "note": "PDF 上单据本身的备注"
  },
  "rows": [
    {
      "order_no": "款号/货号",
      "mold_code": "模具编号（如 1126169-M01, FNT-0571-001-01）",
      "mold_name": "工模名称/品名/货物名称",
      "total_sets": 总套数(整数),
      "shots": 啤数(整数),
      "color": "颜色",
      "color_powder": "色粉号",
      "material": "用料名称",
      "shot_weight_g": 整啤净重G(数字),
      "total_weight_kg": 总净重KG(数字),
      "unit_price": 加工单价(数字),
      "amount": 加工金额(数字),
      "production_no": "生产单号",
      "row_note": "该行简短备注",
      "delivery_date": "该行交货日期 YYYY-MM-DD"
    }
  ]
}

规则：
- 找不到的字段填空字符串或 null，不要瞎编。
- 数字字段不能填字符串。
- 日期统一 YYYY-MM-DD。
- 颜色和模具编号字段把跨行拆开的还原合并。
- 不要包含 markdown 代码块标记。`;

async function aiParse(text) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) throw new Error('BAILIAN_API_KEY 未配置');
  const model = process.env.BAILIAN_TEXT_MODEL || 'qwen-plus';

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
  if (!content) throw new Error('Bailian 返回为空');

  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`AI 返回的 JSON 无法解析: ${e.message}\n---\n${content.slice(0, 500)}`);
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

// 把 AI 解析出来的 rows 映射到 paiji orders 表结构（destination=outsource）
function aiRowsToOrders(rows, headerInfo = {}) {
  return rows.map((r, idx) => ({
    product_code: r.order_no || '',
    mold_no: r.mold_code || '',
    mold_name: r.mold_name || '',
    color: r.color || '',
    color_powder_no: r.color_powder || '',
    material_type: r.material || '',
    shot_weight: Number(r.shot_weight_g) || 0,
    material_kg: Number(r.total_weight_kg) || 0,
    quantity_needed: Number(r.shots) || Number(r.total_sets) || 0,
    order_no: r.production_no || headerInfo.bill_no || String(idx + 1),
    order_notes: r.row_note || '',
    // 外发字段
    destination: 'outsource',
    supplier: headerInfo.supplier || null,
    quote_price_usd: null,
    supplier_price_rmb: Number(r.unit_price) || null,
    supplier_price_usd: null,
    capacity_per_day: null,
    order_date: headerInfo.place_date || null,
    estimated_delivery: r.delivery_date || headerInfo.delivery_date || null,
    outsource_status: 'open',
    source_system: 'ai-pdf',
    source_id: null,
  }));
}

module.exports = { aiParsePdfBuffer, aiParse, extractPdfText, aiRowsToOrders };
