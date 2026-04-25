const fs = require('fs');
const path = require('path');

const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-0d651dff943546b092179b9da9f4a659';
const MODEL = 'qwen-vl-max-latest';
const API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const PROMPT = `你是一个订单识别助手。请识别这张图片里的生产订单/啤货表/排单表格，把每一行订单数据提取出来。

字段说明：
- product_code: 产品货号（如 92105、47391、11494、1226146）
- mold_no: 模具编号（如 RBCA-08M-01、FUGG-05M-01、1226146-M02、YH-10866）
- mold_name: 模具名称（中文，如"奶嘴模具"、"牙齿模"、"眼睛"）
- color: 颜色（如"金色"、"银色"、"浅咖色"、"黑色"）
- color_powder_no: 色粉号（4-6位数字字母，如 87793、88397）
- material_type: 料型（如"ABS 750NSW"、"LDPE 260GG"、"PP EP332K"、"1#EP332K"、"透明ABS TR558AI"）
- shot_weight: 啤重G（数字，如 17.6、53.8）
- quantity_needed: 需啤数/啤数（数字，如 4138、1875）
- material_kg: 总净重KG（数字，可选）
- order_no: 下单单号/生产单号（如 ZWY260002/B、CMC260173、ZCS2600109）
- notes: 备注（如"3牙齿"、"喷油"、"只啤Z-02牙齿"等。没有就留空）

要求：
1. 只输出 JSON 数组，不要任何其他文字、不要markdown代码块
2. 合并单元格的货号要继承到下面的行
3. 跳过汇总行（含"合计"/"本页"/"总净重"等）、备注行、页脚行
4. 跳过模具编号明显无效的行
5. 啤重和啤数必须是纯数字，没有就填 0
6. 空字段用空字符串 ""

输出格式（示例）：
[
  {"product_code":"92105","mold_no":"RBCA-08M-01","mold_name":"奶嘴模具","color":"金色","color_powder_no":"87793","material_type":"LDPE 260GG","shot_weight":17.6,"quantity_needed":4138,"material_kg":73.18,"order_no":"ZWY260002/B","notes":"3牙齿"}
]`;

async function parseImageWithQwen(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp' };
  const mimeType = mimeMap[ext] || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;

  const body = {
    model: MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: PROMPT },
      ],
    }],
    temperature: 0.1,
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`百炼API错误: HTTP ${res.status} - ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  console.log('[Qwen] 原始响应长度:', content.length);

  // 去掉可能的 markdown 代码块包裹
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('百炼返回非JSON: ' + content.substring(0, 200));
    parsed = JSON.parse(jsonMatch[0]);
  }
  if (!Array.isArray(parsed)) throw new Error('百炼返回不是数组');

  const orders = parsed.map(o => {
    const moldNo = String(o.mold_no || '').trim();
    const moldName = String(o.mold_name || '').trim();
    const fullMoldName = moldNo && moldName ? `${moldNo} ${moldName}` : moldName || moldNo;
    return {
      product_code: String(o.product_code || '').trim(),
      mold_no: moldNo,
      mold_name: fullMoldName,
      color: String(o.color || '').trim(),
      color_powder_no: String(o.color_powder_no || '').trim(),
      material_type: String(o.material_type || '').trim(),
      shot_weight: parseFloat(o.shot_weight) || 0,
      material_kg: parseFloat(o.material_kg) || 0,
      sprue_pct: 0,
      ratio_pct: 0,
      quantity_needed: parseInt(o.quantity_needed) || 0,
      accumulated: 0,
      cavity: 1,
      cycle_time: 0,
      order_no: String(o.order_no || '').trim(),
      is_three_plate: 0,
      packing_qty: 0,
      notes: String(o.notes || '').trim(),
    };
  }).filter(o => o.mold_no || o.mold_name);

  console.log('[Qwen] 识别到', orders.length, '条订单');
  return orders;
}

module.exports = { parseImageWithQwen };
